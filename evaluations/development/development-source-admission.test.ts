import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import type { ArtifactRef, Authority, Observation, PhysicalRequest, ResourceEnvelope, ShellPort } from '../../packages/contracts/index.ts';
import { OperationalStore, DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE } from '../../packages/storage/index.ts';
import { DurableRuntime, ResourceLedger } from '../../packages/runtime/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { DevelopmentalMemory } from '../../packages/development/index.ts';
import { FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry } from '../../packages/initiative/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';

import type { DevelopmentPageReader, DevelopmentPageSourceInput } from './development-observer.ts';

const resources: ResourceEnvelope = { maxRequests: 20, maxTokens: 2000, maxCostUsd: 2, maxElapsedMs: 60000, maxConcurrency: 2 };
const authority: Authority = { generation: 'fixture-generation', epoch: 1, controlRevision: 'fixture-control' };
const scope = { kind: 'restricted', principals: ['fixture-user'] } as const;
const message = (revision = '1', text = 'bounded ordinary assignment'): AuthenticatedMessage => ({ source: 'direct', externalId: 'message', revision, conversation: 'conversation', text, actor: { id: 'fixture-user', scope: { ...scope, principals: [...scope.principals] }, modificationEligible: true } });
function fixture(outcome: 'succeeded' | 'failed' | 'uncertain' = 'succeeded', status: 'completed' | 'checkpointed' = 'completed') {
  let resultStatus = status, clockKind: 'synthetic' | 'host' = 'synthetic';
  const directory = mkdtempSync(join(tmpdir(), 'aeon-development-observer-')), filename = join(directory, 'state.sqlite'); let now = Date.parse('2026-10-12T02:00:00Z'), ordinal = 0;
  let mode: 'observe' | 'equal-result' | 'checkpoint-failure' | 'failure' = 'observe', lastObservation: Observation | undefined;
  const store = new OperationalStore({ filename, documentJournal: { stream: 'journal:fixture', hostId: 'fixture-host', maxAnchorDocuments: 64, maxAnchorBytes: 65536 } });
  const memory = new DevelopmentalMemory(store, () => new Date(now).toISOString()), goals = new InitiativeRegistry(store), obligations = new ObligationRegistry(store);
  const raw = new Map<string, Uint8Array>();
  const retain = (bytes: Uint8Array): ArtifactRef => { const sha256 = createHash('sha256').update(bytes).digest('hex'); raw.set(sha256, Uint8Array.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  const retainJson = (value: unknown) => retain(Buffer.from(canonicalJson(value)));
  const read = (ref: ArtifactRef, bound: number) => { const bytes = raw.get(ref.sha256) ?? store.readArtifact(ref, bound); if (!bytes) throw Error('artifact missing'); return bytes; };
  const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { return { outcome, receipt: store.putJsonArtifact({ fixture: outcome }) }; }, async reconcile() { return { outcome: 'unresolved', receipt: store.putJsonArtifact({ unresolved: true }) }; } });
  const ledger = new ResourceLedger(store, { tokens: 20, costUsd: .01, elapsedMs: 100 }, () => now);
  const shell: ShellPort = { async run(input, bridge) {
    ordinal++; const payload = canonicalJson({ fixture: 'no provider', ordinal }), prompt = { id: `prompt:${ordinal}`, fragments: [], requestDigest: createHash('sha256').update(payload).digest('hex') };
    await bridge.capturePrompt(prompt, payload);
    const request: PhysicalRequest = { id: `physical:${ordinal}`, runId: input.run.id, purpose: 'reasoning', provider: 'fixture', model: 'offline', promptManifestId: prompt.id, requestDigest: prompt.requestDigest, reservationId: `physical:${ordinal}`, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    await bridge.reserve(request); await bridge.dispatched({ ...request, status: 'dispatched' }); await bridge.settle({ ...request, status: outcome });
    if (mode === 'checkpoint-failure') await bridge.persistCheckpoint(input.run.id, input.run.revision, 'fixture', { observationIds: [], progress: 'input read before interrupted result' });
    if (mode === 'checkpoint-failure' || mode === 'failure') throw Error('repeated fixture interruption');
    if (mode === 'equal-result') { assert.ok(lastObservation); return { status: resultStatus, observations: [lastObservation] }; }
    const observation = await bridge.execute({ id: `call:${ordinal}`, runId: input.run.id, stepId: `step:${ordinal}`, name: 'fixture-measure', arguments: { fixture: true } });
    lastObservation = observation;
    return { status: resultStatus, observations: [observation] };
  } };
  const runtime = new DurableRuntime({ store, shell, effects, resources: ledger, now: () => now });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources }) });
  const scheduler = new FairScheduler(store, goals, obligations, 'ordinary', { windowMs: 1000, maxSlicesPerWindow: 10, maxLifetimeSlices: 20, quantumMs: 1000, idleRetryMs: 1, maxStalls: 3, resources }, now);
  const runner = new InitiativeRunner({ scheduler, runtime, memory, authority, prompt: () => ({ id: 'runtime', fragments: [], requestDigest: identity('runtime') }), decide: (_g, observations) => ({ kind: 'continue', nextAction: 'inspect independent second measurement', evidenceIds: observations.map(o => o.id), reason: 'fixture continues without claiming success' }) });
  const stat = statSync(filename, { bigint: true }), pathIdentity = { device: String(stat.dev), inode: String(stat.ino) }, journal = store.documentJournalBinding()!, initialConfigurationDigest = identity({ fixture: true }); let configurationDigest = initialConfigurationDigest;
  const captures = new Map<string, DevelopmentPageReader>();
  const stats = { pageReads: 0, maxPageReadBytes: 0, eventResolves: 0, versionResolves: 0, assertions: 0 };
  let revoked = false;
  const capture = () => {
    const cut = store.captureDevelopmentPages({ maxPageRows: 7, maxPageBytes: 65536, maxPages: 512, maxPhysicalRows: 3584, maxConservativeBytes: 16_777_216, maxSerializedBytes: 16_777_216, maxOperationalArtifacts: 128, maxOperationalArtifactBytes: 1_048_576, maxOperationalArtifactTotalBytes: 16_777_216 }, retain, (_original, bytes) => retain(bytes), read);
    const manifest = { version: 1 as const, roleId: 'candidate', configurationDigest, source: { pathIdentity, journalDigest: identity(journal) }, clock: { kind: clockKind, wallMs: now, monotonicMs: now - Date.parse('2026-10-12T02:00:00Z'), bootId: 'synthetic-boot', processStart: 'synthetic-process' }, cut };
    const ref = retainJson(manifest); let visiting = false;
    // Explicit test seam: real storage page cuts, not the actual recorder's authority closure.
    const assertUsableNow = () => { stats.assertions++; assert.equal(visiting, false, 'no reader use inside callback'); if (revoked) throw Error('whole-role source withdrawn'); };
    const page = (descriptor: typeof cut.pages[number]) => { const bytes = read(descriptor.artifact, descriptor.bytes); stats.pageReads++; stats.maxPageReadBytes = Math.max(stats.maxPageReadBytes, bytes.byteLength); return JSON.parse(Buffer.from(bytes).toString()) as import('../../packages/storage/index.ts').SourcePage; };
    const reader: DevelopmentPageReader = {
      manifest, assertUsableNow,
      forEachEvent(visit) { for (const descriptor of cut.pages.filter(p => p.table === 'events')) { assertUsableNow(); const p = page(descriptor); if (p.table !== 'events') throw Error('wrong event page'); visiting = true; try { for (const e of p.rows) visit(e); } finally { visiting = false; } } },
      forEachCurrentDocument(visit) { for (const descriptor of cut.pages.filter(p => p.table === 'documents')) { assertUsableNow(); const p = page(descriptor); if (p.table !== 'documents') throw Error('wrong document page'); visiting = true; try { for (const row of p.rows.filter(d => !d.namespace.startsWith(DOCUMENT_JOURNAL_NAMESPACE))) visit(row); } finally { visiting = false; } } },
      resolveEvent(sequence) { assertUsableNow(); stats.eventResolves++; for (const descriptor of cut.pages.filter(p => p.table === 'events')) { const p = page(descriptor); if (p.table === 'events') { const e = p.rows.find(e => e.sequence === sequence); if (e) return e; } } throw Error('event unavailable'); },
      resolveJournalVersion(versionId) { assertUsableNow(); stats.versionResolves++; for (const descriptor of cut.pages.filter(p => p.table === 'documents')) { const p = page(descriptor); if (p.table === 'documents') { const row = p.rows.find(r => r.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE && r.key === versionId); if (row) { const payload = row.value as unknown as import('../../packages/storage/index.ts').JournalPayload; if (payload.state !== 'available') throw Error('payload withdrawn'); return { ref: payload.ref, document: payload.document }; } } } throw Error('exact version unavailable'); },
      resolve(original, maxBytes) { assertUsableNow(); const mapping = cut.operationalArtifacts.find(m => canonicalJson(m.original) === canonicalJson(original)); if (!mapping) throw Error('original mapping unavailable'); return Buffer.from(read(mapping.retained, maxBytes)); },
    };
    captures.set(ref.sha256, reader); return ref;
  };
  const assignmentPacket = (messages: AuthenticatedMessage[] = []) => retainJson({ version: 1, assignments: messages.map((m, i) => ({ id: `assignment:${i}`, roleId: 'candidate', message: m })) });
  const input = (before: ArtifactRef, after: ArtifactRef, packet = assignmentPacket(), current = after): DevelopmentPageSourceInput => ({ before, after, current, assignmentPacket: packet, roleId: 'candidate', configurationDigest, pathIdentity, journal, bounds: { maxCaptureBytes: 1_048_576, maxArtifactBytes: 1_048_576, maxRows: 512, maxProofBytes: 262144 }, metadataBounds: { maxRecords: 20000, maxBytes: 8_388_608 }, readArtifact: read, openAcquiredCapture(ref) { const reader = captures.get(ref.sha256); if (!reader) throw Error('captured reader unavailable'); return reader; } });
  const ready = () => { const g = goals.propose({ id: 'inquiry', origin: { kind: 'self' }, purpose: 'inspect ordinary source evidence', scope: { kind: 'public' }, successCriteria: ['retain measured uncertainty'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'inspect fixture measurement', reviewAt: new Date(now).toISOString() }, { sourceIds: ['unresolved-host-origin'], actorId: 'fixture-generation', recordedAt: new Date(now).toISOString(), derivation: 'interpreted' }); goals.accept(g.id, g.revision, 'fixture opportunity'); };
  return { store, raw, retainJson, capture, captures, stats, setClockKind: (k: 'synthetic' | 'host') => { clockKind = k; }, setStatus: (s: typeof status) => { resultStatus = s; }, setConfigurationDigest: (d: string) => { configurationDigest = d; }, revoke: () => { revoked = true; }, assignmentPacket, input, core, runner, ready, runtime, scheduler, ledger, mode: (next: typeof mode) => { mode = next; }, advance: (ms = 100) => { now += ms; }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}


import { syntheticWitnessFixture } from './witness-fixture.ts';
import { signDocument } from '../qualification/manifest.ts';
import type { DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { developmentCapacityProfile } from './witness.ts';
import type { DevelopmentRoleBinding } from './review-envelope.ts';
import { developmentSourceCheckDomain, developmentSourceExtractionId, validateSourceAdmissionPolicy, validateDevelopmentWorkload, deriveDevelopmentAssignment, deriveDevelopmentCycle, deriveDevelopmentExperience, inspectDevelopmentLearning, inspectDevelopmentOpportunity, deriveDevelopmentLearning, deriveDevelopmentOpportunity, verifyDevelopmentSourceCheck, encodeDevelopmentSourceProof, extractDevelopmentAssignmentArtifacts, validateDevelopmentCycleIntervals, validateDevelopmentTransferIntervals, developmentProofSlot, developmentSourceObservationData } from './development-source-admission.ts';
import type { SourceAdmissionContext, SourceAdmissionPolicy, SourceAdmissionTrust, DevelopmentWorkload, DevelopmentSourceCheck, DevelopmentCycleProof, SourceAdmissionResult, SourceCheckBinding, DevelopmentLearningProof, DevelopmentExperienceProof, DevelopmentOpportunityProof, OpportunitySelector } from './development-source-admission.ts';
const unwrap = <T>(r: SourceAdmissionResult<T>): T => { if (r.status !== 'derived') assert.fail(JSON.stringify(r)); return r.proof; };
function admissionFixture(semantic = false) {
  const f = fixture(), w = syntheticWitnessFixture(), raw = f.raw;
  const put = (v: unknown) => f.retainJson(v), read = (r: ArtifactRef, bound: number) => { const b = raw.get(r.sha256) ?? w.reader(r, bound); assert.ok(b); assert.ok(b.byteLength <= bound); return Uint8Array.from(b); };
  const roles: DevelopmentRoleBinding[] = ['candidate', ...w.m.controls.map(c => c.id)].map((id, i) => ({ id, kind: i ? 'control' : 'candidate', assignmentId: i ? id : null, allocationId: id, configurationDigest: identity({ fixture: true }), closureDigest: identity(id), profile: null, allowedEffects: [], resources }));
  const schedule: NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule'] = [], entries: { id: string; roleId: string; message: AuthenticatedMessage }[] = [];
  const add = (roleId: string, phase: typeof schedule[number]['phase'], count: number) => { for (let ordinal = 0; ordinal < count; ordinal++) { const id = `${phase}:${ordinal}`; schedule.push({ roleId, assignmentId: id, phase, ordinal }); entries.push({ id, roleId, message: { ...message(), externalId: `${roleId}:${id}`, conversation: `${roleId}:${id}`, text: `${phase} exact public fixture ${ordinal}` } }); } };
  for (const r of roles) for (const [phase, count] of (r.kind === 'candidate' || ['no-memory', 'no-standing-goals'].includes(r.id) ? [['opportunity', 12], ['learning', 3], ['interference', 9], ['feedback', 12]] : [['script', 3], ['script-feedback', 3]]) as [typeof schedule[number]['phase'], number][]) add(r.id, phase, count);
  const packet = semantic ? put({ version: 1, assignments: entries }) : f.assignmentPacket([message()]);
  const ablations = roles.slice(0, 3), transfers = w.m.opportunities.filter(x => x.family === 'transfer');
  const workload: DevelopmentWorkload = { version: 1, scheduleDigest: identity(schedule), assignmentDigest: packet.sha256, extractionId: developmentSourceExtractionId, rubricId: 'fixture-rubric', matching: { mediators: ['fixture'], workspaces: [] }, opportunities: w.m.opportunities.map((o, i) => ({ id: o.id, family: o.family, roles: ablations.map(r => ({ roleId: r.id, assignmentId: `opportunity:${i}`, feedbackAssignmentId: `feedback:${i}`, learningAssignmentId: o.family === 'transfer' ? `learning:${transfers.findIndex(x => x.id === o.id)}` : null, interferenceAssignmentIds: o.interferenceIds.map(id => `interference:${[...new Set(transfers.flatMap(x => x.interferenceIds))].indexOf(id)}`) })) })), scripts: roles.slice(3).map(r => ({ controlId: r.id, roleId: r.id, cases: Array.from({ length: 3 }, (_, i) => ({ assignmentId: `script:${i}`, feedbackAssignmentId: `script-feedback:${i}` })) })) };
  const workloadRef = put(workload), config = put({ developmentControl: { workloadDigest: workloadRef.sha256 } });
  if (semantic) { f.setConfigurationDigest(config.sha256); roles.forEach(r => { r.configurationDigest = config.sha256; }); }
  w.m.limits = { maxArtifactBytes: 32 * 1024 * 1024, maxRecords: 32768, maxEvidenceBytes: 1024 * 1024 * 1024 };
  // Mirrors the accepted plan shape; signature acceptance remains recorder-owned, not tested here.
  w.m.notBefore = '2026-10-12T02:00:00Z'; w.m.deadlineAt = '2026-10-12T03:00:00Z';
  const plan: DevelopmentAcquisitionPlan = { version: 2, id: 'fixture-source-admission', manifest: w.manifest(), registration: { signer: 'fixture', signature: identity('fixture'), value: { version: 2, attemptDigest: identity(w.m), rootId: 'root', rootCancelled: false, registeredAt: w.m.registeredAt, reviewDeadlineAt: w.at(290), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('closure'), assignmentDigest: packet.sha256, roles, originalRequests: [] } }, assignmentPacket: packet, originalStateFile: f.store.filename, closures: { node: identity('node'), dependencies: identity('deps'), prompts: identity('prompts'), tools: identity('tools'), acquisition: identity('acquire') }, rawStore: { directory: '/fixture', device: '1', inode: '2', uid: '3', capacityBytes: 1_000_000_000 }, roles: roles.map(r => ({ roleId: r.id, stateFile: f.store.filename, workspace: '/fixture', configuration: config, closure: config, journal: null, maxDrafts: 1, maxPayloadBytes: 1, maxPromptBytes: 1, maxFragmentBytes: 1, maxResponseBytes: 1 })), capacity: { captureBytes: 1_000_000, maxSnapshots: 156, maxSnapshotBytes: 1_000_000, envelopeBytes: 1_000_000, transitionBytes: 1_000_000, failureBytes: 1_000_000, inventoryEntryBytes: 384, maxArtifacts: 20000, maxObservations: 424 }, captureLayout: { kind: 'complete-pages-global-originals-v1', page: { maxPageRows: 7, maxPageBytes: 65536, maxPages: 512, maxPhysicalRows: 3584, maxConservativeBytes: 16777216, maxSerializedBytes: 16777216, maxOperationalArtifacts: 128, maxOperationalArtifactBytes: 1_000_000, maxOperationalArtifactTotalBytes: 16777216 }, maxManifestBytes: 1_000_000, maxCaptureIndexBytes: 4096, referencedOriginalPool: { maxOriginals: 2048, maxBytes: 16777216 }, sourcePool: { maxArtifacts: 32, maxBytes: 1_000_000 }, proofPool: { maxArtifacts: 256, maxBytes: 16777216, mandatoryArtifacts: 202, mandatoryArtifactBytes: 65536 }, metadata: { behaviorBytes: 16777216, finalBytes: 25165824, ownerWithoutBehaviorBytes: 25165824, ownerBytes: 41943040 } }, protocol: { nonRequestObservations: 40, initialCaptures: 6, cycleCaptures: 6, boundaryCaptures: 12, schedule } };
  const key = Buffer.alloc(32, 29), qualification = put({ version: 1, checkerId: 'fixture-checker', checkerSourceDigest: identity('checker'), extractorSourceDigest: identity('extractor'), rubricDigest: identity('rubric'), workloadDigest: workloadRef.sha256, principalId: 'fixture-external', independenceGroup: 'fixture-external-group', disposition: 'accepted' });
  const policy: SourceAdmissionPolicy = { version: 1, planDigest: identity(plan), workload: semantic ? workloadRef : null, checkerId: semantic ? 'fixture-checker' : null, checkerSourceDigest: semantic ? identity('checker') : null, extractorSourceDigest: semantic ? identity('extractor') : null, rubricDigest: semantic ? identity('rubric') : null, qualification: semantic ? qualification : null, clockQualification: null, bounds: { maxMetadataRecords: 20000, maxMetadataBytes: 8388608, maxProofBytes: 65536, maxCheckerBytes: 16384 }, adaptationOrdinals: { policy: 0, workload: semantic ? 1 : null, qualification: semantic ? 2 : null, clockQualification: null, learningChecks: semantic ? transfers.map((x, i) => ({ opportunityId: x.id, ordinal: 3 + i })) : [], scriptChecks: semantic ? workload.scripts.flatMap((s, i) => s.cases.map((x, j) => ({ controlId: s.controlId, assignmentId: x.assignmentId, ordinal: 6 + i * 3 + j }))) : [] } };
  const trust: SourceAdmissionTrust = { acceptedPolicyDigest: identity(policy), acceptedQualificationDigest: semantic ? qualification.sha256 : null, checker: semantic ? { id: 'fixture-checker', key, principalId: 'fixture-external', independenceGroup: 'fixture-external-group' } : null, acceptedClockQualificationDigest: null }, context: SourceAdmissionContext = { plan, policy, trust, readArtifact: read };
  const accept = () => { policy.planDigest = identity(plan); trust.acceptedPolicyDigest = identity(policy); };
  const input = (before: ArtifactRef, after: ArtifactRef, current = after) => { const x = f.input(before, after, plan.assignmentPacket, current); x.bounds.maxProofBytes = policy.bounds.maxProofBytes; x.readArtifact = read; return x; };
  const retainExtraction = (i: DevelopmentPageSourceInput, id: string) => { const a = unwrap(extractDevelopmentAssignmentArtifacts(context, i, id)); const retain = (b: Uint8Array) => { const sha256 = createHash('sha256').update(b).digest('hex'); raw.set(sha256, Uint8Array.from(b)); return { uri: `sha256:${sha256}`, sha256 }; }; return { input: retain(a.input), output: a.output ? retain(a.output) : null }; };
  const deliver = async (id: string, ingest = false) => { const before = f.capture(), entry = entries.find(x => x.id === id && x.roleId === 'candidate')!, run = f.core.receive(entry.message).run; if (ingest) { const record = f.store.list<{ input: { id: string; actorId: string; value: any }; runId: string }>('communications.inputs').find(x => x.value.runId === run.id)!.value; const episodeId = `input:${record.input.id}`; new DevelopmentalMemory(f.store).ingest({ id: episodeId, runId: run.id, sourceId: record.input.id, actorId: record.input.actorId, channel: 'speech', scope: run.scope, at: '2000-01-01T00:00:00Z', content: record.input.value }); f.store.put('host.ingested', episodeId, true, null); } await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); f.advance(); const after = f.capture(); return input(before, after); };
  return { f, context, policy, trust, plan, key, workload, packet, put, input, accept, retainExtraction, deliver, entries };
}

test('actual paged ingress/result yields detached unsigned assignment and exact extraction', async () => {
  const x = admissionFixture(); try { const before = x.f.capture(), run = x.f.core.receive(message()).run; await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); x.f.advance(); const input = x.input(before, x.f.capture());
    const p = unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:0')); assert.equal(p.acquisition, 'completed'); assert.equal(p.source.assignment.runId, run.id); assert.equal(p.checks.length, 0); assert.equal(developmentSourceObservationData(p).status, 'unavailable'); assert.ok(p.output);
    const extracted = x.retainExtraction(input, 'assignment:0'); assert.equal(extracted.output!.sha256, p.output!.sha256); assert.equal(extracted.input.sha256, p.input.sha256);
    const encoded = encodeDevelopmentSourceProof(p, 65536); assert.equal(encodeDevelopmentSourceProof(p, encoded.byteLength).byteLength, encoded.byteLength); assert.throws(() => encodeDevelopmentSourceProof(p, encoded.byteLength - 1), /bound/);
    p.source.assignment.input.actorId = 'caller-mutated'; assert.notEqual(unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:0')).source.assignment.input.actorId, 'caller-mutated');
  } finally { x.f.close(); }
});
for (const field of ['body', 'actor', 'scope', 'configuration', 'packet', 'foreign-capture', 'getter', 'metadata'] as const) test(`causal source ${field} substitution refuses`, async () => {
  const x = admissionFixture(); try { const before = x.f.capture(), run = x.f.core.receive(message()).run; await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); x.f.advance(); const input = x.input(before, x.f.capture());
    if (['body', 'actor', 'scope'].includes(field)) { const m = message(); if (field === 'body') m.text = 'wrong'; if (field === 'actor') m.actor.id = 'foreign'; if (field === 'scope') m.actor.scope = { kind: 'public' }; input.assignmentPacket = x.f.assignmentPacket([m]); x.context.plan.assignmentPacket = input.assignmentPacket; x.accept(); }
    else if (field === 'configuration') input.configurationDigest = identity('foreign');
    else if (field === 'packet') input.assignmentPacket = x.f.assignmentPacket([]);
    else if (field === 'foreign-capture') input.after = x.put({ unrelated: true });
    else if (field === 'metadata') input.metadataBounds.maxRecords = 1;
    else Object.defineProperty(input, 'roleId', { enumerable: true, get() { throw Error('getter must never execute'); } });
    assert.notEqual(deriveDevelopmentAssignment(x.context, input, 'assignment:0').status, 'derived');
  } finally { x.f.close(); }
});
test('stale checkpoint result is unavailable for newer consumed input, genuine new result succeeds in same run', async () => {
  const x = admissionFixture(); x.f.setStatus('checkpointed'); try { const first = message(), second = message('2', 'new input'), before = x.f.capture(), run = x.f.core.receive(first).run; await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') });
    assert.equal(x.f.core.receive(second).run.id, run.id); x.f.mode('checkpoint-failure'); await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); x.f.advance();
    x.plan.assignmentPacket = x.f.assignmentPacket([first, second]); x.accept(); let input = x.input(before, x.f.capture()); const stale = unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:1')); assert.equal(stale.acquisition, 'unavailable'); assert.equal(stale.output, null);
    x.f.mode('observe'); x.f.setStatus('completed'); await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); x.f.advance(); input = x.input(before, x.f.capture()); const fresh = unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:1')); assert.equal(fresh.acquisition, 'completed'); assert.equal(fresh.source.assignment.runId, run.id);
  } finally { x.f.close(); }
});
test('callback input mutation cannot switch released role identity and withdrawal denies cached-source use', async () => {
  const x = admissionFixture(); try { const before = x.f.capture(), run = x.f.core.receive(message()).run; await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); x.f.advance(); const input = x.input(before, x.f.capture()), open = input.openAcquiredCapture;
    input.openAcquiredCapture = ref => { input.roleId = 'foreign'; return open(ref); };
    assert.equal(unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:0')).roleId, 'candidate'); input.roleId = 'candidate'; input.openAcquiredCapture = open;
    x.f.revoke(); assert.notEqual(deriveDevelopmentAssignment(x.context, input, 'assignment:0').status, 'derived');
  } finally { x.f.close(); }
});
test('mechanical-only policy records actual cycles with request/unknown origin preserved; semantic methods unavailable', async () => {
  const x = admissionFixture(); try { x.f.ready(); x.f.advance(1000); const before = x.f.capture(); await x.f.runner.tick(); x.f.advance(); const input = x.input(before, x.f.capture());
    const { projectDevelopmentPageSources } = await import('./development-observer.ts'); const selection = projectDevelopmentPageSources(input).cycles[0]!.selection.id;
    const cycle = unwrap(deriveDevelopmentCycle(x.context, input, x.plan.manifest.value.cycles[0]!, selection)); assert.equal(cycle.origin, 'unknown'); assert.equal(cycle.autonomy, 'unavailable'); assert.equal(cycle.interval.temporalEligibility, 'synthetic'); assert.equal(developmentSourceObservationData(cycle).status, 'derived');
    assert.equal(inspectDevelopmentLearning(x.context, input, 'assignment:0', 'missing').status, 'unavailable'); assert.equal(deriveDevelopmentCycle(x.context, x.input(input.after, input.after), x.plan.manifest.value.cycles[0]!, selection).status, 'unavailable');
  } finally { x.f.close(); }
});
async function threeCycles() {
  const x = admissionFixture(), out: DevelopmentCycleProof[] = []; x.f.ready();
  for (let i = 0; i < 3; i++) { x.f.advance(1100); const before = x.f.capture(); await x.f.runner.tick(); x.f.advance(10); const input = x.input(before, x.f.capture()); const { projectDevelopmentPageSources } = await import('./development-observer.ts'); const cycle = projectDevelopmentPageSources(input).cycles[0]!; out.push(unwrap(deriveDevelopmentCycle(x.context, input, x.plan.manifest.value.cycles[i]!, cycle.selection.id))); }
  return { x, out };
}
test('three actual narrow W-separated selections pass conservative fixture intervals', async () => { const { x, out } = await threeCycles(); try { const start = Date.parse('2026-10-12T02:00:00Z'); assert.equal(validateDevelopmentCycleIntervals(out, x.plan.manifest.value.cycles, start, out[2]!.interval.upperWallMs, 1000).status, 'derived'); } finally { x.f.close(); } });
for (const bad of ['run-reuse', 'selection-reuse', 'overlap', 'wide', 'missing-host-qualification', 'synthetic-promoted'] as const) test(`cycle interval ${bad} cannot pass`, async () => { const { x, out } = await threeCycles(); try {
  if (bad === 'run-reuse') out[1]!.source.cycle.runId = out[0]!.source.cycle.runId;
  if (bad === 'selection-reuse') out[1]!.source.cycle.selection.id = out[0]!.source.cycle.selection.id;
  if (bad === 'overlap') out[1]!.interval.lowerWallMs = out[0]!.interval.upperWallMs;
  if (bad === 'wide') out[0]!.interval.upperWallMs = out[1]!.interval.upperWallMs - 100;
  if (bad === 'missing-host-qualification') { out[0]!.interval.clockKind = 'host'; out[0]!.interval.temporalEligibility = 'unavailable'; }
  if (bad === 'synthetic-promoted') out[0]!.interval.temporalEligibility = 'qualified';
  assert.notEqual(validateDevelopmentCycleIntervals(out, x.plan.manifest.value.cycles, Date.parse('2026-10-12T02:00:00Z'), out[2]!.interval.upperWallMs, 1000).status, 'derived');
 } finally { x.f.close(); } });
