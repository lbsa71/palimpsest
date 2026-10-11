import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { hash } from './adapter.ts';
import { assessLifecycle, captureLifecycle, freezeLifecyclePromptPair, processIdentity, validateLifecyclePlan, type LifecycleWitness, type Snapshot, type ProcessReceipt } from './lifecycle.ts';
import { LocalLostReplyReceiver, configureLifecycle, currentPrompt, oldPrompt, compactionPrompt, lifecycleEnvelope, lifecycleTransport } from './lifecycle-fixtures.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { admitCandidate, type AdmissionPolicy } from '../../packages/release/admission.ts';
import { materializeConfiguration } from '../../deployment/materialize.ts';
import { fixtureConfiguration } from './fixture.ts';

/** Pure mechanics witnesses, never passed to the physical acquisition driver or represented as real runs. */
function fixtureWitness(): LifecycleWitness {
  const now = Date.now(), runId = 'pure-run', root = 'operating-envelope:v1';
  const snapshot: Snapshot = { at: new Date(now + 30).toISOString(), documents: {}, events: [], artifacts: [], files: {}, ledger: { requests: 1, tokens: 17, costUsd: 0, elapsedMs: 10000, concurrent: 1, cancelled: false } };
  for (const name of ['allocations', 'budgets', 'requests', 'runs', 'execution', 'observations', 'effects', 'prompts', 'host-transport', 'host.run-grants', 'delegations', 'screen.lifecycle-reconciliation', 'communications.direct-outbox', 'screen.lifecycle-provider-responses']) snapshot.documents[name] = [];
  const put = (name: string, key: string, value: any) => snapshot.documents[name]!.push({ key, revision: 1, value });
  const retain = (value: unknown) => { const content = JSON.stringify(value), ref = { uri: `aeon:artifact:${hash(content)}`, sha256: hash(content) }; snapshot.artifacts.push({ ref, content, bytes: Buffer.byteLength(content) }); return ref; };
  const allocation = { rootId: root, envelope: lifecycleEnvelope, startedAt: now, cancelled: false };
  put('allocations', root, allocation); put('allocations', runId, { ...allocation, parentRunId: root }); put('budgets', root, { envelope: lifecycleEnvelope, startedAt: now, cancelled: false });
  const authority = { epoch: 1, generation: 'pure', controlRevision: 'pure' };
  put('runs', runId, { id: runId, status: 'completed', authority }); put('host.run-grants', runId, { workspace: '/pure-workspace', scope: { kind: 'public' } });
  const requestArtifact = retain({ messages: [{ role: 'system', content: 'public' }] });
  put('prompts', 'held-prompt', { artifact: requestArtifact, manifest: { requestDigest: requestArtifact.sha256, fragments: [] } });
  const request = { id: 'held-request', runId, provider: 'mistral', model: 'fixture', promptManifestId: 'held-prompt', requestDigest: requestArtifact.sha256, status: 'uncertain' };
  put('requests', request.id, { rootId: root, request, ceiling: { tokens: 17, costUsd: 0, elapsedMs: 10000 }, charged: { tokens: 17, costUsd: 0, elapsedMs: 10000 } });
  put('host-transport', request.id, { requestId: request.id, dispatched: true, responseDigest: null });
  put('execution', runId, { checkpoint: { runId, observationIds: ['first-read'], artifact: retain({ messages: [], compactions: [] }) } });
  const effect = (id: string, kind: string, payload: unknown, receipt: unknown, sequence: number) => {
    put('effects', id, { id, runId, kind, status: 'succeeded', payload, receipt: retain(receipt), reservationId: id });
    const observation = { id, runId, kind: 'result', value: receipt }; put('observations', id, observation); snapshot.events.push({ stream: runId, type: 'observation', sequence, data: observation });
    put('requests', id, { rootId: root, request: { id, runId, provider: 'effect-receiver', model: kind, status: 'succeeded' }, ceiling: { tokens: 0, costUsd: 0, elapsedMs: 10000 }, charged: { tokens: 0, costUsd: 0, elapsedMs: 0 } });
  };
  effect('first-read', 'workspace_read', { path: 'state.json' }, { content: '{"value":4}\n', sha256: hash('{"value":4}\n') }, 1);
  snapshot.events.push({ stream: runId, type: 'checkpoint', sequence: 2, data: snapshot.documents.execution![0]!.value.checkpoint });
  snapshot.events.push({ stream: runId, type: 'steering', sequence: 3, data: { authenticated: true, value: 'value9' } });
  effect('write', 'workspace_write', { path: 'state.json', content: '{"value":9}\n', expectedSha256: hash('{"value":4}\n') }, { sha256: hash('{"value":9}\n') }, 4);
  effect('read', 'workspace_read', { path: 'state.json' }, { content: '{"value":9}\n' }, 5);
  const speech = { transport: 'direct', text: 'verified', delivered: true, clientMsgId: 'pure-delivery' };
  effect('speech', 'speech_send', { channel: 'pure', text: 'verified' }, speech, 6); put('communications.direct-outbox', 'speech', { runId, receipt: speech });
  snapshot.ledger.requests = snapshot.documents.requests!.length; snapshot.files[runId] = { 'state.json': '{"value":9}\n' };
  const initial = structuredClone(snapshot), boundary = structuredClone(snapshot);
  boundary.documents.requests![0]!.value.request.status = 'dispatched'; boundary.documents.runs![0]!.value.status = 'running';
  boundary.events = boundary.events.filter(event => event.sequence <= 2); boundary.documents.effects = boundary.documents.effects!.filter(row => row.key === 'first-read'); boundary.documents.observations = boundary.documents.observations!.filter(row => row.key === 'first-read'); boundary.documents.requests = boundary.documents.requests!.filter(row => ['held-request', 'first-read'].includes(row.key)); boundary.documents['communications.direct-outbox'] = []; boundary.files[runId] = { 'state.json': '{"value":4}\n' };
  for (const namespace of Object.keys(initial.documents)) if (!['allocations', 'budgets'].includes(namespace)) initial.documents[namespace] = [];
  initial.documents.allocations = initial.documents.allocations!.filter(row => row.key === root); initial.events = []; initial.artifacts = []; initial.files = {}; initial.ledger = { requests: 0, tokens: 0, costUsd: 0, elapsedMs: 30, concurrent: 0, cancelled: false };
  const host = { readerProcess: { pid: 303, start: '303', state: 'S' }, servingProcess: { pid: 101, start: '101', state: 'S' }, authority: { ...authority, artifactId: 'fixture' } };
  initial.hostObservation = structuredClone(host); boundary.hostObservation = structuredClone(host); snapshot.hostObservation = structuredClone(host);
  const process = (pid: number, time: number): ProcessReceipt => ({ identity: { pid, start: String(pid), state: 'S' }, artifactId: 'fixture', spawnedAt: new Date(time).toISOString(), ready: { authority, artifactId: 'fixture' }, descendantsAtStop: [], requestedStop: 'SIGKILL', exitedAt: new Date(time + 1).toISOString(), exitCode: null, exitSignal: 'SIGKILL', predecessorGone: true, stderr: '' });
  return { caseId: 'S08', runId, initial, boundary, final: snapshot, processes: [process(101, now), process(202, now + 2)], receiver: null, transition: null, plainOldRun: null, plainCurrentRun: null };
}
function check(witness: LifecycleWitness, id: string) { return assessLifecycle(witness).checks.find(check => check.id === id)!; }

