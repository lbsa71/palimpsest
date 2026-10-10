import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ConversationOutcome, ConversationReflection, ConversationTopic, ConversationTopicInput } from './conversation-state.ts';
export type { ConversationOutcome, ConversationReflection, ConversationTopic } from './conversation-state.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type TaskState = 'queued' | 'running' | 'waiting_for_provider' | 'succeeded' | 'failed' | 'cancelled';
export interface SlackAuthor { teamId: string; userId: string }
export interface Task {
  id: string; conversationId: string; input: string; source: string; eventId?: string;
  state: TaskState; checkpoint: Json; output: Json; error: string | null;
  createdAt: string; updatedAt: string;
  slackAuthor?: SlackAuthor;
}
export interface TaskInput { id?: string; conversationId: string; input: string; source: string; eventId?: string; slackAuthor?: SlackAuthor }
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
  sourceTaskId?: string;
}
export interface GrowthInput { id?: string; dimension: GrowthDimension; question: string; origin: string; nextStep?: string; budget?: number; sourceTaskId?: string }
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
  readonly persistent: boolean;
  #db: DatabaseSync;
  #transaction = false;
  #transactionScope = new AsyncLocalStorage<{ active: boolean }>();
  #savepoint = 0;
  #closed = false;

  constructor(dbPath: string) {
    required(dbPath, 'Database path');
    this.persistent = dbPath !== ':memory:';
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
      CREATE TABLE IF NOT EXISTS conversation_topics (id TEXT PRIMARY KEY, scope TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_reflections (id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_topic_intents (task_id TEXT NOT NULL, topic_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(task_id, topic_id));
      CREATE TABLE IF NOT EXISTS background_reservations (id TEXT PRIMARY KEY, window_id TEXT NOT NULL);
    `);
  }

  close(): void { this.#assertTransactionScope(); if (!this.#closed) { this.#db.close(); this.#closed = true; } }

  #assertTransactionScope(): void {
    if (this.#transactionScope.getStore()?.active === false) throw new Error('Asynchronous transaction continuation cannot mutate Store');
  }

  /** Trusted synchronous compound writes. A callback must never await; rejected
   * thenables roll back, and their escaped continuations cannot mutate state. */
  transaction<T>(operation: () => T): T {
    this.#assertTransactionScope();
    if (operation.constructor.name === 'AsyncFunction') throw new Error('Store transaction callback must be synchronous');
    const nested = this.#transaction; const savepoint = `public_transaction_${++this.#savepoint}`;
    return this.#atomic(() => {
      if (nested) this.#db.exec(`SAVEPOINT ${savepoint}`);
      const scope = { active: true };
      try {
        const result = this.#transactionScope.run(scope, operation);
        if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result && typeof result.then === 'function') {
          void Promise.resolve(result).catch(() => {});
          throw new Error('Store transaction callback must be synchronous');
        }
        if (nested) this.#db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        if (nested) { this.#db.exec(`ROLLBACK TO ${savepoint}`); this.#db.exec(`RELEASE ${savepoint}`); }
        throw error;
      } finally { scope.active = false; }
    });
  }

  #atomic<T>(operation: () => T): T {
    this.#assertTransactionScope();
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
    if (input.slackAuthor !== undefined && (input.source !== 'slack'
      || !/^[A-Za-z0-9]+$/.test(input.slackAuthor.teamId) || !/^[A-Za-z0-9]+$/.test(input.slackAuthor.userId)
      || !input.conversationId.startsWith(`slack:${input.slackAuthor.teamId}:`))) throw new Error('Invalid Slack author');
    return this.#atomic(() => {
      const existing = input.eventId === undefined ? undefined : decode<Task>(this.#db.prepare('SELECT record FROM tasks WHERE source = ? AND event_id = ?').get(input.source, input.eventId));
      if (existing) {
        if (existing.conversationId !== input.conversationId || existing.input !== input.input || (input.id !== undefined && input.id !== existing.id)) throw new Error('Task delivery idempotency conflict');
        // A retry cannot replace authorship. Legacy anonymous records stay
        // anonymous even when a newly normalized retry supplies an author.
        if (existing.slackAuthor && (existing.slackAuthor.teamId !== input.slackAuthor?.teamId
          || existing.slackAuthor.userId !== input.slackAuthor?.userId)) throw new Error('Task author idempotency conflict');
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

  claimNext(filter: { excludeSources?: string[] } = {}): Task | undefined {
    const excluded = filter.excludeSources ?? [];
    for (const source of excluded) required(source, 'Excluded task source');
    return this.#atomic(() => {
      const row = this.#db.prepare(`SELECT record FROM tasks WHERE state = 'queued'${excluded.length ? ` AND source NOT IN (${excluded.map(() => '?').join(',')})` : ''} AND NOT EXISTS (SELECT 1 FROM effects WHERE effects.task_id = tasks.id AND effects.state IN ('reserved', 'unknown')) ORDER BY rowid LIMIT 1`).get(...excluded);
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
    this.#assertTransactionScope();
    required(type, 'Event type');
    const createdAt = new Date().toISOString();
    const result = this.#db.prepare('INSERT INTO journal(type, task_id, payload, created_at) VALUES (?, ?, ?, ?)').run(type, taskId ?? null, encode(payload), createdAt);
    return { seq: Number(result.lastInsertRowid), type, taskId: taskId ?? null, payload, createdAt };
  }

  /** Select before decoding payloads; omitted selectors retain the complete audit.
   * Selectors require well-formed Unicode so UTF-8 conversion cannot change them.
   * Prefix comparison is literal and case-sensitive; NUL prefixes are refused
   * because SQLite's text decoding does not retain embedded NUL suffixes. */
  listEvents(filter: { after?: number; taskId?: string; types?: readonly string[]; typePrefix?: string } = {}): JournalEvent[] {
    if (filter.types !== undefined && (!Array.isArray(filter.types) || filter.types.some(type => typeof type !== 'string')))
      throw new Error('Journal event types must be strings');
    if (filter.types?.some(type => !type.isWellFormed())) throw new Error('Journal event types must be well-formed Unicode');
    if (filter.typePrefix !== undefined && (typeof filter.typePrefix !== 'string' || filter.typePrefix.includes('\0'))) throw new Error('Journal event prefix must be a string without NUL');
    if (filter.typePrefix !== undefined && !filter.typePrefix.isWellFormed()) throw new Error('Journal event prefix must be well-formed Unicode');
    if (filter.types?.length === 0) return [];
    const clauses = ['seq > ?']; const parameters: Array<string | number> = [filter.after ?? 0];
    if (filter.taskId !== undefined) { clauses.push('task_id = ?'); parameters.push(filter.taskId); }
    if (filter.types !== undefined) {
      const types = [...new Set(filter.types)];
      clauses.push(`type COLLATE BINARY IN (${types.map(() => '?').join(',')})`); parameters.push(...types);
    }
    if (filter.typePrefix !== undefined) {
      clauses.push('substr(type, 1, length(?)) COLLATE BINARY = ?'); parameters.push(filter.typePrefix, filter.typePrefix);
    }
    const rows = this.#db.prepare(`SELECT * FROM journal WHERE ${clauses.join(' AND ')} ORDER BY seq`).all(...parameters);
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
    const withdrawContexts = (sourceId: string) => {
      for (const intent of this.#conversationIntents()) if (intent.scope === scope && intent.sourceRefs.some(ref => ref.id === sourceId)) {
        const withdrawn = { ...intent, state: 'invalidated' as const, outcome: { question: 'Prior conversation context is no longer current.', stance: 'No current conclusion is retained.', rationale: 'Source corrected or forgotten before exchange completion.', unresolved: [], status: 'settled' as const } };
        this.#writeConversationIntent(intent.sourceTaskIds.at(-1)!, withdrawn);
        if (intent.reflectionId) { const reflection = this.conversationReflection(intent.reflectionId)!; this.#writeReflection({ ...reflection, question: 'Source context withdrawn.', state: 'cancelled', checkpoint: { reason: 'source_withdrawn' } }); }
      }
      for (const topic of this.listConversationTopics(scope)) if (topic.memoryId === sourceId || topic.sourceRefs.some(ref => ref.id === sourceId)) {
        this.invalidateConversationTopic(topic.id, 'Source corrected or forgotten; prior interpretation withdrawn.');
      }
    };
    const pending = [id]; const seen = new Set(pending);
    for (const sourceId of pending) {
      withdrawContexts(sourceId);
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

  memorySourceRefs(id: string, scope: string): MemorySourceRef[] {
    return this.#db.prepare('SELECT source_id, source_version FROM memory_source_refs WHERE scope = ? AND memory_id = ?').all(scope, id)
      .map(row => ({ id: String(row.source_id), version: Number(row.source_version) }));
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

  conversationTopic(id: string): ConversationTopic | undefined {
    return decode<ConversationTopic>(this.#db.prepare('SELECT record FROM conversation_topics WHERE id = ?').get(id));
  }

  listConversationTopics(scope?: string): ConversationTopic[] {
    return (scope === undefined ? this.#db.prepare('SELECT record FROM conversation_topics ORDER BY rowid').all()
      : this.#db.prepare('SELECT record FROM conversation_topics WHERE scope = ? ORDER BY rowid').all(scope)).map(row => decode<ConversationTopic>(row)!);
  }

  #writeTopic(topic: ConversationTopic): ConversationTopic {
    this.#db.prepare('INSERT INTO conversation_topics(id, scope, record) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record')
      .run(topic.id, topic.scope, encode(topic)); return topic;
  }
  #writeConversationIntent(taskId: string, topic: ConversationTopic): void {
    this.#db.prepare('INSERT INTO conversation_topic_intents(task_id, topic_id, record) VALUES (?, ?, ?) ON CONFLICT(task_id, topic_id) DO UPDATE SET record = excluded.record').run(taskId, topic.id, encode(topic));
  }
  #conversationIntents(taskId?: string): ConversationTopic[] {
    return (taskId === undefined ? this.#db.prepare('SELECT record FROM conversation_topic_intents').all()
      : this.#db.prepare('SELECT record FROM conversation_topic_intents WHERE task_id = ?').all(taskId)).map(row => decode<ConversationTopic>(row)!);
  }
  conversationAwaitingExchange(topicId: string): boolean {
    return this.#conversationIntents().some(intent => intent.id === topicId && ['running', 'queued', 'waiting_for_provider'].includes(this.task(intent.sourceTaskIds.at(-1)!)?.state ?? ''));
  }

  /** Retain tentative exchange evidence, but a terminal unaccepted parent cannot
   * leave an executable inquiry behind. Delivery reconciliation remains separate. */
  reconcileConversationIntents(): void {
    for (const intent of this.#conversationIntents()) {
      const parent = this.task(intent.sourceTaskIds.at(-1)!); const current = this.conversationTopic(intent.id);
      if (!intent.reflectionId || !parent || !['succeeded', 'failed', 'cancelled'].includes(parent.state)) continue;
      if (parent.state === 'succeeded' && current?.state === 'active' && current.reflectionId === intent.reflectionId) continue;
      this.cancelConversationReflection(intent.reflectionId, 'tentative_exchange_not_current');
    }
  }

  /** Host-bound admission precedes the external acknowledgment. A replay of the
   * same task never increments a revision or creates a second inquiry. */
  prepareConversationTopics(taskId: string, inputs: ConversationTopicInput[], sourceRefs: MemorySourceRef[], options: { now: number; reviewMs: number; lifetimeMs: number; maxAttempts: number }): ConversationTopic[] {
    return this.#atomic(() => {
      const task = this.task(taskId); if (!task || task.state !== 'running') throw new Error('Outcome requires a running exchange');
      const saved = this.listEvents({ types: ['conversation.outcomes.prepared'], taskId }).find(event => event.type === 'conversation.outcomes.prepared' && event.taskId === taskId);
      if (saved) return this.#conversationIntents(taskId);
      if (sourceRefs.some(ref => this.memory(ref.id, task.conversationId)?.version !== ref.version)) throw new Error('Outcome sources changed before admission');
      const origins = new Map<string, Task>();
      const visit = (ref: MemorySourceRef, seen = new Set<string>()): void => {
        if (seen.has(ref.id)) return; seen.add(ref.id);
        const memory = this.memory(ref.id, task.conversationId); if (!memory || memory.version !== ref.version) throw new Error('Outcome provenance changed');
        if (memory.kind === 'episodic' && memory.source.startsWith('task:')) {
          const origin = this.task(memory.source.slice(5)); if (origin?.conversationId === task.conversationId) origins.set(origin.id, origin);
        }
        for (const parent of this.memorySourceRefs(memory.id, task.conversationId)) visit(parent, seen);
      };
      sourceRefs.forEach(ref => visit(ref)); origins.set(taskId, task);
      const topics = inputs.map((input, index) => {
        const old = input.topicId ? this.conversationTopic(input.topicId) : undefined;
        if (input.topicId && (!old || old.scope !== task.conversationId || old.source !== task.source || old.state !== 'active' || old.revision !== input.expectedRevision)) throw new Error('Unknown current scoped topic revision');
        const progress = task.checkpoint && typeof task.checkpoint === 'object' && !Array.isArray(task.checkpoint) ? task.checkpoint : {};
        const id = old?.id ?? `topic:${taskId}:${index}`; const revision = (old?.revision ?? 0) + 1;
        const now = new Date().toISOString();
        const topic: ConversationTopic = { id, scope: task.conversationId, source: task.source,
          originalTaskId: old?.originalTaskId ?? taskId, replyTo: old?.replyTo ?? (typeof progress.replyTo === 'string' ? progress.replyTo : null),
          sourceTaskIds: [...new Set([...(old?.sourceTaskIds ?? []), ...origins.keys()])],
          sourceRefs,
          participants: [...new Map([...(old?.participants ?? []), ...[...origins.values()].map(origin => ({ taskId: origin.id, source: origin.source, slackAuthor: origin.slackAuthor ?? null }))].map(participant => [participant.taskId, participant])).values()],
          state: 'prepared', revision, outcome: input.outcome, memoryId: null,
          reflectionId: input.reflectionQuestion && task.source !== 'peer' ? `reflection:${id}:${revision}` : null,
          nextReviewAt: options.now + options.reviewMs, expiresAt: options.now + options.lifetimeMs,
          report: { owedRevision: old?.report.waived ? null : input.outcome.status === 'pending' || old?.report.owedRevision !== null && old !== undefined ? revision : null,
            waived: old?.report.waived ?? false,
            lastReportedRevision: old?.report.lastReportedRevision ?? 0, taskId: old?.report.taskId ?? null,
            revision: old?.report.revision ?? null, kind: old?.report.kind ?? null, effectId: old?.report.effectId ?? null,
            delivery: old?.report.delivery ?? 'pending', receipt: old?.report.receipt ?? null },
          createdAt: old?.createdAt ?? now, updatedAt: now };
        // Tentative input cannot replace a confirmed outcome or erase its owed
        // report. Pause old thought until acknowledgment resolves; do not refund.
        if (old?.reflectionId) this.updateConversationReflection(old.reflectionId, { state: 'paused', checkpoint: { reason: 'awaiting_continuation_delivery' } });
        if (topic.reflectionId) this.#writeReflection({ id: topic.reflectionId, topicId: id, scope: task.conversationId,
          question: input.reflectionQuestion!, sourceRefs: topic.sourceRefs, sourceTaskIds: topic.sourceTaskIds,
          maxAttempts: options.maxAttempts, attempts: 0, state: 'waiting', checkpoint: { phase: 'awaiting_exchange' }, updatedAt: now });
        this.#writeConversationIntent(taskId, topic);
        if (!old) this.#writeTopic(topic);
        return topic;
      });
      this.appendEvent('conversation.outcomes.prepared', { topicIds: topics.map(topic => topic.id) }, taskId); return topics;
    });
  }

  /** Confirmed exchange, raw episode, interpreted outcome and inquiry activation
   * share one SQLite transaction. Unknown/rejected delivery cannot activate it. */
  finishConversationTask(id: string, output: Json, episode: MemoryInput): Task {
    return this.#atomic(() => {
      const task = this.task(id); if (!task || task.state !== 'running' || this.#unresolved(id)) throw new Error('Conversation requires a running reconciled exchange');
      const progress = task.checkpoint && typeof task.checkpoint === 'object' && !Array.isArray(task.checkpoint) ? task.checkpoint : {};
      const captured = Array.isArray(progress.conversationSourceRefs) ? progress.conversationSourceRefs as unknown as MemorySourceRef[] : [];
      const intents = this.#conversationIntents(id);
      const stale = (intent: ConversationTopic): boolean => {
        const current = this.conversationTopic(intent.id);
        return intent.originalTaskId !== id && (!current || current.state !== 'active' || current.revision !== intent.revision - 1);
      };
      const sourcesCurrent = captured.every(ref => this.memory(ref.id, task.conversationId)?.version === ref.version) && !intents.some(stale);
      // An actually delivered reply is still operational evidence. Its stale
      // assertions cannot become new independent memory after source withdrawal.
      const safeEpisode = sourcesCurrent ? episode : { ...episode, content: JSON.stringify({ user: task.input,
        response: 'Response withdrawn from retrieval because its source context changed before exchange completion.', slackAuthor: task.slackAuthor ?? null,
        note: 'Physical task output/effect retains the actual delivery observation; no stale generated assertion is republished.' }) };
      const source = (sourcesCurrent && captured.length ? this.publishMemoryFromSourcesOnce({ ...safeEpisode, publicationId: `exchange:${id}`, sourceRefs: captured })
        : this.publishMemoryOnce({ ...safeEpisode, publicationId: `exchange:${id}` })).memory;
      if (!source) throw new Error('Exchange was forgotten');
      for (const intent of intents) {
        const current = this.conversationTopic(intent.id)!;
        const conflict = stale(intent);
        const topic = { ...intent, id: conflict ? `${intent.id}:withdrawn:${id}` : intent.id,
          originalTaskId: conflict ? id : intent.originalTaskId, revision: conflict ? 1 : intent.revision,
          report: { ...intent.report, lastReportedRevision: current.report.lastReportedRevision,
            waived: current.report.waived, owedRevision: current.report.waived ? null : intent.report.owedRevision,
            taskId: current.report.taskId, revision: current.report.revision, kind: current.report.kind, effectId: current.report.effectId, delivery: current.report.delivery, receipt: current.report.receipt } };
        if (conflict) topic.report = { owedRevision: current.report.waived || intent.report.owedRevision === null ? null : 1, waived: current.report.waived,
          lastReportedRevision: 0, taskId: null, revision: null, kind: null, effectId: null, delivery: 'pending', receipt: null };
        if (!conflict && current.reflectionId && current.reflectionId !== topic.reflectionId) this.cancelConversationReflection(current.reflectionId, 'superseded_by_confirmed_exchange');
        if (!sourcesCurrent || topic.state === 'invalidated') {
          if (topic.reflectionId) this.cancelConversationReflection(topic.reflectionId, 'exchange_context_withdrawn');
          this.#writeTopic({ ...topic, state: 'invalidated', sourceRefs: [{ id: source.id, version: source.version }], memoryId: null,
            report: { ...topic.report, owedRevision: topic.report.owedRevision === null ? null : topic.revision },
            outcome: { question: 'Prior conversation context is no longer current.', stance: 'No current conclusion is retained.', rationale: 'Source or topic revision changed before exchange completion.', unresolved: [], status: 'settled' } });
          continue;
        }
        const sourceRefs = [{ id: source.id, version: source.version }];
        const memory = this.publishMemoryFromSourcesOnce({ publicationId: `outcome:${topic.id}:${topic.revision}`, scope: topic.scope, kind: 'autobiographical',
          source: `conversation-outcome:${topic.id}`, confidence: 0.6, evidence: sourceRefs.map(ref => ref.id), sourceRefs,
          content: JSON.stringify({ note: 'Unverified conversational interpretation, not authority or a verified fact.', topicId: topic.id, revision: topic.revision, ...topic.outcome }) }).memory;
        this.#writeTopic({ ...topic, sourceRefs, state: 'active', memoryId: memory?.id ?? null,
          report: { ...topic.report, owedRevision: topic.report.owedRevision === null ? null : topic.revision }, updatedAt: new Date().toISOString() });
        if (topic.reflectionId) {
          const reflection = this.conversationReflection(topic.reflectionId)!;
          this.#writeReflection({ ...reflection, sourceRefs: [...intent.sourceRefs, ...sourceRefs], checkpoint: { phase: 'ready' } });
        }
      }
      return this.updateTask(id, { state: 'succeeded', output, error: null });
    });
  }

  conversationSourcesCurrent(topic: Pick<ConversationTopic, 'scope' | 'sourceRefs' | 'sourceTaskIds' | 'source'>): boolean {
    return topic.sourceRefs.length > 0 && topic.sourceRefs.every(ref => this.memory(ref.id, topic.scope)?.version === ref.version)
      && topic.sourceTaskIds.every(id => { const task = this.task(id); return task?.conversationId === topic.scope && task.state === 'succeeded' && this.taskSourceCurrent(id); });
  }
  taskSourceCurrent(id: string): boolean {
    const task = this.task(id);
    return !!task && !this.listEvents({ types: ['task.corrected'] }).some(event => event.type === 'task.corrected' && (event.payload as Record<string, Json>).originalId === id);
  }
  recordTaskCorrection(originalId: string, replacementId: string, commandId: string): void {
    this.#atomic(() => {
      const task = this.task(originalId); const replacement = this.task(replacementId);
      if (!task || replacement?.conversationId !== task.conversationId) throw new Error('Correction requires same-scope stored tasks');
      this.appendEvent('task.corrected', { originalId, replacementId }, commandId);
      for (const memory of this.listMemories(task.conversationId).filter(value => value.kind === 'episodic' && value.source === `task:${originalId}`)) {
        this.correctMemory(memory.id, memory.scope, { content: JSON.stringify({ note: 'Superseded exchange; original task/effect history is preserved outside current retrieval.', replacementTaskId: replacementId, correctionTaskId: commandId }), source: memory.source, confidence: 1 });
      }
      for (const topic of this.listConversationTopics(task.conversationId).filter(value => value.sourceTaskIds.includes(originalId))) this.invalidateConversationTopic(topic.id, 'Original source task was explicitly corrected.');
    });
  }

  confirmCancelledConversation(taskId: string): void {
    this.#atomic(() => {
      const task = this.task(taskId); const effect = this.effect(`${taskId}:result`);
      if (task?.state !== 'cancelled' || effect?.state !== 'completed' || (effect.result as { delivered?: boolean } | null)?.delivered !== true) return;
      for (const intent of this.#conversationIntents(taskId)) {
        const current = this.conversationTopic(intent.id)!;
        const separate = intent.originalTaskId !== taskId; const id = separate ? `${intent.id}:cancelled:${taskId}` : intent.id;
        if (this.conversationTopic(id)?.state === 'invalidated' && this.conversationTopic(id)?.outcome.rationale === 'Explicit cancellation after confirmed acknowledgment.') continue;
        if (intent.reflectionId) this.cancelConversationReflection(intent.reflectionId, 'explicit_cancellation');
        this.#writeTopic({ ...intent, id, originalTaskId: taskId, state: 'invalidated', revision: separate ? 1 : intent.revision, speech: null,
          reflectionId: null, memoryId: null, outcome: { question: 'Cancelled deferred topic.', stance: 'No further conclusion is claimed.', rationale: 'Explicit cancellation after confirmed acknowledgment.', unresolved: [], status: 'settled' },
          report: { ...intent.report, waived: current.report.waived, owedRevision: current.report.waived || intent.report.owedRevision === null ? null : separate ? 1 : intent.revision,
            lastReportedRevision: 0, taskId: null, revision: null, kind: null, effectId: null, delivery: 'pending', receipt: null } });
      }
    });
  }

  /** Source invalidation removes interpretation text from current registry state.
   * The owed return survives; old prepared text is rejected before delivery. */
  invalidateConversationTopic(id: string, reason: string): ConversationTopic {
    return this.#atomic(() => {
      const old = this.conversationTopic(id); if (!old) throw new Error('Topic not found');
      if (old.state === 'invalidated') return old;
      if (old.reflectionId) {
        const reflection = this.conversationReflection(old.reflectionId);
        if (reflection) this.#writeReflection({ ...reflection, question: 'Source context withdrawn.', state: 'cancelled', checkpoint: { reason } });
      }
      const revision = old.revision + 1;
      const topic = this.#writeTopic({ ...old, state: 'invalidated', revision, memoryId: null, speech: null,
        outcome: { question: 'Prior conversation context is no longer current.', stance: 'No current conclusion is retained.', rationale: reason, unresolved: [], status: 'settled' },
        report: { ...old.report, owedRevision: old.report.owedRevision === null ? null : revision }, updatedAt: new Date().toISOString() });
      this.appendEvent('conversation.topic.invalidated', { topicId: id, reason }); return topic;
    });
  }

  reviseConversationOutcome(id: string, outcome: ConversationOutcome, now: number, reason: string): ConversationTopic {
    return this.#atomic(() => {
      const old = this.conversationTopic(id); if (!old || old.state !== 'active' || !this.conversationSourcesCurrent(old)) throw new Error('Current outcome sources required');
      const revision = old.revision + 1;
      const result = this.publishMemoryFromSourcesOnce({ publicationId: `outcome:${id}:${revision}`, scope: old.scope, kind: 'autobiographical',
        source: `conversation-outcome:${id}`, confidence: 0.6, evidence: old.sourceRefs.map(ref => ref.id), sourceRefs: old.sourceRefs,
        content: JSON.stringify({ note: 'Unverified conversational interpretation; no source action authority.', topicId: id, revision, priorStance: old.outcome.stance, ...outcome }) });
      const topic = this.#writeTopic({ ...old, revision, outcome, speech: null, memoryId: result.memory?.id ?? null, nextReviewAt: now,
        report: { ...old.report, owedRevision: old.report.waived || old.report.owedRevision === null && outcome.status === 'settled' ? null : revision }, updatedAt: new Date().toISOString() });
      this.appendEvent('conversation.outcome.revised', { topicId: id, revision, reason }); return topic;
    });
  }

  prepareConversationReport(id: string, text: string, kind: 'holding' | 'final', nextReviewAt: number, basis: 'outcome' | 'awaiting_exchange' = 'outcome', speechKind: 'host_notice' | 'say' = 'host_notice'): Task | undefined {
    return this.#atomic(() => {
      const topic = this.conversationTopic(id); if (!topic || topic.report.waived || topic.report.owedRevision === null) return;
      const prior = topic.report.taskId ? this.task(topic.report.taskId) : undefined;
      const priorInfo = prior ? this.listEvents({ types: ['conversation.report.prepared'] }).find(event => event.type === 'conversation.report.prepared' && (event.payload as Record<string, Json>).reportTaskId === prior.id) : undefined;
      const sameBasis = (priorInfo?.payload as Record<string, Json> | undefined)?.basis === basis;
      if (topic.report.revision === topic.revision && topic.report.kind === kind && topic.report.delivery === 'delivered' && sameBasis) return prior;
      const retryWithoutEffect = prior?.state === 'cancelled' && this.effect(`${prior.id}:result`) === undefined;
      if (topic.report.revision === topic.revision && topic.report.taskId && topic.report.delivery !== 'delivered' && !retryWithoutEffect) return prior;
      const original = this.task(topic.originalTaskId); if (!original) throw new Error('Original topic task is absent');
      const attempt = this.listEvents({ types: ['conversation.report.prepared'] }).filter(event => event.type === 'conversation.report.prepared' && (event.payload as Record<string, Json>).topicId === id
        && (event.payload as Record<string, Json>).revision === topic.revision && (event.payload as Record<string, Json>).kind === kind).length;
      const eventId = `${id}:report:${topic.revision}:${kind}:${attempt}`;
      const task = this.enqueuePreparedReply({ source: topic.source, conversationId: topic.scope, eventId, input: `Host-observed ${kind} conversation outcome report`,
        ...(original.slackAuthor ? { slackAuthor: original.slackAuthor } : {}) }, text, topic.replyTo ?? undefined, speechKind);
      this.#writeTopic({ ...topic, nextReviewAt, report: { ...topic.report, taskId: task.id, revision: topic.revision, kind,
        effectId: `${task.id}:result`, delivery: 'pending', receipt: null }, updatedAt: new Date().toISOString() });
      this.appendEvent('conversation.report.prepared', { topicId: id, revision: topic.revision, kind, reportTaskId: task.id, basis,
        speechProtocol: 'prepared-speech/1', speechKind }); return task;
    });
  }

  acknowledgeConversationReport(id: string, reportTaskId: string): ConversationTopic {
    return this.#atomic(() => {
      const topic = this.conversationTopic(id); if (!topic) throw new Error('Topic not found');
      const prepared = this.listEvents({ types: ['conversation.report.prepared'] }).find(event => event.type === 'conversation.report.prepared' && (event.payload as Record<string, Json>).reportTaskId === reportTaskId);
      const info = prepared?.payload as { topicId: string; revision: number; kind: string } | undefined;
      if (!info || info.topicId !== id) throw new Error('Report does not belong to topic');
      const effect = this.effect(`${reportTaskId}:result`);
      const delivered = effect?.state === 'completed' && effect.result !== null && typeof effect.result === 'object' && !Array.isArray(effect.result) && effect.result.delivered === true;
      const rejected = effect?.state === 'completed' && !delivered;
      const current = topic.report.taskId === reportTaskId;
      const closes = delivered && info.kind === 'final' && info.revision === topic.revision && topic.outcome.status === 'settled';
      return this.#writeTopic({ ...topic, report: { ...topic.report,
        ...(delivered ? { lastReportedRevision: Math.max(topic.report.lastReportedRevision, info.revision) } : {}),
        ...(closes ? { owedRevision: null } : {}), ...(current ? { delivery: delivered ? 'delivered' : rejected ? 'rejected' : effect ? 'unknown' : 'pending', receipt: effect?.result ?? null } : {}) } });
    });
  }

  waiveConversationReport(id: string, reason: string): void {
    required(reason, 'Explicit notification waiver reason'); const topic = this.conversationTopic(id); if (!topic) throw new Error('Topic not found');
    this.#atomic(() => { this.#writeTopic({ ...topic, report: { ...topic.report, owedRevision: null, waived: true } }); this.appendEvent('conversation.report.waived', { topicId: id, reason }); });
  }

  conversationReflection(id: string): ConversationReflection | undefined { return decode<ConversationReflection>(this.#db.prepare('SELECT record FROM conversation_reflections WHERE id = ?').get(id)); }
  listConversationReflections(): ConversationReflection[] { return this.#db.prepare('SELECT record FROM conversation_reflections ORDER BY rowid').all().map(row => decode<ConversationReflection>(row)!); }
  #writeReflection(value: ConversationReflection): ConversationReflection {
    this.#db.prepare('INSERT INTO conversation_reflections(id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record').run(value.id, encode(value)); return value;
  }
  updateConversationReflection(id: string, patch: Pick<ConversationReflection, 'state' | 'checkpoint'>): ConversationReflection {
    return this.#atomic(() => {
      const old = this.conversationReflection(id); if (!old) throw new Error('Reflection not found');
      if (['completed', 'cancelled', 'rejected'].includes(old.state)) return old;
      return this.#writeReflection({ ...old, ...patch, updatedAt: new Date().toISOString() });
    });
  }
  completeConversationReflection(id: string, expectedRevision: number, outcome: ConversationOutcome, now: number, evidence: Json, sayText?: string): void {
    this.#atomic(() => {
      const item = this.conversationReflection(id); const topic = item ? this.conversationTopic(item.topicId) : undefined;
      if (!item || item.state !== 'running' || !topic || topic.state !== 'active' || topic.revision !== expectedRevision
        || now >= topic.expiresAt || topic.reflectionId !== id || !this.conversationSourcesCurrent(topic)) throw new Error('Reflection context changed or expired before publication');
      if (sayText !== undefined) {
        required(sayText, 'Explicit follow-up say');
        if (sayText.length > 8000) throw new Error('Follow-up say exceeds bound');
        if (Buffer.from(sayText, 'utf8').toString('utf8') !== sayText) throw new Error('Invalid Unicode in follow-up say');
      }
      const revised = this.reviseConversationOutcome(topic.id, outcome, now, 'reflection_result');
      if (sayText !== undefined) {
        this.#writeTopic({ ...revised, speech: { version: 'conversation-say/1', revision: revised.revision, text: sayText,
          sourceRefs: revised.sourceRefs, sourceTaskIds: revised.sourceTaskIds } });
        this.appendEvent('conversation.reflection.say.admitted', { topicId: revised.id, revision: revised.revision, reflectionId: id });
      }
      this.updateConversationReflection(id, { state: 'completed', checkpoint: { evidence, outcomeRevision: revised.revision } });
    });
  }
  cancelConversationReflection(id: string, reason: string): ConversationReflection {
    return this.updateConversationReflection(id, { state: 'cancelled', checkpoint: { reason } });
  }
  recoverConversationReflections(): void {
    for (const item of this.listConversationReflections().filter(value => value.state === 'running')) this.updateConversationReflection(item.id, { state: 'paused', checkpoint: { reason: 'interrupted' } });
  }
  claimConversationReflection(id: string, windowId: string, atMs: number): ConversationReflection | undefined {
    return this.#atomic(() => {
      const item = this.conversationReflection(id); const topic = item ? this.conversationTopic(item.topicId) : undefined; const window = this.growthWindow(windowId);
      if (!item || !topic || topic.state !== 'active' || topic.reflectionId !== id || !this.conversationSourcesCurrent(topic)
        || atMs >= topic.expiresAt
        || topic.outcome.status !== 'pending'
        || this.conversationAwaitingExchange(topic.id)
        || !['waiting', 'paused'].includes(item.state) || item.attempts >= item.maxAttempts || !window || atMs < window.startsAt || atMs >= window.endsAt || window.usedCalls >= window.maxCalls
        || !this.backgroundTurn(windowId, 'reflection', atMs)) return;
      const attemptId = `${id}:attempt:${item.attempts + 1}`;
      this.#db.prepare('INSERT INTO background_reservations(id, window_id) VALUES (?, ?)').run(attemptId, windowId);
      this.#db.prepare('UPDATE growth_windows SET record = ? WHERE id = ?').run(encode({ ...window, usedCalls: window.usedCalls + 1, updatedAt: new Date().toISOString() }), windowId);
      const claimed = this.#writeReflection({ ...item, state: 'running', attempts: item.attempts + 1, checkpoint: { attemptId }, updatedAt: new Date().toISOString() });
      this.appendEvent('conversation.reflection.call_reserved', { reflectionId: id, windowId, schedulerId: window.schedulerId, attemptId }); return claimed;
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

  /** The trusted conversation coordinator has already validated author policy
   * and the structured decision. Commit provenance/outcome together; no inquiry
   * call is invented or allocated for this already completed task inference. */
  recordConversationProposal(taskId: string, outcome: Json): Growth {
    return this.#atomic(() => {
      const task = this.task(taskId);
      if (!task) throw new Error('Conversation proposal requires a stored task');
      const id = `conversation:${task.id}`;
      const old = this.growth(id);
      if (old) {
        if (old.sourceTaskId !== task.id || encode(old.outcome) !== encode(outcome)) throw new Error('Conversation proposal identity conflict');
        return old;
      }
      this.addGrowth({ id, dimension: 'code_quality', question: task.input,
        origin: id, sourceTaskId: task.id, budget: 0 });
      return this.updateGrowth(id, { state: 'completed', outcome,
        nextStep: 'Await independently evaluated, source-authorized succession.' });
    });
  }

  /** Prepared host notices and explicit model speech retain the ordinary durable
   * communication/effect/reconciliation path. Never exposed in transport JSON. */
  enqueuePreparedReply(input: TaskInput, answer: string, replyTo?: string, kind: 'host_notice' | 'say' = 'host_notice'): Task {
    return this.#atomic(() => {
      const task = this.enqueue(input);
      if (task.checkpoint !== null) return task;
      return this.updateTask(task.id, { checkpoint: { calls: 0, answer, replyTo: replyTo ?? null,
        preparedSpeech: { version: 'prepared-speech/1', kind } } });
    });
  }
  listGrowth(): Growth[] { return this.#db.prepare('SELECT record FROM growth ORDER BY rowid').all().map(row => decode<Growth>(row)!); }

  growthWindow(id: string): GrowthWindow | undefined {
    return decode<GrowthWindow>(this.#db.prepare('SELECT record FROM growth_windows WHERE id = ?').get(id));
  }

  /** Durable kind fairness when coding joins the existing background lane.
   * Successful reservations, including legacy reservations, advance the turn.
   * A continuously eligible kind waits at most two other successful debits. */
  backgroundTurn(windowId: string, kind: 'growth' | 'reflection' | 'coding', atMs: number): boolean {
    const window = this.growthWindow(windowId); if (!window) return false;
    const object = (value: Json): Record<string, Json> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sessions = new Map<string, Record<string, Json>>(); const events = this.listEvents({ types: ['coding.session.admitted', 'coding.session.updated', 'coding.request.reserved', 'coding.initial_call.linked', 'growth.window.call_reserved', 'conversation.reflection.call_reserved', 'coding.window.call_reserved'] });
    for (const event of events) if (['coding.session.admitted', 'coding.session.updated'].includes(event.type)) {
      const session = object(object(event.payload).session); if (typeof session.id === 'string') sessions.set(session.id, session);
    }
    const coding = [...sessions.values()].some(session => {
      const contract = object(session.contract); const lane = object(contract.lane);
      const limits = object(contract.limits);
      const charges = events.filter(event => event.type === 'coding.request.reserved').map(event => object(object(event.payload).reservation));
      const initial = events.filter(event => event.type === 'coding.initial_call.linked').map(event => object(event.payload));
      const available = (field: string, id: Json, limit: Json) => typeof limit === 'number'
        && charges.filter(charge => charge[field] === id).length + initial.filter(charge => charge[field] === id).length < limit;
      return session.version === 'coding-state/1' && lane.kind === 'growth' && lane.schedulerId === window.schedulerId
        && typeof lane.maxCalls === 'number' && lane.maxCalls > 0
        && available('sessionId', session.id, limits.maxSessionCalls) && available('workRootId', contract.workRootId, limits.maxWorkCalls)
        && available('attemptId', contract.attemptId, limits.maxAttemptCalls)
        && typeof contract.expiresAt === 'number' && contract.expiresAt > atMs
        && (session.state === 'ready' || session.state === 'paused' && typeof session.nextEligibleAt === 'number' && session.nextEligibleAt <= atMs
          || session.state === 'running' && ['model-intended', 'request-intended'].includes(String(session.phase)));
    });
    // Legacy schedules remain unchanged until a coding consumer is eligible.
    if (!coding && kind !== 'coding') return true;
    const eligible: Array<'growth' | 'reflection' | 'coding'> = [];
    if (this.listGrowth().some(item => ['queued', 'paused'].includes(item.state))) eligible.push('growth');
    if (this.listConversationReflections().some(item => {
      const topic = this.conversationTopic(item.topicId);
      return ['waiting', 'paused'].includes(item.state) && item.attempts < item.maxAttempts && topic?.state === 'active'
        && topic.reflectionId === item.id && topic.outcome.status === 'pending' && atMs < topic.expiresAt
        && !this.conversationAwaitingExchange(topic.id) && this.conversationSourcesCurrent(topic);
    })) eligible.push('reflection');
    if (coding || kind === 'coding') eligible.push('coding');
    if (!eligible.includes(kind)) return false;
    const last = new Map<string, number>();
    for (const event of events) {
      if (object(event.payload).schedulerId !== window.schedulerId) continue;
      const consumer = event.type === 'growth.window.call_reserved' ? 'growth' : event.type === 'conversation.reflection.call_reserved' ? 'reflection' : event.type === 'coding.window.call_reserved' ? 'coding' : undefined;
      if (consumer) last.set(consumer, event.seq);
    }
    // Match the existing scheduler's reflection-first initial tie. Choosing a
    // different tie would veto its only attempted claim and stall both owners.
    const initialOrder = { reflection: 0, growth: 1, coding: 2 };
    eligible.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0) || initialOrder[a] - initialOrder[b]);
    return eligible[0] === kind;
  }

  /** Coding uses the actual existing background window, never a parallel pool.
   * Caller atomically persists the matching request intent in the same transaction. */
  reserveCodingInGrowthWindow(reservationId: string, windowId: string, atMs: number): boolean {
    required(reservationId, 'Coding reservation ID'); budget(atMs);
    return this.#atomic(() => {
      if (this.#db.prepare('SELECT id FROM background_reservations WHERE id = ?').get(reservationId)) return false;
      const window = this.growthWindow(windowId);
      if (!window || atMs < window.startsAt || atMs >= window.endsAt || window.usedCalls >= window.maxCalls || !this.backgroundTurn(windowId, 'coding', atMs)) return false;
      this.#db.prepare('INSERT INTO background_reservations(id, window_id) VALUES (?, ?)').run(reservationId, windowId);
      this.#db.prepare('UPDATE growth_windows SET record = ? WHERE id = ?').run(encode({ ...window, usedCalls: window.usedCalls + 1, updatedAt: new Date().toISOString() }), windowId);
      this.appendEvent('coding.window.call_reserved', { reservationId, windowId, schedulerId: window.schedulerId }); return true;
    });
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
        || !old || !['queued', 'paused'].includes(old.state) || !this.backgroundTurn(windowId, 'growth', atMs)) return undefined;
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