test('policy is pinned outside plan/workload identity; changed policy/slot/headroom/bound refuses', () => {
  const x = admissionFixture(); try { const before = identity(x.plan); assert.equal(validateSourceAdmissionPolicy(x.context).workload, null); assert.equal(identity(x.plan), before);
    x.policy.bounds.maxProofBytes--; assert.throws(() => validateSourceAdmissionPolicy(x.context), /Pinned/); x.accept(); assert.equal(identity(x.plan), before); assert.doesNotThrow(() => validateSourceAdmissionPolicy(x.context));
    x.policy.adaptationOrdinals.policy = 54; x.accept(); assert.throws(() => validateSourceAdmissionPolicy(x.context), /ordinal/);
    x.policy.adaptationOrdinals.policy = 0; x.plan.captureLayout!.proofPool.maxArtifacts = 202; x.accept(); assert.throws(() => validateSourceAdmissionPolicy(x.context), /headroom/);
  } finally { x.f.close(); }
});
test('complete exact public workload maps all126 deliveries and16 optional artifacts without private material', () => { const x = admissionFixture(true); try { assert.equal(validateDevelopmentWorkload(x.context).opportunities.length, 12); assert.doesNotThrow(() => validateSourceAdmissionPolicy(x.context)); assert.equal(developmentProofSlot(x.plan, 'task-output', 'no-standing-goals', x.plan.manifest.value.opportunities[11]!.id).ordinal, 35);
  const altered = structuredClone(x.workload); altered.opportunities[0]!.roles[0]!.feedbackAssignmentId = 'feedback:1'; x.policy.workload = x.put(altered); x.accept(); assert.throws(() => validateDevelopmentWorkload(x.context), /ordinal/);
 } finally { x.f.close(); } });
