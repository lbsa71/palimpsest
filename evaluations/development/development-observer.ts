import { createHash } from 'node:crypto';
import { canonicalJson, digest, identity, invariant, nonempty, validateGoal, validateObservation, validatePhysicalRequest, validateProvenance, validateRun, validateScope } from '../../packages/contracts/index.ts';
import type { ArtifactRef, Effect, Goal, InboundInput, Observation, PhysicalRequest, PromptManifest, Provenance, Run, ShellCheckpoint, ShellResult } from '../../packages/contracts/index.ts';
import { inputIdentity } from '../../packages/contracts/execution/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
import { DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY } from '../../packages/storage/index.ts';
import type { DevelopmentSnapshot, Document, DocumentJournalBinding, JournalPayload, JournalRef, StoredEvent } from '../../packages/storage/index.ts';
import type { AcquiredCaptureReader } from './acquire.ts';
import { developmentRequestIdentity } from './review-envelope.ts';

export interface DevelopmentSourceClock { kind: 'host' | 'synthetic'; wallMs: number; monotonicMs: number; bootId: string; processStart: string }
export interface DevelopmentSourceCapture {
  roleId: string; source: { pathIdentity: { device: string; inode: string }; journalDigest: string };
  configurationDigest: string; clock: DevelopmentSourceClock; snapshot: DevelopmentSnapshot;
}
export interface DevelopmentSourceInput {
  before: ArtifactRef; after: ArtifactRef; current: ArtifactRef; assignmentPacket: ArtifactRef;
  roleId: string; configurationDigest: string; pathIdentity: { device: string; inode: string }; journal: DocumentJournalBinding;
  bounds: { maxCaptureBytes: number; maxArtifactBytes: number; maxRows: number; maxProofBytes: number };
  readArtifact(ref: ArtifactRef, maxBytes: number): Uint8Array;
}
export type DevelopmentEventPosition = Pick<StoredEvent, 'id' | 'sequence' | 'stream' | 'type'>;
export interface DevelopmentSourceProof { events: DevelopmentEventPosition[]; versions: JournalRef[]; artifacts: ArtifactRef[] }
export interface DevelopmentRuntimeResultSource {
  status: 'completed' | 'checkpointed' | 'cancelled' | 'blocked'; messageSequence: number; observationIds: string[];
  origin: { invocation: DevelopmentEventPosition; execution: JournalRef; disposition: DevelopmentEventPosition };
}
export interface DevelopmentCycleSource {
  interval: { before: ArtifactRef; after: ArtifactRef; lowerWallMs: number; upperWallMs: number; clockKind: 'host' | 'synthetic' };
  selection: DevelopmentEventPosition; schedulerSequence: number; goal: Goal; provenance: Provenance;
  origin: 'request' | 'unknown'; runId: string; runStatus: Run['status'];
  requests: { id: string; status: PhysicalRequest['status']; purpose: PhysicalRequest['purpose'] }[];
  ancestry: { event: DevelopmentEventPosition; input: InboundInput }[];
  result: DevelopmentRuntimeResultSource | null;
  observations: { id: string; kind: Observation['kind']; sourceId: string }[]; proof: DevelopmentSourceProof;
}
export interface DevelopmentAssignmentSource {
  assignmentId: string; entryDigest: string; input: InboundInput; conversation: string;
  runId: string; runStatus: Run['status']; ingress: DevelopmentEventPosition; linkage: 'admitted' | 'steering';
  result: DevelopmentRuntimeResultSource | null;
  observations: { id: string; kind: Observation['kind']; sourceId: string }[]; proof: DevelopmentSourceProof;
}
export interface DevelopmentSourceProjection {
  version: 1; kind: 'proposed-source-facts'; roleId: string;
  captures: { artifact: ArtifactRef; snapshotDigest: string; cursor: number }[];
  assignmentPacket: ArtifactRef; interval: { before: DevelopmentSourceClock; after: DevelopmentSourceClock } | null;
  clockQualification: 'synthetic' | 'requires-host-qualification' | 'unavailable';
  cycles: DevelopmentCycleSource[]; assignments: DevelopmentAssignmentSource[];
  unavailable: { subject: string; reason: string }[];
}
interface Version { ref: JournalRef; start: number; end: number }
export type DevelopmentPageReader = Pick<AcquiredCaptureReader, 'manifest' | 'assertUsableNow' | 'forEachEvent' | 'forEachCurrentDocument' | 'resolveJournalVersion' | 'resolveEvent' | 'resolve'>;
export interface DevelopmentPageSourceInput extends DevelopmentSourceInput {
  metadataBounds: { maxRecords: number; maxBytes: number };
  openAcquiredCapture(ref: ArtifactRef): DevelopmentPageReader;
}
interface PayloadMetadata { ref: JournalRef; state: 'available' | 'withdrawn'; withdrawalId?: string }
interface Graph {
  capture: { clock: DevelopmentSourceClock }; events: StoredEvent[]; eventDigests: string[]; snapshotDigest: string;
  versions: Version[]; payloads: Map<string, PayloadMetadata>;
  resolveVersion(ref: JournalRef): Document; assertUsable(): void; resolveArtifact?(ref: ArtifactRef, maxBytes: number): Uint8Array;
}
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const exact = (v: object, keys: string) => invariant(Object.keys(v).sort().join(',') === keys.split(',').sort().join(','), 'unexpected source fields');
const key = (v: { namespace: string; key: string }) => canonicalJson([v.namespace, v.key]);
const position = (e: StoredEvent): DevelopmentEventPosition => ({ id: e.id, sequence: e.sequence, stream: e.stream, type: e.type });
const reserved = (s: string) => s === DOCUMENT_JOURNAL_NAMESPACE || s.startsWith(`${DOCUMENT_JOURNAL_NAMESPACE}.`);
const compare = (a: { namespace: string; key: string }, b: { namespace: string; key: string }) => Buffer.compare(Buffer.from(a.namespace), Buffer.from(b.namespace)) || Buffer.compare(Buffer.from(a.key), Buffer.from(b.key));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Validates retained v2 refs without hydrating withdrawn values or accessing a live Store. */
function graph(capture: DevelopmentSourceCapture, input: Omit<DevelopmentSourceInput, 'readArtifact'>): Graph {
  exact(capture, 'roleId,source,configurationDigest,clock,snapshot'); exact(capture.source, 'pathIdentity,journalDigest');
  invariant(capture.roleId === input.roleId && capture.configurationDigest === input.configurationDigest && equal(capture.source.pathIdentity, input.pathIdentity), 'role/configuration/source identity differs');
  const s = capture.snapshot, b = s.journalBinding;
  exact(s, 'documents,events,journalBinding,journalPayloads');
  invariant(b?.schema === 'aeon.document-journal.v2' && equal(b, input.journal) && capture.source.journalDigest === identity(b), 'v2 registered journal binding required');
  exact(b, 'schema,stream,hostId,maxAnchorDocuments,maxAnchorBytes,anchorId,anchorSequence');
  nonempty(b.stream, 'journal stream'); nonempty(b.hostId, 'journal host'); nonempty(b.anchorId, 'journal anchor');
  invariant(Number.isSafeInteger(b.anchorSequence) && b.anchorSequence > 0 && Number.isSafeInteger(b.maxAnchorDocuments) && b.maxAnchorDocuments >= 0 && b.maxAnchorDocuments <= 512 && Number.isSafeInteger(b.maxAnchorBytes) && b.maxAnchorBytes >= 0 && b.maxAnchorBytes <= 1_048_576, 'invalid journal bounds');
  invariant(Array.isArray(s.events) && Array.isArray(s.documents) && Array.isArray(s.journalPayloads), 'source arrays required');
  // Reconstruct hidden head row count too; capture budgets include the real store's internals.
  const rows = s.documents.length + s.events.length + s.journalPayloads.length + s.documents.filter(d => !reserved(d.namespace)).length;
  invariant(rows <= input.bounds.maxRows, 'source row bound exceeded');
  invariant(new Set(s.events.map(e => e.id)).size === s.events.length && new Set(s.documents.map(key)).size === s.documents.length, 'duplicate event/document source');
  const payloads = new Map<string, JournalPayload>();
  const validRef = (r: JournalRef) => {
    exact(r, 'versionId,namespace,key,revision,sha256'); nonempty(r.versionId, 'version id'); nonempty(r.namespace, 'namespace'); nonempty(r.key, 'key'); digest(r.sha256);
    invariant(!reserved(r.namespace) && Number.isSafeInteger(r.revision) && r.revision > 0, 'invalid journal ref');
  };
  for (const p of s.journalPayloads) {
    validRef(p.ref); invariant(!payloads.has(p.ref.versionId), 'duplicate payload'); payloads.set(p.ref.versionId, p);
    if (p.state === 'available') { exact(p, 'ref,state,document'); exact(p.document, 'revision,value'); invariant(p.document.revision === p.ref.revision && identity(p.document) === p.ref.sha256, 'payload commitment differs'); }
    else { exact(p, 'ref,state,withdrawalId'); invariant(p.state === 'withdrawn', 'invalid payload disposition'); nonempty(p.withdrawalId, 'withdrawal id'); }
  }
  const known = new Map<string, JournalRef>(), heads = new Map<string, Version>(), withdrawn = new Map<string, string>(), versions: Version[] = [];
  const register = (ref: JournalRef, sequence: number) => {
    validRef(ref); invariant(!known.has(ref.versionId) && equal(payloads.get(ref.versionId)?.ref ?? null, ref), 'missing/changed/orphan journal payload');
    known.set(ref.versionId, ref); const v = { ref, start: sequence, end: Infinity }; versions.push(v); heads.set(key(ref), v);
  };
  let anchored = false;
  for (const [i, e] of s.events.entries()) {
    exact(e, 'sequence,id,stream,type,data'); nonempty(e.id, 'event id'); nonempty(e.stream, 'stream'); nonempty(e.type, 'event type'); invariant(e.sequence === i + 1, 'event prefix omitted/reordered');
    if (!['document-journal-anchor', 'document-mutation', 'document-journal-withdrawal'].includes(e.type)) continue;
    invariant(e.stream === b.stream, 'journal stream differs');
    const d = e.data as unknown as Record<string, unknown>;
    invariant(d.schema === b.schema && d.hostId === b.hostId, 'journal event binding differs');
    if (e.type === 'document-journal-anchor') {
      exact(d, 'schema,hostId,maxAnchorDocuments,maxAnchorBytes,documents');
      invariant(!anchored && e.id === b.anchorId && e.sequence === b.anchorSequence && d.maxAnchorDocuments === b.maxAnchorDocuments && d.maxAnchorBytes === b.maxAnchorBytes && Array.isArray(d.documents) && Buffer.byteLength(canonicalJson(d)) <= b.maxAnchorBytes, 'invalid journal anchor');
      const refs = d.documents as JournalRef[]; invariant(refs.length <= b.maxAnchorDocuments, 'anchor row bound exceeded');
      refs.forEach((r, j) => { invariant(j === 0 || compare(refs[j - 1]!, r) < 0, 'unordered/duplicate anchor'); register(r, e.sequence); }); anchored = true;
    } else if (e.type === 'document-mutation') {
      exact(d, 'schema,hostId,namespace,key,before,after'); invariant(anchored, 'mutation before anchor');
      const row = d as unknown as { namespace: string; key: string; before: JournalRef | null; after: JournalRef | null };
      nonempty(row.namespace, 'mutation namespace'); nonempty(row.key, 'mutation key'); invariant(!reserved(row.namespace), 'reserved mutation');
      const old = heads.get(key(row)); invariant(equal(old?.ref ?? null, row.before) && (row.before !== null || row.after !== null), 'journal before ref differs');
      if (old) old.end = e.sequence;
      if (row.after) { invariant(row.after.namespace === row.namespace && row.after.key === row.key && row.after.revision === (row.before?.revision ?? 0) + 1, 'journal revision gap'); register(row.after, e.sequence); }
      else heads.delete(key(row));
    } else {
      exact(d, 'schema,hostId,withdrawalId,reason,targets,refs'); invariant(anchored && d.withdrawalId === e.id && ['forget', 'expiry'].includes(String(d.reason)) && Array.isArray(d.targets) && Array.isArray(d.refs), 'invalid withdrawal');
      const targets = d.targets as { namespace: string; key: string; expectedRevision: number | null }[], selected = new Set<string>();
      targets.forEach((t, j) => { exact(t, 'namespace,key,expectedRevision'); nonempty(t.namespace, 'withdrawal namespace'); nonempty(t.key, 'withdrawal key'); invariant(!reserved(t.namespace) && (j === 0 || compare(targets[j - 1]!, t) < 0) && (heads.get(key(t))?.ref.revision ?? null) === t.expectedRevision, 'withdrawal target differs'); selected.add(key(t)); });
      const refs = [...known.values()].filter(r => !withdrawn.has(r.versionId) && selected.has(key(r))).sort((a, c) => a.versionId < c.versionId ? -1 : a.versionId > c.versionId ? 1 : 0);
      invariant(equal(refs, d.refs), 'withdrawal ref graph differs'); refs.forEach(r => withdrawn.set(r.versionId, e.id));
    }
  }
  invariant(anchored && known.size === payloads.size, 'anchor missing/orphan payload');
  for (const [id, p] of payloads) invariant(withdrawn.has(id) ? p.state === 'withdrawn' && p.withdrawalId === withdrawn.get(id) : p.state === 'available', 'withdrawal disposition differs');
  const bindingRows = s.documents.filter(d => reserved(d.namespace));
  invariant(bindingRows.length === 1 && equal(bindingRows[0], { namespace: DOCUMENT_JOURNAL_NAMESPACE, key: DOCUMENT_JOURNAL_KEY, revision: 1, value: b }), 'binding row differs');
  const docs = s.documents.filter(d => !reserved(d.namespace)); invariant(docs.length === heads.size, 'current source inventory differs');
  for (const d of docs) { exact(d, 'namespace,key,revision,value'); const ref = heads.get(key(d))?.ref; invariant(ref && ref.revision === d.revision && ref.sha256 === identity({ revision: d.revision, value: d.value }), 'current source version differs'); }
  return { capture, events: s.events, eventDigests: s.events.map(identity), snapshotDigest: identity(s), versions, payloads,
    resolveVersion(ref) { const p = payloads.get(ref.versionId); invariant(p?.state === 'available', 'source version missing/withdrawn at current capture'); return p.document; }, assertUsable() {} };
}

