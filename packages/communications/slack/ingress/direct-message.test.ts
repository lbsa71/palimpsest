import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAuthority, type Authority, type DataScope } from '../../../contracts/common.ts';
import { OperationalStore } from '../../../storage/index.ts';
import { EffectJournal } from '../../../effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../../../runtime/index.ts';
import { CommunicationsCore } from '../../core/index.ts';
import { SlackRecovery } from '../recovery/index.ts';
import { SlackIngress, type SlackChannelGrant } from './index.ts';
import { validateConfiguration, type ApplicationConfig } from '../../../../deployment/config.ts';

const authority: Authority = { generation: 'dm-fixture', epoch: 1, controlRevision: 'c1' };
const privateScope: DataScope = { kind: 'restricted', principals: ['slack:T1:U1'] };
const resources = { maxRequests: 20, maxTokens: 20000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 4 };
const directGrant = { channel: 'D1', directUserId: 'U1', scope: privateScope };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'slack-dm-')), store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const fence = { assert(actual: Authority) { assertAuthority(actual, authority); } };
  const effects = new EffectJournal(store, fence, { async dispatch() { return { outcome: 'failed' }; }, async reconcile() { throw Error('No effect reconciliation authorized'); } });
  const runtime = new DurableRuntime({ store, effects, resources: new ResourceLedger(store, { tokens: 100, costUsd: 0, elapsedMs: 1000 }), shell: { async run() { return { status: 'completed', observations: [] }; } } });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources }) });
  const ingress = new SlackIngress({ core, teamId: 'T1', botUserId: 'BOT', channels: [directGrant, { channel: 'C1', scope: { kind: 'public' } }], eligibleHumanIds: ['U1'] });
  return { root, store, runtime, core, ingress, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('explicit private DM admits its user without a mention, deduplicates history, and excludes other destinations and authors', () => {
  const f = fixture();
  try {
    const message = { type: 'message', channel: 'D1', ts: '10', user: 'U1', text: 'hello privately' };
    const first = f.ingress.acceptAuthenticated('T1', message)!;
    assert.ok(first); assert.deepEqual(first.run.scope, privateScope);
    assert.equal(f.ingress.acceptHistory('D1', message)!.duplicate, true);
    assert.equal(f.ingress.acceptHistory('D1', { ts: '11', thread_ts: '10', user: 'U1', text: 'follow-up' })!.run.id, first.run.id);
    assert.notEqual(f.ingress.acceptHistory('D1', { ts: '12', user: 'U1', text: 'new root message' })!.run.id, first.run.id);
    for (const user of ['U2', 'BOT']) assert.equal(f.ingress.acceptHistory('D1', { ts: '13', thread_ts: '10', user, text: '<@BOT> still excluded' }), undefined);
    assert.equal(f.ingress.acceptHistory('D2', { ts: '14', user: 'U1', text: '<@BOT> excluded destination' }), undefined);
    assert.equal(f.ingress.acceptHistory('C1', { ts: '15', user: 'U1', text: 'ordinary channel message' }), undefined);
    const channelRun = f.ingress.acceptHistory('C1', { ts: '16', user: 'U1', text: '<@BOT> channel mention' })!.run;
    assert.equal(f.ingress.acceptHistory('C1', { ts: '17', thread_ts: '16', user: 'U2', text: 'channel follow-up' })!.run.id, channelRun.id);
    const input = f.store.list<{ input: { actorId: string; scope: DataScope } }>('communications.inputs').find(row => row.value.input.actorId === 'slack:T1:U1' && row.value.input.scope.kind === 'restricted')!;
    assert.deepEqual(input.value.input.scope, privateScope);
  } finally { f.close(); }
});

test('DM edits and deletions retain their original run and revision controls', () => {
  const f = fixture();
  try {
    const run = f.ingress.acceptHistory('D1', { ts: '10', user: 'U1', text: 'initial' })!.run;
    const edit = { type: 'message', channel: 'D1', subtype: 'message_changed', message: { ts: '10', user: 'U1', text: 'corrected', edited: { ts: '12' } } };
    assert.equal(f.ingress.acceptAuthenticated('T1', edit)!.run.id, run.id);
    assert.equal(f.ingress.acceptAuthenticated('T1', edit)!.duplicate, true);
    const steering = f.store.events(run.id).filter(event => event.type === 'steering').length;
    f.ingress.acceptHistory('D1', { ts: '10', user: 'U1', text: 'older correction', edited: { ts: '11' } });
    assert.equal(f.store.events(run.id).filter(event => event.type === 'steering').length, steering);
    assert.equal(f.ingress.acceptAuthenticated('T1', { type: 'message', channel: 'D1', subtype: 'message_deleted', event_ts: '13', previous_message: { ts: '10', user: 'U1', text: 'corrected' } })!.run.status, 'cancelled');
  } finally { f.close(); }
});

test('bounded recovery admits offline unmentioned DM roots and deduplicates live/history overlap', async () => {
  const f = fixture();
  try {
    const live = f.ingress.acceptHistory('D1', { ts: '10', user: 'U1', text: 'live' })!.run;
    const recovery = new SlackRecovery({ store: f.store, ingress: f.ingress, coverageStart: '1', lookbackSeconds: 100, now: () => 20000, maxPagesPerTick: 1,
      api: { async call<T>(_method: string, args: Record<string, string>) { return { messages: args.channel === 'D1' && !args.ts ? [{ ts: '10', user: 'U1', text: 'live' }, { ts: '11', user: 'U1', text: 'offline' }, { ts: '12', user: 'U2', text: 'excluded' }] : [] } as T; } } });
    let complete = false; for (let i = 0; i < 8 && !complete; i++) complete = (await recovery.tick()).complete;
    assert.equal(complete, true); assert.equal(f.store.list('runs').length, 2);
    assert.equal(f.ingress.acceptHistory('D1', { ts: '10', user: 'U1', text: 'live' })!.run.id, live.id);
    assert.ok(f.runtime.getRun(live.id)); assert.deepEqual(f.ingress.threads().filter(thread => thread.channel === 'D1').map(thread => thread.threadTs).sort(), ['10', '11']);
  } finally { f.close(); }
});

test('both ingress and application configuration require an exact private DM user grant', () => {
  const f = fixture();
  try {
    const stateDirectory = join(f.root, 'state'), workspaceDirectory = join(f.root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
    const promptFile = join(f.root, 'mind'), compactionPromptFile = join(f.root, 'compact'); writeFileSync(promptFile, 'fixture'); writeFileSync(compactionPromptFile, 'fixture');
    const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: resolve(fileURLToPath(new URL('../../../../..', import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'dm-fixture', controlRevision: 'c1', promptFile, compactionPromptFile,
      model: { id: 'fixture-model', contextWindow: 32768, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false,
      scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: privateScope, modificationEligible: true },
      slack: { teamId: 'T1', botUserId: 'BOT', channels: [directGrant], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true } };
    assert.deepEqual(validateConfiguration(config).slack!.channels[0], directGrant);
    const invalid: SlackChannelGrant[] = [{ ...directGrant, channel: 'C1' }, { ...directGrant, directUserId: '' }, { ...directGrant, directUserId: 'BOT' }, { ...directGrant, scope: { kind: 'public' } }, { ...directGrant, scope: { kind: 'restricted', principals: ['slack:T1:U2'] } }, { ...directGrant, scope: { kind: 'restricted', principals: ['slack:T1:U1', 'slack:T1:U2'] } }];
    for (const grant of invalid) {
      assert.throws(() => new SlackIngress({ ...f.ingress.options, channels: [grant] }), /direct|DM/i);
      assert.throws(() => validateConfiguration({ ...config, slack: { ...config.slack!, channels: [grant] } }), /direct|DM/i);
    }
  } finally { f.close(); }
});
