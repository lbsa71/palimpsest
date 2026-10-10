import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/store.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { ConversationActions } from '../src/conversation-actions.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import type { CompletionRequest, Provider } from '../src/providers.ts';
import { ProviderError } from '../src/providers.ts';
import { CommunicationsError } from '../src/communications.ts';
import { GrowthScheduler } from '../src/scheduler.ts';

const outcome = (status = 'pending', reflection: null | { question: string } = null) => ({ question: 'Which provisional name fits?', stance: 'The short name currently fits.', rationale: 'It is easy to say; the example was not an instruction.', unresolved: status === 'pending' ? ['Consider the historical collision.'] : [], status, reflection, topicId: null as string | null });
function provider(answer: (request: CompletionRequest) => unknown | Promise<unknown>): Provider {
  return { name: 'fixture', async complete(request) { return { text: JSON.stringify(await answer(request)), provider: 'fixture', model: 'deterministic', usage: { inputTokens: 1, outputTokens: 1 } }; } };
}

test('pending topic without reflection or explicit promise returns unprompted and survives reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-conversation-')); const path = join(dir, 'state.sqlite');
  let store = new Store(path); let now = 0; const sent: string[] = [];
  const p = provider(() => ({ reply: 'The short name fits for now; the historical question remains open.', disposition: 'converse', rationale: 'A provisional independent choice.', proposal: null, outcomes: [outcome()] }));
  const make = () => {
    const continuity = new ConversationContinuity({ store, provider: p, now: () => now, reviewMs: 10 });
    const runtime = new AgentRuntime({ store, provider: p, conversationContinuity: continuity,
      conversationActions: new ConversationActions({ store, userIds: [], allowDirectOperator: true, sourceContext: () => 'fixture' }),
      communications: [{ name: 'direct', send: async message => { sent.push(message.text); } }] });
    return { runtime, continuity };
  };
  let pair = make();
  try {
    const task = await pair.runtime.submit({ id: 'choice', source: 'direct', conversationId: 'ordinary', text: 'Consider a provisional name.' });
    await pair.runtime.runUntilIdle();
    assert.equal(store.task(task.id)?.state, 'succeeded');
    assert.equal(store.listConversationTopics('ordinary').length, 1);
    assert.equal(store.listConversationReflections().length, 0);
    assert.equal(store.listConversationTopics('ordinary')[0]!.report.owedRevision, 1);
    await pair.runtime.stop(); store.close(); store = new Store(path); pair = make(); now = 11;
    pair.continuity.review(); await pair.runtime.runUntilIdle(); pair.continuity.reconcileReports();
    assert.equal(sent.length, 2);
    assert.match(sent[1]!, /inconclusive/i);
    assert.equal(store.listConversationTopics('ordinary')[0]!.report.owedRevision, null);
    const requests: CompletionRequest[] = [];
    const later = new AgentRuntime({ store, provider: provider(request => { requests.push(request); return { reply: 'My provisional stance remains.', disposition: 'converse', rationale: 'Retrieved interpretation.', proposal: null, outcomes: [] }; }),
      conversationContinuity: pair.continuity, conversationActions: new ConversationActions({ store, userIds: [], allowDirectOperator: true, sourceContext: () => 'fixture' }),
      communications: [{ name: 'direct', send: async () => {} }] });
    await later.submit({ id: 'later', source: 'direct', conversationId: 'ordinary', text: 'What did you decide?' }); await later.runUntilIdle();
    assert.match(requests[0]!.prompt + requests[0]!.system, /short name currently fits/);
    assert.equal(store.listGrowth().length, 0); await later.stop();
  } finally { await pair.runtime.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

function fixture(answer: (request: CompletionRequest) => unknown | Promise<unknown>, options: { source?: string; maxAttempts?: number; send?: (text: string) => Promise<void | { transport: string; messageId: string }> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-conversation-')); const path = join(dir, 'state.sqlite');
  const store = new Store(path); const p = provider(answer); let now = 0; let busy = false; const sent: string[] = [];
  const source = options.source ?? 'direct'; const scope = source === 'peer' ? 'peer:ordinary' : source === 'slack' ? 'slack:T1:C1:123.456' : 'ordinary';
  const continuity = new ConversationContinuity({ store, provider: p, now: () => now, reviewMs: 10, lifetimeMs: 100, maxAttempts: options.maxAttempts, hasUserWork: () => busy });
  const runtime = new AgentRuntime({ store, provider: p, conversationContinuity: continuity,
    conversationActions: new ConversationActions({ store, userIds: ['U1'], allowDirectOperator: true, sourceContext: () => 'fixture' }),
    communications: [{ name: source, send: async message => { assert.equal(message.conversationId, scope); if (source === 'slack') assert.equal(message.replyTo, '123.456'); sent.push(message.text); return options.send?.(message.text); } }] });
  return { store, path, p, runtime, continuity, sent, dir, scope, now: (value: number) => { now = value; }, busy: (value: boolean) => { busy = value; },
    submit: async (id = 'first', text = 'Think about the provisional name.') => runtime.submit({ id, source, conversationId: scope, text, ...(source === 'slack' ? { replyTo: '123.456', slackAuthor: { teamId: 'T1', userId: 'U1' } } : {}) }),
    cleanup: async () => { await runtime.stop(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function decision(item = outcome()) { return { reply: 'A provisional stance; the historical question is pending.', disposition: 'converse', rationale: 'Independent interpretation.', proposal: null, outcomes: [item] }; }
function reflectionResult() { const { topicId: _topic, reflection: _reflection, ...result } = outcome('settled'); return { ...result, stance: 'After thought, the short name remains provisional.', rationale: 'The collision does not by itself outweigh ease of speech.' }; }

test('retained question runs finitely in shared allocation and result reaches later eligible request after reopen', async () => {
  const requests: CompletionRequest[] = [];
  const f = fixture(request => { requests.push(request); return request.system.startsWith('Reflect on') ? reflectionResult() : decision(outcome('pending', { question: 'Does the recorded historical collision change my provisional preference?' })); });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const before = f.store.listConversationTopics(f.scope)[0]!;
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 });
    f.now(1); await f.continuity.reflect('window', new AbortController().signal);
    assert.match(requests[1]!.prompt, /Does the recorded historical collision/);
    assert.equal(f.store.listConversationReflections()[0]!.state, 'completed'); assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
    const after = f.store.conversationTopic(before.id)!; assert.equal(after.revision, 2); assert.equal(after.report.owedRevision, 2);
    await f.continuity.reflect('window', new AbortController().signal); assert.equal(requests.length, 2);
    f.continuity.review(); await f.runtime.runUntilIdle(); f.continuity.reconcileReports();
    assert.equal(f.sent.length, 2); assert.match(f.sent[1]!, /After thought/); assert.equal(f.store.conversationTopic(before.id)!.report.owedRevision, null);
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); const captured: CompletionRequest[] = [];
    const next = new AgentRuntime({ store: reopened, provider: provider(request => { captured.push(request); return decision(outcome('settled')); }), conversationContinuity: new ConversationContinuity({ store: reopened, provider: f.p }),
      conversationActions: new ConversationActions({ store: reopened, userIds: [], allowDirectOperator: true, sourceContext: () => 'fixture' }), communications: [{ name: 'direct', send: async () => {} }] });
    await next.submit({ id: 'later', source: 'direct', conversationId: f.scope, text: 'What is your stance now?' }); await next.runUntilIdle();
    assert.match(captured[0]!.prompt, /After thought, the short name remains provisional/);
    assert.equal(reopened.listGrowth().length, 0); await next.stop(); reopened.close();
  } finally { await f.cleanup(); }
});

test('holding delivery and work completion leave final report owed, with exact Slack receipt and destination', async () => {
  const f = fixture(request => request.system.startsWith('Reflect on') ? reflectionResult() : decision(outcome('pending', { question: 'Consider the collision.' })),
    { source: 'slack', send: async () => ({ transport: 'slack', messageId: '321.654' }) });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); f.now(11); f.continuity.review(); await f.runtime.runUntilIdle();
    let topic = f.store.listConversationTopics(f.scope)[0]!;
    assert.equal(topic.report.kind, 'holding'); assert.equal(topic.report.delivery, 'delivered'); assert.equal(topic.report.owedRevision, 1);
    assert.deepEqual(topic.report.receipt, { delivered: true, receipt: { transport: 'slack', messageId: '321.654' } });
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 }); await f.continuity.reflect('window', new AbortController().signal);
    topic = f.store.conversationTopic(topic.id)!; assert.equal(topic.report.owedRevision, 2); assert.equal(f.store.listConversationReflections()[0]!.state, 'completed');
    f.continuity.review(); await f.runtime.runUntilIdle(); assert.equal(f.store.conversationTopic(topic.id)!.report.owedRevision, null);
    assert.equal(f.sent.length, 3); assert.match(f.sent[1]!, /holding update/i); assert.match(f.sent[2]!, /After thought/);
  } finally { await f.cleanup(); }
});

