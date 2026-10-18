import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue, PhysicalRequest, ShellInput } from '../packages/contracts/index.ts';
import type { SlackApi } from '../packages/communications/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication, type ApplicationOptions } from './application.ts';
import type { ApplicationConfig } from './config.ts';

const turns = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const blockedWorker: ApplicationOptions['runWorker'] = async options => {
  const start = options.initial as unknown as { input: ShellInput };
  const checkpoint = await options.handle('persistCheckpoint', [start.input.run.id, start.input.run.revision, 'fixture-shell', {
    schema: 'fixture-shell', status: 'blocked', messages: [], observationIds: [], failure: { stage: 'model', reason: 'private diagnostic must not be published' },
  }], new AbortController().signal);
  return { status: 'blocked', checkpoint, observations: [] };
};
function fixture(worker: ApplicationOptions['runWorker'] = async () => { throw Error('Worker deadline exceeded'); }, loseReceipt = false) {
  const root = mkdtempSync(join(tmpdir(), 'conversation-failure-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind'), compactionPromptFile = join(root, 'compact'); writeFileSync(promptFile, 'fixture'); writeFileSync(compactionPromptFile, 'fixture');
  const resources = { maxRequests: 20, maxTokens: 100000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 4 };
  const scope = { kind: 'public' } as const;
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'failure-fixture', controlRevision: 'c1', promptFile, compactionPromptFile,
    model: { id: 'fixture-model', contextWindow: 32768, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope, modificationEligible: true },
    slack: { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('failure-fixture', 'c1', 'failure-fixture');
  const calls: { method: string; args: Record<string, string> }[] = []; let sentId = '', workerCalls = 0;
  const api: SlackApi = { async call<T>(method: string, args: Record<string, string>) {
    calls.push({ method, args });
    if (method === 'chat.postMessage') { sentId = args.client_msg_id!; if (loseReceipt) throw Error('lost acknowledgement'); return { channel: 'C1', ts: '12.001' } as T; }
    if (method === 'conversations.replies') return { messages: [{ ts: '12.001', thread_ts: '10.001', user: 'BOT', client_msg_id: sentId }] } as T;
    return {} as T;
  } };
  const open = () => new AutarkApplication({ config, authorityStore, authority, secrets: { directToken: 'fixture' }, slackBotApi: api, slackAppApi: api,
    brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal },
    runWorker: async options => { workerCalls++; return worker!(options); }, performRequest: async () => { throw Error('No model request authorized'); } });
  let app = open();
  return { config, authority, authorityStore, calls, get app() { return app; }, get workerCalls() { return workerCalls; },
    async admit() { app.slackActivity!.start(); const run = app.slackIngress!.acceptHistory('C1', { ts: '10.001', user: 'U1', text: '<@BOT> hello' })!.run; await turns(); return run; },
    async reopen() { await app.close(); app = open(); app.slackActivity!.start(); return app; },
    async close() { await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('a deadline sends one accounted host interruption, clears eyes, and retains uncertain charges and original grants', async () => {
  const f = fixture();
  try {
    const run = await f.admit();
    const allocation = f.app.store.get<{ envelope: unknown; startedAt: number; parentRunId: string; elapsedFloorMs: number }>('allocations', run.id)!.value;
    const grant = f.app.store.get('host.run-grants', run.id)!.value;
    const uncertain: PhysicalRequest = { id: 'prior-model', runId: run.id, purpose: 'reasoning', provider: 'fixture', model: 'fixture-model', promptManifestId: 'prior', requestDigest: '0'.repeat(64), reservationId: 'prior-model', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: 0.1, elapsedMs: 0 } };
    // Keep the synthetic request's ceiling within the original conversation allowance.
    uncertain.usage.inputTokens = 100; uncertain.usage.outputTokens = 10;
    f.app.resources.reserve(uncertain); f.app.resources.dispatched({ ...uncertain, status: 'dispatched' }); f.app.resources.settle({ ...uncertain, status: 'uncertain' });
    const prior = f.app.store.get('requests', uncertain.id)!.value;
    assert.equal((await f.app.runtime.resume(run.id, f.app.prompt)).status, 'waiting');
    await f.app.tick(); await turns(); await f.app.tick();
    const posts = f.calls.filter(call => call.method === 'chat.postMessage'); assert.equal(posts.length, 1);
    assert.equal(posts[0]!.args.thread_ts, '10.001'); assert.match(posts[0]!.args.text!, /^\[Host status\].*time limit/);
    assert.ok(f.calls.some(call => call.method === 'reactions.remove' && call.args.timestamp === '10.001'));
    const effect = f.app.store.list('effects').find(row => row.key.startsWith('host:deadline:'))!;
    assert.equal(f.app.resources.request(effect.key)!.status, 'succeeded'); assert.equal(f.app.resources.request(effect.key)!.usage.costUsd, 0);
    assert.deepEqual(f.app.store.get('requests', uncertain.id)!.value, prior);
    const retained = f.app.store.get<{ envelope: unknown; startedAt: number }>('allocations', run.id)!.value;
    assert.deepEqual(retained.envelope, (allocation as typeof retained).envelope); assert.equal(retained.startedAt, (allocation as typeof retained).startedAt);
    assert.deepEqual(f.app.store.get('host.run-grants', run.id)!.value, grant); assert.deepEqual(f.app.runtime.getRun(run.id)!.authority, f.authority);
    await f.reopen(); await f.app.tick(); assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 1); assert.equal(f.workerCalls, 1);
  } finally { await f.close(); }
});

test('restart reconciles an unknown host notice without a duplicate send or inference', async () => {
  const f = fixture(undefined, true);
  try {
    const run = await f.admit(); await f.app.runtime.resume(run.id, f.app.prompt); await f.app.tick();
    const notice = f.app.store.list('effects').find(row => row.key.startsWith('host:deadline:'))!;
    assert.equal(f.app.effects.get(notice.key)!.status, 'uncertain');
    await f.reopen(); await f.app.tick(); await turns();
    assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 1);
    assert.equal(f.calls.filter(call => call.method === 'conversations.replies').length, 1);
    assert.equal(f.app.effects.get(notice.key)!.status, 'succeeded'); assert.equal(f.app.resources.request(notice.key)!.status, 'succeeded'); assert.equal(f.workerCalls, 1);
    assert.ok(f.calls.some(call => call.method === 'reactions.remove'));
  } finally { await f.close(); }
});

test('ordinary checkpoint waiting, cancellation, steering, and shutdown do not produce a deadline notice', async () => {
  for (const outcome of ['checkpoint', 'cancel', 'steer', 'shutdown'] as const) {
    const f = fixture(outcome === 'checkpoint' ? async () => ({ status: 'checkpointed', observations: [] }) : undefined);
    try {
      const run = await f.admit(); await f.app.runtime.resume(run.id, f.app.prompt);
      if (outcome === 'cancel') f.app.runtime.cancel(run.id, 'fixture', 'cancelled');
      if (outcome === 'steer') f.app.runtime.steer(run.id, { id: 'steering', source: 'fixture', externalId: 'steering', externalRevision: '1', actorId: 'U1', authenticated: true, scope: run.scope, value: 'change direction' });
      if (outcome === 'shutdown') await f.app.close(); else await f.app.tick();
      assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 0, outcome);
    } finally { await f.close(); }
  }
});

