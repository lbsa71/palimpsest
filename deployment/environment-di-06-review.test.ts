import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { createMistralTransport, emptyUsage, mistralModel, type AttemptOutcome, type MistralTransportOptions } from '../packages/agent-shell/mistral.ts';
import { createOpenAITransport, openaiModel } from '../packages/agent-shell/openai.ts';
import { readShellJson, type ShellEnvironment } from '../packages/agent-shell/environment.ts';
import { normalizeContext } from '../packages/agent-shell/vendor/pi/ai/index.ts';
import { AssistantMessageEventStream, EventStream } from '../packages/agent-shell/vendor/pi/ai/utils/event-stream.ts';
import { runAgentLoopContinue, runToolCall } from '../packages/agent-shell/vendor/pi/agent/agent-loop.ts';
import type { AssistantMessage } from '../packages/agent-shell/vendor/pi/ai/types.ts';
import { createTestShell } from '../packages/agent-shell/tool-instructions.test-fixture.ts';
import { identity, type JsonValue, type PhysicalRequest, type ShellBridge, type ShellInput } from '../packages/contracts/index.ts';

function gate<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function env() {
  const state = { mono: 10, wall: 1_000, id: 0 };
  const timers: { fire(): void; cancelled: number }[] = [];
  const ports: ShellEnvironment = { wallNow: () => state.wall, monotonicNow: () => state.mono, newId: () => `review:${++state.id}`, scheduleTimeout(_ms, fire) { const timer = { fire, cancelled: 0 }; timers.push(timer); return () => { timer.cancelled++; }; } };
  return { state, ports, timers };
}
const context = normalizeContext({ messages: [{ role: 'user', content: 'Inspect the supplied fixture.', timestamp: 0 }] });
function payload(provider: string) { return provider === 'mistral' ? { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } } : { id: 'response', model: 'fixture', status: 'completed', output: [{ id: 'message', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } }; }
function fixture(provider: 'mistral' | 'openai', overrides: Partial<MistralTransportOptions> = {}) {
  const e = env(), outcomes: AttemptOutcome[] = [], trace: string[] = [];
  const options: MistralTransportOptions = { environment: e.ports, maxRequests: 3, maxRetries: 1, apiKey: () => 'fixture-secret', reserve: async () => { trace.push('reserve'); }, dispatched: async () => { trace.push('dispatch'); }, settle: async (_a, o) => { trace.push('settle'); outcomes.push(structuredClone(o)); }, fetch: async () => Response.json(payload(provider)), ...overrides };
  const transport = (provider === 'mistral' ? createMistralTransport : createOpenAITransport)(options);
  const model = provider === 'mistral' ? mistralModel('fixture') : openaiModel('fixture');
  return { e, outcomes, trace, options, transport, run: async (signal?: AbortSignal) => (await transport.stream(model, context, { signal })).result() };
}
function readerResponse(reader: { read(): Promise<ReadableStreamReadResult<Uint8Array>>; cancel(): Promise<void>; releaseLock(): void }, status = 200): Response {
  return { status, ok: status === 200, body: { getReader: () => reader } } as unknown as Response;
}

