import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { DirectCommunications, CommunicationsError } from '../src/communications.ts';
import { ProviderError } from '../src/providers.ts';
import type { CompletionRequest, Provider } from '../src/providers.ts';
import { AgentRuntime } from '../src/runtime.ts';

function provider(complete: Provider['complete']): Provider { return { name: 'fixture', complete }; }
function result(text: string) { return { text, model: 'fixture', provider: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; }
const message = (id: string, conversationId = 'one') => ({ id, conversationId, text: `Hello ${id}`, source: 'direct' });

test('late old-generation inference cannot cross storage or communications receivers', async () => {
  const store = new Store(':memory:'); const direct = new DirectCommunications(); let active = true;
  let release!: () => void; let started!: () => void;
  const begun = new Promise<void>(r => { started = r; }); const pending = new Promise<void>(r => { release = r; });
  const runtime = new AgentRuntime({ store, communications: [direct], authorize: () => { if (!active) throw new Error('stale_authority'); },
    provider: provider(async () => { started(); await pending; return result('old generation'); }) });
  const task = await runtime.submit(message('fenced'));
  const drain = runtime.runUntilIdle(); await begun; active = false; release();
  try {
    await assert.rejects(drain, /stale_authority/);
    assert.equal(store.task(task.id)?.state, 'running');
    assert.equal(store.listMemories('one').length, 0); assert.equal(direct.messages('one').length, 0);
    assert.equal((store.task(task.id)?.checkpoint as Record<string, unknown>).answer, undefined);
  } finally { await runtime.stop(); store.close(); }
});

test('quiescence checkpoints active work and leaves operator ingress usable until resumed', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const runtime = new AgentRuntime({ store, communications: [new DirectCommunications()], provider: provider(async () => result(String(++calls))) });
  try {
    await runtime.quiesce(); const task = await runtime.submit(message('queued while paused'));
    await runtime.runUntilIdle(); assert.equal(calls, 0); assert.equal(store.task(task.id)?.state, 'queued');
    await runtime.resume(); assert.equal(calls, 1); assert.equal(store.task(task.id)?.state, 'succeeded');
  } finally { await runtime.stop(); store.close(); }
});

for (const operation of ['quiesce', 'stop'] as const) test(`${operation} settles concurrent command egress even when the ordinary drain rejects`, async () => {
  const store = new Store(':memory:'); let active = true;
  let releaseInference!: () => void; let inferenceStarted!: () => void;
  let releaseCommand!: () => void; let commandStarted!: () => void;
  const inferencePending = new Promise<void>((resolve) => { releaseInference = resolve; });
  const inferenceBegun = new Promise<void>((resolve) => { inferenceStarted = resolve; });
  const commandPending = new Promise<void>((resolve) => { releaseCommand = resolve; });
  const commandBegun = new Promise<void>((resolve) => { commandStarted = resolve; });
  const runtime = new AgentRuntime({ store, authorize: () => { if (!active) throw new Error('stale_authority'); },
    provider: provider(async () => { inferenceStarted(); await inferencePending; return result('old answer'); }),
    communications: [{ name: 'direct', send: async () => { commandStarted(); await commandPending; } }],
  });
  try {
    const task = await runtime.submit(message('settling'));
    const drain = runtime.runUntilIdle(); const drainResult = drain.catch((error: unknown) => error);
    await inferenceBegun;
    const status = runtime.submit({ ...message('status-settling'), text: `status ${task.id}` }).catch((error: unknown) => error);
    await commandBegun;
    let settled = false;
    const stopping = runtime[operation]().catch((error: unknown) => error).finally(() => { settled = true; });
    active = false; releaseInference(); await drainResult;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'no quiescence claim while owned command delivery is still unresolved');
    releaseCommand(); await status; await stopping;
    assert.equal(settled, true);
  } finally { releaseInference(); releaseCommand(); await runtime.stop().catch(() => {}); store.close(); }
});

