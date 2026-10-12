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

// Independent assertions begin here. Fixture trust is synthetic and does not qualify a checker.
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

test('review: exact producer output survives later same-ID observation mutation; extraction is detached and bounded', async () => {
  const x = admissionFixture(); try {
    const { run, input } = await completed(x), original = unwrap(extractDevelopmentAssignmentArtifacts(x.context, input, 'assignment:0'));
    const row = x.f.store.list<Observation>('observations')[0]!;
    const changed = { ...row.value, value: { independentReview: 'later forged result' } };
    x.f.store.put('observations', row.key, changed, row.revision); x.f.store.append({ id: 'review-later-version', stream: run.id, type: 'observation', data: changed as any }); x.f.advance();
    const later = x.input(input.before, x.f.capture()), next = unwrap(extractDevelopmentAssignmentArtifacts(x.context, later, 'assignment:0'));
    assert.deepEqual(next.output, original.output); original.output!.fill(0);
    assert.notDeepEqual(unwrap(extractDevelopmentAssignmentArtifacts(x.context, later, 'assignment:0')).output, original.output);
    const proof = unwrap(deriveDevelopmentAssignment(x.context, later, 'assignment:0')), encoded = encodeDevelopmentSourceProof(proof, 65536);
    assert.equal(encodeDevelopmentSourceProof(proof, encoded.length).length, encoded.length);
    assert.throws(() => encodeDevelopmentSourceProof(proof, encoded.length - 1), /bound/);
    assert.equal(proof.source.assignment.runId, run.id); assert.equal(proof.acquisition, 'completed'); assert.equal('signature' in proof, false);
    const reduced = { ...later, bounds: { ...later.bounds, maxArtifactBytes: next.output!.length - 1 } };
    assert.notEqual(extractDevelopmentAssignmentArtifacts(x.context, reduced, 'assignment:0').status, 'derived');
  } finally { x.f.close(); }
});
test('review: consuming new input without a result cannot reuse checkpoint output', async () => {
  const x = admissionFixture(); try {
    x.f.setStatus('checkpointed'); const { run, input } = await completed(x), second = message('2', 'independent new input');
    assert.equal(x.f.core.receive(second).run.id, run.id); x.f.mode('checkpoint-failure'); await x.f.runtime.resume(run.id, prompt); x.f.advance();
    x.plan.assignmentPacket = x.f.assignmentPacket([message(), second]); x.accept();
    const stale = unwrap(deriveDevelopmentAssignment(x.context, x.input(input.before, x.f.capture()), 'assignment:1'));
    assert.equal(stale.acquisition, 'unavailable'); assert.equal(stale.output, null);
    x.f.mode('observe'); x.f.setStatus('completed'); await x.f.runtime.resume(run.id, prompt); x.f.advance();
    const fresh = unwrap(deriveDevelopmentAssignment(x.context, x.input(input.before, x.f.capture()), 'assignment:1'));
    assert.equal(fresh.acquisition, 'completed'); assert.ok(fresh.output); assert.equal(fresh.source.assignment.runId, run.id);
  } finally { x.f.close(); }
});
for (const bad of ['input', 'configuration', 'packet', 'withdrawal'] as const) test(`review: source ${bad} cannot survive exact source derivation`, async () => {
  const x = admissionFixture(); try { const { input } = await completed(x); assert.equal(deriveDevelopmentAssignment(x.context, input, 'assignment:0').status, 'derived');
    if (bad === 'input') { x.plan.assignmentPacket = x.f.assignmentPacket([message('1', 'different promised body')]); input.assignmentPacket = x.plan.assignmentPacket; x.accept(); }
    if (bad === 'configuration') input.configurationDigest = identity('wrong configuration');
    if (bad === 'packet') input.assignmentPacket = x.put({ version: 1, assignments: [] });
    if (bad === 'withdrawal') x.f.revoke();
    assert.notEqual(deriveDevelopmentAssignment(x.context, input, 'assignment:0').status, 'derived');
  } finally { x.f.close(); }
});
for (const bad of ['extractor', 'checker', 'future', 'deadline', 'membership', 'signature', 'principal', 'certificate', 'feedback-bytes', 'missing-work'] as const) test(`review: synthetic checker ${bad} contradiction refuses`, async () => {
  const { x, input, subjectId, b } = await initial(); try {
    assert.equal(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, receipt(x, b), b.hostNow).status, 'derived');
    let r = receipt(x, b);
    if (bad === 'extractor') r = receipt(x, b, { extractorSourceDigest: identity('different executable') });
    if (bad === 'checker') r = receipt(x, b, { checkerSourceDigest: identity('different checker') });
    if (bad === 'future') r = receipt(x, b, { checkedAt: new Date(b.hostNow + 1).toISOString() });
    if (bad === 'deadline') { b.hostNow = Date.parse(x.plan.manifest.value.deadlineAt) + 1; r = receipt(x, b); }
    if (bad === 'membership') { b.subjectId = 'unregistered'; r = receipt(x, b); }
    if (bad === 'signature') { const d = JSON.parse(Buffer.from(x.f.raw.get(r.sha256)!).toString()); d.signature = identity('forged'); r = x.put(d); }
    if (bad === 'principal') x.trust.checker!.principalId = 'other external principal';
    if (bad === 'certificate') { const q = JSON.parse(Buffer.from(x.f.raw.get(x.policy.qualification!.sha256)!).toString()); q.rubricDigest = identity('wrong rubric'); x.policy.qualification = x.put(q); x.trust.acceptedQualificationDigest = x.policy.qualification.sha256; x.accept(); r = receipt(x, b); }
    if (bad === 'feedback-bytes') x.f.raw.set(b.feedback.sha256, Buffer.from('wrong retained bytes'));
    if (bad === 'missing-work') b.acquisition = 'unavailable';
    assert.notEqual(verifyDevelopmentSourceCheck(x.context, r, b).status, 'derived');
  } finally { x.f.close(); }
});
test('review: signed wrong or unknown behavior stays distinct from completed source acquisition', async () => {
  const { x, input, feedback, selector, b } = await opportunity(); try {
    for (const behavior of ['fail', 'unavailable'] as const) {
      const p = unwrap(deriveDevelopmentOpportunity(x.context, input, selector, [feedback], receipt(x, b, { behavior }), b.hostNow));
      assert.equal(p.acquisition, 'completed'); assert.equal(p.behavior, behavior);
      const observation = unwrap(developmentSourceObservationData(p)); assert.equal(observation.kind, 'opportunity'); if (observation.kind === 'opportunity') assert.equal(observation.result, 'completed');
    }
    const unavailable = unwrap(deriveDevelopmentOpportunity(x.context, input, selector, [feedback], receipt(x, b, { disclosure: 'unavailable' }), b.hostNow));
    assert.equal(developmentSourceObservationData(unavailable).status, 'unavailable');
    const violated = unwrap(deriveDevelopmentOpportunity(x.context, input, selector, [feedback], receipt(x, b, { disclosure: 'violated' }), b.hostNow));
    const data = unwrap(developmentSourceObservationData(violated)); assert.equal(data.kind, 'opportunity'); if (data.kind === 'opportunity') assert.equal(data.audienceBoundaryPreserved, false);
  } finally { x.f.close(); }
});
test('review: opportunity selector remains pinned across source reader callbacks', async () => {
  const { x, input, feedback, selector, b } = await opportunity(); try {
    const r = receipt(x, b), originalId = selector.opportunityId, open = input.openAcquiredCapture;
    input.openAcquiredCapture = ref => { selector.opportunityId = x.workload.opportunities.find(o => o.id !== originalId)!.id; return open(ref); };
    const result = deriveDevelopmentOpportunity(x.context, input, selector, [feedback], r, b.hostNow);
    if (result.status === 'derived') {
      assert.equal(result.proof.subjectId, originalId, 'returned proof subject must equal the subject authenticated by its checker');
      assert.equal(result.proof.subjectId, result.proof.check.value.opportunityId);
    }
  } finally { x.f.close(); }
});
test('review: context trust getters are rejected without executing user code', () => {
  const x = admissionFixture(); let reads = 0; try {
    const value = x.trust.acceptedPolicyDigest;
    Object.defineProperty(x.trust, 'acceptedPolicyDigest', { enumerable: true, get() { reads++; return value; } });
    let rejected = false; try { validateSourceAdmissionPolicy(x.context); } catch { rejected = true; }
    assert.equal(reads, 0, 'trust getter executed before inert validation'); assert.equal(rejected, true);
  } finally { x.f.close(); }
});
test('review: receipt reference getters are rejected without executing user code', async () => {
  const { x, b } = await initial(); let reads = 0; try {
    const r = receipt(x, b), sha256 = r.sha256;
    Object.defineProperty(r, 'sha256', { enumerable: true, get() { reads++; return sha256; } });
    const result = verifyDevelopmentSourceCheck(x.context, r, b);
    assert.equal(reads, 0, 'receipt reference getter executed before inert validation'); assert.notEqual(result.status, 'derived');
  } finally { x.f.close(); }
});
test('review: source proxy traps are rejected without executing user code', async () => {
  const x = admissionFixture(); let traps = 0; try {
    const { input } = await completed(x), proxy = new Proxy(input, { ownKeys(t) { traps++; return Reflect.ownKeys(t); } });
    const result = deriveDevelopmentAssignment(x.context, proxy, 'assignment:0');
    assert.equal(traps, 0, 'proxy trap executed before inert validation'); assert.notEqual(result.status, 'derived');
  } finally { x.f.close(); }
});
test('review: newly ingested attributable episode uses journal creation, never actor date', async () => {
  const x = admissionFixture(true); try {
    const input = await x.deliver('interference:0', true), id = x.plan.manifest.value.opportunities.find(o => o.family === 'transfer')!.interferenceIds[0]!;
    const p = unwrap(deriveDevelopmentExperience(x.context, input, 'interference:0', id));
    assert.ok(p.source.creation.sequence > p.source.assignment.ingress.sequence);
    assert.equal(p.interval.lowerWallMs, Date.parse('2026-10-12T02:00:00Z'));
    assert.notEqual(p.interval.lowerWallMs, Date.parse('2000-01-01T00:00:00Z'));
    const old = x.input(input.after, input.after);
    assert.notEqual(deriveDevelopmentExperience(x.context, old, 'interference:0', id).status, 'derived');
  } finally { x.f.close(); }
});
for (const bad of ['absent-marker', 'wrong-actor', 'wrong-content', 'marker-before-episode'] as const) test(`review: episode ${bad} cannot establish attributed exposure`, async () => {
  const x = admissionFixture(true); try {
    const before = x.f.capture(), entry = x.entries.find(e => e.roleId === 'candidate' && e.id === 'interference:0')!, run = x.f.core.receive(entry.message).run;
    const row = x.f.store.list<{ input: { id: string; actorId: string; value: any }; runId: string }>('communications.inputs').find(r => r.value.runId === run.id)!.value, episodeId = `input:${row.input.id}`;
    if (bad === 'marker-before-episode') x.f.store.put('host.ingested', episodeId, true, null);
    new DevelopmentalMemory(x.f.store).ingest({ id: episodeId, runId: run.id, sourceId: row.input.id, actorId: bad === 'wrong-actor' ? 'someone-else' : row.input.actorId, channel: 'speech', scope: run.scope, at: '2026-10-12T02:00:00Z', content: bad === 'wrong-content' ? { wrong: 'unrelated content' } : row.input.value });
    if (bad !== 'absent-marker' && bad !== 'marker-before-episode') x.f.store.put('host.ingested', episodeId, true, null);
    await x.f.runtime.resume(run.id, prompt); x.f.advance();
    const id = x.plan.manifest.value.opportunities.find(o => o.family === 'transfer')!.interferenceIds[0]!;
    assert.notEqual(deriveDevelopmentExperience(x.context, x.input(before, x.f.capture()), 'interference:0', id).status, 'derived');
  } finally { x.f.close(); }
});
async function cycles() {
  const x = admissionFixture(), proofs: DevelopmentCycleProof[] = []; x.f.ready();
  for (let i = 0; i < 3; i++) {
    x.f.advance(1100); const before = x.f.capture(); await x.f.runner.tick(); x.f.advance(10); const input = x.input(before, x.f.capture());
    const { projectDevelopmentPageSources } = await import('./development-observer.ts'); const source = projectDevelopmentPageSources(input).cycles[0]!;
    proofs.push(unwrap(deriveDevelopmentCycle(x.context, input, x.plan.manifest.value.cycles[i]!, source.selection.id)));
  }
  return { x, proofs };
}
test('review: actual three-cycle conservative boundaries and origins survive independent perturbations', async () => {
  const { x, proofs } = await cycles(); try {
    const start = Date.parse(x.plan.manifest.value.notBefore), end = proofs[2]!.interval.upperWallMs;
    assert.equal(validateDevelopmentCycleIntervals(proofs, x.plan.manifest.value.cycles, start, end, 1000).status, 'derived');
    for (const p of proofs) { assert.equal(p.autonomy, 'unavailable'); assert.equal(p.origin, 'unknown'); assert.equal(p.interval.temporalEligibility, 'synthetic'); }
    const variants = [
      (p: DevelopmentCycleProof[]) => { p[1]!.interval.lowerWallMs = p[0]!.interval.upperWallMs + 999; },
      (p: DevelopmentCycleProof[]) => { p[0]!.interval.upperWallMs = p[1]!.interval.lowerWallMs; },
      (p: DevelopmentCycleProof[]) => { p[1]!.source.cycle.runId = p[0]!.source.cycle.runId; },
      (p: DevelopmentCycleProof[]) => { p[1]!.source.cycle.selection.id = p[0]!.source.cycle.selection.id; },
      (p: DevelopmentCycleProof[]) => { p[0]!.interval.temporalEligibility = 'qualified'; },
      (p: DevelopmentCycleProof[]) => { p[0]!.interval.clockKind = 'host'; p[0]!.interval.temporalEligibility = 'unavailable'; },
    ];
    for (const change of variants) { const p = structuredClone(proofs); change(p); assert.notEqual(validateDevelopmentCycleIntervals(p, x.plan.manifest.value.cycles, start, end, 1000).status, 'derived'); }
    assert.notEqual(validateDevelopmentCycleIntervals(proofs, x.plan.manifest.value.cycles, start, end - 1, 1000).status, 'derived');
  } finally { x.f.close(); }
});
for (const bad of ['boot', 'process', 'drift'] as const) test(`review: ${bad} discontinuity invalidates an actual selection`, async () => {
  const x = admissionFixture(); try {
    x.f.ready(); x.f.advance(1100); const before = x.f.capture(); await x.f.runner.tick(); x.f.advance(10); const after = x.f.capture(), original = x.input(before, after);
    const { projectDevelopmentPageSources } = await import('./development-observer.ts'); const selected = projectDevelopmentPageSources(original).cycles[0]!.selection.id;
    assert.equal(deriveDevelopmentCycle(x.context, original, x.plan.manifest.value.cycles[0]!, selected).status, 'derived');
    const reader = x.f.captures.get(after.sha256)!, manifest = structuredClone(reader.manifest);
    if (bad === 'boot') manifest.clock.bootId = 'other-boot'; if (bad === 'process') manifest.clock.processStart = 'other-process'; if (bad === 'drift') manifest.clock.monotonicMs += 1001;
    const changed = x.put(manifest); x.f.captures.set(changed.sha256, { ...reader, manifest });
    assert.notEqual(deriveDevelopmentCycle(x.context, x.input(before, changed), x.plan.manifest.value.cycles[0]!, selected).status, 'derived');
  } finally { x.f.close(); }
});
test('review: host source needs pinned clock qualification; unsigned slots follow exact manifest order', async () => {
  const x = admissionFixture(); try {
    x.f.setClockKind('host'); const { input } = await completed(x), p = unwrap(deriveDevelopmentAssignment(x.context, input, 'assignment:0'));
    assert.equal(p.interval.temporalEligibility, 'unavailable'); assert.equal(developmentSourceObservationData(p).status, 'unavailable');
    assert.deepEqual(developmentProofSlot(x.plan, 'task-output', 'no-memory', x.plan.manifest.value.opportunities[4]!.id), { kind: 'task-output', ordinal: 16 });
    assert.throws(() => developmentProofSlot(x.plan, 'learning', 'no-memory', x.plan.manifest.value.opportunities[0]!.id));
    assert.throws(() => developmentProofSlot(x.plan, 'feedback', 'candidate', 'unknown'));
    assert.equal(inspectDevelopmentLearning(x.context, input, 'assignment:0', 'unknown').status, 'unavailable');
  } finally { x.f.close(); }
});
test('review: actual transfer retains strict experience ordering and does not use late receipt time as learning time', async () => {
  const { x, input, subjectId, b } = await initial(); try {
    const learning = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, receipt(x, b), b.hostNow));
    const ids = x.plan.manifest.value.opportunities.find(o => o.id === subjectId)!.interferenceIds, experiences: DevelopmentExperienceProof[] = [], related = [input];
    for (let i = 0; i < 3; i++) { x.f.advance(1); const source = await x.deliver(`interference:${i}`, true); related.push(source); experiences.push(unwrap(deriveDevelopmentExperience(x.context, source, `interference:${i}`, ids[i]!))); }
    x.f.advance(1000); const task = await x.deliver('opportunity:0'), feedback = await x.deliver('feedback:0'); related.push(feedback); task.current = feedback.after; related.forEach(s => { s.current = feedback.after; });
    const assignmentIds = ['learning:0', 'interference:0', 'interference:1', 'interference:2', 'feedback:0'];
    const selector: OpportunitySelector = { roleId: 'candidate', assignmentId: 'opportunity:0', opportunityId: subjectId, before: task.before, after: task.after, related: related.map((s, i) => ({ roleId: 'candidate', assignmentId: assignmentIds[i]!, before: s.before, after: s.after })) };
    x.retainExtraction(task, selector.assignmentId); related.forEach((s, i) => x.retainExtraction(s, assignmentIds[i]!));
    const ci = unwrap(inspectDevelopmentOpportunity(x.context, task, selector, related)), end = x.f.captures.get(feedback.after.sha256)!.manifest.clock.wallMs;
    const binding: SourceCheckBinding = { roleId: ci.roleId, subjectId, assignmentIds: ci.assignmentIds, sourceDigest: ci.sourceDigest, output: ci.output, feedback: ci.feedback, acquisition: 'completed', completeAt: end, hostNow: end + 1, judgmentSlots: [] };
    const transfer = unwrap(deriveDevelopmentOpportunity(x.context, task, selector, related, receipt(x, binding), binding.hostNow));
    assert.equal(validateDevelopmentTransferIntervals(learning, experiences, transfer, ids, 1000).status, 'derived');
    for (const boundary of ['learning-equality', 'transfer-equality', 'duplicate-episode'] as const) {
      const altered = structuredClone(experiences);
      if (boundary === 'learning-equality') altered[0]!.interval.lowerWallMs = learning.interval.upperWallMs;
      if (boundary === 'transfer-equality') altered[2]!.interval.upperWallMs = transfer.interval.lowerWallMs;
      if (boundary === 'duplicate-episode') altered[1]!.episodeId = altered[0]!.episodeId;
      assert.notEqual(validateDevelopmentTransferIntervals(learning, altered, transfer, ids, 1000).status, 'derived');
    }
    const delayedLearning = unwrap(deriveDevelopmentLearning(x.context, input, 'learning:0', subjectId, receipt(x, { ...b, hostNow: end }), end));
    assert.deepEqual(delayedLearning.interval, learning.interval);
    for (const axes of [{ behavior: 'fail' }, { disclosure: 'unavailable' }, { matching: 'invalid' }] as const) {
      const rejected = { ...learning, ...axes };
      assert.equal(validateDevelopmentTransferIntervals(rejected, experiences, transfer, ids, 1000).status, 'unavailable');
      assert.equal(developmentSourceObservationData(rejected).status, 'unavailable');
    }
  } finally { x.f.close(); }
});
test('review: public workload and source configuration reject independently repinned contradictions', () => {
  for (const bad of ['configuration', 'schedule', 'mapping'] as const) {
    const x = admissionFixture(true); try {
      assert.equal(validateDevelopmentWorkload(x.context).opportunities.length, 12);
      if (bad === 'configuration') x.plan.roles[0]!.configuration = x.put({ developmentControl: { workloadDigest: identity('different workload') } });
      else { const w = structuredClone(x.workload); if (bad === 'schedule') w.scheduleDigest = identity('other schedule'); else w.opportunities[0]!.roles[0]!.interferenceAssignmentIds[0] = 'interference:8'; x.policy.workload = x.put(w); }
      x.accept(); assert.throws(() => validateSourceAdmissionPolicy(x.context));
    } finally { x.f.close(); }
  }
});
