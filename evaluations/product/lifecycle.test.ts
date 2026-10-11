import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { hash } from './adapter.ts';
import { assessLifecycle, captureLifecycle, processIdentity, validateLifecyclePlan, type LifecycleWitness, type Snapshot, type ProcessReceipt } from './lifecycle.ts';
import { LocalLostReplyReceiver, compactionPrompt, lifecycleEnvelope, lifecycleTransport } from './lifecycle-fixtures.ts';

/** Pure mechanics witnesses, never passed to the physical acquisition driver or represented as real runs. */
function fixtureWitness(): LifecycleWitness {
  const now = Date.now(), runId = 'pure-run', root = 'operating-envelope:v1';
  const snapshot: Snapshot = { at: new Date(now + 30).toISOString(), documents: {}, events: [], artifacts: [], files: {}, ledger: { requests: 1, tokens: 17, costUsd: 0, elapsedMs: 10000, concurrent: 1, cancelled: false } };
  for (const name of ['allocations', 'budgets', 'requests', 'runs', 'execution', 'observations', 'effects', 'prompts', 'host-transport', 'host.run-grants', 'delegations', 'screen.lifecycle-reconciliation']) snapshot.documents[name] = [];
  const put = (name: string, key: string, value: any) => snapshot.documents[name]!.push({ key, revision: 1, value });
  const retain = (value: unknown) => { const content = JSON.stringify(value), ref = { uri: `aeon:artifact:${hash(content)}`, sha256: hash(content) }; snapshot.artifacts.push({ ref, content, bytes: Buffer.byteLength(content) }); return ref; };
  const allocation = { rootId: root, envelope: lifecycleEnvelope, startedAt: now, cancelled: false };
  put('allocations', root, allocation); put('allocations', runId, { ...allocation, parentRunId: root }); put('budgets', root, { envelope: lifecycleEnvelope, startedAt: now, cancelled: false });
  put('runs', runId, { id: runId, status: 'completed', authority: { epoch: 1 } });
  const requestArtifact = retain({ messages: [{ role: 'system', content: 'public' }] });
  put('prompts', 'held-prompt', { artifact: requestArtifact, manifest: { requestDigest: requestArtifact.sha256, fragments: [] } });
  const request = { id: 'held-request', runId, provider: 'mistral', model: 'fixture', promptManifestId: 'held-prompt', requestDigest: requestArtifact.sha256, status: 'uncertain' };
  put('requests', request.id, { rootId: root, request, ceiling: { tokens: 17, costUsd: 0, elapsedMs: 10000 }, charged: { tokens: 17, costUsd: 0, elapsedMs: 10000 } });
  put('host-transport', request.id, { requestId: request.id, dispatched: true, responseDigest: null });
  put('execution', runId, { checkpoint: { runId, observationIds: ['first-read'], artifact: retain({ messages: [], compactions: [] }) } });
  const readReceipt = retain({ content: '{"value":9}\n' });
  put('effects', 'read', { id: 'read', runId, kind: 'workspace_read', status: 'succeeded', payload: { path: 'state.json' }, receipt: readReceipt });
  put('effects', 'write', { id: 'write', runId, kind: 'workspace_write', status: 'succeeded', payload: { path: 'state.json', expectedSha256: 'a'.repeat(64) } });
  snapshot.files[runId] = { 'state.json': '{"value":9}\n' }; snapshot.events.push({ stream: runId, type: 'steering', data: { authenticated: true, value: 'value9' } });
  const initial = structuredClone(snapshot), boundary = structuredClone(snapshot);
  boundary.documents.requests![0]!.value.request.status = 'dispatched'; boundary.documents.runs![0]!.value.status = 'running';
  const process = (pid: number, time: number): ProcessReceipt => ({ identity: { pid, start: String(pid), state: 'S' }, artifactId: 'fixture', spawnedAt: new Date(time).toISOString(), ready: {}, descendantsAtStop: [], requestedStop: 'SIGKILL', exitedAt: new Date(time + 1).toISOString(), exitCode: null, exitSignal: 'SIGKILL', predecessorGone: true, stderr: '' });
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
  const corrected = fixtureWitness(); corrected.final.events[0]!.data.authenticated = false; assert.equal(check(corrected, 'checkpoint-and-authenticated-correction-retained').passed, false);
});
test('artifact tampering and missing physical payload/transport are rejected', () => {
  const witness = fixtureWitness(); witness.final.artifacts[0]!.content += ' '; assert.equal(check(witness, 'retained-artifact-bytes-authentic').passed, false);
  const missing = fixtureWitness(); missing.final.documents['host-transport'] = []; assert.equal(check(missing, 'physical-payload-and-transport-bound').passed, false);
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