test('scoped status and cancellation commands stay responsive while inference is pending', async () => {
  const store = new Store(':memory:'); const direct = new DirectCommunications(); let release!: () => void; let started!: () => void;
  const blocked = new Promise<void>(r => { release = r; }); const begun = new Promise<void>(r => { started = r; });
  const runtime = new AgentRuntime({ store, communications: [direct], provider: provider(async () => { started(); await blocked; return result('late'); }) });
  try {
    const work = await runtime.submit(message('long')); const drain = runtime.runUntilIdle(); await begun;
    const status = await runtime.submit({ ...message('status'), text: `status ${work.id}` });
    assert.equal(status.state, 'succeeded'); assert.match(String(status.output), /running/);
    const foreign = await runtime.submit({ ...message('foreign', 'other'), text: `cancel ${work.id}` });
    assert.match(String(foreign.output), /not found/); assert.equal(store.task(work.id)?.state, 'running');
    const cancelled = await runtime.submit({ ...message('cancel'), text: `cancel ${work.id}` });
    assert.equal(cancelled.state, 'succeeded'); assert.equal(store.task(work.id)?.state, 'cancelled');
    assert.equal((await runtime.submit({ ...message('cancel'), text: `cancel ${work.id}` })).id, cancelled.id);
    release(); await drain; assert.ok(!direct.messages('one').some(message => message.text === 'late'));
  } finally { release(); await runtime.stop(); store.close(); }
});

test('correction preserves old task history and queues exactly one scoped replacement', async () => {
  const store = new Store(':memory:'); const runtime = new AgentRuntime({ store, communications: [new DirectCommunications()], provider: provider(async () => result('revised')) });
  try {
    const old = await runtime.submit(message('original'));
    const input = { ...message('correction'), text: `correct ${old.id} Actually use the revised question.` };
    const command = await runtime.submit(input); assert.equal(command.state, 'succeeded'); await runtime.submit(input);
    const replacement = store.listTasks().find(task => task.input === 'Actually use the revised question.');
    assert.ok(replacement); assert.equal(store.listTasks().length, 3); assert.equal(store.task(old.id)?.state, 'cancelled');
    await runtime.runUntilIdle(); assert.equal(store.task(replacement.id)?.state, 'succeeded'); assert.equal(store.task(old.id)?.input, 'Hello original');
  } finally { await runtime.stop(); store.close(); }
});

test('command retries during delivery send once, preserve reply thread and stay queued while paused', async () => {
  const store = new Store(':memory:'); const sent: Array<{ replyTo?: string; text: string }> = [];
  let finish!: () => void; let entered!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; }); const begun = new Promise<void>((resolve) => { entered = resolve; });
  const runtime = new AgentRuntime({ store, provider: provider(async () => result('updated answer')),
    communications: [{ name: 'slack', send: async (output) => { sent.push(output); entered(); await pending; } }],
  });
  try {
    const slackAuthor = { teamId: 'T1', userId: 'U1' };
    const original = await runtime.submit({ id: 'slack-original', conversationId: 'slack:T1:C1:123.000', source: 'slack', text: 'Original', replyTo: '123.000', slackAuthor });
    const input = { id: 'correction-event', conversationId: original.conversationId, source: 'slack', text: `correct ${original.id} Revised`, replyTo: '123.000', slackAuthor };
    const first = runtime.submit(input); await begun;
    const retry = await runtime.submit(input); assert.equal(retry.state, 'running');
    const stopping = runtime.quiesce();
    const queuedCommand = await runtime.submit({ ...input, id: 'status-while-paused', text: `status ${original.id}` });
    assert.equal(queuedCommand.state, 'queued'); assert.equal(sent.length, 1);
    finish(); await first; await stopping;
    const replacement = store.listTasks().find((task) => task.input === 'Revised')!;
    assert.equal((replacement.checkpoint as Record<string, unknown>).replyTo, '123.000');
    await runtime.resume();
    assert.equal(sent.filter((message) => message.text.startsWith('Correction recorded')).length, 1);
    assert.ok(sent.every((message) => message.replyTo === '123.000'));
    assert.equal(store.task(queuedCommand.id)?.state, 'succeeded');
  } finally { finish(); await runtime.stop().catch(() => {}); store.close(); }
});