test('older revision delivered during a newer exchange cannot clear the newer obligation', async () => {
  let resolve!: () => void; let sending!: () => void; const began = new Promise<void>(ready => { sending = ready; }); let topicId: string | undefined; let calls = 0;
  const f = fixture(() => { calls++; return decision({ ...outcome(), topicId: calls > 1 ? topicId! : null }); }, { send: async () => {
    if (f.sent.length === 2) { sending(); await new Promise<void>(ready => { resolve = ready; }); }
  } });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); topicId = f.store.listConversationTopics(f.scope)[0]!.id;
    f.now(11); f.continuity.review(); const sendingReport = f.runtime.runUntilIdle(); await began;
    const second = new AgentRuntime({ store: f.store, provider: f.p, conversationContinuity: f.continuity,
      conversationActions: new ConversationActions({ store: f.store, userIds: [], allowDirectOperator: true, sourceContext: () => 'fixture' }), communications: [{ name: 'direct', send: async () => {} }] });
    await second.submit({ id: 'new-question', source: 'direct', conversationId: f.scope, text: 'I have new context; the decision remains pending.' }); await second.runUntilIdle();
    const newer = f.store.conversationTopic(topicId)!; assert.equal(newer.revision, 3); assert.equal(newer.report.owedRevision, 3);
    resolve(); await sendingReport; f.continuity.reconcileReports();
    assert.equal(f.store.conversationTopic(topicId)!.report.owedRevision, 3); assert.equal(f.store.conversationTopic(topicId)!.report.lastReportedRevision, 2);
    await second.stop();
  } finally { resolve?.(); await f.cleanup(); }
});

for (const delivery of ['uncertain', 'rejected'] as const) test(`${delivery} final report stays owed without blind resend or fabricated receipt`, async () => {
  let calls = 0; const f = fixture(() => { calls++; return decision(); }, { send: async () => { if (f.sent.length > 1) throw new CommunicationsError('fixture_send', delivery); } });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); f.now(11); f.continuity.review(); await f.runtime.runUntilIdle(); f.continuity.reconcileReports();
    const topic = f.store.listConversationTopics(f.scope)[0]!; assert.equal(topic.report.owedRevision, 2);
    assert.equal(topic.report.delivery, delivery === 'uncertain' ? 'unknown' : 'rejected');
    const effect = f.store.effect(topic.report.effectId!)!; assert.equal(effect.state, delivery === 'uncertain' ? 'unknown' : 'completed');
    assert.notDeepEqual(effect.result, { delivered: true });
    for (let tick = 0; tick < 3; tick++) { f.now(30 + tick * 20); f.continuity.review(); await f.runtime.runUntilIdle(); }
    assert.equal(f.sent.length, 2); assert.equal(calls, 1); assert.equal(f.store.listTasks().length, 2);
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); reopened.recoverInterrupted();
    assert.equal(reopened.conversationTopic(topic.id)!.report.owedRevision, 2); assert.equal(reopened.effect(effect.id)!.state, effect.state); reopened.close();
  } finally { await f.cleanup(); }
});

