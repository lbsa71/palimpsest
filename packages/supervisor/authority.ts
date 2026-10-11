import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Authority } from '../contracts/index.ts';

export type ServingAuthority = Authority;
export interface AuthorityState {
  epoch: number;
  generation: string | null;
  controlRevision: string;
  artifactId: string;
}

/** Host-owned ledger. Workers receive a grant, never the database path or handle. */
export class AuthorityStore {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error('Authority database requires an absolute external state path');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS authority (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch INTEGER NOT NULL,
        generation TEXT, control_revision TEXT NOT NULL, artifact_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_events (
        epoch INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL
      );`);
  }
  close(): void { this.#db.close(); }
  current(): AuthorityState | undefined {
    const row = this.#db.prepare('SELECT epoch,generation,control_revision,artifact_id FROM authority WHERE singleton=1').get();
    return row ? { epoch: Number(row.epoch), generation: row.generation as string | null,
      controlRevision: String(row.control_revision), artifactId: String(row.artifact_id) } : undefined;
  }
  bootstrap(generation: string, controlRevision: string, artifactId: string): ServingAuthority {
    this.#nonempty(generation, controlRevision, artifactId);
    return this.#transaction(() => {
      if (this.current()) throw new Error('Authority already initialized; use an explicit transfer or recovery');
      const state = { epoch: 1, generation, controlRevision, artifactId };
      this.#db.prepare('INSERT INTO authority VALUES(1,?,?,?,?)').run(1, generation, controlRevision, artifactId);
      this.#record('bootstrap', state);
      return this.#grant(state);
    });
  }
  assert(grant: ServingAuthority): void {
    const state = this.current();
    if (!state || !state.generation || state.epoch !== grant.epoch || state.generation !== grant.generation ||
      state.controlRevision !== grant.controlRevision) throw new Error('Stale or withdrawn serving authority');
  }
  withdraw(grant: ServingAuthority): AuthorityState {
    return this.#transaction(() => {
      this.assert(grant);
      const old = this.current()!;
      const state = { ...old, epoch: old.epoch + 1, generation: null };
      this.#write('withdraw', state);
      return state;
    });
  }
  /** Caller must drain/reconcile already dispatched effects before activating a successor. */
  activate(expected: AuthorityState, generation: string, controlRevision: string, artifactId: string): ServingAuthority {
    this.#nonempty(generation, controlRevision, artifactId);
    return this.#transaction(() => {
      const state = this.current();
      if (!state || state.generation !== null || state.epoch !== expected.epoch ||
        state.controlRevision !== expected.controlRevision || state.artifactId !== expected.artifactId) {
        throw new Error('Activation requires the exact withdrawn authority state');
      }
      const next = { epoch: state.epoch + 1, generation, controlRevision, artifactId };
      this.#write('activate', next);
      return this.#grant(next);
    });
  }
  /** Serialize a synchronous receiver dispatch with authority transfer. Never await in this callback. */
  dispatch<T>(grant: ServingAuthority, operation: () => T): T {
    return this.#transaction(() => {
      this.assert(grant);
      const result = operation();
      if (result && typeof result === 'object' && 'then' in result) {
        throw new Error('Dispatch callback must return synchronously; reconcile completion separately');
      }
      return result;
    });
  }
  history(): { epoch: number; kind: string; state: AuthorityState }[] {
    return this.#db.prepare('SELECT epoch,kind,state FROM authority_events ORDER BY epoch').all().map(row => ({
      epoch: Number(row.epoch), kind: String(row.kind), state: JSON.parse(String(row.state)) as AuthorityState,
    }));
  }
  #grant(state: AuthorityState): ServingAuthority {
    if (!state.generation) throw new Error('No serving generation');
    return { generation: state.generation, epoch: state.epoch, controlRevision: state.controlRevision };
  }
  #nonempty(...values: string[]): void {
    if (values.some(value => typeof value !== 'string' || value.trim().length === 0)) throw new Error('Empty authority identity');
  }
  #write(kind: string, state: AuthorityState): void {
    this.#db.prepare('UPDATE authority SET epoch=?,generation=?,control_revision=?,artifact_id=? WHERE singleton=1')
      .run(state.epoch, state.generation, state.controlRevision, state.artifactId);
    this.#record(kind, state);
  }
  #record(kind: string, state: AuthorityState): void {
    this.#db.prepare('INSERT INTO authority_events VALUES(?,?,?,?)').run(state.epoch, new Date().toISOString(), kind, JSON.stringify(state));
  }
  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}
