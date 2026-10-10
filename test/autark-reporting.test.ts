import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store, type ConversationOutcome, type Json } from '../src/store.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import { createHash } from 'node:crypto';
import { AgentRuntime } from '../src/runtime.ts';
import { CodingServing } from '../src/coding-serving.ts';
import type { Provider } from '../src/providers.ts';

const privateOutcome = (status: 'pending' | 'settled' = 'pending'): ConversationOutcome => ({
  question: 'PRIVATE_QUESTION', stance: 'PRIVATE_STANCE', rationale: 'PRIVATE_RATIONALE', unresolved: ['PRIVATE_UNRESOLVED'], status,
});
const object = (value: Json): Record<string, Json> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
function fixture(actions: unknown[] = [], reflection = true, reflectionStatus: 'pending' | 'settled' = 'settled') {
  const directory = mkdtempSync(join(tmpdir(), 'autark-reporting-'));
  const store = new Store(join(directory, 'state.sqlite')); let now = 0;
  const provider: Provider = { name: 'fixture', complete: async () => ({ text: JSON.stringify({ ...privateOutcome(reflectionStatus), actions }),
    provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }) };
  const continuity = new ConversationContinuity({ store, provider, now: () => now, reviewMs: 10, lifetimeMs: 100 });
  store.enqueue({ id: 'origin', source: 'direct', conversationId: 'ordinary', input: 'Consider this privately.' });
  store.updateTask('origin', { state: 'running', checkpoint: { replyTo: null } });
  const [topic] = store.prepareConversationTopics('origin', [{ outcome: privateOutcome(), ...(reflection ? { reflectionQuestion: 'PRIVATE_INQUIRY' } : {}) }], [],
    { now, reviewMs: 10, lifetimeMs: 100, maxAttempts: 1 });
  store.finishConversationTask('origin', 'Acknowledged', { scope: 'ordinary', kind: 'episodic', source: 'task:origin', confidence: 1, content: 'Observed exchange' });
  return { store, continuity, directory, topicId: topic!.id, now: (value: number) => { now = value; },
    reflect: async () => { store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 }); await continuity.reflect('window', new AbortController().signal); },
    report: () => store.task(store.conversationTopic(topic!.id)!.report.taskId!)!,
    cleanup: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('holding and inconclusive closure never publish private outcome fields and retain delivery debt', () => {
  const f = fixture();
  try {
    f.now(11); f.continuity.review(); const holding = f.report();
    assert.match(String(object(holding.checkpoint).answer), /^Host notice:/);
    assert.doesNotMatch(String(object(holding.checkpoint).answer), /PRIVATE_/);
    assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, 1);
    f.now(101); f.continuity.review(); const final = f.report();
    assert.doesNotMatch(String(object(final.checkpoint).answer), /PRIVATE_/);
    assert.notEqual(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
  } finally { f.cleanup(); }
});

test('reflection retains private outcome and publishes only its explicit revision-bound say', async () => {
  const f = fixture([{ name: 'say', arguments: { text: 'A considered public follow-up.' } }]);
  try {
    await f.reflect(); assert.equal(f.store.listConversationReflections()[0]!.state, 'completed');
    assert.equal(f.store.conversationTopic(f.topicId)!.outcome.stance, 'PRIVATE_STANCE');
    f.continuity.review(); const report = f.report();
    assert.equal(object(report.checkpoint).answer, 'A considered public follow-up.');
    assert.deepEqual(object(report.checkpoint).preparedSpeech, { version: 'prepared-speech/1', kind: 'say' });
    assert.equal(f.continuity.reportMaySend(report), true);
    f.store.reviseConversationOutcome(f.topicId, privateOutcome('settled'), 2, 'newer_interpretation');
    assert.equal(f.continuity.reportMaySend(report), false);
    f.now(2); f.continuity.review(); assert.doesNotMatch(String(object(f.report().checkpoint).answer), /PRIVATE_|considered public/);
  } finally { f.cleanup(); }
});