/** Counts retained metadata serialization, not engine heap or ephemeral reader pages. */
function metadataBudget(bounds?: DevelopmentPageSourceInput['metadataBounds']): (value: unknown) => void {
  if (!bounds) return () => {};
  exact(bounds, 'maxRecords,maxBytes');
  for (const n of Object.values(bounds)) invariant(Number.isSafeInteger(n) && n > 0, 'fixed metadata bounds required');
  const maxRecords = bounds.maxRecords, maxBytes = bounds.maxBytes;
  let records = 0, bytes = 0;
  return value => {
    const next = Buffer.byteLength(canonicalJson(value));
    invariant(records < maxRecords && next <= maxBytes - bytes, 'source metadata record/byte bound exceeded');
    records++; bytes += next;
  };
}

/** Owner validates the complete physical graph; this adapter keeps only provenance indices. */
function pageGraph(reader: DevelopmentPageReader, artifact: ArtifactRef, input: Omit<DevelopmentSourceInput, 'readArtifact'>, charge: (v: unknown) => void, recheck: () => void): Graph {
  recheck();
  const encoded = canonicalJson(reader.manifest); invariant(Buffer.byteLength(encoded) <= input.bounds.maxCaptureBytes, 'capture manifest byte bound exceeded');
  charge(reader.manifest); const m = JSON.parse(encoded) as DevelopmentPageReader['manifest'];
  exact(m, 'version,roleId,source,configurationDigest,clock,cut'); exact(m.source, 'pathIdentity,journalDigest');
  digest(artifact.sha256); invariant(artifact.uri === `sha256:${artifact.sha256}` && hash(Buffer.from(encoded)) === artifact.sha256, 'exact capture manifest commitment differs');
  invariant(m.version === 1 && m.roleId === input.roleId && m.configurationDigest === input.configurationDigest && equal(m.source.pathIdentity, input.pathIdentity), 'role/configuration/source identity differs');
  invariant(equal(m.cut.journalBinding, input.journal) && m.source.journalDigest === identity(input.journal), 'v2 registered journal binding required');
  invariant(Number.isSafeInteger(m.cut.lastSequence) && m.cut.lastSequence >= 0 && m.cut.events === m.cut.lastSequence, 'event cut differs');
  const events: StoredEvent[] = [], eventDigests: string[] = [], versions: Version[] = [], payloads = new Map<string, PayloadMetadata>(), heads = new Map<string, Version>();
  const register = (ref: JournalRef, start: number) => {
    exact(ref, 'versionId,namespace,key,revision,sha256'); digest(ref.sha256);
    invariant(!payloads.has(ref.versionId) && !reserved(ref.namespace) && Number.isSafeInteger(ref.revision) && ref.revision > 0, 'invalid/duplicate journal ref');
    const v = { ref: { ...ref }, start, end: Infinity };
    charge({ ref, start }); versions.push(v); payloads.set(ref.versionId, { ref: v.ref, state: 'available' }); heads.set(key(ref), v);
  };
  let visiting = true;
  const returned: unknown = reader.forEachEvent(e => {
    invariant(visiting, 'asynchronous event callback forbidden');
    exact(e, 'sequence,id,stream,type,data'); invariant(e.sequence === events.length + 1, 'event prefix omitted/reordered');
    const meta = position(e), commitment = identity(e); charge({ ...meta, sha256: commitment }); eventDigests.push(commitment);
    // Getter is used only after the semantic callback has released its current-use fence.
    events.push({ ...meta, get data() {
      recheck(); const actual = reader.resolveEvent(meta.sequence);
      invariant(equal(position(actual), meta) && identity(actual) === commitment, 'exact event resolver differs'); return actual.data;
    } });
    const d = e.data as unknown as { documents?: JournalRef[]; namespace: string; key: string; before: JournalRef | null; after: JournalRef | null; refs?: JournalRef[]; withdrawalId: string };
    if (e.type === 'document-journal-anchor') for (const ref of d.documents ?? []) register(ref, e.sequence);
    else if (e.type === 'document-mutation') {
      const old = heads.get(key(d)); invariant(equal(old?.ref ?? null, d.before), 'journal before ref differs');
      if (old) old.end = e.sequence;
      if (d.after) register(d.after, e.sequence); else heads.delete(key(d));
    } else if (e.type === 'document-journal-withdrawal') for (const ref of d.refs ?? []) {
      const p = payloads.get(ref.versionId); invariant(p && equal(p.ref, ref), 'withdrawal ref differs');
      charge({ versionId: ref.versionId, withdrawalId: d.withdrawalId }); p.state = 'withdrawn'; p.withdrawalId = d.withdrawalId;
    }
  });
  visiting = false;
  invariant(!returned || typeof (returned as { then?: unknown }).then !== 'function', 'asynchronous page reader forbidden');
  invariant(events.length === m.cut.events, 'event cut omitted'); recheck();
  return { capture: { clock: m.clock }, events, eventDigests, snapshotDigest: identity(m.cut), versions, payloads,
    assertUsable: recheck,
    resolveVersion(ref) {
      recheck(); const result = reader.resolveJournalVersion(ref.versionId);
      invariant(equal(result.ref, ref), 'exact intermediate source ref differs'); return result.document;
    },
    resolveArtifact(ref, maxBytes) { recheck(); return reader.resolve({ ...ref }, maxBytes); } };
}

