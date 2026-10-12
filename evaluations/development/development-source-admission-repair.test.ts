// Independent OD2-b1 review. Setup below copied from the author fixture only; no registered author tests imported.
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

// Fixture setup copied from unchanged independent review; assertions below are new repair variants.
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

test('repair: learning pins receipt, support slots, key bytes and reader identities before source callbacks', async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const r = receipt(x, b), accepted = structuredClone(r), key = Uint8Array.from(x.key), open = input.openAcquiredCapture;
    const slots: ArtifactRef[] = []; let callbacks = 0;
    input.openAcquiredCapture = ref => {
      callbacks++; const result = open(ref);
      r.sha256 = identity('changed receipt'); r.uri = `sha256:${r.sha256}`; slots.push(x.put('unreserved'));
      input.roleId = 'foreign'; input.openAcquiredCapture = () => { throw Error('replacement source callback'); };
      x.context.readArtifact = () => { throw Error('replacement context callback'); }; x.key.fill(0);
      return result;
    };
    const p = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, r, b.hostNow, slots));
    assert.ok(callbacks > 0); assert.equal(canonicalJson(p.checks), canonicalJson([accepted])); assert.equal(p.check.value.opportunityId, subjectId);
    assert.notDeepEqual(x.key, key); assert.equal(p.policyDigest, p.check.value.policyDigest); assert.equal(p.source.assignment.roleId, 'candidate');
  } finally { x.f.close(); }
});

test('repair: direct verifier pins complete binding and receipt before qualification reads', async () => {
  const { x, b } = await initial(); try {
    const r = receipt(x, b), accepted = structuredClone(r), subjectId = b.subjectId, read = x.context.readArtifact; let reads = 0;
    x.context.readArtifact = (ref, limit) => {
      reads++; const result = read(ref, limit);
      r.sha256 = identity('later receipt'); r.uri = `sha256:${r.sha256}`;
      b.subjectId = 'foreign'; b.assignmentIds[0] = 'foreign'; b.sourceDigest = identity('later source'); b.output.sha256 = identity('later output');
      b.feedback.uri = 'foreign'; b.completeAt = Infinity; b.hostNow = -Infinity; b.judgmentSlots.push(x.put('unreserved'));
      x.context.readArtifact = () => { throw Error('later callback'); }; x.trust.acceptedPolicyDigest = identity('later policy'); x.key.fill(0);
      return result;
    };
    const check = unwrap(verifyDevelopmentSourceCheck(x.context, r, b));
    assert.ok(reads > 0); assert.equal(check.value.opportunityId, subjectId); assert.equal(accepted.sha256 !== r.sha256, true);
    assert.equal(check.value.output.sha256 === b.output.sha256, false);
  } finally { x.f.close(); }
});

test('repair: ordinary Uint8Array checker keys retain authentication after caller byte mutation', async () => {
  const { x, b } = await initial(); try {
    const r = receipt(x, b), read = x.context.readArtifact, key = Uint8Array.from(x.key); x.trust.checker!.key = key;
    x.context.readArtifact = (ref, limit) => { const result = read(ref, limit); key.fill(0); return result; };
    const check = unwrap(verifyDevelopmentSourceCheck(x.context, r, b));
    assert.equal(check.value.opportunityId, b.subjectId); assert.ok(key.every(byte => byte === 0));
  } finally { x.f.close(); }
});

test('repair: proof slot discriminants refuse executable coercion without invoking it', () => {
  const x = admissionFixture(); try {
    let calls = 0; const kind = new Proxy({}, { get() { calls++; return () => 'checker'; } });
    assert.throws(() => developmentProofSlot(x.plan, kind as 'checker', 'candidate', 'transfer-0')); assert.equal(calls, 0);
  } finally { x.f.close(); }
});

test('repair: opportunity pins related membership and receipt before earliest workload callback', async () => {
  const { x, input, feedback, selector, b } = await opportunity(); try {
    const r = receipt(x, b), accepted = structuredClone(r), subjectId = selector.opportunityId, related = [feedback], slots: ArtifactRef[] = [];
    const read = x.context.readArtifact; let reads = 0;
    x.context.readArtifact = (ref, limit) => {
      reads++; const result = read(ref, limit);
      selector.opportunityId = 'transfer-0'; selector.assignmentId = 'foreign'; selector.related.length = 0;
      related.length = 0; feedback.roleId = 'foreign'; feedback.openAcquiredCapture = () => { throw Error('changed related callback'); };
      input.before.sha256 = identity('changed bracket'); input.configurationDigest = identity('changed configuration');
      r.sha256 = identity('changed receipt'); r.uri = `sha256:${r.sha256}`; slots.push(x.put('unreserved'));
      return result;
    };
    const p = unwrap(deriveDevelopmentOpportunity(x.context, input, selector, related, r, b.hostNow, slots));
    assert.ok(reads > 0); assert.equal(p.subjectId, subjectId); assert.equal(p.check.value.opportunityId, subjectId);
    assert.equal(canonicalJson(p.checks), canonicalJson([accepted])); assert.equal(p.source.related.length, 1);
    const data = unwrap(developmentSourceObservationData(p)); assert.equal(data.kind, 'opportunity');
    if (data.kind === 'opportunity') assert.equal(data.assignmentId, subjectId);
  } finally { x.f.close(); }
});