test('actual attributed speech episode and host ingestion are required, old/fake/model memory cannot qualify', async () => {
  const x = admissionFixture(true); try { const input = await x.deliver('interference:0', true), interference = x.plan.manifest.value.opportunities.find(o => o.family === 'transfer')!.interferenceIds[0]!;
    const proof = unwrap(deriveDevelopmentExperience(x.context, input, 'interference:0', interference)); assert.equal(proof.episodeId, `input:${proof.source.assignment.input.id}`); assert.equal(proof.source.episode.revision, 1); assert.equal(proof.source.ingested.revision, 1); assert.equal(proof.interval.lowerWallMs, Date.parse('2026-10-12T02:00:00Z')); assert.equal(developmentSourceObservationData(proof).status, 'derived');
    assert.notEqual(deriveDevelopmentExperience(x.context, x.input(input.after, input.after), 'interference:0', interference).status, 'derived'); assert.notEqual(deriveDevelopmentExperience(x.context, input, 'interference:0', 'fake-episode').status, 'derived');
  } finally { x.f.close(); }
  const y = admissionFixture(true); try { const input = await y.deliver('interference:0'), interference = y.plan.manifest.value.opportunities.find(o => o.family === 'transfer')!.interferenceIds[0]!; assert.notEqual(deriveDevelopmentExperience(y.context, input, 'interference:0', interference).status, 'derived'); } finally { y.f.close(); }
});
function signedReceipt(x: ReturnType<typeof admissionFixture>, binding: SourceCheckBinding, overrides: Partial<DevelopmentSourceCheck> = {}) {
  const p = x.policy, value: DevelopmentSourceCheck = { version: 1, planDigest: p.planDigest, policyDigest: x.trust.acceptedPolicyDigest, roleId: binding.roleId, opportunityId: binding.subjectId, assignmentIds: binding.assignmentIds, sourceDigest: binding.sourceDigest, checkerSourceDigest: p.checkerSourceDigest!, extractorSourceDigest: p.extractorSourceDigest!, rubricDigest: p.rubricDigest!, output: binding.output, feedback: binding.feedback, acquisition: binding.acquisition, behavior: 'pass', disclosure: 'preserved', matching: 'valid', judgments: [], checkedAt: new Date(binding.hostNow).toISOString(), ...overrides }; return x.put(signDocument(developmentSourceCheckDomain, value, x.trust.checker!.id, x.key));
}
async function learningFixture() { const x = admissionFixture(true), input = await x.deliver('learning:0'), id = x.plan.manifest.value.opportunities.find(o => o.family === 'transfer')!.id, checkInput = unwrap(inspectDevelopmentLearning(x.context, input, 'learning:0', id)); x.retainExtraction(input, 'learning:0'); const binding: SourceCheckBinding = { roleId: checkInput.roleId, subjectId: id, assignmentIds: checkInput.assignmentIds, sourceDigest: checkInput.sourceDigest, output: checkInput.output, feedback: checkInput.feedback, acquisition: 'completed', completeAt: checkInput.interval.upperWallMs, hostNow: checkInput.interval.upperWallMs + 1, judgmentSlots: [] }; return { x, input, id, checkInput, binding }; }
test('bound qualified synthetic initial check yields learning; complete wrong answer remains covered failed learning', async () => {
  const { x, input, id, binding } = await learningFixture(); try { const receipt = signedReceipt(x, binding); const good = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', id, receipt, binding.hostNow)); assert.equal(developmentSourceObservationData(good).status, 'derived');
    const negative = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', id, signedReceipt(x, binding, { behavior: 'fail' }), binding.hostNow)); assert.equal(negative.acquisition, 'completed'); assert.equal(negative.behavior, 'fail'); assert.equal(developmentSourceObservationData(negative).status, 'unavailable');
  } finally { x.f.close(); }
});
for (const bad of ['key', 'policy', 'role', 'source', 'rubric', 'assignment', 'output', 'feedback', 'check-time', 'unknown-field', 'judgment', 'qualification'] as const) test(`checker ${bad} substitution rejects`, async () => {
  const { x, binding } = await learningFixture(); try { let receipt = signedReceipt(x, binding); if (bad === 'key') x.trust.checker!.key = Buffer.alloc(32, 30);
    else if (bad === 'qualification') x.trust.acceptedQualificationDigest = identity('unapproved');
    else if (bad === 'unknown-field') { const record = JSON.parse(Buffer.from(x.f.raw.get(receipt.sha256)!).toString()); record.value.extra = true; receipt = x.put(signDocument(developmentSourceCheckDomain, record.value, 'fixture-checker', x.key)); }
    else { const overrides: Partial<DevelopmentSourceCheck> = {}; if (bad === 'policy') overrides.policyDigest = identity('other'); if (bad === 'role') overrides.roleId = 'no-memory'; if (bad === 'source') overrides.sourceDigest = identity('other'); if (bad === 'rubric') overrides.rubricDigest = identity('other'); if (bad === 'assignment') overrides.assignmentIds = ['learning:1']; if (bad === 'output') overrides.output = x.put({ wrong: true }); if (bad === 'feedback') overrides.feedback = x.put({ wrong: true }); if (bad === 'check-time') overrides.checkedAt = new Date(binding.completeAt - 1).toISOString(); if (bad === 'judgment') overrides.judgments = [x.put({ judgment: 'unreserved' })]; receipt = signedReceipt(x, binding, overrides); }
    assert.notEqual(verifyDevelopmentSourceCheck(x.context, receipt, binding).status, 'derived');
  } finally { x.f.close(); }
});
test('checker missing qualification and unavailable disclosures stay unavailable; retained feedback byte replacement rejects', async () => {
  const { x, binding } = await learningFixture(); try { const receipt = signedReceipt(x, binding, { behavior: 'unavailable', disclosure: 'unavailable', matching: 'unavailable' }); const check = unwrap(verifyDevelopmentSourceCheck(x.context, receipt, binding)); assert.equal(check.value.disclosure, 'unavailable'); x.f.raw.set(binding.feedback.sha256, Buffer.from('fabricated praise')); assert.equal(verifyDevelopmentSourceCheck(x.context, receipt, binding).status, 'failed'); x.trust.checker = null; assert.equal(verifyDevelopmentSourceCheck(x.context, receipt, binding).status, 'unavailable'); } finally { x.f.close(); }
});
test('inert policy/check binding rejects getters and proxies before executing them', () => { const x = admissionFixture(); try { const p = structuredClone(x.policy); Object.defineProperty(p, 'version', { enumerable: true, get() { assert.fail('getter invoked'); } }); assert.throws(() => validateSourceAdmissionPolicy({ ...x.context, policy: p }), /accessors/); assert.throws(() => validateSourceAdmissionPolicy({ ...x.context, policy: new Proxy(x.policy, {}) }), /inert/); } finally { x.f.close(); } });
test('opportunity complete wrong behavior keeps acquisition completed; feedback is actual mapped external input', async () => {
  const x = admissionFixture(true); try { const index = x.plan.manifest.value.opportunities.findIndex(o => o.family !== 'transfer'), id = x.plan.manifest.value.opportunities[index]!.id, task = await x.deliver(`opportunity:${index}`), feedback = await x.deliver(`feedback:${index}`), current = feedback.after;
    task.current = current; const selector: OpportunitySelector = { roleId: 'candidate', before: task.before, after: task.after, assignmentId: `opportunity:${index}`, opportunityId: id, related: [{ roleId: 'candidate', assignmentId: `feedback:${index}`, before: feedback.before, after: feedback.after }] };
    x.retainExtraction(task, selector.assignmentId); x.retainExtraction(feedback, selector.related[0]!.assignmentId); const ci = unwrap(inspectDevelopmentOpportunity(x.context, task, selector, [feedback])), binding: SourceCheckBinding = { roleId: ci.roleId, subjectId: id, assignmentIds: ci.assignmentIds, sourceDigest: ci.sourceDigest, output: ci.output, feedback: ci.feedback, acquisition: 'completed', completeAt: feedback.after === current ? x.f.captures.get(current.sha256)!.manifest.clock.wallMs : 0, hostNow: x.f.captures.get(current.sha256)!.manifest.clock.wallMs + 1, judgmentSlots: [] };
    const p = unwrap(deriveDevelopmentOpportunity(x.context, task, selector, [feedback], signedReceipt(x, binding, { behavior: 'fail' }), binding.hostNow)); assert.equal(p.acquisition, 'completed'); assert.equal(p.behavior, 'fail'); const data = unwrap(developmentSourceObservationData(p)); assert.equal(data.kind, 'opportunity'); if (data.kind === 'opportunity') assert.equal(data.result, 'completed');
    const unknown = unwrap(deriveDevelopmentOpportunity(x.context, task, selector, [feedback], signedReceipt(x, binding, { disclosure: 'unavailable' }), binding.hostNow)); assert.equal(developmentSourceObservationData(unknown).status, 'unavailable');
    assert.notEqual(inspectDevelopmentOpportunity(x.context, task, { ...selector, related: [] }, []).status, 'derived');
  } finally { x.f.close(); }
});

