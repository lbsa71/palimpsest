// Independent repair re-review. Only setup is copied; no test-registering module is imported.
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

// Fixture builders copied from the unchanged review/repair setup; all tests below are new independent predicates.
const prompt = { id: 'review', fragments: [], requestDigest: identity('review') };
async function completed(x: ReturnType<typeof admissionFixture>) {
  const before = x.f.capture(), run = x.f.core.receive(message()).run;
  await x.f.runtime.resume(run.id, prompt); x.f.advance();
  return { run, input: x.input(before, x.f.capture()) };
}
function receipt(x: ReturnType<typeof admissionFixture>, b: SourceCheckBinding, overrides: Partial<DevelopmentSourceCheck> = {}) {
  return x.put(signDocument(developmentSourceCheckDomain, { version: 1, planDigest: x.policy.planDigest, policyDigest: x.trust.acceptedPolicyDigest, roleId: b.roleId, opportunityId: b.subjectId, assignmentIds: b.assignmentIds, sourceDigest: b.sourceDigest, checkerSourceDigest: x.policy.checkerSourceDigest!, extractorSourceDigest: x.policy.extractorSourceDigest!, rubricDigest: x.policy.rubricDigest!, output: b.output, feedback: b.feedback, acquisition: b.acquisition, behavior: 'pass', disclosure: 'preserved', matching: 'valid', judgments: [], checkedAt: new Date(b.hostNow).toISOString(), ...overrides } satisfies DevelopmentSourceCheck, x.trust.checker!.id, x.key));
}
async function initial() {
  const x = admissionFixture(true), input = await x.deliver('learning:0'), subjectId = x.workload.opportunities.find(o => o.roles[0]!.learningAssignmentId === 'learning:0')!.id;
  x.retainExtraction(input, 'learning:0');
  const ci = unwrap(inspectDevelopmentLearning(x.context, input, 'learning:0', subjectId));
  const b: SourceCheckBinding = { roleId: ci.roleId, subjectId, assignmentIds: ci.assignmentIds, sourceDigest: ci.sourceDigest, output: ci.output, feedback: ci.feedback, acquisition: 'completed', completeAt: ci.interval.upperWallMs, hostNow: ci.interval.upperWallMs + 1, judgmentSlots: [] };
  return { x, input, subjectId, b };
}
async function opportunity() {
  const x = admissionFixture(true), index = x.workload.opportunities.findIndex(o => o.family !== 'transfer'), subjectId = x.workload.opportunities[index]!.id;
  const input = await x.deliver(`opportunity:${index}`), feedback = await x.deliver(`feedback:${index}`); input.current = feedback.after;
  const selector: OpportunitySelector = { roleId: 'candidate', before: input.before, after: input.after, assignmentId: `opportunity:${index}`, opportunityId: subjectId, related: [{ roleId: 'candidate', assignmentId: `feedback:${index}`, before: feedback.before, after: feedback.after }] };
  x.retainExtraction(input, selector.assignmentId); x.retainExtraction(feedback, selector.related[0]!.assignmentId);
  const ci = unwrap(inspectDevelopmentOpportunity(x.context, input, selector, [feedback])), end = x.f.captures.get(feedback.after.sha256)!.manifest.clock.wallMs;
  const b: SourceCheckBinding = { roleId: ci.roleId, subjectId, assignmentIds: ci.assignmentIds, sourceDigest: ci.sourceDigest, output: ci.output, feedback: ci.feedback, acquisition: 'completed', completeAt: end, hostNow: end + 1, judgmentSlots: [] };
  return { x, input, feedback, selector, b };
}

// Behavioral tests use actual local captured source; all callbacks below are explicit fixture seams.
for (const representation of ['buffer-view', 'uint8-view'] as const) test(`rereview: ${representation} copies exactly the accepted key view across backing-store mutation`, async () => {
  const { x, b } = await initial(); try {
    const r = receipt(x, b), backing = Buffer.alloc(96, 97); backing.set(x.key, 19);
    const view = representation === 'buffer-view' ? backing.subarray(19, 51) : new Uint8Array(backing.buffer, backing.byteOffset + 19, 32);
    x.trust.checker!.key = view;
    const read = x.context.readArtifact; let calls = 0;
    x.context.readArtifact = function (ref, limit) { assert.equal(this, undefined); calls++; const result = read(ref, limit); backing.fill(0); return result; };
    const check = unwrap(verifyDevelopmentSourceCheck(x.context, r, b));
    assert.ok(calls > 0); assert.equal(check.value.sourceDigest, b.sourceDigest); assert.equal(check.value.opportunityId, b.subjectId);
    assert.ok(view.every(byte => byte === 0));
    assert.equal(verifyDevelopmentSourceCheck(x.context, r, b).status, 'failed', 'next call must authenticate against its newly accepted key bytes');
  } finally { x.f.close(); }
});