function prefix(a: Graph, b: Graph): void {
  a.assertUsable(); b.assertUsable();
  invariant(a.events.length <= b.events.length && a.eventDigests.every((d, i) => d === b.eventDigests[i]), 'retained event prefix changed');
  for (const [id, p] of a.payloads) {
    const next = b.payloads.get(id); invariant(next && equal(next.ref, p.ref), 'retained payload prefix changed');
    invariant(p.state === 'available' ? next.state === 'withdrawn' || next.state === 'available' : equal(next, p), 'withdrawn source resurrected/changed');
  }
  const x = a.capture.clock, y = b.capture.clock;
  for (const c of [x, y]) { exact(c, 'kind,wallMs,monotonicMs,bootId,processStart'); invariant(['host', 'synthetic'].includes(c.kind) && Number.isFinite(c.wallMs) && c.wallMs >= 0 && Number.isFinite(c.monotonicMs) && c.monotonicMs >= 0, 'invalid capture clock'); nonempty(c.bootId, 'boot id'); nonempty(c.processStart, 'process start'); }
  invariant(x.kind === y.kind && x.bootId === y.bootId && x.processStart === y.processStart && y.wallMs >= x.wallMs && y.monotonicMs >= x.monotonicMs && Math.abs((y.wallMs - x.wallMs) - (y.monotonicMs - x.monotonicMs)) <= 1000, 'capture clock/session changed or regressed');
}

