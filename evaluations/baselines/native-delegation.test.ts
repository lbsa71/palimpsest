import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver, openAITransport } from './observer.ts';
import type { ObserverGrant } from './observer.ts';
import { runNativeBaseline } from './run-native.ts';
import type { NativeBaselineRun } from './run-native.ts';
import type { CodexNativeProtocol } from './codex-native-protocol.ts';
import { claudeInvocation } from './claude-configuration.ts';
import { codexChildIndex, codexObservedToolOutput, codexParentReceipt, claudeChildIdentity, claudeParentReceipts, claudeTaskBindings } from './native-delegation-fixture.ts';

const hashes = ['ab55e3cee93fc5fd90cd7ed85197f7c8423beeb52836ad99770c4cd83fb779b9', '04ef8c718640204d79a6a8256bf76e4b9be6712075685a448f7b10fa401d79a8'];
const native: CodexNativeProtocol = { kind: 'agent-message-v1', codexVersion: 'codex-cli 0.162.1', codexSha256: '628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1', helperSha256: 'ec71830690a7c0024916ee0c99fbdc635bc6e747ff665ea4f03a8389bbcb6b30', qualification: 'synthetic-only' };
function bytes(index = 0): string { return readFileSync(new URL(`./fixtures/codex-child-${index}-0.162.1.json`, import.meta.url), 'utf8'); }
function grant(): ObserverGrant { return { id: 'original-codex-child-acquisition-fixture', resources: { maxRequests: 8, maxTokens: 1_632_768, maxCostUsd: 100, maxElapsedMs: 60_000, maxConcurrency: 4 },
  profile: { provider: 'openai', model: 'gpt-6-astra', effort: 'high', contextContract: 'Original full 200k native input contract; synthetic acquisition only', contextWindowTokens: 200_000, maxOutputTokens: 4096,
    prices: { source: 'synthetic prices', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20 }, codexNativeProtocol: native },
  requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 }; }
