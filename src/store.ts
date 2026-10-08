import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type TaskState = 'queued' | 'running' | 'waiting_for_provider' | 'succeeded' | 'failed' | 'cancelled';
export interface Task {
  id: string; conversationId: string; input: string; source: string; eventId?: string;
  state: TaskState; checkpoint: Json; output: Json; error: string | null;
  createdAt: string; updatedAt: string;
}
export interface TaskInput { id?: string; conversationId: string; input: string; source: string; eventId?: string }
export interface TaskPatch { state?: TaskState; checkpoint?: Json; output?: Json; error?: string | null }
export interface JournalEvent { seq: number; type: string; taskId: string | null; payload: Json; createdAt: string }
export interface Effect {
  id: string; taskId: string; kind: string; payload: Json; state: 'reserved' | 'completed' | 'unknown';
  result: Json; reason: string | null; createdAt: string; updatedAt: string;
}
export interface EffectInput { id: string; taskId: string; kind: string; payload: Json }
export type MemoryKind = 'episodic' | 'semantic' | 'procedural' | 'autobiographical';
export interface Memory {
  id: string; version: number; scope: string; kind: MemoryKind; content: string; source: string;
  confidence: number; evidence: string[]; createdAt: string; updatedAt: string;
}
export interface MemoryInput { scope: string; kind: MemoryKind; content: string; source: string; confidence: number; evidence?: string[] }
export interface MemoryCorrection { content: string; source: string; confidence: number; evidence?: string[] }
export type GrowthDimension = 'personality_judgment' | 'interests_curiosity' | 'code_quality' | 'capability_potential';
export type GrowthState = 'queued' | 'running' | 'paused' | 'completed';
export interface Growth {
  id: string; dimension: GrowthDimension; question: string; origin: string; nextStep: string;
  state: GrowthState; checkpoint: Json; outcome: Json; budget: number; remainingBudget: number;
  createdAt: string; updatedAt: string;
}
export interface GrowthInput { id?: string; dimension: GrowthDimension; question: string; origin: string; nextStep?: string; budget?: number }
export interface GrowthPatch { state?: GrowthState; nextStep?: string; checkpoint?: Json; outcome?: Json; remainingBudget?: number }

export class EffectConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'EffectConflictError'; }
}

const taskStates: TaskState[] = ['queued', 'running', 'waiting_for_provider', 'succeeded', 'failed', 'cancelled'];
const transitions: Record<TaskState, TaskState[]> = {
  queued: ['running', 'cancelled'], running: ['queued', 'waiting_for_provider', 'succeeded', 'failed', 'cancelled'],
  waiting_for_provider: ['queued', 'running', 'failed', 'cancelled'], succeeded: [], failed: [], cancelled: [],
};
const memoryKinds: MemoryKind[] = ['episodic', 'semantic', 'procedural', 'autobiographical'];
const dimensions: GrowthDimension[] = ['personality_judgment', 'interests_curiosity', 'code_quality', 'capability_potential'];
const growthStates: GrowthState[] = ['queued', 'running', 'paused', 'completed'];

