import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver, validateObserverGrant } from './observer.ts';
import type { BaselineTransport, ObserverGrant } from './observer.ts';
import { anthropicTransport, ANTHROPIC_MESSAGES_ENDPOINT } from './anthropic-codec.ts';
import { claudeInvocation } from './claude-configuration.ts';
import type { ClaudeBaselineRun } from './run-claude.ts';
import { runClaudeBaseline } from './run-claude.ts';

// Deliberately synthetic IDs/prices: exercises the real transport contract without entitlement claims.
const grant = (): ObserverGrant => ({ id: 'anthropic-original-grant', resources: { maxRequests: 3, maxTokens: 360, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 1 },
  profile: { provider: 'anthropic', model: 'synthetic-messages-profile', effort: 'high', contextContract: 'synthetic host-attested input maximum; no provider entitlement', contextWindowTokens: 100, maxOutputTokens: 20,
    anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard' },
    prices: { source: 'synthetic category rates', inputUsdPerMillion: 4, cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20 } },
  requestTimeoutMs: 1000, maxRequestBytes: 8192, maxResponseBytes: 8192 });
const payload = () => JSON.stringify({ model: grant().profile.model, thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, max_tokens: 200, stream: true,
  system: [{ type: 'text', text: 'Native instructions.', cache_control: { type: 'ephemeral', ttl: '1h' } }], cache_control: { type: 'ephemeral', ttl: '5m' },
  messages: [{ role: 'user', content: 'Run the fixture' }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'native thought', signature: 'opaque signature' },
    { type: 'redacted_thinking', data: 'opaque encrypted block' }, { type: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'true' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'Observed' }] }], tools: [{ name: 'Bash', input_schema: { type: 'object' } }] });
