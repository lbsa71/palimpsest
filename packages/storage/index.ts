import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, basename, join, sep } from 'node:path';
import { mkdirSync, existsSync, realpathSync } from 'node:fs';
import { canonicalJson, invariant, nonempty, validateArtifact } from '../contracts/common.ts';
import type { ArtifactRef, JsonValue } from '../contracts/common.ts';

export interface Document<T = JsonValue> { revision: number; value: T }
export interface StoredEvent<T = JsonValue> { sequence: number; id: string; stream: string; type: string; data: T }
export interface EventInput { id: string; stream: string; type: string; data: unknown }
export class RevisionConflict extends Error { override name = 'RevisionConflict'; }
export interface StoreOptions { filename: string; checkoutRoot?: string }
/** One engine for operational and developmental state. Transactions are synchronous and cannot cross await. */
function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(physicalPath(dirname(path)), basename(path));
}
export class OperationalStore {
  readonly filename: string;
  private db: DatabaseSync;
  private depth = 0;
  constructor(options: StoreOptions) {
    invariant(isAbsolute(options.filename), 'state filename must be absolute');
    this.filename = resolve(options.filename);
    if (options.checkoutRoot) {
      const path = relative(physicalPath(resolve(options.checkoutRoot)), physicalPath(this.filename));
      invariant(path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path), 'lived state must remain outside checkout');
    }
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.filename);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        invariant(version === 0 || version === 1, `unsupported operational schema ${version}`);
        if (version === 0) this.db.exec(`
          CREATE TABLE documents(namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), value TEXT NOT NULL, PRIMARY KEY(namespace,key));
          CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, stream TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
          CREATE INDEX event_stream ON events(stream,sequence);
          CREATE TABLE artifacts(digest TEXT PRIMARY KEY, bytes BLOB NOT NULL);
          PRAGMA user_version=1;`);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      const check = this.db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
      invariant(check.length === 1 && check[0]?.quick_check === 'ok', 'operational database corruption');
      // Diagnose a forged or partial schema on open, rather than during later writes.
      for (const [table, columns] of Object.entries({documents:['namespace','key','revision','value'],events:['sequence','id','stream','type','data'],artifacts:['digest','bytes']})) {
        const actual = this.db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];
        invariant(canonicalJson(actual.map(c=>c.name))===canonicalJson(columns), `incompatible ${table} schema`);
      }
    } catch (error) { this.db.close(); throw new Error(`cannot open operational state ${this.filename}`, { cause: error }); }
  }
  close(): void { this.db.close(); }
  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0; const savepoint = `nested_${this.depth}`;
    this.db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`); this.depth++;
    try {
      const result = fn();
      invariant(!(result && typeof result === 'object' && 'then' in result), 'transaction callback must be synchronous');
      this.db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`); return result;
    } catch (error) { this.db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
    finally { this.depth--; }
  }
  get<T = JsonValue>(namespace: string, key: string): Document<T> | undefined {
    nonempty(namespace, 'namespace'); nonempty(key, 'key');
    const row = this.db.prepare('SELECT revision,value FROM documents WHERE namespace=? AND key=?').get(namespace, key) as { revision: number; value: string } | undefined;
    return row ? { revision: row.revision, value: JSON.parse(row.value) as T } : undefined;
  }
  list<T = JsonValue>(namespace: string): (Document<T> & { key: string })[] {
    nonempty(namespace, 'namespace');
    return (this.db.prepare('SELECT key,revision,value FROM documents WHERE namespace=? ORDER BY key').all(namespace) as { key: string; revision: number; value: string }[]).map(r => ({ key: r.key, revision: r.revision, value: JSON.parse(r.value) as T }));
  }
  put(namespace: string, key: string, value: unknown, expectedRevision: number | null): number {
    nonempty(namespace, 'namespace'); nonempty(key, 'key'); const encoded = canonicalJson(value);
    return this.transaction(() => {
      const previous = this.get(namespace, key);
      if ((previous?.revision ?? null) !== expectedRevision) throw new RevisionConflict(`${namespace}/${key}: expected ${expectedRevision}, found ${previous?.revision ?? null}`);
      const revision = (previous?.revision ?? 0) + 1;
      this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(namespace, key, revision, encoded);
      return revision;
    });
  }
  delete(namespace: string, key: string, expectedRevision: number): void {
    this.transaction(() => { const existing = this.get(namespace, key); if (existing?.revision !== expectedRevision) throw new RevisionConflict('delete revision conflict'); this.db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(namespace, key); });
  }
  append(input: EventInput): StoredEvent {
    nonempty(input.id, 'event.id'); nonempty(input.stream, 'event.stream'); nonempty(input.type, 'event.type'); const encoded = canonicalJson(input.data);
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM events WHERE id=?').get(input.id) as { sequence: number; id: string; stream: string; type: string; data: string } | undefined;
      if (previous) { invariant(previous.stream === input.stream && previous.type === input.type && previous.data === encoded, 'conflicting event identity'); return { ...previous, data: JSON.parse(previous.data) as JsonValue }; }
      const result = this.db.prepare('INSERT INTO events(id,stream,type,data) VALUES(?,?,?,?)').run(input.id, input.stream, input.type, encoded);
      return { sequence: Number(result.lastInsertRowid), id: input.id, stream: input.stream, type: input.type, data: JSON.parse(encoded) as JsonValue };
    });
  }
  events<T = JsonValue>(stream?: string, afterSequence = 0): StoredEvent<T>[] {
    invariant(Number.isSafeInteger(afterSequence) && afterSequence >= 0, 'invalid event cursor');
    const rows = (stream === undefined ? this.db.prepare('SELECT * FROM events WHERE sequence>? ORDER BY sequence').all(afterSequence) : this.db.prepare('SELECT * FROM events WHERE stream=? AND sequence>? ORDER BY sequence').all(stream, afterSequence)) as { sequence: number; id: string; stream: string; type: string; data: string }[];
    return rows.map(row => ({ ...row, data: JSON.parse(row.data) as T }));
  }
  putArtifact(content: JsonValue | string | Uint8Array): ArtifactRef {
    const bytes = content instanceof Uint8Array ? content : Buffer.from(typeof content === 'string' ? content : canonicalJson(content));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO artifacts VALUES(?,?)').run(sha256, bytes);
    return { uri: `aeon:artifact:${sha256}`, sha256 };
  }
  putJsonArtifact(content: JsonValue): ArtifactRef { return this.putArtifact(Buffer.from(canonicalJson(content))); }
  readArtifact(ref: ArtifactRef): Uint8Array {
    validateArtifact(ref); invariant(ref.uri === `aeon:artifact:${ref.sha256}`, 'foreign artifact URI');
    const row = this.db.prepare('SELECT bytes FROM artifacts WHERE digest=?').get(ref.sha256) as { bytes: Uint8Array } | undefined;
    invariant(row, 'missing artifact'); invariant(createHash('sha256').update(row.bytes).digest('hex') === ref.sha256, 'artifact corruption'); return row.bytes;
  }
  readJsonArtifact<T = JsonValue>(ref: ArtifactRef): T { return JSON.parse(Buffer.from(this.readArtifact(ref)).toString('utf8')) as T; }
}
