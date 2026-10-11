import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver } from './observer.ts';
import type { BaselineTransport, ObserverGrant, ProviderAttempt } from './observer.ts';
import { anthropicTransport } from './anthropic-codec.ts';
import { PINNED_CLAUDE_BETA, PINNED_CLAUDE_SHA256, PINNED_CLAUDE_VERSION } from './anthropic-native-protocol.ts';
import { runClaudeBaseline } from './run-claude.ts';
import type { ClaudeBaselineRun } from './run-claude.ts';

const MODEL = 'claude-opus-5-5'; // Native capability selection only; synthetic transport proves no entitlement or model behavior.
const CAP = 4096;
function grant(context = 100): ObserverGrant {
  return { id: 'original-pinned-native-grant', resources: { maxRequests: 2, maxTokens: 2 * (context + CAP), maxCostUsd: 20, maxElapsedMs: 60_000, maxConcurrency: 1 },
    profile: { provider: 'anthropic', model: MODEL, effort: 'high', contextContract: context === 1_000_000 ? 'full 1M input contract retained for synthetic native qualification; not a tighter prompt estimate' : 'synthetic unit input bound', contextWindowTokens: context, maxOutputTokens: CAP,
      prices: { source: 'synthetic category rates; not provider pricing', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8, outputUsdPerMillion: 20 },
      anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', nativeProtocol: {
        kind: 'opus-adaptive-coding', claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01', beta: PINNED_CLAUDE_BETA, qualification: 'synthetic-only' } } },
    requestTimeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 };
}
function payload(): string { return JSON.stringify({ model: MODEL, max_tokens: 8192, stream: true, thinking: { type: 'adaptive', display: 'updates' }, output_config: { effort: 'high' },
  context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }, { type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 50 }, keep: { type: 'tool_uses', value: 3 }, exclude_tools: ['Bash'], clear_tool_inputs: false }] },
  system: [{ type: 'text', text: 'Native attribution block stays first.' }, { type: 'text', text: 'Native instructions.', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Verify local work.' }, { role: 'system', content: [{ type: 'text', text: 'Native mid-conversation instructions.', cache_control: { type: 'ephemeral' } }], clear_at: 'never', output_config: { effort: 'high' } },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'native-signature' }, { type: 'redacted_thinking', data: 'encrypted-native-block' }, { type: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'true' }, caller: { type: 'direct' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'Observed native command.' }] }],
  tools: [{ name: 'Bash', input_schema: { type: 'object' }, strict: true, defer_loading: false, cache_control: { type: 'ephemeral' } }] }); }
function attempt(body = payload()): ProviderAttempt { return { method: 'POST', path: '/v1/messages', payload: body,
  nativeHttp: { path: '/v1/messages?beta=true', headers: { 'anthropic-beta': PINNED_CLAUDE_BETA, 'anthropic-version': '2023-06-01', 'x-api-key': 'dummy-native-gateway-token', 'x-claude-code-session-id': 'session' } } }; }
