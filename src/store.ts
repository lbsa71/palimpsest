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
export interface MemorySourceRef { id: string; version: number }
export interface MemoryConsolidation {
  id: string; scope: string; state: 'ready' | 'running' | 'paused' | 'publishing' | 'completed' | 'rejected';
  attempts: number; maxAttempts: number; checkpoint: Json; updatedAt: string;
}
export type GrowthDimension = 'personality_judgment' | 'interests_curiosity' | 'code_quality' | 'capability_potential';
export type GrowthState = 'queued' | 'running' | 'paused' | 'completed';
export interface Growth {
  id: string; dimension: GrowthDimension; question: string; origin: string; nextStep: string;
  state: GrowthState; checkpoint: Json; outcome: Json; budget: number; remainingBudget: number;
  createdAt: string; updatedAt: string;
}
export interface GrowthInput { id?: string; dimension: GrowthDimension; question: string; origin: string; nextStep?: string; budget?: number }
export interface GrowthPatch { state?: GrowthState; nextStep?: string; checkpoint?: Json; outcome?: Json; remainingBudget?: number }
export interface GrowthWindow {
  id: string; schedulerId: string; startsAt: number; endsAt: number; maxCalls: number;
  usedCalls: number; createdAt: string; updatedAt: string;
}
export interface GrowthWindowInput { id: string; schedulerId: string; startsAt: number; endsAt: number; maxCalls: number }
export interface GrowthProposalDelivery {
  growthId: string; state: 'reserved' | 'delivered' | 'uncertain'; createdAt: string; updatedAt: string;
}

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
      CREATE TABLE IF NOT EXISTS growth_windows (
        id TEXT PRIMARY KEY, scheduler_id TEXT NOT NULL, starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL, record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS growth_proposal_deliveries (
        growth_id TEXT PRIMARY KEY REFERENCES growth(id), record TEXT NOT NULL
      );
    `);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory_source_refs (
        scope TEXT NOT NULL, memory_id TEXT NOT NULL, source_id TEXT NOT NULL, source_version INTEGER NOT NULL,
        PRIMARY KEY(scope, memory_id, source_id)
      );
      CREATE INDEX IF NOT EXISTS memory_dependents ON memory_source_refs(scope, source_id);
      CREATE TABLE IF NOT EXISTS memory_consolidations (
        scope TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY(scope, id)
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

  /** Durable participation comes only from previously accepted Slack ingress. */
  hasSlackThread(conversationId: string): boolean {
    return this.#db.prepare("SELECT 1 FROM tasks WHERE source = 'slack' AND conversation_id = ? LIMIT 1").get(conversationId) !== undefined;
  }

  hasSlackEvent(eventId: string): boolean {
    return this.#db.prepare("SELECT 1 FROM tasks WHERE source = 'slack' AND event_id = ? LIMIT 1").get(eventId) !== undefined;
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

  /** Publish only while every model-visible source retains the same scoped
   * version. Provenance edges support conservative recursive invalidation. */
  publishMemoryFromSourcesOnce(input: MemoryInput & { publicationId: string; sourceRefs: MemorySourceRef[] }): { status: 'published' | 'existing' | 'forgotten'; memory?: Memory } {
    return this.#atomic(() => {
      if (!Array.isArray(input.sourceRefs) || !input.sourceRefs.length || new Set(input.sourceRefs.map(ref => ref.id)).size !== input.sourceRefs.length) throw new Error('Consolidation requires distinct source references');
      for (const ref of input.sourceRefs) {
        const source = this.memory(ref.id, input.scope);
        if (!source || !Number.isSafeInteger(ref.version) || source.version !== ref.version) throw new Error('Consolidation source was corrected, forgotten, or outside scope');
      }
      const { sourceRefs, ...publication } = input;
      const result = this.publishMemoryOnce(publication);
      if (result.status === 'published') for (const ref of sourceRefs) {
        this.#db.prepare('INSERT INTO memory_source_refs(scope, memory_id, source_id, source_version) VALUES (?, ?, ?, ?)').run(input.scope, result.memory!.id, ref.id, ref.version);
      }
      return result;
    });
  }

  #invalidateMemoryDependents(id: string, scope: string): void {
    const pending = [id]; const seen = new Set(pending);
    for (const sourceId of pending) {
      for (const row of this.#db.prepare('SELECT memory_id FROM memory_source_refs WHERE scope = ? AND source_id = ?').all(scope, sourceId)) {
        const memoryId = String(row.memory_id);
        if (seen.has(memoryId)) continue;
        seen.add(memoryId); pending.push(memoryId);
        if (this.memory(memoryId, scope)) {
          this.#db.prepare('UPDATE memories SET forgotten = 1, record = NULL WHERE id = ? AND scope = ?').run(memoryId, scope);
          this.appendEvent('memory.invalidated', { memoryId, sourceId });
        }
      }
    }
  }

  /** One consistent read transaction; explicit growth IDs are authorization
   * input from the caller rather than an implicit grant to the global agenda. */
  readContinuitySnapshot(scope: string, growthIds: string[] = []): { scope: string; sequence: number; memories: Memory[]; tasks: Task[]; growth: Growth[] } {
    required(scope, 'Snapshot scope');
    return this.#atomic(() => {
      const growth = [...new Set(growthIds)].map(id => { const item = this.growth(id); if (!item) throw new Error('Requested snapshot growth item not found'); return item; });
      const sequence = Number(this.#db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM journal').get()!.seq);
      return { scope, sequence, memories: this.listMemories(scope), tasks: this.listTasks({ conversationId: scope }), growth };
    });
  }

  createMemoryConsolidation(id: string, scope: string, maxAttempts: number): MemoryConsolidation {
    required(id, 'Consolidation ID'); required(scope, 'Consolidation scope');
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) throw new Error('Consolidation attempt allocation must be 1 to 8');
    return this.#atomic(() => {
      const old = this.memoryConsolidation(id, scope);
      if (old) { if (old.maxAttempts !== maxAttempts) throw new Error('Consolidation allocation cannot change on retry'); return old; }
      const record: MemoryConsolidation = { id, scope, state: 'ready', attempts: 0, maxAttempts, checkpoint: null, updatedAt: new Date().toISOString() };
      this.#db.prepare('INSERT INTO memory_consolidations(scope, id, state, record) VALUES (?, ?, ?, ?)').run(scope, id, record.state, encode(record));
      this.appendEvent('memory.consolidation.created', { consolidationId: id }); return record;
    });
  }

  memoryConsolidation(id: string, scope: string): MemoryConsolidation | undefined {
    return decode<MemoryConsolidation>(this.#db.prepare('SELECT record FROM memory_consolidations WHERE scope = ? AND id = ?').get(scope, id));
  }

  claimMemoryConsolidation(id: string, scope: string): MemoryConsolidation | undefined {
    return this.#atomic(() => {
      const old = this.memoryConsolidation(id, scope);
      if (!old || !['ready', 'paused'].includes(old.state) || old.attempts >= old.maxAttempts) return undefined;
      return this.updateMemoryConsolidation(id, scope, { state: 'running' });
    });
  }

  beginMemoryConsolidationAttempt(id: string, scope: string): MemoryConsolidation {
    return this.#atomic(() => {
      const old = this.memoryConsolidation(id, scope);
      if (!old || old.state !== 'running' || old.attempts >= old.maxAttempts) throw new Error('No allocated running consolidation attempt');
      const record = { ...old, attempts: old.attempts + 1, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE memory_consolidations SET record = ? WHERE scope = ? AND id = ?').run(encode(record), scope, id);
      this.appendEvent('memory.consolidation.attempt', { consolidationId: id, attempt: record.attempts }); return record;
    });
  }

  updateMemoryConsolidation(id: string, scope: string, patch: { state?: MemoryConsolidation['state']; checkpoint?: Json }): MemoryConsolidation {
    return this.#atomic(() => {
      const old = this.memoryConsolidation(id, scope);
      if (!old) throw new Error('Consolidation not found');
      const transitions: Record<MemoryConsolidation['state'], MemoryConsolidation['state'][]> = { ready: ['running'], running: ['paused', 'publishing', 'completed', 'rejected'], paused: ['running'], publishing: ['completed', 'rejected'], completed: [], rejected: [] };
      const state = patch.state ?? old.state;
      if (state !== old.state && !transitions[old.state].includes(state)) throw new Error('Invalid consolidation transition');
      if (['completed', 'rejected'].includes(old.state)) {
        if (Object.entries(patch).some(([key, value]) => encode(value) !== encode(old[key as keyof MemoryConsolidation]))) throw new Error('Cannot mutate terminal consolidation');
        return old;
      }
      const record = { ...old, ...patch, state, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE memory_consolidations SET state = ?, record = ? WHERE scope = ? AND id = ?').run(state, encode(record), scope, id);
      this.appendEvent('memory.consolidation.updated', { consolidationId: id, state }); return record;
    });
  }

  /** Exclusive coordinator only, after previous inference owners are stopped. */
  recoverMemoryConsolidations(): MemoryConsolidation[] {
    return this.#atomic(() => this.#db.prepare("SELECT record FROM memory_consolidations WHERE state = 'running'").all().map(row => {
      const old = decode<MemoryConsolidation>(row)!;
      return this.updateMemoryConsolidation(old.id, old.scope, { state: 'paused', checkpoint: { reason: 'interrupted', attempts: old.attempts } });
    }));
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
      this.#invalidateMemoryDependents(id, scope);
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
      this.#invalidateMemoryDependents(id, scope);
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

  growthWindow(id: string): GrowthWindow | undefined {
    return decode<GrowthWindow>(this.#db.prepare('SELECT record FROM growth_windows WHERE id = ?').get(id));
  }

  /** Window limits are trusted policy, immutable once an allocation is opened. */
  openGrowthWindow(input: GrowthWindowInput): GrowthWindow {
    required(input.id, 'Growth window ID'); required(input.schedulerId, 'Growth scheduler ID');
    budget(input.startsAt); budget(input.endsAt); budget(input.maxCalls);
    if (input.endsAt <= input.startsAt) throw new Error('Growth window must end after it starts');
    return this.#atomic(() => {
      const old = this.growthWindow(input.id);
      if (old) {
        if (old.schedulerId !== input.schedulerId || old.startsAt !== input.startsAt || old.endsAt !== input.endsAt || old.maxCalls !== input.maxCalls) throw new Error('Growth window allocation is immutable');
        return old;
      }
      if (this.#db.prepare('SELECT id FROM growth_windows WHERE scheduler_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1').get(input.schedulerId, input.endsAt, input.startsAt)) throw new Error('Growth windows cannot overlap');
      const now = new Date().toISOString();
      const window: GrowthWindow = { ...input, usedCalls: 0, createdAt: now, updatedAt: now };
      this.#db.prepare('INSERT INTO growth_windows(id, scheduler_id, starts_at, ends_at, record) VALUES (?, ?, ?, ?, ?)').run(window.id, window.schedulerId, window.startsAt, window.endsAt, encode(window));
      this.appendEvent('growth.window.opened', { windowId: window.id, schedulerId: window.schedulerId, maxCalls: window.maxCalls });
      return window;
    });
  }

  /** Trusted continuing scheduler entrypoint. Global debit, optional per-inquiry
   * allocation, and execution claim commit atomically before any provider call.
   * Ordinary updateGrowth cannot invoke this replenishment policy implicitly. */
  claimGrowthInWindow(id: string, windowId: string, atMs = Date.now()): Growth | undefined {
    budget(atMs);
    return this.#atomic(() => {
      const window = this.growthWindow(windowId);
      const old = this.growth(id);
      if (!window || atMs < window.startsAt || atMs >= window.endsAt || window.usedCalls >= window.maxCalls
        || !old || !['queued', 'paused'].includes(old.state)) return undefined;
      const allocation = old.remainingBudget < 1 ? 1 : 0;
      budget(old.budget + allocation);
      const now = new Date().toISOString();
      const growth: Growth = { ...old, budget: old.budget + allocation, remainingBudget: old.remainingBudget + allocation - 1, state: 'running', updatedAt: now };
      const charged: GrowthWindow = { ...window, usedCalls: window.usedCalls + 1, updatedAt: now };
      this.#db.prepare('UPDATE growth_windows SET record = ? WHERE id = ?').run(encode(charged), windowId);
      this.#db.prepare('UPDATE growth SET state = ?, record = ? WHERE id = ?').run(growth.state, encode(growth), id);
      this.appendEvent('growth.window.call_reserved', { windowId, schedulerId: window.schedulerId, growthId: id, dimension: growth.dimension, allocated: allocation, usedCalls: charged.usedCalls });
      return growth;
    });
  }

  growthProposalDelivery(growthId: string): GrowthProposalDelivery | undefined {
    return decode<GrowthProposalDelivery>(this.#db.prepare('SELECT record FROM growth_proposal_deliveries WHERE growth_id = ?').get(growthId));
  }

  /** Reserved means delivery may happen; a crashed callback must be reconciled. */
  reserveGrowthProposal(growthId: string): boolean {
    return this.#atomic(() => {
      if (this.growthProposalDelivery(growthId)) return false;
      if (this.growth(growthId)?.state !== 'completed') throw new Error('Proposal delivery requires a completed inquiry');
      const now = new Date().toISOString();
      const record: GrowthProposalDelivery = { growthId, state: 'reserved', createdAt: now, updatedAt: now };
      this.#db.prepare('INSERT INTO growth_proposal_deliveries(growth_id, record) VALUES (?, ?)').run(growthId, encode(record));
      this.appendEvent('growth.proposal.reserved', { growthId });
      return true;
    });
  }

  settleGrowthProposal(growthId: string, state: 'delivered' | 'uncertain'): GrowthProposalDelivery {
    return this.#atomic(() => {
      const old = this.growthProposalDelivery(growthId);
      if (!old) throw new Error('Proposal delivery has not been reserved');
      if (old.state === state) return old;
      if (old.state === 'delivered') throw new Error('Delivered proposal cannot become uncertain');
      const record: GrowthProposalDelivery = { ...old, state, updatedAt: new Date().toISOString() };
      this.#db.prepare('UPDATE growth_proposal_deliveries SET record = ? WHERE growth_id = ?').run(encode(record), growthId);
      this.appendEvent(`growth.proposal.${state}`, { growthId });
      return record;
    });
  }

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