function required(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a nonempty string`);
}
function budget(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Budget must be a nonnegative safe integer');
}
function memoryContent(value: MemoryCorrection): void {
  required(value.content, 'Memory content'); required(value.source, 'Memory source');
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('Memory confidence must be between 0 and 1');
  if (value.evidence !== undefined && (!Array.isArray(value.evidence) || value.evidence.some(item => typeof item !== 'string' || !item.trim()))) throw new Error('Memory evidence must contain nonempty references');
}
function encode(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Value must be JSON serializable');
  return result;
}
function decode<T>(row: unknown): T | undefined {
  return row === undefined ? undefined : JSON.parse((row as { record: string }).record) as T;
}

/** Durable local state. This component is deliberately not an authorization boundary:
 * its owner must enforce generation capabilities before calling its mutators.
 * Every compound write and its journal entry commit together. No constructor
 * auto-recovery: only a coordinator which has stopped previous workers may recover.
 */
export class Store {
  #db: DatabaseSync;
  #transaction = false;
  #closed = false;

  constructor(dbPath: string) {
    required(dbPath, 'Database path');
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, source TEXT NOT NULL,
        event_id TEXT, state TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(source, event_id)
      );
      CREATE INDEX IF NOT EXISTS tasks_by_state ON tasks(state);
      CREATE TABLE IF NOT EXISTS journal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, task_id TEXT,
        payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS effects (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), state TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS effects_by_task ON effects(task_id, state);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT NOT NULL, version INTEGER NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL,
        forgotten INTEGER NOT NULL DEFAULT 0, record TEXT, PRIMARY KEY(id, version)
      );
      CREATE INDEX IF NOT EXISTS memories_by_scope ON memories(scope, forgotten);
      CREATE TABLE IF NOT EXISTS memory_publications (
        scope TEXT NOT NULL, publication_id TEXT NOT NULL, memory_id TEXT NOT NULL,
        PRIMARY KEY(scope, publication_id)
      );
      CREATE TABLE IF NOT EXISTS growth (
        id TEXT PRIMARY KEY, dimension TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL
      );
    `);
  }

  close(): void { if (!this.#closed) { this.#db.close(); this.#closed = true; } }

  #atomic<T>(operation: () => T): T {
    if (this.#transaction) return operation();
    this.#db.exec('BEGIN IMMEDIATE');
    this.#transaction = true;
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    finally { this.#transaction = false; }
  }

  enqueue(input: TaskInput): Task {
    required(input.conversationId, 'Conversation ID'); required(input.input, 'Task input'); required(input.source, 'Source');
    if (input.id !== undefined) required(input.id, 'Task ID');
    if (input.eventId !== undefined) required(input.eventId, 'Event ID');
    return this.#atomic(() => {
      const existing = input.eventId === undefined ? undefined : decode<Task>(this.#db.prepare('SELECT record FROM tasks WHERE source = ? AND event_id = ?').get(input.source, input.eventId));
      if (existing) {
        if (existing.conversationId !== input.conversationId || existing.input !== input.input || (input.id !== undefined && input.id !== existing.id)) throw new Error('Task delivery idempotency conflict');
        return existing;
      }
      const now = new Date().toISOString();
      const task: Task = { ...input, id: input.id ?? randomUUID(), state: 'queued', checkpoint: null, output: null, error: null, createdAt: now, updatedAt: now };
      if (this.task(task.id)) throw new Error('Task ID conflict');
      this.#db.prepare('INSERT INTO tasks(id, conversation_id, source, event_id, state, record) VALUES (?, ?, ?, ?, ?, ?)').run(task.id, task.conversationId, task.source, task.eventId ?? null, task.state, encode(task));
      this.appendEvent('task.queued', { conversationId: task.conversationId }, task.id);
      return task;
    });
  }

  task(id: string): Task | undefined { return decode<Task>(this.#db.prepare('SELECT record FROM tasks WHERE id = ?').get(id)); }

  listTasks(filter: { conversationId?: string; states?: TaskState[] } = {}): Task[] {
    const conditions: string[] = []; const values: string[] = [];
    if (filter.conversationId !== undefined) { conditions.push('conversation_id = ?'); values.push(filter.conversationId); }
    if (filter.states !== undefined) {
      if (!filter.states.length) return [];
      conditions.push(`state IN (${filter.states.map(() => '?').join(',')})`); values.push(...filter.states);
    }
    return this.#db.prepare(`SELECT record FROM tasks${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY rowid`).all(...values).map(row => decode<Task>(row)!);
  }

  #unresolved(taskId: string): boolean {
    return this.#db.prepare("SELECT id FROM effects WHERE task_id = ? AND state IN ('reserved', 'unknown') LIMIT 1").get(taskId) !== undefined;
  }

  updateTask(id: string, patch: TaskPatch): Task {
    return this.#atomic(() => {
      const previous = this.task(id);
      if (!previous) throw new Error('Task not found');
      const state = patch.state ?? previous.state;
      if (!taskStates.includes(state) || (state !== previous.state && !transitions[previous.state].includes(state))) throw new Error(`Invalid task transition ${previous.state} -> ${state}`);
      if (['succeeded', 'failed', 'cancelled'].includes(previous.state)) {
        if (Object.entries(patch).some(([key, value]) => encode(value) !== encode(previous[key as keyof Task]))) {
          throw new Error('Cannot mutate a terminal task');
        }
        return previous;
      }
      if (state !== previous.state && ['queued', 'running', 'succeeded'].includes(state) && this.#unresolved(id)) throw new Error('Task requires effect reconciliation before resuming or completing');
      const task: Task = { ...previous, ...patch, state, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE tasks SET state = ?, record = ? WHERE id = ?').run(state, encode(task), id);
      this.appendEvent('task.updated', { previousState: previous.state, state }, id);
      return task;
    });
  }

  claimNext(): Task | undefined {
    return this.#atomic(() => {
      const row = this.#db.prepare("SELECT record FROM tasks WHERE state = 'queued' AND NOT EXISTS (SELECT 1 FROM effects WHERE effects.task_id = tasks.id AND effects.state IN ('reserved', 'unknown')) ORDER BY rowid LIMIT 1").get();
      const task = decode<Task>(row);
      return task ? this.updateTask(task.id, { state: 'running' }) : undefined;
    });
  }

  /** Commit a response and its episode together, avoiding duplicate memory on restart. */
  finishTask(id: string, output: Json, episode: MemoryInput): Task {
    return this.#atomic(() => {
      const task = this.task(id);
      if (!task || task.state !== 'running') throw new Error('Task result requires a running task');
      if (episode.scope !== task.conversationId) throw new Error('Task episode must stay in conversation scope');
      if (this.#unresolved(id)) throw new Error('Task requires effect reconciliation before completion');
      this.addMemory(episode);
      return this.updateTask(id, { state: 'succeeded', output, error: null });
    });
  }

  /** Call only once previous execution owners are known stopped. Reserved means
   * execution may have reached the remote boundary; recovery never guesses.
   * waiting_for_provider with error=effect_reconciliation_required is a blocked
   * task until completeEffect records an independently reconciled outcome.
   */
  recoverInterrupted(): Task[] {
    return this.#atomic(() => {
      for (const effect of this.listEffects()) if (effect.state === 'reserved') this.markEffectUnknown(effect.id, 'Process interrupted before outcome was recorded');
      const recovered: Task[] = [];
      for (const task of this.listTasks({ states: ['running', 'waiting_for_provider'] })) {
        recovered.push(this.updateTask(task.id, this.#unresolved(task.id)
          ? { state: 'waiting_for_provider', error: 'effect_reconciliation_required' }
          : { state: 'queued', error: null }));
      }
      return recovered;
    });
  }

  appendEvent(type: string, payload: Json, taskId?: string): JournalEvent {
    required(type, 'Event type');
    const createdAt = new Date().toISOString();
    const result = this.#db.prepare('INSERT INTO journal(type, task_id, payload, created_at) VALUES (?, ?, ?, ?)').run(type, taskId ?? null, encode(payload), createdAt);
    return { seq: Number(result.lastInsertRowid), type, taskId: taskId ?? null, payload, createdAt };
  }

  listEvents(filter: { after?: number; taskId?: string } = {}): JournalEvent[] {
    const rows = filter.taskId === undefined
      ? this.#db.prepare('SELECT * FROM journal WHERE seq > ? ORDER BY seq').all(filter.after ?? 0)
      : this.#db.prepare('SELECT * FROM journal WHERE seq > ? AND task_id = ? ORDER BY seq').all(filter.after ?? 0, filter.taskId);
    return rows.map(row => ({ seq: Number(row.seq), type: String(row.type), taskId: row.task_id === null ? null : String(row.task_id), payload: JSON.parse(String(row.payload)) as Json, createdAt: String(row.created_at) }));
  }

  effect(id: string): Effect | undefined { return decode<Effect>(this.#db.prepare('SELECT record FROM effects WHERE id = ?').get(id)); }
  listEffects(taskId?: string): Effect[] {
    const rows = taskId === undefined ? this.#db.prepare('SELECT record FROM effects ORDER BY rowid').all() : this.#db.prepare('SELECT record FROM effects WHERE task_id = ? ORDER BY rowid').all(taskId);
    return rows.map(row => decode<Effect>(row)!);
  }

  reserveEffect(input: EffectInput): Effect {
    required(input.id, 'Effect ID'); required(input.kind, 'Effect kind');
    return this.#atomic(() => {
      if (this.effect(input.id)) throw new EffectConflictError('Effect ID conflict: reconcile recorded outcome; never replay');
      const task = this.task(input.taskId);
      if (!task || task.state !== 'running') throw new Error('Effect requires a running task');
      const now = new Date().toISOString();
      const effect: Effect = { ...input, state: 'reserved', result: null, reason: null, createdAt: now, updatedAt: now };
      this.#db.prepare('INSERT INTO effects(id, task_id, state, record) VALUES (?, ?, ?, ?)').run(effect.id, effect.taskId, effect.state, encode(effect));
      this.appendEvent('effect.reserved', { effectId: effect.id, kind: effect.kind }, effect.taskId);
      return effect;
    });
  }

  completeEffect(id: string, result: Json): Effect {
    return this.#atomic(() => {
      const old = this.effect(id);
      if (!old) throw new Error('Effect not found');
      if (old.state === 'completed') {
        if (encode(old.result) !== encode(result)) throw new EffectConflictError('Effect result conflict');
        return old;
      }
      const effect: Effect = { ...old, result, state: 'completed', reason: null, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE effects SET state = ?, record = ? WHERE id = ?').run(effect.state, encode(effect), id);
      this.appendEvent('effect.completed', { effectId: id, reconciled: old.state === 'unknown' }, effect.taskId);
      return effect;
    });
  }

  markEffectUnknown(id: string, reason: string): Effect {
    required(reason, 'Reconciliation reason');
    return this.#atomic(() => {
      const old = this.effect(id);
      if (!old) throw new Error('Effect not found');
      if (old.state === 'completed') throw new EffectConflictError('Completed effect cannot become unknown');
      const effect: Effect = { ...old, state: 'unknown', reason, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE effects SET state = ?, record = ? WHERE id = ?').run(effect.state, encode(effect), id);
      this.appendEvent('effect.unknown', { effectId: id }, effect.taskId);
      return effect;
    });
  }

  addMemory(input: MemoryInput): Memory {
    required(input.scope, 'Memory scope'); memoryContent(input);
    if (!memoryKinds.includes(input.kind)) throw new Error('Invalid memory kind');
    return this.#atomic(() => {
      const now = new Date().toISOString();
      const memory: Memory = { ...input, id: randomUUID(), version: 1, evidence: input.evidence ?? [], createdAt: now, updatedAt: now };
      this.#writeMemory(memory);
      this.appendEvent('memory.added', { memoryId: memory.id, version: memory.version });
      return memory;
    });
  }

  #writeMemory(memory: Memory): void {
    this.#db.prepare('INSERT INTO memories(id, version, scope, kind, record) VALUES (?, ?, ?, ?, ?)').run(memory.id, memory.version, memory.scope, memory.kind, encode(memory));
  }

  /** Durable publication identity survives forgetting, preventing retry resurrection. */
  publishMemoryOnce(input: MemoryInput & { publicationId: string }): { status: 'published' | 'existing' | 'forgotten'; memory?: Memory } {
    required(input.publicationId, 'Publication ID');
    return this.#atomic(() => {
      const old = this.#db.prepare('SELECT memory_id FROM memory_publications WHERE scope = ? AND publication_id = ?')
        .get(input.scope, input.publicationId);
      if (old) {
        const memory = this.memory(String(old.memory_id), input.scope);
        return memory ? { status: 'existing', memory } : { status: 'forgotten' };
      }
      const { publicationId, ...content } = input;
      const memory = this.addMemory(content);
      this.#db.prepare('INSERT INTO memory_publications(scope, publication_id, memory_id) VALUES (?, ?, ?)')
        .run(input.scope, publicationId, memory.id);
      return { status: 'published', memory };
    });
  }

  memory(id: string, scope: string): Memory | undefined {
    return decode<Memory>(this.#db.prepare('SELECT record FROM memories WHERE id = ? AND scope = ? AND forgotten = 0 ORDER BY version DESC LIMIT 1').get(id, scope));
  }

  listMemories(scope: string, filter: { kind?: MemoryKind; includeHistory?: boolean } = {}): Memory[] {
    required(scope, 'Memory scope');
    const rows = this.#db.prepare(`SELECT record FROM memories AS m WHERE scope = ? AND forgotten = 0${filter.kind ? ' AND kind = ?' : ''}${filter.includeHistory ? '' : ' AND version = (SELECT MAX(version) FROM memories WHERE id = m.id)'} ORDER BY rowid`).all(...(filter.kind ? [scope, filter.kind] : [scope]));
    return rows.map(row => decode<Memory>(row)!);
  }

  /** Literal, case-insensitive substring retrieval. This is a small seed backend,
   * not semantic similarity search, and has no utility threshold for episodes. */
  searchMemories(scope: string, query: string): Memory[] {
    const needle = query.toLocaleLowerCase('en-US');
    return this.listMemories(scope).filter(memory => memory.content.toLocaleLowerCase('en-US').includes(needle));
  }

  correctMemory(id: string, scope: string, correction: MemoryCorrection): Memory {
    memoryContent(correction);
    return this.#atomic(() => {
      const old = this.memory(id, scope);
      if (!old) throw new Error('Memory not found in scope');
      const memory: Memory = { ...old, ...correction, evidence: correction.evidence ?? [], version: old.version + 1, updatedAt: new Date().toISOString() };
      this.#writeMemory(memory);
      this.appendEvent('memory.corrected', { memoryId: id, version: memory.version });
      return memory;
    });
  }

  /** Hide and clear content in every stored revision. Tombstones prevent local
   * resurrection. This is logical forgetting, not forensic erasure of WAL,
   * backups, existing snapshots, other records, or external provider history. */
  forgetMemory(id: string, scope: string): void {
    this.#atomic(() => {
      if (!this.memory(id, scope)) throw new Error('Memory not found in scope');
      this.#db.prepare('UPDATE memories SET forgotten = 1, record = NULL WHERE id = ? AND scope = ?').run(id, scope);
      this.appendEvent('memory.forgotten', { memoryId: id });
    });
  }

  addGrowth(input: GrowthInput): Growth {
    required(input.question, 'Growth question'); required(input.origin, 'Growth origin');
    if (!dimensions.includes(input.dimension)) throw new Error('Invalid growth dimension');
    const initialBudget = input.budget ?? 1; budget(initialBudget);
    return this.#atomic(() => {
      const now = new Date().toISOString();
      const growth: Growth = { ...input, id: input.id ?? randomUUID(), state: 'queued', nextStep: input.nextStep ?? input.question, checkpoint: null, outcome: null, budget: initialBudget, remainingBudget: initialBudget, createdAt: now, updatedAt: now };
      required(growth.id, 'Growth ID');
      if (this.growth(growth.id)) throw new Error('Growth ID conflict');
      this.#db.prepare('INSERT INTO growth(id, dimension, state, record) VALUES (?, ?, ?, ?)').run(growth.id, growth.dimension, growth.state, encode(growth));
      this.appendEvent('growth.added', { growthId: growth.id, dimension: growth.dimension });
      return growth;
    });
  }

  growth(id: string): Growth | undefined { return decode<Growth>(this.#db.prepare('SELECT record FROM growth WHERE id = ?').get(id)); }
  listGrowth(): Growth[] { return this.#db.prepare('SELECT record FROM growth ORDER BY rowid').all().map(row => decode<Growth>(row)!); }

  /** A claim consumes one inference call before it can reach a provider. */
  claimGrowth(id: string): Growth | undefined {
    return this.#atomic(() => {
      const old = this.growth(id);
      if (!old || !['queued', 'paused'].includes(old.state) || old.remainingBudget < 1) return undefined;
      return this.updateGrowth(id, { state: 'running', remainingBudget: old.remainingBudget - 1 });
    });
  }

  /** Only the exclusive coordinator may call this after former workers stop. */
  recoverGrowthInterrupted(): Growth[] {
    return this.#atomic(() => this.listGrowth().filter(item => item.state === 'running')
      .map(item => this.updateGrowth(item.id, { state: 'paused' })));
  }

  updateGrowth(id: string, patch: GrowthPatch): Growth {
    if (patch.remainingBudget !== undefined) budget(patch.remainingBudget);
    return this.#atomic(() => {
      const old = this.growth(id);
      if (!old) throw new Error('Growth item not found');
      const state = patch.state ?? old.state;
      if (!growthStates.includes(state) || (old.state === 'completed' && state !== 'completed')) throw new Error('Invalid growth transition');
      if (old.state === 'completed') {
        if (Object.entries(patch).some(([key, value]) => encode(value) !== encode(old[key as keyof Growth]))) {
          throw new Error('Cannot mutate a completed growth experiment');
        }
        return old;
      }
      if ((patch.remainingBudget ?? old.remainingBudget) > old.remainingBudget) throw new Error('Remaining budget cannot increase through an experiment update');
      const growth: Growth = { ...old, ...patch, state, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE growth SET state = ?, record = ? WHERE id = ?').run(state, encode(growth), id);
      this.appendEvent('growth.updated', { growthId: id, state });
      return growth;
    });
  }
}
