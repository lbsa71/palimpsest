import { createTestShell } from './tool-instructions.test-fixture.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identity, validateCapturedPrompt, validatePhysicalRequest } from '../contracts/index.ts';
import type { JsonValue, Observation, PhysicalRequest, PromptFragment, PromptManifest, ShellBridge, ShellCheckpoint, ShellInput, ToolCall } from '../contracts/index.ts';
import { SHELL_REVISION } from './index.ts';
import { createMistralTransport, digest, mistralModel } from './mistral.ts';
import { normalizeContext } from './vendor/pi/ai/index.ts';

const fragment = (id: string, content: string, order = 0): PromptFragment => ({ id, owner: 'self', role: 'system', order, artifact: { uri: `fixture:${id}`, sha256: digest(content) }, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] });
const base = fragment('identity', 'I choose my own judgments.');
const prompt: PromptManifest = { id: 'p1', fragments: [base], requestDigest: digest('not dispatched') };
const input = (content = 'complete task'): ShellInput => ({ run: { id: 'run1', status: 'running', revision: 0, authority: { generation: 'g1', epoch: 1, controlRevision: 'c1' }, scope: { kind: 'public' } }, messages: [{ role: 'user', content, timestamp: 1 }], prompt });
const tool = { name: 'edit', description: 'Edit an owned file', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } };
function response(content: string | null, calls: unknown[] = [], finish = calls.length ? 'tool_calls' : 'stop'): Response { return Response.json({ id: 'provider1', model: 'fixture', choices: [{ finish_reason: finish, message: { content, ...(calls.length ? { tool_calls: calls } : {}) } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }); }
function call(value = 'repaired', id = 'call00001'): unknown { return { id, type: 'function', function: { name: 'edit', arguments: JSON.stringify({ value }) } }; }
function fixture() {
  const artifacts = new Map<string, JsonValue>(); const requests = new Map<string, PhysicalRequest>();
  const manifests: { manifest: PromptManifest; payload: string }[] = []; const events: string[] = []; const tools: ToolCall[] = [];
  let receiver: (call: ToolCall) => Promise<Observation> = async request => ({ id: `obs:${request.id}`, runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: 'result', value: 'observed', provenance: { sourceIds: [request.id], actorId: 'fixture-tool', recordedAt: new Date().toISOString(), derivation: 'observed' } });
  const bridge: ShellBridge = {
    async execute(request) { tools.push(request); events.push('tool'); return receiver(request); },
    async persistCheckpoint(runId, revision, shell, content) {
      const sha256 = identity(content); artifacts.set(sha256, structuredClone(content)); events.push('checkpoint');
      return { runId, revision, shell, artifact: { uri: `fixture:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds };
    },
    async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; },
    async capturePrompt(manifest, payload) { validateCapturedPrompt(manifest, payload); manifests.push({ manifest, payload }); events.push('capture'); },
    async reserve(request) { validatePhysicalRequest(request); assert.equal(request.status, 'reserved'); requests.set(request.id, request); events.push('reserve'); },
    async dispatched(request) { assert.equal(requests.get(request.id)?.status, 'reserved'); requests.set(request.id, request); events.push('dispatch'); },
    async settle(request) { validatePhysicalRequest(request); requests.set(request.id, request); events.push('settle'); },
  };
  return { bridge, artifacts, requests, manifests, events, tools, setReceiver(value: typeof receiver) { receiver = value; } };
}
const resolveFragment = async (value: PromptFragment) => value.id === 'identity' ? 'I choose my own judgments.' : 'Summarize observed task state and uncertainties.';

test('real Pi loop observes tool failure, repairs it, verifies and completes with owned final payloads', async () => {
  const f = fixture(); let round = 0;
  f.setReceiver(async request => ({ id: `obs:${request.id}`, runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: f.tools.length === 1 ? 'error' : 'result', value: f.tools.length === 1 ? 'test failed' : 'test passed', provenance: { sourceIds: [request.id], actorId: 'fixture', recordedAt: new Date().toISOString(), derivation: 'observed' } }));
  const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'fixture-key', maxRequests: 3, fetch: async (_url, init) => {
    assert.equal(f.events.at(-1), 'dispatch'); const body = JSON.parse(String(init?.body));
    assert.equal(body.messages[0].content, 'I choose my own judgments.');
    if (round === 1) assert.match(body.messages.at(-1).content, /test failed/);
    if (round === 2) assert.match(body.messages.at(-1).content, /test passed/);
    return round++ < 2 ? response(null, [call('fix', `call0000${round}`)]) : response('verified');
  } });
  const result = await shell.run(input(), f.bridge);
  assert.equal(result.status, 'completed'); assert.equal(f.tools.length, 2); assert.equal(f.requests.size, 3);
  assert.ok([...f.requests.values()].every(request => request.status === 'succeeded' && request.usage.inputTokens === 12 && request.usage.costUsd === null));
  assert.equal(result.observations.length, 2);
  assert.ok(f.manifests.every(record => !record.payload.includes('fixture-key')));
  assert.equal(f.events[f.events.indexOf('tool') - 1], 'checkpoint');
});

test('physical 429 retry receives its own reservation; uncertain network failure is never retried', async () => {
  const seen: string[] = []; const outcomes: string[] = []; let count = 0;
  const transport = createMistralTransport({ apiKey: () => 'secret', maxRequests: 3, maxRetries: 2, reserve: async attempt => { seen.push(attempt.id); }, dispatched: async () => {}, settle: async (_attempt, outcome) => { outcomes.push(outcome.status); }, fetch: async () => ++count === 1 ? new Response('', { status: 429 }) : response('ok') });
  const context = normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 0 }] });
  assert.equal((await (await transport.stream(mistralModel(), context)).result()).stopReason, 'stop');
  assert.equal(new Set(seen).size, 2); assert.deepEqual(outcomes, ['failed', 'completed']);
  const uncertain = createMistralTransport({ apiKey: () => 'secret', maxRequests: 3, maxRetries: 2, reserve: async () => {}, dispatched: async () => {}, settle: async (_attempt, outcome) => { assert.equal(outcome.status, 'uncertain'); }, fetch: async () => { throw new Error('secret credential in network exception'); } });
  const error = await (await uncertain.stream(mistralModel(), context)).result();
  assert.equal(error.stopReason, 'error'); assert.equal(uncertain.attempts(), 1); assert.ok(!error.errorMessage!.includes('secret'));
});

test('reservation and dispatch-fence failure prevents fetch; physical request limit blocks continuation', async () => {
  let dispatched = 0;
  for (const phase of ['reserve', 'dispatch']) {
    const transport = createMistralTransport({ apiKey: () => 'key', maxRequests: 1, reserve: async () => { if (phase === 'reserve') throw Error('denied'); }, dispatched: async () => { if (phase === 'dispatch') throw Error('denied'); }, settle: async () => {}, fetch: async () => { dispatched++; return response('wrong'); } });
    assert.equal((await (await transport.stream(mistralModel(), normalizeContext({ messages: [] }))).result()).stopReason, 'error');
  }
  assert.equal(dispatched, 0);
  const f = fixture(); const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'key', maxRequests: 1, fetch: async () => response(null, [call()]) });
  assert.equal((await shell.run(input(), f.bridge)).status, 'blocked'); assert.equal(f.requests.size, 1);
});

test('cancel propagates to fetch and accounts ambiguous dispatched outcome', async () => {
  const f = fixture(); const abort = new AbortController();
  const shell = createTestShell({ resolveFragment, tools: [], apiKey: () => 'key', maxRequests: 2, fetch: async (_url, init) => { abort.abort(); init!.signal!.throwIfAborted(); return response('wrong'); } });
  assert.equal((await shell.run(input(), f.bridge, abort.signal)).status, 'cancelled');
  assert.equal([...f.requests.values()][0].status, 'uncertain'); assert.equal(f.tools.length, 0);
});

test('pending effect is reconciled on restart using stable call id and current prompt replacement', async () => {
  const f = fixture(); let applied = 0; let reconciliations = 0; const receipts = new Map<string, Observation>();
  f.setReceiver(async request => {
    const prior = receipts.get(request.id);
    if (prior) { reconciliations++; return prior; }
    applied++;
    const receipt: Observation = { id: `obs:${request.id}`, runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: 'result', value: 'accepted effect', provenance: { sourceIds: [request.id], actorId: 'receiver', recordedAt: new Date().toISOString(), derivation: 'observed' } };
    receipts.set(request.id, receipt); throw Error('simulated crash after external acceptance');
  });
  const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'key', maxRequests: 2, fetch: async () => response(null, [call()]) });
  const first = await shell.run(input(), f.bridge); assert.equal(first.status, 'blocked');
  const next = createTestShell({ resolveFragment: async () => 'A completely replaced identity.', tools: [tool], apiKey: () => 'key', maxRequests: 1, fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); assert.equal(body.messages[0].content, 'A completely replaced identity.'); assert.ok(!String(init?.body).includes('I choose my own judgments.')); assert.match(body.messages.at(-1).content, /accepted effect/); return response('finished'); } });
  const resumed = await next.run({ ...input(), messages: [], prompt: { ...prompt, fragments: [fragment('new-self', 'A completely replaced identity.')] }, checkpoint: first.checkpoint }, f.bridge);
  assert.equal(resumed.status, 'completed'); assert.equal(applied, 1); assert.equal(reconciliations, 1); assert.equal(f.tools[0].id, f.tools[1].id);
});

test('uncertain effect blocks further tool dispatch and remains pending for reconciliation', async () => {
  const f = fixture(); f.setReceiver(async request => ({ id: 'unknown', runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: 'uncertain', value: 'unknown', provenance: { sourceIds: [request.id], actorId: 'fixture', recordedAt: new Date().toISOString(), derivation: 'observed' } }));
  const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'key', maxRequests: 2, fetch: async () => response(null, [call('a', 'call00001'), call('b', 'call00002')]) });
  const result = await shell.run(input(), f.bridge); assert.equal(result.status, 'blocked'); assert.equal(f.tools.length, 1); assert.equal(f.requests.size, 1);
  const snapshot = await f.bridge.readCheckpoint(result.checkpoint!); assert.equal((snapshot as { messages: { role: string }[] }).messages.filter(item => item.role === 'toolResult').length, 0);
});

test('provider tool IDs reused across turns remain distinct durable effects on restart', async () => {
  const f = fixture(); let rounds = 0; const receipts = new Map<string, Observation>(); let effects = 0;
  f.setReceiver(async request => {
    if (receipts.has(request.id)) return receipts.get(request.id)!;
    effects++;
    const receipt: Observation = { id: `obs:${request.id}`, runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: 'result', value: effects, provenance: { sourceIds: [request.id], actorId: 'fixture', recordedAt: new Date().toISOString(), derivation: 'observed' } };
    receipts.set(request.id, receipt);
    if (effects === 2) throw Error('secret simulated crash');
    return receipt;
  });
  const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'key', maxRequests: 3, fetch: async () => ++rounds <= 2 ? response(null, [call('same', 'reused001')]) : response('complete') });
  const first = await shell.run(input(), f.bridge); assert.equal(first.status, 'blocked'); assert.equal(effects, 2);
  const snapshot = await f.bridge.readCheckpoint(first.checkpoint!);
  assert.match((snapshot as unknown as { failure: { reason: string } }).failure.reason, /receiver failed/);
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
  const resumed = await shell.run({ ...input(), messages: [], checkpoint: first.checkpoint }, f.bridge);
  assert.equal(resumed.status, 'completed'); assert.equal(effects, 2); assert.equal(f.tools.length, 3);
  assert.notEqual(f.tools[0].id, f.tools[1].id); assert.equal(f.tools[1].id, f.tools[2].id);
});

test('context reduction uses the same counted transport and preserves paired observations', async () => {
  const f = fixture(); let calls = 0;
  const compaction = { thresholdMessages: 6, retainMessages: 2, instruction: fragment('summary', 'Summarize observed task state and uncertainties.', 1) };
  const shell = createTestShell({ resolveFragment, tools: [], apiKey: () => 'key', maxRequests: 2, compaction, fetch: async () => calls++ === 0 ? response('retained verified task facts') : response('complete') });
  const history: JsonValue[] = Array.from({ length: 8 }, (_value, index) => ({ role: 'user', content: `fact${index}`, timestamp: index }));
  const result = await shell.run({ ...input(), messages: history }, f.bridge);
  assert.equal(result.status, 'completed'); assert.deepEqual([...f.requests.values()].map(request => request.purpose), ['compaction', 'reasoning']);
  const final = JSON.parse(f.manifests.at(-1)!.payload); assert.equal(final.messages.length, 4); assert.match(final.messages[1].content, /retained verified/);
  assert.ok(f.manifests[0].manifest.fragments.some(value => value.id === 'summary'));
});

test('explicit reasoning profile preserves complete native thinking chunks through tools and restart', async () => {
  const f = fixture(); const thinking = { type: 'thinking', thinking: [{ type: 'text', text: 'private intermediate reasoning', marker: 'native-inner' }], marker: 'native-outer' };
  const answer = { type: 'text', text: 'visible answer', marker: 'native-text' }; let rounds = 0;
  f.setReceiver(async request => ({ id: `obs:${request.id}`, runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: 'uncertain', value: 'pending', provenance: { sourceIds: [request.id], actorId: 'fixture', recordedAt: new Date().toISOString(), derivation: 'observed' } }));
  const shell = createTestShell({ resolveFragment, tools: [tool], model: 'explicit-reasoning-profile', modelProfile: { contextWindow: 1_000_000, reasoning: true }, reasoningEffort: 'high', apiKey: () => 'key', maxRequests: 2, fetch: async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); assert.equal(payload.reasoning_effort, 'high'); assert.equal(payload.model, 'explicit-reasoning-profile');
    if (rounds++ === 0) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: [thinking, answer], tool_calls: [call()] } }] });
    const assistant = payload.messages.findLast((item: { role: string }) => item.role === 'assistant'); assert.deepEqual(assistant.content, [thinking, answer]);
    return response('complete');
  } });
  const first = await shell.run(input(), f.bridge); assert.equal(first.status, 'blocked');
  const snapshot = await f.bridge.readCheckpoint(first.checkpoint!);
  const assistant = (snapshot as unknown as { messages: { role: string; content: { type: string; thinking?: string }[]; providerThinkingLevel?: string }[] }).messages.find(item => item.role === 'assistant')!;
  assert.equal(assistant.content[0].type, 'thinking'); assert.equal(assistant.content[0].thinking, 'private intermediate reasoning'); assert.equal(assistant.providerThinkingLevel, 'high');
  f.setReceiver(async request => ({ id: `obs:${request.id}`, runId: request.runId, stepId: request.stepId, sourceId: request.id, kind: 'result', value: 'reconciled', provenance: { sourceIds: [request.id], actorId: 'fixture', recordedAt: new Date().toISOString(), derivation: 'observed' } }));
  assert.equal((await shell.run({ ...input(), messages: [], checkpoint: first.checkpoint }, f.bridge)).status, 'completed');
  assert.equal(rounds, 2);
  assert.throws(() => createMistralTransport({ apiKey: () => 'key', maxRequests: 1, reasoningEffort: 'high', reserve: async () => {}, dispatched: async () => {}, settle: async () => {} }), /explicitly capable/);
  assert.equal(mistralModel('unknown').contextWindow, 0);
});

test('reasoning compaction stores native metadata privately and uses only summary text as new context', async () => {
  const f = fixture(); let rounds = 0;
  const shell = createTestShell({ resolveFragment, tools: [], modelProfile: { contextWindow: 1_000_000, reasoning: true }, reasoningEffort: 'high', apiKey: () => 'key', maxRequests: 2, compaction: { thresholdMessages: 6, retainMessages: 2, instruction: fragment('summary', 'Summarize observed task state and uncertainties.', 1) }, fetch: async () => rounds++ === 0 ? Response.json({ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'private summary deliberation' }], marker: 'summary' }, { type: 'text', text: 'retained summary' }] } }] }) : response('done') });
  const result = await shell.run({ ...input(), messages: Array.from({ length: 8 }, (_, index) => ({ role: 'user', content: `fact${index}`, timestamp: index })) }, f.bridge);
  assert.equal(result.status, 'completed');
  const snapshot = await f.bridge.readCheckpoint(result.checkpoint!);
  assert.match(JSON.stringify((snapshot as unknown as { compactions: unknown[] }).compactions), /private summary deliberation/);
  assert.ok(!f.manifests.at(-1)!.payload.includes('private summary deliberation'));
  assert.match(f.manifests.at(-1)!.payload, /retained summary/);
});

test('steering becomes an observed request input before next model request', async () => {
  const f = fixture(); let rounds = 0; let steering = 0;
  const shell = createTestShell({ resolveFragment, tools: [], apiKey: () => 'key', maxRequests: 2, steering: async () => rounds === 1 && steering++ === 0 ? [{ role: 'user', content: 'revise the task', timestamp: 2 }] : [], fetch: async (_url, init) => { if (rounds++ === 1) assert.equal(JSON.parse(String(init?.body)).messages.at(-1).content, 'revise the task'); return response('done'); } });
  assert.equal((await shell.run(input(), f.bridge)).status, 'completed'); assert.equal(rounds, 2);
});

test('checkpoint corruption and cross-run replay fail before dispatch', async () => {
  const f = fixture(); const shell = createTestShell({ resolveFragment, tools: [], apiKey: () => 'key', maxRequests: 1, fetch: async () => response('done') });
  const original = await shell.run(input(), f.bridge); const checkpoint = original.checkpoint!;
  f.artifacts.set(checkpoint.artifact.sha256, { schema: SHELL_REVISION, messages: [], observationIds: [], status: 'completed' });
  await assert.rejects(shell.run({ ...input(), messages: [], checkpoint }, f.bridge), /digest mismatch/);
  await assert.rejects(shell.run({ ...input(), checkpoint: { ...checkpoint, runId: 'foreign' } }, f.bridge), /another run/);
  assert.equal(f.requests.size, 1);
});

test('tool argument validation and length-truncated calls never dispatch an effect', async () => {
  for (const malformed of [true, false]) {
    const f = fixture();
    const invalid = { id: 'call00001', type: 'function', function: { name: 'edit', arguments: '{"extra":true}' } };
    const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'key', maxRequests: 1, fetch: async () => response(null, [malformed ? invalid : call()], malformed ? 'tool_calls' : 'length') });
    await shell.run(input(), f.bridge); assert.equal(f.tools.length, 0);
  }
});

for (const ending of ['error', 'aborted', 'length', 'truncated-tool'] as const) {
  test(`explicit continuation recovers ${ending} without replaying incomplete calls or deleting audit history`, async () => {
    const f = fixture(); const controller = new AbortController(); let calls = 0;
    const shell = createTestShell({ resolveFragment, tools: [tool], apiKey: () => 'key', maxRequests: 3,
      fetch: async () => {
        calls++;
        if (calls > 1) return response('recovered');
        if (ending === 'error') throw new Error('connection lost');
        if (ending === 'aborted') { controller.abort(); throw new Error('aborted'); }
        return response('partial', ending === 'truncated-tool' ? [call()] : [], 'length');
      } });
    const first = await shell.run(input(), f.bridge, controller.signal);
    assert.equal(first.status, ending === 'aborted' ? 'cancelled' : 'blocked');
    assert.equal(calls, 1, 'a failed or truncated turn must not trigger an automatic paid continuation');
    const before = await f.bridge.readCheckpoint(first.checkpoint!) as unknown as { messages: { role: string; stopReason?: string }[] };
    const failed = before.messages.find(item => item.role === 'assistant')!;
    const retainedRequests = structuredClone([...f.requests.values()]);
    const second = await shell.run({ ...input(), messages: [], checkpoint: first.checkpoint }, f.bridge);
    assert.equal(second.status, 'completed'); assert.equal(calls, 2); assert.equal(f.tools.length, 0);
    const after = await f.bridge.readCheckpoint(second.checkpoint!) as unknown as typeof before;
    assert.ok(after.messages.some(item => JSON.stringify(item) === JSON.stringify(failed)), 'failed assistant remains auditable');
    assert.deepEqual([...f.requests.values()].slice(0, 1), retainedRequests, 'explicit continuation does not forgive old request usage');
    const payload = JSON.parse(f.manifests.at(-1)!.payload);
    assert.equal(payload.messages.some((item: { role: string }) => item.role === 'assistant'), false, 'incomplete assistant is excluded from provider projection');
  });
}

test('a final assistant checkpoint interrupted before terminal status resumes without another paid request', async () => {
  const f=fixture();let calls=0;
  const shell=createTestShell({resolveFragment,tools:[],apiKey:()=> 'key',maxRequests:1,fetch:async()=>{calls++;return response('done');}});
  const first=await shell.run(input(),f.bridge);
  const snapshot=await f.bridge.readCheckpoint(first.checkpoint!) as unknown as Record<string,JsonValue>;
  const checkpoint=await f.bridge.persistCheckpoint(input().run.id,input().run.revision,SHELL_REVISION,{...snapshot,status:'running'});
  const resumed=await shell.run({...input(),messages:[],checkpoint},f.bridge);
  assert.equal(resumed.status,'completed');assert.equal(calls,1);
});

test('Responses recovery validates native projection before replaying a pending effect', async () => {
  const f = fixture(); let fetched = 0;
  const shell = createTestShell({ provider: 'openai', model: 'fixture-v1', resolveFragment, tools: [tool], apiKey: () => 'fixture', maxRequests: 1, fetch: async () => { fetched++; throw Error('No fetch expected'); } });
  const snapshot = { schema: SHELL_REVISION, provider: 'openai', status: 'blocked', observationIds: [], compactions: [], messages: [{ role: 'assistant', provider: 'openai', api: 'openai-responses', model: 'fixture-v1', timestamp: 0, aeonStepId: 'pending', stopReason: 'toolUse',
    content: [{ type: 'toolCall', id: 'call_1', name: 'edit', arguments: { value: 'changed-after-checkpoint-upgrade' } }],
    openaiOutput: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'edit', arguments: '{"value":"original-provider-argument"}', status: 'completed' }] }] };
  const checkpoint = await f.bridge.persistCheckpoint(input().run.id, input().run.revision, SHELL_REVISION, snapshot);
  const result = await shell.run({ ...input(), messages: [], checkpoint }, f.bridge);
  assert.equal(result.status, 'blocked'); assert.equal(f.tools.length, 0, 'native/projection mismatch must fail before effect dispatch'); assert.equal(fetched, 0);
});