test('rereview: post-entry key replacement cannot authorize a receipt signed by that replacement', async () => {
  const { x, b } = await initial(); try {
    x.key.fill(71); const r = receipt(x, b); x.key.fill(29);
    const read = x.context.readArtifact;
    x.context.readArtifact = (ref, limit) => { x.key.fill(71); return read(ref, limit); };
    const denied = verifyDevelopmentSourceCheck(x.context, r, b);
    assert.equal(denied.status, 'failed'); assert.match(denied.code, /signature/);
    assert.equal(unwrap(verifyDevelopmentSourceCheck(x.context, r, b)).value.sourceDigest, b.sourceDigest, 'a distinct next invocation accepts its newly pinned key');
  } finally { x.f.close(); }
});

test('rereview: nested context mutations cannot change a running check and are rejected at the next entry', async () => {
  const { x, b } = await initial(); try {
    const r = receipt(x, b), acceptedPlan = x.policy.planDigest, acceptedPolicy = x.trust.acceptedPolicyDigest;
    const read = x.context.readArtifact; let reads = 0;
    x.context.readArtifact = (ref, limit) => {
      reads++; const out = read(ref, limit);
      x.plan.registration.value.roles[0]!.configurationDigest = identity('new role configuration');
      x.plan.protocol!.schedule[0]!.assignmentId = 'substituted assignment';
      x.policy.qualification = x.put({ unauthorized: true });
      x.policy.bounds.maxProofBytes = 1;
      x.trust.checker!.principalId = 'candidate-self'; x.trust.checker!.independenceGroup = 'candidate';
      x.trust.acceptedQualificationDigest = identity('substituted qualification');
      return out;
    };
    const accepted = unwrap(verifyDevelopmentSourceCheck(x.context, r, b));
    assert.ok(reads > 0); assert.equal(accepted.value.planDigest, acceptedPlan); assert.equal(accepted.value.policyDigest, acceptedPolicy);
    const count = reads; assert.equal(verifyDevelopmentSourceCheck(x.context, r, b).status, 'failed'); assert.equal(reads, count);
  } finally { x.f.close(); }
});

test('rereview: source artifact callback receives detached arguments and no receiver authority', async () => {
  const x = admissionFixture(); try {
    const { input } = await completed(x), original = structuredClone(input.assignmentPacket), read = input.readArtifact;
    let callbacks = 0;
    input.readArtifact = function (ref, limit) {
      assert.equal(this, undefined); callbacks++; const output = read(ref, limit);
      ref.sha256 = identity('argument alias'); ref.uri = `sha256:${ref.sha256}`;
      input.assignmentPacket = x.put({ version: 1, assignments: [] });
      input.current = x.put('unavailable capture'); input.bounds.maxProofBytes = 1;
      return output;
    };
    const proof = unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:0'));
    assert.ok(callbacks > 0); assert.equal(canonicalJson(proof.source.assignmentPacket), canonicalJson(original)); assert.equal(proof.acquisition, 'completed');
    assert.equal(deriveDevelopmentAssignment(x.context, input, 'assignment:0').status, 'failed');
  } finally { x.f.close(); }
});

test('rereview: plain null-prototype records preserve valid source and semantic receipt behavior', async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const r = receipt(x, b);
    const plain = <T extends object>(value: T): T => Object.assign(Object.create(null), value);
    const context = plain({ ...x.context, trust: plain({ ...x.trust, checker: plain(x.trust.checker!) }) });
    const proof = unwrap(deriveDevelopmentLearning(context, plain(input), 'learning:0', subjectId, plain(r), b.hostNow));
    assert.equal(proof.subjectId, subjectId); assert.equal(proof.check.value.sourceDigest, b.sourceDigest);
    assert.equal(unwrap(developmentSourceObservationData(proof)).kind, 'learning');
  } finally { x.f.close(); }
});

for (const entry of ['learning', 'opportunity'] as const) test(`rereview: ${entry} refuses source withdrawal during receipt read`, async () => {
  const state = entry === 'learning' ? await initial() : await opportunity(), { x, input, b } = state;
  try {
    const r = receipt(x, b), read = x.context.readArtifact; let withdrawn = false;
    x.context.readArtifact = (ref, limit) => {
      const out = read(ref, limit);
      if (ref.sha256 === r.sha256) { withdrawn = true; x.f.revoke(); }
      return out;
    };
    const result = 'selector' in state
      ? deriveDevelopmentOpportunity(x.context, input, state.selector, [state.feedback], r, b.hostNow)
      : deriveDevelopmentLearning(x.context, input, 'learning:0', state.subjectId, r, b.hostNow);
    assert.equal(withdrawn, true); assert.notEqual(result.status, 'derived');
    if (result.status !== 'derived') assert.match(result.code, /withdrawn/);
  } finally { x.f.close(); }
});