function events(): any[] { return [
  { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: grant().profile.model, content: [], usage: {
    input_tokens: 10, cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 }, cache_read_input_tokens: 4, output_tokens: 1,
    service_tier: 'standard', inference_geo: 'global', server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Native output thought' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'native-output-signature' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 3, output_tokens_details: { thinking_tokens: 2 } } },
  { type: 'ping' },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5, output_tokens_details: { thinking_tokens: 3 } } },
  { type: 'message_stop' },
]; }
const stream = (list = events()) => list.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const attempt = (body = payload()) => ({ method: 'POST', path: '/v1/messages', payload: body });
function fixture(options: { grant?: ObserverGrant; transport?: BaselineTransport; body?: string; now?: () => number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-anthropic-accounting-')); const filename = join(root, 'state.sqlite'); const store = new OperationalStore({ filename });
  const g = options.grant ?? grant(); let calls = 0, forwarded = '';
  const transport: BaselineTransport = async (...args) => { calls++; forwarded = args[0]; return options.transport ? options.transport(...args) : new Response(options.body ?? stream(), { headers: { 'content-type': 'text/event-stream' } }); };
  const observer = new BaselineObserver({ store, grant: g, transport, now: options.now });
  return { root, filename, observer, store, g, transport, calls: () => calls, forwarded: () => forwarded, dispose() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('mixed TTL/cache receipt settles one cumulative bill and preserves signed/redacted continuation and cache controls', async () => {
  const f = fixture();
  try {
    const reply = await f.observer.handle(attempt()); const before = JSON.parse(payload()), after = JSON.parse(f.forwarded());
    for (const key of ['system', 'messages', 'thinking', 'tools', 'cache_control', 'output_config']) assert.deepEqual(after[key], before[key]);
    assert.equal(after.max_tokens, 20); assert.equal(after.service_tier, 'standard_only'); assert.equal(after.inference_geo, 'global'); assert.equal(reply.body, stream());
    const record = f.observer.evidence()[0]!;
    assert.deepEqual(record.anthropicReceipt, { uncachedInputTokens: 10, cacheWrite5mTokens: 2, cacheWrite1hTokens: 3, cacheReadTokens: 4, outputTokens: 5, thinkingTokens: 3,
      serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', stopReason: 'end_turn', truncated: false });
    assert.equal(record.usage?.inputTokens, 19); assert.equal(record.usage?.outputTokens, 5); assert.equal(record.usage?.costUsd, 174.8 / 1_000_000);
    assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 24); assert.equal(f.observer.ledger.snapshot(f.g.id).costUsd, 174.8 / 1_000_000);
    assert.equal(f.observer.ledger.request(record.requestId)?.status, 'succeeded');
  } finally { f.dispose(); }
});
for (const [label, amounts] of Object.entries({ uncached: [19, 0, 0, 0], writes5m: [0, 19, 0, 0], writes1h: [0, 0, 19, 0], reads: [0, 0, 0, 19] })) test(`${label} tokens all consume the input grant and settle their own category price`, async () => {
  const list = events(), [U, W5, W1, R] = amounts as [number, number, number, number];
  Object.assign(list[0].message.usage, { input_tokens: U, cache_creation_input_tokens: W5 + W1, cache_read_input_tokens: R, cache_creation: { ephemeral_5m_input_tokens: W5, ephemeral_1h_input_tokens: W1 } });
  const f = fixture({ body: stream(list) }); try {
    await f.observer.handle(attempt()); assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 24);
    assert.equal(f.observer.ledger.snapshot(f.g.id).costUsd, (U * 4 + W5 * 5 + W1 * 8 + R * 0.2 + 100) / 1_000_000);
  } finally { f.dispose(); }
});
test('legitimate max_tokens settles measured usage and marks task truncation, without a competence claim', async () => {
  const list = events(); list[7].delta.stop_reason = 'max_tokens'; const f = fixture({ body: stream(list) });
  try { await f.observer.handle(attempt()); assert.equal(f.observer.evidence()[0]!.anthropicReceipt?.truncated, true); assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 24); assert.equal(f.observer.ledger.snapshot(f.g.id).cancelled, false); } finally { f.dispose(); }
});
test('full input plus output readiness refuses 144k at both 200k and 1M before opening state or sending anything', async () => {
  for (const context of [200_000, 1_000_000]) { const g = grant(); g.profile.contextWindowTokens = context; g.resources.maxTokens = 144_000;
    assert.throws(() => validateObserverGrant(g), /readiness refused/);
    const root = mkdtempSync(join(tmpdir(), 'aeon-readiness-')); const state = join(root, 'unopened');
    try { await assert.rejects(runClaudeBaseline({ checkoutRoot: root, workspace: root, privateStateRoot: state, protectedPaths: [root],
      native: { claude: '/usr/bin/true', version: 'unlaunched', claudeSha256: '0'.repeat(64) }, prompt: 'Unlaunched', grant: g, maxCliOutputBytes: 100,
      claudeOptions: { tools: 'default' }, provider: { kind: 'fixture', transport: async () => { throw new Error('must not enter'); } } }), /readiness refused/); assert.equal(existsSync(state), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
test('expensive admitted category, even cache reads exceeding base, drives conservative reservation; aggregate usage prevents subsequent overcommit', async () => {
  const g = grant(); g.profile.prices.cachedInputUsdPerMillion = 12; g.resources.maxCostUsd = 0.00159;
  const f = fixture({ grant: g }); try {
    assert.equal(f.observer.ledger.defaultCeiling.tokens, 120); assert.equal(f.observer.ledger.defaultCeiling.costUsd, 0.0016);
    await assert.rejects(f.observer.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 0); assert.equal(f.observer.evidence().length, 0);
  } finally { f.dispose(); }
  const bounded = grant(); bounded.resources.maxTokens = 143; const h = fixture({ grant: bounded }); try {
    await h.observer.handle(attempt()); await assert.rejects(h.observer.handle(attempt()), /budget|allocation/); assert.equal(h.calls(), 1); assert.equal(h.observer.ledger.snapshot(h.g.id).tokens, 24);
  } finally { h.dispose(); }
});
for (const [label, mutate] of Object.entries({
  wrongModel: (x: any[]): unknown => x[0].message.model = 'other', missingInput: (x: any[]): unknown => delete x[0].message.usage.input_tokens,
  missingCache: (x: any[]): unknown => delete x[0].message.usage.cache_read_input_tokens, missingTTL: (x: any[]): unknown => delete x[0].message.usage.cache_creation,
  wrongTTL: (x: any[]): unknown => x[0].message.usage.cache_creation.ephemeral_1h_input_tokens = 4,
  decreasingOutput: (x: any[]): unknown => x[7].usage.output_tokens = 2, decreasingInput: (x: any[]): unknown => x[7].usage.input_tokens = 9,
  decreasingThinking: (x: any[]): unknown => x[7].usage.output_tokens_details.thinking_tokens = 1,
  thinkingExceedsOutput: (x: any[]): unknown => x[7].usage.output_tokens_details.thinking_tokens = 6,
  negativeCount: (x: any[]): unknown => x[0].message.usage.cache_read_input_tokens = -1, fractional: (x: any[]): unknown => x[7].usage.output_tokens = 4.5,
  unsafeCount: (x: any[]): unknown => x[0].message.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1,
  inputOverflow: (x: any[]): unknown => x[0].message.usage.input_tokens = 99, outputOverflow: (x: any[]): unknown => x[7].usage.output_tokens = 21,
  tier: (x: any[]): unknown => x[7].usage.service_tier = 'priority', geo: (x: any[]): unknown => x[7].usage.inference_geo = 'us',
  missingTier: (x: any[]): unknown => delete x[0].message.usage.service_tier, missingGeo: (x: any[]): unknown => delete x[0].message.usage.inference_geo,
  fast: (x: any[]): unknown => x[7].usage.speed = 'fast', serverCharge: (x: any[]): unknown => x[0].message.usage.server_tool_use.web_search_requests = 1,
  unknownCharge: (x: any[]): unknown => x[7].usage.server_tool_use = { code_execution_requests: 0 }, unknownUsage: (x: any[]): unknown => x[7].usage.new_cost = 0,
  serverBlock: (x: any[]): unknown => x[1].content_block.type = 'server_tool_use', unsupportedStop: (x: any[]): unknown => x[7].delta.stop_reason = 'pause_turn',
  error: (x: any[]): unknown => x.splice(7, 0, { type: 'error', error: { type: 'overloaded_error' } }), missingStop: (x: any[]): unknown => x.pop(),
  duplicateStart: (x: any[]): unknown => x.splice(1, 0, x[0]), afterStop: (x: any[]): unknown => x.push({ type: 'ping' }),
})) test(`${label} retains highest-category charges, cancels original grant and refuses durable replay`, async () => {
  const list = events(); mutate(list); const f = fixture({ body: stream(list) });
  try {
    await assert.rejects(f.observer.handle(attempt()), /outcome unknown/); const snapshot = f.observer.ledger.snapshot(f.g.id);
    assert.equal(snapshot.tokens, 120); assert.equal(snapshot.costUsd, 0.0012); assert.equal(snapshot.cancelled, true); assert.equal(f.observer.evidence()[0]!.usage?.inputTokens, null);
    const reopened = new BaselineObserver({ store: f.store, grant: f.g, transport: f.transport }); await assert.rejects(reopened.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});
for (const [label, body] of Object.entries({ truncatedFrame: stream().trimEnd(), incompleteUsage: stream(events().slice(0, 5)), malformedJSON: 'event: message_start\ndata: {\n\n' })) test(`${label} holds conservative charge`, async () => {
  const f = fixture({ body }); try { await assert.rejects(f.observer.handle(attempt()), /outcome unknown/); assert.equal(f.observer.ledger.snapshot(f.g.id).costUsd, 0.0012); assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 120); } finally { f.dispose(); }
});
for (const [label, mutate] of Object.entries({ tier: (x: any): unknown => x.service_tier = 'auto', geo: (x: any): unknown => x.inference_geo = 'us', speed: (x: any): unknown => x.speed = 'fast',
  hosted: (x: any): unknown => x.tools.push({ type: 'web_search_20250305', name: 'web_search' }), media: (x: any): unknown => x.messages[0].content = [{ type: 'image', source: {} }],
  unsignedThinking: (x: any): unknown => delete x.messages[1].content[0].signature, thinkingMismatch: (x: any): unknown => x.thinking = { type: 'disabled' },
  effortMismatch: (x: any): unknown => x.output_config.effort = 'low', context: (x: any): unknown => x.context_management = {}, batch: (x: any): unknown => x.batch = true,
  deferredTool: (x: any): unknown => x.tools[0].defer_loading = true,
})) test(`request ${label} is refused with no physical dispatch`, async () => {
  const f = fixture(); try { const body = JSON.parse(payload()); mutate(body); await assert.rejects(f.observer.handle(attempt(JSON.stringify(body)))); assert.equal(f.calls(), 0); assert.equal(f.observer.ledger.snapshot(f.g.id).requests, 0); assert.equal(f.store.list('baseline-refusals').length, 1); } finally { f.dispose(); }
});
test('native beta dimensions are refused rather than silently removed', async () => {
  const f = fixture(); try { await assert.rejects(f.observer.handle({ ...attempt(), nativeHttp: { path: '/v1/messages?beta=true', headers: { 'anthropic-beta': 'unqualified-feature' } } }), /unsupported native/); assert.equal(f.calls(), 0); } finally { f.dispose(); }
});
test('concurrent and cancelled requests retain reservations and reopen never replays', async () => {
  const f = fixture({ transport: () => new Promise(() => {}) });
  try { const pending = f.observer.handle(attempt()); await assert.rejects(f.observer.handle(attempt()), /budget|allocation/);
    const during = f.observer.ledger.snapshot(f.g.id); assert.equal(during.tokens, 120); assert.equal(during.costUsd, 0.0012); assert.equal(during.concurrent, 1);
    f.observer.cancel(); await assert.rejects(pending, /outcome unknown/); const reopened = new BaselineObserver({ store: f.store, grant: f.g, transport: f.transport });
    await assert.rejects(reopened.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 1); assert.equal(reopened.ledger.snapshot(f.g.id).tokens, 120);
  } finally { f.dispose(); }
});
test('host account profile is immutable and a changed price cannot reopen it', async () => {
  const f = fixture(); try { await f.observer.handle(attempt()); const changed = grant(); changed.profile.prices.cacheWrite1hUsdPerMillion = 9;
    assert.throws(() => new BaselineObserver({ store: f.store, grant: changed, transport: f.transport }), /immutable/);
    assert.throws(() => new BaselineObserver({ store: f.store, grant: { ...f.g, id: 'replacement' }, transport: f.transport }), /different grant/);
  } finally { f.dispose(); }
});
test('first-party transport pins endpoint/version, disables redirects and never embeds host key in payload/evidence', async () => {
  const transport = anthropicTransport('PRIVATE_SYNTHETIC_KEY', (async (url, options) => {
    assert.equal(url, ANTHROPIC_MESSAGES_ENDPOINT); assert.equal(options!.redirect, 'error'); const headers = options!.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'PRIVATE_SYNTHETIC_KEY'); assert.equal(headers['anthropic-version'], '2023-06-01'); assert.equal(String(options!.body).includes('PRIVATE_SYNTHETIC_KEY'), false);
    return new Response(stream(), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch);
  const f = fixture({ transport }); try { await f.observer.handle(attempt()); assert.equal(JSON.stringify(f.observer.evidence()).includes('PRIVATE_SYNTHETIC_KEY'), false); } finally { f.dispose(); }
});
test('native real profile retains tool/effort/role options and leaves adaptive thinking enabled; fixture invocation stays bounded', () => {
  const real = claudeInvocation({ model: grant().profile.model, effort: 'xhigh', profile: 'anthropic', claudeOptions: { tools: 'default', modelRoles: { opus: grant().profile.model } } }, 1234);
  assert.equal(real.args[real.args.indexOf('--tools') + 1], 'default'); assert.equal(real.args[real.args.indexOf('--effort') + 1], 'xhigh');
  assert.equal(real.environment.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING, undefined); assert.equal(real.environment.MAX_THINKING_TOKENS, undefined);
  assert.equal(real.environment.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined); assert.equal(real.environment.CLAUDE_CODE_SUBAGENT_MODEL, undefined);
  assert.equal(real.environment.ANTHROPIC_DEFAULT_OPUS_MODEL, grant().profile.model);
  const synthetic = claudeInvocation({ model: 'fixture-model', effort: 'low', profile: 'anthropic-fixture' }, 1234);
  assert.equal(synthetic.args[synthetic.args.indexOf('--tools') + 1], 'Bash'); assert.equal(synthetic.environment.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING, '1'); assert.equal(synthetic.environment.MAX_THINKING_TOKENS, '0');
});

test('paid real transport requires kernel limits before private state or dispatch, and unsupported model roles are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-anthropic-entry-')); const state = join(root, 'unopened');
  const input: ClaudeBaselineRun = { checkoutRoot: root, workspace: root, privateStateRoot: state, protectedPaths: [root],
    native: { claude: '/usr/bin/true', version: 'unlaunched', claudeSha256: '0'.repeat(64) }, prompt: 'Unlaunched', grant: grant(), maxCliOutputBytes: 100,
    claudeOptions: { tools: 'default' }, provider: { kind: 'fixture', transport: async () => { throw new Error('must not enter'); } } };
  try {
    await assert.rejects(runClaudeBaseline({ ...input, provider: { kind: 'anthropic', apiKey: 'UNUSED_SYNTHETIC_KEY' } as ClaudeBaselineRun['provider'] }), /kernel limits/);
    assert.equal(existsSync(state), false);
    await assert.rejects(runClaudeBaseline({ ...input, claudeOptions: { tools: 'default', modelRoles: { subagent: 'other-model' } } }), /separately priced/);
    assert.equal(existsSync(state), false);
    await assert.rejects(runClaudeBaseline({ ...input, claudeOptions: undefined }), /tool selection/);
    assert.equal(existsSync(state), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const control of ['output_config', 'thinking'] as const) test(`missing native ${control} cannot silently satisfy the frozen cognition profile`, async () => {
  const f = fixture();
  try {
    const body = JSON.parse(payload()); delete body[control];
    await assert.rejects(f.observer.handle(attempt(JSON.stringify(body))), /explicit native/);
    assert.equal(f.calls(), 0); assert.equal(f.observer.evidence().length, 0);
    assert.equal(f.observer.ledger.snapshot(f.g.id).requests, 0);
  } finally { f.dispose(); }
});

test('manual thinking below the public API minimum is refused at grant admission', () => {
  const g = grant(); g.profile.anthropic!.thinking = 'enabled'; g.profile.anthropic!.thinkingBudgetTokens = 10;
  assert.throws(() => validateObserverGrant(g), /1,024/);
});

for (const maxTokens of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '20', undefined]) test(`native max_tokens ${String(maxTokens)} cannot become a positive generation by host rewriting`, async () => {
  const f = fixture();
  try {
    const body = JSON.parse(payload()); body.max_tokens = maxTokens; body.stream = false;
    await assert.rejects(f.observer.handle(attempt(JSON.stringify(body))), /positive generation max_tokens/);
    assert.equal(f.calls(), 0); assert.equal(f.observer.ledger.snapshot(f.g.id).requests, 0);
  } finally { f.dispose(); }
});

test('valid explicit manual thinking preserves the native budget and settles output once', async () => {
  const g = grant(); g.profile.maxOutputTokens = 2048; g.resources.maxTokens = 3000;
  g.profile.anthropic!.thinking = 'enabled'; g.profile.anthropic!.thinkingBudgetTokens = 1024;
  const body = JSON.parse(payload()); body.thinking = { type: 'enabled', budget_tokens: 1024 };
  const f = fixture({ grant: g });
  try {
    await f.observer.handle(attempt(JSON.stringify(body)));
    assert.deepEqual(JSON.parse(f.forwarded()).thinking, body.thinking);
    assert.equal(f.observer.evidence()[0]!.usage?.outputTokens, 5);
    assert.equal(f.observer.ledger.snapshot(g.id).tokens, 24);
  } finally { f.dispose(); }
});

test('a caller cannot mutate the original profile to weaken cognition or reservation after admission', async () => {
  const original = grant(); const f = fixture({ grant: original });
  try {
    original.profile.effort = 'low'; original.profile.anthropic!.thinking = 'disabled';
    original.profile.prices.cacheWrite1hUsdPerMillion = 0; original.resources.maxTokens = 1;
    const body = JSON.parse(payload()); body.output_config.effort = 'low'; body.thinking = { type: 'disabled' };
    await assert.rejects(f.observer.handle(attempt(JSON.stringify(body))), /effort differs/);
    assert.equal(f.calls(), 0); assert.equal(f.observer.ledger.defaultCeiling.costUsd, 0.0012);
    await f.observer.handle(attempt()); assert.equal(f.calls(), 1);
    assert.equal(f.observer.evidence()[0]!.usage?.costUsd, 174.8 / 1_000_000);
  } finally { f.dispose(); }
});