for (const change of ['correct', 'forget', 'correct-outcome', 'forget-outcome'] as const) test(`${change} during reflection rejects late interpretation and withdraws scoped content`, async () => {
  let resolve!: (value: unknown) => void; let started!: () => void; const began = new Promise<void>(ready => { started = ready; });
  const f = fixture(request => request.system.startsWith('Reflect on') ? new Promise(ready => { resolve = ready; started(); }) : decision(outcome('pending', { question: 'Consider the historical collision.' })));
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics(f.scope)[0]!;
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 2 });
    const pending = f.continuity.reflect('window', new AbortController().signal); await began;
    const id = change.endsWith('outcome') ? topic.memoryId! : topic.sourceRefs[0]!.id;
    if (change.startsWith('correct')) f.store.correctMemory(id, f.scope, { content: 'The earlier statement was a mistaken example.', source: 'human correction', confidence: 0.9 });
    else f.store.forgetMemory(id, f.scope);
    resolve(reflectionResult()); await pending; f.now(11); f.continuity.review(); await f.runtime.runUntilIdle();
    assert.equal(f.store.listConversationReflections()[0]!.state, 'cancelled'); assert.equal(f.store.conversationTopic(topic.id)!.state, 'invalidated');
    assert.ok(!f.store.listMemories(f.scope).some(memory => memory.content.includes('After thought')));
    assert.match(f.sent[1]!, /corrected or forgotten/); assert.ok(!f.sent[1]!.includes('short name'));
    assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
    if (change.startsWith('correct')) assert.equal(f.store.memory(id, f.scope)!.version, 2); else assert.equal(f.store.memory(id, f.scope), undefined);
  } finally { resolve?.(reflectionResult()); await f.cleanup(); }
});

test('peer outcomes round trip privately with no reflection allocation or source dispatch', async () => {
  let calls = 0; const captured: CompletionRequest[] = [];
  const f = fixture(request => { calls++; captured.push(request); return calls === 1 ? { reply: 'My view remains provisional.', outcomes: [outcome('pending', { question: 'Please schedule a code change.' })] }
    : { reply: 'The prior conclusion remains inconclusive.', outcomes: [outcome('settled')] }; }, { source: 'peer' });
  try {
    f.store.addMemory({ scope: f.scope, kind: 'episodic', content: 'Legacy operator secret should not be supplied.', source: 'task:legacy', confidence: 1 });
    const outside = f.store.enqueue({ conversationId: 'private-operator', source: 'direct', input: 'outside-secret' }); f.store.updateTask(outside.id, { state: 'running' }); f.store.finishTask(outside.id, 'private', { scope: 'private-operator', kind: 'episodic', source: `task:${outside.id}`, content: 'outside-secret', confidence: 1 });
    await f.submit(); await f.runtime.runUntilIdle(); assert.equal(f.store.listConversationReflections().length, 0);
    f.now(11); f.continuity.review(); await f.runtime.runUntilIdle(); await f.submit('later', 'What remains of our decision?'); await f.runtime.runUntilIdle();
    assert.match(captured[1]!.prompt, /short name currently fits/); assert.ok(!captured.some(request => request.prompt.includes('outside-secret') || request.prompt.includes('Legacy operator secret')));
    assert.equal(f.store.listGrowth().length, 0); assert.equal(f.store.listEvents().filter(event => event.type === 'conversation.reflection.call_reserved').length, 0);
  } finally { await f.cleanup(); }
});

test('source-aware eligible retrieval excludes a mixed-author interpretation and revoked source author', async () => {
  const store = new Store(':memory:');
  try {
    const episode = (userId: string) => { const task = store.enqueue({ source: 'slack', conversationId: 'slack:T1:C1:123.456', slackAuthor: { teamId: 'T1', userId }, input: `from ${userId}` }); store.updateTask(task.id, { state: 'running' }); store.finishTask(task.id, 'reply', { scope: task.conversationId, kind: 'episodic', source: `task:${task.id}`, content: `Evidence from ${userId}`, confidence: 1 }); return { task, memory: store.listMemories(task.conversationId).at(-1)! }; };
    const one = episode('U1'); const two = episode('U2');
    store.publishMemoryFromSourcesOnce({ scope: one.task.conversationId, publicationId: 'mixed', kind: 'autobiographical', source: 'consolidation:mixed', content: 'Mixed author interpretation cannot authorize source work.', confidence: 0.5, sourceRefs: [one.memory, two.memory].map(({ id, version }) => ({ id, version })) });
    const own = store.publishMemoryFromSourcesOnce({ scope: one.task.conversationId, publicationId: 'own', kind: 'autobiographical', source: 'consolidation:own', content: 'My own source-linked interpretation.', confidence: 0.5, sourceRefs: [{ id: one.memory.id, version: one.memory.version }] }).memory!;
    const actions = new ConversationActions({ store, userIds: ['U1', 'U2'], sourceContext: () => 'fixture' });
    const chosen = actions.selectMemories(one.task, store.listMemories(one.task.conversationId)); assert.ok(chosen.some(memory => memory.id === own.id)); assert.ok(!chosen.some(memory => memory.content.includes('Mixed author')));
    assert.equal(new ConversationActions({ store, userIds: ['U2'], sourceContext: () => 'fixture' }).selectMemories(one.task, store.listMemories(one.task.conversationId)).length, 0);
  } finally { store.close(); }
});

test('fair scheduler debits the existing window for reflection and standing growth without expanding allocation', async () => {
  const f = fixture(request => request.system.startsWith('Reflect on') ? reflectionResult() : request.system.includes('growth') && !request.system.includes('Ordinary conversation continuity')
    ? { observation: 'Scoped fixture observation', lesson: 'Cautious fixture interpretation', nextQuestion: 'A finite later question', proposedChange: null }
    : decision(outcome('pending', { question: 'Consider the retained question.' })));
  let scheduler: GrowthScheduler | undefined;
  try {
    for (let index = 0; index < 3; index++) { await f.submit(`topic-${index}`); await f.runtime.runUntilIdle(); }
    scheduler = new GrowthScheduler({ store: f.store, provider: f.p, hasUserWork: () => false, conversationContinuity: f.continuity, now: () => 1, callsPerWindow: 4, windowMs: 100 });
    for (let index = 0; index < 6; index++) await scheduler.tick();
    const reservations = f.store.listEvents().filter(event => ['conversation.reflection.call_reserved', 'growth.window.call_reserved'].includes(event.type));
    assert.deepEqual(reservations.map(event => event.type), ['conversation.reflection.call_reserved', 'growth.window.call_reserved', 'conversation.reflection.call_reserved', 'growth.window.call_reserved']);
    assert.equal(f.store.growthWindow('standing-growth-v1:0')!.usedCalls, 4); assert.equal(f.store.listConversationReflections().filter(item => item.state === 'completed').length, 2);
  } finally { await scheduler?.stop(); await f.cleanup(); }
});

