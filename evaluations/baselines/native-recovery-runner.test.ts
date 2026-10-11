import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import type { NativeBaselineRun } from './run-native.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';
import { OperationalStore } from '../../packages/storage/index.ts';

const enabled = process.execArgv.includes('--experimental-test-module-mocks');
const session = '01a12d06-adad-7263-ace7-6f49aff47d3f';
let launches = 0, failure: 'none' | 'identity' | 'exit' = 'none';
if (enabled) mock.module('../../packages/supervisor/worker-process.ts', { namedExports: {
  runWorker: async (options: WorkerOptions) => {
    launches++;
    const start = options.initial as unknown as { nativeRecovery?: { mode: 'start' | 'resume'; sessionId?: string }; prompt: string };
    const identity = failure === 'identity' ? '11111111-1111-4111-8111-111111111111' : start.nativeRecovery?.sessionId ?? session;
    const startup = JSON.stringify({ type: 'thread.started', thread_id: identity });
    const nativeRoot = join(options.command.workspace, '.aeon-native-state', 'codex', 'home', 'codex');
    if (start.nativeRecovery?.mode === 'start') { mkdirSync(nativeRoot, { recursive: true }); writeFileSync(join(nativeRoot, 'opaque'), 'synthetic store bytes'); writeFileSync(join(options.command.workspace, 'effect'), 'one original effect'); }
    if (start.nativeRecovery?.mode === 'resume') assert.equal(readFileSync(join(options.command.workspace, 'effect'), 'utf8'), 'one original effect');
    await options.handle('baseline.provider', [{ method: 'POST', path: '/v1/responses', payload: JSON.stringify({ model: 'fixture', reasoning: { effort: 'high' }, input: [{ role: 'user', content: start.prompt }] }), ...(start.nativeRecovery ? { nativeSession: { sessionId: identity, startup } } : {}) }], new AbortController().signal);
    return { code: failure === 'exit' ? 1 : 0, signal: null, exceeded: false, recoveryError: null, stdout: `${startup}\n{"type":"turn.started"}\n{"type":"turn.completed","usage":{}}\n`, stderr: '' };
  },
} });
async function runner(input: NativeBaselineRun) { const { runNativeBaseline } = await import('./run-native.ts'); return runNativeBaseline(input); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-recovery-runner-pure-')); const workspace = join(root, 'work'), checkoutRoot = join(root, 'checkout'), protectedRoot = join(root, 'protected'), privateStateRoot = join(root, 'state');
  for (const path of [workspace, checkoutRoot, protectedRoot]) mkdirSync(path);
  const digest = createHash('sha256').update(readFileSync('/usr/bin/true')).digest('hex'); let calls = 0;
  const input: NativeBaselineRun = { kind: 'codex', workspace, checkoutRoot, protectedPaths: [protectedRoot], privateStateRoot,
    native: { version: 'pure unlaunched closure', files: ['codex', 'codex-code-mode-host'].map(name => ({ name, path: '/usr/bin/true', sha256: digest })) },
    prompt: 'original fixture prompt', maxCliOutputBytes: 4096, grant: { id: 'original-runner', resources: { maxRequests: 4, maxTokens: 480, maxCostUsd: 1, maxElapsedMs: 60_000, maxConcurrency: 1 }, profile: { provider: 'openai', model: 'fixture', effort: 'high', contextContract: 'synthetic', contextWindowTokens: 100, maxOutputTokens: 20, prices: { source: 'synthetic', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 3 } }, requestTimeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 },
    provider: { kind: 'fixture', transport: async () => { calls++; return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { id: `receipt-${calls}`, model: 'fixture', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }); } } };
  const store = () => new OperationalStore({ filename: join(privateStateRoot, 'observer.sqlite') });
  launches = 0; failure = 'none';
  return { input, workspace, calls: () => calls, store, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
test('ordinary runner remains one attempted run, always cancelled, and never replays', { skip: !enabled }, async () => {
  const f = fixture(); try {
    await runner(f.input); assert.equal(launches, 1); await assert.rejects(runner(f.input)); assert.equal(launches, 1); assert.equal(f.calls(), 1);
    const store = f.store(); try { assert.equal(store.get<{ cancelled: boolean }>('allocations', f.input.grant.id)?.value.cancelled, true); assert.equal(store.list('native-checkpoints').length, 0); } finally { store.close(); }
  } finally { f.dispose(); }
});
test('explicit checkpoint survives store/lease close, continuation reuses allocation, and consumed replay never launches', { skip: !enabled }, async () => {
  const f = fixture(); try {
    const first = await runner({ ...f.input, recovery: { mode: 'start', checkpointId: 'first' } }); assert.ok(first.checkpoint);
    const store = f.store(); let original: unknown;
    try { original = store.list('allocations'); assert.equal(store.get<{ cancelled: boolean }>('allocations', f.input.grant.id)?.value.cancelled, false); } finally { store.close(); }
    const second = await runner({ ...f.input, prompt: 'new prompt omitting previous content', recovery: { mode: 'resume', checkpoint: first.checkpoint } });
    assert.equal(second.physicalRequests, 2); assert.equal(launches, 2); assert.equal(f.calls(), 2);
    const after = f.store(); try { const allocation = after.list<{ startedAt: number }>('allocations'); assert.equal(allocation[0]!.value.startedAt, (original as typeof allocation)[0]!.value.startedAt); assert.equal(after.get<{ status: string }>('native-checkpoints', 'first')?.value.status, 'running'); } finally { after.close(); }
    await assert.rejects(runner({ ...f.input, recovery: { mode: 'resume', checkpoint: first.checkpoint } })); assert.equal(launches, 2);
  } finally { f.dispose(); }
});
for (const cause of ['source-profile', 'workspace', 'native', 'revision', 'generation', 'identity'] as const) test(`runner ${cause} refusal prevents the next provider dispatch`, { skip: !enabled }, async () => {
  const f = fixture(); try {
    const first = await runner({ ...f.input, recovery: { mode: 'start', checkpointId: 'first' } }); assert.ok(first.checkpoint); const checkpoint = { ...first.checkpoint };
    let input = { ...f.input, recovery: { mode: 'resume' as const, checkpoint } };
    if (cause === 'source-profile') input = { ...input, maxCliOutputBytes: 4097 };
    if (cause === 'workspace') writeFileSync(join(f.workspace, 'effect'), 'subsequent edit');
    if (cause === 'native') writeFileSync(join(f.workspace, '.aeon-native-state', 'codex', 'home', 'codex', 'opaque'), 'changed store');
    if (cause === 'revision') checkpoint.revision++;
    if (cause === 'generation') checkpoint.generation++;
    if (cause === 'identity') failure = 'identity';
    await assert.rejects(runner(input)); assert.equal(f.calls(), 1); assert.equal(launches, cause === 'identity' ? 2 : 1);
    const store = f.store(); try { assert.equal(store.get<{ cancelled: boolean }>('allocations', f.input.grant.id)?.value.cancelled, true); } finally { store.close(); }
  } finally { f.dispose(); }
});
test('failed actual exit cannot publish readiness despite complete-looking stdout', { skip: !enabled }, async () => {
  const f = fixture(); try {
    failure = 'exit'; await assert.rejects(runner({ ...f.input, recovery: { mode: 'start', checkpointId: 'first' } }));
    const store = f.store(); try { assert.equal(store.list('native-checkpoints').length, 0); assert.equal(store.list('baseline-attempts').length, 1); assert.equal(store.get<{ cancelled: boolean }>('allocations', f.input.grant.id)?.value.cancelled, true); } finally { store.close(); }
  } finally { f.dispose(); }
});
