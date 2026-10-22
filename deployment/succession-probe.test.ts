import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type JsonValue, type PhysicalRequest, type Run, type ShellPort } from '../packages/contracts/index.ts';
import { authority, envelope, input, prompt, setup } from '../packages/runtime/test/fixtures.ts';
import { providerResponseRecorder } from './provider-gateway.ts';
import { enqueueSuccessionProbe, readSuccessionProbe, SuccessionProbes, type SuccessionProbeRequest } from './succession-probe.ts';

function fixture(t: test.TestContext, lostReply = false) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-serving-probe-'));
  let state!: ReturnType<typeof setup>, probes!: SuccessionProbes, modelCalls = 0, replyCalls = 0, modelId = '';
  const answer = 'Measured serving successor answer', rawCallId = 'probe-call';
  const shell: ShellPort = { async run({ run }, bridge) {
    modelCalls++; modelId = `model:${run.id}`;
    const model: PhysicalRequest = { id: modelId, reservationId: modelId, runId: run.id, purpose: 'reasoning', provider: 'mistral', model: 'source-owned-fixture',
      promptManifestId: prompt.id, requestDigest: identity({ runId: run.id, question: 'probe' }), status: 'reserved',
      usage: { requests: 1, inputTokens: 5, outputTokens: 2, costUsd: 0.01, elapsedMs: 0 } };
    state.resources.reserve(model); state.resources.dispatched({ ...model, status: 'dispatched' });
    const body = { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: rawCallId, type: 'function', function: { name: 'succession_probe_reply', arguments: JSON.stringify({ response: answer }) } }] } }] };
    providerResponseRecorder({ store: state.store, ledger: state.resources, runId: run.id, scope: run.scope, maxBytes: 10000 })(modelId, { status: 200, body: JSON.stringify(body) });
    state.resources.settle({ ...model, status: 'succeeded', usage: { ...model.usage, elapsedMs: 1 } });
    const observation = await bridge.execute({ id: `serving:${rawCallId}`, runId: run.id, stepId: 'probe-step', name: 'succession_probe_reply', arguments: { response: answer } });
    assert.equal(readSuccessionProbe(state.store, request), undefined, 'A running producer has not settled its answer boundary');
    return { status: 'completed', observations: [observation] };
  } };
  state = setup(join(directory, 'state.sqlite'), shell, async effect => {
    replyCalls++; const tool = probes.tools(effect.runId, effect.id)[0]!;
    const value = await tool.execute(effect.payload);
    if (lostReply) throw Error('Lost return after local probe answer; do not replay');
    return { outcome: 'succeeded', value: value as JsonValue };
  });
  t.after(() => { state.store.close(); rmSync(directory, { recursive: true, force: true }); });
  const parent = state.runtime.admit(input, authority, envelope), candidateId = identity('actual-serving-fixture-source');
  const binding = { id: 'operation', candidateId, incumbentId: identity('incumbent'), scope: input.scope };
  state.store.put('host.succession-dialogues', binding.id, { phase: 'observing', binding }, null);
  const request: SuccessionProbeRequest = { id: 'probe', operationId: binding.id, bindingDigest: identity(binding), parentRunId: parent.id, candidateId, authority, scope: input.scope, question: 'What is the measured successor result?' };
  probes = new SuccessionProbes({ store: state.store, runtime: state.runtime, candidateId, authority, resources: { ...envelope, maxConcurrency: 1 }, assertAuthority: () => state.effects.fence.assert(authority) });
  enqueueSuccessionProbe(state.store, request);
  const start = () => probes.prepare()[0]!;
  const execute = async () => { const id = start(); assert.ok(id); await state.runtime.resume(id, prompt); return id; };
  const mutate = (namespace: string, key: string, update: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const row = state.store.get<Record<string, unknown>>(namespace, key)!; state.store.put(namespace, key, update(row.value), row.revision);
  };
  return { ...state, request, parent, candidateId, binding, probes, start, execute, mutate, answer,
    modelId: () => modelId, modelCalls: () => modelCalls, replyCalls: () => replyCalls,
    effect: () => state.store.get<{ reservationId: string }>('effects', `tool:serving:${rawCallId}`)!.value,
    receipt: () => readSuccessionProbe(state.store, request) };
}

