import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonicalJson, identity, type ArtifactRef, type Authority, type EvaluationEvidence } from '../packages/contracts/index.ts';
import { admitCandidate, admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor, type ReleaseProof } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { EvaluationDispatcher, reviewerDescriptor, runAccountedExternalReview, runExternalReview, type ReviewerFile } from './evaluation-dispatch.ts';
import { EvolutionMailbox } from './evolution-mailbox.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import type { SubmissionRequest } from './evolution-tools.ts';
import { contentAddressedEvidence } from './host-policy.ts';
import { rewriteSourceEntries } from './source-workspace.ts';
import { ServiceSupervisor } from './supervisor.ts';
import { reviewPhysicalId } from './evaluation-resources.ts';
import { loadOfflinePlan, offlinePlanMount, offlineRunnerDigest, type OfflineObservation, type OfflinePlan } from '../evaluations/offline-review/index.ts';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const markerPath = 'packages/narrow-schema/vendor/cfworker/ucs2-length.ts';
const marker = '\nexport const externalDispatchEngineeringFixture = true;\n';

test('failed probation activation releases processor ownership without releasing unknown physical usage', async () => {
  for (const state of ['reserved', 'dispatched', 'uncertain'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'aeon-probation-cleanup-'));
    const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspaces'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
    for (const path of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) mkdirSync(path, { mode: 0o700 });
    const store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
    const authority = { generation: 'original-author', epoch: 1, controlRevision: 'a'.repeat(64) };
    const envelope = { maxRequests: 5, maxTokens: 100, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 1 };
    const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 1000 }); ledger.allocate('author', envelope);
    store.put('runs', 'author', { id: 'author', status: 'waiting', revision: 1, authority, scope: { kind: 'public' } }, null);
    const reviewer: ReviewerFile = { evaluatorId: 'fixture-reviewer', files: [{ path: join(root, 'unused-fixture-closure'), mount: '/reviewer/main', sha256: 'f'.repeat(64) }],
      executable: '/reviewer/main', args: [], keyFile: join(root, 'unused-key'), pollMs: 10, maxElapsedMs: 1000, maxOutputBytes: 1024, maxClosureBytes: 1024, memoryBytes: 1024 * 1024 };
    const fields = { kind: 'engineering' as const, controlRevision: authority.controlRevision, requiredCases: ['fixture'], evaluatorKeys: new Map([[reviewer.evaluatorId, Uint8Array.of(1)]]), evaluatorArtifacts: new Map([[reviewer.evaluatorId, hashBytes(Buffer.from(reviewerDescriptor(reviewer)))]]) };
    const policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    const { cancelled: _, ...allocation } = store.get<any>('allocations', 'author')!.value;
    // Reservation-only fixture. No candidate is admitted and no external executable is run.
    const review = { id: `probation:${state}`, activationId: 'activation', proposal: { id: 'change', runId: 'author', authority, scope: { kind: 'public' } },
      candidate: { manifest: { id: 'c'.repeat(64) } }, policyDigest: policy.policyDigest, judgeAuthority: authority, rescueCandidateId: 'b'.repeat(64),
      admissionEvidenceIds: ['admission'], allocationLineage: [{ id: 'author', ...allocation }], reservedAt: Date.now() } as import('./control-continuation.ts').ProbationReviewRequest;
    const mailbox = new EvolutionMailbox({ store, assertAuthority: () => {} });
    const dispatcher = new EvaluationDispatcher({ mailbox, host, reviewer, getPolicy: () => policy, policyDigests: [policy.policyDigest],
      assertAuthority: () => {}, dispatchAuthority: (_authority, operation) => operation(), acceptedCandidateId: () => review.rescueCandidateId,
      release: async () => authority, stageControl: async () => 'stage' });
    try {
      assert.throws(() => dispatcher.reserveProbation(review, () => {
        store.put('fixture.control-claim', review.id, { claimed: true }, null);
        throw Error('Producer won the start race');
      }), /Producer won/);
      assert.equal(store.get('fixture.control-claim', review.id), undefined);
      assert.equal(store.get('host.probation-review-contexts', review.id), undefined);
      assert.equal(ledger.request(reviewPhysicalId(review.id)), undefined);
      assert.equal(ledger.snapshot('author').requests, 0, 'Deferred activation consumes no physical reservation');
      assert.equal(dispatcher.probationAvailable(), true);
      dispatcher.reserveProbation(review, () => store.put('fixture.control-claim', review.id, { claimed: true }, null));
      assert.equal(dispatcher.probationAvailable(), false);
      assert.deepEqual(store.get('host.probation-review-contexts', review.id)!.value, review);
      assert.throws(() => dispatcher.finishProbation({ ...review, policyDigest: 'd'.repeat(64) }), /context changed/);
      const physical = ledger.request(reviewPhysicalId(review.id))!;
      if (state !== 'reserved') ledger.dispatched({ ...physical, status: 'dispatched' });
      if (state === 'uncertain') ledger.settle({ ...physical, status: 'uncertain' });
      dispatcher.finishProbation(review); dispatcher.finishProbation(review);
      assert.equal(dispatcher.probationAvailable(), true);
      assert.equal(ledger.request(physical.id)!.status, state === 'reserved' ? 'failed' : state);
      assert.equal(ledger.snapshot('author').concurrent, state === 'reserved' ? 0 : 1);
      assert.equal(ledger.snapshot('author').requests, 1);
      assert.throws(() => dispatcher.reserveProbation(review), /already used/);
      assert.equal(dispatcher.probationAvailable(), true);
    } finally { await dispatcher.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('dispatcher failure diagnostics exclude private host exception text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-review-diagnostics-'));
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspaces'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  for (const path of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) mkdirSync(path, { mode: 0o700 });
  const store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
  const mailbox = new EvolutionMailbox({ store, assertAuthority: () => {} });
  const authority = { generation: 'author', epoch: 1, controlRevision: 'controls' };
  const privateMarker = 'SECRETX';
  const proof = store.putJsonArtifact({ proposal: {}, signed: [] });
  store.put('host.evolution-jobs', 'evaluated', { id: 'evaluated', kind: 'evaluation', status: 'completed', proof }, null);
  const request = store.putJsonArtifact({ requestId: 'submission', policyDigest: 'policy', proposal: { authority }, evaluation: { requestId: 'evaluated' } });
  store.put('host.evolution-jobs', 'submission', { id: 'submission', kind: 'submission', status: 'pending', request, authority }, null);
  const dispatcher = new EvaluationDispatcher({ mailbox, host, getPolicy() { JSON.parse(privateMarker); throw Error('unreachable'); },
    policyDigests: [], assertAuthority: () => {}, dispatchAuthority: (_authority, operation) => operation(), acceptedCandidateId: () => 'accepted', release: async () => authority, stageControl: async () => 'stage' });
  try {
    await dispatcher.processPending();
    assert.equal(mailbox.status('submission')!.status, 'uncertain');
    const status = dispatcher.status(), persisted = store.get('host.evaluation-dispatch', 'current')!.value;
    assert.ok(status.diagnosis);
    assert.equal(JSON.stringify(status).includes(privateMarker), false, 'Public status must not echo private exception text');
    assert.equal(JSON.stringify(persisted).includes(privateMarker), false, 'Shared operational state must not contain private exception text');
  } finally { await dispatcher.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('interrupted snapshot cleanup never follows redirected roots or nested links', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-review-cleanup-'));
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspaces'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  for (const path of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) mkdirSync(path, { mode: 0o700 });
  const store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
  const mailbox = new EvolutionMailbox({ store, assertAuthority: () => {} });
  const options = { mailbox, host, getPolicy: () => { throw Error('No policy needed'); }, policyDigests: [], assertAuthority: () => {}, dispatchAuthority: (_authority: Authority, operation: () => void) => operation(), acceptedCandidateId: () => 'accepted',
    release: async () => { throw Error('No release expected'); }, stageControl: async () => 'stage' };
  const outside = join(root, 'private-reviewer'), snapshots = join(host.stateDirectory, 'host-review-dispatch');
  mkdirSync(outside, { mode: 0o700 }); writeFileSync(join(outside, 'keep'), 'retained private data', { mode: 0o600 });
  try {
    symlinkSync(outside, snapshots);
    assert.throws(() => new EvaluationDispatcher(options));
    assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'retained private data');
    unlinkSync(snapshots); mkdirSync(snapshots, { mode: 0o700 });
    symlinkSync(outside, join(snapshots, 'physical-ABC123'));
    assert.throws(() => new EvaluationDispatcher(options), /Unexpected or unbounded/);
    assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'retained private data');
    unlinkSync(join(snapshots, 'physical-ABC123'));
    const interrupted = mkdtempSync(join(snapshots, 'physical-'));
    symlinkSync(outside, join(interrupted, 'nested'));
    const dispatcher = new EvaluationDispatcher(options);
    try { assert.deepEqual(readdirSync(snapshots), []); assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'retained private data'); }
    finally { await dispatcher.close(); }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
