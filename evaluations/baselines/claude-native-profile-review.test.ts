import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver, validateObserverGrant } from './observer.ts';
import type { ObserverGrant, ProviderAttempt } from './observer.ts';
import { PINNED_CLAUDE_BETA, PINNED_CLAUDE_SHA256, PINNED_CLAUDE_VERSION, HISTORICAL_CLAUDE_FIXTURE_BETA } from './anthropic-native-protocol.ts';
import { runClaudeBaseline } from './run-claude.ts';
import type { ClaudeBaselineRun } from './run-claude.ts';

// Independent review fixtures: no native process, provider endpoint, credential discovery or network.
function grant(): ObserverGrant {
  return { id: 'review-original-grant', resources: { maxRequests: 2, maxTokens: 2_008_192, maxCostUsd: 20, maxElapsedMs: 60_000, maxConcurrency: 1 },
    profile: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', contextWindowTokens: 1_000_000, maxOutputTokens: 4096,
      contextContract: 'Synthetic full input ceiling; not an input length estimate',
      prices: { source: 'review synthetic categories, no provider price claim', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20, cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 },
      anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard',
        nativeProtocol: { kind: 'opus-adaptive-coding', claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01', beta: PINNED_CLAUDE_BETA, qualification: 'synthetic-only' } } },
    requestTimeoutMs: 1000, maxRequestBytes: 100_000, maxResponseBytes: 100_000 };
}
function body() {
  return { model: 'claude-opus-5-5', max_tokens: 8192, stream: true, output_config: { effort: 'high' }, thinking: { type: 'adaptive', display: 'updates' },
    system: [{ type: 'text', text: 'Attribution stays at index zero.' }, { type: 'text', text: 'Independent native review instructions.', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [ { role: 'user', content: 'Read the local observation.' },
      { role: 'system', content: 'Continue under the native controls.', output_config: { effort: 'high' }, cache_control: { type: 'ephemeral' } },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'opaque-signed-thinking' }, { type: 'redacted_thinking', data: 'opaque-redacted-thinking' }] } ],
    context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] },
    tools: [{ name: 'Read', input_schema: { type: 'object', properties: { path: { type: 'string' } } }, strict: true }] };
}
function attempt(payload: unknown = body()): ProviderAttempt {
  return { method: 'POST', path: '/v1/messages', payload: JSON.stringify(payload), nativeHttp: { path: '/v1/messages?beta=true',
    headers: { 'Anthropic-Version': '2023-06-01', 'Anthropic-Beta': PINNED_CLAUDE_BETA } } };
}
function events(): any[] {
  return [ { type: 'message_start', message: { id: 'msg_independent_review', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [],
    usage: { input_tokens: 13, cache_creation_input_tokens: 7, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 5 }, cache_read_input_tokens: 17, output_tokens: 1, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 999_999_999 } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 23, output_tokens_details: { thinking_tokens: 11 } },
      context_management: { applied_edits: [{ type: 'clear_thinking_20251015', cleared_thinking_turns: 0, cleared_input_tokens: 0 }] } },
    { type: 'message_stop' } ];
}
const stream = (list: any[]) => list.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
function fixture(list = events()) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-native-independent-review-'));
  const filename = join(root, 'state.sqlite'); const store = new OperationalStore({ filename }); const original = grant(); let calls = 0;
  const outgoing: { payload: string; protocol: unknown }[] = [];
  const transport = async (payload: string, _signal: AbortSignal, protocol: unknown) => {
    calls++; outgoing.push({ payload, protocol }); return new Response(stream(list), { headers: { 'content-type': 'text/event-stream' } });
  };
  const observer = new BaselineObserver({ store, grant: original, transport });
  return { store, original, observer, outgoing, transport, calls: () => calls, dispose() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('review: exact profile and semantic controls survive caller grant mutation; estimates never settle as usage', async () => {
  const f = fixture(); try {
    f.original.profile.effort = 'low'; f.original.profile.anthropic!.nativeProtocol!.beta = HISTORICAL_CLAUDE_FIXTURE_BETA;
    f.original.resources.maxRequests = 99; f.original.profile.prices.outputUsdPerMillion = 0;
    await f.observer.handle(attempt()); assert.equal(f.calls(), 1);
    const sent = JSON.parse(f.outgoing[0]!.payload); const input = body();
    assert.deepEqual(sent, { ...input, max_tokens: 4096, service_tier: 'standard_only', inference_geo: 'global' });
    assert.deepEqual(f.outgoing[0]!.protocol, { version: '2023-06-01', beta: PINNED_CLAUDE_BETA });
    const record = f.observer.evidence()[0]!;
    assert.deepEqual(JSON.parse(Buffer.from(f.store.readArtifact(record.before)).toString()), input);
    assert.deepEqual(JSON.parse(Buffer.from(f.store.readArtifact(record.after)).toString()), sent);
    assert.equal(record.usage!.inputTokens, 37); assert.equal(record.usage!.outputTokens, 23);
    assert.equal(record.anthropicReceipt!.thinkingTokens, 11); assert.equal(record.usage!.costUsd, 565.4 / 1_000_000);
    assert.equal(f.observer.ledger.snapshot(grant().id).tokens, 60);
    assert.deepEqual(f.store.get<ObserverGrant>('baseline-grants', grant().id)!.value, grant());
  } finally { f.dispose(); }
});

for (const [name, mutate] of Object.entries({
  historicalHeader: (g: ObserverGrant) => { g.profile.anthropic!.nativeProtocol!.beta = HISTORICAL_CLAUDE_FIXTURE_BETA; },
  alteredBinary: (g: ObserverGrant) => { g.profile.anthropic!.nativeProtocol!.claudeSha256 = '0'.repeat(64); },
  alteredVersion: (g: ObserverGrant) => { g.profile.anthropic!.nativeProtocol!.claudeVersion = 'future'; },
  alteredModel: (g: ObserverGrant) => { g.profile.model = 'claude-sonnet-5-5'; },
  weakenedCognition: (g: ObserverGrant) => { g.profile.effort = 'low'; },
})) test(`review: ${name} cannot be relabelled as the captured high-effort Opus native profile`, () => {
  const g = grant(); mutate(g); assert.throws(() => validateObserverGrant(g));
});

for (const [name, mutate] of Object.entries({
  unpairedClearAtNever: (b: any) => { b.messages[1].clear_at = 'never'; },
  unpairedTurnScopedReminder: (b: any) => { b.messages[1].clear_at = 'next_user_message'; delete b.messages[1].output_config; },
  turnScopedOutputControl: (b: any) => { b.messages[1].clear_at = 'next_user_message'; },
  missingEffort: (b: any) => { delete b.output_config; },
  missingThinking: (b: any) => { delete b.thinking; },
  changedMidturnEffort: (b: any) => { b.messages[1].output_config.effort = 'low'; },
  unpricedSpeed: (b: any) => { b.speed = 'fast'; },
  hostedIteration: (b: any) => { b.context_management.edits.push({ type: 'compact_20260112' }); },
})) test(`review: ${name} is preserved as a refusal with zero transport calls and the original budget`, async () => {
  const f = fixture(); try {
    const input = body(); mutate(input); await assert.rejects(f.observer.handle(attempt(input))); assert.equal(f.calls(), 0);
    const refused = f.store.list<any>('baseline-refusals')[0]!.value;
    assert.deepEqual(JSON.parse(Buffer.from(f.store.readArtifact(refused.request)).toString()), input);
    assert.equal(f.observer.ledger.snapshot(grant().id).requests, 0);
    assert.deepEqual(f.store.get<ObserverGrant>('baseline-grants', grant().id)!.value, grant());
  } finally { f.dispose(); }
});

for (const [name, mutate] of Object.entries({
  estimatedOnly: (e: any[]) => { delete e[4].usage.output_tokens; },
  unpricedUsage: (e: any[]) => { e[4].usage.server_tool_use = { web_search_requests: 1 }; },
  extraIteration: (e: any[]) => { e[4].usage.iterations = [{ input_tokens: 3, output_tokens: 7 }]; },
  incompleteStream: (e: any[]) => { e.pop(); },
})) test(`review: ${name} retains full unknown charge across observer restart without a replay`, async () => {
  const list = events(); mutate(list); const f = fixture(list); try {
    await assert.rejects(f.observer.handle(attempt()), /outcome unknown/);
    const snapshot = f.observer.ledger.snapshot(grant().id);
    assert.equal(snapshot.requests, 1); assert.equal(snapshot.tokens, 1_004_096); assert.equal(snapshot.costUsd, 8.08192); assert.equal(snapshot.cancelled, true);
    const beforeRestart = f.observer.evidence()[0]!; assert.equal(beforeRestart.outcome, 'unknown'); assert.equal(beforeRestart.usage!.costUsd, null);
    const restarted = new BaselineObserver({ store: f.store, grant: grant(), transport: f.transport });
    await assert.rejects(restarted.handle(attempt())); assert.equal(f.calls(), 1);
    assert.deepEqual(restarted.ledger.snapshot(grant().id), snapshot);
    const enlarged = grant(); enlarged.resources.maxRequests = 3;
    assert.throws(() => new BaselineObserver({ store: f.store, grant: enlarged, transport: f.transport }), /immutable baseline grant/);
  } finally { f.dispose(); }
});

test('review: paid entry and swapped binary are refused before filesystem preparation or native launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-native-review-entry-')); const state = join(root, 'state');
  const input: ClaudeBaselineRun = { checkoutRoot: root, workspace: root, privateStateRoot: state, protectedPaths: [root],
    native: { claude: '/unused-review-binary', version: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256 },
    prompt: 'Never launched', grant: grant(), maxCliOutputBytes: 100, claudeOptions: { tools: 'Bash,Edit,Read' },
    provider: { kind: 'fixture', transport: async () => { throw new Error('unexpected dispatch'); } } };
  try {
    await assert.rejects(runClaudeBaseline({ ...input, provider: { kind: 'anthropic', apiKey: 'UNUSED_SYNTHETIC', resourceLimits: {} } as ClaudeBaselineRun['provider'] }), /synthetic-only/);
    assert.equal(existsSync(state), false);
    await assert.rejects(runClaudeBaseline({ ...input, native: { ...input.native, claudeSha256: '0'.repeat(64) } }), /binary\/version/);
    assert.equal(existsSync(state), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