test('preemption and provider failures retain immutable question and finite cumulative attempts across reopen', async () => {
  let resolve!: (value: unknown) => void; let started!: () => void; const began = new Promise<void>(ready => { started = ready; });
  const f = fixture(request => request.system.startsWith('Reflect on') ? new Promise(ready => { resolve = ready; started(); }) : decision(outcome('pending', { question: 'Keep this exact inquiry through interruption.' })), { maxAttempts: 1 });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 4 });
    const controller = new AbortController(); const pending = f.continuity.reflect('window', controller.signal); await began; controller.abort(); resolve(reflectionResult()); await pending;
    const inquiry = f.store.listConversationReflections()[0]!; assert.equal(inquiry.state, 'paused'); assert.equal(inquiry.attempts, 1); assert.equal(inquiry.question, 'Keep this exact inquiry through interruption.');
    await f.continuity.reflect('window', new AbortController().signal); assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); reopened.recoverConversationReflections();
    const continuation = new ConversationContinuity({ store: reopened, provider: provider(() => { throw new Error('Must not call after finite allocation'); }), maxAttempts: 1, reviewMs: 10, now: () => 11 });
    assert.equal(continuation.hasPendingReflection(), false); continuation.review(); assert.equal(reopened.conversationTopic(inquiry.topicId)!.outcome.status, 'settled');
    assert.equal(reopened.conversationTopic(inquiry.topicId)!.report.owedRevision, 2); assert.equal(reopened.listConversationReflections()[0]!.question, inquiry.question); reopened.close();
  } finally { resolve?.(reflectionResult()); await f.cleanup(); }
});

test('budget waits, malformed output and unavailable providers never borrow calls or create source work', async () => {
  let mode = 'conversation'; let calls = 0;
  const f = fixture(request => { calls++; if (request.system.startsWith('Reflect on')) { if (mode === 'offline') throw new ProviderError('unavailable', 'Fixture offline'); return { ...reflectionResult(), proposedChange: { files: [] } }; } return decision(outcome('pending', { question: 'A bounded question.' })); });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); f.store.openGrowthWindow({ id: 'empty', schedulerId: 'fixture-empty', startsAt: 0, endsAt: 100, maxCalls: 0 });
    await f.continuity.reflect('empty', new AbortController().signal); assert.equal(calls, 1); assert.equal(f.store.listConversationReflections()[0]!.attempts, 0);
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 2 }); mode = 'offline'; await f.continuity.reflect('window', new AbortController().signal);
    assert.equal(f.store.listConversationReflections()[0]!.state, 'paused'); mode = 'malformed'; await f.continuity.reflect('window', new AbortController().signal);
    assert.equal(f.store.listConversationReflections()[0]!.state, 'rejected'); assert.equal(f.store.growthWindow('window')!.usedCalls, 2); assert.equal(f.store.listGrowth().length, 0);
    f.now(11); f.continuity.review(); await f.runtime.runUntilIdle(); assert.match(f.sent[1]!, /Inconclusive closure/);
  } finally { await f.cleanup(); }
});

test('uncertain continuation acknowledgment preserves accepted obligation and blocks stale thought through reopen', async () => {
  let topicId: string | null = null; let calls = 0;
  const f = fixture(() => { calls++; return decision({ ...outcome('pending', { question: 'The retained inquiry.' }), topicId }); }, { send: async () => { if (f.sent.length === 2) throw new CommunicationsError('fixture', 'uncertain'); } });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const accepted = f.store.listConversationTopics()[0]!; topicId = accepted.id;
    await f.submit('continuation', 'New context for the same question.'); await f.runtime.runUntilIdle();
    assert.equal(f.store.conversationTopic(topicId)!.state, 'active'); assert.equal(f.store.conversationTopic(topicId)!.revision, 1); assert.equal(f.store.conversationTopic(topicId)!.report.owedRevision, 1);
    assert.equal(f.store.conversationAwaitingExchange(topicId), true); assert.equal(f.continuity.hasPendingReflection(), false);
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 2 }); await f.continuity.reflect('window', new AbortController().signal); assert.equal(calls, 2);
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); reopened.recoverInterrupted(); reopened.recoverConversationReflections();
    const continuation = new ConversationContinuity({ store: reopened, provider: f.p, now: () => 200, reviewMs: 10 });
    const runtime = new AgentRuntime({ store: reopened, provider: f.p, conversationContinuity: continuation, communications: [{ name: 'direct', send: async message => { f.sent.push(message.text); } }] });
    continuation.review(); await runtime.runUntilIdle();
    assert.equal(reopened.conversationTopic(topicId)!.report.owedRevision, null); assert.equal(reopened.conversationTopic(topicId)!.outcome.status, 'settled');
    assert.match(f.sent[2]!, /newer exchange still awaits delivery reconciliation/); assert.equal(calls, 2);
    assert.equal(reopened.conversationReflection(accepted.reflectionId!)!.state, 'cancelled');
    assert.equal(reopened.listTasks().find(task => task.eventId === 'continuation')!.state, 'waiting_for_provider'); await runtime.stop(); reopened.close();
  } finally { await f.cleanup(); }
});

