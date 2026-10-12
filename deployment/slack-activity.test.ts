import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OperationalStore } from '../packages/storage/index.ts';
import { SlackActivity } from '../packages/communications/slack/activity.ts';
import { SlackError, type SlackApi } from '../packages/communications/slack/client.ts';
import type { Authority, Effect } from '../packages/contracts/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';

const authority: Authority = { generation: 'activity-fixture', epoch: 1, controlRevision: 'c1' };
const fence = { assert(actual: Authority) { assert.deepEqual(actual, authority); } };
const turns = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(api: SlackApi) {
  const root = mkdtempSync(join(tmpdir(), 'slack-activity-'));
  const filename = join(root, 'activity.sqlite');
  const store = new OperationalStore({ filename });
  const activity = new SlackActivity({ store, api, fence, authority });
  return { root, filename, store, activity, async close() { await activity.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('activity is durable before IO, adds eyes promptly, and removes only the captured delivered batch', async () => {
  const calls: { method: string; timestamp: string }[] = [];
  let finishAdd!: () => void;
  let f: ReturnType<typeof fixture>;
  const api: SlackApi = { async call<T>(method: string, args: Record<string, string>) {
    assert.ok(f.store.list('communications.slack.activity').length > 0);
    calls.push({ method, timestamp: args.timestamp! });
    if (method === 'reactions.add' && args.timestamp === '10.001') await new Promise<void>(resolve => { finishAdd = resolve; });
    return {} as T;
  } };
  f = fixture(api);
  try {
    f.activity.start(); f.activity.observe('run1', 'C1', '10.001');
    assert.deepEqual(calls, [{ method: 'reactions.add', timestamp: '10.001' }]);
    f.activity.capture('speech1', 'run1');
    f.activity.observe('run1', 'C1', '11.002'); // arrives during the earlier speech
    f.activity.observe('run1', 'C1', '11.002');
    f.activity.delivered('speech1');
    assert.equal(calls.some(call => call.method === 'reactions.remove'), false, 'remove must await its outstanding add');
    finishAdd(); await turns();
    assert.deepEqual(calls, [{ method: 'reactions.add', timestamp: '10.001' }, { method: 'reactions.add', timestamp: '11.002' }, { method: 'reactions.remove', timestamp: '10.001' }]);
    f.activity.capture('speech2', 'run1'); f.activity.delivered('speech2'); await turns();
    assert.deepEqual(calls.at(-1), { method: 'reactions.remove', timestamp: '11.002' });
    assert.equal(f.activity.diagnosis().pending, 0);
  } finally { await f.close(); }
});

test('activity restart continues retained intent and a lost add acknowledgement is idempotently reconciled', async () => {
  let adds = 0, removes = 0;
  const api: SlackApi = { async call<T>(method: string) {
    if (method === 'reactions.add' && ++adds === 1) throw Error('acknowledgement lost');
    if (method === 'reactions.add') throw new SlackError('already_reacted');
    removes++; return {} as T;
  } };
  const f = fixture(api);
  let reopened: OperationalStore | undefined, resumed: SlackActivity | undefined;
  try {
    f.activity.start(); f.activity.observe('run1', 'C1', '10.001'); await turns();
    f.activity.capture('speech1', 'run1');
    await f.activity.close(); f.store.close();
    reopened = new OperationalStore({ filename: f.filename });
    resumed = new SlackActivity({ store: reopened, api, fence, authority });
    resumed.start(); await turns(); assert.equal(adds, 2);
    resumed.delivered('speech1'); await turns(); assert.equal(removes, 1);
    resumed.observe('run1', 'C1', '10.001'); resumed.tick(); await turns(); assert.equal(adds, 2); assert.equal(removes, 1);
  } finally { await resumed?.close(); reopened?.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('reaction failures stop at three attempts and missing scope disables repeated polling without blocking delivery', async () => {
  let calls = 0;
  const f = fixture({ async call() { calls++; throw Error('unavailable'); } });
  try {
    f.activity.start(); f.activity.observe('run1', 'C1', '10.001'); await turns();
    for (let i = 0; i < 6; i++) { f.activity.tick(); await turns(); }
    assert.equal(calls, 3); assert.equal(f.activity.diagnosis().failed, 1);
  } finally { await f.close(); }
  let scopeCalls = 0;
  const scoped = fixture({ async call() { scopeCalls++; throw new SlackError('missing_scope'); } });
  try {
    scoped.activity.start(); scoped.activity.observe('run1', 'C1', '10.001'); await turns();
    scoped.activity.observe('run1', 'C1', '11.001'); scoped.activity.capture('speech1', 'run1'); scoped.activity.delivered('speech1');
    for (let i = 0; i < 6; i++) scoped.activity.tick(); await turns();
    assert.equal(scopeCalls, 1); assert.equal(scoped.activity.diagnosis().missingScope, true);
  } finally { await scoped.close(); }
});

test('activity shutdown aborts and drains pending reaction IO while preserving intent for restart', async () => {
  let aborted = false;
  const f = fixture({ async call<T>(_method: string, _args: Record<string, string>, signal?: AbortSignal) {
    await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => { aborted = true; reject(Error('stopped')); }, { once: true }));
    return {} as T;
  } });
  try {
    f.activity.start(); f.activity.observe('run1', 'C1', '10.001'); await f.activity.close();
    assert.equal(aborted, true); assert.equal(f.activity.diagnosis().pending, 1);
  } finally { await f.close(); }
});

test('application marks only admitted Slack messages at actual timestamps, retains eyes on failed speech, removes on reconciliation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slack-activity-app-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind'), compactionPromptFile = join(root, 'compact'); writeFileSync(promptFile, 'fixture'); writeFileSync(compactionPromptFile, 'fixture');
  const resources = { maxRequests: 20, maxTokens: 100000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 4 };
  const scope = { kind: 'public' } as const;
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'activity-fixture', controlRevision: 'c1', promptFile, compactionPromptFile,
    model: { id: 'fixture-model', contextWindow: 32768, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope, modificationEligible: true },
    slack: { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const appAuthority = authorityStore.bootstrap('activity-fixture', 'c1', 'activity-fixture');
  const calls: { method: string; timestamp?: string }[] = []; let sentId = '', rejectSpeech = true;
  const api: SlackApi = { async call<T>(method: string, args: Record<string, string>) {
    calls.push({ method, ...(args.timestamp ? { timestamp: args.timestamp } : {}) });
    if (method === 'chat.postMessage') { sentId = args.client_msg_id!; if (rejectSpeech) throw new SlackError('ratelimited'); return { channel: 'C1', ts: '14.001' } as T; }
    if (method === 'conversations.replies') return { messages: [{ ts: '12.001', thread_ts: '10.001', user: 'BOT', client_msg_id: sentId }] } as T;
    return {} as T;
  } };
  const app = new AutarkApplication({ config, authorityStore, authority: appAuthority, secrets: { directToken: 'fixture' }, slackBotApi: api, slackAppApi: api, performRequest: async () => { throw Error('No model calls authorized'); } });
  try {
    app.slackActivity!.start();
    assert.equal(app.slackIngress!.acceptHistory('C2', { ts: '9.001', user: 'U1', text: '<@BOT> no' }), undefined);
    assert.equal(app.slackIngress!.acceptHistory('C1', { ts: '9.001', user: 'BOT', text: '<@BOT> no' }), undefined);
    const message = { ts: '10.001', user: 'U1', text: '<@BOT> hello' };
    const run = app.slackIngress!.acceptHistory('C1', message)!.run; app.slackIngress!.acceptHistory('C1', message); await turns();
    app.slackIngress!.acceptHistory('C1', { ts: '11.002', thread_ts: '10.001', user: 'U1', text: 'follow-up' }); await turns();
    app.communications.receive({ source: 'direct', externalId: 'direct1', revision: '1', conversation: 'direct1', text: 'hi', actor: { id: 'fixture', scope, modificationEligible: true } }); await turns();
    assert.deepEqual(calls, [{ method: 'reactions.add', timestamp: '10.001' }, { method: 'reactions.add', timestamp: '11.002' }]);
    const effect: Effect = { id: 'speech1', runId: run.id, stepId: 'step1', kind: 'speech_send', status: 'dispatched', revision: 1, scope, authority: appAuthority, payload: { channel: 'C1', threadTs: '10.001', text: 'reply' } };
    const failed = await app.effects.receiver.dispatch(effect); assert.equal(failed.outcome, 'failed'); await turns();
    assert.equal(calls.some(call => call.method === 'reactions.remove'), false);
    const reconciled = await app.effects.receiver.reconcile(effect); assert.equal(reconciled.outcome, 'succeeded'); await turns();
    assert.deepEqual(calls.filter(call => call.method === 'reactions.remove').sort((a, b) => a.timestamp!.localeCompare(b.timestamp!)), [{ method: 'reactions.remove', timestamp: '10.001' }, { method: 'reactions.remove', timestamp: '11.002' }]);
    app.slackIngress!.acceptHistory('C1', { ts: '13.003', thread_ts: '10.001', user: 'U1', text: 'another question' }); await turns();
    rejectSpeech = false;
    const delivered = await app.effects.receiver.dispatch({ ...effect, id: 'speech2' }); assert.equal(delivered.outcome, 'succeeded'); await turns();
    assert.deepEqual(calls.at(-1), { method: 'reactions.remove', timestamp: '13.003' });
  } finally { await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