for (const bad of ['boot', 'process', 'drift'] as const) test(`actual retained clock ${bad} change remains unavailable`, async () => {
  const x = admissionFixture(); try { x.f.ready(); const before = x.f.capture(); await x.f.runner.tick(); x.f.advance(10); const after = x.f.capture(), reader = x.f.captures.get(after.sha256)!, manifest = structuredClone(reader.manifest);
    if (bad === 'boot') manifest.clock.bootId = 'different'; if (bad === 'process') manifest.clock.processStart = 'different'; if (bad === 'drift') manifest.clock.monotonicMs += 2000;
    const changed = x.put(manifest); x.f.captures.set(changed.sha256, { ...reader, manifest }); const input = x.input(before, changed);
    assert.equal(deriveDevelopmentCycle(x.context, input, x.plan.manifest.value.cycles[0]!, 'unavailable').status, 'unavailable');
  } finally { x.f.close(); }
});
test('host-labeled actual source without pinned clock qualification yields unavailable temporal eligibility', async () => {
  const x = admissionFixture(); try { x.f.setClockKind('host'); x.f.ready(); const before = x.f.capture(); await x.f.runner.tick(); x.f.advance(10); const input = x.input(before, x.f.capture()); const { projectDevelopmentPageSources } = await import('./development-observer.ts'); const selection = projectDevelopmentPageSources(input).cycles[0]!.selection.id;
    const cycle = unwrap(deriveDevelopmentCycle(x.context, input, x.plan.manifest.value.cycles[0]!, selection)); assert.equal(cycle.interval.temporalEligibility, 'unavailable'); assert.equal(developmentSourceObservationData(cycle).status, 'unavailable');
  } finally { x.f.close(); }
});
test('actual learning, three sourced exposures and delayed transfer obey conservative intervals; duplicates/overlaps fail', async () => {
  const { x, input, id, binding } = await learningFixture(); try {
    const learning = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', id, signedReceipt(x, binding), binding.hostNow)), experiences: DevelopmentExperienceProof[] = [], related = [input];
    const ids = x.plan.manifest.value.opportunities.find(o => o.id === id)!.interferenceIds;
    for (let i = 0; i < 3; i++) { x.f.advance(1); const experience = await x.deliver(`interference:${i}`, true); related.push(experience); experiences.push(unwrap(deriveDevelopmentExperience(x.context, experience, `interference:${i}`, ids[i]!))); }
    x.f.advance(1000); const task = await x.deliver('opportunity:0'), feedback = await x.deliver('feedback:0'); related.push(feedback); const current = feedback.after; input.current = current; task.current = current; related.forEach(i => { i.current = current; });
    const selector: OpportunitySelector = { roleId: 'candidate', before: task.before, after: task.after, assignmentId: 'opportunity:0', opportunityId: id, related: related.map((s, i) => ({ roleId: 'candidate', before: s.before, after: s.after, assignmentId: ['learning:0', 'interference:0', 'interference:1', 'interference:2', 'feedback:0'][i]! })) };
    x.retainExtraction(task, selector.assignmentId); related.forEach((r, i) => x.retainExtraction(r, selector.related[i]!.assignmentId)); const ci = unwrap(inspectDevelopmentOpportunity(x.context, task, selector, related));
    const b: SourceCheckBinding = { roleId: ci.roleId, subjectId: id, assignmentIds: ci.assignmentIds, sourceDigest: ci.sourceDigest, output: ci.output, feedback: ci.feedback, acquisition: 'completed', completeAt: x.f.captures.get(current.sha256)!.manifest.clock.wallMs, hostNow: x.f.captures.get(current.sha256)!.manifest.clock.wallMs + 1, judgmentSlots: [] }, transfer = unwrap(deriveDevelopmentOpportunity(x.context, task, selector, related, signedReceipt(x, b), b.hostNow));
    assert.equal(validateDevelopmentTransferIntervals(learning, experiences, transfer, ids, 1000).status, 'derived');
    const duplicate = structuredClone(experiences); duplicate[1]!.episodeId = duplicate[0]!.episodeId; assert.equal(validateDevelopmentTransferIntervals(learning, duplicate, transfer, ids, 1000).status, 'failed');
    const overlap = structuredClone(experiences); overlap[0]!.interval.lowerWallMs = learning.interval.upperWallMs; assert.equal(validateDevelopmentTransferIntervals(learning, overlap, transfer, ids, 1000).status, 'failed');
    const early = structuredClone(transfer); early.interval.lowerWallMs = learning.interval.upperWallMs + 999; assert.equal(validateDevelopmentTransferIntervals(learning, experiences, early, ids, 1000).status, 'failed');
    const failed = { ...learning, behavior: 'fail' as const }; assert.equal(validateDevelopmentTransferIntervals(failed, experiences, transfer, ids, 1000).status, 'unavailable');
  } finally { x.f.close(); }
});

test('extraction stays bound to the actual result producer when a later observation row repeats its ID', async () => {
  const x = admissionFixture(); try { const before = x.f.capture(), run = x.f.core.receive(message()).run; await x.f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); x.f.advance(); const first = x.input(before, x.f.capture()), original = unwrap(extractDevelopmentAssignmentArtifacts(x.context, first, 'assignment:0'));
    const row = x.f.store.list<Observation>('observations')[0]!, changed = { ...row.value, value: { fabricated: 'newer row must not replace result output' } }; x.f.store.put('observations', row.key, changed, row.revision); x.f.store.append({ id: 'later-observation-with-same-id', stream: run.id, type: 'observation', data: changed as any }); x.f.advance();
    const later = x.input(before, x.f.capture()), extracted = unwrap(extractDevelopmentAssignmentArtifacts(x.context, later, 'assignment:0')); assert.equal(Buffer.from(extracted.output!).toString(), Buffer.from(original.output!).toString()); assert.ok(!Buffer.from(extracted.output!).toString().includes('fabricated'));
  } finally { x.f.close(); }
});
