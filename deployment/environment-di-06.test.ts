import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identity, validatePhysicalRequest, type JsonValue, type PhysicalRequest, type ShellBridge, type ShellCheckpoint, type ShellInput } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { createTestShell } from '../packages/agent-shell/tool-instructions.test-fixture.ts';
import { createMistralTransport, emptyUsage, mistralModel, type AttemptOutcome, type MistralTransportOptions } from '../packages/agent-shell/mistral.ts';
import { createOpenAITransport, openaiModel } from '../packages/agent-shell/openai.ts';
import { captureShellClock, shellTimeout, type ShellEnvironment } from '../packages/agent-shell/environment.ts';
import { AssistantMessageEventStream, EventStream } from '../packages/agent-shell/vendor/pi/ai/utils/event-stream.ts';
import { createAssistantMessageDiagnostic } from '../packages/agent-shell/vendor/pi/ai/utils/diagnostics.ts';
import { agentLoopContinue, runToolCall } from '../packages/agent-shell/vendor/pi/agent/agent-loop.ts';
import { normalizeContext } from '../packages/agent-shell/vendor/pi/ai/index.ts';
import type { AssistantMessage, Message } from '../packages/agent-shell/vendor/pi/ai/types.ts';

function environment(prefix = 'one') {
  const state = { wall: 10_000, mono: 10, next: 0, clockFailure: undefined as { value: unknown } | undefined, cancelFailure: undefined as { value: unknown } | undefined };
  const timers: { delay: number; fire(): void; cancelled: number }[] = [];
  const ports: ShellEnvironment = { wallNow: () => state.wall, monotonicNow: () => { if (state.clockFailure) throw state.clockFailure.value; return state.mono; }, newId: () => `${prefix}:${++state.next}`, scheduleTimeout(delay, fire) { const timer = { delay, fire, cancelled: 0 }; timers.push(timer); return () => { timer.cancelled++; if (state.cancelFailure) throw state.cancelFailure.value; }; } };
  return { state, ports, timers };
}
const context = normalizeContext({ messages: [{ role: 'user', content: 'Investigate.', timestamp: 0 }] });
function assistant(timestamp: number): AssistantMessage { return { role: 'assistant', api: 'mistral-chat-completions', provider: 'mistral', model: 'fixture', content: [{ type: 'text', text: 'Observed.' }], usage: emptyUsage(), stopReason: 'stop', timestamp }; }
function response(provider: 'mistral' | 'openai', tool = false): Response {
  return provider === 'mistral' ? Response.json({ choices: [{ finish_reason: tool ? 'tool_calls' : 'stop', message: { content: tool ? null : 'Observed.', ...(tool ? { tool_calls: [{ id: 'call1', function: { name: 'inspect', arguments: '{}' } }] } : {}) } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }) : Response.json({ id: 'resp1', model: 'fixture', status: 'completed', output: [{ id: 'msg1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Observed.' }] }], usage: { input_tokens: 5, output_tokens: 3 } });
}
function transportFixture(provider: 'mistral' | 'openai', env: ReturnType<typeof environment>, overrides: Partial<MistralTransportOptions> = {}) {
  const reserved: string[] = [], settled: AttemptOutcome[] = []; let dispatches = 0;
  const options: MistralTransportOptions = { apiKey: () => 'synthetic', maxRequests: 3, maxRetries: 1, environment: env.ports, reserve: async request => { reserved.push(request.id); }, dispatched: async () => { dispatches++; }, settle: async (_request, outcome) => { settled.push(structuredClone(outcome)); }, fetch: async () => { env.state.mono += 25; return response(provider); }, ...overrides };
  const transport = (provider === 'mistral' ? createMistralTransport : createOpenAITransport)(options);
  const model = provider === 'mistral' ? mistralModel('fixture') : openaiModel('fixture');
  return { options, transport, reserved, settled, dispatches: () => dispatches, run: async (signal?: AbortSignal) => (await transport.stream(model, context, { signal })).result() };
}

