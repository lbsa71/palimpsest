import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { identity, type Effect, type PhysicalRequest, type Run } from '../packages/contracts/index.ts';
import { CommunicationsCore, SlackIngress, createSpeechHandler, type SlackApi } from '../packages/communications/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ToolEffectReceiver } from '../packages/tools/index.ts';
import { SlackControlReplies, type SlackControlDiagnosis, type SlackControlReply, type SlackControlTarget } from './slack-control-replies.ts';

const authority = { generation: 'control-fixture', epoch: 1, controlRevision: 'fixture' };
const scope = { kind: 'restricted', principals: ['slack:T1:U1'] } as const;
const envelope = { maxRequests: 20, maxTokens: 2000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 4 };
const target: SlackControlTarget = { channel: 'C1', threadTs: '10.001', transport: 'slack', scope: { ...scope, principals: [...scope.principals] } };

function fixture(t: TestContext, options: { lost?: boolean; diagnosis?: SlackControlDiagnosis } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-slack-control-')), filename = join(root, 'state.sqlite');
  const calls: { method: string; args: Record<string, string> }[] = []; let clientId = '', inference = 0, sequence = 0;
  const api: SlackApi = { async call<T>(method: string, args: Record<string, string>) {
    calls.push({ method, args: { ...args } });
    if (method === 'chat.postMessage') { clientId = args.client_msg_id!; if (options.lost) throw Error('Lost receipt after remote commit'); return { channel: 'C1', ts: '12.001' } as T; }
    if (method === 'conversations.replies') return { messages: [{ ts: '12.001', thread_ts: '10.001', user: 'BOT', client_msg_id: clientId }] } as T;
    throw Error('Unexpected Slack method');
  } };
  const open = () => {
    const store = new OperationalStore({ filename });
    const resources = new ResourceLedger(store, { tokens: 10, costUsd: 0, elapsedMs: 1000 }, () => 0);
    if (!store.get('allocations', 'host')) resources.allocate('host', envelope);
    const fence = { assert(grant: typeof authority) { assert.deepEqual(grant, authority); } };
    const receiver = new ToolEffectReceiver({ store, fence, grantForRun: () => ({ scope: target.scope, actions: ['speech_send'] }),
      speechReceiver: createSpeechHandler({ store, fence, api, botUserId: 'BOT', grants: [target] }) });
    const effects = new EffectJournal(store, fence, receiver, () => `effect-${++sequence}`);
    const runtime = new DurableRuntime({ store, effects, resources, shell: { async run() { inference++; throw Error('Control must not invoke inference'); } }, now: () => 0, elapsedNow: () => 0, newId: () => `runtime-${++sequence}` });
    const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources: envelope, parentRunId: 'host' }) });
    const ingress = new SlackIngress({ core, teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope: target.scope }], eligibleHumanIds: ['U1'] });
    const replies = new SlackControlReplies({ store, teamId: 'T1', botUserId: 'BOT', getRun: id => runtime.getRun(id), targetForRun: () => target, getEffect: id => effects.get(id), diagnose: () => options.diagnosis });
    async function process(plan: SlackControlReply) {
      const action = replies.nextAction(plan);
      if (action === 'dispatch') {
        let effect = effects.get(plan.id);
        if (!effect) {
          // A deterministic host response is charged to the existing host
          // allocation, even if the conversation's own allocation is cancelled.
          const request: PhysicalRequest = { id: plan.id, runId: 'host', purpose: 'reasoning', provider: 'effect-receiver', model: 'speech_send', promptManifestId: plan.id,
            requestDigest: identity(plan.payload), reservationId: plan.id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
          store.transaction(() => { resources.reserve(request); effects.create({ id: plan.id, runId: plan.runId, stepId: plan.id, kind: 'speech_send', payload: plan.payload, scope: plan.target.scope, authority, status: 'pending', revision: 0 }); effects.authorize(plan.id, plan.id, authority); });
          effect = effects.get(plan.id)!;
        }
        if (effect.status === 'authorized') {
          const request = resources.request(plan.id)!;
          const delivered = await effects.dispatch(plan.id, authority, undefined, () => resources.dispatched({ ...request, status: 'dispatched' }));
          resources.settle({ ...request, status: delivered.status === 'succeeded' ? 'succeeded' : delivered.status === 'failed' ? 'failed' : 'uncertain' });
        }
      } else if (action === 'reconcile') await effects.reconcile(plan.id, authority);
    }
    return { store, resources, runtime, core, ingress, replies, process };
  };
  let context = open();
  t.after(() => { context.store.close(); rmSync(root, { recursive: true, force: true }); });
  const run = context.ingress.acceptHistory('C1', { ts: '10.001', user: 'U1', text: '<@BOT> work' })!.run;
  const control = (text: string, ts = '11.001') => context.ingress.acceptHistory('C1', { ts, thread_ts: '10.001', user: 'U1', text })!;
  return { get context() { return context; }, run, calls, control, inference: () => inference,
    reopen() { context.store.close(); context = open(); return context; } };
}