test('a fresh attempt clears stale deadline metadata when it saves a new checkpoint', async () => {
  let attempts = 0;
  const f = fixture(async (options): Promise<JsonValue> => {
    if (++attempts === 1) throw Error('Worker deadline exceeded');
    if (attempts !== 2) return { status: 'completed', observations: [] };
    const start = options.initial as unknown as { input: ShellInput };
    const checkpoint = await options.handle('persistCheckpoint', [start.input.run.id, start.input.run.revision, 'fixture-shell', {
      schema: 'fixture-shell', status: 'blocked', messages: [], observationIds: [], failure: { stage: 'model', reason: 'Explicit fixture checkpoint' },
    }], new AbortController().signal);
    return { status: 'blocked', checkpoint, observations: [] };
  });
  try {
    const run = await f.admit(); await f.app.runtime.resume(run.id, f.app.prompt);
    assert.equal(f.app.store.get<{ failure?: string }>('execution', run.id)!.value.failure, 'Worker deadline exceeded');
    await f.app.runtime.resume(run.id, f.app.prompt);
    assert.equal(f.app.store.get<{ failure?: string; failedAttempt?: number }>('execution', run.id)!.value.failure, undefined);
    assert.equal(f.app.store.get<{ failedAttempt?: number }>('execution', run.id)!.value.failedAttempt, undefined);
    await f.app.runtime.resume(run.id, f.app.prompt);
    await f.app.tick();
    assert.equal(f.app.runtime.getRun(run.id)!.status, 'completed');
    assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 0);
  } finally { await f.close(); }
});

