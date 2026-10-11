import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutarkApplication } from '../../deployment/application.ts';
import { joinLifecycleCorrection } from './lifecycle-child.ts';
import { hash } from './adapter.ts';
import { assessLifecycle, type LifecycleWitness, type Snapshot, type ProcessReceipt } from './lifecycle.ts';
import { lifecycleEnvelope, oldPrompt, currentPrompt } from './lifecycle-fixtures.ts';

// Independent adversarial retained-state inputs. These are deliberately synthetic,
// never physical acquisition reports, and do not establish product capability.
// The shared evidence shape mirrors the author pure fixture; independent review
// assertions require each target predicate to pass before one causal mutation.
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

test('review: a checkpoint label without initial value4 read evidence cannot establish retained correction', () => {
  const witness = fixtureWitness();
  assert.equal(check(witness, 'checkpoint-and-authenticated-correction-retained').passed, true);
  witness.boundary!.documents.observations = [];
  assert.equal(check(witness, 'checkpoint-and-authenticated-correction-retained').passed, false,
    'No observation/effect/receipt binds the boundary checkpoint to an actual value4 read');
});
test('review: arbitrary expectedSha256 does not establish a write derived from the boundary read', () => {
  const witness = fixtureWitness();
  assert.equal(check(witness, 'real-corrected-artifact-readback').passed, true);
  witness.final.documents.effects!.find(row => row.key === 'write')!.value.payload.expectedSha256 = 'a'.repeat(64);
  assert.equal(check(witness, 'real-corrected-artifact-readback').passed, false,
    'The write carries an invented digest with no causal link to the initial read');
});
test('review: root allowance restored after an intervention cannot hide a changed boundary grant', () => {
  const witness = fixtureWitness();
  assert.equal(check(witness, 'original-grant-clock-retained').passed, true);
  witness.boundary!.documents.budgets![0]!.value.envelope = { ...lifecycleEnvelope, maxRequests: 999 };
  assert.equal(check(witness, 'original-grant-clock-retained').passed, false);
});
test('review: changing an existing per-run allocation cannot pass original grant continuity', () => {
  const witness = fixtureWitness();
  assert.equal(check(witness, 'original-grant-clock-retained').passed, true);
  witness.final.documents.allocations![1]!.value.envelope = { ...lifecycleEnvelope, maxTokens: 720000 };
  assert.equal(check(witness, 'original-grant-clock-retained').passed, false);
});
test('review: changing a workspace at the restart boundary cannot pass original grant continuity', () => {
  const witness = fixtureWitness();
  for (const snapshot of [witness.initial, witness.boundary!, witness.final]) snapshot.documents['host.run-grants'] = [{ key: witness.runId, revision: 1, value: { workspace: '/same-workspace', scope: { kind: 'public' } } }];
  assert.equal(check(witness, 'original-grant-clock-retained').passed, true);
  witness.final.documents['host.run-grants']![0]!.value.workspace = '/different-workspace';
  assert.equal(check(witness, 'original-grant-clock-retained').passed, false);
});

test('review: a second effective old system message cannot hide behind a current first system message', () => {
  const witness = fixtureWitness(); witness.caseId = 'S12';
  witness.plainOldRun = 'old-plain'; witness.plainCurrentRun = 'current-plain';
  witness.final.documents.delegations = [{ key: 'child', revision: 1, value: { task: { parentRunId: witness.runId }, result: { childRunId: 'current-child' } } }];
  const retain = (content: string) => { const ref = { uri: `aeon:artifact:${hash(content)}`, sha256: hash(content) }; witness.final.artifacts.push({ ref, content, bytes: Buffer.byteLength(content) }); return ref; };
  for (const [id, runId, system] of [['old-profile', 'old-plain', oldPrompt], ['current-profile', witness.runId, currentPrompt], ['plain-profile', 'current-plain', currentPrompt], ['child-profile', 'current-child', currentPrompt]]) {
    const messages = [{ role: 'system', content: system! }];
    const payload = retain(JSON.stringify({ messages })), fragment = retain(system!);
    witness.final.documents.prompts!.push({ key: id!, revision: 1, value: { artifact: payload, manifest: { requestDigest: payload.sha256, fragments: [{ id: 'application.mind', role: 'system', artifact: fragment }] } } });
    const row = { key: id!, revision: 1, value: { request: { id, runId, provider: 'mistral', promptManifestId: id, requestDigest: payload.sha256 } } };
    witness.final.documents.requests!.push(row);
    if (id === 'old-profile') witness.boundary!.documents.requests!.push(structuredClone(row));
  }
  assert.equal(check(witness, 'current-owned-layer-across-resumed-plain-child').passed, true);
  const changed = witness.final.documents.prompts!.find(row => row.key === 'current-profile')!.value;
  const changedPayload = retain(JSON.stringify({ messages: [{ role: 'system', content: currentPrompt }, { role: 'system', content: oldPrompt }] }));
  changed.artifact = changedPayload; changed.manifest.requestDigest = changedPayload.sha256;
  witness.final.documents.requests!.find(row => row.key === 'current-profile')!.value.request.requestDigest = changedPayload.sha256;
  assert.equal(check(witness, 'current-owned-layer-across-resumed-plain-child').passed, false);
});

test('review: correction completion probe catches the original immediate stale-waiting reply', async () => {
  const probe = async (join: typeof joinLifecycleCorrection) => {
    let releaseOld!: () => void, releaseCorrected!: () => void;
    const oldTurn = new Promise<void>(resolve => { releaseOld = resolve; });
    const correctedTurn = new Promise<void>(resolve => { releaseCorrected = resolve; });
    let calls = 0, sequence = 1, status = 'waiting', replied = false;
    const app = { store: { get: () => ({ value: { messageSequence: sequence } }) }, runtime: { getRun: () => ({ status }) }, resume: async () => {
      if (++calls === 1) { await oldTurn; return { status }; }
      sequence = 9; status = 'running'; await correctedTurn; status = 'completed'; return { status };
    } } as unknown as AutarkApplication;
    const result = join(app, 'retained-run', 9).then(value => { replied = true; return value; });
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(replied, false, 'IPC must not reply from stale waiting before joining the actual old turn');
      releaseOld(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 2); assert.equal(sequence, 9); assert.equal(status, 'running');
      assert.equal(replied, false, 'A consumed checkpoint does not mean corrected turn completion');
      releaseCorrected(); assert.equal((await result)?.status, 'completed');
    } finally { releaseOld(); releaseCorrected(); await result; }
  };
  await probe(joinLifecycleCorrection);
  await assert.rejects(probe(async (app, runId) => app.runtime.getRun(runId)), /stale waiting/);
});
