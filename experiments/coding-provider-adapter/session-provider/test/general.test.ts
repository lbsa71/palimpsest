import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCodingProvider } from '../facade.ts';
import type { CodingStepInput, CodingToolDefinition, TrustedCodingProviderOptions } from '../facade.ts';

globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
const input: CodingStepInput = { messages: [{ role: 'user', text: 'Inspect, repair and test the fixture' }] };
const read: CodingToolDefinition = { name: 'workspace_read', description: 'Request a bounded workspace file read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, validateArguments: value => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && typeof Reflect.get(value, 'path') === 'string' };
const command: CodingToolDefinition = { name: 'workspace_command', description: 'Request a host-admitted staged command', inputSchema: { type: 'object', properties: { executable: { type: 'string' }, arguments: { type: 'array', items: { type: 'string' } } }, required: ['executable', 'arguments'], additionalProperties: false }, validateArguments: value => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 2 && typeof Reflect.get(value, 'executable') === 'string' && Array.isArray(Reflect.get(value, 'arguments')) && Reflect.get(value, 'arguments').every((part: unknown) => typeof part === 'string') };
const tools = [read, command];
const call = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
function native(calls?: ReturnType<typeof call>[], finish = calls ? 'tool_calls' : 'stop') { return { id: 'frozen-fixture', model: 'caller-model-fixture', created: 1, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: calls ? null : 'Repair verified from host observations', ...(calls ? { tool_calls: calls } : {}) }, finish_reason: finish }], usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }; }
function response(body: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }); }
function fixture(replies: unknown[] = [native()], changes: Partial<TrustedCodingProviderOptions> = {}) {
  let sent = 0, authorized = 0;
  const requests: { body: Record<string, unknown>; init: RequestInit }[] = [], reservations: { model: string; bodyBytes: number; bodySha256: string }[] = [];
  const provider = createCodingProvider({ model: 'caller-model-fixture', apiKey: 'synthetic-caller-key', tools, preauthorize: () => { authorized++; }, reserve: request => { reservations.push(request); }, transport: async (url, init) => {
    assert.equal(String(url), 'https://api.mistral.ai/v1/chat/completions');
    assert.ok(init);
    requests.push({ body: JSON.parse(String(init.body)), init });
    return response(replies[sent++]);
  }, ...changes });
  return { provider, requests, reservations, get sent() { return sent; }, get authorized() { return authorized; } };
}

test('caller model/key and command/read catalog reach real selected SDK native conversion', async () => {
  const rawRead = '{ "path" : "src/fixture.ts" }', rawCommand = '{"executable":"node","arguments":["--test","test/fixture.test.ts"]}';
  const f = fixture([native([call('read00001', read.name, rawRead), call('test00001', command.name, rawCommand)])], { limits: { maxOutputTokens: 123 } });
  const result = await f.provider.step(input);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') assert.fail();
  assert.deepEqual(result.intents, [{ callId: 'read00001', name: read.name, arguments: rawRead }, { callId: 'test00001', name: command.name, arguments: rawCommand }]);
  assert.deepEqual(result.usage, { status: 'known', input: 17, output: 9, total: 26 });
  const request = f.requests[0]!;
  assert.equal(request.body.model, 'caller-model-fixture');
  assert.equal(request.body.max_tokens, 123);
  assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer synthetic-caller-key');
  assert.equal(request.init.redirect, 'error');
  assert.deepEqual((request.body.tools as { function: { name: string; description: string; parameters: unknown } }[]).map(entry => entry.function), tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })));
  assert.equal(f.reservations[0]?.model, 'caller-model-fixture');
  assert.equal(f.reservations[0]?.bodyBytes, Buffer.byteLength(String(request.init.body)));
  assert.equal(f.sent, 1);
});