const reviewerSource = String.raw`
import { readFileSync, existsSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { heldOutMarker } from './rules.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(sort(value));
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
let input = ''; for await (const chunk of process.stdin) input += chunk;
const x = JSON.parse(input), r = x.request;
// These modes simulate a physical effect whose reply was lost or never completed.
if (r.requestId === 'lost-review') process.exit(2);
if (r.requestId === 'interrupted-review') { await new Promise(resolve => setTimeout(resolve, 60000)); process.exit(2); }
if (Object.keys(process.env).some(key => /KEY|TOKEN/.test(key)) || existsSync('/app') || existsSync('/usr/bin') || existsSync('/candidate/key')) throw Error('Unexpected authority visible to reviewer');
const bytes = readFileSync(x.candidateRoot + '/payload/packages/narrow-schema/vendor/cfworker/ucs2-length.ts');
if (!bytes.toString().includes(heldOutMarker)) throw Error('Exact held-out source observation failed');
const observation = Buffer.from(canonical({ kind: 'engineering fixture only; H1 unaccepted', requestId: r.requestId, candidateId: r.candidate.manifest.id, actualSourceDigest: hash(bytes), inheritedKeys: false }));
const artifact = { uri: 'sha256:' + hash(observation), sha256: hash(observation) };
const evidence = { id: 'external:' + r.requestId, candidateId: r.candidate.manifest.id, controlRevision: r.proposal.authority.controlRevision, evaluatorId: 'physical-engineering-reviewer', evaluatorArtifact: x.evaluatorArtifact, independent: true, verdict: 'pass', artifact,
 caseResults: [{ id: 'held-out-exact-source', status: 'pass', observations: artifact, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: ['Deterministic physical fixture; no independently qualified live reviewer or H1 claim.'] }] };
if (['deliberate-negative-review', 'forged-negative-review'].includes(r.requestId)) { evidence.verdict = 'fail'; evidence.caseResults[0].status = 'fail'; }
if (r.requestId === 'deliberate-inconclusive-review') { evidence.verdict = 'inconclusive'; evidence.caseResults[0].status = 'unavailable'; }
let authentication = createHmac('sha256', readFileSync('/reviewer-key')).update(canonical({ evidence, policyDigest: r.policyDigest })).digest('hex');
if (r.requestId === 'forged-negative-review') authentication = '0'.repeat(64);
process.stdout.write(JSON.stringify({ result: { receipt: { requestId: r.requestId, candidateId: r.candidate.manifest.id, policyDigest: r.policyDigest, evidence: [evidence], receipt: { engineeringFixture: true } },
 proof: { proposal: { id: r.requestId, candidate: r.candidate.manifest, priorAuthority: r.proposal.authority, evidence: [evidence], recoveryArtifact: x.recoveryArtifact }, signed: [{ evidence, authentication }] } }, artifacts: [{ sha256: artifact.sha256, base64: observation.toString('base64') }] }));
`;
async function eventually<T>(read: () => T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30000;
  while (true) { const value = read(); if (accept(value)) return value; if (Date.now() > deadline) throw Error('Fixture deadline: ' + JSON.stringify(value)); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function fixture(activate = false, governance = false, offline = false) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-external-dispatch-'));
  const source = join(root, 'source'); mkdirSync(source);
  for (const entry of rewriteSourceEntries) if (existsSync(join(repository, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true }); cpSync(join(repository, entry), join(source, entry), { recursive: true }); }
  cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspaces'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  const evidenceDirectory = join(root, 'evidence'), reviewerRoot = join(root, 'external-reviewer');
  for (const path of [host.stateDirectory, host.workspaceDirectory, host.artifactStore, evidenceDirectory, reviewerRoot]) mkdirSync(path, { mode: 0o700 });
  const blob = (bytes: string | Uint8Array): ArtifactRef => { const sha256 = hashBytes(Buffer.from(bytes)); writeFileSync(join(evidenceDirectory, sha256), bytes, { mode: 0o600 }); return { uri: `sha256:${sha256}`, sha256 }; };
  const key = Buffer.alloc(32, 78), keyFile = join(reviewerRoot, 'key'); writeFileSync(keyFile, key, { mode: 0o600 });
  const files: ReviewerFile['files'] = [];
  const retain = (path: string, mount: string) => { const bytes = readFileSync(realpathSync(path)), retained = join(reviewerRoot, `file-${files.length}`); writeFileSync(retained, bytes, { mode: 0o600 }); files.push({ path: retained, mount, sha256: hashBytes(bytes) }); };
  retain(process.execPath, '/reviewer/node');
  const linked = spawnSync('/usr/bin/ldd', [process.execPath], { encoding: 'utf8' }); assert.equal(linked.status, 0, linked.stderr);
  for (const path of new Set(linked.stdout.match(/\/[^\s()]+/g))) retain(path, path);
  const script = join(reviewerRoot, 'reviewer.mjs'); writeFileSync(script, offline ? readFileSync(join(repository, 'evaluations/offline-review/reviewer.mjs')) : reviewerSource, { mode: 0o600 }); retain(script, '/reviewer/reviewer.mjs');
  const rules = join(reviewerRoot, 'rules.mjs'); writeFileSync(rules, "export const heldOutMarker = 'externalDispatchEngineeringFixture = true';\n", { mode: 0o600 }); retain(rules, '/reviewer/rules.mjs');
  if (offline) {
    const plan: OfflinePlan = { version: 1, kind: 'validator-string-length', runnerDigest: offlineRunnerDigest(), cases: [{ id: 'validator-string-length', timeoutMs: 3000, maxOutputBytes: 4096,
      inputs: [
        { schema: { type: 'string', minLength: 1 }, value: '' },
        { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: 'a' },
        { schema: { type: 'string', maxLength: 1 }, value: 'ab' },
        { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: '\ud83d\ude80' },
        { schema: { type: 'string', minLength: 2 }, value: '\ud83d\ude80' },
        { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: '\ud83d' },
        { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: '\ude80' },
        { schema: { type: 'string' }, value: 17 },
      ], expected: [false, true, false, true, false, true, true, false] }] };
    const path = join(reviewerRoot, 'private-plan.json'); writeFileSync(path, canonicalJson(plan), { mode: 0o600 }); retain(path, offlinePlanMount);
  }
  const reviewer: ReviewerFile = { evaluatorId: 'physical-engineering-reviewer', files, executable: '/reviewer/node', args: ['--jitless', '--max-old-space-size=64', '/reviewer/reviewer.mjs'], keyFile,
    pollMs: 10, maxElapsedMs: 15000, maxOutputBytes: 8 * 1024 * 1024, maxClosureBytes: 256 * 1024 * 1024, memoryBytes: 8 * 1024 * 1024 * 1024 };
  const reviewerFile = join(reviewerRoot, 'config.json'); writeFileSync(reviewerFile, JSON.stringify(reviewer), { mode: 0o600 });
  const futureRules = "export const heldOutMarker = 'externalDispatchEngineeringFixture = true';\nexport const governanceRevision = 'source-owned-future-reviewer-v2';\n";
  const futureReviewerSource = reviewerSource.replace("import { heldOutMarker }", "import { heldOutMarker, governanceRevision }")
    .replace("id: 'held-out-exact-source'", "id: 'governance-future-source'")
    .replace('inheritedKeys: false', 'inheritedKeys: false, reviewerGeneration: governanceRevision');
  const futureReviewer = { ...reviewer, files: reviewer.files.map(file => ({ ...file, sha256: file.mount === '/reviewer/reviewer.mjs' ? hashBytes(futureReviewerSource) : file.mount === '/reviewer/rules.mjs' ? hashBytes(futureRules) : file.sha256 })) };
  const futureReviewerDigest = hashBytes(reviewerDescriptor(futureReviewer));
  const evaluator = blob(reviewerDescriptor(reviewer));
  const fields = { kind: 'engineering' as const, requiredCases: [offline ? 'validator-string-length' : 'held-out-exact-source'], evaluatorKeys: new Map([[reviewer.evaluatorId, key]]), evaluatorArtifacts: new Map([[reviewer.evaluatorId, evaluator.sha256]]) };
  const modifiedBytes = readFileSync(join(source, markerPath), 'utf8') + marker;
  // Frozen fixture transport replaces the provider completely. It exercises the ordinary service child/tools.
  const calls = [['source_checkout', {}], ['workspace_write', { path: markerPath, content: modifiedBytes, expectedSha256: hashBytes(readFileSync(join(source, markerPath))) }],
    ...(governance ? [['governance_profile', {}],
      ['workspace_write', { path: 'deployment/fixture-reviewer.mjs', content: futureReviewerSource, expectedSha256: null }],
      ['workspace_write', { path: 'deployment/fixture-reviewer-rules.mjs', content: futureRules, expectedSha256: null }],
      ['workspace_write', { path: 'deployment/governance-proposal.json', content: '__from_public_governance_profile__', expectedSha256: null }]] : []),
    ['change_propose', { changeId: 'finite', justification: 'Test physical hosted review dispatch.', objective: 'Stage exact source through prior controls.', successCriteria: ['held-out exact source observed by physical external process'], experienceIds: [] }],
    ['candidate_freeze', { changeId: 'finite' }], ['candidate_evaluate', { changeId: 'finite' }], ['change_status', { changeId: 'finite' }], ['release_submit', { changeId: 'finite' }],
    ...(activate ? [['control_activate', { changeId: 'finite' }]] : [])];
  // Persisted model messages select the next step across service replacement; the fixture
  // stops after enqueue and resumes only after the actual bound host result event.
  const futureCalls = [['source_checkout', {}], ['governance_profile', {}], ['change_propose', { changeId: 'future', justification: 'Verify accepted source-owned evaluator through ordinary tools.', objective: 'Obtain a future-policy physical review.', successCriteria: ['new required case and reviewer bytes execute'], experienceIds: [] }], ['candidate_freeze', { changeId: 'future' }], ['candidate_evaluate', { changeId: 'future' }]];
  const governanceTransport = governance ? `import { createHash as fixtureCreateHash } from 'node:crypto';
const fixtureFutureSequence = ${JSON.stringify(futureCalls)};
function fixtureGovernance(profile) {
  const hash = bytes => fixtureCreateHash('sha256').update(bytes).digest('hex');
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  const canonical = value => JSON.stringify(sort(value));
  const reviewer = { ...profile.reviewer, files: profile.reviewer.files.map(file => file.mount === '/reviewer/reviewer.mjs' ? { mount: file.mount, sha256: ${JSON.stringify(hashBytes(futureReviewerSource))}, source: 'deployment/fixture-reviewer.mjs' } : file.mount === '/reviewer/rules.mjs' ? { mount: file.mount, sha256: ${JSON.stringify(hashBytes(futureRules))}, source: 'deployment/fixture-reviewer-rules.mjs' } : file) };
  const digest = hash(canonical({ version: 1, executable: reviewer.executable, args: reviewer.args, files: reviewer.files.map(({mount,sha256})=>({mount,sha256})).sort((a,b)=>a.mount.localeCompare(b.mount)) }));
  return canonical({ version: 1, policy: { ...profile.policy, requiredCases: ['governance-future-source'], evaluatorArtifacts: profile.policy.evaluatorArtifacts.map(([id, original]) => [id, id === reviewer.evaluatorId ? digest : original]) }, reviewer });
}
` : '';
  const transport = `${governanceTransport}const fixtureSequence = ${JSON.stringify(calls)};\nasync function fixtureTransport(payload) { const messages = JSON.parse(payload).messages; const sequence = ${governance ? "messages.some(message => message.role === 'user' && String(message.content).includes('fixture-future-evaluation')) ? fixtureFutureSequence : fixtureSequence" : 'fixtureSequence'}; const seen = new Set(messages.flatMap(message => message.tool_calls?.map(call => call.id) ?? [])); let step = sequence.find((step, index) => !seen.has('fx' + index)); if (step?.[0] === 'change_status' && !messages.some(message => message.role === 'user' && String(message.content).includes('external-evaluation-completed'))) step = undefined; let args = step?.[1]; ${governance ? "if (args?.content === '__from_public_governance_profile__') { const profile = JSON.parse(messages.findLast(message => message.role === 'tool' && message.name === 'governance_profile').content); args = { ...args, content: fixtureGovernance(profile) }; }" : ''} return { status: 200, body: JSON.stringify({ model: 'fixture-v1', choices: [{ finish_reason: step ? 'tool_calls' : 'stop', message: step ? { role: 'assistant', content: null, tool_calls: [{ id: 'fx' + sequence.indexOf(step), type: 'function', function: { name: step[0], arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Engineering fixture waiting or complete.' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) }; }\n`;
  const childPath = join(source, 'deployment/service-child.ts');
  writeFileSync(childPath, transport + readFileSync(childPath, 'utf8').replace('new AutarkApplication({ config,', 'new AutarkApplication({ performRequest: fixtureTransport, config,'));
  const resources = { maxRequests: 100, maxTokens: 10000000, maxCostUsd: 10, maxElapsedMs: 600000, maxConcurrency: activate ? 1 : 2 };
  const inputs: DeploymentInputs = { createdBy: 'engineering-fixture-author', policy: policyDescriptor(fields), runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, prompts: { mind: 'Finite captured transport fixture.', compaction: 'Retain state.' },
    configuration: { bootstrapInitiative: false, model: { id: 'fixture-v1', reasoning: false, effort: 'none', contextWindow: 128000, maxRequestsPerSlice: 12, maxOutputTokens: 256, timeoutMs: 30000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 60000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture-operator', scope: { kind: 'public' }, modificationEligible: true } } };
  const incumbent = freezeApplication(source, host.artifactStore, inputs);
  const policy = { ...fields, controlRevision: incumbent.manifest.controls, policyDigest: admissionPolicyIdentity({ ...fields, controlRevision: incumbent.manifest.controls }) };
  const initial: Authority = { generation: 'initial-dispatch-fixture', epoch: 1, controlRevision: incumbent.manifest.controls };
  const observation = blob('Bootstrap engineering fixture only; no H1 acceptance.');
  const evidence: EvaluationEvidence = { id: 'bootstrap-evidence', candidateId: incumbent.manifest.id, controlRevision: initial.controlRevision, evaluatorId: reviewer.evaluatorId, evaluatorArtifact: evaluator,
    independent: true, verdict: 'pass', artifact: observation, caseResults: [{ id: fields.requiredCases[0]!, status: 'pass', observations: observation, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: ['Fixture bootstrap'] }] };
  const bootstrapProof: ReleaseProof = { proposal: { id: 'engineering-bootstrap', candidate: incumbent.manifest, priorAuthority: initial, evidence: [evidence], recoveryArtifact: blob(readFileSync(join(host.artifactStore, incumbent.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, policy.policyDigest)] };
  writeFileSync(join(source, markerPath), modifiedBytes);
  const expectedCandidate = freezeApplication(source, host.artifactStore, inputs);
  const nextPolicy = { ...fields, controlRevision: expectedCandidate.manifest.controls, policyDigest: admissionPolicyIdentity({ ...fields, controlRevision: expectedCandidate.manifest.controls }) };
  // Only the incumbent policy is configured. Ordinary host-source changes must derive
  // the same judging rules durably without an operator registering the next revision.
  const policies = new Map<string, AdmissionPolicy>([[policy.policyDigest, policy]]);
  const options = { host, mode: 'engineering' as const, secrets: { mistralApiKey: 'no-paid-provider-access', directToken: 'fixture-token' }, readArtifact: contentAddressedEvidence(evidenceDirectory),
    getPolicy: (digest: string) => { const result = policies.get(digest); assert.ok(result, 'Unknown registered policy'); return result; }, bootstrap: { proof: bootstrapProof, policyDigest: policy.policyDigest },
    evaluationDispatcher: { reviewerFile, policyDigests: [...policies.keys()] } };
  return { root, host, incumbent, policy, nextPolicy, options, reviewer, reviewerFile, evidenceDirectory, resources, futureReviewerDigest, source, inputs };
}

test('offline direct bounded review retains actual command evidence', { timeout: 60000, skip: process.env.AEON_OFFLINE_REVIEW_FIXTURE !== '1' }, async () => {
  const f = fixture(false, false, true), store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
  try {
    const authority = f.options.bootstrap.proof.proposal.priorAuthority;
    const request: EvaluationRequest = { requestId: 'direct-bounded-review', policyDigest: f.policy.policyDigest, candidate: f.incumbent,
      proposal: { id: 'direct-proposal', runId: 'direct-author', scope: { kind: 'public' }, authority, provenance: { kind: 'self', inputId: 'fixture', goalId: 'fixture', actorId: 'fixture' },
        justification: 'Bounded direct engineering observation', goal: { objective: 'observe', successCriteria: ['behavior'] }, experience: store.putArtifact('engineering-only'), state: 'frozen' } };
    const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }); ledger.allocate(request.proposal.runId, { ...f.resources, maxConcurrency: 1 });
    store.put('runs', request.proposal.runId, { id: request.proposal.runId, status: 'completed', revision: 0, scope: request.proposal.scope, authority }, null);
    const response = await runAccountedExternalReview(f.reviewer, f.host, request, f.policy, f.incumbent.manifest.id,
      { store, request, evaluatorDigest: hashBytes(reviewerDescriptor(f.reviewer)), evaluatorId: f.reviewer.evaluatorId, maxElapsedMs: f.reviewer.maxElapsedMs,
        assertAuthority: a => assert.deepEqual(a, authority), dispatchAuthority: (a, run) => { assert.deepEqual(a, authority); run(); } });
    assert.equal(response.result.receipt.evidence[0]!.verdict, 'pass');
    assert.equal(ledger.snapshot(request.proposal.runId).requests, 2);
    assert.equal(ledger.snapshot(request.proposal.runId).concurrent, 0);
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('offline behavioral reviewer confines candidate probes and reaches ordinary staged admission and fresh probation', { timeout: 180000, skip: process.env.AEON_OFFLINE_REVIEW_FIXTURE !== '1' }, async t => {
  const f = fixture(true, false, true); let supervisor: ServiceSupervisor | undefined;
  const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
  const authorityStore = new AuthorityStore(join(f.host.stateDirectory, 'authority.sqlite'));
  try {
    supervisor = await ServiceSupervisor.open(f.options);
    const response = await fetch(`http://127.0.0.1:${supervisor.status().ready!.address.port}/inputs`, { method: 'POST', headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify({ externalId: 'offline-validator', revision: '1', conversation: 'offline-review', text: 'Execute the finite offline behavioral review fixture.' }) });
    assert.equal(response.status, 202);
    const record = await eventually(() => {
      const value = store.list<import('./control-continuation.ts').ControlContinuationRecord>('host.control-continuations')[0]?.value;
      if (value && ['uncertain', 'rejected'].includes(value.status)) throw Error(JSON.stringify(value));
      if (supervisor!.status().evaluation?.uncertain) throw Error(JSON.stringify(supervisor!.status().evaluation));
      return value;
    }, value => value?.status === 'accepted');
    assert.ok(record?.review && record.probationProof);
    const proof = store.readJsonArtifact<ReleaseProof>(record.probationProof);
    assert.equal(supervisor.status().release?.accepted.candidateId, record.review.candidate.manifest.id);
    assert.deepEqual(proof.proposal.priorAuthority, record.review.judgeAuthority);
    assert.ok(proof.proposal.evidence.every(e => !record.review!.admissionEvidenceIds.includes(e.id)));
    const physical = () => store.list<{ request: import('../packages/contracts/index.ts').PhysicalRequest }>('requests').map(r => r.value.request).filter(r => r.provider === 'external-offline-review');
    assert.equal(physical().length, 4, 'Two actual candidate commands and two separate sealed reviewers');
    assert.ok(physical().every(r => r.status === 'succeeded' && r.runId === record.request.runId));
    assert.equal(physical().filter(r => r.id.includes(':probe:')).length, 2);
    for (const original of record.review.allocationLineage) {
      const { cancelled, ...fields } = store.get<any>('allocations', original.id)!.value;
      assert.equal(cancelled, false); assert.deepEqual({ id: original.id, ...fields }, original);
    }
    const observation = store.readJsonArtifact<OfflineObservation>(proof.proposal.evidence[0]!.caseResults[0]!.observations);
    assert.equal(observation.passed, true); assert.equal(observation.candidateId, record.review.candidate.manifest.id);
    assert.equal(observation.physical.usage.requests, 1); assert.equal(observation.physical.runId, record.request.runId);

    // These extra checks use explicit engineering allocations under the unchanged operating grant.
    const resource = (id: string, candidate: ReturnType<typeof freezeApplication>) => {
      const authority = supervisor!.status().ready!.authority, runId = `offline-negative:${id}`;
      const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }); ledger.allocate(runId, f.resources, 'operating-envelope:v1');
      store.put('runs', runId, { id: runId, status: 'completed', revision: 0, scope: { kind: 'public' }, authority }, null);
      const request: EvaluationRequest = { requestId: id, candidate, policyDigest: f.nextPolicy.policyDigest, proposal: { ...record.review!.proposal, runId, authority } };
      const options = { store, request, evaluatorDigest: hashBytes(reviewerDescriptor(f.reviewer)), evaluatorId: f.reviewer.evaluatorId, maxElapsedMs: f.reviewer.maxElapsedMs,
        assertAuthority: (a: Authority) => authorityStore.assert(a), dispatchAuthority: (a: Authority, run: () => void) => authorityStore.dispatch(a, run) };
      return { request, options, ledger };
    };
    await t.test('seeded Unicode semantic regression fails independent outcomes and admission; replay does not launch again', async () => {
      writeFileSync(join(f.source, markerPath), 'export function ucs2length(s: string): number { return s.length; }\n');
      const bad = freezeApplication(f.source, f.host.artifactStore, f.inputs), r = resource('regressed-validator', bad);
      const result = await runAccountedExternalReview(f.reviewer, f.host, r.request, f.nextPolicy, record.review!.candidate.manifest.id, r.options);
      assert.equal(result.result.receipt.evidence[0]!.verdict, 'fail');
      assert.equal(result.result.receipt.evidence[0]!.caseResults[0]!.status, 'fail');
      const artifacts = new Map(result.artifacts.map(a => [`sha256:${a.sha256}`, Buffer.from(a.base64, 'base64')]));
      assert.throws(() => admitCandidate(f.host.artifactStore, result.result.proof.proposal, r.request.proposal.authority, f.nextPolicy, result.result.proof.signed, uri => artifacts.get(uri)!, 'control-upgrade'));
      const count = physical().length;
      await assert.rejects(runAccountedExternalReview(f.reviewer, f.host, r.request, f.nextPolicy, record.review!.candidate.manifest.id, r.options), /already used/);
      assert.equal(physical().length, count);
    });
    await t.test('candidate attempts to read reviewer namespace and original private files fail while behavior still passes', async () => {
      const privatePaths = ['/reviewer-key', offlinePlanMount, f.reviewer.keyFile, ...f.reviewer.files.filter(x => x.mount === offlinePlanMount).map(x => x.path)];
      const attack = `import { readFileSync } from 'node:fs'; for (const path of ${JSON.stringify(privatePaths)}) { let read = false; try { readFileSync(path); read = true; } catch {} if (read) throw Error('Private judge material exposed'); }\nexport function ucs2length(s: string): number { return [...s].length; }\n`;
      writeFileSync(join(f.source, markerPath), attack);
      const candidate = freezeApplication(f.source, f.host.artifactStore, f.inputs), r = resource('private-isolation', candidate);
      const result = await runAccountedExternalReview(f.reviewer, f.host, r.request, f.nextPolicy, record.review!.candidate.manifest.id, r.options);
      assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass');
      assert.ok(result.artifacts.every(a => !Buffer.from(a.base64, 'base64').includes(readFileSync(f.reviewer.keyFile))));
    });
    await t.test('tampered private plan and direct unaccounted reviewer cannot omit required probes', async () => {
      const planFile = f.reviewer.files.find(file => file.mount === offlinePlanMount)!, original = readFileSync(planFile.path);
      writeFileSync(planFile.path, Buffer.from(original.toString().replace('"expected":[false', '"expected":[true')));
      try { assert.throws(() => loadOfflinePlan(f.reviewer), /differs from accepted/); }
      finally { writeFileSync(planFile.path, original); }
      await assert.rejects(runExternalReview(f.reviewer, f.host, { requestId: 'omitted-probe' } as EvaluationRequest, f.nextPolicy, record.review!.candidate.manifest.id, () => {}), /requires original accounted/);
    });
    await supervisor.close(); supervisor = undefined;
    supervisor = await ServiceSupervisor.open(f.options);
    assert.equal(supervisor.status().release?.accepted.candidateId, record.review.candidate.manifest.id);
    assert.equal(physical().length, 8, 'Completed probe/reviewer pairs do not repeat on restart');
  } finally { await supervisor?.close(); authorityStore.close(); store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('ordinary frozen service tools dispatch to a sealed external process and stage through the actual supervisor', { timeout: 120000 }, async t => {
  const f = fixture(); let supervisor: ServiceSupervisor | undefined;
  const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
  const authorityStore = new AuthorityStore(join(f.host.stateDirectory, 'authority.sqlite'));
  const mailbox = new EvolutionMailbox({ store, assertAuthority: grant => authorityStore.assert(grant), waitMs: 30, pollMs: 5 });
  try {
    supervisor = await ServiceSupervisor.open(f.options);
    assert.equal(supervisor.status().evaluation?.available, true);
    const admitted = await fetch(`http://127.0.0.1:${supervisor.status().ready!.address.port}/inputs`, { method: 'POST', headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' }, body: JSON.stringify({ externalId: 'physical-dispatch', revision: '1', conversation: 'fixture', text: 'Execute bounded engineering fixture.' }) });
    assert.equal(admitted.status, 202);
    const submission = await eventually(() => {
      if (mailbox.jobs().some(job => job.status === 'uncertain')) throw Error(JSON.stringify(supervisor!.status().evaluation));
      return mailbox.jobs().find(job => job.kind === 'submission');
    }, value => value?.status === 'completed');
    const receipt = store.readJsonArtifact<any>(submission!.receipt!);
    assert.equal(receipt.status, 'staged'); assert.equal(receipt.receipt.policyDigest, f.nextPolicy.policyDigest);
    assert.equal(supervisor.status().release?.phase, 'accepted'); assert.equal(supervisor.status().release?.active.candidateId, f.incumbent.manifest.id);
    await eventually(() => store.list<any>('release.changes')[0]!.value.state, value => value === 'submitted');
    assert.equal(mailbox.jobs().filter(job => job.kind === 'evaluation' && job.status === 'completed').length, 1);
    const evaluation = mailbox.jobs().find(job => job.kind === 'evaluation')!, original = mailbox.request(evaluation.id) as EvaluationRequest;
    const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: f.reviewer.maxElapsedMs });
    const physical = ledger.request(reviewPhysicalId(evaluation.id))!;
    assert.equal(physical.runId, original.proposal.runId); assert.equal(physical.purpose, 'review'); assert.equal(physical.status, 'succeeded');
    assert.ok(physical.usage.elapsedMs > 0, 'Actual reviewer wall time is charged separately from the author effect receiver');
    // Additional fault jobs have explicit engineering author allocations; no completed generation
    // silently gains a successor's authority or borrows an unrelated requester's budget.
    const faultRequest = (requestId: string): EvaluationRequest => {
      const authority = supervisor!.status().ready!.authority, runId = `engineering-fault:${requestId}`;
      ledger.allocate(runId, f.resources, 'operating-envelope:v1');
      store.put('runs', runId, { id: runId, status: 'completed', revision: 0, scope: { kind: 'public' }, authority }, null);
      return { ...original, requestId, proposal: { ...original.proposal, runId, authority } };
    };
    const proof = store.readJsonArtifact<ReleaseProof>(evaluation.proof!);
    const observation = JSON.parse(Buffer.from(mailbox.readArtifact(proof.proposal.evidence[0]!.artifact.uri)).toString());
    assert.equal(observation.inheritedKeys, false); assert.match(observation.kind, /H1 unaccepted/);
    await eventually(() => store.list('host-transport').length, value => value === 9);

    await t.test('lost actual staged controller reply is retained as uncertain and never restaged after restart', async () => {
      const request = { ...(mailbox.request(submission!.id) as SubmissionRequest), requestId: 'lost-submission' };
      const stage = supervisor!.stageControl.bind(supervisor); let calls = 0;
      supervisor!.stageControl = async (externalProof, digest) => { calls++; await stage(externalProof, digest); throw Error('Lost actual controller reply after staging'); };
      try {
        await assert.rejects(mailbox.submitRelease(request), /remains/);
        await eventually(() => mailbox.status(request.requestId), value => value?.status === 'uncertain');
        assert.equal(calls, 1); assert.match(supervisor!.status().evaluation!.diagnosis!, /submission dispatch failed/);
      } finally { supervisor!.stageControl = stage; }
      await supervisor!.close(); supervisor = undefined;
      supervisor = await ServiceSupervisor.open(f.options);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(mailbox.status(request.requestId)!.status, 'uncertain'); assert.equal(calls, 1);
      assert.equal(supervisor.status().release?.phase, 'accepted');
    });
    await t.test('physical lost reply remains uncertain across host restart and is never automatically repeated', async () => {
      const request = faultRequest('lost-review');
      await assert.rejects(mailbox.requestEvaluation(request), /remains/);
      await eventually(() => mailbox.status(request.requestId), value => value?.status === 'uncertain');
      assert.match(supervisor!.status().evaluation!.diagnosis!, /evaluation dispatch failed/);
      await supervisor!.close(); supervisor = undefined;
      supervisor = await ServiceSupervisor.open(f.options);
      assert.equal(mailbox.status(request.requestId)!.status, 'uncertain');
      await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(supervisor.status().evaluation?.activeJob, undefined);
      assert.equal(ledger.request(reviewPhysicalId(request.requestId))!.status, 'uncertain');
      assert.equal(ledger.request(reviewPhysicalId(request.requestId))!.usage.elapsedMs, f.reviewer.maxElapsedMs);
    });
    await t.test('host interruption aborts a physical reviewer and restart retains uncertainty', async () => {
      const request = faultRequest('interrupted-review');
      const waiting = assert.rejects(mailbox.requestEvaluation(request), /remains|withdrawn|authority|stale/i);
      await eventually(() => mailbox.status(request.requestId), value => value?.status === 'dispatched');
      await supervisor!.close(); supervisor = undefined; await waiting;
      assert.equal(mailbox.status(request.requestId)!.status, 'uncertain');
      assert.equal(ledger.request(reviewPhysicalId(request.requestId))!.status, 'uncertain');
      assert.deepEqual(readdirSync(join(f.host.stateDirectory, 'host-review-dispatch')), []);
      const interruptedSnapshot = mkdtempSync(join(f.host.stateDirectory, 'host-review-dispatch/physical-'));
      writeFileSync(join(interruptedSnapshot, 'key'), Buffer.alloc(32, 1), { mode: 0o400 });
      supervisor = await ServiceSupervisor.open(f.options);
      assert.equal(mailbox.status(request.requestId)!.status, 'uncertain');
      assert.deepEqual(readdirSync(join(f.host.stateDirectory, 'host-review-dispatch')), []);
      await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(supervisor.status().evaluation?.activeJob, undefined);
    });
    await t.test('missing reviewer preserves offline service recovery with explicit unavailable status', async () => {
      await supervisor!.close(); supervisor = undefined;
      supervisor = await ServiceSupervisor.open({ ...f.options, evaluationDispatcher: { ...f.options.evaluationDispatcher, reviewerFile: join(f.root, 'missing-private-reviewer.json') } });
      assert.equal(supervisor.status().running, true); assert.equal(supervisor.status().evaluation?.available, false); assert.match(supervisor.status().evaluation!.diagnosis!, /unavailable/);
      const pending = faultRequest('missing-reviewer');
      await assert.rejects(mailbox.requestEvaluation(pending), /External evaluation unavailable/);
      assert.equal(mailbox.status(pending.requestId)!.status, 'pending');
      await supervisor.close(); supervisor = undefined;
      assert.equal(mailbox.fencePending(pending.requestId), true);
      assert.match(mailbox.status(pending.requestId)!.diagnosis!, /operation was not invoked/);
    });
    await t.test('complete imported mutable code is sealed and closure tampering is unavailable before launch', async () => {
      const tampered = structuredClone(f.reviewer), dependency = tampered.files.find(file => file.mount.endsWith('rules.mjs'))!;
      const originalDependency = readFileSync(dependency.path);
      writeFileSync(dependency.path, "export const heldOutMarker = 'weakened';\n", { mode: 0o600 });
      await assert.rejects(runExternalReview(tampered, f.host, original, f.policy, f.incumbent.manifest.id, () => {}), /closure changed/);
      writeFileSync(dependency.path, originalDependency, { mode: 0o600 });
    });
    await t.test('old authority prevents physical dispatch immediately after closure verification', async () => {
      let fences = 0;
      await assert.rejects(runExternalReview(f.reviewer, f.host, original, f.policy, f.incumbent.manifest.id, () => { fences++; throw Error('Withdrawn author'); }), /Withdrawn author/);
      assert.equal(fences, 1);
    });
    await t.test('unqualified executable arguments cannot borrow the old evaluator identity', async () => {
      let dispatched = false;
      await assert.rejects(runExternalReview({ ...f.reviewer, args: ['--eval', 'process.exit(0)'] }, f.host, original, f.policy, f.incumbent.manifest.id, () => { dispatched = true; }), /exact prior policy/);
      assert.equal(dispatched, false);
    });
    await t.test('authenticated negative review remains explicit feedback instead of uncertainty', async () => {
      const response = await runExternalReview(f.reviewer, f.host, { ...original, requestId: 'deliberate-negative-review' }, f.policy, f.incumbent.manifest.id, () => {});
      assert.equal(response.result.receipt.evidence[0]!.verdict, 'fail'); assert.equal(response.result.receipt.evidence[0]!.caseResults[0]!.status, 'fail');
    });
    await t.test('authenticated inconclusive review retains unavailable case evidence', async () => {
      const response = await runExternalReview(f.reviewer, f.host, { ...original, requestId: 'deliberate-inconclusive-review' }, f.policy, f.incumbent.manifest.id, () => {});
      const evidence = response.result.receipt.evidence[0]!;
      assert.equal(evidence.verdict, 'inconclusive'); assert.equal(evidence.caseResults[0]!.status, 'unavailable');
      assert.ok(response.artifacts.some(blob => blob.sha256 === evidence.artifact.sha256));
    });
    await t.test('negative verdict cannot bypass external response authentication', async () => {
      await assert.rejects(runExternalReview(f.reviewer, f.host, { ...original, requestId: 'forged-negative-review' }, f.policy, f.incumbent.manifest.id, () => {}), /Invalid external reviewer authentication/);
    });
    await t.test('authority withdrawn before result acceptance fences a complete signed response', async () => {
      let fences = 0;
      await assert.rejects(runExternalReview(f.reviewer, f.host, original, f.policy, f.incumbent.manifest.id, () => { if (++fences === 2) throw Error('Withdrawn result authority'); }), /Withdrawn result authority/);
      assert.equal(fences, 2);
    });
    await t.test('physical review timeout drains children and removes private key snapshots', async () => {
      await assert.rejects(runExternalReview(f.reviewer, f.host, { ...original, requestId: 'interrupted-review' }, f.policy, f.incumbent.manifest.id, () => {}), /deadline/);
      assert.deepEqual(readdirSync(join(f.host.stateDirectory, 'host-review-dispatch')), []);
    });
  } catch (error) { throw Error(`${error instanceof Error ? error.message : error}; ${JSON.stringify(supervisor?.status().evaluation)}`, { cause: error }); }
  finally { await supervisor?.close(); authorityStore.close(); store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('ordinary author activates its exact stage and receives fresh physical probation under the original judge', { timeout: 120000 }, async () => {
  const f = fixture(true); let supervisor: ServiceSupervisor | undefined;
  const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
  try {
    supervisor = await ServiceSupervisor.open(f.options);
    const response = await fetch(`http://127.0.0.1:${supervisor.status().ready!.address.port}/inputs`, { method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify({ externalId: 'ordinary-control-cycle', revision: '1', conversation: 'control-cycle', text: 'Execute the finite engineering control lifecycle.' }) });
    assert.equal(response.status, 202);
    const { run } = await response.json() as { run: { id: string } };
    const record = await eventually(() => {
      const value = store.list<import('./control-continuation.ts').ControlContinuationRecord>('host.control-continuations')[0]?.value;
      if (value && ['rejected', 'uncertain'].includes(value.status)) throw Error(JSON.stringify({ control: value.status, diagnosis: value.diagnosis, host: supervisor!.status().evaluation }));
      return value;
    }, value => value?.status === 'accepted');
    assert.ok(record?.review && record.physicalAuthority && record.probationProof);
    assert.equal(record.request.runId, run.id);
    const status = supervisor.status();
    assert.equal(status.release?.phase, 'accepted');
    assert.equal(status.release?.accepted.candidateId, record.review.candidate.manifest.id);
    assert.equal(status.release?.accepted.policyDigest, f.nextPolicy.policyDigest);
    assert.ok(record.physicalAuthority.epoch > record.review.judgeAuthority.epoch);
    const proof = store.readJsonArtifact<ReleaseProof>(record.probationProof);
    assert.deepEqual(proof.proposal.priorAuthority, record.review.judgeAuthority);
    assert.ok(proof.proposal.evidence.every(evidence => evidence.controlRevision === f.policy.controlRevision && !record.review!.admissionEvidenceIds.includes(evidence.id)));
    const physical = store.list<{ request: import('../packages/contracts/index.ts').PhysicalRequest }>('requests').map(row => row.value.request).filter(value => value.provider === 'external-offline-review');
    assert.equal(physical.length, 2, 'One admission review and one fresh probation review');
    assert.ok(physical.every(value => value.status === 'succeeded' && value.runId === run.id));
    for (const allocation of record.review.allocationLineage) {
      const { cancelled, ...retained } = store.get<any>('allocations', allocation.id)!.value;
      assert.equal(cancelled, false); assert.deepEqual({ id: allocation.id, ...retained }, allocation);
    }
    await eventually(() => store.events(run.id).filter(event => event.type === 'steering' && JSON.stringify(event.data).includes('control')).length, count => count > 0);
    store.put('fixture.control-latest', 'lived', { retained: true, uncertainEffect: 'do-not-repeat' }, null);
    await supervisor.close(); supervisor = undefined;
    supervisor = await ServiceSupervisor.open(f.options);
    assert.equal(supervisor.status().release?.accepted.candidateId, record.review.candidate.manifest.id);
    assert.deepEqual(store.get('fixture.control-latest', 'lived')!.value, { retained: true, uncertainEffect: 'do-not-repeat' });
    assert.equal(store.list<{ request: { provider: string } }>('requests').filter(row => row.value.request.provider === 'external-offline-review').length, 2, 'Accepted physical reviews never repeat on restart');
  } finally { await supervisor?.close(); store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('ordinary governance proposal uses old physical judges before accepted restart selects the new source reviewer', { timeout: 180000 }, async t => {
  const f = fixture(true, true); let supervisor: ServiceSupervisor | undefined;
  const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
  const keyDigest = hashBytes(readFileSync(f.reviewer.keyFile));
  const physicalRequests = () => store.list<{ request: import('../packages/contracts/index.ts').PhysicalRequest }>('requests').map(row => row.value.request).filter(value => value.provider === 'external-offline-review');
  const admit = async (externalId: string, text: string) => {
    const response = await fetch(`http://127.0.0.1:${supervisor!.status().ready!.address.port}/inputs`, { method: 'POST', headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' }, body: JSON.stringify({ externalId, revision: '1', conversation: externalId, text }) });
    assert.equal(response.status, 202); return (await response.json() as { run: { id: string } }).run.id;
  };
  try {
    supervisor = await ServiceSupervisor.open(f.options);
    const authorRun = await admit('source-governance-cycle', 'Execute source-owned governance replacement engineering fixture.');
    const record = await eventually(() => {
      const value = store.list<import('./control-continuation.ts').ControlContinuationRecord>('host.control-continuations')[0]?.value;
      if (value && ['rejected', 'uncertain'].includes(value.status)) throw Error(JSON.stringify({ control: value.status, diagnosis: value.diagnosis, host: supervisor!.status().evaluation }));
      return value;
    }, value => value?.status === 'accepted');
    assert.ok(record?.review && record.physicalAuthority && record.probationProof);
    assert.equal(record.request.runId, authorRun);
    const nextDescriptor = (record.review.candidate.inputs.controls as any).policy;
    assert.deepEqual(nextDescriptor.requiredCases, ['governance-future-source']);
    assert.equal(new Map(nextDescriptor.evaluatorArtifacts).get(f.reviewer.evaluatorId), f.futureReviewerDigest);
    assert.notEqual(f.futureReviewerDigest, f.policy.evaluatorArtifacts.get(f.reviewer.evaluatorId));
    const status = supervisor.status(), nextPolicyDigest = status.release!.accepted.policyDigest;
    assert.equal(status.release?.phase, 'accepted'); assert.equal(status.release?.accepted.candidateId, record.review.candidate.manifest.id);
    assert.notEqual(nextPolicyDigest, f.policy.policyDigest); assert.equal(record.review.policyDigest, f.policy.policyDigest);
    const proof = store.readJsonArtifact<ReleaseProof>(record.probationProof);
    assert.deepEqual(proof.proposal.priorAuthority, record.review.judgeAuthority);
    assert.ok(proof.proposal.evidence.every(evidence => evidence.evaluatorArtifact.sha256 === f.policy.evaluatorArtifacts.get(f.reviewer.evaluatorId) && evidence.controlRevision === f.policy.controlRevision && evidence.caseResults.every(result => result.id === 'held-out-exact-source') && !record.review!.admissionEvidenceIds.includes(evidence.id)));
    const jobs = store.list<any>('host.evolution-jobs').map(row => row.value), firstEvaluation = jobs.find(job => job.kind === 'evaluation');
    const admission = store.readJsonArtifact<any>(firstEvaluation.receipt);
    assert.equal(admission.policyDigest, f.policy.policyDigest); assert.ok(admission.evidence.every((evidence: EvaluationEvidence) => evidence.evaluatorArtifact.sha256 === f.policy.evaluatorArtifacts.get(f.reviewer.evaluatorId)));
    assert.equal(physicalRequests().length, 2); assert.ok(physicalRequests().every(value => value.status === 'succeeded' && value.runId === authorRun));
    for (const allocation of record.review.allocationLineage) {
      const { cancelled, ...retained } = store.get<any>('allocations', allocation.id)!.value;
      assert.equal(cancelled, false); assert.deepEqual({ id: allocation.id, ...retained }, allocation);
    }
    const oldProfile = store.list<any>('observations').map(row => row.value).find(observation => observation.runId === authorRun && observation.value?.proposalPath === 'deployment/governance-proposal.json')?.value;
    assert.ok(oldProfile?.reviewer); assert.equal(JSON.stringify(oldProfile).includes(f.root), false); assert.equal(JSON.stringify(oldProfile).includes('keyFile'), false);
    store.put('fixture.governance-latest', 'lived', { revision: 2, experience: 'after governance acceptance', uncertainEffect: 'do-not-repeat' }, null);
    const latest = store.get('fixture.governance-latest', 'lived');
    const beforeRestartEpoch = status.ready!.authority.epoch;
    await supervisor.close(); supervisor = undefined;
    supervisor = await ServiceSupervisor.open(f.options);
    assert.equal(supervisor.status().release?.accepted.policyDigest, nextPolicyDigest); assert.ok(supervisor.status().ready!.authority.epoch > beforeRestartEpoch);
    assert.deepEqual(store.get('fixture.governance-latest', 'lived'), latest); assert.equal(physicalRequests().length, 2);
    const futureRun = await admit('source-governance-future', 'fixture-future-evaluation: exercise the newly accepted reviewer.');
    const futureJob = await eventually(() => {
      const job = store.list<any>('host.evolution-jobs').map(row => row.value).find(job => job.kind === 'evaluation' && store.readJsonArtifact<EvaluationRequest>(job.request).proposal.runId === futureRun);
      if (job?.status === 'uncertain') throw Error(JSON.stringify({ future: job, host: supervisor!.status().evaluation }));
      return job;
    }, value => value?.status === 'completed');
    const futureRequest = store.readJsonArtifact<EvaluationRequest>(futureJob.request), futureResult = store.readJsonArtifact<any>(futureJob.receipt);
    assert.equal(futureRequest.policyDigest, nextPolicyDigest); assert.equal(futureResult.policyDigest, nextPolicyDigest);
    assert.ok(futureResult.evidence.length > 0);
    for (const evidence of futureResult.evidence as EvaluationEvidence[]) {
      assert.equal(evidence.evaluatorArtifact.sha256, f.futureReviewerDigest); assert.equal(evidence.controlRevision, record.review.candidate.manifest.controls);
      assert.deepEqual(evidence.caseResults.map(result => result.id), ['governance-future-source']);
      const observed = store.readJsonArtifact<any>({ ...evidence.artifact, uri: `aeon:artifact:${evidence.artifact.sha256}` });
      assert.equal(observed.reviewerGeneration, 'source-owned-future-reviewer-v2'); assert.equal(observed.inheritedKeys, false);
    }
    const futureProfile = store.list<any>('observations').map(row => row.value).find(observation => observation.runId === futureRun && observation.value?.proposalPath === 'deployment/governance-proposal.json')?.value;
    assert.deepEqual(futureProfile.policy.requiredCases, ['governance-future-source']);
    assert.equal(JSON.stringify(futureProfile).includes(f.root), false); assert.equal(JSON.stringify(futureProfile).includes('keyFile'), false);
    assert.equal(hashBytes(readFileSync(f.reviewer.keyFile)), keyDigest);
    assert.equal(physicalRequests().length, 3); assert.ok(physicalRequests().every(value => value.status === 'succeeded' && value.usage.elapsedMs > 0));
    assert.equal(physicalRequests().filter(value => value.runId === futureRun).length, 1);
    assert.deepEqual(store.get('fixture.governance-latest', 'lived'), latest);
    t.diagnostic(JSON.stringify({ kind: 'source-governance-physical-engineering', incumbent: f.incumbent.manifest.id, accepted: record.review.candidate.manifest.id, oldPolicy: f.policy.policyDigest, nextPolicy: nextPolicyDigest,
      oldReviewer: f.policy.evaluatorArtifacts.get(f.reviewer.evaluatorId), futureReviewer: f.futureReviewerDigest, physicalReviews: physicalRequests().map(value => ({ id: value.id, runId: value.runId, status: value.status, elapsedMs: value.usage.elapsedMs })), oldAdmissionEvidence: record.review.admissionEvidenceIds, oldProbationEvidence: proof.proposal.evidence.map(evidence => evidence.id), futureEvidence: futureResult.evidence.map((evidence: EvaluationEvidence) => evidence.id), liveProviderCalls: 0, externalMessages: 0 }));
  } catch (error) {
    const diagnosis = { error: error instanceof Error ? error.stack : String(error), host: supervisor?.status(), controls: store.list('host.control-continuations'), jobs: store.list('host.evolution-jobs'), runs: store.list('runs'), observations: store.list('observations'), physical: physicalRequests() };
    t.diagnostic(JSON.stringify(diagnosis));
    if (process.env.AEON_GOVERNANCE_LOG_DIRECTORY) {
      try { mkdirSync(process.env.AEON_GOVERNANCE_LOG_DIRECTORY, { recursive: true }); writeFileSync(join(process.env.AEON_GOVERNANCE_LOG_DIRECTORY, `failure-${process.pid}.json`), JSON.stringify(diagnosis, null, 2)); }
      catch (archival) { t.diagnostic(`Optional diagnostic archival failed: ${String(archival)}`); }
    }
    throw error;
  } finally { await supervisor?.close(); store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