for (const provider of ['mistral', 'openai'] as const) {
  test(`DI06 ${provider}: captured clocks, IDs, rotating key and transport are instance local`, async () => {
    const a = environment('a'), b = environment('b'); b.state.wall = 25_000; let key = 'old', observed = '';
    const f = transportFixture(provider, a, { apiKey: () => key, fetch: async (_url, init) => { observed = String((init?.headers as Record<string, string>).Authorization); a.state.mono += 25; return response(provider); } });
    const g = transportFixture(provider, b);
    f.options.fetch = async () => { throw Error('mutated fetch'); }; f.options.apiKey = () => { throw Error('mutated key'); };
    a.ports.wallNow = a.ports.monotonicNow = () => { throw Error('mutated clock'); }; a.ports.newId = () => 'mutated'; a.ports.scheduleTimeout = () => { throw Error('mutated timer'); }; key = 'rotated';
    const [x, y] = await Promise.all([f.run(), g.run()]);
    assert.equal(x.timestamp, 10_000); assert.equal(y.timestamp, 25_000); assert.equal(x.durationMs, 25); assert.equal(y.durationMs, 25);
    assert.equal(observed, 'Bearer rotated'); assert.deepEqual(f.reserved, ['a:1']); assert.deepEqual(g.reserved, ['b:1']);
    assert.equal(a.timers[0]!.cancelled, 1); assert.equal(b.timers[0]!.cancelled, 1);
  });
  test(`DI06 ${provider}: 429 disposes each body and reserves each retry separately`, async () => {
    const env = environment(); let calls = 0, cancels = 0;
    const f = transportFixture(provider, env, { fetch: async () => ++calls === 1 ? new Response(new ReadableStream({ cancel() { cancels++; } }), { status: 429 }) : response(provider) });
    assert.equal((await f.run()).stopReason, 'stop'); assert.deepEqual(f.reserved, ['one:1', 'one:2']); assert.deepEqual(f.settled.map(x => x.status), ['failed', 'completed']);
    assert.equal(cancels, 1); assert.deepEqual(env.timers.map(x => x.cancelled), [1, 1]);
  });
  test(`DI06 ${provider}: cleanup failure after response keeps uncertainty and forbids retry`, async () => {
    const env = environment(); env.state.cancelFailure = { value: undefined }; let calls = 0;
    const f = transportFixture(provider, env, { fetch: async () => { calls++; return response(provider); } });
    assert.equal((await f.run()).stopReason, 'error'); assert.equal(calls, 1); assert.deepEqual(f.settled, [{ status: 'uncertain', httpStatus: 200 }]); assert.equal(env.timers[0]!.cancelled, 1);
  });
  test(`DI06 ${provider}: manual timeout and late response dispose body and settle once`, async () => {
    const env = environment(); let cancel = 0;
    const f = transportFixture(provider, env, { fetch: async () => { env.timers[0]!.fire(); return new Response(new ReadableStream({ cancel() { cancel++; } })); } });
    assert.equal((await f.run()).stopReason, 'error'); assert.equal(cancel, 1); assert.equal(f.settled[0]!.status, 'uncertain'); assert.equal(f.dispatches(), 1); assert.equal(env.timers[0]!.cancelled, 1);
  });
  test(`DI06 ${provider}: timeout setup failure remains undispatched and known cancelled`, async () => {
    const env = environment(); env.ports.scheduleTimeout = () => { throw Error('setup'); };
    const f = transportFixture(provider, env);
    assert.equal((await f.run()).stopReason, 'error'); assert.equal(f.dispatches(), 0); assert.deepEqual(f.settled, [{ status: 'cancelled' }]); assert.equal(env.timers.length, 0);
  });
  test(`DI06 ${provider}: repeated request ID cannot reuse a reservation`, async () => {
    const env = environment(); env.ports.newId = () => 'same'; const f = transportFixture(provider, env, { fetch: async () => new Response('', { status: 429 }) });
    assert.equal((await f.run()).stopReason, 'error'); assert.deepEqual(f.reserved, ['same']); assert.equal(f.dispatches(), 1); assert.equal(f.settled.length, 1);
  });
  test(`DI06 ${provider}: end clock failure terminates both stream consumers`, async () => {
    const env = environment(); const error = { failedClock: true };
    const f = transportFixture(provider, env, { fetch: async () => { env.state.clockFailure = { value: error }; return response(provider); } });
    const events = await f.transport.stream(provider === 'mistral' ? mistralModel('fixture') : openaiModel('fixture'), context);
    const results = await Promise.allSettled([events.result(), (async () => { for await (const _event of events) { /* observe terminal channel */ } })()]);
    assert.ok(results.every(item => item.status === 'rejected' && item.reason === error)); assert.equal(f.settled.length, 1); assert.equal(env.timers[0]!.cancelled, 1);
  });
}