test('status admission persists an accurate snapshot and duplicate delivery sends one exact-thread reply without inference', async t => {
  const f = fixture(t); f.control('<@BOT> status');
  const before = f.context.store.list('communications.inputs');
  assert.equal(f.control('<@BOT> status').duplicate, true); assert.deepEqual(f.context.store.list('communications.inputs'), before);
  const plans = f.context.replies.prepare(); assert.equal(plans.length, 1); assert.equal(plans[0]!.runStatus, 'ready');
  assert.match(plans[0]!.payload.text, /status check.*queued/);
  await f.context.process(plans[0]!); assert.equal(f.context.replies.prepare().length, 0);
  f.control('<@BOT> status'); assert.equal(f.context.replies.prepare().length, 0);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.args.channel, 'C1'); assert.equal(f.calls[0]!.args.thread_ts, '10.001');
  assert.equal(f.inference(), 0); assert.equal(f.context.resources.snapshot('host').requests, 1);
});

test('cancel acknowledges the cancelled owned run without reviving it or resetting its allowance', async t => {
  const f = fixture(t), original = f.context.store.get('allocations', f.run.id)!.value;
  assert.equal(f.control('cancel').run.status, 'cancelled');
  const plan = f.context.replies.prepare()[0]!; assert.match(plan.payload.text, /Cancellation recorded/);
  await f.context.process(plan);
  assert.equal(f.context.runtime.getRun(f.run.id)?.status, 'cancelled'); assert.equal(f.context.resources.snapshot(f.run.id).cancelled, true);
  const cancelled = f.context.store.get<Record<string, unknown>>('allocations', f.run.id)!.value;
  assert.deepEqual({ ...cancelled, cancelled: false }, original); assert.equal(f.inference(), 0); assert.equal(f.calls.length, 1);
});

test('cancel on an already completed run reports completion without claiming to have cancelled work', async t => {
  const f = fixture(t), row = f.context.store.get<Run>('runs', f.run.id)!;
  f.context.store.put('runs', f.run.id, { ...row.value, status: 'completed', revision: row.value.revision + 1 }, row.revision);
  assert.equal(f.control('cancel').run.status, 'completed');
  const plan = f.context.replies.prepare()[0]!; assert.match(plan.payload.text, /already completed; nothing was cancelled/);
  await f.context.process(plan); assert.equal(f.context.runtime.getRun(f.run.id)?.status, 'completed'); assert.equal(f.inference(), 0);
});

test('control snapshot survives a lost scheduling callback and later run state changes before reply preparation', async t => {
  const f = fixture(t, { diagnosis: 'slice-limit' }); f.control('status');
  f.context.runtime.cancel(f.run.id, 'fixture', 'later cancellation');
  const context = f.reopen(), plan = context.replies.prepare()[0]!;
  assert.equal(plan.runStatus, 'ready'); assert.match(plan.payload.text, /status check.*queued/); assert.doesNotMatch(plan.payload.text, /allowance/);
  await context.process(plan); assert.equal(context.runtime.getRun(f.run.id)?.status, 'cancelled'); assert.equal(f.calls.length, 1); assert.equal(f.inference(), 0);
});

test('uncertain reply delivery survives restart and reconciles exactly once without a second send', async t => {
  const f = fixture(t, { lost: true }); f.control('status'); const plan = f.context.replies.prepare()[0]!;
  await f.context.process(plan); assert.equal(f.context.replies.nextAction(plan), 'reconcile');
  const context = f.reopen(); assert.deepEqual(context.replies.prepare(), [plan]); await context.process(plan);
  assert.equal(context.replies.prepare().length, 0);
  assert.deepEqual(f.calls.map(call => call.method), ['chat.postMessage', 'conversations.replies']);
  assert.equal(f.calls[1]!.args.channel, 'C1'); assert.equal(f.calls[1]!.args.ts, '10.001'); assert.equal(f.inference(), 0);
});