test('direct ingress returns durable queued work, deduplicates, and preserves scoped episodes', async () => {
  const store = new Store(':memory:');
  const direct = new DirectCommunications();
  const prompts: CompletionRequest[] = [];
  const runtime = new AgentRuntime({ store, communications: [direct], provider: provider(async request => {
    prompts.push(request); return result(`answer ${prompts.length}`);
  }) });
  try {
    const first = await runtime.submit(message('a'));
    assert.equal((await runtime.submit(message('a'))).id, first.id);
    assert.equal(first.state, 'queued');
    await runtime.runUntilIdle();
    assert.equal(runtime.status(first.id)?.state, 'succeeded');
    assert.equal(prompts.length, 1);
    assert.equal(direct.messages('one').filter(m => m.kind === 'result').length, 1);
    assert.equal(store.listMemories('one').length, 1);
    await runtime.submit(message('b', 'two'));
    await runtime.runUntilIdle();
    assert.ok(!prompts[1]!.prompt.includes('Hello a'));
  } finally { await runtime.stop(); store.close(); }
});

test('cancel remains responsive during inference and late output cannot become a reply or memory', async () => {
  const store = new Store(':memory:'); const direct = new DirectCommunications();
  let release!: () => void; let started!: () => void;
  const begun = new Promise<void>(r => { started = r; });
  const blocked = new Promise<void>(r => { release = r; });
  const runtime = new AgentRuntime({ store, communications: [direct], provider: provider(async () => { started(); await blocked; return result('late'); }) });
  try {
    const task = await runtime.submit(message('a'));
    const drain = runtime.runUntilIdle();
    await begun;
    assert.equal(runtime.status(task.id)?.state, 'running');
    assert.equal(runtime.cancel(task.id)?.state, 'cancelled');
    release(); await drain;
    assert.equal(runtime.status(task.id)?.state, 'cancelled');
    assert.equal(direct.messages('one').filter(m => m.kind === 'result').length, 0);
    assert.equal(store.listMemories('one').length, 0);
  } finally { release(); await runtime.stop(); store.close(); }
});

test('provider unavailability waits without fallback and consumes its persisted call budget', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const runtime = new AgentRuntime({ store, communications: [new DirectCommunications()], maxCallsPerTask: 1,
    provider: provider(async () => { calls++; throw new ProviderError('unavailable', 'provider offline'); }) });
  try {
    const task = await runtime.submit(message('a'));
    await runtime.runUntilIdle();
    assert.equal(runtime.status(task.id)?.state, 'waiting_for_provider');
    assert.equal(calls, 1);
    runtime.retry(task.id);
    await runtime.runUntilIdle();
    assert.equal(calls, 1);
    assert.equal(runtime.status(task.id)?.error, 'inference_budget_exhausted');
  } finally { await runtime.stop(); store.close(); }
});

test('uncertain communication remains blocked and is never blindly replayed', async () => {
  const store = new Store(':memory:'); let sends = 0;
  const runtime = new AgentRuntime({ store, provider: provider(async () => result('hello')),
    communications: [{ name: 'direct', send: async () => { sends++; throw new CommunicationsError('transport_lost', 'uncertain'); } }] });
  try {
    const task = await runtime.submit(message('a')); await runtime.runUntilIdle();
    assert.equal(runtime.status(task.id)?.error, 'effect_reconciliation_required');
    assert.equal(store.listEffects(task.id)[0]?.state, 'unknown');
    assert.throws(() => runtime.retry(task.id), /reconcil/i);
    await runtime.runUntilIdle(); assert.equal(sends, 1);
  } finally { await runtime.stop(); store.close(); }
});

test('shutdown during uncertain delivery checkpoints reconciliation instead of retrying', async () => {
  const store = new Store(':memory:');
  let started!: () => void; let rejectDelivery!: () => void;
  const begun = new Promise<void>(r => { started = r; });
  const failed = new Promise<void>((_, reject) => { rejectDelivery = () => reject(new CommunicationsError('lost', 'uncertain')); });
  const runtime = new AgentRuntime({ store, provider: provider(async () => result('answer')),
    communications: [{ name: 'direct', send: async () => { started(); await failed; } }] });
  try {
    const task = await runtime.submit(message('shutdown'));
    const drain = runtime.runUntilIdle(); await begun;
    const stopping = runtime.stop(); rejectDelivery();
    await assert.doesNotReject(Promise.all([drain, stopping]));
    assert.equal(store.task(task.id)?.state, 'waiting_for_provider');
    assert.equal(store.task(task.id)?.error, 'effect_reconciliation_required');
  } finally { await runtime.stop().catch(() => {}); store.close(); }
});