for (const change of ['forget', 'correct'] as const) test(`source ${change} during successful send retains actual effect but excludes stale reply after reopen`, async () => {
  let release!: () => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; }); let calls = 0; const requests: CompletionRequest[] = [];
  const canary = 'WITHDRAWN_CANARY_123';
  const f = fixture(request => { calls++; requests.push(request); return calls === 2 ? { ...decision(outcome('settled')), reply: `I remember ${canary}.`, outcomes: [{ ...outcome('settled'), stance: `Interpretation ${canary}.` }] } : decision(outcome('settled')); },
    { send: async () => { if (f.sent.length === 2) { began(); await new Promise<void>(resolve => { release = resolve; }); } } });
  try {
    await f.submit('first', `Remember ${canary}.`); await f.runtime.runUntilIdle(); const episode = f.store.listMemories(f.scope).find(memory => memory.kind === 'episodic')!;
    const second = await f.submit('second', 'What follows from that experience?'); const pending = f.runtime.runUntilIdle(); await entered;
    if (change === 'forget') f.store.forgetMemory(episode.id, f.scope); else f.store.correctMemory(episode.id, f.scope, { content: 'The prior secret was withdrawn.', source: 'correction', confidence: 1 });
    release(); await pending; assert.equal(f.store.task(second.id)!.state, 'succeeded'); assert.match(String(f.store.task(second.id)!.output), new RegExp(canary));
    assert.equal((f.store.effect(`${second.id}:result`)!.result as { delivered: boolean }).delivered, true);
    assert.ok(!f.store.listMemories(f.scope).some(memory => memory.content.includes(canary)));
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); const p = provider(request => { requests.push(request); return { reply: 'Current context only.', outcomes: [outcome('settled')] }; });
    const runtime = new AgentRuntime({ store: reopened, provider: p, conversationContinuity: new ConversationContinuity({ store: reopened, provider: p }), communications: [{ name: 'direct', send: async () => {} }] });
    await runtime.submit({ id: 'later', source: 'direct', conversationId: f.scope, text: 'What do you retain now?' }); await runtime.runUntilIdle(); assert.ok(!requests.at(-1)!.prompt.includes(canary)); await runtime.stop(); reopened.close();
  } finally { release?.(); await f.cleanup(); }
});

test('explicit cancellation during continuation send prevents stale activation and preserves newer disposition', async () => {
  let topicId: string | null = null; let release!: () => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; });
  const f = fixture(() => decision({ ...outcome('pending', { question: 'Retained inquiry.' }), topicId }), { send: async () => { if (f.sent.length === 2) { began(); await new Promise<void>(resolve => { release = resolve; }); } } });
  try {
    const original = await f.submit(); await f.runtime.runUntilIdle(); topicId = f.store.listConversationTopics()[0]!.id;
    const task = await f.submit('continuation', 'Revisit it.'); const pending = f.runtime.runUntilIdle(); await entered;
    f.runtime.cancel(original.id); const cancelled = f.store.conversationTopic(topicId)!; assert.equal(cancelled.revision, 2); assert.equal(cancelled.outcome.status, 'settled');
    release(); await pending;
    assert.equal(f.store.conversationTopic(topicId)!.revision, 2); assert.equal(f.store.conversationTopic(topicId)!.outcome.rationale, cancelled.outcome.rationale);
    assert.equal(f.store.listConversationReflections().filter(item => ['waiting', 'running', 'paused'].includes(item.state)).length, 0);
    assert.equal(f.store.listConversationTopics().find(topic => topic.id.includes(`withdrawn:${task.id}`))!.report.owedRevision, 1);
    assert.ok(!f.store.listMemories(f.scope).some(memory => memory.source === `task:${task.id}` && memory.content.includes('A provisional stance')));
  } finally { release?.(); await f.cleanup(); }
});

test('authorized notification waiver persists independently of thought through reopen and later outcome revision', async () => {
  const f = fixture(request => request.system.startsWith('Reflect on') ? reflectionResult() : decision(outcome('pending', { question: 'A retained question.' })));
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!;
    await f.submit('waive', `waive ${topic.id}`); await f.runtime.runUntilIdle(); assert.equal(f.store.conversationTopic(topic.id)!.report.waived, true);
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); const continuity = new ConversationContinuity({ store: reopened, provider: f.p, now: () => 11 });
    reopened.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 }); await continuity.reflect('window', new AbortController().signal); continuity.review();
    assert.equal(reopened.conversationTopic(topic.id)!.revision, 2); assert.equal(reopened.conversationTopic(topic.id)!.report.owedRevision, null); assert.equal(reopened.conversationTopic(topic.id)!.report.waived, true);
    assert.equal(reopened.listEvents().filter(event => event.type === 'conversation.report.prepared').length, 0); reopened.close();
  } finally { await f.cleanup(); }
});

test('unauthorized Slack participant cannot waive another author topic and cross-scope controls disclose nothing', async () => {
  const f = fixture(() => decision(), { source: 'slack' });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!;
    const denied = await f.runtime.submit({ id: 'foreign-waiver', source: 'slack', conversationId: f.scope, replyTo: '123.456', slackAuthor: { teamId: 'T1', userId: 'U2' }, text: `waive ${topic.id}` });
    assert.match(String(f.store.task(denied.id)!.output), /Only the original Slack author/); assert.equal(f.store.conversationTopic(topic.id)!.report.owedRevision, 1);
  } finally { await f.cleanup(); }
});

test('legacy eligible envelope retains outcome and malformed decisions cannot supersede acknowledged topics', async () => {
  let topicId: string | null = null; let mode = 'legacy';
  const f = fixture(() => mode === 'legacy' ? { reply: 'A provisional independent choice.', disposition: 'converse', rationale: 'Existing strict decision contract.', proposal: null }
    : { ...decision({ ...outcome(), topicId }), disposition: 'invented' });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!; topicId = topic.id; mode = 'invalid';
    const failed = await f.submit('invalid'); await f.runtime.runUntilIdle(); assert.equal(f.store.task(failed.id)!.state, 'failed'); assert.equal(f.store.task(failed.id)!.error, 'provider_protocol');
    assert.equal(f.store.conversationTopic(topicId)!.revision, topic.revision); assert.equal(f.store.conversationTopic(topicId)!.state, 'active'); assert.equal(f.store.listGrowth().length, 0);
  } finally { await f.cleanup(); }
});

test('topic identifiers outside host-supplied provenance cannot be continued or confer authority', async () => {
  const f = fixture(() => decision({ ...outcome(), topicId: 'topic:unsupplied:0' }));
  try { const task = await f.submit(); await f.runtime.runUntilIdle(); assert.equal(f.store.task(task.id)!.error, 'provider_protocol'); assert.equal(f.store.listConversationTopics().length, 0); assert.equal(f.store.listGrowth().length, 0); assert.equal(f.sent.length, 0); }
  finally { await f.cleanup(); }
});

