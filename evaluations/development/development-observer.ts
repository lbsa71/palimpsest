import { createHash } from 'node:crypto';
import { canonicalJson, digest, identity, invariant, nonempty, validateGoal, validateObservation, validatePhysicalRequest, validateProvenance, validateRun, validateScope } from '../../packages/contracts/index.ts';
import type { ArtifactRef, Effect, Goal, InboundInput, Observation, PhysicalRequest, PromptManifest, Provenance, Run } from '../../packages/contracts/index.ts';
import { inputIdentity } from '../../packages/contracts/execution/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
import { DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY } from '../../packages/storage/index.ts';
import type { DevelopmentSnapshot, DocumentJournalBinding, JournalPayload, JournalRef, StoredEvent } from '../../packages/storage/index.ts';

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
export interface DevelopmentRuntimeResultSource { status: 'completed' | 'checkpointed' | 'cancelled' | 'blocked'; messageSequence: number; observationIds: string[] }
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
interface Graph { capture: DevelopmentSourceCapture; versions: Version[]; payloads: Map<string, JournalPayload> }
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
  return { capture, versions, payloads };
}

function prefix(a: Graph, b: Graph): void {
  invariant(equal(a.capture.snapshot.events, b.capture.snapshot.events.slice(0, a.capture.snapshot.events.length)), 'retained event prefix changed');
  for (const [id, p] of a.payloads) {
    const next = b.payloads.get(id); invariant(next && equal(next.ref, p.ref), 'retained payload prefix changed');
    invariant(p.state === 'available' ? next.state === 'withdrawn' || equal(next, p) : equal(next, p), 'withdrawn source resurrected/changed');
  }
  const x = a.capture.clock, y = b.capture.clock;
  for (const c of [x, y]) { exact(c, 'kind,wallMs,monotonicMs,bootId,processStart'); invariant(['host', 'synthetic'].includes(c.kind) && Number.isFinite(c.wallMs) && c.wallMs >= 0 && Number.isFinite(c.monotonicMs) && c.monotonicMs >= 0, 'invalid capture clock'); nonempty(c.bootId, 'boot id'); nonempty(c.processStart, 'process start'); }
  invariant(x.kind === y.kind && x.bootId === y.bootId && x.processStart === y.processStart && y.wallMs >= x.wallMs && y.monotonicMs >= x.monotonicMs && Math.abs((y.wallMs - x.wallMs) - (y.monotonicMs - x.monotonicMs)) <= 1000, 'capture clock/session changed or regressed');
}