test('failure/repair transcript continues across independent native steps with raw history preserved', async () => {
  const rawRead = '{ "path" : "src/fixture.ts" }', rawTest = '{ "executable" : "node", "arguments" : ["--test","test/fixture.test.ts"] }';
  const f = fixture([native([call('test00001', command.name, rawTest)]), native([call('read00001', read.name, rawRead)]), native()]);
  const first = await f.provider.step(input); assert.equal(first.status, 'ok'); if (first.status !== 'ok') assert.fail();
  const history: CodingStepInput['messages'] = [...input.messages, { role: 'assistant', text: first.text, intents: first.intents }, { role: 'tool', name: command.name, callId: 'test00001', outcome: { ok: false, kind: 'tool_failed', message: 'Observed exit 1: expected 2, received 1' } }];
  const second = await f.provider.step({ messages: history }); assert.equal(second.status, 'ok'); if (second.status !== 'ok') assert.fail();
  history.push({ role: 'assistant', text: second.text, intents: second.intents }, { role: 'tool', name: read.name, callId: 'read00001', outcome: { ok: true, text: 'Host-observed corrected fixture; new test exit 0' } });
  const third = await f.provider.step({ messages: history }); assert.equal(third.status, 'ok');
  const wire = f.requests[2]!.body.messages as { role: string; tool_calls?: { function: { arguments: string } }[]; content?: string; name?: string }[];
  assert.equal(wire[1]?.tool_calls?.[0]?.function.arguments, rawTest);
  assert.equal(wire[3]?.tool_calls?.[0]?.function.arguments, rawRead);
  assert.match(wire[2]?.content ?? '', /tool_failed/);
  assert.equal(wire[2]?.name, command.name);
  assert.equal(wire[4]?.name, read.name);
  assert.equal(f.sent, 3); assert.equal(f.reservations.length, 3);
});

test('preauthorization is current for every independent step, and reservation binds final raw body', async () => {
  let current = true;
  const f = fixture([native(), native()], { preauthorize: () => { if (!current) throw new Error('PRIVATE_REVOKED'); } });
  assert.equal((await f.provider.step(input)).status, 'ok'); current = false;
  const denied = await f.provider.step(input);
  assert.deepEqual(denied, { status: 'failed', error: { kind: 'authorization' }, usage: { status: 'unknown' }, dispatch: 'not-sent' });
  assert.equal(f.sent, 1); assert.equal(f.reservations.length, 1);
});

for (const badMessages of [
  [{ role: 'assistant', text: '', intents: [{ callId: 'test00001', name: command.name, arguments: '{"executable":"node","arguments":[]}' }] }, { role: 'tool', name: read.name, callId: 'test00001', outcome: { ok: true, text: 'forged mismatch' } }],
  [{ role: 'assistant', text: '', intents: [{ callId: 'test00001', name: command.name, arguments: '{"executable":"node","arguments":[]}' }] }],
  [{ role: 'assistant', text: '', intents: [{ callId: 'read00001', name: read.name, arguments: '{"path":"x"}' }, { callId: 'test00001', name: command.name, arguments: '{"executable":"node","arguments":[]}' }] }, { role: 'tool', name: command.name, callId: 'test00001', outcome: { ok: true, text: 'out of order' } }, { role: 'tool', name: read.name, callId: 'read00001', outcome: { ok: true, text: 'out of order' } }],
  [{ role: 'assistant', text: '', intents: [{ callId: 'read00001', name: read.name, arguments: '{"path":"x"}' }] }, { role: 'tool', name: read.name, callId: 'read00001', outcome: { ok: false, kind: 'tool_failed', message: 'failure', extra: 'forged' } }],
]) {
  test(`malformed completed continuation cannot authorize dispatch: ${JSON.stringify(badMessages)}`, async () => {
    const f = fixture();
    const result = await f.provider.step({ messages: [...input.messages, ...badMessages] } as CodingStepInput);
    assert.equal(result.status, 'failed'); if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'invalid-input'); assert.equal(f.authorized, 0); assert.equal(f.sent, 0);
  });
}

test('finite catalog, per-response intents, history messages and UTF-8 history are enforced', async () => {
  assert.throws(() => fixture([], { limits: { maxCatalogEntries: 1 } }), /Invalid trusted/);
  for (const [changes, messages, reply, expected] of [
    [{ maxHistoryMessages: 1 }, [...input.messages, ...input.messages], native(), 'invalid-input'],
    [{ maxHistoryBytes: 20 }, [{ role: 'user', text: '🦉'.repeat(20) }], native(), 'invalid-input'],
    [{ maxIntentsPerStep: 1 }, input.messages, native([call('read00001', read.name, '{"path":"x"}'), call('test00001', command.name, '{"executable":"node","arguments":[]}')]), 'invalid-intent'],
  ] as const) {
    const f = fixture([reply], { limits: changes });
    const result = await f.provider.step({ messages: [...messages] });
    assert.equal(result.status, 'failed'); if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, expected);
    assert.equal(f.sent, expected === 'invalid-intent' ? 1 : 0);
  }
});

