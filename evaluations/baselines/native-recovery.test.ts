import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ProcessLease } from '../../packages/supervisor/process-lease.ts';
import { BaselineObserver } from './observer.ts';
import type { ObserverGrant } from './observer.ts';
import { NativeRecovery, NativeSessionEvents, nativeStateHome } from './native-recovery.ts';

const session = '01a12d06-adad-7263-ace7-6f49aff47d3f';
function grant(): ObserverGrant { return { id: 'recovery-original', resources: { maxRequests: 4, maxTokens: 480, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 1 }, profile: { provider: 'openai', model: 'fixture', effort: 'high', contextContract: 'synthetic only', contextWindowTokens: 100, maxOutputTokens: 20, prices: { source: 'synthetic', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 3 } }, requestTimeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 }; }
const payload = JSON.stringify({ model: 'fixture', reasoning: { effort: 'high' }, input: [{ role: 'user', content: 'synthetic' }] });
const reply = `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'receipt', status: 'completed', model: 'fixture', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } })}\n\n`;
const stdout = `${JSON.stringify({ type: 'thread.started', thread_id: session })}\n${JSON.stringify({ type: 'turn.started' })}\n${JSON.stringify({ type: 'turn.completed', usage: {} })}\n`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-recovery-pure-')), workspace = join(root, 'work'); mkdirSync(workspace);
  const native = join(workspace, '.aeon-native-state', 'codex'); mkdirSync(join(native, 'home', 'codex'), { recursive: true });
  writeFileSync(join(native, 'home', 'codex', 'opaque-native-file'), 'actual bytes; format is deliberately uninterpreted');
  writeFileSync(join(workspace, 'effect'), 'effect already happened');
  const store = new OperationalStore({ filename: join(root, 'observer.sqlite') });
  let now = 100, calls = 0;
  const transport = async () => { calls++; return new Response(reply, { headers: { 'content-type': 'text/event-stream' } }); };
  const observer = new BaselineObserver({ store, grant: grant(), transport, transportKind: 'fixture', now: () => now });
  const lease = new ProcessLease(join(root, 'lease.sqlite'));
  const recovery = new NativeRecovery({ observer, lease, workspace, kind: 'codex' });
  const outcome = { code: 0, signal: null, exceeded: false, stdout, stderr: '' };
  const seal = () => recovery.publish({ id: 'checkpoint-one', generation: 1, identity: 'frozen-source-grant-model-effort-kernel-env', outcome, pendingOperations: 0, cleanup: store.putArtifact('runWorker returned after awaited namespace cleanup'), manifest: store.putArtifact('original-launch'), result: store.putArtifact(JSON.stringify(outcome)) });
  return { root, workspace, native, store, observer, lease, recovery, outcome, seal, transport, setNow: (value: number) => { now = value; }, calls: () => calls, dispose: () => { lease.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('original observer cancellation remains permanent and retains known charges', async () => {
  const f = fixture(); try {
    await f.observer.handle({ method: 'POST', path: '/v1/responses', payload }); f.observer.cancel();
    const reopened = new BaselineObserver({ store: f.store, grant: grant(), transport: f.transport, now: () => 200 });
    await assert.rejects(reopened.handle({ method: 'POST', path: '/v1/responses', payload }), /cancelled|budget/);
    assert.equal(reopened.ledger.snapshot(grant().id).tokens, 15); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});

test('ready continuation consumes one revision without allocation or clock reset and retains native bytes/effects', async () => {
  const f = fixture(); try {
    await f.observer.handle({ method: 'POST', path: '/v1/responses', payload }); const ready = f.seal();
    const allocations = f.store.list('allocations'); f.setNow(1100);
    const resumed = f.recovery.consume({ ...ready, identity: 'frozen-source-grant-model-effort-kernel-env' });
    assert.equal(resumed.sessionId, session); assert.equal(resumed.generation, 2);
    assert.deepEqual(f.store.list('allocations'), allocations); assert.equal(f.observer.ledger.snapshot(grant().id).elapsedMs, 1000);
    assert.equal(f.observer.ledger.snapshot(grant().id).tokens, 15);
    assert.throws(() => f.recovery.consume({ ...ready, identity: 'frozen-source-grant-model-effort-kernel-env' }), /ready|revision/);
    const native = f.store.readJsonArtifact<{ entries: { path: string; bytes?: { uri: string; sha256: string } }[] }>(resumed.native);
    assert.ok(native.entries.some(entry => entry.path === 'home/codex/opaque-native-file'));
  } finally { f.dispose(); }
});

for (const cause of ['identity', 'workspace', 'native', 'ledger', 'deadline', 'cancel', 'lease', 'revision', 'generation'] as const) test(`continuation refuses changed ${cause} before launch`, async () => {
  const f = fixture(); try {
    await f.observer.handle({ method: 'POST', path: '/v1/responses', payload }); const ready = f.seal();
    const expected = { ...ready, identity: 'frozen-source-grant-model-effort-kernel-env' };
    if (cause === 'identity') expected.identity += '-different';
    if (cause === 'workspace') writeFileSync(join(f.workspace, 'effect'), 'later observed edit');
    if (cause === 'native') writeFileSync(join(f.native, 'home', 'codex', 'opaque-native-file'), 'changed');
    if (cause === 'ledger') await f.observer.handle({ method: 'POST', path: '/v1/responses', payload });
    if (cause === 'deadline') f.setNow(10_100);
    if (cause === 'cancel') f.observer.cancel();
    if (cause === 'lease') f.lease.close();
    if (cause === 'revision') expected.revision++;
    if (cause === 'generation') expected.generation++;
    assert.throws(() => f.recovery.consume(expected));
    assert.equal(f.store.get<{ status: string }>('native-checkpoints', ready.id)?.value.status, 'ready');
  } finally { f.dispose(); }
});

for (const cause of ['pending', 'native-exit', 'signal', 'output-cap', 'missing-completion', 'missing-identity', 'tool-failure', 'active-tool', 'active-child', 'links', 'hardlinks', 'oversize'] as const) test(`checkpoint refuses ${cause} without publishing partial state`, async () => {
  const f = fixture(); try {
    await f.observer.handle({ method: 'POST', path: '/v1/responses', payload });
    if (cause === 'native-exit') f.outcome.code = 1;
    if (cause === 'signal') (f.outcome as { signal: string | null }).signal = 'SIGTERM';
    if (cause === 'output-cap') f.outcome.exceeded = true;
    if (cause === 'missing-completion') f.outcome.stdout = stdout.split('\n').slice(0, 2).join('\n') + '\n';
    if (cause === 'missing-identity') f.outcome.stdout = stdout.split('\n').slice(1).join('\n');
    if (cause === 'tool-failure') f.outcome.stdout = stdout.replace('{"type":"turn.completed"', '{"type":"item.completed","item":{"id":"bad","type":"command_execution","status":"completed","exit_code":1}}\n{"type":"turn.completed"') ;
    if (cause === 'active-tool') f.outcome.stdout = stdout.replace('{"type":"turn.completed"', '{"type":"item.started","item":{"id":"running","type":"command_execution","status":"in_progress"}}\n{"type":"turn.completed"');
    if (cause === 'active-child') f.outcome.stdout = stdout.replace('{"type":"turn.completed"', '{"type":"item.completed","item":{"id":"child","type":"collab_tool_call","tool":"spawn_agent","status":"completed","receiver_thread_ids":["child"],"agents_states":{"child":{"status":"running"}}}}\n{"type":"turn.completed"');
    if (cause === 'links') symlinkSync(join(f.root, 'observer.sqlite'), join(f.native, 'link'));
    if (cause === 'hardlinks') linkSync(join(f.native, 'home', 'codex', 'opaque-native-file'), join(f.native, 'hard'));
    if (cause === 'oversize') writeFileSync(join(f.native, 'big'), Buffer.alloc(16 * 1024 * 1024));
    const action = cause === 'pending' ? () => f.recovery.publish({ id: 'checkpoint-one', generation: 1, identity: 'x', outcome: f.outcome, pendingOperations: 1, cleanup: f.store.putArtifact('cleanup'), manifest: f.store.putArtifact('m'), result: f.store.putArtifact('r') }) : f.seal;
    assert.throws(action); assert.equal(f.store.list('native-checkpoints').length, 0);
  } finally { f.dispose(); }
});

for (const status of ['reserved', 'dispatched', 'uncertain'] as const) test(`held ${status} reservation blocks readiness and reopening preserves exact charge`, async () => {
  const f = fixture(); try {
    await f.observer.handle({ method: 'POST', path: '/v1/responses', payload });
    const request = { id: 'held', runId: grant().id, purpose: 'reasoning' as const, provider: 'fixture', model: 'fixture', requestDigest: 'a'.repeat(64), promptManifestId: 'fixture-prompt', reservationId: 'held', status: 'reserved' as const, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    f.observer.ledger.reserve(request);
    if (status !== 'reserved') f.observer.ledger.dispatched({ ...request, status: 'dispatched' });
    if (status === 'uncertain') f.observer.ledger.settle({ ...request, status, usage: request.usage });
    const before = f.observer.ledger.snapshot(grant().id); assert.throws(f.seal);
    const reopened = new BaselineObserver({ store: f.store, grant: grant(), transport: f.transport, now: () => 100 });
    const after = reopened.ledger.snapshot(grant().id); assert.equal(after.tokens, before.tokens); assert.equal(after.costUsd, before.costUsd); assert.equal(after.cancelled, true); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});

test('worker identity gate requires a complete actual startup before dispatch and retains raw identity', () => {
  const gate = new NativeSessionEvents('codex', session, 4096);
  assert.throws(() => gate.beforeProvider(), /identity/);
  gate.feed(Buffer.from(stdout.slice(0, 12))); assert.throws(() => gate.beforeProvider(), /identity/);
  const end = stdout.indexOf('\n') + 1; gate.feed(Buffer.from(stdout.slice(12, end))); assert.equal(gate.beforeProvider().sessionId, session);
  assert.ok(gate.beforeProvider().startup.includes('thread.started')); gate.feed(Buffer.from(stdout.slice(end))); assert.equal(gate.finish().sessionId, session);
  const wrong = new NativeSessionEvents('codex', '11111111-1111-4111-8111-111111111111', 4096);
  assert.throws(() => wrong.feed(Buffer.from(stdout)), /identity/);
  assert.equal(nativeStateHome('codex'), '/work/.aeon-native-state/codex/home');
});

test('successful-looking native stdout alone cannot publish a checkpoint without observed physical usage', () => {
  const f = fixture(); try { assert.throws(f.seal, /actual known provider/); assert.equal(f.store.list('native-checkpoints').length, 0); } finally { f.dispose(); }
});
