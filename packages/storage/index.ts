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
export interface DocumentJournalBinding extends DocumentJournalOptions { schema: 'aeon.document-journal.v2'; anchorId: string; anchorSequence: number }
export interface DevelopmentSnapshot { documents: { namespace: string; key: string; revision: number; value: JsonValue }[]; events: StoredEvent[]; journalBinding: DocumentJournalBinding | null; journalPayloads: JournalPayload[] }
export interface PhysicalDocumentRow { namespace: string; key: string; revision: number; value: JsonValue }
export type SourcePage = { schema: 'aeon.development.source-page.v1'; table: 'documents'; rows: PhysicalDocumentRow[] } | { schema: 'aeon.development.source-page.v1'; table: 'events'; rows: StoredEvent[] };
export interface SourcePageDescriptor { table: 'documents' | 'events'; artifact: ArtifactRef; rows: number; bytes: number; conservativeBytes: number }
export interface PageCaptureBounds { maxPageRows: number; maxPageBytes: number; maxPages: number; maxPhysicalRows: number; maxConservativeBytes: number; maxSerializedBytes: number; maxOperationalArtifacts: number; maxOperationalArtifactBytes: number; maxOperationalArtifactTotalBytes: number }
export interface OperationalArtifactCapture { original: ArtifactRef; retained: ArtifactRef; bytes: number }
export interface SourceCut { journalBinding: DocumentJournalBinding; documents: number; events: number; lastSequence: number; physicalRows: number; conservativeBytes: number; serializedBytes: number; pages: SourcePageDescriptor[]; documentsDigest: string; eventsDigest: string; operationalArtifacts: OperationalArtifactCapture[] }
export interface HistoricalSourceUse { journalDigest: string; prefix: { lastSequence: number; eventsDigest: string }; requiredVersions: JournalRef[]; maxPageRows: number; maxPageBytes: number; maxPrefixBytes: number; maxVersions: number; maxVersionBytes: number; maxWithdrawalMarkerBytes: number }
export interface SourceUseObservation { journalDigest: string; prefixSequence: number; prefixDigest: string; observedLastSequence: number; requiredVersionsDigest: string; checkedVersions: number }
interface DevelopmentGraph { known: Map<string, JournalRef>; current: Map<string, JournalRef>; withdrawn: Map<string, string>; eventsDigest: string }
const PAGE_HEADER_BYTES = 512;
const documentCost = '6*(length(CAST(namespace AS BLOB))+length(CAST(key AS BLOB))+length(CAST(value AS BLOB)))+256';
const eventCost = '6*(length(CAST(id AS BLOB))+length(CAST(stream AS BLOB))+length(CAST(type AS BLOB))+length(CAST(data AS BLOB)))+256';
function safeBound(value: number, name: string, positive = false): void { invariant(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), `invalid ${name} bound`); }
function checked(value: number): number { invariant(Number.isSafeInteger(value) && value >= 0, 'development bound arithmetic overflow'); return value; }
function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function initialChain(table: 'documents' | 'events'): string { return hash(`aeon.development.rows.v1:${table}`); }
function chain(previous: string, row: PhysicalDocumentRow | StoredEvent): string { return hash(canonicalJson([previous, row])); }
function synchronous<T>(value: T): T { invariant(!(value && (typeof value === 'object' || typeof value === 'function') && 'then' in value), 'development callback must be synchronous'); return value; }
function developmentText(value: Uint8Array): string { invariant(value instanceof Uint8Array, 'development row invalid text bytes'); const bytes = Buffer.from(value), decoded = bytes.toString('utf8'); invariant(bytes.equals(Buffer.from(decoded)), 'development row invalid UTF-8'); return decoded; }
export const DOCUMENT_JOURNAL_NAMESPACE = 'system.document-journal';
export const DOCUMENT_JOURNAL_KEY = 'binding';
const JOURNAL_SCHEMA = 'aeon.document-journal.v2' as const;
const JOURNAL_ANCHOR = 'document-journal-anchor';
const JOURNAL_MUTATION = 'document-mutation';
const JOURNAL_WITHDRAWAL = 'document-journal-withdrawal';
export const DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE = `${DOCUMENT_JOURNAL_NAMESPACE}.payloads`;
export const DOCUMENT_JOURNAL_HEAD_NAMESPACE = `${DOCUMENT_JOURNAL_NAMESPACE}.heads`;
export interface JournalRef { versionId: string; namespace: string; key: string; revision: number; sha256: string }
export type JournalPayload = { ref: JournalRef; state: 'available'; document: Document } | { ref: JournalRef; state: 'withdrawn'; withdrawalId: string };
export interface JournalWithdrawalInput { id: string; reason: 'forget' | 'expiry'; targets: { namespace: string; key: string; expectedRevision: number | null }[] }
interface JournalWithdrawalData { schema: string; hostId: string; withdrawalId: string; reason: 'forget' | 'expiry'; targets: JournalWithdrawalInput['targets']; refs: JournalRef[] }
function reservedJournalNamespace(namespace: string): boolean { return namespace === DOCUMENT_JOURNAL_NAMESPACE || namespace.startsWith(`${DOCUMENT_JOURNAL_NAMESPACE}.`); }
function ownedJournalNamespace(namespace: string): boolean { return namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE || namespace === DOCUMENT_JOURNAL_HEAD_NAMESPACE; }
function documentDigest(document: Document): string { return createHash('sha256').update(canonicalJson(document)).digest('hex'); }
function documentKey(namespace: string, key: string): string { return canonicalJson([namespace, key]); }
function compareKeys(a: { namespace: string; key: string }, b: { namespace: string; key: string }): number { return Buffer.compare(Buffer.from(a.namespace), Buffer.from(b.namespace)) || Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)); }

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
  private developmentFence = false;
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
        // Charge current documents and all prospective payload/head/reference metadata before materialization.
        const size = this.db.prepare('SELECT count(*) AS rows, coalesce(sum(48*(length(CAST(namespace AS BLOB))+length(CAST(key AS BLOB)))+12*length(CAST(value AS BLOB))+4096),0) AS bytes FROM documents').get() as { rows: number; bytes: number };
        invariant(3 * size.rows + 1 <= limits.maxAnchorDocuments && size.bytes + 2048 + 12 * Buffer.byteLength(limits.hostId) <= limits.maxAnchorBytes, 'document journal anchor exceeds bound');
        const documents = this.documentRows().map(row => this.createJournalVersion(row.namespace, row.key, { revision: row.revision, value: row.value }));
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
  close(): void { this.assertDevelopmentWrite(); this.db.close(); }
  /** Retained source captures must not escape an uncommitted caller transaction. */
  get transactionActive(): boolean { return this.depth > 0; }
  private assertDevelopmentWrite(): void { invariant(!this.developmentFence, 'source writes forbidden during development fence'); }
  private withDevelopmentFence<T>(fn: () => T): T {
    invariant(!this.developmentFence && this.depth === 0, 'reentrant development acquisition forbidden');
    return this.transaction(() => { this.developmentFence = true; try { return synchronous(fn()); } finally { this.developmentFence = false; } });
  }
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
    if (ownedJournalNamespace(namespace)) return [];
    return (this.db.prepare('SELECT key,revision,value FROM documents WHERE namespace=? ORDER BY key').all(namespace) as { key: string; revision: number; value: string }[]).map(r => ({ key: r.key, revision: r.revision, value: JSON.parse(r.value) as T }));
  }
  private validateJournalOptions(options: DocumentJournalOptions): void {
    nonempty(options.stream, 'journal.stream'); nonempty(options.hostId, 'journal.hostId');
    invariant(Number.isSafeInteger(options.maxAnchorDocuments) && options.maxAnchorDocuments >= 0 && Number.isSafeInteger(options.maxAnchorBytes) && options.maxAnchorBytes >= 0, 'invalid document journal anchor bounds');
  }
  private documentRows(): { namespace: string; key: string; revision: number; value: JsonValue }[] {
    return (this.db.prepare('SELECT namespace,key,revision,value FROM documents ORDER BY namespace,key').all() as { namespace: string; key: string; revision: number; value: string }[]).filter(row => !ownedJournalNamespace(row.namespace)).map(row => ({ ...row, value: JSON.parse(row.value) as JsonValue }));
  }
  private readJournalBinding(): DocumentJournalBinding | null {
    const prefix = `${DOCUMENT_JOURNAL_NAMESPACE}.`;
    invariant(!this.db.prepare('SELECT 1 FROM documents WHERE substr(namespace,1,?)=? AND namespace NOT IN (?,?) LIMIT 1').get(prefix.length, prefix, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, DOCUMENT_JOURNAL_HEAD_NAMESPACE), 'unknown reserved document journal namespace');
    const rows = this.db.prepare('SELECT key,revision,value FROM documents WHERE namespace=? LIMIT 2').all(DOCUMENT_JOURNAL_NAMESPACE) as { key: string; revision: number; value: string }[];
    if (rows.length === 0) {
      invariant(!this.observedJournal && !this.db.prepare('SELECT 1 FROM events WHERE type IN (?,?,?) LIMIT 1').get(JOURNAL_ANCHOR, JOURNAL_MUTATION, JOURNAL_WITHDRAWAL), 'document journal binding missing');
      invariant(!this.db.prepare('SELECT 1 FROM documents WHERE namespace IN (?,?) LIMIT 1').get(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, DOCUMENT_JOURNAL_HEAD_NAMESPACE), 'unbound document journal internal rows');
      return null;
    }
    invariant(rows.length === 1 && rows[0]!.key === DOCUMENT_JOURNAL_KEY && rows[0]!.revision === 1, 'invalid document journal binding');
    const binding = JSON.parse(rows[0]!.value) as DocumentJournalBinding;
    invariant(binding.schema === JOURNAL_SCHEMA, `unsupported document journal schema ${binding.schema}`);
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
    invariant(!this.developmentFence, 'reentrant development acquisition forbidden');
    invariant(Number.isSafeInteger(limits.maxRows) && limits.maxRows >= 0 && limits.maxRows <= 512 && Number.isSafeInteger(limits.maxBytes) && limits.maxBytes >= 0 && limits.maxBytes <= 1_048_576, 'invalid development snapshot bounds');
    return this.transaction(() => {
      const docs = this.db.prepare('SELECT count(*) AS rows, coalesce(sum(6*(length(CAST(namespace AS BLOB))+length(CAST(key AS BLOB))+length(CAST(value AS BLOB)))+256),0) AS bytes FROM documents').get() as { rows: number; bytes: number };
      const events = this.db.prepare('SELECT count(*) AS rows, coalesce(sum(6*(length(CAST(id AS BLOB))+length(CAST(stream AS BLOB))+length(CAST(type AS BLOB))+length(CAST(data AS BLOB)))+256),0) AS bytes, min(sequence) AS first, coalesce(max(sequence),0) AS last FROM events').get() as { rows: number; bytes: number; first: number | null; last: number };
      const binding = this.db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes FROM documents WHERE namespace=? AND key=?').get(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY) as { bytes: number } | undefined;
      invariant(docs.rows + events.rows <= limits.maxRows && docs.bytes + events.bytes + 512 + 6 * (binding?.bytes ?? 0) <= limits.maxBytes, 'development snapshot exceeds bound');
      const highWater = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get() as { seq: number } | undefined;
      invariant(events.rows === events.last && (events.first === null || events.first === 1) && events.last === (highWater?.seq ?? 0), 'development snapshot event prefix incomplete');
      const journalBinding = this.readJournalBinding();
      const journalPayloads = (this.db.prepare('SELECT key,revision,value FROM documents WHERE namespace=? ORDER BY key').all(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE) as { key: string; revision: number; value: string }[]).map(row => {
        const payload = JSON.parse(row.value) as JournalPayload;
        invariant(payload.ref?.versionId === row.key && row.revision === (payload.state === 'available' ? 1 : 2), 'invalid document journal payload row');
        return payload;
      });
      const snapshot: DevelopmentSnapshot = { documents: this.documentRows(), events: this.events(), journalBinding, journalPayloads };
      this.validateJournalSnapshot(snapshot);
      invariant(Buffer.byteLength(canonicalJson(snapshot)) <= limits.maxBytes, 'development snapshot exceeds bound');
      return snapshot;
    });
  }
  private validateDevelopmentPageBounds(bounds: { maxPageRows: number; maxPageBytes: number }): void {
    safeBound(bounds.maxPageRows, 'page rows', true); safeBound(bounds.maxPageBytes, 'page bytes', true);
    invariant(bounds.maxPageRows <= 512 && bounds.maxPageBytes <= 1_048_576 && bounds.maxPageBytes > PAGE_HEADER_BYTES, 'invalid development page bounds');
  }
  private developmentPreflight(table: 'documents' | 'events', maxRowBytes: number, through?: number): { rows: number; bytes: number; last: number } {
    const where = table === 'events' && through !== undefined ? 'WHERE sequence<=?' : '';
    const args = through === undefined || table === 'documents' ? [] : [through];
    const invalid = table === 'documents'
      ? "typeof(namespace)!='text' OR typeof(key)!='text' OR typeof(revision)!='integer' OR revision<1 OR revision>9007199254740991 OR typeof(value)!='text'"
      : "typeof(sequence)!='integer' OR sequence<1 OR sequence>9007199254740991 OR typeof(id)!='text' OR typeof(stream)!='text' OR typeof(type)!='text' OR typeof(data)!='text'";
    invariant(!this.db.prepare(`SELECT 1 FROM ${table} ${where ? `${where} AND` : 'WHERE'} (${invalid}) LIMIT 1`).get(...args), 'development rows have invalid storage representation');
    const cost = table === 'documents' ? documentCost : eventCost;
    const size = this.db.prepare(`SELECT count(*) AS rows,coalesce(sum(${cost}),0) AS bytes,coalesce(max(${cost}),0) AS singleton${table === 'events' ? ',min(sequence) AS first,coalesce(max(sequence),0) AS last' : ''} FROM ${table} ${where}`).get(...args) as { rows: number; bytes: number; singleton: number; first?: number | null; last?: number };
    checked(size.rows); checked(size.bytes); checked(size.singleton);
    invariant(size.singleton + PAGE_HEADER_BYTES <= maxRowBytes, 'development singleton exceeds page bound');
    if (table === 'events') invariant(size.rows === size.last && (size.rows === 0 ? size.first === null : size.first === 1), 'development event prefix incomplete');
    return { rows: size.rows, bytes: size.bytes, last: size.last ?? 0 };
  }
  private developmentHighWater(): number {
    const row = this.db.prepare("SELECT seq,typeof(seq) AS storage FROM sqlite_sequence WHERE name='events'").get() as { seq: number; storage: string } | undefined;
    invariant(!row || row.storage === 'integer', 'development high-water has invalid storage representation');
    return checked(row?.seq ?? 0);
  }
  private boundedJournalBinding(maxBytes: number): DocumentJournalBinding {
    const rows = this.db.prepare(`SELECT count(*) AS rows,coalesce(sum(${documentCost}),0) AS bytes FROM documents WHERE namespace=?`).get(DOCUMENT_JOURNAL_NAMESPACE) as { rows: number; bytes: number };
    invariant(rows.rows === 1 && checked(rows.bytes) + PAGE_HEADER_BYTES <= maxBytes, 'development journal binding exceeds bound or missing');
    const anchor = this.db.prepare(`SELECT coalesce(max(${eventCost}),0) AS bytes FROM events WHERE type=?`).get(JOURNAL_ANCHOR) as { bytes: number };
    invariant(checked(anchor.bytes) + PAGE_HEADER_BYTES <= maxBytes, 'development journal anchor exceeds bound');
    const binding = this.readJournalBinding(); invariant(binding, 'development journal binding missing'); return binding;
  }
  private preflightDevelopmentPageCount(table: 'documents' | 'events', bounds: PageCaptureBounds, already: number): number {
    const order = table === 'documents' ? 'namespace COLLATE BINARY,key COLLATE BINARY' : 'sequence', cost = table === 'documents' ? documentCost : eventCost;
    let offset = 0, pages = already;
    // Offsets here inspect scalar costs only; the value scan below remains keyset-based.
    const size = (limit: number) => this.db.prepare(`SELECT count(*) AS rows,coalesce(sum(cost),0) AS bytes FROM (SELECT ${cost} AS cost FROM ${table} ORDER BY ${order} LIMIT ? OFFSET ?)`).get(limit, offset) as { rows: number; bytes: number };
    while (size(1).rows > 0) {
      invariant(pages < bounds.maxPages, 'development page count exceeds bound');
      let low = 0, high = bounds.maxPageRows;
      while (low < high) { const middle = Math.ceil((low + high) / 2), candidate = size(middle); if (checked(candidate.bytes) + PAGE_HEADER_BYTES <= bounds.maxPageBytes) low = middle; else high = middle - 1; }
      const selected = size(low); invariant(selected.rows > 0, 'development singleton exceeds page bound'); offset = checked(offset + selected.rows); pages++;
    }
    return pages;
  }
  /** Scalar keyset sizing precedes each bounded value SELECT. No full-array helper participates. */
  private scanDevelopmentPages(table: 'documents' | 'events', bounds: { maxPageRows: number; maxPageBytes: number }, visit: (page: SourcePage, conservativeBytes: number) => void, through?: number): void {
    let namespace: string | null = null, key: string | null = null, sequence = 0;
    const cost = table === 'documents' ? documentCost : eventCost;
    while (true) {
      const where = table === 'documents' ? '(? IS NULL OR namespace COLLATE BINARY>? OR (namespace COLLATE BINARY=? AND key COLLATE BINARY>?))' : 'sequence>? AND sequence<=?';
      const args = table === 'documents' ? [namespace, namespace, namespace, key] : [sequence, through ?? Number.MAX_SAFE_INTEGER];
      const order = table === 'documents' ? 'namespace COLLATE BINARY,key COLLATE BINARY' : 'sequence';
      const size = (limit: number) => this.db.prepare(`SELECT count(*) AS rows,coalesce(sum(cost),0) AS bytes FROM (SELECT ${cost} AS cost FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ?)`).get(...args, limit) as { rows: number; bytes: number };
      let low = 0, high = bounds.maxPageRows;
      while (low < high) { const middle = Math.ceil((low + high) / 2), candidate = size(middle); checked(candidate.bytes); if (candidate.bytes + PAGE_HEADER_BYTES <= bounds.maxPageBytes) low = middle; else high = middle - 1; }
      const selected = size(low); if (selected.rows === 0) { invariant(size(1).rows === 0, 'development singleton exceeds page bound'); return; }
      // Read text as bytes: node:sqlite's TEXT getter truncates embedded NUL characters.
      const fields = table === 'documents' ? 'CAST(namespace AS BLOB) AS namespace,CAST(key AS BLOB) AS key,revision,CAST(value AS BLOB) AS value' : 'sequence,CAST(id AS BLOB) AS id,CAST(stream AS BLOB) AS stream,CAST(type AS BLOB) AS type,CAST(data AS BLOB) AS data';
      const raw = this.db.prepare(`SELECT ${fields} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ?`).all(...args, selected.rows) as Record<string, Uint8Array | number>[];
      invariant(raw.length === selected.rows, 'development page row count changed');
      const text = (row: Record<string, Uint8Array | number>, field: string): string => developmentText(row[field] as Uint8Array);
      const json = (row: Record<string, Uint8Array | number>, field: string): JsonValue => { const encoded = text(row, field), value = JSON.parse(encoded) as JsonValue; invariant(canonicalJson(value) === encoded, 'development row JSON is not canonical'); return value; };
      if (table === 'documents') {
        const rows = raw.map(row => ({ namespace: text(row, 'namespace'), key: text(row, 'key'), revision: row.revision as number, value: json(row, 'value') }));
        for (const row of rows) { nonempty(row.namespace, 'namespace'); nonempty(row.key, 'key'); }
        visit({ schema: 'aeon.development.source-page.v1', table, rows }, checked(selected.bytes + PAGE_HEADER_BYTES));
        namespace = rows.at(-1)!.namespace; key = rows.at(-1)!.key;
      } else {
        const rows = raw.map(row => ({ sequence: row.sequence as number, id: text(row, 'id'), stream: text(row, 'stream'), type: text(row, 'type'), data: json(row, 'data') }));
        for (const row of rows) { nonempty(row.id, 'event.id'); nonempty(row.stream, 'event.stream'); nonempty(row.type, 'event.type'); }
        visit({ schema: 'aeon.development.source-page.v1', table, rows }, checked(selected.bytes + PAGE_HEADER_BYTES)); sequence = rows.at(-1)!.sequence;
      }
    }
  }
  private replayDevelopmentGraph(binding: DocumentJournalBinding, bounds: { maxPageRows: number; maxPageBytes: number }, through: number, maxRows: number, maxBytes: number): DevelopmentGraph {
    const known = new Map<string, JournalRef>(), current = new Map<string, JournalRef>(), withdrawn = new Map<string, string>(), eventIds = new Set<string>();
    let anchored = false, sequence = 0, eventsDigest = initialChain('events'), indexBytes = 0;
    const index = (value: unknown) => { indexBytes = checked(indexBytes + Buffer.byteLength(canonicalJson(value))); invariant(indexBytes <= checked(4 * maxBytes) && known.size + current.size + withdrawn.size + eventIds.size <= checked(4 * maxRows), 'development graph index exceeds bound'); };
    const register = (ref: JournalRef) => { this.validateRef(ref); invariant(!known.has(ref.versionId), 'duplicate document journal version'); index(ref); known.set(ref.versionId, ref); index(documentKey(ref.namespace, ref.key)); };
    this.scanDevelopmentPages('events', bounds, page => {
      invariant(page.table === 'events', 'development event page required');
      for (const event of page.rows) {
        invariant(event.sequence === ++sequence, 'development event prefix incomplete'); invariant(!eventIds.has(event.id), 'duplicate development event identity'); eventIds.add(event.id); index(event.id); eventsDigest = chain(eventsDigest, event);
        if (![JOURNAL_ANCHOR, JOURNAL_MUTATION, JOURNAL_WITHDRAWAL].includes(event.type)) continue;
        invariant(event.stream === binding.stream, 'document journal stream differs');
        const data = event.data as unknown as Record<string, unknown>;
        invariant(data && data.schema === JOURNAL_SCHEMA && data.hostId === binding.hostId, 'document journal event binding differs');
        if (event.type === JOURNAL_ANCHOR) {
          invariant(!anchored && event.id === binding.anchorId && event.sequence === binding.anchorSequence && Array.isArray(data.documents), 'invalid document journal anchor');
          const refs = data.documents as JournalRef[];
          invariant(canonicalJson(data) === canonicalJson({ schema: JOURNAL_SCHEMA, hostId: binding.hostId, maxAnchorDocuments: binding.maxAnchorDocuments, maxAnchorBytes: binding.maxAnchorBytes, documents: refs }), 'invalid document journal anchor fields');
          invariant(checked(3 * refs.length + 1) <= binding.maxAnchorDocuments, 'document journal anchor exceeds bound');
          for (let i = 0; i < refs.length; i++) { const ref = refs[i]!; invariant(i === 0 || compareKeys(refs[i - 1]!, ref) < 0, 'unordered document journal anchor'); register(ref); current.set(documentKey(ref.namespace, ref.key), ref); }
          anchored = true;
        } else if (event.type === JOURNAL_MUTATION) {
          invariant(anchored && typeof data.namespace === 'string' && typeof data.key === 'string' && !reservedJournalNamespace(data.namespace), 'invalid document journal mutation');
          const { namespace, key } = data, before = data.before as JournalRef | null, after = data.after as JournalRef | null;
          nonempty(namespace, 'mutation.namespace'); nonempty(key, 'mutation.key');
          if (before !== null) this.validateRef(before); if (after !== null) this.validateRef(after);
          invariant(canonicalJson(data) === canonicalJson({ schema: JOURNAL_SCHEMA, hostId: binding.hostId, namespace, key, before, after }), 'invalid document journal mutation fields');
          const name = documentKey(namespace, key); invariant(canonicalJson(current.get(name) ?? null) === canonicalJson(before) && (before !== null || after !== null), 'document journal before ref differs');
          if (after) { invariant(after.namespace === namespace && after.key === key && after.revision === (before?.revision ?? 0) + 1, 'invalid document journal after revision'); register(after); current.set(name, after); } else current.delete(name);
        } else {
          const marker = data as unknown as JournalWithdrawalData; this.validateDevelopmentWithdrawal(marker, event.id, binding);
          invariant(anchored, 'withdrawal precedes document journal anchor');
          const selected = new Set<string>();
          for (const target of marker.targets) { const name = documentKey(target.namespace, target.key); invariant((current.get(name)?.revision ?? null) === target.expectedRevision, 'invalid document journal withdrawal target'); selected.add(name); }
          let expected = 0;
          for (const ref of known.values()) if (!withdrawn.has(ref.versionId) && selected.has(documentKey(ref.namespace, ref.key))) expected++;
          invariant(expected === marker.refs.length, 'document journal withdrawal refs differ');
          for (const ref of marker.refs) { invariant(canonicalJson(known.get(ref.versionId) ?? null) === canonicalJson(ref) && !withdrawn.has(ref.versionId) && selected.has(documentKey(ref.namespace, ref.key)), 'document journal withdrawal refs differ'); withdrawn.set(ref.versionId, event.id); index([ref.versionId, event.id]); }
        }
      }
    }, through);
    invariant(anchored && sequence === through, 'document journal anchor missing or prefix incomplete'); return { known, current, withdrawn, eventsDigest };
  }
  private validateDevelopmentWithdrawal(marker: JournalWithdrawalData, id: string, binding: DocumentJournalBinding): void {
    invariant(marker && marker.schema === JOURNAL_SCHEMA && marker.hostId === binding.hostId && marker.withdrawalId === id && (marker.reason === 'forget' || marker.reason === 'expiry') && Array.isArray(marker.targets) && Array.isArray(marker.refs), 'invalid document journal withdrawal');
    invariant(canonicalJson(marker) === canonicalJson({ schema: JOURNAL_SCHEMA, hostId: binding.hostId, withdrawalId: id, reason: marker.reason, targets: marker.targets, refs: marker.refs }), 'invalid document journal withdrawal fields');
    for (let i = 0; i < marker.targets.length; i++) {
      const target = marker.targets[i]!; nonempty(target.namespace, 'withdrawal.namespace'); nonempty(target.key, 'withdrawal.key');
      invariant(!reservedJournalNamespace(target.namespace) && (target.expectedRevision === null || Number.isSafeInteger(target.expectedRevision) && target.expectedRevision > 0) && canonicalJson(target) === canonicalJson({ namespace: target.namespace, key: target.key, expectedRevision: target.expectedRevision }) && (i === 0 || compareKeys(marker.targets[i - 1]!, target) < 0), 'invalid document journal withdrawal target');
    }
    for (let i = 0; i < marker.refs.length; i++) { const ref = marker.refs[i]!; this.validateRef(ref); invariant((i === 0 || marker.refs[i - 1]!.versionId < ref.versionId) && marker.targets.some(target => target.namespace === ref.namespace && target.key === ref.key), 'invalid document journal withdrawal refs'); }
  }
  private validateDevelopmentPayload(payload: JournalPayload, revision: number, ref: JournalRef, withdrawalId?: string): void {
    invariant(payload && canonicalJson(payload.ref) === canonicalJson(ref), 'document journal payload missing or changed');
    if (withdrawalId !== undefined) invariant(revision === 2 && canonicalJson(payload) === canonicalJson({ ref, state: 'withdrawn', withdrawalId }), 'document journal withdrawal disposition differs');
    else { invariant(revision === 1 && payload.state === 'available', 'document journal withdrawal disposition differs'); invariant(payload.document?.revision === ref.revision && documentDigest(payload.document) === ref.sha256 && canonicalJson(payload) === canonicalJson({ ref, state: 'available', document: { revision: ref.revision, value: payload.document.value } }), 'document journal payload commitment mismatch'); }
  }
  captureDevelopmentPages(bounds: PageCaptureBounds, retainPage: (bytes: Uint8Array) => ArtifactRef, retainArtifact: (original: ArtifactRef, bytes: Uint8Array) => ArtifactRef, resolveRetainedArtifact?: (ref: ArtifactRef, maxBytes: number) => Uint8Array): SourceCut {
    const limits: PageCaptureBounds = { maxPageRows: bounds.maxPageRows, maxPageBytes: bounds.maxPageBytes, maxPages: bounds.maxPages, maxPhysicalRows: bounds.maxPhysicalRows, maxConservativeBytes: bounds.maxConservativeBytes, maxSerializedBytes: bounds.maxSerializedBytes, maxOperationalArtifacts: bounds.maxOperationalArtifacts, maxOperationalArtifactBytes: bounds.maxOperationalArtifactBytes, maxOperationalArtifactTotalBytes: bounds.maxOperationalArtifactTotalBytes };
    this.validateDevelopmentPageBounds(limits);
    for (const name of ['maxPages', 'maxPhysicalRows', 'maxConservativeBytes', 'maxSerializedBytes', 'maxOperationalArtifacts', 'maxOperationalArtifactBytes', 'maxOperationalArtifactTotalBytes'] as const) safeBound(limits[name], name);
    invariant(limits.maxPhysicalRows <= checked(limits.maxPages * limits.maxPageRows) && limits.maxConservativeBytes <= checked(limits.maxPages * limits.maxPageBytes) && limits.maxSerializedBytes <= checked(limits.maxPages * limits.maxPageBytes), 'invalid aggregate development page bounds');
    checked(4 * limits.maxPhysicalRows); checked(4 * limits.maxConservativeBytes);
    // Bound manifest-facing metadata separately from source-page serialized bytes.
    checked(limits.maxPageBytes + PAGE_HEADER_BYTES + checked(PAGE_HEADER_BYTES * limits.maxPages) + checked(PAGE_HEADER_BYTES * limits.maxOperationalArtifacts));
    return this.withDevelopmentFence(() => {
      const docs = this.developmentPreflight('documents', limits.maxPageBytes), events = this.developmentPreflight('events', limits.maxPageBytes), physicalRows = checked(docs.rows + events.rows);
      invariant(physicalRows <= limits.maxPhysicalRows && checked(docs.bytes + events.bytes + checked(PAGE_HEADER_BYTES * limits.maxPages)) <= limits.maxConservativeBytes, 'development capture exceeds aggregate bound');
      invariant(events.last === this.developmentHighWater(), 'development event prefix incomplete');
      this.preflightDevelopmentPageCount('events', limits, this.preflightDevelopmentPageCount('documents', limits, 0));
      const binding = this.boundedJournalBinding(limits.maxPageBytes), graph = this.replayDevelopmentGraph(binding, limits, events.last, physicalRows, limits.maxConservativeBytes);
      const pages: SourcePageDescriptor[] = [], operationalArtifacts: OperationalArtifactCapture[] = [], originals = new Set<string>();
      let conservativeBytes = 0, serializedBytes = 0, artifactBytes = 0, documentsDigest = initialChain('documents'), eventsDigest = initialChain('events'), payloads = 0, heads = 0, currentRows = 0, bindingRows = 0;
      const retained = (bytes: Uint8Array, callback: () => ArtifactRef): ArtifactRef => { const digest = hash(bytes), ref = synchronous(callback()); validateArtifact(ref); invariant(ref.uri === `sha256:${digest}` && ref.sha256 === digest && hash(bytes) === digest && canonicalJson(ref) === canonicalJson({ uri: ref.uri, sha256: digest }), 'development retention bytes or digest differ'); return { uri: ref.uri, sha256: digest }; };
      const artifacts = (value: JsonValue): void => {
        if (!value || typeof value !== 'object') return;
        if (!Array.isArray(value) && ('uri' in value || 'sha256' in value) && typeof value.uri === 'string' && (value.uri.startsWith('aeon:artifact:') || value.uri.startsWith('sha256:'))) {
          const original = { uri: value.uri, sha256: value.sha256 as string }; validateArtifact(original); invariant(original.uri === `aeon:artifact:${original.sha256}` || original.uri === `sha256:${original.sha256}`, 'invalid source artifact URI');
          const name = canonicalJson(original); if (!originals.has(name)) {
            invariant(originals.size < limits.maxOperationalArtifacts, 'development operational artifact count exceeds bound');
            const maxBytes = Math.min(limits.maxOperationalArtifactBytes, limits.maxOperationalArtifactTotalBytes - artifactBytes);
            const bytes = original.uri.startsWith('aeon:artifact:') ? this.readArtifact(original, maxBytes) : synchronous(resolveRetainedArtifact ? resolveRetainedArtifact({ ...original }, maxBytes) : (() => { throw new Error('source retained artifact unavailable'); })());
            invariant(bytes instanceof Uint8Array && bytes.byteLength <= maxBytes && hash(bytes) === original.sha256, 'development operational artifact bytes exceed bound or differ');
            const ref = retained(bytes, () => retainArtifact({ ...original }, bytes)), entry = { original, retained: ref, bytes: bytes.byteLength }; invariant(Buffer.byteLength(canonicalJson(entry)) <= PAGE_HEADER_BYTES, 'development artifact mapping exceeds metadata bound'); artifactBytes = checked(artifactBytes + bytes.byteLength); originals.add(name); operationalArtifacts.push(entry);
          }
        }
        for (const item of Object.values(value)) artifacts(item);
      };
      const retain = (page: SourcePage, cost: number): void => {
        invariant(Buffer.byteLength(canonicalJson({ schema: page.schema, table: page.table, rows: [] })) <= PAGE_HEADER_BYTES, 'development page header exceeds bound');
        const bytes = Buffer.from(canonicalJson(page));
        invariant(bytes.byteLength <= limits.maxPageBytes && pages.length < limits.maxPages, 'development page exceeds bound');
        conservativeBytes = checked(conservativeBytes + cost); serializedBytes = checked(serializedBytes + bytes.byteLength);
        invariant(conservativeBytes <= limits.maxConservativeBytes && serializedBytes <= limits.maxSerializedBytes, 'development capture exceeds aggregate bound');
        const descriptor = { table: page.table, artifact: retained(bytes, () => retainPage(bytes)), rows: page.rows.length, bytes: bytes.byteLength, conservativeBytes: cost }; invariant(Buffer.byteLength(canonicalJson(descriptor)) <= PAGE_HEADER_BYTES, 'development page descriptor exceeds metadata bound'); pages.push(descriptor);
      };
      this.scanDevelopmentPages('documents', limits, (page, cost) => {
        invariant(page.table === 'documents', 'development document page required');
        for (const row of page.rows) {
          documentsDigest = chain(documentsDigest, row);
          if (row.namespace === DOCUMENT_JOURNAL_NAMESPACE) { invariant(row.key === DOCUMENT_JOURNAL_KEY && row.revision === 1 && canonicalJson(row.value) === canonicalJson(binding), 'invalid document journal binding row'); bindingRows++; }
          else if (row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE) { const ref = graph.known.get(row.key); invariant(ref, 'orphan document journal payload'); this.validateDevelopmentPayload(row.value as unknown as JournalPayload, row.revision, ref, graph.withdrawn.get(row.key)); payloads++; }
          else if (row.namespace === DOCUMENT_JOURNAL_HEAD_NAMESPACE) { invariant(graph.current.has(row.key) && canonicalJson(row.value) === canonicalJson(graph.current.get(row.key)), 'document journal current head differs'); heads++; }
          else { invariant(!reservedJournalNamespace(row.namespace), 'unknown reserved document journal namespace'); const ref = graph.current.get(documentKey(row.namespace, row.key)); invariant(ref && ref.revision === row.revision && ref.sha256 === documentDigest({ revision: row.revision, value: row.value }), 'document journal current document differs'); currentRows++; }
          artifacts(row.value);
        }
        retain(page, cost);
      });
      invariant(bindingRows === 1 && payloads === graph.known.size && heads === graph.current.size && currentRows === graph.current.size, 'document journal physical inventory differs');
      this.scanDevelopmentPages('events', limits, (page, cost) => { invariant(page.table === 'events', 'development event page required'); for (const row of page.rows) { eventsDigest = chain(eventsDigest, row); artifacts(row.data); } retain(page, cost); }, events.last);
      invariant(eventsDigest === graph.eventsDigest, 'development event prefix changed');
      return { journalBinding: binding, documents: docs.rows, events: events.rows, lastSequence: events.last, physicalRows, conservativeBytes, serializedBytes, pages, documentsDigest, eventsDigest, operationalArtifacts };
    });
  }
  withDevelopmentSourceCut<T>(input: { journalDigest: string; lastSequence: number }, use: () => T): T {
    invariant(/^[a-f0-9]{64}$/.test(input.journalDigest), 'invalid development journal digest'); safeBound(input.lastSequence, 'source sequence');
    const expected = { journalDigest: input.journalDigest, lastSequence: input.lastSequence };
    return this.withDevelopmentFence(() => {
      const binding = this.boundedJournalBinding(1_048_576), size = this.db.prepare('SELECT count(*) AS rows,min(sequence) AS first,coalesce(max(sequence),0) AS last FROM events').get() as { rows: number; first: number | null; last: number };
      invariant(hash(canonicalJson(binding)) === expected.journalDigest && size.rows === expected.lastSequence && size.last === expected.lastSequence && (size.rows === 0 ? size.first === null : size.first === 1) && this.developmentHighWater() === expected.lastSequence, 'development source cut changed');
      return synchronous(use());
    });
  }
  withDevelopmentVersionsAvailable<T>(input: HistoricalSourceUse, use: (observation: SourceUseObservation) => T): T {
    const prefixInput = input.prefix, required = input.requiredVersions;
    const request: HistoricalSourceUse = { journalDigest: input.journalDigest, prefix: { lastSequence: prefixInput.lastSequence, eventsDigest: prefixInput.eventsDigest }, requiredVersions: [], maxPageRows: input.maxPageRows, maxPageBytes: input.maxPageBytes, maxPrefixBytes: input.maxPrefixBytes, maxVersions: input.maxVersions, maxVersionBytes: input.maxVersionBytes, maxWithdrawalMarkerBytes: input.maxWithdrawalMarkerBytes };
    this.validateDevelopmentPageBounds(request);
    for (const name of ['maxPrefixBytes', 'maxVersions', 'maxVersionBytes', 'maxWithdrawalMarkerBytes'] as const) safeBound(request[name], name, true);
    safeBound(request.prefix.lastSequence, 'prefix sequence'); checked(4 * request.maxPrefixBytes); checked(4 * checked(request.prefix.lastSequence + request.maxVersions)); checked(request.maxVersions * request.maxWithdrawalMarkerBytes);
    invariant(request.maxWithdrawalMarkerBytes <= request.maxPageBytes && /^[a-f0-9]{64}$/.test(request.journalDigest) && /^[a-f0-9]{64}$/.test(request.prefix.eventsDigest) && Array.isArray(required) && required.length <= request.maxVersions, 'invalid historical source use');
    // Bound caller metadata before copying it; the trusted recorder fixes this exact complete scope.
    let refBytes = 0;
    for (let i = 0; i < required.length; i++) { const original = required[i]!; this.validateRef(original); const ref = { versionId: original.versionId, namespace: original.namespace, key: original.key, revision: original.revision, sha256: original.sha256 }; this.validateRef(ref); invariant(i === 0 || request.requiredVersions[i - 1]!.versionId < ref.versionId, 'duplicate or unordered required version'); refBytes = checked(refBytes + Buffer.byteLength(canonicalJson(ref))); invariant(refBytes <= request.maxVersionBytes, 'historical version scope exceeds bound'); request.requiredVersions.push(ref); }
    return this.withDevelopmentFence(() => {
      try {
        const prefix = this.developmentPreflight('events', request.maxPageBytes, request.prefix.lastSequence);
        invariant(prefix.last === request.prefix.lastSequence && prefix.bytes <= request.maxPrefixBytes && this.developmentHighWater() >= prefix.last, 'historical source prefix differs or exceeds bound');
        const binding = this.boundedJournalBinding(request.maxPageBytes); invariant(hash(canonicalJson(binding)) === request.journalDigest, 'historical journal binding differs');
        const graph = this.replayDevelopmentGraph(binding, request, prefix.last, checked(prefix.rows + request.maxVersions), request.maxPrefixBytes);
        invariant(graph.eventsDigest === request.prefix.eventsDigest, 'historical source prefix differs');
        let versionBytes = 0;
        // All required rows and associated markers are preflighted before any payload is read.
        for (const ref of request.requiredVersions) {
          invariant(canonicalJson(graph.known.get(ref.versionId) ?? null) === canonicalJson(ref), 'historical version not introduced in prefix');
          const size = this.db.prepare('SELECT length(CAST(value AS BLOB)) AS bytes,typeof(value) AS storage,typeof(revision) AS revisionStorage,revision FROM documents WHERE namespace=? AND key=?').get(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId) as { bytes: number; storage: string; revisionStorage: string; revision: number } | undefined;
          invariant(size && size.storage === 'text' && size.revisionStorage === 'integer' && (size.revision === 1 || size.revision === 2), 'historical version missing or malformed');
          versionBytes = checked(versionBytes + checked(size.bytes)); invariant(versionBytes <= request.maxVersionBytes && size.bytes <= request.maxPageBytes, 'historical versions exceed bound');
          if (size.revision === 2) {
            // json_extract returns only bounded scalar metadata; no payload row is selected here.
            const marker = this.db.prepare('SELECT length(CAST(e.data AS BLOB)) AS dataBytes,length(CAST(e.id AS BLOB)) AS idBytes,length(CAST(e.stream AS BLOB)) AS streamBytes,length(CAST(e.type AS BLOB)) AS typeBytes,typeof(e.data) AS storage,typeof(e.id) AS idStorage,typeof(e.stream) AS streamStorage,typeof(e.type) AS typeStorage,typeof(e.sequence) AS sequenceStorage,(e.sequence BETWEEN 1 AND 9007199254740991) AS validSequence FROM documents d LEFT JOIN events e ON e.id=json_extract(d.value,\'$.withdrawalId\') WHERE d.namespace=? AND d.key=?').get(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId) as { dataBytes: number | null; idBytes: number; streamBytes: number; typeBytes: number; storage: string; idStorage: string; streamStorage: string; typeStorage: string; sequenceStorage: string; validSequence: number };
            invariant(marker.dataBytes !== null && marker.storage === 'text' && marker.idStorage === 'text' && marker.streamStorage === 'text' && marker.typeStorage === 'text' && marker.sequenceStorage === 'integer' && marker.validSequence === 1, 'historical withdrawal marker missing or has invalid storage representation');
            const textBytes = checked(checked(marker.dataBytes) + checked(marker.idBytes) + checked(marker.streamBytes) + checked(marker.typeBytes));
            invariant(checked(textBytes + 256) <= request.maxWithdrawalMarkerBytes && checked(6 * textBytes + 256 + PAGE_HEADER_BYTES) <= request.maxPageBytes, 'historical withdrawal marker exceeds bound');
          }
        }
        for (const ref of request.requiredVersions) {
          const row = this.db.prepare('SELECT revision,CAST(value AS BLOB) AS value FROM documents WHERE namespace=? AND key=?').get(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId) as { revision: number; value: Uint8Array };
          const encoded = developmentText(row.value), payload = JSON.parse(encoded) as JournalPayload; invariant(canonicalJson(payload) === encoded, 'historical payload not canonical');
          if (row.revision === 2) {
            invariant(payload.state === 'withdrawn', 'historical withdrawal disposition differs');
            nonempty(payload.withdrawalId, 'historical.withdrawalId');
            const marker = this.db.prepare('SELECT CAST(id AS BLOB) AS id,sequence,CAST(stream AS BLOB) AS stream,CAST(type AS BLOB) AS type,CAST(data AS BLOB) AS data FROM events WHERE id=?').get(payload.withdrawalId) as { id: Uint8Array; sequence: number; stream: Uint8Array; type: Uint8Array; data: Uint8Array } | undefined;
            invariant(marker && developmentText(marker.id) === payload.withdrawalId && developmentText(marker.stream) === binding.stream && developmentText(marker.type) === JOURNAL_WITHDRAWAL && Number.isSafeInteger(marker.sequence) && marker.sequence > binding.anchorSequence, 'historical withdrawal marker differs');
            const markerText = developmentText(marker.data), data = JSON.parse(markerText) as JournalWithdrawalData; invariant(canonicalJson(data) === markerText, 'historical withdrawal marker not canonical'); this.validateDevelopmentWithdrawal(data, payload.withdrawalId, binding);
            invariant(data.refs.some(candidate => canonicalJson(candidate) === canonicalJson(ref)), 'historical withdrawal marker ref differs'); this.validateDevelopmentPayload(payload, row.revision, ref, payload.withdrawalId);
            throw new Error('document-history-withdrawn');
          }
          this.validateDevelopmentPayload(payload, row.revision, ref, graph.withdrawn.get(ref.versionId));
        }
        const observation: SourceUseObservation = { journalDigest: request.journalDigest, prefixSequence: prefix.last, prefixDigest: graph.eventsDigest, observedLastSequence: this.developmentHighWater(), requiredVersionsDigest: hash(canonicalJson(request.requiredVersions)), checkedVersions: request.requiredVersions.length };
        return synchronous(use(Object.freeze(observation)));
      } catch (error) { if (error instanceof Error && error.message === 'document-history-withdrawn') throw error; throw new Error('document-history-corrupt-or-missing', { cause: error }); }
    });
  }
  private internalWrite(namespace: string, key: string, value: unknown): void {
    const previous = this.get(namespace, key);
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(namespace, key, (previous?.revision ?? 0) + 1, canonicalJson(value));
  }
  private validateRef(ref: JournalRef): void {
    invariant(ref && typeof ref === 'object', 'invalid document journal ref');
    for (const key in ref) invariant(['versionId', 'namespace', 'key', 'revision', 'sha256'].includes(key), 'invalid document journal ref fields');
    nonempty(ref.versionId, 'journal.versionId'); nonempty(ref.namespace, 'journal.namespace'); nonempty(ref.key, 'journal.key');
    invariant(!reservedJournalNamespace(ref.namespace) && Number.isSafeInteger(ref.revision) && ref.revision > 0 && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256), 'invalid document journal ref');
    invariant(canonicalJson(ref) === canonicalJson({ versionId: ref.versionId, namespace: ref.namespace, key: ref.key, revision: ref.revision, sha256: ref.sha256 }), 'invalid document journal ref fields');
  }
  private createJournalVersion(namespace: string, key: string, document: Document): JournalRef {
    const ref: JournalRef = { versionId: randomUUID(), namespace, key, revision: document.revision, sha256: documentDigest(document) };
    this.internalWrite(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId, { ref, state: 'available', document });
    this.internalWrite(DOCUMENT_JOURNAL_HEAD_NAMESPACE, documentKey(namespace, key), ref);
    return ref;
  }
  private journalBefore(binding: DocumentJournalBinding | null, namespace: string, key: string, before: Document | null): JournalRef | null {
    if (!binding) return null;
    const head = this.get<JournalRef>(DOCUMENT_JOURNAL_HEAD_NAMESPACE, documentKey(namespace, key));
    invariant(Boolean(head) === Boolean(before), 'document journal head missing or unexpected');
    if (!before) return null;
    const ref = head!.value; this.validateRef(ref);
    invariant(ref.namespace === namespace && ref.key === key && ref.revision === before.revision && ref.sha256 === documentDigest(before), 'document journal head differs from current document');
    const payload = this.get<JournalPayload>(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId);
    invariant(payload && payload.revision === (payload.value.state === 'available' ? 1 : 2) && canonicalJson(payload.value.ref) === canonicalJson(ref), 'document journal payload missing or changed');
    this.validatePayload(payload.value, binding);
    return ref;
  }
  private validatePayload(payload: JournalPayload, binding: DocumentJournalBinding): void {
    this.validateRef(payload.ref);
    if (payload.state === 'available') {
      invariant(payload.document?.revision === payload.ref.revision && canonicalJson(payload.document) === canonicalJson({ revision: payload.document.revision, value: payload.document.value }) && documentDigest(payload.document) === payload.ref.sha256, 'document journal payload commitment mismatch');
      invariant(canonicalJson(payload) === canonicalJson({ ref: payload.ref, state: 'available', document: payload.document }), 'invalid document journal payload fields');
    } else {
      invariant(payload.state === 'withdrawn', 'invalid document journal payload state');
      nonempty(payload.withdrawalId, 'journal.withdrawalId');
      invariant(canonicalJson(payload) === canonicalJson({ ref: payload.ref, state: 'withdrawn', withdrawalId: payload.withdrawalId }), 'invalid document journal withdrawn fields');
      const marker = this.db.prepare('SELECT stream,type,data FROM events WHERE id=?').get(payload.withdrawalId) as { stream: string; type: string; data: string } | undefined;
      invariant(marker && marker.stream === binding.stream && marker.type === JOURNAL_WITHDRAWAL, 'document journal withdrawal marker missing');
      const data = JSON.parse(marker.data) as JournalWithdrawalData;
      invariant(data.schema === JOURNAL_SCHEMA && data.hostId === binding.hostId && data.withdrawalId === payload.withdrawalId && (data.reason === 'forget' || data.reason === 'expiry') && Array.isArray(data.refs) && data.refs.some(ref => canonicalJson(ref) === canonicalJson(payload.ref)), 'document journal withdrawal marker differs');
    }
  }
  private journalMutation(binding: DocumentJournalBinding | null, namespace: string, key: string, before: JournalRef | null, after: Document | null): void {
    if (!binding) return;
    const next = after ? this.createJournalVersion(namespace, key, after) : null;
    if (!after) this.db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(DOCUMENT_JOURNAL_HEAD_NAMESPACE, documentKey(namespace, key));
    this.insertEvent({ id: randomUUID(), stream: binding.stream, type: JOURNAL_MUTATION, data: { schema: JOURNAL_SCHEMA, hostId: binding.hostId, namespace, key, before, after: next } });
  }
  withdrawDocumentJournalContent(input: JournalWithdrawalInput): { withdrawalId: string | null; withdrawnVersionIds: string[] } {
    this.assertDevelopmentWrite();
    return this.transaction(() => {
      // Canonicalize caller-controlled fields inside the transaction so serialization side effects roll back.
      const request = JSON.parse(canonicalJson(input)) as JournalWithdrawalInput;
      nonempty(request.id, 'withdrawal.id'); invariant(request.reason === 'forget' || request.reason === 'expiry', 'invalid withdrawal reason');
      invariant(Array.isArray(request.targets), 'invalid withdrawal targets');
      for (const target of request.targets) {
        nonempty(target.namespace, 'withdrawal.namespace'); nonempty(target.key, 'withdrawal.key');
        invariant(!reservedJournalNamespace(target.namespace) && (target.expectedRevision === null || Number.isSafeInteger(target.expectedRevision) && target.expectedRevision > 0), 'invalid withdrawal target');
        invariant(canonicalJson(target) === canonicalJson({ namespace: target.namespace, key: target.key, expectedRevision: target.expectedRevision }), 'invalid withdrawal target fields');
      }
      request.targets.sort(compareKeys);
      invariant(new Set(request.targets.map(target => documentKey(target.namespace, target.key))).size === request.targets.length, 'duplicate withdrawal target');
      invariant(canonicalJson(request) === canonicalJson({ id: request.id, reason: request.reason, targets: request.targets }), 'invalid withdrawal request fields');
      const binding = this.readJournalBinding();
      const previous = this.db.prepare('SELECT stream,type,data FROM events WHERE id=?').get(request.id) as { stream: string; type: string; data: string } | undefined;
      if (previous) {
        invariant(binding && previous.stream === binding.stream && previous.type === JOURNAL_WITHDRAWAL, 'conflicting withdrawal identity');
        const data = JSON.parse(previous.data) as JournalWithdrawalData;
        invariant(data.schema === JOURNAL_SCHEMA && data.hostId === binding.hostId && data.withdrawalId === request.id && data.reason === request.reason && canonicalJson(data.targets) === canonicalJson(request.targets), 'conflicting withdrawal identity');
        this.validateJournalSnapshot(this.snapshotForJournalValidation(binding));
        return { withdrawalId: request.id, withdrawnVersionIds: data.refs.map(ref => ref.versionId) };
      }
      for (const target of request.targets) if ((this.get(target.namespace, target.key)?.revision ?? null) !== target.expectedRevision) throw new RevisionConflict('withdrawal revision conflict');
      if (!binding) return { withdrawalId: null, withdrawnVersionIds: [] };
      // Bounded capture checks every owned ref/marker/head before selecting a cutoff.
      const snapshot = this.snapshotForJournalValidation(binding); this.validateJournalSnapshot(snapshot);
      const selected = new Set(request.targets.map(target => documentKey(target.namespace, target.key)));
      const refs = snapshot.journalPayloads.filter(payload => payload.state === 'available' && selected.has(documentKey(payload.ref.namespace, payload.ref.key))).map(payload => payload.ref);
      for (const ref of refs) this.internalWrite(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId, { ref, state: 'withdrawn', withdrawalId: request.id });
      this.insertEvent({ id: request.id, stream: binding.stream, type: JOURNAL_WITHDRAWAL, data: { schema: JOURNAL_SCHEMA, hostId: binding.hostId, withdrawalId: request.id, reason: request.reason, targets: request.targets, refs } });
      return { withdrawalId: request.id, withdrawnVersionIds: refs.map(ref => ref.versionId) };
    });
  }
  private snapshotForJournalValidation(binding: DocumentJournalBinding): DevelopmentSnapshot {
    // Mutation/withdrawal validation must not inherit the observer's finite capture allowance.
    const journalPayloads = (this.db.prepare('SELECT key,revision,value FROM documents WHERE namespace=? ORDER BY key').all(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE) as { key: string; revision: number; value: string }[]).map(row => {
      const payload = JSON.parse(row.value) as JournalPayload;
      invariant(payload.ref?.versionId === row.key && row.revision === (payload.state === 'available' ? 1 : 2), 'invalid document journal payload row'); return payload;
    });
    return { documents: this.documentRows(), events: this.events(), journalBinding: binding, journalPayloads };
  }
  private validateJournalSnapshot(snapshot: DevelopmentSnapshot): void {
    const binding = snapshot.journalBinding;
    const heads = this.db.prepare('SELECT key,value FROM documents WHERE namespace=? ORDER BY key').all(DOCUMENT_JOURNAL_HEAD_NAMESPACE) as { key: string; value: string }[];
    if (!binding) { invariant(snapshot.journalPayloads.length === 0 && heads.length === 0, 'unbound document journal internal rows'); return; }
    const highWater = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get() as { seq: number } | undefined;
    invariant(snapshot.events.length === (highWater?.seq ?? 0), 'document journal event prefix incomplete');
    const payloads = new Map(snapshot.journalPayloads.map(payload => [payload.ref.versionId, payload]));
    invariant(payloads.size === snapshot.journalPayloads.length, 'duplicate document journal payload');
    for (const payload of payloads.values()) this.validatePayload(payload, binding);
    const known = new Map<string, JournalRef>(), current = new Map<string, JournalRef>(), withdrawn = new Map<string, string>();
    const register = (ref: JournalRef) => {
      this.validateRef(ref); invariant(!known.has(ref.versionId), 'duplicate document journal version');
      invariant(payloads.has(ref.versionId) && canonicalJson(payloads.get(ref.versionId)!.ref) === canonicalJson(ref), 'document journal payload missing or changed');
      known.set(ref.versionId, ref);
    };
    let anchored = false;
    for (let index = 0; index < snapshot.events.length; index++) {
      const event = snapshot.events[index]!; invariant(event.sequence === index + 1, 'document journal event prefix incomplete');
      if (![JOURNAL_ANCHOR, JOURNAL_MUTATION, JOURNAL_WITHDRAWAL].includes(event.type)) continue;
      invariant(event.stream === binding.stream, 'document journal stream differs');
      const data = event.data as unknown as Record<string, unknown>;
      invariant(data.schema === JOURNAL_SCHEMA && data.hostId === binding.hostId, 'document journal event binding differs');
      if (event.type === JOURNAL_ANCHOR) {
        invariant(!anchored && event.id === binding.anchorId && event.sequence === binding.anchorSequence && Array.isArray(data.documents), 'invalid document journal anchor');
        const refs = data.documents as JournalRef[];
        invariant(canonicalJson(data) === canonicalJson({ schema: JOURNAL_SCHEMA, hostId: binding.hostId, maxAnchorDocuments: binding.maxAnchorDocuments, maxAnchorBytes: binding.maxAnchorBytes, documents: refs }), 'invalid document journal anchor fields');
        for (let i = 0; i < refs.length; i++) { const ref = refs[i]!; invariant(i === 0 || compareKeys(refs[i - 1]!, ref) < 0, 'unordered document journal anchor'); register(ref); current.set(documentKey(ref.namespace, ref.key), ref); }
        anchored = true;
      } else if (event.type === JOURNAL_MUTATION) {
        invariant(anchored && typeof data.namespace === 'string' && typeof data.key === 'string', 'invalid document journal mutation');
        const { namespace, key } = data, before = data.before as JournalRef | null, after = data.after as JournalRef | null;
        invariant(canonicalJson(data) === canonicalJson({ schema: JOURNAL_SCHEMA, hostId: binding.hostId, namespace, key, before, after }), 'invalid document journal mutation fields');
        const name = documentKey(namespace, key);
        invariant(canonicalJson(current.get(name) ?? null) === canonicalJson(before), 'document journal before ref differs');
        invariant(before !== null || after !== null, 'empty document journal mutation');
        if (after) { invariant(after.namespace === namespace && after.key === key && after.revision === (before?.revision ?? 0) + 1, 'invalid document journal after revision'); register(after); current.set(name, after); }
        else current.delete(name);
      } else {
        invariant(anchored, 'withdrawal precedes document journal anchor');
        const marker = data as unknown as JournalWithdrawalData;
        invariant(marker.withdrawalId === event.id && (marker.reason === 'forget' || marker.reason === 'expiry') && Array.isArray(marker.targets) && Array.isArray(marker.refs), 'invalid document journal withdrawal');
        invariant(canonicalJson(marker) === canonicalJson({ schema: JOURNAL_SCHEMA, hostId: binding.hostId, withdrawalId: event.id, reason: marker.reason, targets: marker.targets, refs: marker.refs }), 'invalid document journal withdrawal fields');
        const selected = new Set<string>();
        for (let i = 0; i < marker.targets.length; i++) {
          const target = marker.targets[i]!;
          nonempty(target.namespace, 'withdrawal.namespace'); nonempty(target.key, 'withdrawal.key');
          invariant(!reservedJournalNamespace(target.namespace) && canonicalJson(target) === canonicalJson({ namespace: target.namespace, key: target.key, expectedRevision: target.expectedRevision }) && (i === 0 || compareKeys(marker.targets[i - 1]!, target) < 0) && (current.get(documentKey(target.namespace, target.key))?.revision ?? null) === target.expectedRevision, 'invalid document journal withdrawal target');
          selected.add(documentKey(target.namespace, target.key));
        }
        const expected = [...known.values()].filter(ref => !withdrawn.has(ref.versionId) && selected.has(documentKey(ref.namespace, ref.key))).sort((a, b) => a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0);
        invariant(canonicalJson(marker.refs) === canonicalJson(expected), 'document journal withdrawal refs differ');
        for (const ref of marker.refs) withdrawn.set(ref.versionId, event.id);
      }
    }
    invariant(anchored && known.size === payloads.size, 'document journal anchor missing or orphan payload');
    for (const [id, payload] of payloads) invariant(withdrawn.has(id) ? payload.state === 'withdrawn' && payload.withdrawalId === withdrawn.get(id) : payload.state === 'available', 'document journal withdrawal disposition differs');
    const documents = snapshot.documents.filter(row => row.namespace !== DOCUMENT_JOURNAL_NAMESPACE);
    invariant(documents.length === current.size && heads.length === current.size, 'document journal current inventory differs');
    for (const row of documents) { const ref = current.get(documentKey(row.namespace, row.key)); invariant(ref && ref.revision === row.revision && ref.sha256 === documentDigest({ revision: row.revision, value: row.value }), 'document journal current document differs'); }
    for (const head of heads) invariant(canonicalJson(current.get(head.key) ?? null) === canonicalJson(JSON.parse(head.value)), 'document journal current head differs');
  }
  put(namespace: string, key: string, value: unknown, expectedRevision: number | null): number {
    this.assertDevelopmentWrite();
    nonempty(namespace, 'namespace'); nonempty(key, 'key'); const encoded = canonicalJson(value);
    invariant(!reservedJournalNamespace(namespace), 'reserved document journal namespace');
    return this.transaction(() => {
      const binding = this.readJournalBinding();
      const previous = this.get(namespace, key);
      if ((previous?.revision ?? null) !== expectedRevision) throw new RevisionConflict(`${namespace}/${key}: expected ${expectedRevision}, found ${previous?.revision ?? null}`);
      const before = this.journalBefore(binding, namespace, key, previous ?? null);
      const revision = (previous?.revision ?? 0) + 1;
      this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(namespace, key, revision, encoded);
      this.journalMutation(binding, namespace, key, before, { revision, value: JSON.parse(encoded) as JsonValue });
      return revision;
    });
  }
  delete(namespace: string, key: string, expectedRevision: number): void {
    this.assertDevelopmentWrite();
    nonempty(namespace, 'namespace'); nonempty(key, 'key'); invariant(!reservedJournalNamespace(namespace), 'reserved document journal namespace');
    this.transaction(() => { const binding = this.readJournalBinding(); const existing = this.get(namespace, key); if (existing?.revision !== expectedRevision) throw new RevisionConflict('delete revision conflict'); const before = this.journalBefore(binding, namespace, key, existing); this.db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(namespace, key); this.journalMutation(binding, namespace, key, before, null); });
  }
  append(input: EventInput): StoredEvent {
    this.assertDevelopmentWrite();
    const { id, stream, type } = input;
    invariant(type !== JOURNAL_ANCHOR && type !== JOURNAL_MUTATION && type !== JOURNAL_WITHDRAWAL, 'reserved document journal event type');
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
    this.assertDevelopmentWrite();
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
  /** Scalar initial-state contamination check on this actual open connection. */
  hasArtifacts(): boolean { return Boolean(this.db.prepare('SELECT 1 FROM artifacts LIMIT 1').get()); }
}