test('rereview: changing only the source interval invalidates an old receipt even for the same consumed output', async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const oldReceipt = receipt(x, b), oldProof = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, oldReceipt, b.hostNow));
    x.f.advance(100); const later = x.f.capture(), changed = { ...input, after: later, current: later };
    const ci = unwrap(inspectDevelopmentLearning(x.context, changed, 'learning:0', subjectId));
    assert.equal(ci.output.sha256, b.output.sha256); assert.notEqual(ci.sourceDigest, b.sourceDigest);
    const denied = deriveDevelopmentLearning(x.context, changed, 'learning:0', subjectId, oldReceipt, ci.interval.upperWallMs + 1);
    assert.equal(denied.status, 'failed'); assert.match(denied.code, /commitment differs/);
    const freshBinding = { ...b, sourceDigest: ci.sourceDigest, completeAt: ci.interval.upperWallMs, hostNow: ci.interval.upperWallMs + 1 };
    const fresh = unwrap(deriveDevelopmentLearning(x.context, changed, 'learning:0', subjectId, receipt(x, freshBinding), freshBinding.hostNow));
    assert.equal(fresh.source.assignment.source.assignment.runId, oldProof.source.assignment.source.assignment.runId);
    assert.equal(fresh.check.value.sourceDigest, ci.sourceDigest); assert.equal(fresh.interval.upperWallMs, ci.interval.upperWallMs);
  } finally { x.f.close(); }
});

for (const target of ['receipt', 'output', 'feedback', 'judgment'] as const) test(`rereview: same-size retained ${target} byte substitution refuses exact signed provenance`, async () => {
  const { x, b } = await initial(); try {
    const judgment = x.put({ external: 'bounded supporting evidence' }); b.judgmentSlots = [judgment];
    const r = receipt(x, b, { judgments: [judgment] });
    const targetRef = target === 'receipt' ? r : target === 'output' ? b.output : target === 'feedback' ? b.feedback : judgment;
    const read = x.context.readArtifact; let changed = false;
    x.context.readArtifact = (ref, limit) => { const out = read(ref, limit); if (ref.sha256 === targetRef.sha256) { changed = true; out[0] = out[0]! ^ 1; } return out; };
    const result = verifyDevelopmentSourceCheck(x.context, r, b);
    assert.equal(changed, true); assert.equal(result.status, 'failed'); assert.match(result.code, /source bytes differ/);
  } finally { x.f.close(); }
});

for (const axes of [
  { acquisition: 'completed', behavior: 'fail', disclosure: 'preserved', matching: 'valid' },
  { acquisition: 'failed', behavior: 'unavailable', disclosure: 'violated', matching: 'invalid' },
  { acquisition: 'unavailable', behavior: 'unavailable', disclosure: 'unavailable', matching: 'unavailable' },
] as const) test(`rereview: authenticated ${axes.acquisition}/${axes.behavior} learning stays unavailable for successful-learning observation`, async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const r = receipt(x, b, axes), proof = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, r, b.hostNow));
    assert.equal(proof.acquisition, axes.acquisition); assert.equal(proof.behavior, axes.behavior); assert.equal(proof.disclosure, axes.disclosure); assert.equal(proof.matching, axes.matching);
    assert.equal(developmentSourceObservationData(proof).status, 'unavailable');
  } finally { x.f.close(); }
});

function hostile<T extends object>(value: T, kind: 'accessor' | 'proxy' | 'revoked', key: string, counter: { executions: number }): T {
  if (kind === 'accessor') { Object.defineProperty(value, key, { enumerable: true, configurable: true, get() { counter.executions++; return 'executed'; } }); return value; }
  const handler: ProxyHandler<T> = {
    ownKeys(t) { counter.executions++; return Reflect.ownKeys(t); },
    get(t, k, receiver) { counter.executions++; return Reflect.get(t, k, receiver); },
    getOwnPropertyDescriptor(t, k) { counter.executions++; return Reflect.getOwnPropertyDescriptor(t, k); },
    getPrototypeOf(t) { counter.executions++; return Reflect.getPrototypeOf(t); },
  };
  if (kind === 'revoked') { const p = Proxy.revocable(value, handler); p.revoke(); return p.proxy; }
  return new Proxy(value, handler);
}

