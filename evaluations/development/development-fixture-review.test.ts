// Frozen fixture setup copied from 4c4fcda; new independent predicates below.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test, { mock, type TestContext } from 'node:test';
import { canonicalJson, identity, type JsonValue, type ShellBridge, type ShellInput, type ArtifactRef } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/resources/index.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { createAgentShell, type ShellOptions } from '../../packages/agent-shell/index.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';
import { acquisitionMetadataUsage, acquisitionPlanDomain, AcquisitionInfeasible, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { developmentReviewInput, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentEnvelopeTrust, type DevelopmentRegistration, type DevelopmentRoleBinding, type DevelopmentModelJudgment } from './review-envelope.ts';
import type { DevelopmentModelReviewOptions, DevelopmentReviewerSession } from './model-review.ts';
import type { AutarkApplication } from '../../deployment/application.ts';

// Only process confinement and provider replies are mocked. Pi, host broker, ledger,
// acquisition recorder, retention, decoders and final verifier are production code.
assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Run with module mocks; this audit never launches a worker');
let intercept: ((o: WorkerOptions) => void) | undefined;
let forge = false;
mock.module('../../packages/supervisor/worker-process.ts', { namedExports: { async runWorker(o: WorkerOptions) {
  intercept?.(o);
  const v = o.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const rpc = (method: string, ...args: unknown[]) => o.handle(method, args as JsonValue[], new AbortController().signal);
  const shell = createAgentShell({ ...v.options, apiKey: () => 'offline', resolveFragment: async f => v.fragments[f.artifact.sha256], fetch: async (_url, init) => {
    const r = await rpc('provider.fetch', init!.body) as { body: string; status: number }; return new Response(r.body, { status: r.status });
  } });
  const bridge: ShellBridge = {
    execute: async c => await rpc('execute', c) as unknown as Awaited<ReturnType<ShellBridge['execute']>>,
    capturePrompt: async (...a) => { await rpc('capturePrompt', ...a); },
    reserve: async q => { await rpc('reserve', forge ? { ...q, purpose: 'review' } : q); },
    dispatched: async q => { await rpc('dispatched', q); }, settle: async q => { await rpc('settle', q); },
    readCheckpoint: async c => rpc('readCheckpoint', c),
    persistCheckpoint: async (...a) => await rpc('persistCheckpoint', ...a) as unknown as Awaited<ReturnType<ShellBridge['persistCheckpoint']>>,
  };
  return await shell.run(v.input, bridge) as unknown as JsonValue;
} } });
const { runDevelopmentModelReviews, developmentReviewerSessionDigest } = await import('./model-review.ts');

function setup(t: TestContext, compact = false, beforeClaim?: (options: AcquisitionRecorderOptions) => void, snapshotComposition = false) {
  const seed = syntheticWitnessFixture();
  // Short synthetic identities keep the complete full-B compaction trace inside its signed v1 envelope.
  const compactVocabulary = snapshotComposition && compact;
  const rootId = compactVocabulary ? 'r' : 'audit-original';
  if (compactVocabulary) {
    const opportunityIds = new Map(seed.m.opportunities.map((o, i) => [o.id, `o${i}`]));
    for (const o of seed.m.opportunities) o.id = opportunityIds.get(o.id)!;
    for (const c of seed.m.controls) c.opportunityIds = c.opportunityIds.map(id => opportunityIds.get(id)!);
  }
  const dir = mkdtempSync(join(tmpdir(), 'independent-review-'));
  const directory = (path: string) => { mkdirSync(path, { recursive: true, mode: 0o700 }); return path; };
  const stores: OperationalStore[] = [];
  const open = (filename: string) => { directory(dirname(filename)); const s = new OperationalStore({ filename }); chmodSync(filename, 0o600); stores.push(s); return s; };
  const host = directory(join(dir, 'host')), originalStore = open(join(host, 'original.sqlite')), claims = open(join(host, 'claims.sqlite')), recorderState = open(join(host, 'recorder.sqlite'));
  const raw = new QualificationStore(directory(join(dir, 'raw')), 32_000_000);
  const put = (v: unknown) => raw.putBytes(Buffer.from(canonicalJson(v)));
  let now = Date.parse(seed.m.grant.issuedAt);
  seed.m.grant.resources = { ...seed.m.grant.resources, maxRequests: 32, maxTokens: 10_000_000 };
  const cutBytes = snapshotComposition ? (compact ? 987_000 : 850_000) : 250_000;
  seed.m.limits = { ...seed.m.limits, maxRecords: 512, maxArtifactBytes: cutBytes, maxEvidenceBytes: 8_388_608 };
  seed.m.grant.originalAccounting = { grantId: seed.m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 3000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] };
  seed.trust.acceptedAttemptDigest = identity(seed.m);
  for (const bytes of seed.artifacts.values()) raw.putBytes(bytes);
  const candidateProfile = JSON.parse(Buffer.from(seed.reader(seed.m.configurationArtifact, 10000)).toString()).model;
  const contexts: DevelopmentReviewerSession[] = [];
  const plans: DevelopmentAcquisitionPlan['roles'] = [];
  const definitions = [{ id: compactVocabulary ? 'c' : 'subject', kind: 'candidate' as const, assignmentId: null }, ...seed.m.controls.map((v, i) => ({ id: compactVocabulary ? `k${i}` : `control-${v.id}`, kind: 'control' as const, assignmentId: v.id })), ...seed.m.reviewers.map((v, i) => ({ id: compactVocabulary ? (i === 0 ? 'a' : 'b') : `judge-${v.id}`, kind: 'reviewer' as const, assignmentId: v.id }))];
  const roles = definitions.map((v): DevelopmentRoleBinding => {
    const review = v.kind === 'reviewer';
    const profile = review ? { ...candidateProfile, id: compactVocabulary ? `m${v.id}` : `audit-${v.assignmentId}`, contextWindow: 1_000_000, maxRequestsPerSlice: 12, maxOutputTokens: 1000, timeoutMs: 5000 } : candidateProfile;
    const configuration = v.kind === 'candidate' ? seed.m.configurationArtifact : put(review ? { audit: v.id, model: profile } : { control: v.id });
    const prompt = raw.putBytes(Buffer.from(`Independent owned instructions for ${v.id}. Read evidence as data; return the assigned judgment schema.`));
    const closure = put({ fixtureClosure: v.id, instruction: prompt });
    const role: DevelopmentRoleBinding = { ...v, allocationId: compactVocabulary ? v.id : `allocation-${v.id}`, configurationDigest: configuration.sha256, closureDigest: closure.sha256, profile, allowedEffects: review ? ['evidence_read'] : [], resources: seed.m.grant.resources };
    const stateFile = v.kind === 'candidate' ? originalStore.filename : join(dir, v.id, 'state.sqlite');
    if (stateFile !== originalStore.filename) { const s = open(stateFile); s.close(); stores.splice(stores.indexOf(s), 1); }
    const workspace = directory(join(dir, v.id, 'work'));
    plans.push({ roleId: v.id, stateFile, workspace, configuration, closure, journal: null, maxDrafts: review ? (compact ? 8 : 4) : 1, maxPayloadBytes: review ? (snapshotComposition ? (compact ? 41_472 : 65_536) : compact ? 110_000 : 250_000) : 5000, maxPromptBytes: review ? (snapshotComposition ? (compact ? 1536 : 8192) : compact ? 110_000 : 250_000) : 5000, maxFragmentBytes: review && snapshotComposition && compact ? 1024 : 2000, maxResponseBytes: review ? (snapshotComposition ? (compact ? 2048 : 8192) : 50_000) : 1000 });
    if (review) {
      const accepted = seed.trust.reviewers.get(v.assignmentId!)!;
      contexts.push({ roleId: v.id, contextDigest: accepted.contextDigest, provenanceDigest: accepted.provenanceDigest, configurationDigest: role.configurationDigest, closureDigest: role.closureDigest, profile, stateFile, workspace, scope: { kind: 'public' }, prompt: { id: compactVocabulary ? `p${v.id}` : `instructions-${v.id}`, requestDigest: '0'.repeat(64), fragments: [{ id: compactVocabulary ? `f${v.id}` : `base-${v.id}`, owner: 'application', role: 'system', order: 0, artifact: { uri: `aeon:artifact:${prompt.sha256}`, sha256: prompt.sha256 }, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] }, plan: { maxModelRequests: 8, maxToolReads: 4, maxReadBytes: snapshotComposition && compact ? 2048 : 5000, maxTotalReadBytes: 20000, maxPayloadBytes: snapshotComposition ? (compact ? 41_472 : 65_536) : 250000, maxResponseBytes: snapshotComposition ? (compact ? 2048 : 8192) : 50000, maxCheckpointBytes: 250000, maxTotalCheckpointBytes: 2000000, maxElapsedMs: 60000 } });
    }
    return role;
  });
  const original = new ResourceLedger(originalStore, { tokens: 500000, costUsd: 1, elapsedMs: 5000 }, () => now);
  original.allocate(rootId, seed.m.grant.resources); now = Date.parse(seed.m.registeredAt);
  for (const role of roles) original.allocate(role.allocationId, role.resources, rootId);
  const assignment = put({ version: 1, assignments: [] });
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(seed.m), rootId, rootCancelled: false, registeredAt: seed.m.registeredAt, reviewDeadlineAt: seed.at(250), observerClosureDigest: seed.trust.observer.artifactDigest, closureVerifierDigest: identity('independent synthetic closure verifier'), assignmentDigest: assignment.sha256, roles, originalRequests: [] };
  const trust: DevelopmentEnvelopeTrust = { behavior: seed.trust, acceptedRegistrationDigest: identity(registration), acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'audit-closure', key: Buffer.alloc(32, 4), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['audit-transport', Buffer.alloc(32, 5)]]) };
  const signedRegistration = signDocument(d.registration, registration, 'issuer', seed.keys.get('issuer')!);
  const plan: DevelopmentAcquisitionPlan = { version: 1, id: 'independent-review-audit', manifest: seed.manifest(), registration: signedRegistration, assignmentPacket: assignment, originalStateFile: originalStore.filename, closures: { node: identity('node fixture'), dependencies: seed.m.candidate.dependencies, prompts: seed.m.candidate.prompts, tools: identity('tools fixture'), acquisition: seed.m.acquisitionDigest }, rawStore: raw.identity(), roles: plans, capacity: { captureBytes: snapshotComposition ? (compact ? 6_937_000 : 6_100_000) : 2_200_000, maxSnapshots: snapshotComposition ? 7 : 8, maxSnapshotBytes: cutBytes, envelopeBytes: snapshotComposition && compact ? 315000 : 250000, transitionBytes: snapshotComposition ? (compact ? 2500 : 4096) : 10000, failureBytes: 4096, inventoryEntryBytes: compactVocabulary ? 256 : 512, maxArtifacts: snapshotComposition && compact ? 112 : 256, maxObservations: 40 } };
  const recorderOptions: AcquisitionRecorderOptions = { state: recorderState, original, raw, document: signDocument(acquisitionPlanDomain, plan, 'issuer', seed.keys.get('issuer')!), trust: { acceptedPlanDigest: identity(plan), issuers: seed.trust.issuers, envelope: trust }, syntheticClock: () => ({ wallMs: now, monotonicMs: now - Date.parse(seed.m.grant.issuedAt), bootId: 'audit-synthetic', processStart: 'audit-synthetic' }) };
  beforeClaim?.(recorderOptions);
  const recorder = DevelopmentAcquisitionRecorder.claim(recorderOptions);
  const sources = new Map<string, { application: Pick<AutarkApplication, 'store' | 'config'>; accounting: DevelopmentAccounting }>();
  for (const role of roles.filter(r => r.kind !== 'reviewer')) {
    const rp = plans.find(p => p.roleId === role.id)!;
    const store = role.kind === 'candidate' ? originalStore : open(rp.stateFile);
    const bridge = new DevelopmentAccounting({ localStore: store, original, localRootId: registration.rootId, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant: seed.m.grant, behaviorWindow: { notBefore: seed.m.notBefore, deadlineAt: seed.m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: recorder.rawStoreForRole(role.id), transport: { id: 'audit-transport', key: trust.transports.get('audit-transport')! }, reserveEvidence: q => recorder.reserveEvidence(role.id, q), retainResponse: (id, bytes) => recorder.retainResponse(id, bytes), maxResponseBytes: rp.maxResponseBytes });
    bridge.resources.allocate(registration.rootId, role.resources);
    sources.set(role.id, { application: { store, config: JSON.parse(raw.readArtifact(rp.configuration, 10000).toString()) } as Pick<AutarkApplication, 'store' | 'config'>, accounting: bridge });
  }
  now = Date.parse(seed.at(0)); recorder.begin(); now = Date.parse(seed.at(180));
  const candidate = sources.get(compactVocabulary ? 'c' : 'subject')!.accounting, behavior = recorder.freezeBehavior(candidate, sources);
  const sessions = contexts as [DevelopmentReviewerSession, DevelopmentReviewerSession];
  const judgment = (roleId: string): DevelopmentModelJudgment => ({ opportunities: seed.m.opportunities.map(v => ({ id: v.id, outcome: 'fail', reason: compactVocabulary ? 'x' : `${roleId}: ${v.id} unmet` })), controls: seed.m.controls.map(v => ({ id: v.id, outcome: 'valid', reason: compactVocabulary ? 'x' : `${roleId}: ${v.id} control` })), boundaries: seed.m.boundaries.map(id => ({ id, outcome: 'valid', reason: compactVocabulary ? 'x' : `${roleId}: ${id} boundary` })), overall: roleId === sessions[0].roleId ? 'fail' : 'unavailable', reason: compactVocabulary ? 'x' : `${roleId}: independent final reason ☃\n` });
  const reply = (roleId: string, content = JSON.stringify(judgment(roleId))) => ({ status: 200, body: JSON.stringify({ model: sessions.find(s => s.roleId === roleId)!.profile.id, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 23, completion_tokens: 17 } }) });
  const payloads: { role: string; text: string }[] = [];
  let provider: (role: string, payload: string) => { status: number; body: string } | Promise<{ status: number; body: string }> = role => reply(role);
  const hostDescriptor = { applicationRoot: dir, entrypoint: 'deployment/shell-worker.ts', nodeBinary: process.execPath };
  const options: DevelopmentModelReviewOptions = { registration: signedRegistration, behavior, trust, original, claims, recorder, sessions, acceptedSessions: new Map(sessions.map(s => [s.roleId, developmentReviewerSessionDigest(s)])), artifactAudiences: new Map(behavior.value.artifactIndex.map(i => [i.artifact.sha256, { kind: 'public' as const }])), host: hostDescriptor, acceptedHostDigest: identity(hostDescriptor), readInstruction: (a, n) => raw.readArtifact({ uri: `sha256:${a.sha256}`, sha256: a.sha256 }, n), performRequest: async (role, text) => { payloads.push({ role, text }); return provider(role, text); } };
  intercept = undefined; forge = false;
  t.after(() => { intercept = undefined; forge = false; stores.reverse().forEach(s => s.close()); raw.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, options, originalStore, raw, recorder, behavior, seed, candidate, sessions, judgment, reply, payloads, open, directory,
    setProvider(fn: typeof provider) { provider = fn; }, setTime(at: number) { now = at; }, accept() { options.acceptedSessions = new Map(sessions.map(s => [s.roleId, developmentReviewerSessionDigest(s)])); }, run: (signal?: AbortSignal) => runDevelopmentModelReviews(options, signal), read: (a: ArtifactRef) => recorder.readArtifact(a, 250000) };
}