test('pure complete restart mechanics bind actual process identity, checkpoint, original charge and correction', () => { const assessment = assessLifecycle(fixtureWitness()); assert.equal(assessment.quality, 3, JSON.stringify(assessment)); });
test('a same-PID reconstruction cannot establish an ordinary process restart', () => { const witness = fixtureWitness(); witness.processes[1]!.identity = { ...witness.processes[0]!.identity }; assert.equal(check(witness, 'actual-stopped-process-reopened').passed, false); });
test('a fabricated stop request without an observed predecessor exit cannot pass', () => { const witness = fixtureWitness(); witness.processes[0]!.exitedAt = null; witness.processes[0]!.predecessorGone = false; assert.equal(check(witness, 'actual-stopped-process-reopened').passed, false); });
test('restart cannot reset original root allowance, clock or uncertain reservation', () => {
  for (const mutation of ['clock', 'grant', 'charge', 'cancel', 'expiry']) {
    const witness = fixtureWitness();
    if (mutation === 'clock') witness.final.documents.budgets![0]!.value.startedAt++;
    if (mutation === 'grant') witness.final.documents.allocations![0]!.value.envelope = { ...lifecycleEnvelope, maxTokens: 720000 };
    if (mutation === 'charge') witness.final.documents.requests![0]!.value.charged.tokens = 0;
    if (mutation === 'cancel') witness.final.documents.budgets![0]!.value.cancelled = true;
    if (mutation === 'expiry') witness.final.at = new Date(Date.now() + lifecycleEnvelope.maxElapsedMs + 1000).toISOString();
    assert.equal(assessLifecycle(witness).quality, 0, mutation);
  }
});
test('correct final artifact without retained initial observation or authenticated steering is insufficient', () => {
  const witness = fixtureWitness(); witness.final.documents.execution![0]!.value.checkpoint.observationIds = []; assert.equal(check(witness, 'checkpoint-and-authenticated-correction-retained').passed, false);
  const corrected = fixtureWitness(); corrected.final.events.find(event => event.type === 'steering')!.data.authenticated = false; assert.equal(check(corrected, 'checkpoint-and-authenticated-correction-retained').passed, false);
});
test('artifact tampering and missing physical payload/transport are rejected', () => {
  const witness = fixtureWitness(); witness.final.artifacts[0]!.content += ' '; assert.equal(check(witness, 'retained-artifact-bytes-authentic').passed, false);
  const missing = fixtureWitness(); missing.final.documents['host-transport'] = []; assert.equal(check(missing, 'physical-payload-and-transport-bound').passed, false);
});
test('targeted restart controls have a passing baseline before removing the actual read4 or inventing the write digest', () => {
  const missing = fixtureWitness(); assert.equal(check(missing, 'checkpoint-and-authenticated-correction-retained').passed, true); missing.boundary!.documents.observations = []; assert.equal(check(missing, 'checkpoint-and-authenticated-correction-retained').passed, false);
  const digest = fixtureWitness(); assert.equal(check(digest, 'real-corrected-artifact-readback').passed, true); digest.final.documents.effects!.find(row => row.key === 'write')!.value.payload.expectedSha256 = 'a'.repeat(64); assert.equal(check(digest, 'real-corrected-artifact-readback').passed, false);
});
test('changed boundary grants, enlarged existing allocations and switched workspaces fail continuity against a valid baseline', () => {
  for (const mutation of ['boundary-grant', 'run-allocation', 'workspace']) {
    const witness = fixtureWitness(); assert.equal(check(witness, 'original-grant-clock-retained').passed, true);
    if (mutation === 'boundary-grant') witness.boundary!.documents.budgets![0]!.value.envelope.maxRequests = 999;
    if (mutation === 'run-allocation') witness.final.documents.allocations![1]!.value.envelope = { ...lifecycleEnvelope, maxTokens: 720000 };
    if (mutation === 'workspace') witness.final.documents['host.run-grants']![0]!.value.workspace = '/switched';
    assert.equal(check(witness, 'original-grant-clock-retained').passed, false, mutation);
  }
});
test('private final text or a claimed outbox cannot replace an actual delivered speech effect/receipt', () => {
  const witness = fixtureWitness(); assert.equal(check(witness, 'explicit-real-delivered-output').passed, true); witness.final.documents.effects = witness.final.documents.effects!.filter(row => row.key !== 'speech'); assert.equal(check(witness, 'explicit-real-delivered-output').passed, false);
});
test('every observed effect must retain its original physical reservation, including local sends', () => {
  const witness = fixtureWitness(); assert.equal(check(witness, 'all-effects-have-original-physical-receipts').passed, true); witness.final.documents.requests = witness.final.documents.requests!.filter(row => row.key !== 'write'); assert.equal(check(witness, 'all-effects-have-original-physical-receipts').passed, false);
});
test('a short history and a claimed summary cannot establish threshold compaction', () => {
  const witness = fixtureWitness(); witness.caseId = 'S09'; witness.final.files[witness.runId] = { 'answer.json': '{"origin":"indigo","notes":32}\n' };
  witness.final.documents.execution![0]!.value.checkpoint = undefined;
  assert.equal(check(witness, 'ordinary-threshold-compaction-manifest').passed, false); assert.equal(check(witness, 'context-reclaimed-with-original-constraint').passed, false);
});
test('manual compaction metadata without an actual compaction request cannot pass', () => {
  const witness = fixtureWitness(); witness.caseId = 'S09'; witness.final.documents.execution![0]!.value.compactions = [{ sourceDigest: identity([]), summary: 'claimed compacted' }]; assert.equal(check(witness, 'ordinary-threshold-compaction-manifest').passed, false);
});
test('local lost acknowledgement is an actual durable SQLite commit, not an injected send receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-local-receiver-')); let receiver = new LocalLostReplyReceiver(join(root, 'receiver.sqlite'));
  try {
    await assert.rejects(receiver.call('chat.postMessage', { channel: 'LOCAL-C1', thread_ts: '10', text: 'result', client_msg_id: 'actual-effect-id' }), /lost after actual durable SQLite commit/);
    assert.equal(receiver.rows().length, 1); receiver.close(); receiver = new LocalLostReplyReceiver(join(root, 'receiver.sqlite'));
    const recovered = await receiver.call<any>('conversations.replies', { channel: 'LOCAL-C1', ts: '10' }); assert.equal(recovered.messages[0].client_msg_id, 'actual-effect-id'); assert.equal(receiver.rows().length, 1);
    await assert.rejects(receiver.call('chat.postMessage', { channel: 'LOCAL-C1', thread_ts: '10', text: 'result', client_msg_id: 'actual-effect-id' }), /UNIQUE/); assert.equal(receiver.rows().length, 1);
    await assert.rejects(receiver.call('apps.connections.open', {}), /rejects socket/);
  } finally { receiver.close(); rmSync(root, { recursive: true, force: true }); }
});
test('two distinct actual local deliveries remain visible and cannot pass exactly-once assessment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-local-duplicate-')), receiver = new LocalLostReplyReceiver(join(root, 'receiver.sqlite'));
  try {
    await assert.rejects(receiver.call('chat.postMessage', { channel: 'LOCAL-C1', thread_ts: '10', text: 'result', client_msg_id: 'first-effect' }));
    await receiver.call('chat.postMessage', { channel: 'LOCAL-C1', thread_ts: '10', text: 'result', client_msg_id: 'second-effect' }); assert.equal(receiver.rows().length, 2);
    const witness = fixtureWitness(); witness.caseId = 'S11'; witness.receiver = { deliveries: receiver.rows(), calls: receiver.calls() }; assert.equal(check(witness, 'exactly-one-real-delivery-no-replay').passed, false);
  } finally { receiver.close(); rmSync(root, { recursive: true, force: true }); }
});
test('a completed local task without host reconciliation and original uncertain delivery cannot pass', () => { const witness = fixtureWitness(); witness.caseId = 'S11'; witness.receiver = { deliveries: [{ client_id: 'made-up' }], calls: [] }; assert.equal(check(witness, 'durable-local-lost-reply-reconciled').passed, false); });
test('a completed prompt task and invented child text without admitted actual artifact cannot pass', () => { const witness = fixtureWitness(); witness.caseId = 'S12'; witness.final.files[witness.runId] = { 'state.json': '{"value":9}\n', 'answer.json': '{"value":9,"source":"actual-child"}\n' }; assert.equal(check(witness, 'actual-admitted-prompt-only-successor-loaded').passed, false); assert.equal(check(witness, 'current-owned-layer-across-resumed-plain-child').passed, false); assert.equal(check(witness, 'real-current-child-inspected-accepted-integrated').passed, false); });
test('frozen plan rejects absent/duplicate cases, undeclared control or excessive attempts', () => {
  const plan = [{ caseId: 'S08' as const, control: 'normal' as const, initialAttempts: 1 }, { caseId: 'S08' as const, control: 'no-process-restart' as const, initialAttempts: 1 }, { caseId: 'S09' as const, control: 'normal' as const, initialAttempts: 1 }, { caseId: 'S09' as const, control: 'short-history' as const, initialAttempts: 1 }, { caseId: 'S11' as const, control: 'normal' as const, initialAttempts: 1 }, { caseId: 'S11' as const, control: 'duplicate-delivery' as const, initialAttempts: 1 }, { caseId: 'S12' as const, control: 'normal' as const, initialAttempts: 1 }, { caseId: 'S12' as const, control: 'retained-old-profile' as const, initialAttempts: 1 }];
  assert.equal(validateLifecyclePlan(plan).length, 8); assert.throws(() => validateLifecyclePlan(plan.slice(1))); assert.throws(() => validateLifecyclePlan([...plan.slice(1), plan[1]!])); assert.throws(() => validateLifecyclePlan(plan.map((item, i) => ({ ...item, initialAttempts: i === 0 ? 4 : 1 }))));
});
test('pure physical grant refusal does not dispatch or replenish expired/cancelled/exhausted original state', () => {
  for (const boundary of ['expired', 'cancelled', 'exhausted']) {
    const root = mkdtempSync(join(tmpdir(), 'lifecycle-ledger-')), store = new OperationalStore({ filename: join(root, 'operational.sqlite') });
    try {
      const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }); ledger.allocate('operating', { ...lifecycleEnvelope, maxRequests: boundary === 'exhausted' ? 0 : 180 });
      if (boundary === 'expired') { const budget = store.get<any>('budgets', 'operating')!; store.put('budgets', 'operating', { ...budget.value, startedAt: Date.now() - 180001 }, budget.revision); }
      if (boundary === 'cancelled') ledger.cancel('operating');
      const before = JSON.stringify({ allocations: store.list('allocations'), budgets: store.list('budgets') });
      const request: PhysicalRequest = { id: 'original-private-check', runId: 'operating', provider: 'local-reconciliation', model: 'none', promptManifestId: 'fixed-local', requestDigest: 'a'.repeat(64), reservationId: 'original-private-check', purpose: 'review', status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
      assert.throws(() => ledger.reserve(request), /exhausted|cancelled/); assert.equal(store.list('requests').length, 0); assert.equal(JSON.stringify({ allocations: store.list('allocations'), budgets: store.list('budgets') }), before);
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
test('bounded artifact capture retains exact tool bytes and propagates nested missing artifact failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-capture-')); mkdirSync(join(root, 'state')); const store = new OperationalStore({ filename: join(root, 'state', 'operational.sqlite') });
  try {
    const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }); ledger.allocate('operating-envelope:v1', lifecycleEnvelope);
    const tools = store.putArtifact('[]'); store.put('prompts', 'pure-prompt', { manifest: { fragments: [{ artifact: tools }] } }, null);
    assert.equal(captureLifecycle(join(root, 'state')).artifacts[0]!.content, '[]');
    const nested = store.putJsonArtifact({ missing: { uri: `aeon:artifact:${'f'.repeat(64)}`, sha256: 'f'.repeat(64) } }); store.put('execution', 'pure-run', { checkpoint: { artifact: nested } }, null);
    assert.throws(() => captureLifecycle(join(root, 'state')), /missing artifact/);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('ordinary compaction response does not consume a public note-read step', async () => {
  const transport = lifecycleTransport({ caseId: 'S09', control: 'normal', phase: 0, model: 'fixture', actorId: 'fixture', boundary() { throw new Error('No synthetic process boundary expected'); } });
  const frame = { role: 'user', content: JSON.stringify({ hostContext: { runId: 'pure', target: { channel: 'pure' } } }) }, signal = new AbortController().signal;
  const payload = JSON.stringify({ messages: [frame], tools: [{}] }); const first = JSON.parse((await transport(payload, signal)).body); assert.equal(JSON.parse(first.choices[0].message.tool_calls[0].function.arguments).path, 'notes/0.json');
  await transport(JSON.stringify({ messages: [{ role: 'system', content: compactionPrompt }, frame], tools: [] }), signal);
  const second = JSON.parse((await transport(payload, signal)).body); assert.equal(JSON.parse(second.choices[0].message.tool_calls[0].function.arguments).path, 'notes/1.json');
});
test('actual process identity reads PID and proc start identity without inventing an exit receipt', () => { const observed = processIdentity(process.pid); assert.equal(observed?.pid, process.pid); assert.match(observed!.start, /^\d+$/); assert.equal(processIdentity(2147483647), null); });
test('pure prompt preparation freezes two complete closures, authenticates engineering admission and loads exact accepted bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-prompt-preflight-')), config = configureLifecycle(fixtureConfiguration(root, join(import.meta.dirname, '../..'))), authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
  try {
    const pair = freezeLifecyclePromptPair(root, config, authorityStore);
    assert.equal(pair.admission.kind, 'engineering'); assert.equal(pair.admission.candidateId, pair.current.manifest.id);
    for (const field of ['source', 'dependencies', 'configuration', 'controls', 'model'] as const) assert.equal(pair.old.manifest[field], pair.current.manifest[field]);
    assert.notEqual(pair.old.manifest.prompts, pair.current.manifest.prompts);
    assert.equal(pair.configCurrent.applicationRoot, join(pair.artifactStore, pair.admission.candidateId, 'payload')); assert.equal(pair.configCurrent.artifactId, pair.admission.candidateId);
    assert.equal(readFileSync(pair.configCurrent.promptFile, 'utf8'), currentPrompt); assert.equal(readFileSync(pair.configOld.promptFile, 'utf8'), oldPrompt);
    const policy: AdmissionPolicy = { ...pair.policy, evaluatorKeys: new Map([['PUBLIC-engineering-host-judgment', readFileSync(join(pair.evidenceDirectory, 'fixture-signing-key'))]]), evaluatorArtifacts: new Map([['PUBLIC-engineering-host-judgment', pair.policy.evaluatorArtifact.sha256]]) };
    const corrupted = pair.signed.map(record => ({ ...record, authentication: '0'.repeat(64) }));
    assert.throws(() => admitCandidate(pair.artifactStore, pair.proposal, pair.initialAuthority, policy, corrupted, uri => readFileSync(join(pair.evidenceDirectory, uri.slice(7)))), /authentication/);
    chmodSync(pair.configCurrent.promptFile, 0o600); writeFileSync(pair.configCurrent.promptFile, oldPrompt);
    assert.throws(() => materializeConfiguration(pair.current, { stateDirectory: config.stateDirectory, workspaceDirectory: config.workspaceDirectory, artifactStore: pair.artifactStore, nodeBinary: process.execPath }), /materialization changed/);
    assert.equal(readFileSync(pair.configOld.promptFile, 'utf8'), oldPrompt, 'old accepted profile remains untouched');
  } finally { authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
