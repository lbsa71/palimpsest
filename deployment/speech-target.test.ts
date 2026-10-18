import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { Effect, JsonValue } from '../packages/contracts/index.ts';
import type { SlackApi } from '../packages/communications/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';

async function fixture(t: TestContext, lostReceipt = false) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-speech-target-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspaces'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'fixture'); writeFileSync(compactionPromptFile, 'fixture');
  const resources = { maxRequests: 20, maxTokens: 100000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 4 };
  const scope = { kind: 'restricted', principals: ['U1'] } as const;
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'speech-fixture', controlRevision: 'fixture', promptFile, compactionPromptFile,
    model: { id: 'fixture-model', contextWindow: 32768, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [],
    direct: { host: '127.0.0.1', port: 0, actorId: 'U1', scope: { ...scope, principals: [...scope.principals] }, modificationEligible: true },
    slack: { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope: { ...scope, principals: [...scope.principals] } }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('speech-fixture', config.controlRevision, config.artifactId);
  const calls: { method: string; args: Record<string, string> }[] = []; let clientId = '';
  const api: SlackApi = { async call<T>(method: string, args: Record<string, string>) {
    calls.push({ method, args: { ...args } });
    if (method === 'chat.postMessage') {
      clientId = args.client_msg_id!;
      if (lostReceipt) throw Error('fixture response lost after Slack accepted message');
      return { channel: 'C1', ts: '12.001' } as T;
    }
    if (method === 'conversations.replies') return { messages: [{ ts: '12.001', thread_ts: '10.001', user: 'BOT', client_msg_id: clientId }] } as T;
    throw Error(`Unexpected Slack operation: ${method}`);
  } };
  const app = new AutarkApplication({ config, authorityStore, authority, secrets: { directToken: 'fixture' }, slackBotApi: api, slackAppApi: api,
    performRequest: async () => { throw Error('No model calls authorized'); } });
  t.after(async () => { await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  const run = app.slackIngress!.acceptHistory('C1', { ts: '11.001', thread_ts: '10.001', user: 'U1', text: '<@BOT> inspect and code' })!.run;
  // Communications admits synchronously and installs the host grant in its
  // deferred admission callback before any run executes.
  await Promise.resolve();
  async function send(payload: JsonValue, id = 'speech') {
    const effect: Effect = { id, runId: run.id, stepId: 'step', kind: 'speech_send', payload, scope: run.scope, authority, status: 'pending', revision: 0 };
    app.effects.create(effect); app.effects.authorize(id, id, authority);
    return app.effects.dispatch(id, authority);
  }
  return { app, authority, run, calls, send };
}

test('omitted speech thread binds to the authorized thread exactly once and preserves original effect payload', async t => {
  const f = await fixture(t), original = { channel: 'C1', text: 'I will inspect the source.', kind: 'progress' };
  const result = await f.send(original);
  assert.equal(result.status, 'succeeded'); assert.deepEqual(f.app.effects.get('speech')!.payload, original);
  assert.deepEqual(f.calls.map(call => ({ method: call.method, channel: call.args.channel, thread: call.args.thread_ts })), [{ method: 'chat.postMessage', channel: 'C1', thread: '10.001' }]);
  const receipt = f.app.store.readJsonArtifact(result.receipt!) as Record<string, JsonValue>;
  assert.equal(receipt.threadTs, '10.001'); assert.equal(receipt.kind, 'progress');
  await assert.rejects(f.app.effects.dispatch('speech', f.authority), /authorization or reconciliation/); assert.equal(f.calls.length, 1);
});

for (const [name, patch] of [
  ['another thread', { threadTs: '99.001' }], ['another channel', { channel: 'C2' }], ['explicit null thread', { threadTs: null }],
  ['empty content', { text: '   ' }], ['non-text content', { text: 3 }], ['privileged field', { reply_broadcast: true }],
] as const) test(`speech with ${name} fails before sending and creates no false uncertainty`, async t => {
  const f = await fixture(t), result = await f.send({ channel: 'C1', text: 'reply', ...patch });
  assert.equal(result.status, 'failed'); assert.equal(f.calls.length, 0); assert.equal(f.app.effects.unresolved(f.run.id).length, 0);
});

test('a lost speech receipt remains uncertain and reconciles in the same normalized thread without resending', async t => {
  const f = await fixture(t, true), original = { channel: 'C1', text: 'reply' };
  const result = await f.send(original); assert.equal(result.status, 'uncertain'); assert.equal(f.app.effects.unresolved(f.run.id).length, 1);
  const reconciled = await f.app.effects.reconcile('speech', f.authority);
  assert.equal(reconciled.status, 'succeeded'); assert.deepEqual(f.app.effects.get('speech')!.payload, original);
  assert.deepEqual(f.calls.map(call => ({ method: call.method, channel: call.args.channel, thread: call.args.thread_ts ?? call.args.ts })), [
    { method: 'chat.postMessage', channel: 'C1', thread: '10.001' }, { method: 'conversations.replies', channel: 'C1', thread: '10.001' },
  ]);
  const receipt = f.app.store.readJsonArtifact(reconciled.receipt!) as Record<string, JsonValue>;
  assert.equal(receipt.threadTs, '10.001'); assert.equal(f.app.effects.unresolved(f.run.id).length, 0);
});

test('an omitted-thread obligation report uses the bound conversation for preparation and delivery', async t => {
  const f = await fixture(t), target = f.app.store.get<{ target: import('./obligation-tools.ts').ObligationTarget }>('host.run-grants', f.run.id)!.value.target;
  const owe = f.app.conversationObligations.tools(f.run.id, target).find(tool => tool.name === 'obligation_owe')!;
  const owed = await owe.execute({ id: 'verified-report', promisedOutcome: 'Inspect and report', dueAt: null }) as { id: string; revision: number };
  const result = await f.send({ channel: 'C1', text: 'Verified result.', kind: 'report', obligationId: owed.id, obligationRevision: owed.revision });
  assert.equal(result.status, 'succeeded'); f.app.conversationObligations.confirm();
  assert.equal(f.app.obligations.obligation(owed.id)?.status, 'delivered');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.args.thread_ts, '10.001');
});