test('DI06 event stream failure preserves falsy thrown values and wakes every pending iterator', async () => {
  const stream = new EventStream<number, number>(() => false, value => value);
  const first = stream[Symbol.asyncIterator]().next(), second = stream[Symbol.asyncIterator]().next(), result = stream.result(); stream.fail(undefined);
  const settled = await Promise.allSettled([first, second, result]); assert.ok(settled.every(item => item.status === 'rejected' && item.reason === undefined));
});
test('DI06 assistant end failure rejects result and iterator without fabricating duration', async () => {
  const env = environment(), stream = new AssistantMessageEventStream(env.ports), answer = assistant(env.state.wall);
  env.state.mono = 9;
  assert.throws(() => stream.end(answer), /regressed/);
  await assert.rejects(stream.result(), /regressed/); await assert.rejects(stream[Symbol.asyncIterator]().next(), /regressed/); assert.equal(answer.durationMs, undefined);
});
test('DI06 forwarded assistant response remains untimed under explicit wall clock', async () => {
  const env = environment(), stream = new AssistantMessageEventStream(env.ports), answer = assistant(env.state.wall - 1); env.state.clockFailure = { value: Error('must not sample deferred duration') };
  stream.end(answer); assert.equal((await stream.result()).durationMs, undefined);
});
test('DI06 clocks reject invalid readings and diagnostics use explicit time', () => {
  for (const value of [NaN, Infinity, -1]) assert.throws(() => captureShellClock({ wallNow: () => 1, monotonicNow: () => value }).monotonicNow(), /unavailable/);
  assert.throws(() => captureShellClock({ wallNow: () => NaN, monotonicNow: () => 0 }).wallNow(), /unavailable/);
  assert.equal(createAssistantMessageDiagnostic('fixture', null, undefined, () => 4321).timestamp, 4321);
  assert.throws(() => createAssistantMessageDiagnostic('fixture', null, undefined, () => NaN), /unavailable/);
});
test('DI06 timeout cancellation detaches parent and ignores stale scheduled callbacks', () => {
  const env = environment(), parent = new AbortController(), timeout = shellTimeout(env.ports.scheduleTimeout, 50, parent.signal);
  timeout.cancel(); timeout.cancel(); parent.abort(); env.timers[0]!.fire(); assert.equal(timeout.signal.aborted, false); assert.equal(env.timers[0]!.cancelled, 1);
});
test('DI06 low-level loop without an explicit provider terminates without global fallback', async () => {
  const env = environment(); const stream = agentLoopContinue({ messages: [{ role: 'user', content: 'x', timestamp: 0 }], tools: [] }, { model: mistralModel(), convertToLlm: messages => messages, clock: env.ports }, undefined, undefined as never);
  await assert.rejects(stream.result(), /explicitly/); await assert.rejects(async () => { for await (const _event of stream) { /* drain */ } }, /explicitly/);
});
test('DI06 tool timing failure drains updates and preserves operation plus timing errors', async () => {
  const env = environment(), original = { original: true }, timing = { timing: true }; let finish!: () => void, notify!: () => void, executions = 0;
  const update = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { notify = resolve; });
  const pending = runToolCall({ type: 'toolCall', id: 't1', name: 'inspect', arguments: {} }, { clock: env.ports, assistantMessage: assistant(1), context: { messages: [], tools: [] }, tools: [{ name: 'inspect', label: 'inspect', description: 'inspect', parameters: { type: 'object' }, execute: async (_id, _args, _signal, onUpdate) => { executions++; onUpdate?.({ content: [], details: null }); env.state.clockFailure = { value: timing }; notify(); throw original; } }], onUpdate: () => update });
  let ended = false; void pending.then(() => { ended = true; }, () => { ended = true; }); await started; await Promise.resolve(); assert.equal(ended, false); finish();
  await assert.rejects(pending, error => error instanceof AggregateError && error.errors[0] === original && error.errors[1] === timing && error.cause === original); assert.equal(executions, 1);
});

function shellFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-di06-')), store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const ledger = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 50 }, () => 1_000);
  ledger.allocate('run', { maxRequests: 10, maxTokens: 1_000, maxCostUsd: 10, maxElapsedMs: 1_000, maxConcurrency: 5 });
  const artifacts = new Map<string, JsonValue>(), requests: PhysicalRequest[] = [], calls: string[] = [];
  const bridge: ShellBridge = {
    async capturePrompt() {}, async reserve(request) { ledger.reserve(request); }, async dispatched(request) { ledger.dispatched(request); }, async settle(request) { validatePhysicalRequest(request); requests.push(request); ledger.settle(request); },
    async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); artifacts.set(sha256, structuredClone(content)); return { runId, revision, shell, artifact: { uri: `aeon:artifact:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; },
    async execute(call) { calls.push(call.id); return { id: `obs:${call.id}`, runId: call.runId, stepId: call.stepId, sourceId: call.id, kind: 'result', value: 'Observed.', provenance: { sourceIds: [call.id], actorId: 'fixture', recordedAt: '2026-10-12T00:00:00Z', derivation: 'observed' } }; },
  };
  const input: ShellInput = { run: { id: 'run', status: 'running', revision: 0, authority: { generation: 'g1', epoch: 1, controlRevision: 'c1' }, scope: { kind: 'public' } }, messages: [{ role: 'user', content: 'inspect', timestamp: 1 }], prompt: { id: 'p1', fragments: [], requestDigest: identity('pending') } };
  return { store, ledger, artifacts, requests, calls, bridge, input, snapshot: (checkpoint: ShellCheckpoint) => artifacts.get(checkpoint.artifact.sha256) as unknown as { messages: (Message & { aeonStepId?: string })[] } };
}
for (const fault of [NaN, 1, undefined] as const) test(`DI06 shell: postdispatch clock ${String(fault)} keeps original full reservation`, async t => {
  const env = environment(), f = shellFixture(t);
  const shell = createTestShell({ environment: env.ports, tools: [], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => { if (fault === undefined) env.state.clockFailure = { value: undefined }; else env.state.mono = fault; return response('mistral'); } });
  const result = await shell.run(f.input, f.bridge); assert.equal(result.status, 'blocked'); assert.equal(f.requests.length, 1); assert.equal(f.requests[0]!.status, 'uncertain'); assert.equal(f.requests[0]!.usage.inputTokens, null);
  assert.deepEqual(f.ledger.snapshot('run'), { requests: 1, tokens: 100, costUsd: 1, elapsedMs: 50, concurrent: 1, cancelled: false }); assert.equal(env.timers[0]!.cancelled, 1);
});
test('DI06 shell: real loop tools and compaction use injected IDs, timestamps and distinct requests', async t => {
  const env = environment(), f = shellFixture(t); let fetches = 0;
  const instruction = { id: 'summary', owner: 'shell' as const, role: 'system' as const, order: 0, artifact: { uri: 'fixture:summary', sha256: identity('unused') }, scope: { kind: 'public' as const }, replaceable: true, derivedFrom: [] };
  // Plain user history triggers compaction; the supplied fragment has exact retained bytes.
  const { digest } = await import('../packages/agent-shell/mistral.ts'); instruction.artifact.sha256 = digest('Summarize.');
  const shell = createTestShell({ environment: env.ports, tools: [{ name: 'inspect', description: 'inspect', parameters: { type: 'object' } }], resolveFragment: async () => 'Summarize.', apiKey: () => 'fixture', maxRequests: 3, compaction: { thresholdMessages: 6, retainMessages: 2, instruction }, fetch: async () => { env.state.mono += 5; return response('mistral', ++fetches === 2); } });
  const result = await shell.run({ ...f.input, messages: Array.from({ length: 7 }, (_, i) => ({ role: 'user', content: `old${i}`, timestamp: i })) }, f.bridge);
  assert.equal(result.status, 'completed'); assert.deepEqual(f.requests.map(r => r.purpose), ['compaction', 'reasoning', 'reasoning']); assert.equal(f.calls.length, 1);
  const messages = f.snapshot(result.checkpoint!).messages; assert.ok(messages.filter(m => m.role !== 'user').every(m => m.timestamp === env.state.wall));
  assert.equal(messages.filter(m => m.role === 'assistant').length, 2); assert.equal(new Set(f.requests.map(r => r.id)).size, 3); assert.ok(f.calls[0]!.includes(':assistant:one:3:')); assert.deepEqual(env.timers.map(t => t.cancelled), [1, 1, 1]);
});

test('DI06 shell: unavailable start clock refuses before reservation or transport', async t => {
  const env = environment(), f = shellFixture(t); let reads = 0, fetches = 0;
  env.ports.monotonicNow = () => { if (++reads === 2) throw Error('before reservation'); return 10; };
  const shell = createTestShell({ environment: env.ports, tools: [], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => { fetches++; return response('mistral'); } });
  assert.equal((await shell.run(f.input, f.bridge)).status, 'blocked'); assert.equal(fetches, 0); assert.equal(f.store.list('requests').length, 0); assert.equal(env.timers.length, 0);
});
test('DI06 shell: repeated assistant identity cannot overwrite a prior durable step', async t => {
  const env = environment(), f = shellFixture(t), ids = ['request1', 'step1', 'request2', 'step1']; let round = 0;
  env.ports.newId = () => ids.shift()!;
  const shell = createTestShell({ environment: env.ports, tools: [{ name: 'inspect', description: 'inspect', parameters: { type: 'object' } }], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 2, fetch: async () => response('mistral', round++ === 0) });
  const result = await shell.run(f.input, f.bridge); assert.equal(result.status, 'blocked'); assert.equal(f.calls.length, 1); assert.equal(f.requests.length, 2);
  const assistants = f.snapshot(result.checkpoint!).messages.filter(m => m.role === 'assistant'); assert.equal(assistants.length, 1); assert.equal(assistants[0]!.aeonStepId, 'step1');
});
test('DI06 shell: recovery retains original tool identity and timestamps observation with successor clock', async t => {
  const f = shellFixture(t), first = environment('before'), next = environment('after'); next.state.wall = 50_000;
  const tool = { name: 'inspect', description: 'inspect', parameters: { type: 'object' } }; let dispatched = '';
  const broken = { ...f.bridge, execute: async (call: Parameters<ShellBridge['execute']>[0]) => { dispatched = call.id; throw Error('lost effect receipt'); } };
  const one = createTestShell({ environment: first.ports, tools: [tool], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => response('mistral', true) });
  const stopped = await one.run(f.input, broken); assert.equal(stopped.status, 'blocked');
  const two = createTestShell({ environment: next.ports, tools: [tool], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => response('mistral') });
  const resumed = await two.run({ ...f.input, messages: [], checkpoint: stopped.checkpoint }, f.bridge); assert.equal(resumed.status, 'completed'); assert.deepEqual(f.calls, [dispatched]);
  const result = f.snapshot(resumed.checkpoint!).messages.find(m => m.role === 'toolResult')!; assert.equal(result.timestamp, 50_000); assert.equal(result.aeonStepId, 'before:2');
});
test('DI06 parallel retained loop waits for every tool after an observation clock failure', async () => {
  const env = environment(); let releaseFirst!: () => void, releaseSecond!: () => void, bothStarted!: () => void, count = 0;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; }), secondGate = new Promise<void>(resolve => { releaseSecond = resolve; }), started = new Promise<void>(resolve => { bothStarted = resolve; });
  const tools = ['first', 'second'].map((name, index) => ({ name, label: name, description: name, parameters: { type: 'object' }, execute: async () => { if (++count === 2) bothStarted(); await (index === 0 ? firstGate : secondGate); env.state.clockFailure = { value: Error(`clock:${name}`) }; return { content: [], details: null }; } }));
  const loop = agentLoopContinue({ messages: [{ role: 'user', content: 'both', timestamp: 0 }], tools }, { clock: env.ports, model: mistralModel(), convertToLlm: messages => messages, toolExecution: 'parallel' }, undefined, (_model, _context, options) => {
    assert.equal(Object.hasOwn(options!, 'clock'), false);
    const answer: AssistantMessage = { ...assistant(env.state.wall), durationMs: 0, stopReason: 'toolUse', content: tools.map((tool, index) => ({ type: 'toolCall', id: `call${index}`, name: tool.name, arguments: {} })) };
    const stream = new AssistantMessageEventStream({ wallNow: () => env.state.wall, monotonicNow: () => 0 }); stream.push({ type: 'done', reason: 'toolUse', message: answer }); return stream;
  });
  let ended = false; void loop.result().then(() => { ended = true; }, () => { ended = true; }); await started; releaseFirst(); await Promise.resolve(); await Promise.resolve(); assert.equal(ended, false); releaseSecond();
  await assert.rejects(loop.result(), error => error instanceof AggregateError && error.errors.length === 2); assert.equal(count, 2);
});
