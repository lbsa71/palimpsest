import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver, validateObserverGrant } from './observer.ts';
import type { BaselineTransport, ObserverGrant, ProviderAttempt } from './observer.ts';
import { PINNED_CODEX_VERSION, PINNED_CODEX_SHA256, PINNED_CODEX_HELPER_SHA256 } from './codex-native-protocol.ts';
import { PINNED_CLAUDE_VERSION, PINNED_CLAUDE_SHA256, PINNED_CLAUDE_DELEGATION_BETA } from './anthropic-native-protocol.ts';
import { codexObservedToolOutput, codexParentReceipt, claudeParentReceipts, claudeTaskBindings } from './native-delegation-fixture.ts';

const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const fixtureBytes = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
function grant(kind: 'codex' | 'claude'): ObserverGrant {
  const claude = kind === 'claude';
  return { id: 'independent-native-review', resources: { maxRequests: 8, maxTokens: 8 * ((claude ? 1_000_000 : 200_000) + 4096), maxCostUsd: 100, maxElapsedMs: 60_000, maxConcurrency: 2 },
    profile: { provider: claude ? 'anthropic' : 'openai', model: claude ? 'claude-opus-5-5' : 'gpt-6-astra', effort: 'high', contextContract: 'Original full native context, offline synthetic review', contextWindowTokens: claude ? 1_000_000 : 200_000, maxOutputTokens: 4096,
      prices: { source: 'synthetic review rates', inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20, ...(claude ? { cacheWrite5mUsdPerMillion: 5, cacheWrite1hUsdPerMillion: 8 } : {}) },
      ...(claude ? { anthropic: { thinking: 'adaptive', serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', nativeProtocol: { kind: 'opus-adaptive-delegation', claudeVersion: PINNED_CLAUDE_VERSION, claudeSha256: PINNED_CLAUDE_SHA256, version: '2023-06-01', beta: PINNED_CLAUDE_DELEGATION_BETA, qualification: 'synthetic-only' } } } : { codexNativeProtocol: { kind: 'agent-message-v1', codexVersion: PINNED_CODEX_VERSION, codexSha256: PINNED_CODEX_SHA256, helperSha256: PINNED_CODEX_HELPER_SHA256, qualification: 'synthetic-only' } }) },
    requestTimeoutMs: 1000, maxRequestBytes: 1_000_000, maxResponseBytes: 1_000_000 };
}
function attempt(kind: 'codex' | 'claude', index = 0): ProviderAttempt {
  if (kind === 'codex') return { method: 'POST', path: '/v1/responses', payload: fixtureBytes(`codex-child-${index}-0.162.1.json`) };
  const nativeHttp = JSON.parse(fixtureBytes('claude-delegation-child-http-2.1.296.json'));
  Object.assign(nativeHttp.headers, { 'x-claude-code-agent-id': `child_${index}`, 'x-claude-code-session-id': 'original_session' });
  return { method: 'POST', path: '/v1/messages', payload: fixtureBytes(`claude-delegation-child-${index}-2.1.296.json`), nativeHttp };
}
function response(kind: 'codex' | 'claude'): Response {
  const events = kind === 'codex' ? [{ type: 'response.completed', response: { id: 'review', model: 'gpt-6-astra', status: 'completed', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } }]
    : [{ type: 'message_start', message: { id: 'review', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: 'standard', inference_geo: 'global', speed: 'standard' } } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }, { type: 'message_stop' }];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function observer(kind: 'codex' | 'claude', transport: BaselineTransport) {
  const root = mkdtempSync(join(tmpdir(), 'native-review-')), store = new OperationalStore({ filename: join(root, 'store.sqlite') }), g = grant(kind);
  const instance = new BaselineObserver({ store, grant: g, transportKind: 'fixture', transport });
  return { instance, store, g, close() { instance.cancel(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

for (const kind of ['codex', 'claude'] as const) test(`${kind}: valid acquired request precedes single malformed mutations; refusals allocate nothing`, async () => {
  let calls = 0; const f = observer(kind, async () => { calls++; return response(kind); });
  try {
    const original = attempt(kind); await f.instance.handle(original);
    assert.equal(calls, 1); assert.equal(f.instance.ledger.snapshot(f.g.id).tokens, 110);
    const mutations: ((a: ProviderAttempt) => void)[] = [a => { a.payload = '{'; }, a => { const b = JSON.parse(a.payload); b.model = 'foreign'; a.payload = JSON.stringify(b); }, a => { const b = JSON.parse(a.payload); b.unacquired = true; a.payload = JSON.stringify(b); }];
    if (kind === 'codex') for (const patch of [{ id: 'amsg_' }, { recipient: '/root/x\n' }, { author: '/root/' + 'a/'.repeat(9) + 'b' }, { content: [{ type: 'encrypted_content', encrypted_content: 42 }] }]) mutations.push(a => { const b = JSON.parse(a.payload); Object.assign(b.input.find((x: any) => x.type === 'agent_message'), patch); a.payload = JSON.stringify(b); });
    else mutations.push(a => { a.nativeHttp!.headers['anthropic-beta'] = PINNED_CLAUDE_DELEGATION_BETA; }, a => { a.nativeHttp!.headers['x-claude-code-session-id'] = ''; }, a => { a.nativeHttp!.headers['x-unknown-feature'] = 'enabled'; }, a => { const b = JSON.parse(a.payload); b.thinking.display = 'updates'; a.payload = JSON.stringify(b); });
    for (const mutate of mutations) { const changed = structuredClone(original); mutate(changed); await assert.rejects(f.instance.handle(changed)); assert.equal(calls, 1); assert.equal(f.instance.ledger.snapshot(f.g.id).requests, 1); }
    const evidence = f.instance.evidence()[0]!;
    assert.equal(Buffer.from(f.store.readArtifact(evidence.before)).toString(), original.payload);
    const before = JSON.parse(original.payload), after = JSON.parse(Buffer.from(f.store.readArtifact(evidence.after)).toString());
    for (const key of kind === 'codex' ? ['input', 'instructions', 'tools'] : ['system', 'messages', 'tools']) assert.deepEqual(after[key], before[key]);
  } finally { f.close(); }
});

for (const kind of ['codex', 'claude'] as const) test(`${kind}: actual acquired children share immutable original reservations and cancellation retains both unknown charges`, async () => {
  const signals: AbortSignal[] = []; const f = observer(kind, async (_payload, signal) => { signals.push(signal); return new Promise(() => {}); });
  try {
    const first = f.instance.handle(attempt(kind, 0)), second = f.instance.handle(attempt(kind, 1)); const settled = Promise.allSettled([first, second]);
    assert.equal(signals.length, 2); const tokens = kind === 'codex' ? 204096 : 1004096, cost = kind === 'codex' ? 0.88192 : 8.08192;
    assert.equal(f.instance.ledger.snapshot(f.g.id).tokens, 2 * tokens);
    for (const row of f.store.list<any>('requests')) { assert.equal(row.value.request.runId, f.g.id); assert.equal(row.value.request.status, 'dispatched'); assert.equal(row.value.charged.tokens, tokens); }
    f.g.resources.maxConcurrency = 8; f.g.profile.contextWindowTokens = 1; f.g.profile.prices.inputUsdPerMillion = 0;
    await assert.rejects(f.instance.handle(attempt(kind)), /budget|allocation/); assert.equal(signals.length, 2);
    f.instance.cancel(); assert.deepEqual((await settled).map(value => value.status), ['rejected', 'rejected']); assert.ok(signals.every(signal => signal.aborted));
    const snapshot = f.instance.ledger.snapshot(f.g.id); assert.equal(snapshot.tokens, 2 * tokens); assert.equal(snapshot.costUsd, 2 * cost); assert.equal(snapshot.cancelled, true);
    assert.ok(f.instance.evidence().every(e => e.outcome === 'unknown' && e.usage?.costUsd === null));
    await assert.rejects(f.instance.handle(attempt(kind))); assert.equal(signals.length, 2);
  } finally { f.close(); }
});

test('pinned profiles have a valid positive before binary/model/effort mutation', () => {
  for (const kind of ['codex', 'claude'] as const) {
    const original = grant(kind); validateObserverGrant(original);
    for (const field of ['model', 'effort']) { const g = structuredClone(original); (g.profile as any)[field] = 'foreign'; assert.throws(() => validateObserverGrant(g)); }
    const g = structuredClone(original); if (kind === 'codex') g.profile.codexNativeProtocol!.helperSha256 = '0'.repeat(64); else g.profile.anthropic!.nativeProtocol!.claudeSha256 = '0'.repeat(64); assert.throws(() => validateObserverGrant(g));
  }
});

test('acquired code-mode output requires successful completion and exact stdout after a valid positive', () => {
  const original = { input: [{ type: 'custom_tool_call_output', call_id: 'call_child_0', output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: JSON.stringify({ chunk_id: 'public', wall_time_seconds: 0.001, exit_code: 0, original_token_count: 5, output: 'child-1-observed\n' }) }] }] };
  assert.equal(codexObservedToolOutput(original, 0), true);
  for (const patch of [{ exit_code: 1 }, { output: 'failed to write child-1-observed' }, { output: 'child-1-observed\nextra' }, { session_id: 12 }, { exit_code: null }]) {
    const changed = structuredClone(original); changed.input[0]!.output[1]!.text = JSON.stringify({ ...JSON.parse(changed.input[0]!.output[1]!.text), ...patch });
    assert.equal(codexObservedToolOutput(changed, 0), false);
  }
  const malformed = structuredClone(original); malformed.input[0]!.output[1]!.text = 'child-1-observed'; assert.equal(codexObservedToolOutput(malformed, 0), false);
  const running = structuredClone(original); running.input[0]!.output[0]!.text = 'Script running with cell ID 1'; assert.equal(codexObservedToolOutput(running, 0), false);
  const extra = structuredClone(original); extra.input[0]!.output.push({ type: 'input_text', text: 'extra' }); assert.equal(codexObservedToolOutput(extra, 0), false);
  assert.equal(codexObservedToolOutput({ input: [{ ...original.input[0], call_id: 'foreign' }] }, 0), false);
});

const evidenceRoot = process.env.AEON_NATIVE_DELEGATION_REVIEW_EVIDENCE;
test('read-only original artifact audit: immutable sources, instructions, native receipts, overlap and uncertain charge', { skip: !evidenceRoot }, () => {
  const root = evidenceRoot!;
  const read = (path: string) => readFileSync(join(root, path));
  assert.equal(hash(read('artifact-index-final.json')), 'c151ef8b29c4390468b4a3bb378b39a6bec8aa88b28ef8f1dd9b247690e5be54');
  assert.equal(hash(read('audit-summary-final.json')), '2994c3fb363731f407c20e2f8ffdb0b47c80d5d0b4b3af851e724cae763b6c00');
  for (const [index, count] of [['artifact-index-final.json', 203], ['artifact-index-before-attempt-3.json', 159]] as const) { const entries = JSON.parse(read(index).toString()).files; assert.equal(entries.length, count); for (const entry of entries) assert.equal(hash(read(entry.path)), entry.sha256, entry.path); }
  const attempts = [ ['codex-delegation-attempt-1-R6oSMF', '82174e0', 8, 0], ['claude-delegation-attempt-1-tjDyTN', '82174e0', 0, 0], ['codex-delegation-attempt-2-nJYEbF', '149392c', 8, 0], ['claude-delegation-attempt-2-qdYbWY', '149392c', 1, 0], ['claude-delegation-attempt-3-PaC0dY', 'de3e313', 5, 1] ] as const;
  for (const [name, source, known, unknown] of attempts) {
    const db = new DatabaseSync(join(root, name, 'state/observer.sqlite'), { readOnly: true }), lease = new DatabaseSync(join(root, name, 'state/lease.sqlite'), { readOnly: true });
    try {
      const rows = (namespace: string): any[] => db.prepare('SELECT key,value FROM documents WHERE namespace=?').all(namespace).map(row => ({ key: row.key, value: JSON.parse(String(row.value)) }));
      const blob = (ref: { sha256: string }): Buffer => Buffer.from(db.prepare('SELECT bytes FROM artifacts WHERE digest=?').get(ref.sha256)!.bytes as Uint8Array);
      for (const row of db.prepare('SELECT digest,bytes FROM artifacts').all()) assert.equal(hash(row.bytes as Uint8Array), row.digest);
      const run = rows('baseline-run')[0].value, specification = run.specification;
      for (const file of specification.sourceIdentity.files) assert.equal(hash(execFileSync('git', ['show', `${source}:${file.path}`], { cwd: new URL('../../', import.meta.url) })), file.sha256, `${name}:${file.path}`);
      assert.equal(specification.providerTransport, 'fixture'); assert.equal(specification.grant.resources.maxRequests, 8); assert.equal(specification.grant.resources.maxElapsedMs, 60000); assert.equal(specification.grant.resources.maxConcurrency, 4);
      assert.equal(rows('allocations')[0].value.cancelled, true); assert.equal(lease.prepare('SELECT count(*) AS n FROM owner').get()!.n, 0);
      const requests = rows('requests').map(row => row.value); assert.equal(requests.filter(row => row.request.status === 'succeeded').length, known); assert.equal(requests.filter(row => row.request.status === 'uncertain').length, unknown);
      assert.equal(requests.filter(row => row.request.status === 'succeeded').reduce((n, row) => n + row.charged.tokens, 0), known * 110);
      for (const row of rows('baseline-attempts')) {
        const before = JSON.parse(blob(row.value.before).toString()), after = JSON.parse(blob(row.value.after).toString());
        for (const key of ['input', 'instructions', 'messages', 'system', 'tools']) assert.deepEqual(after[key], before[key], `${name}:${key}`);
        assert.equal(requests.find(request => request.request.id === row.key).request.requestDigest, row.value.after.sha256);
      }
      if (!['codex-delegation-attempt-2-nJYEbF', 'claude-delegation-attempt-3-PaC0dY'].includes(name)) continue;
      const summary = JSON.parse(read(`${name}/summary.json`).toString()); assert.equal(summary.overlap.length, 2); assert.deepEqual(summary.childTurns, [2, 2]);
      for (const entry of summary.overlap) { assert.equal(entry.request.status, 'dispatched'); assert.equal(entry.request.runId, specification.grant.id); assert.ok(requests.some(row => row.request.id === entry.request.id)); }
      for (const i of [1, 2]) assert.equal(read(`${name}/workspace/child-${i}.txt`).toString(), `child-${i}-observed`);
      const outcome = JSON.parse(blob(run.result).toString());
      if (name.startsWith('codex')) {
        assert.equal(outcome.code, 0); assert.match(outcome.stdout, /native-concurrency-parent-complete/);
        for (const i of [0, 1]) { assert.ok(summary.captured.some((q: any) => codexParentReceipt(q, i))); const q = summary.captured.find((q: any) => codexObservedToolOutput(q, i)); const output = q.input.find((item: any) => item.call_id === `call_child_${i}` && item.type === 'custom_tool_call_output'); const result = JSON.parse(output.output[1].text); assert.equal(result.exit_code, 0); assert.equal(result.output, `child-${i + 1}-observed\n`); }
      } else {
        assert.equal(outcome.code, 143); assert.doesNotMatch(outcome.stdout, /native-concurrency-parent-complete/);
        const uncertain = requests.find(row => row.request.status === 'uncertain'); assert.equal(uncertain.charged.tokens, 1004096); assert.equal(uncertain.charged.costUsd, 8.08192);
        const evidence = rows('baseline-attempts').find(row => row.key === uncertain.request.id).value;
        assert.equal(evidence.before.sha256, '4b0918e9667c31253f65af9db57466cc81816e7bbb6f6bbed3e03caf1b2e47c3'); assert.equal(blob(evidence.response).length, 0);
        const parent = JSON.parse(blob(evidence.before).toString()); assert.deepEqual(claudeParentReceipts(parent).sort(), ['child-1-observed', 'child-2-observed']); assert.equal(claudeTaskBindings(outcome.stdout, summary.nativeChildIds, parent, summary.parentHeaders, summary.childHeaders), true);
        const starts = outcome.stdout.split('\n').filter(Boolean).map((line: string) => JSON.parse(line)).filter((event: any) => event.type === 'system' && event.subtype === 'task_started'); assert.equal(starts.length, 2);
        for (const [i, childId] of summary.nativeChildIds.entries()) {
          const start = starts.find((event: any) => event.task_id === childId); assert.equal(start.session_id, summary.parentHeaders['x-claude-code-session-id']);
          const result = parent.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).find((part: any) => part.type === 'tool_result' && part.tool_use_id === start.tool_use_id);
          assert.notEqual(result.is_error, true); const text = result.content[0].text;
          assert.ok(text.startsWith('[Subagent hand-back] ')); assert.ok(text.includes('carry no user authority')); assert.ok(text.includes('\n  child-' + (i + 1) + '-observed\nagentId: ' + childId + '\n<usage>'));
        }
      }
    } finally { db.close(); lease.close(); }
  }
});