const receipt = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_child_synthetic', status: 'completed', model: 'gpt-6-astra', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })}\n\n`;
function fixture(g = grant()) {
  const root = mkdtempSync(join(tmpdir(), 'native-delegation-unit-')); const store = new OperationalStore({ filename: join(root, 'observer.sqlite') }); let calls = 0, outgoing = '';
  let observer: BaselineObserver;
  try { observer = new BaselineObserver({ store, grant: g, transportKind: 'fixture', transport: async payload => { calls++; outgoing = payload; return new Response(receipt, { headers: { 'content-type': 'text/event-stream' } }); } }); } catch (error) { store.close(); rmSync(root, { recursive: true, force: true }); throw error; }
  return { store, observer, calls: () => calls, outgoing: () => outgoing, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const attempt = (payload = bytes()) => ({ method: 'POST', path: '/v1/responses', payload });
for (let index = 0; index < 2; index++) test(`retained native child ${index} exact original bytes survive narrowly pinned synthetic admission`, async () => {
  const original = bytes(index); assert.equal(createHash('sha256').update(original).digest('hex'), hashes[index]);
  const f = fixture();
  try {
    await f.observer.handle(attempt(original)); assert.equal(f.calls(), 1);
    const after = JSON.parse(f.outgoing()); assert.deepEqual(after.input, JSON.parse(original).input);
    assert.equal(Buffer.from(f.store.readArtifact(f.observer.evidence()[0]!.before)).toString(), original);
    assert.equal(f.observer.ledger.snapshot(grant().id).tokens, 110);
  } finally { f.close(); }
});
for (const [label, mutation] of Object.entries({
  extraItem: (item: any): unknown => item.authority = { effect: 'host' },
  missingAuthor: (item: any): unknown => delete item.author,
  foreignIdentity: (item: any): unknown => item.author = 'external-author',
  pathTraversal: (item: any): unknown => item.recipient = '/root/../host',
  emptyIdentity: (item: any): unknown => item.recipient = '',
  oversizedIdentity: (item: any): unknown => item.recipient = '/root/' + 'x'.repeat(300),
  extraText: (item: any): unknown => item.content[0].url = 'https://unqualified.invalid',
  extraOpaque: (item: any): unknown => item.content[1].authority = 'provider',
  media: (item: any): unknown => item.content.push({ type: 'input_image', image_url: 'x' }),
  serverContext: (item: any): unknown => item.content.push({ type: 'item_reference', id: 'old' }),
  opaqueObject: (item: any): unknown => item.content[1].encrypted_content = { text: 'opaque' },
  emptyContent: (item: any): unknown => item.content = [],
})) test(`native child ${label} is refused before transport`, async () => {
  const f = fixture();
  try { const body = JSON.parse(bytes()); mutation(body.input.find((item: any) => item.type === 'agent_message')); await assert.rejects(f.observer.handle(attempt(JSON.stringify(body)))); assert.equal(f.calls(), 0); assert.equal(f.observer.ledger.snapshot(grant().id).requests, 0); } finally { f.close(); }
});
test('native child format is refused without its pin or with undeclared/paid transport', async () => {
  const plain = grant(); delete (plain.profile as any).codexNativeProtocol;
  const f = fixture(plain); try { await assert.rejects(f.observer.handle(attempt())); assert.equal(f.calls(), 0); } finally { f.close(); }
  const root = mkdtempSync(join(tmpdir(), 'native-paid-refusal-')); const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  try {
    for (const transportKind of [undefined, 'openai', 'anthropic']) assert.throws(() => new BaselineObserver({ store, grant: grant(), transportKind, transport: async () => new Response(receipt) } as any), /synthetic|fixture/);
    assert.equal(store.list('baseline-grants').length, 0);
    let fetched = false; const transport = openAITransport('PUBLIC_SYNTHETIC_KEY', (async () => { fetched = true; return new Response(receipt); }) as typeof fetch);
    await assert.rejects(transport(bytes(), new AbortController().signal), /synthetic|qualification/); assert.equal(fetched, false);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
for (const field of ['codexVersion', 'codexSha256', 'helperSha256', 'kind', 'qualification', 'extra'] as const) test(`mutated Codex pin ${field} fails before allocation`, () => {
  const g = grant(); (g.profile as any).codexNativeProtocol = { ...native, [field]: 'mutated' };
  assert.throws(() => fixture(g));
});
test('paid Codex native child runner and swapped closure refuse before state preparation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-runner-pin-')), state = join(root, 'state');
  for (const name of ['checkout', 'workspace', 'protected']) mkdirSync(join(root, name));
  const input: NativeBaselineRun = { kind: 'codex', checkoutRoot: join(root, 'checkout'), workspace: join(root, 'workspace'), privateStateRoot: state, protectedPaths: [join(root, 'protected')], prompt: 'public fixture', grant: grant(), maxCliOutputBytes: 1_000_000,
    native: { version: native.codexVersion, files: [{ path: '/usr/bin/true', name: 'codex', sha256: native.codexSha256 }, { path: '/usr/bin/true', name: 'codex-code-mode-host', sha256: native.helperSha256 }] }, provider: { kind: 'openai', apiKey: 'PUBLIC_FIXTURE_KEY', resourceLimits: {} as any } };
  try { await assert.rejects(runNativeBaseline(input), /synthetic/); assert.equal(existsSync(state), false);
    await assert.rejects(runNativeBaseline({ ...input, provider: { kind: 'fixture', transport: async () => new Response(receipt) }, native: { ...input.native, version: 'mutated' } }), /pin|binary|version/); assert.equal(existsSync(state), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('isolated Claude delegation retains native built-ins while removing ambient customization discovery', () => {
  const start = { model: 'claude-opus-5-5', effort: 'high', profile: 'anthropic', claudeOptions: { tools: 'Agent,Bash,Read,Write', delegation: 'isolated-native', modelRoles: { haiku: 'claude-opus-5-5', sonnet: 'claude-opus-5-5', opus: 'claude-opus-5-5', subagent: 'claude-opus-5-5' } } };
  const invocation = claudeInvocation(start as any, 1234);
  assert.equal(invocation.args.includes('--bare'), false); assert.ok(invocation.args.includes('--safe-mode')); assert.equal(invocation.args[invocation.args.indexOf('--setting-sources') + 1], '');
  assert.equal(invocation.args.includes('--agents'), false); assert.equal(invocation.args.includes('--system-prompt'), false); assert.equal(invocation.args.includes('--append-system-prompt'), false);
  assert.ok(invocation.args.includes('--strict-mcp-config')); assert.ok(invocation.args.includes('--disable-slash-commands')); assert.ok(invocation.args.includes('--no-session-persistence'));
  assert.equal(invocation.environment.HOME, '/tmp/aeon-baseline-home'); assert.equal(invocation.environment.ANTHROPIC_API_KEY, 'no-provider-authority');
  assert.throws(() => claudeInvocation({ ...start, claudeOptions: { ...start.claudeOptions, delegation: 'mutated' } } as any, 0));
  assert.throws(() => claudeInvocation({ ...start, profile: 'anthropic-fixture' } as any, 0));
});

test('fixture observations require native child identity, attributed tool output and directed final receipt', () => {
  const request = JSON.parse(bytes()); assert.equal(codexChildIndex(request), 0); assert.equal(codexObservedToolOutput(request, 0), false); assert.equal(codexParentReceipt(request, 0), false);
  assert.equal(codexChildIndex({ input: [{ role: 'user', content: 'NATIVE_CHILD_ONE child-1-observed' }] }), -1);
  const result = { type: 'custom_tool_call_output', call_id: 'call_child_0', output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: JSON.stringify({ chunk_id: 'public', wall_time_seconds: 0.001, exit_code: 0, original_token_count: 5, output: 'child-1-observed\n' }) }] };
  assert.equal(codexObservedToolOutput({ input: [result] }, 0), true); assert.equal(codexObservedToolOutput({ input: [{ ...result, call_id: 'other' }] }, 0), false);
  const final = { type: 'agent_message', author: '/root/native_child_0', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\n' }, { type: 'encrypted_content', encrypted_content: 'child-1-observed' }] };
  assert.equal(codexParentReceipt({ input: [final] }, 0), false); assert.equal(codexParentReceipt({ input: [final] }, 1), false);
  for (const mutation of [{ ...final, author: '/root' }, { ...final, recipient: '/root/native_child_0' }, { ...final, type: 'message' }, { ...final, content: [{ type: 'input_text', text: 'Message Type: NEW_TASK\nchild-1-observed' }, final.content[1]] }]) assert.equal(codexParentReceipt({ input: [mutation] }, 0), false);
});

const delegationBeta = 'claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,effort-2025-11-24,thinking-display-updates-2026-08-18';
function claudeDelegationGrant(): ObserverGrant { const g = grant(); g.profile = { ...g.profile, provider: 'anthropic', model: 'claude-opus-5-5', contextWindowTokens: 1_000_000, prices: { ...g.profile.prices, cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 }, anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', nativeProtocol: { kind: 'opus-adaptive-delegation' as any, claudeVersion: '2.1.296 (Claude Code)', claudeSha256: '24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de', version: '2023-06-01', beta: delegationBeta, qualification: 'synthetic-only' } } }; delete g.profile.codexNativeProtocol; g.resources.maxTokens = 8_032_768; return g; }
test('actual directed text finals require the complete native envelope and exact emitted body', () => {
  const final = { type: 'agent_message', author: '/root/native_child_0', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/native_child_0\nPayload:\nchild-1-observed' }] };
  assert.equal(codexParentReceipt({ input: [final] }, 0), true);
  for (const text of ['Message Type: FINAL_ANSWER\nchild-1-observed', final.content[0].text + 'extra', final.content[0].text.replace('FINAL_ANSWER', 'NEW_TASK'), final.content[0].text.replace('Sender: /root/native_child_0', 'Sender: /root')]) assert.equal(codexParentReceipt({ input: [{ ...final, content: [{ type: 'input_text', text }] }] }, 0), false);
  for (const patch of [{ author: '/root' }, { recipient: '/root/native_child_0' }, { content: [...final.content, { type: 'input_text', text: 'extra' }] }]) assert.equal(codexParentReceipt({ input: [{ ...final, ...patch }] }, 0), false);
});
test('exact acquired Claude delegation beta and Agent surface admit only pinned synthetic transport', async () => {
  const payload = readFileSync(new URL('./fixtures/claude-delegation-parent-2.1.296.json', import.meta.url), 'utf8'), nativeHttp = JSON.parse(readFileSync(new URL('./fixtures/claude-delegation-http-2.1.296.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(payload).digest('hex'), 'd9dc038e4e3f823b4e94ededae78068dadcc95e3d21148485cf01020ffdb0d08');
  const root = mkdtempSync(join(tmpdir(), 'native-claude-delegation-')), store = new OperationalStore({ filename: join(root, 'state.sqlite') }); let calls = 0;
  const nativeEvents = [{ type: 'message_start', message: { id: 'msg_native_delegation', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }];
  const nativeReceipt = nativeEvents.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  try {
    const observer = new BaselineObserver({ store, grant: claudeDelegationGrant(), transportKind: 'fixture', transport: async outgoing => { calls++; assert.deepEqual(JSON.parse(outgoing).tools, JSON.parse(payload).tools); assert.deepEqual(JSON.parse(outgoing).system, JSON.parse(payload).system); return new Response(nativeReceipt, { headers: { 'content-type': 'text/event-stream' } }); } });
    await observer.handle({ method: 'POST', path: '/v1/messages', payload, nativeHttp }); assert.equal(calls, 1);
    for (const beta of [delegationBeta + ',unknown-beta', delegationBeta.replace(',mid-conversation-tool-changes-2026-07-01', '')]) await assert.rejects(observer.handle({ method: 'POST', path: '/v1/messages', payload, nativeHttp: { ...nativeHttp, headers: { ...nativeHttp.headers, 'anthropic-beta': beta } } }));
    assert.equal(calls, 1); assert.equal(observer.ledger.snapshot(claudeDelegationGrant().id).requests, 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('new Claude delegation profile refuses undeclared and paid observer transports before allocation', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-claude-paid-')), store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  try { for (const transportKind of [undefined, 'anthropic', 'openai']) assert.throws(() => new BaselineObserver({ store, grant: claudeDelegationGrant(), transportKind, transport: async () => new Response() } as any)); assert.equal(store.list('baseline-grants').length, 0); }
  finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('Claude witness requires native child headers and attributed Agent results, never prompt text', () => {
  const parent = { 'x-claude-code-session-id': 'session_original', 'x-claude-code-agent-id': 'parent_original' };
  const child = { ...parent, 'x-claude-code-agent-id': 'child_actual', 'x-claude-code-parent-agent-id': 'parent_original' };
  assert.equal(claudeChildIdentity(child, parent), 'child_actual'); assert.equal(claudeChildIdentity(parent, parent), undefined);
  for (const patch of [{ 'x-claude-code-agent-id': '' }, { 'x-claude-code-session-id': 'foreign' }, { 'x-claude-code-parent-agent-id': 'foreign' }]) assert.equal(claudeChildIdentity({ ...child, ...patch }, parent), undefined);
  const part = { type: 'tool_result', tool_use_id: 'tool_spawn_0', content: [{ type: 'text', text: 'child-1-observed\n\nagentId: child_actual' }] };
  const emitted = { role: 'assistant', content: [{ type: 'tool_use', name: 'Agent', id: 'tool_spawn_0' }, { type: 'tool_use', name: 'Agent', id: 'tool_spawn_1' }] };
  assert.deepEqual(claudeParentReceipts({ messages: [emitted, { role: 'user', content: [part] }] }), ['child-1-observed']);
  assert.deepEqual(claudeParentReceipts({ messages: [{ role: 'user', content: [part] }] }), []);
  assert.deepEqual(claudeParentReceipts({ messages: [emitted, { role: 'user', content: [part, { ...part, content: [{ type: 'text', text: 'child-2-observed' }] }] }] }), []);
  for (const patch of [{ tool_use_id: 'unattributed' }, { is_error: true }, { content: [{ type: 'text', text: 'NATIVE_CHILD_ONE child-1-observed' }] }]) assert.deepEqual(claudeParentReceipts({ messages: [emitted, { role: 'user', content: [{ ...part, ...patch }] }] }), []);
  assert.deepEqual(claudeParentReceipts({ messages: [{ role: 'assistant', content: [part] }] }), []);
});

test('delegation beta cannot be substituted into the ordinary coding profile or sent to paid transport', async () => {
  const { validateNativeProtocol } = await import('./anthropic-native-protocol.ts');
  const { anthropicTransport } = await import('./anthropic-codec.ts');
  const profile = claudeDelegationGrant().profile.anthropic!.nativeProtocol!;
  assert.throws(() => validateNativeProtocol({ ...profile, kind: 'opus-adaptive-coding' }));
  assert.throws(() => validateNativeProtocol({ ...profile, beta: profile.beta + ',unknown' }));
  let fetched = false;
  await assert.rejects(async () => anthropicTransport('PUBLIC_FIXTURE_KEY', (async () => { fetched = true; return new Response(); }) as typeof fetch)('{}', new AbortController().signal, { version: '2023-06-01', beta: delegationBeta }));
  assert.equal(fetched, false);
});

test('exact acquired child requests require paired omitted beta/display and native child identity', async () => {
  const { nativeProtocolHeaders } = await import('./anthropic-native-protocol.ts');
  for (const index of [0, 1]) {
    const payload = readFileSync(new URL(`./fixtures/claude-delegation-child-${index}-2.1.296.json`, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(payload).digest('hex'), ['952877d5856ce73367e6b055118a3fdddccfbffc3cfb9f624a264e6049c3e371', '9bf655f80fd1fb2b5a0f7d7767258d503884d6d7c7a3758f59fc3ae824a18f45'][index]);
    const original = JSON.parse(readFileSync(new URL('./fixtures/claude-delegation-child-http-2.1.296.json', import.meta.url), 'utf8'));
    const headers = { ...original.headers, 'x-claude-code-agent-id': `native_child_${index}`, 'x-claude-code-session-id': 'original_session' };
    const profile = claudeDelegationGrant().profile;
    const attempt = { method: 'POST', path: '/v1/messages', payload, nativeHttp: { ...original, headers } };
    assert.equal(nativeProtocolHeaders(attempt, profile)!.beta, original.headers['anthropic-beta']);
    for (const patch of [{ thinking: { type: 'adaptive', display: 'updates' } }, { thinking: { type: 'disabled' } }, { output_config: { effort: 'low' } }]) assert.throws(() => nativeProtocolHeaders({ ...attempt, payload: JSON.stringify({ ...JSON.parse(payload), ...patch }) }, profile));
    for (const patch of [{ 'x-claude-code-agent-id': undefined }, { 'x-claude-code-agent-id': '' }, { 'anthropic-beta': delegationBeta }, { 'anthropic-beta': headers['anthropic-beta'] + ',unknown' }]) assert.throws(() => nativeProtocolHeaders({ ...attempt, nativeHttp: { ...original, headers: { ...headers, ...patch } } }, profile));
    const f = fixture(claudeDelegationGrant());
    try { const { validateAnthropicPayload } = await import('./anthropic-codec.ts'); validateAnthropicPayload(JSON.parse(payload), profile); } finally { f.close(); }
  }
});

test('task-start witnesses bind actual child IDs to emitted Agent call IDs and returned finals', () => {
  const starts = [0, 1].map(index => ({ type: 'system', subtype: 'task_started', task_type: 'local_agent', subagent_type: 'general-purpose', spawn_depth: 1, is_backgrounded: false, task_id: `native_${index}`, tool_use_id: `tool_spawn_${index}` }));
  const request = { messages: [{ role: 'user', content: [0, 1].map(index => ({ type: 'tool_result', tool_use_id: `tool_spawn_${index}`, content: [{ type: 'text', text: `child-${index + 1}-observed\n\nagentId: native_${index} (native diagnostic)` }] })) }] };
  const stdout = starts.map(event => JSON.stringify(event)).join('\n');
  assert.equal(claudeTaskBindings(stdout, ['native_0', 'native_1'], request), true);
  assert.equal(claudeTaskBindings(stdout, ['native_1', 'native_0'], request), false);
  assert.equal(claudeTaskBindings(stdout, ['native_0', 'native_0'], request), false);
  assert.equal(claudeTaskBindings(stdout, ['foreign', 'native_1'], request), false);
  assert.equal(claudeTaskBindings(stdout.replace('tool_spawn_1', 'tool_spawn_0'), ['native_0', 'native_1'], request), false);
  assert.equal(claudeTaskBindings(stdout, ['native_0', 'native_1'], { messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(request) }] }] }), false);
});