for (const kind of ['accessor', 'proxy', 'revoked'] as const) test(`rereview: nested ${kind} proof data refuses at serializer and observation boundaries without execution`, async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const proof = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, receipt(x, b), b.hostNow));
    for (const location of ['source', 'check', 'interval', 'capture'] as const) {
      const p = structuredClone(proof), counter = { executions: 0 };
      if (location === 'source') p.source.assignment.source.assignment = hostile(p.source.assignment.source.assignment, kind, 'runId', counter);
      if (location === 'check') p.check.value = hostile(p.check.value, kind, 'behavior', counter);
      if (location === 'interval') p.interval = hostile(p.interval, kind, 'upperWallMs', counter);
      if (location === 'capture') p.captures[0] = hostile(p.captures[0]!, kind, 'sha256', counter);
      assert.throws(() => encodeDevelopmentSourceProof(p, x.policy.bounds.maxProofBytes));
      assert.equal(developmentSourceObservationData(p).status, 'failed'); assert.equal(counter.executions, 0, location);
    }
  } finally { x.f.close(); }
});

for (const kind of ['accessor', 'proxy', 'revoked'] as const) test(`rereview: nested ${kind} source and checker binding inputs refuse before reader callbacks`, async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const r = receipt(x, b), counter = { executions: 0 }; let reads = 0;
    x.context.readArtifact = () => { reads++; throw Error('unexpected reader'); };
    const badInput = { ...input, journal: hostile(structuredClone(input.journal), kind, 'stream', counter) };
    assert.equal(inspectDevelopmentLearning(x.context, badInput, 'learning:0', subjectId).status, 'failed');
    assert.equal(deriveDevelopmentAssignment(x.context, badInput, 'learning:0').status, 'failed');
    assert.equal(extractDevelopmentAssignmentArtifacts(x.context, badInput, 'learning:0').status, 'failed');
    const badBinding = { ...b, judgmentSlots: [hostile({ ...r }, kind, 'sha256', counter)] };
    assert.equal(verifyDevelopmentSourceCheck(x.context, r, badBinding).status, 'failed');
    assert.equal(reads, 0); assert.equal(counter.executions, 0);
  } finally { x.f.close(); }
});

for (const kind of ['accessor', 'proxy', 'revoked'] as const) test(`rereview: ${kind} nested related selector and source refuse before reads at both opportunity entries`, async () => {
  const { x, input, feedback, selector, b } = await opportunity(); try {
    const r = receipt(x, b), counter = { executions: 0 }; let reads = 0;
    x.context.readArtifact = () => { reads++; throw Error('unexpected reader'); };
    const badSelector = structuredClone(selector); badSelector.related[0]!.before = hostile(badSelector.related[0]!.before, kind, 'sha256', counter);
    const badRelated = { ...feedback, metadataBounds: hostile({ ...feedback.metadataBounds }, kind, 'maxBytes', counter) };
    for (const [s, related] of [[badSelector, [feedback]], [selector, [badRelated]]] as [OpportunitySelector, DevelopmentPageSourceInput[]][]) {
      assert.equal(inspectDevelopmentOpportunity(x.context, input, s, related).status, 'failed');
      assert.equal(deriveDevelopmentOpportunity(x.context, input, s, related, r, b.hostNow).status, 'failed');
    }
    assert.equal(counter.executions, 0); assert.equal(reads, 0);
  } finally { x.f.close(); }
});

test('rereview: public interval and slot APIs refuse executable nested values without coercion', () => {
  const x = admissionFixture(); try {
    const counter = { executions: 0 };
    for (const kind of ['accessor', 'proxy', 'revoked'] as const) {
      const source = hostile({ runId: 'run', selection: { id: 'selection' } }, kind, 'runId', counter);
      const cycles = [{ source: { cycle: source } }] as DevelopmentCycleProof[];
      assert.equal(validateDevelopmentCycleIntervals(cycles, ['cycle-0', 'cycle-1', 'cycle-2'], 0, 300, 100).status, 'failed');
      const learning = { source: hostile({ assignment: {} }, kind, 'assignment', counter) } as DevelopmentLearningProof;
      assert.equal(validateDevelopmentTransferIntervals(learning, [], {} as DevelopmentOpportunityProof, [], 100).status, 'failed');
      const plan = structuredClone(x.plan); plan.registration.value.roles[0] = hostile(plan.registration.value.roles[0]!, kind, 'id', counter);
      assert.throws(() => developmentProofSlot(plan, 'checker', 'candidate', 'transfer-0'));
    }
    assert.equal(counter.executions, 0);
  } finally { x.f.close(); }
});