test('reflection silence keeps cognition private but discharges mandatory report only after host notice receipt', async () => {
  const f = fixture([]);
  try {
    await f.reflect(); assert.equal(f.store.listConversationReflections()[0]!.state, 'completed');
    f.continuity.review(); const report = f.report();
    assert.match(String(object(report.checkpoint).answer), /^Host notice:/);
    assert.doesNotMatch(String(object(report.checkpoint).answer), /PRIVATE_/);
    assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, 2);
    f.store.updateTask(report.id, { state: 'running' });
    f.store.reserveEffect({ id: `${report.id}:result`, taskId: report.id, kind: 'communication', payload: { text: object(report.checkpoint).answer! } });
    f.continuity.reconcileReports(); assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, 2);
    f.store.completeEffect(`${report.id}:result`, { delivered: true }); f.continuity.reconcileReports();
    assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
  } finally { f.cleanup(); }
});

test('silent foreground normalized decision retains a nonempty internal interpretation', () => {
  const f = fixture();
  try {
    const task = f.store.enqueue({ id: 'silent', source: 'direct', conversationId: 'ordinary', input: 'Think silently.' });
    f.store.updateTask(task.id, { state: 'running' });
    f.continuity.prepare(task, [], { system: 'Fixture', prompt: task.input, maxOutputTokens: 100 });
    assert.equal(f.continuity.accept(f.store.task(task.id)!, JSON.stringify({ reply: '', outcomes: [] }), false), '');
    const topic = f.store.listConversationTopics().find(item => item.originalTaskId === task.id)!;
    assert.ok(topic.outcome.stance.trim());
  } finally { f.cleanup(); }
});

test('coding result reports fixed host status while keeping model stop summary private', () => {
  const f = fixture([], false);
  try {
    const serving = new CodingServing({ store: f.store, coordinator: () => ({} as never), artifacts: () => ({} as never),
      available: () => true, authorizeOrigin: () => true, authorizeSubmission: () => {}, now: () => 1 });
    f.store.appendEvent('coding.serving.outcome', { sessionId: 'session', originTaskId: 'origin', summary: 'PRIVATE_CODING_STOP', submissionId: null }, 'origin');
    serving.reconcile(); const event = f.store.listEvents().find(item => item.type === 'coding.serving.report_prepared')!;
    const reportId = (object(event.payload).reportTaskIds as string[])[0]!;
    const report = f.store.task(reportId)!;
    assert.match(String(object(report.checkpoint).answer), /^Host notice:/);
    assert.doesNotMatch(String(object(report.checkpoint).answer), /PRIVATE_/);
    assert.equal(serving.reportMaySend(report), true);
  } finally { f.cleanup(); }
});