/** Caller supplies retained sources; only the recorder can authenticate plan/clock/attempt use and sign. */
export function projectDevelopmentSources(given: DevelopmentSourceInput): DevelopmentSourceProjection {
  const readArtifact = given.readArtifact;
  const { readArtifact: _reader, ...descriptors } = given;
  const input = JSON.parse(canonicalJson(descriptors)) as Omit<DevelopmentSourceInput, 'readArtifact'>;
  const output: DevelopmentSourceProjection = { version: 1, kind: 'proposed-source-facts', roleId: input.roleId, captures: [], assignmentPacket: input.assignmentPacket, interval: null, clockQualification: 'unavailable', cycles: [], assignments: [], unavailable: [] };
  const failed = (subject: string, e: unknown) => output.unavailable.push({ subject, reason: (e instanceof Error ? e.message : String(e)).slice(0, 256) });
  try {
    for (const [k, v] of Object.entries(input.bounds)) invariant(Number.isSafeInteger(v) && v > 0 && v <= (k === 'maxRows' ? 512 : 1_048_576), 'fixed source/proof bounds required');
    exact(input.bounds, 'maxCaptureBytes,maxArtifactBytes,maxRows,maxProofBytes'); nonempty(input.roleId, 'role id'); digest(input.configurationDigest);
    const read = (ref: ArtifactRef, bound: number) => { digest(ref.sha256); invariant(ref.uri === `sha256:${ref.sha256}`, 'retained content-addressed source required'); const bytes = Uint8Array.from(readArtifact({ ...ref }, bound)); invariant(bytes.byteLength <= bound && hash(bytes) === ref.sha256, 'retained artifact digest/byte bound differs'); return bytes; };
    const json = (ref: ArtifactRef, bound: number): unknown => { const bytes = read(ref, bound), value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8')); invariant(Buffer.from(bytes).toString('utf8') === canonicalJson(value), 'canonical retained source required'); return value; };
    const captures = [input.before, input.after, input.current].map(ref => graph(json(ref, input.bounds.maxCaptureBytes) as DevelopmentSourceCapture, input));
    const [before, after, current] = captures as [Graph, Graph, Graph]; prefix(before, after); prefix(after, current);
    output.captures = captures.map((g, i) => ({ artifact: [input.before, input.after, input.current][i]!, snapshotDigest: identity(g.capture.snapshot), cursor: g.capture.snapshot.events.length }));
    output.interval = { before: before.capture.clock, after: after.capture.clock }; output.clockQualification = after.capture.clock.kind === 'synthetic' ? 'synthetic' : 'requires-host-qualification';
    const events = after.capture.snapshot.events, cursor = before.capture.snapshot.events.length;
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
      return payload.document.value as unknown as T;
    };
    const at = <T>(namespace: string, name: string, seq: number, p: DevelopmentSourceProof): T => value<T>(after.versions.find(v => v.ref.namespace === namespace && v.ref.key === name && v.start <= seq && seq < v.end), p);
    const ancestry = (runId: string, seq: number, p: DevelopmentSourceProof) => events.filter(e => e.stream === runId && ['admitted', 'steering'].includes(e.type) && e.sequence <= seq).map(e => { addEvent(p, e); return { event: position(e), input: e.data as unknown as InboundInput }; });
    const resultSource = (runId: string, end: number, inputSequence: number, p: DevelopmentSourceProof, resultAfterSequence = 0): DevelopmentRuntimeResultSource | null => {
      const version = after.versions.find(v => v.ref.namespace === 'execution' && v.ref.key === runId && v.start <= end && end < v.end);
      if (!version || version.start <= resultAfterSequence) return null;
      const execution = value<{ messageSequence?: number; lastResult?: { status: DevelopmentRuntimeResultSource['status']; observations: Observation[] } }>(version, p);
      if (!execution.lastResult || execution.messageSequence === undefined || execution.messageSequence < inputSequence) return null;
      invariant(Number.isSafeInteger(execution.messageSequence) && execution.messageSequence <= end && ['completed', 'checkpointed', 'cancelled', 'blocked'].includes(execution.lastResult.status) && Array.isArray(execution.lastResult.observations), 'runtime result source differs');
      for (const observation of execution.lastResult.observations) invariant(equal(at('observations', observation.id, end, p), observation) && observation.runId === runId, 'runtime result observation differs');
      return { status: execution.lastResult.status, messageSequence: execution.messageSequence, observationIds: execution.lastResult.observations.map(o => o.id) };
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
          value(v, p); const r = at<{ request: PhysicalRequest }>('requests', v.ref.key, end, p).request; validatePhysicalRequest(r); invariant(r.id === v.ref.key && r.runId === runId && candidate.request.status === 'reserved', 'physical request binding differs');
          if (r.provider === 'effect-receiver') {
            const effect = at<Effect>('effects', r.id, v.start, p);
            invariant(effect.runId === runId && effect.kind === r.model && r.id.startsWith('tool:') && r.reservationId === r.id && r.promptManifestId === r.id && r.requestDigest === identity({ id: r.id.slice(5), runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload }), 'physical tool call binding differs');
          } else {
            const prompt = at<{ manifest: PromptManifest; artifact: ArtifactRef }>('prompts', r.promptManifestId, v.start, p);
            invariant(prompt.manifest.id === r.promptManifestId && prompt.manifest.requestDigest === r.requestDigest && prompt.artifact.sha256 === r.requestDigest, 'physical prompt binding differs');
            const retained = { uri: `sha256:${prompt.artifact.sha256}`, sha256: prompt.artifact.sha256 }; read(retained, input.bounds.maxArtifactBytes); p.artifacts.push(retained);
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
    invariant(Buffer.byteLength(canonicalJson(output)) <= input.bounds.maxProofBytes, 'projected proof byte bound exceeded');
  } catch (e) { output.cycles = []; output.assignments = []; failed('source', e); }
  if (Buffer.byteLength(canonicalJson(output)) > input.bounds.maxProofBytes) {
    output.captures = []; output.interval = null; output.clockQualification = 'unavailable'; output.unavailable = [{ subject: 'source', reason: 'projected proof byte bound exceeded' }];
    invariant(Buffer.byteLength(canonicalJson(output)) <= input.bounds.maxProofBytes, 'proof bound cannot contain an unavailable disposition');
  }
  return output;
}