test('first-exchange cancellation during confirmed send still owes terminal report and never activates thought', async () => {
  let release!: () => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; });
  const f = fixture(() => decision(outcome('pending', { question: 'A selected inquiry.' })), { send: async () => { if (f.sent.length === 1) { began(); await new Promise<void>(resolve => { release = resolve; }); } } });
  try {
    const task = await f.submit(); const pending = f.runtime.runUntilIdle(); await entered; f.runtime.cancel(task.id); release(); await pending;
    assert.equal(f.store.task(task.id)!.state, 'cancelled'); assert.equal((f.store.effect(`${task.id}:result`)!.result as { delivered: boolean }).delivered, true);
    assert.equal(f.store.listConversationReflections()[0]!.state, 'cancelled'); assert.equal(f.store.listConversationTopics()[0]!.report.owedRevision, 1);
    await f.runtime.stop(); f.store.close(); const reopened = new Store(f.path); const continuity = new ConversationContinuity({ store: reopened, provider: f.p, now: () => 200 });
    const runtime = new AgentRuntime({ store: reopened, provider: f.p, conversationContinuity: continuity, communications: [{ name: 'direct', send: async message => { f.sent.push(message.text); } }] });
    continuity.review(); await runtime.runUntilIdle(); assert.match(f.sent[1]!, /Explicit cancellation/); assert.equal(reopened.listConversationTopics()[0]!.report.owedRevision, null); await runtime.stop(); reopened.close();
  } finally { release?.(); await f.cleanup(); }
});

test('explicit task correction invalidates older memory and late generated reply without losing physical delivery', async () => {
  let release!: () => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; }); let calls = 0; const requests: CompletionRequest[] = [];
  const f = fixture(request => { requests.push(request); calls++; return calls === 2 ? { ...decision(outcome('settled')), reply: 'Old CLAIM_CANARY_567 remains.' } : decision(outcome('settled')); },
    { send: async () => { if (f.sent.length === 2) { began(); await new Promise<void>(resolve => { release = resolve; }); } } });
  try {
    const original = await f.submit('first', 'CLAIM_CANARY_567 is my earlier statement.'); await f.runtime.runUntilIdle();
    const second = await f.submit('second', 'What follows?'); const pending = f.runtime.runUntilIdle(); await entered;
    await f.submit('correction', `correct ${original.id} The earlier statement is withdrawn.`); release(); await pending;
    assert.equal(f.store.taskSourceCurrent(original.id), false); assert.equal(f.store.task(second.id)!.state, 'succeeded'); assert.equal((f.store.effect(`${second.id}:result`)!.result as { delivered: boolean }).delivered, true);
    await f.submit('later', 'What is current?'); await f.runtime.runUntilIdle(); assert.ok(!requests.at(-1)!.prompt.includes('CLAIM_CANARY_567')); assert.ok(!f.store.listMemories(f.scope).some(memory => memory.content.includes('CLAIM_CANARY_567')));
  } finally { release?.(); await f.cleanup(); }
});

test('cancelled-before-dispatch report recovers after destination authority returns without replaying effects', async () => {
  const f = fixture(() => decision()); let allowed = true;
  const continuity = new ConversationContinuity({ store: f.store, provider: f.p, now: () => 11, reviewMs: 10, mayDeliver: () => allowed });
  const runtime = new AgentRuntime({ store: f.store, provider: f.p, conversationContinuity: continuity, communications: [{ name: 'direct', send: async message => { f.sent.push(message.text); } }] });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); continuity.review(); const before = f.store.listConversationTopics()[0]!; allowed = false; await runtime.runUntilIdle();
    assert.equal(f.store.task(before.report.taskId!)!.state, 'cancelled'); assert.equal(f.store.effect(before.report.effectId!), undefined); assert.equal(f.sent.length, 1);
    allowed = true; const resumed = new ConversationContinuity({ store: f.store, provider: f.p, now: () => 22, mayDeliver: () => allowed }); resumed.review(); await runtime.runUntilIdle();
    const after = f.store.listConversationTopics()[0]!; assert.notEqual(after.report.taskId, before.report.taskId); assert.equal(after.report.owedRevision, null); assert.equal(f.sent.length, 2);
  } finally { await runtime.stop(); await f.cleanup(); }
});

test('several topics in one thread enumerate their distinct owed reports independently of search ranking', async () => {
  const f = fixture(() => ({ ...decision(), outcomes: [outcome(), { ...outcome(), question: 'A separate curiosity question.', stance: 'No view selected.' }] }));
  try {
    await f.submit(); await f.runtime.runUntilIdle(); assert.equal(f.store.listConversationTopics(f.scope).filter(topic => topic.report.owedRevision !== null).length, 2);
    f.now(11); f.continuity.review(); await f.runtime.runUntilIdle(); assert.equal(f.sent.length, 3);
    assert.equal(f.store.listConversationTopics(f.scope).filter(topic => topic.report.owedRevision !== null).length, 0); assert.notEqual(f.store.listConversationTopics()[0]!.report.effectId, f.store.listConversationTopics()[1]!.report.effectId);
  } finally { await f.cleanup(); }
});

test('source correction during request construction rejects dispatch using stale context', async () => {
  let calls = 0; const f = fixture(() => { calls++; return decision(outcome('settled')); });
  let runtime: AgentRuntime | undefined;
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const source = f.store.listMemories(f.scope).find(memory => memory.kind === 'episodic')!;
    runtime = new AgentRuntime({ store: f.store, provider: f.p, conversationContinuity: f.continuity,
      requestFactory: (task, memories) => { f.store.correctMemory(source.id, f.scope, { content: 'Current correction.', source: 'correction', confidence: 1 }); return { system: 'fixture', prompt: JSON.stringify({ request: task.input, memories }), maxOutputTokens: 100 }; },
      conversationActions: new ConversationActions({ store: f.store, userIds: [], allowDirectOperator: true, sourceContext: () => 'fixture' }), communications: [{ name: 'direct', send: async () => {} }] });
    const task = await runtime.submit({ id: 'stale', source: 'direct', conversationId: f.scope, text: 'Continue.' }); await runtime.runUntilIdle(); assert.equal(calls, 1); assert.equal(f.store.task(task.id)!.error, 'provider_protocol');
  } finally { await runtime?.stop(); await f.cleanup(); }
});

