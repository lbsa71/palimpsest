import { spokenTurn } from './fixtures/autark.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeBaseline } from '../src/candidates.ts';
import { SlackCommunications } from '../src/communications.ts';
import { ConversationActions } from '../src/conversation-actions.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import { GenerationHost } from '../src/generations.ts';
import type { CompletionRequest, Provider } from '../src/providers.ts';
import { Store } from '../src/store.ts';

test('genuine scoped workers retain outcomes across host restart and deliver original-thread Slack receipts', { skip: process.platform !== 'darwin' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-social-host-'));
  const repositoryRoot = join(directory, 'repo'), dataDir = join(directory, 'state'), path = join(dataDir, 'state.sqlite');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs')); mkdirSync(dataDir);
  // Exercise the unchanged cognitive source through the actual restricted RPC
  // worker. Provider and Slack HTTP boundaries remain deterministic fixtures.
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), readFileSync(new URL('../src/agent/brain.ts', import.meta.url)));
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), readFileSync(new URL('../docs/seed-contract.md', import.meta.url)));
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'fixture baseline');
  const baseline = freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null },
    requiredChecks: ['typecheck', 'trusted-agent-contract', 'cross-scope-memory', 'memory-provenance'] });
  let store = new Store(path); let now = 0; const requests: CompletionRequest[] = [], httpBodies: { channel: string; thread_ts: string; text: string }[] = [];
  const scope = 'slack:T1:C1:123.456'; const peerSent: string[] = [];
  const provider: Provider = { name: 'fixture', async complete(request) {
    requests.push(structuredClone({ ...request, signal: undefined }));
    const topic = { question: 'Which name fits?', stance: 'A provisional short name.', rationale: 'Independent but unverified preference.', unresolved: ['Historical collision.'], status: 'pending', reflection: null, topicId: null };
    return { text: spokenTurn({ reply: 'A provisional choice; the historical question remains open.', outcomes: [topic],
      ...(request.system.includes('Interactive host protocol') ? { disposition: 'converse', rationale: 'Independent preference.', proposal: null } : {}) }),
      provider: 'fixture', model: 'deterministic', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const slack = new SlackCommunications({ token: 'synthetic-fixture-token', fetch: async (_url, init) => {
    const body = JSON.parse(String(init!.body)); httpBodies.push(body);
    return new Response(JSON.stringify({ ok: true, channel: body.channel, ts: `900.${httpBodies.length}` }));
  } });
  const make = () => {
    const continuity = new ConversationContinuity({ store, provider, now: () => now, reviewMs: 10, lifetimeMs: 100 });
    const host = new GenerationHost({ repositoryRoot, dataDir, store, provider, model: null, conversationContinuity: continuity,
      conversationActions: new ConversationActions({ store, userIds: ['U1'], sourceContext: () => 'fixture' }),
      communications: [slack, { name: 'peer', send: async message => { peerSent.push(message.text); } }] });
    return { host, continuity };
  };
  let pair = make();
  try {
    await pair.host.start(baseline);
    const first = await pair.host.submit({ id: 'slack-first', source: 'slack', conversationId: scope, replyTo: '123.456', slackAuthor: { teamId: 'T1', userId: 'U1' }, text: 'Consider a provisional name.' });
    await pair.host.drain(); assert.equal(store.task(first.id)!.state, 'succeeded');
    const topicId = store.listConversationTopics(scope)[0]!.id; assert.equal(store.conversationTopic(topicId)!.report.owedRevision, 1);
    const priorLaunch = pair.host.custodian.inspect().active!.process.instanceId;
    await pair.host.close(); store.close(); store = new Store(path); pair = make(); now = 11;
    await pair.host.start(); assert.notEqual(pair.host.custodian.inspect().active!.process.instanceId, priorLaunch);
    pair.continuity.review(); await pair.host.drain(); pair.continuity.reconcileReports();
    const topic = store.conversationTopic(topicId)!;
    assert.equal(requests.length, 1, 'restart follow-through requires no new inference or human request');
    assert.equal(topic.report.owedRevision, null); assert.deepEqual(topic.report.receipt, { delivered: true, receipt: { transport: 'slack', messageId: '900.2' } });
    assert.equal(httpBodies.length, 2); assert.ok(httpBodies.every(body => body.channel === 'C1' && body.thread_ts === '123.456')); assert.match(httpBodies[1]!.text, /inconclusive/i);
    await pair.host.submit({ id: 'slack-later', source: 'slack', conversationId: scope, replyTo: '123.456', slackAuthor: { teamId: 'T1', userId: 'U1' }, text: 'What is your current stance?' }); await pair.host.drain();
    assert.match(requests[1]!.prompt, /A provisional short name/);
    store.addMemory({ scope, kind: 'episodic', content: 'PRIVATE_SLACK_CANARY_413', source: 'private fixture', confidence: 1 });
    await pair.host.submit({ id: 'peer-first', source: 'peer', conversationId: 'peer:ordinary', text: 'Consider a peer question.' }); await pair.host.drain();
    assert.doesNotMatch(requests[2]!.prompt + requests[2]!.system, /PRIVATE_SLACK_CANARY|Which name fits/);
    now = 22; pair.continuity.review(); await pair.host.drain();
    await pair.host.submit({ id: 'peer-later', source: 'peer', conversationId: 'peer:ordinary', text: 'What is our current stance?' }); await pair.host.drain();
    assert.match(requests[3]!.prompt, /A provisional short name/); assert.doesNotMatch(requests[3]!.prompt, /PRIVATE_SLACK_CANARY/);
    assert.equal(store.listGrowth().length, 0); assert.equal(store.listConversationReflections().length, 0); assert.equal(peerSent.length, 3);
  } finally { await pair.host.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
