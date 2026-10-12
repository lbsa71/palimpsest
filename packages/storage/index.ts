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
  private internalWrite(namespace: string, key: string, value: unknown): void {
    const previous = this.get(namespace, key);
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(namespace, key, (previous?.revision ?? 0) + 1, canonicalJson(value));
  }
  private validateRef(ref: JournalRef): void {
    invariant(ref && typeof ref === 'object', 'invalid document journal ref');
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
    const documents = snapshot.documents.filter(row => !reservedJournalNamespace(row.namespace));
    invariant(documents.length === current.size && heads.length === current.size, 'document journal current inventory differs');
    for (const row of documents) { const ref = current.get(documentKey(row.namespace, row.key)); invariant(ref && ref.revision === row.revision && ref.sha256 === documentDigest({ revision: row.revision, value: row.value }), 'document journal current document differs'); }
    for (const head of heads) invariant(canonicalJson(current.get(head.key) ?? null) === canonicalJson(JSON.parse(head.value)), 'document journal current head differs');
  }
  put(namespace: string, key: string, value: unknown, expectedRevision: number | null): number {
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
    nonempty(namespace, 'namespace'); nonempty(key, 'key'); invariant(!reservedJournalNamespace(namespace), 'reserved document journal namespace');
    this.transaction(() => { const binding = this.readJournalBinding(); const existing = this.get(namespace, key); if (existing?.revision !== expectedRevision) throw new RevisionConflict('delete revision conflict'); const before = this.journalBefore(binding, namespace, key, existing); this.db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(namespace, key); this.journalMutation(binding, namespace, key, before, null); });
  }
  append(input: EventInput): StoredEvent {
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