test('withdrawn continuation has its own report identity after earlier holding report exists', async () => {
  let topicId: string | null = null; let release!: () => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; });
  const f = fixture(() => decision({ ...outcome('pending', { question: 'Retained question.' }), topicId }), { send: async () => { if (f.sent.length === 3) { began(); await new Promise<void>(resolve => { release = resolve; }); } } });
  try {
    const task = await f.submit(); await f.runtime.runUntilIdle(); topicId = f.store.listConversationTopics()[0]!.id; f.now(11); f.continuity.review(); await f.runtime.runUntilIdle();
    const oldReport = f.store.conversationTopic(topicId)!.report.taskId;
    const next = await f.submit('continuation'); const pending = f.runtime.runUntilIdle(); await entered; f.runtime.cancel(task.id); release(); await pending;
    const withdrawn = f.store.listConversationTopics().find(topic => topic.id.includes(`withdrawn:${next.id}`))!; assert.equal(withdrawn.report.taskId, null);
    f.now(30); f.continuity.review(); await f.runtime.runUntilIdle(); f.continuity.reconcileReports(); assert.notEqual(f.store.conversationTopic(withdrawn.id)!.report.taskId, oldReport); assert.equal(f.store.conversationTopic(withdrawn.id)!.report.owedRevision, null);
  } finally { release?.(); await f.cleanup(); }
});

test('a rejected tentative inquiry cannot starve the current inquiry after reopening', async () => {
  let topicId: string | null = null; let calls = 0;
  const f = fixture(request => { calls++; return request.system.startsWith('Reflect on') ? reflectionResult()
    : decision({ ...outcome('pending', { question: 'The current bounded inquiry.' }), topicId }); },
  { send: async () => { if (f.sent.length === 2) throw new CommunicationsError('fixture_uncertain', 'uncertain'); } });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); topicId = f.store.listConversationTopics()[0]!.id;
    const unconfirmed = await f.submit('unconfirmed'); await f.runtime.runUntilIdle();
    f.now(200); f.continuity.review(); await f.runtime.runUntilIdle();
    f.store.completeEffect(`${unconfirmed.id}:result`, { delivered: false, fixtureReconciliation: 'confirmed rejection' });
    f.store.updateTask(unconfirmed.id, { state: 'failed', error: 'fixture_reconciled_rejection' });
    f.continuity.review();
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 200, endsAt: 300, maxCalls: 2 });
    assert.equal(f.continuity.hasPendingReflection(), false); await f.continuity.reflect('window', new AbortController().signal);
    assert.equal(calls, 2); assert.equal(f.store.growthWindow('window')!.usedCalls, 0);
    await f.submit('reopened'); await f.runtime.runUntilIdle(); f.now(201);
    assert.equal(f.continuity.hasPendingReflection(), true); await f.continuity.reflect('window', new AbortController().signal);
    assert.equal(calls, 4, 'the current inquiry must dispatch despite the earlier rejected tentative inquiry');
    assert.equal(f.store.conversationReflection('reflection:' + topicId + ':2')!.state, 'cancelled');
    assert.equal(f.store.conversationReflection(f.store.conversationTopic(topicId)!.reflectionId!)!.state, 'completed');
    assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
  } finally { await f.cleanup(); }
});

test('explicit waiver survives a conflicting cancelled continuation acknowledgment', async () => {
  let topicId: string | null = null; let release!: () => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; });
  const f = fixture(() => decision({ ...outcome('pending', { question: 'Retained question.' }), topicId }),
    { send: async () => { if (f.sent.length === 2) { began(); await new Promise<void>(resolve => { release = resolve; }); } } });
  try {
    const task = await f.submit(); await f.runtime.runUntilIdle(); topicId = f.store.listConversationTopics()[0]!.id;
    await f.submit('continuation'); const pending = f.runtime.runUntilIdle(); await entered;
    f.store.waiveConversationReport(topicId, 'Explicit authorized stop-follow-up command.'); f.runtime.cancel(task.id); release(); await pending;
    f.now(30); f.continuity.review(); await f.runtime.runUntilIdle();
    assert.ok(f.store.listConversationTopics().every(topic => topic.report.waived && topic.report.owedRevision === null));
    assert.equal(f.sent.length, 2, 'the withdrawn continuation must respect the persisted notification waiver');
  } finally { release?.(); await f.cleanup(); }
});

for (const expiredAt of [100, 101]) test(`expired inquiry at ${expiredAt} cannot physically dispatch before the first host review`, async () => {
  let reflectionCalls = 0;
  const f = fixture(request => {
    if (request.system.startsWith('Reflect on')) { reflectionCalls++; return { ...reflectionResult(), stance: 'EXPIRED_RESULT_CANARY_731' }; }
    if (request.system.includes('growth') && !request.system.includes('Ordinary conversation continuity')) return { observation: 'Standing observation.', lesson: 'Cautious independent thought.', nextQuestion: 'A later finite question.', proposedChange: null };
    return decision(outcome('pending', { question: 'A finite retained inquiry.' }));
  });
  let scheduler: GrowthScheduler | undefined;
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const original = f.store.listConversationTopics()[0]!; f.now(expiredAt);
    scheduler = new GrowthScheduler({ store: f.store, provider: f.p, hasUserWork: () => false, conversationContinuity: f.continuity, now: () => expiredAt, windowMs: 1000, callsPerWindow: 2 });
    // Serving can start its growth timer before its first no-inference review.
    await scheduler.tick(); assert.equal(reflectionCalls, 0, 'expired thought must not physically reach the provider');
    assert.equal(f.continuity.hasPendingReflection(), false); assert.equal(f.store.listEvents().filter(event => event.type === 'conversation.reflection.call_reserved').length, 0);
    assert.equal(f.store.conversationTopic(original.id)!.revision, 1); assert.equal(f.store.conversationReflection(original.reflectionId!)!.attempts, 0);
    assert.equal(f.store.growthWindow('standing-growth-v1:0')!.usedCalls, 1, 'expired inquiry must not steal the standing growth opportunity');
    await f.continuity.reflect('standing-growth-v1:0', new AbortController().signal); assert.equal(reflectionCalls, 0);
    f.continuity.review(); await f.runtime.runUntilIdle(); assert.equal(f.store.conversationReflection(original.reflectionId!)!.state, 'cancelled');
    assert.match(f.sent[1]!, /finite review period ended/i); assert.equal(f.store.conversationTopic(original.id)!.report.owedRevision, null);
    assert.ok(f.store.listMemories(f.scope).every(memory => !memory.content.includes('EXPIRED_RESULT_CANARY_731')));
  } finally { await scheduler?.stop(); await f.cleanup(); }
});