function toolResponse(g: ReturnType<typeof setup>, role: string, artifact: ArtifactRef, id = 'read-one') {
  const response = g.reply(role), body = JSON.parse(response.body);
  body.choices[0] = { finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'evidence_read', arguments: JSON.stringify({ artifact }) } }] } };
  return { ...response, body: JSON.stringify(body) };
}

test('compact aliases carry complete exact input through distinct real reviewers and full retained composition', async t => {
  const g = setup(t, true, undefined, true), original = syntheticWitnessFixture();
  const m = g.recorder.plan.manifest.value, registration = g.recorder.plan.registration.value;
  assert.equal(canonicalJson(m.opportunities), canonicalJson(original.m.opportunities.map((o, i) => ({ ...o, id: `o${i}` }))));
  assert.equal(canonicalJson(m.controls), canonicalJson(original.m.controls.map(c => ({ ...c, opportunityIds: c.opportunityIds.map(id => `o${original.m.opportunities.findIndex(o => o.id === id)}`) }))));
  assert.equal(canonicalJson(m.reviewers), canonicalJson(original.m.reviewers));
  assert.deepEqual(registration.roles.map(r => [r.id, r.allocationId, r.assignmentId]), [
    ['c', 'c', null], ...original.m.controls.map((c, i) => [`k${i}`, `k${i}`, c.id]),
    ['a', 'a', 'reviewer-a'], ['b', 'b', 'reviewer-b'],
  ]);
  for (const key of ['contextDigest', 'provenanceDigest', 'principalId', 'independenceGroup'] as const) {
    const values = m.reviewers.map(r => g.options.trust.behavior.reviewers.get(r.id)![key]);
    assert.equal(new Set(values).size, 2, key);
    assert.deepEqual(values, original.m.reviewers.map(r => original.trust.reviewers.get(r.id)![key]));
  }
  assert.equal(g.recorder.capacity.totalBytes, 8_375_048);
  assert.equal(g.recorder.capacity.records, 286);
  assert.equal(g.recorder.capacity.maxRequests, 22);
  assert.equal(m.limits.maxEvidenceBytes, 8_388_608);
  assert.equal(canonicalJson(m.grant.resources), canonicalJson({ ...original.m.grant.resources, maxRequests: 32, maxTokens: 10_000_000 }));

  const initial: ShellInput[] = [];
  intercept = o => { initial.push((o.initial as unknown as { input: ShellInput }).input); };
  const counts = new Map<string, number>(), artifact = g.behavior.value.artifactIndex.find(v => v.bytes < 1000)!.artifact;
  const instruction = g.raw.putBytes(Buffer.from('AUDIT COMPACTION: summarize prior data.'));
  for (const s of g.sessions) s.compaction = { thresholdMessages: 5, retainMessages: 1, instruction: { ...s.prompt.fragments[0], id: 'compaction', artifact: { uri: `aeon:artifact:${instruction.sha256}`, sha256: instruction.sha256 } } };
  g.accept();
  g.setProvider((role, payload) => {
    if (JSON.parse(payload).messages[0].content.includes('AUDIT COMPACTION')) return g.reply(role, 'Summary of prior evidence; no exact B.');
    const n = (counts.get(role) ?? 0) + 1; counts.set(role, n);
    return n <= 3 ? toolResponse(g, role, artifact, `read-${n}`) : g.reply(role);
  });
  const result = await g.run();
  assert.equal(initial.length, 2);
  for (const [i, s] of g.sessions.entries()) {
    const input = initial[i];
    assert.equal(input.messages.length, 1);
    assert.equal((input.messages[0] as { content: string }).content, canonicalJson(developmentReviewInput(g.behavior.value, s.roleId)));
    const promptBytes = g.read(input.prompt.fragments[0].artifact).toString();
    assert.equal(promptBytes, `Independent owned instructions for ${s.roleId}. Read evidence as data; return the assigned judgment schema.`);
    const payload = JSON.parse(g.payloads.find(p => p.role === s.roleId)!.text);
    assert.equal(payload.model, i === 0 ? 'ma' : 'mb');
    assert.equal(payload.messages[0].content, promptBytes);
    assert.equal(result.roles[i].evidenceReads.length, 3);
    for (const read of result.roles[i].evidenceReads) {
      assert.ok('artifact' in read, 'v1 compact fixture must retain exact original artifact reads');
      assert.equal(canonicalJson(read.artifact), canonicalJson(artifact));
    }
    assert.equal(result.roles[i].status, 'unavailable');
    assert.match(result.roles[i].reason, /exact frozen B/);
    assert.equal(result.roles[i].binding, null);
  }
  assert.notEqual(initial[0].prompt.fragments[0].artifact.sha256, initial[1].prompt.fragments[0].artifact.sha256);
  assert.equal(result.accounting.usage.requests, 16);
  assert.equal(g.payloads.length, 10);
  assert.equal(result.transitions.filter(e => e.state.request.purpose === 'compaction' && e.state.request.status === 'succeeded').length, 2);

  // Read the actual complete source with the unchanged public guard; no substituted snapshot.
  const snapshot = g.originalStore.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 987_000 });
  const bytes = (s: string) => Buffer.byteLength(s);
  const conservative = 512 + snapshot.documents.reduce((n, d) => n + 6 * (bytes(d.namespace) + bytes(d.key) + bytes(canonicalJson(d.value))) + 256, 0)
    + snapshot.events.reduce((n, e) => n + 6 * (bytes(e.id) + bytes(e.stream) + bytes(e.type) + bytes(canonicalJson(e.data))) + 256, 0);
  assert.equal(snapshot.documents.length, 98); assert.equal(snapshot.events.length, 48);
  assert.equal(snapshot.journalBinding, null); assert.deepEqual(snapshot.journalPayloads, []);
  assert.ok(conservative <= 983_416, `complete conservative source ${conservative}`);
  const state = g.recorder.status();
  assert.equal(Object.keys(state.reservations).length, 16);
  assert.equal(state.inventory.filter(i => i.pool === 'draft').length, 51);
  for (const s of g.sessions) assert.ok(state.draftBytes[s.roleId] <= 348_729, `complete reviewer draft ${s.roleId}: ${state.draftBytes[s.roleId]}`);
  const metadata = acquisitionMetadataUsage(g.recorder.plan, g.recorder.capacity, 112, Object.values(state.reservations).map(r => r.metadata));
  assert.ok(metadata.totalBytes <= 594_846, `complete protected copies ${metadata.totalBytes}`);
  assert.ok(metadata.totalBytes < g.recorder.capacity.metadataBytes);
  t.diagnostic(JSON.stringify({ sourceBytes: conservative, rows: 146, drafts: state.draftBytes, metadataAtAll112Slots: metadata, draftEntries: 51 }));
  await g.run(); assert.equal(g.payloads.length, 10);
});

for (const field of ['contextDigest', 'provenanceDigest', 'stateFile', 'workspace'] as const) {
  test(`short role aliases cannot reaccept the other independent reviewer's ${field}`, async t => {
    const g = setup(t, true, undefined, true);
    g.sessions[0][field] = g.sessions[1][field];
    g.accept();
    let initialized = 0; intercept = () => { initialized++; };
    await assert.rejects(g.run(), /reviewer context|Reviewer context|Reviewer state\/workspace/i);
    assert.equal(initialized, 0);
    assert.equal(g.payloads.length, 0);
    assert.equal(g.options.original.snapshot('r').requests, 0);
    assert.equal(Object.keys(g.recorder.status().reservations).length, 0);
  });
}