test('repair: callbacks cannot mutate retained input through this or supplied reference aliases', async () => {
  const { x, input } = await initial(); try {
    const open = input.openAcquiredCapture, read = x.context.readArtifact; let opened = 0, readCount = 0;
    input.openAcquiredCapture = function (ref) {
      assert.equal(this, undefined); opened++; const result = open(ref); ref.sha256 = identity('changed callback argument'); ref.uri = `sha256:${ref.sha256}`; return result;
    };
    x.context.readArtifact = function (ref, limit) {
      assert.equal(this, undefined); readCount++; const result = read(ref, limit); ref.uri = 'changed callback argument'; return result;
    };
    const p = unwrap(deriveDevelopmentAssignment(x.context, input, 'learning:0'));
    assert.ok(opened > 0 && readCount > 0); assert.equal(canonicalJson(p.captures), canonicalJson([input.before, input.after])); assert.equal(p.roleId, 'candidate');
  } finally { x.f.close(); }
});

for (const target of ['context', 'trust', 'policy', 'plan', 'checker', 'key', 'reader'] as const) test(`repair: ${target} proxies refuse before any trap or reader`, () => {
  const x = admissionFixture(true); try {
    let traps = 0, reads = 0;
    const poison = <T extends object>(value: T): T => new Proxy(value, { ownKeys(t) { traps++; return Reflect.ownKeys(t); }, get(t, k, r) { traps++; return Reflect.get(t, k, r); }, getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); }, apply(t, self, args) { traps++; return Reflect.apply(t as Function, self, args); } });
    x.context.readArtifact = () => { reads++; throw Error('unexpected read'); };
    let context = x.context;
    if (target === 'context') context = poison(context);
    if (target === 'trust') context.trust = poison(context.trust);
    if (target === 'policy') context.policy = poison(context.policy);
    if (target === 'plan') context.plan = poison(context.plan);
    if (target === 'checker') context.trust.checker = poison(context.trust.checker!);
    if (target === 'key') context.trust.checker!.key = poison(context.trust.checker!.key);
    if (target === 'reader') context.readArtifact = poison(context.readArtifact);
    assert.throws(() => validateSourceAdmissionPolicy(context)); assert.throws(() => validateDevelopmentWorkload(context));
    assert.notEqual(verifyDevelopmentSourceCheck(context, x.packet, {} as SourceCheckBinding).status, 'derived');
    assert.equal(traps, 0); assert.equal(reads, 0);
  } finally { x.f.close(); }
});

for (const target of ['plan', 'trust', 'reader', 'key', 'key-iterator'] as const) test(`repair: ${target} getter refuses without execution`, () => {
  const x = admissionFixture(true); try {
    let getters = 0, reads = 0; x.context.readArtifact = () => { reads++; throw Error('unexpected read'); };
    const object = target === 'key' ? x.trust.checker! : target === 'key-iterator' ? x.key : x.context;
    const property = target === 'reader' ? 'readArtifact' : target === 'key-iterator' ? Symbol.iterator : target;
    Object.defineProperty(object, property, { enumerable: true, get() { getters++; throw Error('executed getter'); } });
    assert.throws(() => validateSourceAdmissionPolicy(x.context)); assert.equal(getters, 0); assert.equal(reads, 0);
  } finally { x.f.close(); }
});