for (const effectState of ['none', 'reserved', 'unknown', 'completed'] as const) test(`legacy report migration respects ${effectState} delivery state`, () => {
  const f = fixture([], false);
  try {
    const report = f.store.prepareConversationReport(f.topicId, 'PRIVATE_LEGACY_REPORT', 'final', 10)!;
    const { preparedSpeech: _prepared, ...checkpoint } = object(report.checkpoint);
    f.store.updateTask(report.id, { checkpoint });
    if (effectState !== 'none') {
      f.store.updateTask(report.id, { state: 'running' });
    f.store.reserveEffect({ id: `${report.id}:result`, taskId: report.id, kind: 'communication', payload: { text: 'PRIVATE_LEGACY_REPORT' } });
      if (effectState === 'unknown') f.store.markEffectUnknown(`${report.id}:result`, 'Uncertain external delivery');
      if (effectState === 'completed') f.store.completeEffect(`${report.id}:result`, { delivered: true });
    }
    const before = f.store.effect(`${report.id}:result`);
    const current = f.continuity.sanitizeReport(f.store.task(report.id)!);
    assert.deepEqual(f.store.effect(`${report.id}:result`), before);
    if (effectState === 'none') {
      assert.match(String(object(current.checkpoint).answer), /^Host notice:/);
      assert.doesNotMatch(String(object(current.checkpoint).answer), /PRIVATE_/);
      assert.equal(f.continuity.reportMaySend(current), true);
    } else assert.equal(object(current.checkpoint).answer, 'PRIVATE_LEGACY_REPORT');
    assert.notEqual(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
  } finally { f.cleanup(); }
});


test('explicit reflection say survives reopening and reaches the real sink without private markers or another inference', async () => {
  const f = fixture([{ name: 'say', arguments: { text: 'Public follow-up after reflection.' } }]);
  let reopened: Store | undefined, runtime: AgentRuntime | undefined;
  try {
    await f.reflect(); f.store.close(); reopened = new Store(join(f.directory, 'state.sqlite'));
    const provider: Provider = { name: 'forbidden', complete: async () => { throw new Error('No report inference authorized'); } };
    const continuity = new ConversationContinuity({ store: reopened, provider, now: () => 1 });
    const sent: string[] = [];
    runtime = new AgentRuntime({ store: reopened, provider, conversationContinuity: continuity,
      communications: [{ name: 'direct', send: async message => { sent.push(message.text); return { transport: 'fixture', messageId: 'receipt' }; } }] });
    continuity.review(); await runtime.runUntilIdle();
    assert.deepEqual(sent, ['Public follow-up after reflection.']);
    assert.equal(reopened.conversationTopic(f.topicId)!.outcome.rationale, 'PRIVATE_RATIONALE');
    assert.equal(reopened.conversationTopic(f.topicId)!.report.owedRevision, null);
    assert.deepEqual(reopened.conversationTopic(f.topicId)!.report.receipt, { delivered: true, receipt: { transport: 'fixture', messageId: 'receipt' } });
    await runtime.runUntilIdle(); assert.equal(sent.length, 1);
  } finally { await runtime?.stop(); reopened?.close(); f.cleanup(); }
});

for (const action of [
  { name: 'say', arguments: { text: 'PRIVATE_BAD_SAY', destination: 'another-scope' } },
  { name: 'other', arguments: { text: 'PRIVATE_BAD_SAY' } },
  { name: 'say', arguments: { text: '' } },
]) test(`invalid reflection action ${JSON.stringify(action)} rejects public speech and retains the obligation`, async () => {
  const f = fixture([action]);
  try {
    await f.reflect(); assert.equal(f.store.listConversationReflections()[0]!.state, 'rejected');
    assert.equal(f.store.conversationTopic(f.topicId)!.speech, undefined);
    f.now(11); f.continuity.review();
    assert.match(String(object(f.report().checkpoint).answer), /^Host notice:/);
    assert.doesNotMatch(String(object(f.report().checkpoint).answer), /PRIVATE_/);
    assert.notEqual(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
  } finally { f.cleanup(); }
});

for (const effectState of ['none', 'reserved', 'unknown', 'completed'] as const) test(`legacy coding report migration preserves ${effectState} effects and bound delivery`, () => {
  const f = fixture([], false);
  try {
    const report = f.store.enqueuePreparedReply({ source: 'direct', conversationId: 'ordinary', input: 'Historical report' }, 'PRIVATE_OLD_CODING_SUMMARY');
    const { preparedSpeech: _preparation, ...checkpoint } = object(report.checkpoint);
    f.store.updateTask(report.id, { checkpoint });
    const boundRoute = { source: 'direct', scope: 'ordinary', slackAuthor: null, replyTo: null };
    f.store.appendEvent('coding.report.prepared', { version: 'coding-report/1', sessionId: 'old-session', reportTaskId: report.id, originTaskId: 'origin',
      originRoute: boundRoute, reportRoute: boundRoute, textDigest: createHash('sha256').update('PRIVATE_OLD_CODING_SUMMARY').digest('hex'),
      requiresSourceAuthority: true, topics: [], sourceRefs: [], sourceTaskIds: ['origin'] }, report.id);
    if (effectState !== 'none') {
      f.store.updateTask(report.id, { state: 'running' });
      f.store.reserveEffect({ id: `${report.id}:result`, taskId: report.id, kind: 'communication', payload: { text: 'PRIVATE_OLD_CODING_SUMMARY' } });
      if (effectState === 'unknown') f.store.markEffectUnknown(`${report.id}:result`, 'Uncertain delivery');
      if (effectState === 'completed') f.store.completeEffect(`${report.id}:result`, { delivered: true });
    }
    const serving = new CodingServing({ store: f.store, coordinator: () => ({} as never), artifacts: () => ({} as never),
      available: () => true, authorizeOrigin: () => true, authorizeSubmission: () => {} });
    const before = f.store.effect(`${report.id}:result`), sanitized = serving.sanitizeReport(f.store.task(report.id)!);
    assert.deepEqual(f.store.effect(`${report.id}:result`), before);
    if (effectState === 'none') {
      assert.match(String(object(sanitized.checkpoint).answer), /^Host notice:/);
      assert.doesNotMatch(String(object(sanitized.checkpoint).answer), /PRIVATE_/);
      assert.equal(serving.reportMaySend(sanitized), true);
    } else assert.equal(object(sanitized.checkpoint).answer, 'PRIVATE_OLD_CODING_SUMMARY');
  } finally { f.cleanup(); }
});


test('a pending reflection say is delivered once as a holding report before finite closure', async () => {
  const f = fixture([{ name: 'say', arguments: { text: 'The question remains unresolved.' } }], true, 'pending');
  const sent: string[] = [];
  const provider: Provider = { name: 'forbidden', complete: async () => { throw new Error('No report inference authorized'); } };
  const runtime = new AgentRuntime({ store: f.store, provider, conversationContinuity: f.continuity,
    communications: [{ name: 'direct', send: async message => { sent.push(message.text); } }] });
  try {
    await f.reflect(); f.continuity.review();
    assert.equal(object(f.report().checkpoint).answer, 'The question remains unresolved.');
    assert.equal(f.store.conversationTopic(f.topicId)!.report.kind, 'holding');
    await runtime.runUntilIdle(); assert.deepEqual(sent, ['The question remains unresolved.']);
    assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, 2);
    f.now(11); f.continuity.review(); await runtime.runUntilIdle();
    assert.equal(sent.length, 2); assert.match(sent[1]!, /^Host notice:.*closed inconclusively/);
    assert.doesNotMatch(sent[1]!, /PRIVATE_/);
    assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
  } finally { await runtime.stop(); f.cleanup(); }
});

for (const malformed of ['PRIVATE_HIGH_\ud800', 'PRIVATE_LOW_\udfff']) {
  test(`reflection rejects malformed Unicode speech ${JSON.stringify(malformed)} before outcome admission`, async () => {
    const f = fixture([{ name: 'say', arguments: { text: malformed } }]);
    try {
      const before = f.store.conversationTopic(f.topicId)!;
      await f.reflect();
      assert.equal(f.store.listConversationReflections()[0]!.state, 'rejected');
      assert.deepEqual(f.store.conversationTopic(f.topicId), before);
      assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
      assert.equal(f.store.listEvents().some(event => event.type === 'conversation.reflection.say.admitted'), false);
      f.now(11); f.continuity.review();
      assert.match(String(object(f.report().checkpoint).answer), /^Host notice:/);
      assert.doesNotMatch(String(object(f.report().checkpoint).answer), /PRIVATE_/);
      assert.notEqual(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
    } finally { f.cleanup(); }
  });

  test(`atomic reflection completion rejects malformed Unicode speech ${JSON.stringify(malformed)} without partial publication`, () => {
    const f = fixture();
    try {
      const before = f.store.conversationTopic(f.topicId)!;
      f.store.openGrowthWindow({ id: 'atomic-window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 });
      const reflection = f.store.claimConversationReflection(before.reflectionId!, 'atomic-window', 0)!;
      const memoryCount = f.store.listMemories('ordinary').length;
      assert.throws(() => f.store.completeConversationReflection(reflection.id, before.revision, privateOutcome('settled'), 1, { provider: 'fixture' }, malformed), /Unicode/);
      assert.deepEqual(f.store.conversationTopic(f.topicId), before);
      assert.equal(f.store.conversationReflection(reflection.id)!.state, 'running');
      assert.equal(f.store.listMemories('ordinary').length, memoryCount);
      assert.equal(f.store.growthWindow('atomic-window')!.usedCalls, 1);
      assert.equal(f.store.listEvents().some(event => event.type === 'conversation.reflection.say.admitted'), false);
    } finally { f.cleanup(); }
  });
}

test('valid multilingual reflection speech reaches the sink with exact Unicode unchanged', async () => {
  const speech = 'Salut 👋🏽 — こんにちは — e\u0301';
  const f = fixture([{ name: 'say', arguments: { text: speech } }]);
  const sent: string[] = [];
  const provider: Provider = { name: 'forbidden', complete: async () => { throw new Error('No report inference authorized'); } };
  const runtime = new AgentRuntime({ store: f.store, provider, conversationContinuity: f.continuity,
    communications: [{ name: 'direct', send: async message => { sent.push(message.text); } }] });
  try {
    await f.reflect(); f.continuity.review(); await runtime.runUntilIdle();
    assert.deepEqual(sent, [speech]);
    assert.equal(f.store.conversationTopic(f.topicId)!.speech!.text, speech);
    assert.equal(f.store.conversationTopic(f.topicId)!.report.owedRevision, null);
  } finally { await runtime.stop(); f.cleanup(); }
});
