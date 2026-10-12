import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, basename, join, sep } from 'node:path';
import { mkdirSync, existsSync, realpathSync } from 'node:fs';
import { canonicalJson, invariant, nonempty, validateArtifact } from '../contracts/common.ts';
import type { ArtifactRef, JsonValue } from '../contracts/common.ts';

export interface Document<T = JsonValue> { revision: number; value: T }
export interface StoredEvent<T = JsonValue> { sequence: number; id: string; stream: string; type: string; data: T }
export interface EventInput { id: string; stream: string; type: string; data: unknown }
export class RevisionConflict extends Error { override name = 'RevisionConflict'; }
export interface DocumentJournalOptions { stream: string; hostId: string; maxAnchorDocuments: number; maxAnchorBytes: number }
export interface DocumentJournalBinding extends DocumentJournalOptions { schema: 'aeon.document-journal.v1'; anchorId: string; anchorSequence: number }
export interface DevelopmentSnapshot { documents: { namespace: string; key: string; revision: number; value: JsonValue }[]; events: StoredEvent[]; journalBinding: DocumentJournalBinding | null }
export const DOCUMENT_JOURNAL_NAMESPACE = 'system.document-journal';
export const DOCUMENT_JOURNAL_KEY = 'binding';
const JOURNAL_SCHEMA = 'aeon.document-journal.v1' as const;
const JOURNAL_ANCHOR = 'document-journal-anchor';
const JOURNAL_MUTATION = 'document-mutation';
export interface StoreOptions { filename: string; checkoutRoot?: string; documentJournal?: DocumentJournalOptions | null }
/** One engine for operational and developmental state. Transactions are synchronous and cannot cross await. */
function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(physicalPath(dirname(path)), basename(path));
}
export class OperationalStore {
  readonly filename: string;
  private db: DatabaseSync;
  private depth = 0;
  private journalOption: DocumentJournalOptions | null | undefined;
  private observedJournal?: string;
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
      this.journalOption = options.documentJournal === undefined || options.documentJournal === null ? options.documentJournal : { ...options.documentJournal };
      if (this.journalOption) {
        this.validateJournalOptions(this.journalOption);
        invariant(canonicalJson(this.journalOption) === canonicalJson({ stream: this.journalOption.stream, hostId: this.journalOption.hostId, maxAnchorDocuments: this.journalOption.maxAnchorDocuments, maxAnchorBytes: this.journalOption.maxAnchorBytes }), 'invalid document journal options');
      }
      const binding = this.transaction(() => {
        const existing = this.readJournalBinding();
        if (existing || !this.journalOption) return existing;
        const limits = this.journalOption;
        // JSON escaping can consume six bytes per stored byte. Bound before allocating rows.
        const size = this.db.prepare('SELECT count(*) AS rows, coalesce(sum(6*(length(CAST(namespace AS BLOB))+length(CAST(key AS BLOB))+length(CAST(value AS BLOB)))+128),0) AS bytes FROM documents').get() as { rows: number; bytes: number };
        invariant(size.rows <= limits.maxAnchorDocuments && size.bytes + 512 + 6 * Buffer.byteLength(limits.hostId) <= limits.maxAnchorBytes, 'document journal anchor exceeds bound');
        const documents = this.documentRows();
        const data = { schema: JOURNAL_SCHEMA, hostId: limits.hostId, maxAnchorDocuments: limits.maxAnchorDocuments, maxAnchorBytes: limits.maxAnchorBytes, documents };
        invariant(Buffer.byteLength(canonicalJson(data)) <= limits.maxAnchorBytes, 'document journal anchor exceeds bound');
        const anchor = this.insertEvent({ id: randomUUID(), stream: limits.stream, type: JOURNAL_ANCHOR, data });
        const created: DocumentJournalBinding = { ...limits, schema: JOURNAL_SCHEMA, anchorId: anchor.id, anchorSequence: anchor.sequence };
        this.db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY, canonicalJson(created));
        return created;
      });
      if (binding) this.observedJournal = canonicalJson(binding);
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
  private validateJournalOptions(options: DocumentJournalOptions): void {
    nonempty(options.stream, 'journal.stream'); nonempty(options.hostId, 'journal.hostId');
    invariant(Number.isSafeInteger(options.maxAnchorDocuments) && options.maxAnchorDocuments >= 0 && Number.isSafeInteger(options.maxAnchorBytes) && options.maxAnchorBytes >= 0, 'invalid document journal anchor bounds');
  }
  private documentRows(): { namespace: string; key: string; revision: number; value: JsonValue }[] {
    return (this.db.prepare('SELECT namespace,key,revision,value FROM documents ORDER BY namespace,key').all() as { namespace: string; key: string; revision: number; value: string }[]).map(row => ({ ...row, value: JSON.parse(row.value) as JsonValue }));
  }
  private readJournalBinding(): DocumentJournalBinding | null {
    const rows = this.db.prepare('SELECT key,revision,value FROM documents WHERE namespace=? LIMIT 2').all(DOCUMENT_JOURNAL_NAMESPACE) as { key: string; revision: number; value: string }[];
    if (rows.length === 0) {
      invariant(!this.observedJournal && !this.db.prepare('SELECT 1 FROM events WHERE type IN (?,?) LIMIT 1').get(JOURNAL_ANCHOR, JOURNAL_MUTATION), 'document journal binding missing');
      return null;
    }
    invariant(rows.length === 1 && rows[0]!.key === DOCUMENT_JOURNAL_KEY && rows[0]!.revision === 1, 'invalid document journal binding');
    const binding = JSON.parse(rows[0]!.value) as DocumentJournalBinding;
    this.validateJournalOptions(binding); nonempty(binding.anchorId, 'journal.anchorId');
    invariant(binding.schema === JOURNAL_SCHEMA && Number.isSafeInteger(binding.anchorSequence) && binding.anchorSequence > 0, 'invalid document journal binding');
    const exact: DocumentJournalBinding = { schema: JOURNAL_SCHEMA, stream: binding.stream, hostId: binding.hostId, maxAnchorDocuments: binding.maxAnchorDocuments, maxAnchorBytes: binding.maxAnchorBytes, anchorId: binding.anchorId, anchorSequence: binding.anchorSequence };
    const encoded = canonicalJson(binding);
    invariant(encoded === canonicalJson(exact) && (!this.observedJournal || this.observedJournal === encoded), 'changed document journal binding');
    invariant(this.journalOption !== null, 'document journal cannot be disabled');
    if (this.journalOption) invariant(canonicalJson(this.journalOption) === canonicalJson({ stream: binding.stream, hostId: binding.hostId, maxAnchorDocuments: binding.maxAnchorDocuments, maxAnchorBytes: binding.maxAnchorBytes }), 'contradictory document journal binding');
    const size = this.db.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM events WHERE id=?').get(binding.anchorId) as { bytes: number } | undefined;
    invariant(size && size.bytes <= binding.maxAnchorBytes, 'document journal anchor missing or exceeds bound');
    const anchor = this.db.prepare('SELECT sequence,stream,type,data FROM events WHERE id=?').get(binding.anchorId) as { sequence: number; stream: string; type: string; data: string } | undefined;
    invariant(anchor && anchor.sequence === binding.anchorSequence && anchor.stream === binding.stream && anchor.type === JOURNAL_ANCHOR, 'document journal anchor missing or changed');
    const data = JSON.parse(anchor.data) as { schema: string; hostId: string; maxAnchorDocuments: number; maxAnchorBytes: number; documents: unknown[] };
    invariant(data.schema === JOURNAL_SCHEMA && data.hostId === binding.hostId && data.maxAnchorDocuments === binding.maxAnchorDocuments && data.maxAnchorBytes === binding.maxAnchorBytes && Array.isArray(data.documents), 'document journal anchor differs from binding');
    this.observedJournal = encoded;
    return exact;
  }
  documentJournalBinding(): DocumentJournalBinding | null { return this.transaction(() => this.readJournalBinding()); }
  captureDevelopmentSnapshot(limits: { maxRows: number; maxBytes: number }): DevelopmentSnapshot {
    invariant(Number.isSafeInteger(limits.maxRows) && limits.maxRows >= 0 && limits.maxRows <= 512 && Number.isSafeInteger(limits.maxBytes) && limits.maxBytes >= 0 && limits.maxBytes <= 1_048_576, 'invalid development snapshot bounds');
    return this.transaction(() => {
      const docs = this.db.prepare('SELECT count(*) AS rows, coalesce(sum(6*(length(CAST(namespace AS BLOB))+length(CAST(key AS BLOB))+length(CAST(value AS BLOB)))+256),0) AS bytes FROM documents').get() as { rows: number; bytes: number };
      const events = this.db.prepare('SELECT count(*) AS rows, coalesce(sum(6*(length(CAST(id AS BLOB))+length(CAST(stream AS BLOB))+length(CAST(type AS BLOB))+length(CAST(data AS BLOB)))+256),0) AS bytes, min(sequence) AS first, coalesce(max(sequence),0) AS last FROM events').get() as { rows: number; bytes: number; first: number | null; last: number };
      const binding = this.db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM documents WHERE namespace=? AND key=?').get(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY) as { bytes: number } | undefined;
      invariant(docs.rows + events.rows <= limits.maxRows && docs.bytes + events.bytes + 512 + 6 * (binding?.bytes ?? 0) <= limits.maxBytes, 'development snapshot exceeds bound');
      const highWater = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get() as { seq: number } | undefined;
      invariant(events.rows === events.last && (events.first === null || events.first === 1) && events.last === (highWater?.seq ?? 0), 'development snapshot event prefix incomplete');
      const journalBinding = this.readJournalBinding();
      const snapshot: DevelopmentSnapshot = { documents: this.documentRows(), events: this.events(), journalBinding };
      invariant(Buffer.byteLength(canonicalJson(snapshot)) <= limits.maxBytes, 'development snapshot exceeds bound');
      return snapshot;
    });
  }
  private journalMutation(binding: DocumentJournalBinding | null, namespace: string, key: string, before: Document | null, after: Document | null): void {
    if (binding) this.insertEvent({ id: randomUUID(), stream: binding.stream, type: JOURNAL_MUTATION, data: { schema: JOURNAL_SCHEMA, hostId: binding.hostId, namespace, key, before, after } });
  }
  put(namespace: string, key: string, value: unknown, expectedRevision: number | null): number {
    nonempty(namespace, 'namespace'); nonempty(key, 'key'); const encoded = canonicalJson(value);
    invariant(namespace !== DOCUMENT_JOURNAL_NAMESPACE, 'reserved document journal namespace');
    return this.transaction(() => {
      const binding = this.readJournalBinding();
      const previous = this.get(namespace, key);
      if ((previous?.revision ?? null) !== expectedRevision) throw new RevisionConflict(`${namespace}/${key}: expected ${expectedRevision}, found ${previous?.revision ?? null}`);
      const revision = (previous?.revision ?? 0) + 1;
      this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(namespace, key, revision, encoded);
      this.journalMutation(binding, namespace, key, previous ?? null, { revision, value: JSON.parse(encoded) as JsonValue });
      return revision;
    });
  }
  delete(namespace: string, key: string, expectedRevision: number): void {
    nonempty(namespace, 'namespace'); nonempty(key, 'key'); invariant(namespace !== DOCUMENT_JOURNAL_NAMESPACE, 'reserved document journal namespace');
    this.transaction(() => { const binding = this.readJournalBinding(); const existing = this.get(namespace, key); if (existing?.revision !== expectedRevision) throw new RevisionConflict('delete revision conflict'); this.db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(namespace, key); this.journalMutation(binding, namespace, key, existing, null); });
  }
  append(input: EventInput): StoredEvent {
    const { id, stream, type } = input;
    invariant(type !== JOURNAL_ANCHOR && type !== JOURNAL_MUTATION, 'reserved document journal event type');
    return this.transaction(() => this.insertEvent({ id, stream, type, data: input.data }));
  }
  private insertEvent(input: EventInput): StoredEvent {
    const { id, stream, type, data } = input;
    nonempty(id, 'event.id'); nonempty(stream, 'event.stream'); nonempty(type, 'event.type'); const encoded = canonicalJson(data);
    const previous = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as { sequence: number; id: string; stream: string; type: string; data: string } | undefined;
    if (previous) { invariant(previous.stream === stream && previous.type === type && previous.data === encoded, 'conflicting event identity'); return { ...previous, data: JSON.parse(previous.data) as JsonValue }; }
    const result = this.db.prepare('INSERT INTO events(id,stream,type,data) VALUES(?,?,?,?)').run(id, stream, type, encoded);
    return { sequence: Number(result.lastInsertRowid), id, stream, type, data: JSON.parse(encoded) as JsonValue };
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
  readArtifact(ref: ArtifactRef, maxBytes?: number): Uint8Array {
    validateArtifact(ref); invariant(ref.uri === `aeon:artifact:${ref.sha256}`, 'foreign artifact URI');
    const read = (): Uint8Array => {
      const row = this.db.prepare('SELECT bytes FROM artifacts WHERE digest=?').get(ref.sha256) as { bytes: Uint8Array } | undefined;
      invariant(row, 'missing artifact'); invariant(createHash('sha256').update(row.bytes).digest('hex') === ref.sha256, 'artifact corruption'); return row.bytes;
    };
    if (maxBytes === undefined) return read();
    invariant(Number.isSafeInteger(maxBytes) && maxBytes >= 0, 'invalid artifact read bound');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT length(bytes) AS size, typeof(bytes) AS storage FROM artifacts WHERE digest=?').get(ref.sha256) as { size: number; storage: string } | undefined;
      invariant(row, 'missing artifact'); invariant(row.storage === 'blob', 'artifact has invalid storage representation'); invariant(row.size <= maxBytes, 'artifact exceeds read bound');
      return read();
    });
  }
  readJsonArtifact<T = JsonValue>(ref: ArtifactRef): T { return JSON.parse(Buffer.from(this.readArtifact(ref)).toString('utf8')) as T; }
}