function events(block: Record<string, unknown> = { type: 'text', text: 'Complete.' }): any[] { return [
  { type: 'message_start', message: { id: 'msg_native_synthetic', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: {
    input_tokens: 10, cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 }, cache_read_input_tokens: 4, output_tokens: 1, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 100_000 } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'synthetic-preserved-signature' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'synthetic-redacted-native-data' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 2, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 30, output_tokens_details: { thinking_tokens: 12 } }, context_management: { applied_edits: [{ type: 'clear_tool_uses_20250919', cleared_tool_uses: 0, cleared_input_tokens: 0 }] } },
  { type: 'message_stop' },
]; }
const stream = (list = events()) => list.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
function fixture(transport?: BaselineTransport) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-native-protocol-unit-')); const store = new OperationalStore({ filename: join(root, 'state.sqlite') }); const g = grant(); let calls = 0;
  const observer = new BaselineObserver({ store, grant: g, transport: async (...args) => { calls++; return transport ? transport(...args) : new Response(stream(), { headers: { 'content-type': 'text/event-stream' } }); } });
  return { root, store, g, observer, calls: () => calls, dispose() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('pinned protocol forwards beta/version unchanged, consumes native authentication and preserves context/cognition/cache payloads', async () => {
  let outgoing = '', seenHeaders: unknown;
  const transport = anthropicTransport('HOST_SYNTHETIC_KEY', (async (_url, options) => {
    outgoing = String(options!.body); seenHeaders = options!.headers;
    return new Response(stream(), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch);
  const f = fixture(transport);
  try { await f.observer.handle(attempt()); const headers = seenHeaders as Record<string, string>;
    assert.equal(headers['anthropic-beta'], PINNED_CLAUDE_BETA); assert.equal(headers['anthropic-version'], '2023-06-01'); assert.equal(headers['x-api-key'], 'HOST_SYNTHETIC_KEY');
    assert.equal(headers.authorization, undefined); assert.equal(headers['x-claude-code-session-id'], undefined);
    for (const key of ['thinking', 'output_config', 'context_management', 'system', 'messages', 'tools']) assert.deepEqual(JSON.parse(outgoing)[key], JSON.parse(payload())[key]);
    const record = f.observer.evidence()[0]!; assert.deepEqual(JSON.parse(Buffer.from(f.store.readArtifact(record.nativeHttp!)).toString()), attempt().nativeHttp);
    assert.equal(record.usage?.inputTokens, 19); assert.equal(record.usage?.outputTokens, 30); assert.equal(record.usage?.costUsd, 674.8 / 1_000_000);
    assert.equal(record.anthropicReceipt?.thinkingTokens, 12); assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 49);
  } finally { f.dispose(); }
});
for (const [label, change] of Object.entries({
  betaChange: (a: ProviderAttempt): unknown => a.nativeHttp!.headers['anthropic-beta'] = PINNED_CLAUDE_BETA + ',fast-mode-2026-02-01',
  betaRemoved: (a: ProviderAttempt): unknown => delete a.nativeHttp!.headers['anthropic-beta'],
  versionChange: (a: ProviderAttempt): unknown => a.nativeHttp!.headers['anthropic-version'] = 'other',
  duplicateCase: (a: ProviderAttempt): unknown => a.nativeHttp!.headers['Anthropic-Beta'] = PINNED_CLAUDE_BETA,
  workspace: (a: ProviderAttempt): unknown => a.nativeHttp!.headers['anthropic-workspace-id'] = 'other',
  unknownHeader: (a: ProviderAttempt): unknown => a.nativeHttp!.headers['anthropic-future-billing'] = 'enabled',
  arrayBeta: (a: ProviderAttempt): unknown => a.nativeHttp!.headers['anthropic-beta'] = [PINNED_CLAUDE_BETA],
  missingHttp: (a: ProviderAttempt): unknown => delete a.nativeHttp,
})) test(`${label} refuses dispatch and preserves the original grant`, async () => {
  const f = fixture(); try { const a = attempt(); change(a); await assert.rejects(f.observer.handle(a)); assert.equal(f.calls(), 0); assert.equal(f.observer.ledger.snapshot(f.g.id).requests, 0); assert.equal(f.store.list('baseline-refusals').length, 1);
    const refusal = f.store.list<any>('baseline-refusals')[0]!.value; if (a.nativeHttp) { const recorded = JSON.parse(Buffer.from(f.store.readArtifact(refusal.nativeHttp)).toString());
      assert.deepEqual(recorded, { path: a.nativeHttp.path, headers: Object.fromEntries(Object.entries(a.nativeHttp.headers).filter(([key]) => ['anthropic-version', 'anthropic-beta'].includes(key.toLowerCase()))) });
      assert.equal(JSON.stringify(recorded).includes('dummy-native-gateway-token'), false);
    }
  } finally { f.dispose(); }
});
for (const [label, change] of Object.entries({
  unsupportedContext: (b: any): unknown => b.context_management.edits.push({ type: 'compact_20260112' }),
  invalidContextThreshold: (b: any): unknown => b.context_management.edits[1].trigger.value = -1,
  unknownContextField: (b: any): unknown => b.context_management.server_tool = 'hosted',
  changedMidturnEffort: (b: any): unknown => b.messages[1].output_config.effort = 'low',
  hostedCaller: (b: any): unknown => b.messages[2].content[2].caller = { type: 'code_execution_20260120', tool_id: 'hosted' },
  deferredTool: (b: any): unknown => b.tools[0].defer_loading = true,
  missingThinking: (b: any): unknown => delete b.thinking,
  missingEffort: (b: any): unknown => delete b.output_config,
  zeroPrewarm: (b: any): unknown => b.max_tokens = 0,
})) test(`${label} remains a visible native feature refusal before dispatch`, async () => {
  const f = fixture(); try { const b = JSON.parse(payload()); change(b); await assert.rejects(f.observer.handle(attempt(JSON.stringify(b)))); assert.equal(f.calls(), 0); } finally { f.dispose(); }
});
for (const [label, change] of Object.entries({
  progressNegative: (x: any[]): unknown => x[2].delta.estimated_tokens = -1,
  progressFractional: (x: any[]): unknown => x[2].delta.estimated_tokens = 0.5,
  unknownAppliedContext: (x: any[]): unknown => x[10].context_management.applied_edits[0].type = 'compact_20260112',
  extraBilledIteration: (x: any[]): unknown => x[10].usage.iterations = [{ model: 'other', output_tokens: 100 }],
  missingFinalUsage: (x: any[]): unknown => delete x[10].usage.output_tokens,
})) test(`${label} retains full reservation, cancels the original grant and prevents replay`, async () => {
  const list = events(); change(list); const f = fixture(async () => new Response(stream(list), { headers: { 'content-type': 'text/event-stream' } }));
  try { await assert.rejects(f.observer.handle(attempt()), /outcome unknown/); const s = f.observer.ledger.snapshot(f.g.id); assert.equal(s.tokens, 100 + CAP); assert.equal(s.costUsd, (100 * 8 + CAP * 20) / 1_000_000); assert.equal(s.cancelled, true);
    await assert.rejects(f.observer.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});

test('pinned native compatibility cannot silently become a paid transport or a different native binary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-native-entry-')); const state = join(root, 'state');
  const input: ClaudeBaselineRun = { checkoutRoot: root, workspace: root, privateStateRoot: state, protectedPaths: [root],
    native: { claude: '/unused', version: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256 }, prompt: 'Unlaunched', grant: grant(), maxCliOutputBytes: 100,
    claudeOptions: { tools: 'Bash,Read,Edit,Write,Glob,Grep' }, provider: { kind: 'fixture', transport: async () => { throw new Error('never'); } } };
  try { await assert.rejects(runClaudeBaseline({ ...input, provider: { kind: 'anthropic', apiKey: 'UNUSED', resourceLimits: {} } as ClaudeBaselineRun['provider'] }), /synthetic-only/); assert.equal(existsSync(state), false);
    await assert.rejects(runClaudeBaseline({ ...input, native: { ...input.native, version: 'other' } }), /pinned protocol/); assert.equal(existsSync(state), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pinned actual native first-party profile executes local coding tool and preserves thinking/context/cache continuation under its original full-context grant', {
  skip: process.env.AEON_CLAUDE_COMPATIBILITY_RUN !== '1', timeout: 75_000,
}, async context => {
  const evidenceRoot = process.env.AEON_CLAUDE_COMPATIBILITY_EVIDENCE; assert.ok(evidenceRoot, 'explicit external evidence destination required');
  const root = mkdtempSync(join(evidenceRoot, 'native-compatibility-')); const checkoutRoot = join(root, 'checkout'), workspace = join(root, 'workspace'), privateRoot = join(root, 'protected'), state = join(root, 'state');
  for (const path of [checkoutRoot, workspace, privateRoot]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(workspace, 'numbers.json'), '[3,5,7]\n'); writeFileSync(join(privateRoot, 'sentinel'), 'PRIVATE_NATIVE_COMPARATOR');
  let calls = 0; let refusal: unknown; const captured: any[] = [];
  const input: ClaudeBaselineRun = { checkoutRoot, workspace, privateStateRoot: state, protectedPaths: [privateRoot],
    native: { claude: '/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296', version: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256 },
    prompt: 'Use a local coding tool to read numbers.json, compute their sum, write proof.json with that sum, and report the observed result. Preserve your native thinking and context management.',
    grant: grant(1_000_000), maxCliOutputBytes: 1_000_000,
    claudeOptions: { tools: 'Bash,Read,Edit,Write,Glob,Grep' }, provider: { kind: 'fixture', transport: async (body, signal, protocol) => {
      try { signal.throwIfAborted(); calls++; assert.ok(calls <= 2); assert.equal(protocol?.beta, PINNED_CLAUDE_BETA); const request = JSON.parse(body); captured.push(request);
        assert.equal(request.model, MODEL); assert.equal(request.thinking.type, 'adaptive'); assert.equal(request.thinking.display, 'updates'); assert.deepEqual(request.context_management, { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] }); assert.equal(request.output_config.effort, 'high'); assert.equal(request.max_tokens, CAP);
        assert.equal(body.includes('PRIVATE_NATIVE_COMPARATOR'), false);
        let block: Record<string, unknown>;
        if (calls === 1) {
          assert.ok(request.tools.some((tool: any) => tool.name === 'Bash'));
          const program = `const fs=require('node:fs');const values=JSON.parse(fs.readFileSync('numbers.json','utf8'));const sum=values.reduce((a,b)=>a+b,0);fs.writeFileSync('proof.json',JSON.stringify({sum}));console.log('observed-sum='+sum);`;
          block = { type: 'tool_use', id: 'tool_native_observation', name: 'Bash', input: { command: `/runtime/node -e '${program.replaceAll("'", "'\\''")}'`, description: 'Compute and verify the local fixture result', timeout: 5000 } };
        } else {
          const flattened = request.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []);
          assert.ok(flattened.some((part: any) => part.type === 'tool_result' && part.tool_use_id === 'tool_native_observation' && JSON.stringify(part.content).includes('observed-sum=15')));
          assert.ok(flattened.some((part: any) => part.type === 'thinking' && part.signature === 'synthetic-preserved-signature'));
          assert.ok(flattened.some((part: any) => part.type === 'redacted_thinking' && part.data === 'synthetic-redacted-native-data'));
          block = { type: 'text', text: 'native-compatibility-complete; observed-sum=15' };
        }
        return new Response(stream(events(block)), { headers: { 'content-type': 'text/event-stream' } });
      } catch (error) { refusal = error; throw error; }
    } } };
  try { const result = await runClaudeBaseline(input); const outcome = result.outcome as { code: number; stdout: string; stderr: string; exceeded: boolean };
    writeFileSync(join(root, 'outcome.json'), JSON.stringify({ result, calls, refusal: String(refusal) }, null, 2));
    assert.equal(outcome.code, 0, `${outcome.stderr}\n${outcome.stdout}\n${String(refusal)}`); assert.equal(outcome.exceeded, false); assert.match(outcome.stdout, /native-compatibility-complete/);
    assert.equal(calls, 2); assert.equal(result.physicalRequests, 2); assert.deepEqual(JSON.parse(readFileSync(join(workspace, 'proof.json'), 'utf8')), { sum: 15 });
    assert.equal(readFileSync(join(privateRoot, 'sentinel'), 'utf8'), 'PRIVATE_NATIVE_COMPARATOR');
    const store = new OperationalStore({ filename: join(state, 'observer.sqlite') });
    try { const attempts = store.list<any>('baseline-attempts'); assert.equal(attempts.length, 2);
      for (const row of attempts) {
        assert.equal(row.value.outcome, 'completed'); assert.equal(row.value.usage.inputTokens, 19); assert.equal(row.value.usage.outputTokens, 30); assert.equal(row.value.usage.costUsd, 674.8 / 1_000_000);
        const before = JSON.parse(Buffer.from(store.readArtifact(row.value.before)).toString()), after = JSON.parse(Buffer.from(store.readArtifact(row.value.after)).toString());
        for (const key of ['system', 'messages', 'tools', 'thinking', 'output_config', 'context_management']) assert.deepEqual(before[key], after[key]);
        const http = JSON.parse(Buffer.from(store.readArtifact(row.value.nativeHttp)).toString()); assert.equal(http.headers['anthropic-beta'], PINNED_CLAUDE_BETA); assert.equal(http.headers['anthropic-version'], '2023-06-01');
      }
      const manifest = store.get<any>('baseline-run', 'run')!.value.specification;
      assert.equal(manifest.grant.profile.contextWindowTokens, 1_000_000); assert.equal(manifest.nativeConfiguration.thinking, 'adaptive'); assert.equal(manifest.nativeConfiguration.tools, 'Bash,Read,Edit,Write,Glob,Grep');
      assert.equal(manifest.nativeInvocation.environment.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING, undefined); assert.equal(manifest.nativeInvocation.environment.MAX_THINKING_TOKENS, undefined);
      writeFileSync(join(root, 'summary.json'), JSON.stringify({ sourceIdentity: manifest.sourceIdentity, grant: manifest.grant, attempts: attempts.map(row => row.value), capturedRequestFields: captured.map(request => Object.keys(request)) }, null, 2));
    } finally { store.close(); }
    await assert.rejects(runClaudeBaseline(input), /unavailable or stopped/); assert.equal(calls, 2); context.diagnostic(JSON.stringify({ evidence: root, physicalSyntheticRequests: calls }));
  } catch (error) { writeFileSync(join(root, 'failure.json'), JSON.stringify({ calls, refusal: String(refusal), error: String(error), capturedRequestFields: captured.map(request => Object.keys(request)) }, null, 2)); throw error; }
});