for (const provider of ['mistral', 'openai'] as const) {
  test(`DI06 review ${provider}: rejected reader cancellation remains uncertain after dispatch`, async () => {
    const trace: string[] = []; let f!: ReturnType<typeof fixture>;
    f = fixture(provider, { fetch: async () => readerResponse({ async read() { trace.push('read'); throw undefined; }, async cancel() { trace.push('cancel'); throw 'cancel-failure'; }, releaseLock() { trace.push('unlock'); } }) });
    assert.equal((await f.run()).stopReason, 'error'); assert.deepEqual(trace, ['read', 'cancel', 'unlock']);
    assert.equal(f.outcomes.length, 1); assert.equal(f.outcomes[0]!.status, 'uncertain'); assert.equal(f.e.timers[0]!.cancelled, 1);
  });
  test(`DI06 review ${provider}: EOF unlock failure cannot earn known settlement`, async () => {
    let reads = 0, cancels = 0, unlocks = 0;
    const f = fixture(provider, { fetch: async () => readerResponse({ async read() { return reads++ ? { done: true, value: undefined } : { done: false, value: new TextEncoder().encode(JSON.stringify(payload(provider))) }; }, async cancel() { cancels++; }, releaseLock() { unlocks++; throw Error('unlock'); } }) });
    assert.equal((await f.run()).stopReason, 'error'); assert.equal(cancels, 0); assert.equal(unlocks, 1);
    assert.equal(f.outcomes[0]!.status, 'uncertain'); assert.equal(f.e.timers[0]!.cancelled, 1);
  });
  test(`DI06 review ${provider}: asynchronous 429 body drain precedes settlement, rotating key and retry`, async () => {
    const entered = gate(), drain = gate(); const trace: string[] = []; let key = 'one', calls = 0;
    const f = fixture(provider, { apiKey: () => { trace.push(`key:${key}`); return key; }, fetch: async (_url, init) => { trace.push(String((init!.headers as Record<string, string>).Authorization)); if (++calls > 1) return Response.json(payload(provider)); return new Response(new ReadableStream({ async cancel() { trace.push('cancel:start'); entered.resolve(); await drain.promise; trace.push('cancel:end'); } }), { status: 429 }); }, settle: async (_a, o) => { trace.push(`settle:${o.status}`); } });
    const pending = f.run(); await entered.promise; assert.equal(calls, 1); assert.equal(f.e.timers[0]!.cancelled, 0); assert.equal(trace.some(x => x.startsWith('settle')), false);
    key = 'two'; drain.resolve(); assert.equal((await pending).stopReason, 'stop');
    assert.deepEqual(trace, ['key:one', 'Bearer one', 'cancel:start', 'cancel:end', 'settle:failed', 'key:two', 'Bearer two', 'settle:completed']);
  });
  test(`DI06 review ${provider}: settlement rejection prevents retry and preserves captured callback`, async () => {
    let calls = 0, settlements = 0;
    const f = fixture(provider, { fetch: async () => { calls++; return new Response('', { status: 429 }); }, settle: async () => { settlements++; throw 'fixture-secret'; } });
    f.options.settle = async () => { throw Error('mutated'); }; f.options.reserve = async () => { throw Error('mutated'); }; f.options.dispatched = async () => { throw Error('mutated'); };
    const result = await f.run(); assert.equal(result.stopReason, 'error'); assert.equal(calls, 1); assert.equal(settlements, 1); assert.equal(result.errorMessage!.includes('fixture-secret'), false); assert.deepEqual(f.trace, ['reserve', 'dispatch']);
  });
  test(`DI06 review ${provider}: parent abort after reserve prevents timer and dispatch`, async () => {
    const controller = new AbortController(); let reservations = 0;
    const f = fixture(provider, { reserve: async () => { reservations++; controller.abort('caller'); } });
    assert.equal((await f.run(controller.signal)).stopReason, 'aborted'); assert.equal(reservations, 1); assert.deepEqual(f.outcomes, [{ status: 'cancelled' }]); assert.equal(f.e.timers.length, 0); assert.equal(f.transport.attempts(), 0);
  });
  test(`DI06 review ${provider}: ID supplier failure cannot reserve or schedule work`, async () => {
    const e = env(); e.ports.newId = () => { throw undefined; }; const f = fixture(provider, { environment: e.ports });
    assert.equal((await f.run()).stopReason, 'error'); assert.deepEqual(f.trace, []); assert.equal(e.timers.length, 0);
  });
}