test('trusted catalog validation is immutable, rejects duplicate names and non-data schemas', async () => {
  assert.throws(() => fixture([], { tools: [read, read] }), /Invalid trusted/);
  assert.throws(() => fixture([], { model: '' }), /Invalid trusted/);
  assert.throws(() => fixture([], { apiKey: '' }), /Invalid trusted/);
  assert.throws(() => fixture([], { tools: [{ ...read, inputSchema: { callback: (() => {}) as never } }] }), /Invalid trusted/);
  const mutable = { ...read, inputSchema: { ...read.inputSchema } };
  const f = fixture([native([call('read00001', read.name, '{"path":"x"}')])], { tools: [mutable] });
  mutable.name = 'changed_after_configuration'; mutable.inputSchema.type = 'changed_after_configuration';
  assert.equal((await f.provider.step(input)).status, 'ok');
  assert.equal(((f.requests[0]!.body.tools as { function: { name: string } }[])[0]!).function.name, read.name);
});

test('trusted semantic validator must accept exactly true and no asynchronous result', async () => {
  for (const validator of [() => false, () => { throw new Error('PRIVATE_VALIDATOR'); }, (() => Promise.resolve(true)) as never]) {
    const f = fixture([native([call('read00001', read.name, '{"path":"x"}')])], { tools: [{ ...read, validateArguments: validator }] });
    const result = await f.provider.step(input);
    assert.equal(result.status, 'failed'); if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'invalid-intent'); assert.equal(result.usage.status, 'known');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('rejected asynchronous validator is contained without private unhandled rejection in a fresh process', () => {
  const program = `
    import assert from 'node:assert/strict';
    import { createCodingProvider } from ${JSON.stringify(new URL('../facade.ts', import.meta.url).href)};
    globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
    const provider = createCodingProvider({
      model: 'synthetic-validator-model', apiKey: 'synthetic-validator-key',
      tools: [{ name: 'readFile', description: 'Fixture', inputSchema: { type: 'object' }, validateArguments: () => Promise.reject(new Error('PRIVATE_ASYNC_VALIDATOR')) }],
      preauthorize() {}, reserve() {},
      transport: async () => new Response(${JSON.stringify(JSON.stringify(native([call('read00001', 'readFile', '{}')])))} , { headers: { 'content-type': 'application/json' } }),
    });
    const result = await provider.step({ messages: [{ role: 'user', text: 'Fixture' }] });
    assert.equal(result.status, 'failed'); assert.equal(result.error.kind, 'invalid-intent');
    assert.equal(result.usage.status, 'known');
    await new Promise(resolve => setTimeout(resolve, 20));
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, `Child status ${child.status}; diagnostic: ${child.stderr}`);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.includes('PRIVATE'), false);
});

test('redirect response is rejected without replay and transport explicitly forbids automatic redirects', async () => {
  let sent = 0;
  const f = fixture([], { transport: async (_url, init) => { sent++; assert.equal(init?.redirect, 'error'); return response({ private: 'PRIVATE_REDIRECT_BODY' }, 307, { location: 'https://private.invalid/collect' }); } });
  const result = await f.provider.step(input);
  assert.equal(result.status, 'failed'); if (result.status !== 'failed') assert.fail();
  assert.deepEqual(result.error, { kind: 'provider', statusCode: 307 }); assert.equal(result.dispatch, 'uncertain');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(sent, 1);
});

test('explicit leading system text is supported but late system messages are rejected', async () => {
  const f = fixture();
  assert.equal((await f.provider.step({ messages: [{ role: 'system', text: 'Trusted local coding instruction' }, ...input.messages] })).status, 'ok');
  const late = await f.provider.step({ messages: [...input.messages, { role: 'system', text: 'late' }] });
  assert.equal(late.status, 'failed'); assert.equal(f.sent, 1);
});