test('controlled model fixture uses serving DurableRuntime with only internal reply tool and original parent allocation', async t => {
  const f = fixture(t), original = f.store.get('allocations', f.parent.id);
  const runId = await f.execute();
  assert.deepEqual(f.probes.tools(runId).map(tool => tool.name), ['succession_probe_reply']); assert.deepEqual(f.probes.tools(f.parent.id), []);
  assert.deepEqual(f.probes.prepare(), []); const ref = f.receipt()!; assert.ok(ref);
  const receipt = f.store.readJsonArtifact<{ response: string; candidateId: string; physicalRequestId: string; serving: boolean; runId: string }>(ref);
  assert.equal(receipt.response, f.answer); assert.equal(receipt.candidateId, f.candidateId); assert.equal(receipt.serving, true); assert.equal(receipt.runId, runId); assert.equal(receipt.physicalRequestId, f.modelId());
  const allocation = f.store.get<{ parentRunId: string; rootId: string }>('allocations', runId)!.value;
  assert.equal(allocation.parentRunId, f.parent.id); assert.equal(allocation.rootId, f.parent.id);
  const { elapsedFloorMs: _old, ...before } = original!.value as Record<string, unknown>, { elapsedFloorMs: _new, ...after } = f.store.get('allocations', f.parent.id)!.value as Record<string, unknown>;
  assert.deepEqual(after, before); assert.deepEqual(f.receipt(), ref); assert.equal(f.modelCalls(), 1); assert.equal(f.replyCalls(), 1);
});
test('lost local reply stays unknown and no read or prepare retries the serving model', async t => {
  const f = fixture(t, true); await f.execute();
  assert.throws(() => f.receipt(), /settled serving execution|Probe run was/); assert.deepEqual(f.probes.prepare(), []);
  assert.equal(f.modelCalls(), 1); assert.equal(f.replyCalls(), 1);
  const effect = f.store.get<{ status: string }>('effects', 'tool:serving:probe-call')!.value; assert.equal(effect.status, 'uncertain');
});
test('wrong dialogue, parent audience or current generation cannot allocate a probe', t => {
  for (const fault of ['dialogue', 'scope', 'authority'] as const) {
    const f = fixture(t); const allocations = f.store.list('allocations').length;
    if (fault === 'dialogue') f.mutate('host.succession-dialogues', f.binding.id, value => ({ ...value, phase: 'approved' }));
    else if (fault === 'scope') f.mutate('runs', f.parent.id, value => ({ ...value, scope: { kind: 'restricted', principals: ['foreign'] } }));
    else f.withdraw();
    if (fault === 'authority') assert.throws(() => f.probes.prepare());
    else { assert.deepEqual(f.probes.prepare(), []); assert.equal(f.store.list<{ status: string }>('host.succession-probes')[0]!.value.status, 'uncertain'); assert.deepEqual(f.probes.prepare(), []); }
    assert.equal(f.store.list('allocations').length, allocations); assert.equal(f.modelCalls(), 0);
  }
});
for (const fault of ['runId', 'provider', 'requestDigest', 'reservationId'] as const) test(`a succeeded foreign receiver ${fault} is not settled probe evidence`, async t => {
  const f = fixture(t); await f.execute(); assert.ok(f.receipt(), 'Untampered serving witness must succeed before the negative contrast'); const id = f.effect().reservationId;
  f.mutate('requests', id, value => ({ ...value, request: { ...value.request as object, [fault]: 'foreign' } }));
  assert.throws(() => f.receipt(), /probe|receiver|physical|settled/i);
});
for (const fault of ['missing', 'uncertain', 'foreignRun', 'nonModel', 'wrongPurpose'] as const) test(`provider response with ${fault} physical model request cannot witness serving reply`, async t => {
  const f = fixture(t); await f.execute(); assert.ok(f.receipt(), 'Untampered serving witness must succeed before the negative contrast'); const id = f.modelId();
  if (fault === 'missing') { const row = f.store.get('requests', id)!; f.store.delete('requests', id, row.revision); }
  else f.mutate('requests', id, value => ({ ...value, request: { ...value.request as object,
    ...(fault === 'uncertain' ? { status: 'uncertain' } : fault === 'foreignRun' ? { runId: 'foreign' } : fault === 'nonModel' ? { provider: 'effect-receiver' } : { purpose: 'review' }) } }));
  assert.throws(() => f.receipt(), /probe|model|physical|settled/i);
});
test('cancelled or authority-adopted probe cannot be certified as the original serving witness', async t => {
  for (const fault of ['cancelled', 'authority', 'scope'] as const) {
    const f = fixture(t); const runId = await f.execute(); assert.ok(f.receipt(), 'Untampered serving witness must succeed before the negative contrast');
    f.mutate('runs', runId, value => ({ ...value, ...(fault === 'cancelled' ? { status: 'cancelled' } : fault === 'authority' ? { authority: { ...authority, epoch: 4 } } : { scope: { kind: 'restricted', principals: ['foreign'] } }) }));
    let value;
    try { value = f.receipt(); } catch (error) { assert.match(String(error), /cancelled|fenced|audience|scope/); }
    assert.equal(value, undefined, 'Ineligible witness cannot produce a serving receipt');
  }
});
test('a stored provider response with another audience is not evidence for this probe scope', async t => {
  const f = fixture(t); await f.execute(); assert.ok(f.receipt(), 'Untampered serving witness must succeed before the negative contrast'); f.mutate('host.model-responses', f.modelId(), value => ({ ...value, scope: { kind: 'restricted', principals: ['foreign'] } }));
  assert.throws(() => f.receipt(), /scope|audience|model|probe/i);
});