test('DI06 review JSON reader preserves operation/cancel/unlock identity and waits for cleanup', async () => {
  const entered = gate(), drain = gate(); const original = {}, cleanup = {}, unlock = {};
  const pending = readShellJson(readerResponse({ async read() { throw original; }, async cancel() { entered.resolve(); await drain.promise; throw cleanup; }, releaseLock() { throw unlock; } }), new AbortController().signal);
  let ended = false; void pending.catch(() => { ended = true; }); await entered.promise; assert.equal(ended, false); drain.resolve();
  await assert.rejects(pending, e => e instanceof AggregateError && e.cause === original && e.errors[0] === original && e.errors[1] === cleanup && e.errors[2] === unlock);
});
test('DI06 review failed reader acquisition attempts body cancellation once', async () => {
  let cancelled = 0; const error = {};
  const response = { body: { getReader() { throw error; }, async cancel() { cancelled++; } } } as unknown as Response;
  await assert.rejects(readShellJson(response, new AbortController().signal), e => e === error); assert.equal(cancelled, 1);
});
test('DI06 review terminal failure survives later end and ignores subsequent completion', async () => {
  const stream = new EventStream<number, number>(x => x === 1, x => x); const error = {};
  stream.push(0); stream.fail(error); stream.end(3); stream.push(1);
  await assert.rejects(stream.result(), e => e === error); const iterator = stream[Symbol.asyncIterator](); assert.deepEqual(await iterator.next(), { done: false, value: 0 }); await assert.rejects(iterator.next(), e => e === error);
});
function assistant(): AssistantMessage { return { role: 'assistant', api: 'fixture', provider: 'fixture', model: 'fixture', content: [], usage: emptyUsage(), stopReason: 'toolUse', timestamp: 1_000, durationMs: 0 }; }
test('DI06 review tool operation plus timing plus pending update failures retain all values', async () => {
  const e = env(), entered = gate(), drain = gate(), operation = {}, update = {}; let executions = 0;
  const pending = runToolCall({ type: 'toolCall', id: 'call', name: 'inspect', arguments: {} }, { clock: e.ports, assistantMessage: assistant(), context: { messages: [], tools: [] }, tools: [{ name: 'inspect', label: 'inspect', description: '', parameters: { type: 'object' }, async execute(_id, _args, _signal, onUpdate) { executions++; onUpdate!({ content: [], details: null }); e.state.mono = 9; throw operation; } }], async onUpdate() { entered.resolve(); await drain.promise; throw update; } });
  let ended = false; void pending.catch(() => { ended = true; }); await entered.promise; await Promise.resolve(); assert.equal(ended, false); drain.resolve();
  await assert.rejects(pending, error => error instanceof AggregateError && error.errors[0] === operation && /regressed/.test(error.errors[1].message) && error.errors[2] === update); assert.equal(executions, 1);
});
test('DI06 review parallel loop drains delayed peer after event receiver failure', async () => {
  const e = env(), entered = gate(), drain = gate(); let executions = 0;
  const tools = ['first', 'second'].map(name => ({ name, label: name, description: '', parameters: { type: 'object' }, async execute() { executions++; if (name === 'second') { entered.resolve(); await drain.promise; } return { content: [], details: null }; } }));
  const failure = {};
  const pending = runAgentLoopContinue({ messages: [{ role: 'user', content: 'both', timestamp: 0 }], tools }, { clock: e.ports, model: mistralModel(), convertToLlm: x => x, toolExecution: 'parallel' }, async event => { if (event.type === 'tool_execution_end' && event.toolName === 'first') throw failure; }, undefined, () => {
    const stream = new AssistantMessageEventStream(e.ports); stream.push({ type: 'done', reason: 'toolUse', message: { ...assistant(), content: tools.map(t => ({ type: 'toolCall', id: t.name, name: t.name, arguments: {} })) } }); return stream;
  });
  let ended = false; void pending.catch(() => { ended = true; }); await entered.promise; await Promise.resolve(); assert.equal(ended, false); drain.resolve();
  await assert.rejects(pending, e => e === failure); assert.equal(executions, 2);
});