test('atomic reflection reservation rejects the deadline and cannot debit a window', async () => {
  const f = fixture(() => decision(outcome('pending', { question: 'A bounded inquiry.' })));
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!;
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 200, maxCalls: 2 });
    assert.equal(f.store.claimConversationReflection(topic.reflectionId!, 'window', 100), undefined);
    assert.equal(f.store.growthWindow('window')!.usedCalls, 0); assert.equal(f.store.conversationReflection(topic.reflectionId!)!.attempts, 0);
  } finally { await f.cleanup(); }
});

test('atomic result publication refuses expiry while retaining an already spent reservation', async () => {
  const f = fixture(() => decision(outcome('pending', { question: 'A bounded inquiry.' })));
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!;
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 200, maxCalls: 2 });
    assert.ok(f.store.claimConversationReflection(topic.reflectionId!, 'window', 99));
    assert.throws(() => f.store.completeConversationReflection(topic.reflectionId!, topic.revision, { ...reflectionResult(), status: 'settled', stance: 'ATOMIC_EXPIRED_CANARY_216' }, 100, { provider: 'fixture' }));
    assert.equal(f.store.growthWindow('window')!.usedCalls, 1); assert.equal(f.store.conversationTopic(topic.id)!.revision, 1);
    assert.ok(f.store.listMemories(f.scope).every(memory => !memory.content.includes('ATOMIC_EXPIRED_CANARY_216')));
    f.now(100); f.continuity.review(); await f.runtime.runUntilIdle(); assert.equal(f.store.conversationReflection(topic.reflectionId!)!.state, 'cancelled'); assert.equal(f.store.conversationTopic(topic.id)!.report.owedRevision, null);
  } finally { await f.cleanup(); }
});

test('midflight expiry discards the late result and reports inconclusive after reopening without refund or replay', async () => {
  let release!: (result: unknown) => void; let began!: () => void; const entered = new Promise<void>(resolve => { began = resolve; }); let reflectionCalls = 0;
  const f = fixture(request => request.system.startsWith('Reflect on') ? new Promise(resolve => { reflectionCalls++; release = resolve; began(); }) : decision(outcome('pending', { question: 'An inquiry with a finite deadline.' })));
  let reopened: Store | undefined; let runtime: AgentRuntime | undefined;
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!;
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 1000, maxCalls: 2 }); f.now(99);
    const pending = f.continuity.reflect('window', new AbortController().signal); await entered; f.now(100);
    release({ ...reflectionResult(), stance: 'MIDFLIGHT_EXPIRED_CANARY_912' }); await pending;
    assert.equal(f.store.conversationTopic(topic.id)!.revision, 1); assert.equal(f.store.conversationReflection(topic.reflectionId!)!.state, 'cancelled');
    assert.equal(f.store.growthWindow('window')!.usedCalls, 1); assert.equal(reflectionCalls, 1); assert.equal(f.store.conversationTopic(topic.id)!.report.owedRevision, 1);
    await f.runtime.stop(); f.store.close(); reopened = new Store(f.path); reopened.recoverConversationReflections();
    const continuity = new ConversationContinuity({ store: reopened, provider: f.p, now: () => 101, reviewMs: 10 });
    runtime = new AgentRuntime({ store: reopened, provider: f.p, conversationContinuity: continuity, communications: [{ name: 'direct', send: async message => { assert.equal(message.conversationId, f.scope); f.sent.push(message.text); } }] });
    continuity.review(); await runtime.runUntilIdle(); assert.match(f.sent[1]!, /finite review period ended/i); assert.equal(reopened.conversationTopic(topic.id)!.report.owedRevision, null);
    await continuity.reflect('window', new AbortController().signal); continuity.review(); await runtime.runUntilIdle();
    assert.equal(f.sent.length, 2); assert.equal(reflectionCalls, 1); assert.equal(reopened.growthWindow('window')!.usedCalls, 1);
    assert.ok(reopened.listMemories(f.scope).every(memory => !memory.content.includes('MIDFLIGHT_EXPIRED_CANARY_912')));
  } finally { release?.(reflectionResult()); await runtime?.stop(); reopened?.close(); await f.cleanup(); }
});

test('expiry after admission and prompt preparation prevents physical dispatch without refunding its reservation', async () => {
  let reflectionCalls = 0;
  const f = fixture(request => { if (request.system.startsWith('Reflect on')) { reflectionCalls++; return reflectionResult(); } return decision(outcome('pending', { question: 'A finite inquiry.' })); });
  try {
    await f.submit(); await f.runtime.runUntilIdle(); const topic = f.store.listConversationTopics()[0]!;
    f.store.openGrowthWindow({ id: 'window', schedulerId: 'fixture', startsAt: 0, endsAt: 1000, maxCalls: 2 });
    // A finite host clock crosses the boundary after eligible selection, claim
    // and the early pre-dispatch check, while request preparation is finishing.
    let reads = 0; const continuity = new ConversationContinuity({ store: f.store, provider: f.p, reviewMs: 10, now: () => ++reads <= 3 ? topic.expiresAt - 1 : topic.expiresAt });
    await continuity.reflect('window', new AbortController().signal);
    assert.equal(reflectionCalls, 0); assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
    assert.equal(f.store.conversationReflection(topic.reflectionId!)!.state, 'cancelled'); assert.equal(f.store.conversationTopic(topic.id)!.report.owedRevision, 1);
    continuity.review(); await f.runtime.runUntilIdle(); assert.match(f.sent[1]!, /finite review period ended/i); assert.equal(f.store.conversationTopic(topic.id)!.report.owedRevision, null);
    await continuity.reflect('window', new AbortController().signal); assert.equal(reflectionCalls, 0); assert.equal(f.store.growthWindow('window')!.usedCalls, 1);
  } finally { await f.cleanup(); }
});