for (const boundary of ['assignment', 'extraction', 'cycle', 'experience', 'inspect-learning', 'inspect-opportunity', 'learning', 'opportunity'] as const) test(`repair: ${boundary} rejects executable source inputs before callbacks`, () => {
  const x = admissionFixture(); try {
    let executed = 0, callbacks = 0; const before = x.f.capture(), plain = x.input(before, before);
    x.context.readArtifact = () => { callbacks++; throw Error('unexpected context read'); };
    const run = (input: DevelopmentPageSourceInput) => {
      const selector: OpportunitySelector = { roleId: 'candidate', before, after: before, assignmentId: 'assignment:0', opportunityId: 'transfer-0', related: [] };
      switch (boundary) {
        case 'assignment': return deriveDevelopmentAssignment(x.context, input, 'assignment:0');
        case 'extraction': return extractDevelopmentAssignmentArtifacts(x.context, input, 'assignment:0');
        case 'cycle': return deriveDevelopmentCycle(x.context, input, 'cycle-0', 'selection');
        case 'experience': return deriveDevelopmentExperience(x.context, input, 'assignment:0', 'interference-0');
        case 'inspect-learning': return inspectDevelopmentLearning(x.context, input, 'assignment:0', 'transfer-0');
        case 'inspect-opportunity': return inspectDevelopmentOpportunity(x.context, input, selector, []);
        case 'learning': return deriveDevelopmentLearning(x.context, input, 'assignment:0', 'transfer-0', before, 0);
        case 'opportunity': return deriveDevelopmentOpportunity(x.context, input, selector, [], before, 0);
      }
    };
    const accessor = { ...plain }; Object.defineProperty(accessor, 'roleId', { enumerable: true, get() { executed++; return 'candidate'; } });
    const proxy = new Proxy(plain, { ownKeys(t) { executed++; return Reflect.ownKeys(t); }, getPrototypeOf(t) { executed++; return Reflect.getPrototypeOf(t); } });
    const callbackProxy = { ...plain, openAcquiredCapture: new Proxy(plain.openAcquiredCapture, { apply(t, self, args) { executed++; return Reflect.apply(t, self, args); } }) };
    for (const input of [accessor, proxy, callbackProxy]) assert.equal(run(input).status, 'failed');
    assert.equal(executed, 0); assert.equal(callbacks, 0);
  } finally { x.f.close(); }
});

for (const target of ['receipt', 'binding', 'slots', 'related-array', 'selector', 'cycle-ids', 'interference-ids'] as const) test(`repair: ${target} rejects accessors/proxies before use`, () => {
  const x = admissionFixture(true); try {
    let executed = 0, callbacks = 0; const before = x.f.capture(), input = x.input(before, before);
    x.context.readArtifact = () => { callbacks++; throw Error('unexpected read'); };
    const proxy = <T extends object>(v: T): T => new Proxy(v, { ownKeys(t) { executed++; return Reflect.ownKeys(t); }, get(t, k, r) { executed++; return Reflect.get(t, k, r); } });
    const getter = <T extends object>(v: T, key: string): T => { Object.defineProperty(v, key, { enumerable: true, get() { executed++; return 'foreign'; } }); return v; };
    const selector: OpportunitySelector = { roleId: 'candidate', before, after: before, assignmentId: 'learning:0', opportunityId: 'transfer-0', related: [] };
    const binding = { roleId: 'candidate', subjectId: 'transfer-0', assignmentIds: ['learning:0'], sourceDigest: identity('source'), output: before, feedback: before, acquisition: 'completed', completeAt: 0, hostNow: 0, judgmentSlots: [] } satisfies SourceCheckBinding;
    if (target === 'receipt') for (const r of [proxy({ ...before }), getter({ ...before }, 'sha256')]) {
      assert.equal(verifyDevelopmentSourceCheck(x.context, r, binding).status, 'failed');
      assert.equal(deriveDevelopmentLearning(x.context, input, 'learning:0', 'transfer-0', r, 0).status, 'failed');
      assert.equal(deriveDevelopmentOpportunity(x.context, input, selector, [], r, 0).status, 'failed');
    }
    if (target === 'binding') for (const b of [proxy({ ...binding }), getter({ ...binding }, 'subjectId')]) assert.equal(verifyDevelopmentSourceCheck(x.context, before, b).status, 'failed');
    if (target === 'slots') for (const slots of [proxy<ArtifactRef[]>([]), getter([before], '0')]) {
      assert.equal(deriveDevelopmentLearning(x.context, input, 'learning:0', 'transfer-0', before, 0, slots).status, 'failed');
      assert.equal(deriveDevelopmentOpportunity(x.context, input, selector, [], before, 0, slots).status, 'failed');
    }
    if (target === 'related-array') for (const related of [proxy([input]), getter([input], '0')]) {
      assert.equal(inspectDevelopmentOpportunity(x.context, input, selector, related).status, 'failed');
      assert.equal(deriveDevelopmentOpportunity(x.context, input, selector, related, before, 0).status, 'failed');
    }
    if (target === 'selector') for (const s of [proxy({ ...selector }), getter({ ...selector }, 'opportunityId')]) {
      assert.equal(inspectDevelopmentOpportunity(x.context, input, s, []).status, 'failed');
      assert.equal(deriveDevelopmentOpportunity(x.context, input, s, [], before, 0).status, 'failed');
    }
    if (target === 'cycle-ids') assert.equal(validateDevelopmentCycleIntervals([], proxy<string[]>([]), 0, 300, 100).status, 'failed');
    if (target === 'interference-ids') assert.equal(validateDevelopmentTransferIntervals({} as DevelopmentLearningProof, [], {} as DevelopmentOpportunityProof, proxy<string[]>([]), 100).status, 'failed');
    assert.equal(executed, 0); assert.equal(callbacks, 0);
  } finally { x.f.close(); }
});