/** Caller supplies retained sources; only the recorder can authenticate plan/clock/attempt use and sign. */
export function projectDevelopmentSources(given: DevelopmentSourceInput): DevelopmentSourceProjection {
  return projectSources(given);
}

/** Unsigned proposal; only an actual recorder-owned reader authenticates current host use. */
export function projectDevelopmentPageSources(given: DevelopmentPageSourceInput): DevelopmentSourceProjection {
  return projectSources(given, given.openAcquiredCapture, given.metadataBounds);
}

function projectSources(given: DevelopmentSourceInput, open?: DevelopmentPageSourceInput['openAcquiredCapture'], metadataBounds?: DevelopmentPageSourceInput['metadataBounds']): DevelopmentSourceProjection {
  const readArtifact = given.readArtifact;
  const { readArtifact: _reader, ...descriptors } = given;
  // Functions are never serialized as source evidence.
  const clean = { before: descriptors.before, after: descriptors.after, current: descriptors.current, assignmentPacket: descriptors.assignmentPacket, roleId: descriptors.roleId, configurationDigest: descriptors.configurationDigest, pathIdentity: descriptors.pathIdentity, journal: descriptors.journal, bounds: descriptors.bounds };
  const input = JSON.parse(canonicalJson(clean)) as Omit<DevelopmentSourceInput, 'readArtifact'>;
  const output: DevelopmentSourceProjection = { version: 1, kind: 'proposed-source-facts', roleId: input.roleId, captures: [], assignmentPacket: input.assignmentPacket, interval: null, clockQualification: 'unavailable', cycles: [], assignments: [], unavailable: [] };
  const failed = (subject: string, e: unknown) => output.unavailable.push({ subject, reason: (e instanceof Error ? e.message : String(e)).slice(0, 256) });
  let recheck = () => {};
  try {
    for (const [k, v] of Object.entries(input.bounds)) invariant(Number.isSafeInteger(v) && v > 0 && v <= (k === 'maxRows' ? 512 : 1_048_576), 'fixed source/proof bounds required');
    exact(input.bounds, 'maxCaptureBytes,maxArtifactBytes,maxRows,maxProofBytes'); nonempty(input.roleId, 'role id'); digest(input.configurationDigest);
    const read = (ref: ArtifactRef, bound: number) => { digest(ref.sha256); invariant(ref.uri === `sha256:${ref.sha256}`, 'retained content-addressed source required'); const bytes = Uint8Array.from(readArtifact({ ...ref }, bound)); invariant(bytes.byteLength <= bound && hash(bytes) === ref.sha256, 'retained artifact digest/byte bound differs'); return bytes; };
    const json = (ref: ArtifactRef, bound: number): unknown => { const bytes = read(ref, bound), value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8')); invariant(Buffer.from(bytes).toString('utf8') === canonicalJson(value), 'canonical retained source required'); return value; };
    const refs = [input.before, input.after, input.current];
    const readers = open ? refs.map(ref => open({ ...ref })) : [];
    recheck = () => { for (const reader of readers) reader.assertUsableNow(); };
    invariant(!open || metadataBounds !== undefined, 'fixed metadata bounds required');
    const charge = metadataBudget(metadataBounds);
    const captures = open ? readers.map((reader, i) => pageGraph(reader, refs[i]!, input, charge, recheck)) : refs.map(ref => graph(json(ref, input.bounds.maxCaptureBytes) as DevelopmentSourceCapture, input));
    const [before, after, current] = captures as [Graph, Graph, Graph]; prefix(before, after); prefix(after, current);
    output.captures = captures.map((g, i) => ({ artifact: [input.before, input.after, input.current][i]!, snapshotDigest: g.snapshotDigest, cursor: g.events.length }));
    output.interval = { before: before.capture.clock, after: after.capture.clock }; output.clockQualification = after.capture.clock.kind === 'synthetic' ? 'synthetic' : 'requires-host-qualification';
    const events = after.events, cursor = before.events.length;
    const packet = json(input.assignmentPacket, input.bounds.maxArtifactBytes) as { version: number; assignments: { id: string; roleId: string; message: AuthenticatedMessage }[] };
    exact(packet, 'version,assignments'); invariant(packet.version === 1 && Array.isArray(packet.assignments) && packet.assignments.length <= input.bounds.maxRows, 'bounded v1 assignment packet required');
    const seen = new Set<string>();
    for (const entry of packet.assignments) {
      exact(entry, 'id,roleId,message'); nonempty(entry.id, 'assignment id'); nonempty(entry.roleId, 'assignment role');
      const id = canonicalJson([entry.roleId, entry.id]); invariant(!seen.has(id), 'duplicate role-local assignment'); seen.add(id);
      const m = entry.message; exact(m, 'source,externalId,revision,conversation,text,actor'); exact(m.actor, 'id,scope,modificationEligible'); validateScope(m.actor.scope); nonempty(m.actor.id, 'actor');
      for (const s of [m.source, m.externalId, m.revision, m.conversation]) nonempty(s, 'assignment input identity'); invariant(typeof m.text === 'string' && typeof m.actor.modificationEligible === 'boolean', 'exact assignment body/actor required');
    }
    const proof = (): DevelopmentSourceProof => ({ events: [], versions: [], artifacts: [] });
    const addEvent = (p: DevelopmentSourceProof, e: StoredEvent) => { if (!p.events.some(v => v.sequence === e.sequence)) p.events.push(position(e)); };
    const value = <T>(v: Version | undefined, p: DevelopmentSourceProof): T => {
      invariant(v, 'intermediate source version unavailable'); const payload = current.payloads.get(v.ref.versionId);
      invariant(payload && equal(payload.ref, v.ref) && payload.state === 'available', 'source version missing/withdrawn at current capture');
      if (!p.versions.some(r => r.versionId === v.ref.versionId)) p.versions.push(v.ref);
      const document = current.resolveVersion(v.ref);
      invariant(document.revision === v.ref.revision && identity(document) === v.ref.sha256, 'exact intermediate source commitment differs');
      return document.value as unknown as T;
    };
    const at = <T>(namespace: string, name: string, seq: number, p: DevelopmentSourceProof): T => value<T>(after.versions.find(v => v.ref.namespace === namespace && v.ref.key === name && v.start <= seq && seq < v.end), p);
    const ancestry = (runId: string, seq: number, p: DevelopmentSourceProof) => events.filter(e => e.stream === runId && ['admitted', 'steering'].includes(e.type) && e.sequence <= seq).map(e => { addEvent(p, e); return { event: position(e), input: e.data as unknown as InboundInput }; });
    const resultSource = (runId: string, end: number, inputSequence: number, p: DevelopmentSourceProof, resultAfterSequence = 0): DevelopmentRuntimeResultSource | null => {
      type Execution = { messageSequence?: number; lastResult?: ShellResult; checkpoint?: ShellCheckpoint; failure?: string };
      const history = after.versions.filter(v => v.ref.namespace === 'execution' && v.ref.key === runId && v.start <= end);
      const latest = history.find(v => end < v.end); if (!latest) return null;
      const currentResult = value<Execution>(latest, p).lastResult; if (!currentResult) return null;
      // persistCheckpoint and failure writes copy lastResult. Find its producer, including
      // the invocation cursor, instead of coupling the carried value to a newer cursor.
      for (let i = history.length - 1; i >= 0; i--) {
        const version = history[i]!, execution = value<Execution>(version, p);
        if (!execution.lastResult || !equal(execution.lastResult, currentResult)) continue;
        const next = events[version.start], disposition = events[version.start + 1];
        if (next?.stream === runId && next.type === 'checkpoint') {
          invariant(equal(next.data, execution.checkpoint), 'checkpoint execution source differs'); addEvent(p, next); continue;
        }
        // Successful saveExecution is followed synchronously by the run mutation/status.
        // A checkpoint-owned mutation has a different event; failure writes add failure.
        if (next?.type !== 'document-mutation' || (next.data as unknown as { namespace: string; key: string }).namespace !== 'runs' || (next.data as unknown as { key: string }).key !== runId || disposition?.stream !== runId || disposition.type !== 'status') continue;
        const state = disposition.data as unknown as Run; validateRun(state); invariant(equal(at('runs', runId, disposition.sequence, p), state), 'result disposition source differs');
        const previous = i > 0 ? value<Execution>(history[i - 1], p) : undefined;
        invariant(execution.failure === undefined || typeof execution.failure === 'string', 'runtime failure source differs');
        if (execution.failure !== previous?.failure) continue;
        // Equal result bytes can be freshly produced. An inherited failure plus equal
        // result and waiting/blocked disposition cannot distinguish another failure.
        if (equal(execution.lastResult, previous?.lastResult ?? null) && execution.failure !== undefined && state.status !== 'completed') continue;
        const invocation = events.findLast(e => e.sequence < version.start && e.stream === runId && e.type === 'status' && (e.data as unknown as Run).status === 'running');
        if (!invocation || events.some(e => e.sequence > invocation.sequence && e.sequence < version.start && e.stream === runId && e.type === 'status' && (e.data as unknown as Run).status !== 'running')) continue;
        invariant(equal(at('runs', runId, invocation.sequence, p), invocation.data), 'result invocation source differs');
        const consumed = events.findLast(e => e.sequence < invocation.sequence && e.stream === runId && ['admitted', 'steering'].includes(e.type));
        invariant(consumed && execution.messageSequence === consumed.sequence, 'result-producing invocation cursor differs');
        if (execution.messageSequence < inputSequence || version.start <= resultAfterSequence) return null;
        invariant(['completed', 'checkpointed', 'cancelled', 'blocked'].includes(execution.lastResult.status) && Array.isArray(execution.lastResult.observations), 'runtime result source differs');
        for (const observation of execution.lastResult.observations) invariant(equal(at('observations', observation.id, version.start, p), observation) && observation.runId === runId, 'runtime result observation differs');
        addEvent(p, invocation); addEvent(p, disposition); addEvent(p, consumed);
        return { status: execution.lastResult.status, messageSequence: execution.messageSequence, observationIds: execution.lastResult.observations.map(o => o.id), origin: { invocation: position(invocation), execution: version.ref, disposition: position(disposition) } };
      }
      return null;
    };
    const observations = (runId: string, start: number, end: number, p: DevelopmentSourceProof) => events.filter(e => e.stream === runId && e.type === 'observation' && e.sequence > start && e.sequence <= end).map(e => {
      const o = e.data as unknown as Observation, row = at<Observation>('observations', o.id, e.sequence, p); validateObservation(o); invariant(equal(o, row) && o.runId === runId, 'observation source differs'); addEvent(p, e); return { id: o.id, kind: o.kind, sourceId: o.sourceId };
    });
    for (const event of events.filter(e => e.sequence > cursor && e.stream === 'scheduler:ordinary' && e.type === 'selection')) {
      const d = event.data as unknown as { kind: string; sequence: number; selection?: { kind: string; goal: Goal } };
      if (d.kind !== 'selected' || d.selection?.kind !== 'goal') continue;
      try {
        const p = proof(), goal = d.selection.goal; validateGoal(goal); invariant(Number.isSafeInteger(d.sequence) && d.sequence > 0, 'invalid scheduler sequence');
        invariant(at<{ lifetimeSlices: number }>('initiative.schedulers', 'ordinary', event.sequence, p).lifetimeSlices === d.sequence, 'scheduler state/selection sequence differs');
        invariant(equal(at<Goal>('initiative.goals', goal.id, event.sequence, p), goal), 'selected goal source differs'); addEvent(p, event);
        const provenance = at<Provenance>('initiative.goal-provenance', goal.id, event.sequence, p); validateProvenance(provenance);
        const end = (events.find(e => e.sequence > event.sequence && e.stream === 'scheduler:ordinary' && e.type === 'selection')?.sequence ?? events.length + 1) - 1;
        const requests = after.versions.filter(v => v.ref.namespace === 'requests' && v.ref.revision === 1 && v.start > event.sequence && v.start <= end);
        const bound: { id: string; status: PhysicalRequest['status']; purpose: PhysicalRequest['purpose'] }[] = []; let runId: string | undefined;
        for (const v of requests) {
          const candidate = value<{ request: PhysicalRequest }>(v, proof());
          const ex = at<{ runId: string; step: number }>('initiative.execution', goal.id, v.start, p);
          if (candidate.request.runId !== ex.runId) continue;
          invariant(!runId || runId === ex.runId, 'slice spans different initiative runs'); runId = ex.runId;
          const admitted = events.find(e => e.stream === runId && e.type === 'admitted'); invariant(admitted && admitted.sequence <= v.start, 'initiative run admission unavailable');
          const a = admitted.data as unknown as InboundInput; invariant(a.source === 'initiative' && a.externalId === goal.id && a.externalRevision === String(ex.step) && a.authenticated && runId === `run:${inputIdentity(a)}` && a.actorId === at<Run>('runs', runId, v.start, p).authority.generation && equal(a.scope, goal.scope), 'initiative run admission differs');
          invariant(equal(at('inbox', inputIdentity(a), admitted.sequence, p), { input: a, runId }), 'initiative inbox source differs'); addEvent(p, admitted);
          const reserved = value<{ request: PhysicalRequest; rootId: string; ceiling: unknown }>(v, p); validatePhysicalRequest(reserved.request);
          const lineage = after.versions.filter(row => row.ref.namespace === 'requests' && row.ref.key === v.ref.key && row.start >= v.start && row.start <= end);
          for (const [i, row] of lineage.entries()) {
            const actual = value<{ request: PhysicalRequest; rootId: string; ceiling: unknown }>(row, p); validatePhysicalRequest(actual.request);
            invariant(developmentRequestIdentity(actual.request) === developmentRequestIdentity(reserved.request) && actual.rootId === reserved.rootId && equal(actual.ceiling, reserved.ceiling) && row.ref.revision === i + 1 && (i === 0 || lineage[i - 1]!.end === row.start), 'immutable physical request lineage differs');
          }
          const r = at<{ request: PhysicalRequest }>('requests', v.ref.key, end, p).request; invariant(r.id === v.ref.key && r.runId === runId && reserved.request.status === 'reserved', 'physical request binding differs');
          if (r.provider === 'effect-receiver') {
            const effect = at<Effect>('effects', r.id, v.start, p);
            invariant(effect.runId === runId && effect.kind === r.model && r.id.startsWith('tool:') && r.reservationId === r.id && r.promptManifestId === r.id && r.requestDigest === identity({ id: r.id.slice(5), runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload }), 'physical tool call binding differs');
          } else {
            const prompt = at<{ manifest: PromptManifest; artifact: ArtifactRef }>('prompts', r.promptManifestId, v.start, p);
            invariant(prompt.manifest.id === r.promptManifestId && prompt.manifest.requestDigest === r.requestDigest && prompt.artifact.sha256 === r.requestDigest, 'physical prompt binding differs');
            const retained = { uri: `sha256:${prompt.artifact.sha256}`, sha256: prompt.artifact.sha256 }; if (open) { recheck(); const bytes = after.resolveArtifact!(prompt.artifact, input.bounds.maxArtifactBytes); invariant(bytes.byteLength <= input.bounds.maxArtifactBytes && hash(bytes) === prompt.artifact.sha256, 'retained artifact digest/byte bound differs'); } else read(retained, input.bounds.maxArtifactBytes); p.artifacts.push(retained);
          }
          bound.push({ id: r.id, status: r.status, purpose: r.purpose });
        }
        invariant(runId && bound.length, 'new selected slice has no bound physical request'); const run = at<Run>('runs', runId, end, p); validateRun(run); invariant(run.id === runId && equal(run.scope, goal.scope), 'initiative run source differs');
        const originInputId = goal.origin.kind === 'request' ? goal.origin.inputId : null;
        const originEvent = originInputId ? events.find(e => e.sequence < event.sequence && ['admitted', 'steering'].includes(e.type) && ((e.data as unknown as InboundInput).id === originInputId || inputIdentity(e.data as unknown as InboundInput) === originInputId)) : undefined;
        if (originEvent) addEvent(p, originEvent);
        output.cycles.push({ interval: { before: input.before, after: input.after, lowerWallMs: before.capture.clock.wallMs, upperWallMs: after.capture.clock.wallMs, clockKind: after.capture.clock.kind }, selection: position(event), schedulerSequence: d.sequence, goal, provenance, origin: originEvent ? 'request' : 'unknown', runId, runStatus: run.status, requests: bound, ancestry: ancestry(runId, end, p), result: resultSource(runId, end, 0, p, event.sequence), observations: observations(runId, event.sequence, end, p), proof: p });
      } catch (e) { failed(`cycle:${event.id}`, e); }
    }
    for (const entry of packet.assignments.filter(e => e.roleId === input.roleId)) {
      try {
        const p = proof(), m = entry.message;
        const expected: InboundInput = { id: inputIdentity({ source: m.source, externalId: m.externalId, externalRevision: m.revision }), source: m.source, externalId: m.externalId, externalRevision: m.revision, actorId: m.actor.id, authenticated: true, scope: m.actor.scope, value: m.text };
        const row = at<{ input: InboundInput; runId: string; conversation: string; operation: string }>('communications.inputs', expected.id, events.length, p);
        invariant(equal(row.input, expected) && row.conversation === m.conversation && row.operation === canonicalJson({ targetRunId: null, control: null }), 'assignment input/body/actor/audience differs');
        const ingress = events.find(e => e.id === `communication:${expected.id}` && e.stream === 'communications' && ['input', 'revision'].includes(e.type));
        invariant(ingress && ingress.sequence > cursor && equal(ingress.data, { ...row, modificationEligible: m.actor.modificationEligible }), 'new exact communication ingress unavailable'); addEvent(p, ingress);
        const linked = events.find(e => e.stream === row.runId && ['admitted', 'steering'].includes(e.type) && e.sequence < ingress.sequence && equal(e.data, expected)); invariant(linked, 'assignment admitted/steering source unavailable'); addEvent(p, linked);
        const run = at<Run>('runs', row.runId, events.length, p); validateRun(run); invariant(run.id === row.runId && equal(run.scope, expected.scope), 'assignment run audience/source differs');
        const result = resultSource(row.runId, events.length, linked.sequence, p);
        const recorded = observations(row.runId, ingress.sequence, events.length, p);
        if (!result) failed(`assignment-result:${entry.id}`, 'runtime result consumption unavailable');
        output.assignments.push({ assignmentId: entry.id, entryDigest: identity(entry), input: expected, conversation: m.conversation, runId: row.runId, runStatus: run.status, ingress: position(ingress), linkage: linked.type as 'admitted' | 'steering', result, observations: result ? recorded.filter(o => result.observationIds.includes(o.id)) : [], proof: p });
      } catch (e) { failed(`assignment:${entry.id}`, e); }
    }
    recheck();
    invariant(Buffer.byteLength(canonicalJson(output)) <= input.bounds.maxProofBytes, 'projected proof byte bound exceeded');
  } catch (e) { output.cycles = []; output.assignments = []; failed('source', e); }
  if (Buffer.byteLength(canonicalJson(output)) > input.bounds.maxProofBytes) {
    output.captures = []; output.interval = null; output.clockQualification = 'unavailable'; output.unavailable = [{ subject: 'source', reason: 'projected proof byte bound exceeded' }];
    invariant(Buffer.byteLength(canonicalJson(output)) <= input.bounds.maxProofBytes, 'proof bound cannot contain an unavailable disposition');
  }
  return output;
}
