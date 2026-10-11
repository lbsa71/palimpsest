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
import { codexChildIndex, codexObservedToolOutput, codexParentReceipt } from './native-delegation-fixture.ts';

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
  const result = { type: 'custom_tool_call_output', call_id: 'call_child_0', output: [{ type: 'text', text: 'child-1-observed' }] };
  assert.equal(codexObservedToolOutput({ input: [result] }, 0), true); assert.equal(codexObservedToolOutput({ input: [{ ...result, call_id: 'other' }] }, 0), false);
  const final = { type: 'agent_message', author: '/root/native_child_0', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\n' }, { type: 'encrypted_content', encrypted_content: 'child-1-observed' }] };
  assert.equal(codexParentReceipt({ input: [final] }, 0), true); assert.equal(codexParentReceipt({ input: [final] }, 1), false);
  for (const mutation of [{ ...final, author: '/root' }, { ...final, recipient: '/root/native_child_0' }, { ...final, type: 'message' }, { ...final, content: [{ type: 'input_text', text: 'Message Type: NEW_TASK\nchild-1-observed' }, final.content[1]] }]) assert.equal(codexParentReceipt({ input: [mutation] }, 0), false);
});