test('old inputs and stale controls are preserved without creating historical or duplicate replies', t => {
  const f = fixture(t); f.control('status');
  const row = f.context.store.list<{ controlResult?: unknown }>('communications.inputs').find(row => row.value.controlResult)!;
  const { controlResult: _snapshot, ...legacy } = row.value; f.context.store.put('communications.inputs', row.key, legacy, row.revision);
  assert.equal(f.control('status').duplicate, true); assert.equal(f.context.store.get<{ controlResult?: unknown }>('communications.inputs', row.key)!.value.controlResult, undefined);
  assert.deepEqual(f.context.replies.prepare(), []);
  f.context.ingress.acceptAuthenticated('T1', { type: 'message', subtype: 'message_changed', channel: 'C1', event_ts: '13.0', message: { ts: '11.001', edited: { ts: '13.0' }, thread_ts: '10.001', user: 'U1', text: 'status' } });
  f.context.ingress.acceptAuthenticated('T1', { type: 'message', subtype: 'message_changed', channel: 'C1', event_ts: '12.0', message: { ts: '11.001', edited: { ts: '12.0' }, thread_ts: '10.001', user: 'U1', text: 'cancel' } });
  assert.equal(f.context.runtime.getRun(f.run.id)?.status, 'ready'); assert.equal(f.context.replies.prepare().length, 1);
});

test('only exact authenticated commands bound to the same conversation produce plans', t => {
  const f = fixture(t); f.control('status please'); assert.deepEqual(f.context.replies.prepare(), []);
  f.control('status', '12.001');
  const options = { store: f.context.store, teamId: 'T1', botUserId: 'BOT', getRun: (id: string) => f.context.runtime.getRun(id), getEffect: (id: string) => f.context.store.get<Effect>('effects', id)?.value };
  for (const wrong of [{ ...target, channel: 'C2' }, { ...target, threadTs: '99.001' }, { ...target, scope: { kind: 'public' as const } }]) {
    const replies = new SlackControlReplies({ ...options, targetForRun: () => wrong }); assert.deepEqual(replies.prepare(), []);
  }
  assert.equal(f.context.replies.prepare().length, 1); assert.equal(f.calls.length, 0);
});

test('status diagnostics are fixed host classifications and never include private provider failure text', t => {
  const f = fixture(t, { diagnosis: 'slice-limit' });
  const row = f.context.store.get<Run>('runs', f.run.id)!; f.context.store.put('runs', f.run.id, { ...row.value, status: 'blocked', revision: row.value.revision + 1 }, row.revision);
  f.context.store.put('execution', f.run.id, { failure: 'private provider diagnostic secret-token' }, null);
  f.control('status'); const plan = f.context.replies.prepare()[0]!;
  assert.match(plan.payload.text, /blocked/); assert.match(plan.payload.text, /finite model request allowance/); assert.doesNotMatch(plan.payload.text, /secret-token|private provider/);
});

test('unknown diagnostic content is omitted from an otherwise valid status acknowledgement', t => {
  const f = fixture(t, { diagnosis: 'private provider secret' as SlackControlDiagnosis }); f.control('status');
  const plan = f.context.replies.prepare()[0]!; assert.match(plan.payload.text, /queued/); assert.doesNotMatch(plan.payload.text, /private|secret/);
});

test('an in-flight or failed effect is never selected for blind replay and arbitrary plans are refused', t => {
  const f = fixture(t); f.control('status'); const plan = f.context.replies.prepare()[0]!;
  assert.throws(() => f.context.replies.nextAction({ ...plan, payload: { ...plan.payload, threadTs: '99.001' } }), /not prepared/);
  const effect: Effect = { id: plan.id, runId: plan.runId, stepId: plan.id, kind: 'speech_send', payload: plan.payload, scope: plan.target.scope, authority, status: 'dispatched', revision: 2, reservationId: plan.id };
  f.context.store.put('effects', effect.id, effect, null); assert.equal(f.context.replies.nextAction(plan), undefined);
  const row = f.context.store.get('effects', effect.id)!; f.context.store.put('effects', effect.id, { ...effect, status: 'failed' }, row.revision);
  assert.equal(f.context.replies.nextAction(plan), undefined); assert.equal(f.calls.length, 0);
});

test('old uncertain replies cannot monopolize the finite window for new control acknowledgements', async t => {
  const f = fixture(t, { lost: true }); f.control('status'); const old = f.context.replies.prepare(1)[0]!;
  await f.context.process(old); assert.equal(f.context.replies.nextAction(old), 'reconcile');
  f.control('status', '12.001'); const next = f.context.replies.prepare(1)[0]!;
  assert.notEqual(next.id, old.id); assert.equal(f.context.replies.nextAction(next), 'dispatch');
  assert.equal(f.calls.length, 1);
});