test('startup notifies an old stranded deadline without changing its checkpoint or starting the worker', async () => {
  const f = fixture();
  try {
    const run = await f.admit(); await f.app.runtime.resume(run.id, f.app.prompt);
    const row = f.app.store.get<{ failure: string; failedAttempt?: number }>('execution', run.id)!;
    const { failedAttempt: _oldAttempt, ...legacy } = row.value; f.app.store.put('execution', run.id, legacy, row.revision);
    await f.reopen(); const state = f.app.store.get('execution', run.id)!.value;
    await f.app.tick(); await f.app.tick();
    assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 1); assert.equal(f.workerCalls, 1);
    assert.deepEqual(f.app.store.get('execution', run.id)!.value, state);
  } finally { await f.close(); }
});

test('a retained blocked model checkpoint gets one accounted status and clears eyes without inference or history mutation', async () => {
  const f = fixture(blockedWorker);
  try {
    const run = await f.admit();
    assert.equal((await f.app.runtime.resume(run.id, f.app.prompt)).status, 'blocked');
    const state = f.app.store.get('execution', run.id)!.value;
    const allocation = f.app.store.get<{ envelope: unknown; startedAt: number; parentRunId: string; elapsedFloorMs: number }>('allocations', run.id)!.value;
    await f.app.tick(); await turns(); await f.app.tick();
    const posts = f.calls.filter(call => call.method === 'chat.postMessage');
    assert.equal(posts.length, 1); assert.match(posts[0]!.args.text!, /^\[Host status\].*model request/);
    assert.equal(posts[0]!.args.text!.includes('private diagnostic'), false);
    assert.ok(f.calls.some(call => call.method === 'reactions.remove'));
    const effect = f.app.store.list('effects').find(row => row.key.startsWith('host:blocked:'))!;
    assert.equal(f.app.resources.request(effect.key)!.status, 'succeeded');
    assert.deepEqual(f.app.store.get('execution', run.id)!.value, state);
    const retained = f.app.store.get<typeof allocation>('allocations', run.id)!.value;
    assert.deepEqual(retained.envelope, allocation.envelope); assert.equal(retained.startedAt, allocation.startedAt);
    assert.equal(retained.parentRunId, allocation.parentRunId); assert.ok(retained.elapsedFloorMs >= allocation.elapsedFloorMs);
    await f.reopen(); await f.app.tick();
    assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 1); assert.equal(f.workerCalls, 1);
  } finally { await f.close(); }
});

test('blocked notices require real saved failure and exclude steering or cancelled conversations', async () => {
  for (const mode of ['no-checkpoint', 'steer', 'cancel'] as const) {
    const f = fixture(mode === 'no-checkpoint' ? async () => ({ status: 'blocked', observations: [] }) : blockedWorker);
    try {
      const run = await f.admit(); await f.app.runtime.resume(run.id, f.app.prompt);
      if (mode === 'steer') f.app.runtime.steer(run.id, { id: 'new', source: 'fixture', externalId: 'new', externalRevision: '1', actorId: 'U1', authenticated: true, scope: run.scope, value: 'new direction' });
      if (mode === 'cancel') f.app.runtime.cancel(run.id, 'fixture', 'cancel');
      await f.app.tick();
      assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 0, mode);
    } finally { await f.close(); }
  }
});

test('unknown blocked status delivery reconciles once without sending twice', async () => {
  const f = fixture(blockedWorker, true);
  try {
    const run = await f.admit(); await f.app.runtime.resume(run.id, f.app.prompt); await f.app.tick();
    const notice = f.app.store.list('effects').find(row => row.key.startsWith('host:blocked:'))!;
    assert.equal(f.app.effects.get(notice.key)!.status, 'uncertain');
    await f.reopen(); await f.app.tick(); await turns();
    assert.equal(f.calls.filter(call => call.method === 'chat.postMessage').length, 1);
    assert.equal(f.app.effects.get(notice.key)!.status, 'succeeded'); assert.equal(f.workerCalls, 1);
  } finally { await f.close(); }
});