function memoryBridge() {
  const artifacts = new Map<string, JsonValue>(), settled: PhysicalRequest[] = [];
  const bridge: ShellBridge = { async capturePrompt() {}, async reserve() {}, async dispatched() {}, async settle(request) { settled.push(request); }, async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); artifacts.set(sha256, content); return { runId, revision, shell, artifact: { uri: `aeon:artifact:${sha256}`, sha256 }, observationIds: [] }; }, async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; }, async execute() { throw Error('no tools'); } };
  const input: ShellInput = { run: { id: 'run', status: 'running', revision: 0, authority: { generation: 'g', epoch: 1, controlRevision: 'c' }, scope: { kind: 'public' } }, messages: [{ role: 'user', content: 'fixture', timestamp: 0 }], prompt: { id: 'prompt', fragments: [], requestDigest: identity('pending') } };
  return { bridge, input, settled };
}
test('DI06 review shell captures receiver identity before caller callbacks', async () => {
  const e = env(), f = memoryBridge(); let replacement = 0;
  f.bridge.capturePrompt = async () => { f.bridge.settle = async () => { replacement++; }; };
  const shell = createTestShell({ environment: e.ports, tools: [], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => Response.json(payload('mistral')) });
  assert.equal((await shell.run(f.input, f.bridge)).status, 'completed'); assert.equal(replacement, 0); assert.equal(f.settled.length, 1);
});
test('DI06 review unused final wall clock is not read or fabricated', async () => {
  const e = env(), f = memoryBridge(); let calls = 0;
  const shell = createTestShell({ environment: e.ports, tools: [], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => { calls++; e.state.wall = NaN; return Response.json(payload('mistral')); } });
  // No new wall timestamp is required for a completed text-only response; existing timestamp remains truthful.
  const result = await shell.run(f.input, f.bridge); assert.equal(result.status, 'completed'); assert.equal(calls, 1); assert.equal(f.settled.length, 1);
});

test('DI06 review OpenAI cleanup uncertainty preserves actual ledger elapsed ceiling and concurrency', async t => {
  const root = mkdtempSync(join(tmpdir(), 'di06-review-ledger-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const ledger = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 50 }, () => 1000);
  ledger.allocate('run', { maxRequests: 2, maxTokens: 200, maxCostUsd: 2, maxElapsedMs: 100, maxConcurrency: 1 });
  const f = memoryBridge(), e = env();
  f.bridge.reserve = async request => { ledger.reserve(request); };
  f.bridge.dispatched = async request => { ledger.dispatched(request); };
  f.bridge.settle = async request => { f.settled.push(request); ledger.settle(request); };
  const shell = createTestShell({ provider: 'openai', model: 'fixture', environment: e.ports, tools: [], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => readerResponse({ async read() { throw Error('incomplete response'); }, async cancel() { throw undefined; }, releaseLock() {} }) });
  assert.equal((await shell.run(f.input, f.bridge)).status, 'blocked');
  assert.deepEqual(ledger.snapshot('run'), { requests: 1, tokens: 100, costUsd: 1, elapsedMs: 50, concurrent: 1, cancelled: false });
});
test('DI06 review shell initial invalid wall time refuses physical reservation', async () => {
  const f = memoryBridge(), e = env(); e.state.wall = Infinity; let reserves = 0, fetches = 0;
  f.bridge.reserve = async () => { reserves++; };
  const shell = createTestShell({ environment: e.ports, tools: [], resolveFragment: async () => '', apiKey: () => 'fixture', maxRequests: 1, fetch: async () => { fetches++; return Response.json(payload('mistral')); } });
  assert.equal((await shell.run(f.input, f.bridge)).status, 'blocked'); assert.equal(reserves, 0); assert.equal(fetches, 0); assert.equal(e.timers.length, 0);
});
