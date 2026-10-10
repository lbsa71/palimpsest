import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store, type Json } from '../src/store.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { ConversationActions } from '../src/conversation-actions.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import { CommunicationsError } from '../src/communications.ts';
import type { EvolutionQueueItem } from '../src/evolution-scheduler.ts';

const object = (value: unknown): Record<string, Json> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : {};
const proposal = { summary: 'PRIVATE_PROPOSAL_SUMMARY', rationale: 'PRIVATE_PROPOSAL_REASON', acceptanceCriteria: ['Observe behavior'], files: [{ path: 'src/agent/brain.ts', content: 'PRIVATE_SOURCE' }] };
const decision = { reply: 'Public intention.', disposition: 'propose', rationale: 'PRIVATE_DECISION_REASON', proposal };
const forbiddenProvider = { name: 'forbidden', async complete(): Promise<never> { throw new Error('No inference authorized for retained reports'); } };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'autark-release-')); const path = join(directory, 'state.sqlite');
  const store = new Store(path);
  const origin = store.enqueue({ id: 'origin', source: 'slack', conversationId: 'slack:T:C:ROOT', input: 'Consider a source improvement.', slackAuthor: { teamId: 'T', userId: 'AUTHOR' } });
  store.updateTask(origin.id, { state: 'running', checkpoint: { replyTo: 'ROOT' } });
  const actions = new ConversationActions({ store, userIds: ['AUTHOR'], sourceContext: () => '' });
  actions.accept(store.task(origin.id)!, JSON.stringify(decision));
  store.finishTask(origin.id, 'Public intention.', { scope: origin.conversationId, kind: 'episodic', source: `task:${origin.id}`, content: 'Recorded source exchange.', confidence: 1 });
  const item: EvolutionQueueItem = { id: 'release-run', growthId: 'conversation:origin', proposalDigest: 'a'.repeat(64), state: 'finished', result: { status: 'declined', reason: 'PRIVATE_EVALUATION_REASON', calls: 2 } };
  store.appendEvent('evolution.queue.enqueued', { id: item.id, growthId: item.growthId, proposalDigest: item.proposalDigest, state: 'queued' });
  store.appendEvent('evolution.queue.observed', { id: item.id, result: item.result! });
  const legacy = () => {
    const task = store.enqueuePreparedReply({ source: origin.source, conversationId: origin.conversationId, eventId: `${item.id}:release-result`, input: `Host-observed release result for ${origin.id}`, slackAuthor: origin.slackAuthor! }, 'PRIVATE_LEGACY_RELEASE_REPORT', 'ROOT');
    const { preparedSpeech: _speech, ...progress } = object(task.checkpoint); return store.updateTask(task.id, { checkpoint: progress });
  };
  const runtime = (options: { actions?: ConversationActions; send?: (task: { text: string; taskId: string }) => Promise<void>; authorize?: (boundary: string) => void } = {}) => new AgentRuntime({ store, provider: forbiddenProvider,
    ...(options.actions ? { conversationActions: options.actions } : {}), ...(options.authorize ? { authorize: options.authorize } : {}), communications: [{ name: 'slack', send: options.send ?? (async () => {}) }] });
  return { directory, path, store, origin: store.task(origin.id)!, item, actions, legacy, runtime,
    close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('release status exposes only an allowlisted outcome, never evaluator reasons or unknown status strings', () => {
  const f = fixture();
  try {
    assert.equal(f.actions.status(f.origin.id), ' Self-modification: declined.');
    f.store.appendEvent('evolution.queue.observed', { id: f.item.id, result: { status: 'PRIVATE_FAKE_STATUS', reason: 'PRIVATE_REASON' } });
    assert.doesNotMatch(f.actions.status(f.origin.id), /PRIVATE_/); assert.match(f.actions.status(f.origin.id), /unavailable/);
  } finally { f.close(); }
});

test('new release report is bound, public-only and excluded from human exchange memory', async () => {
  const f = fixture(); const sent: string[] = []; const runtime = f.runtime({ actions: f.actions, send: async message => { sent.push(message.text); } });
  try {
    await f.actions.reconcileResults([f.item]); const report = f.store.listTasks().find(task => task.eventId === `${f.item.id}:release-result`)!;
    assert.ok(f.store.listEvents({ taskId: report.id }).some(event => event.type === 'conversation.release_report.prepared'));
    await runtime.runUntilIdle(); assert.equal(f.store.task(report.id)?.state, 'succeeded'); assert.equal(sent.length, 1); assert.doesNotMatch(sent[0]!, /PRIVATE_/);
    assert.equal(f.store.listMemories(f.origin.conversationId).filter(memory => memory.source === `task:${report.id}`).length, 0);
  } finally { await runtime.stop(); f.close(); }
});

test('legacy queued release report is sanitized and delivered only through its original source route', async () => {
  const f = fixture(); const sent: string[] = []; const report = f.legacy(); const runtime = f.runtime({ actions: f.actions, send: async message => { sent.push(message.text); } });
  try {
    await runtime.runUntilIdle(); assert.equal(f.store.task(report.id)?.state, 'succeeded'); assert.equal(sent.length, 1); assert.match(sent[0]!, /^Host notice:/); assert.doesNotMatch(sent[0]!, /PRIVATE_/);
    assert.equal(f.store.listMemories(f.origin.conversationId).filter(memory => memory.source === `task:${report.id}`).length, 0);
  } finally { await runtime.stop(); f.close(); }
});

test('suggestive input and release-result suffix cannot authenticate a report without durable queue and growth provenance', () => {
  const f = fixture();
  try {
    const task = f.store.enqueuePreparedReply({ source: f.origin.source, conversationId: f.origin.conversationId,
      eventId: 'unknown-queue:release-result', input: `Host-observed release result for ${f.origin.id}`, slackAuthor: f.origin.slackAuthor! }, 'Original prepared text.', 'ROOT');
    assert.equal(f.actions.isReport(task), false);
    assert.deepEqual(f.actions.sanitizeReport(task), task);
  } finally { f.close(); }
});

for (const mode of ['legacy', 'new'] as const) test(`${mode} release report holds without its source/report receiver`, async () => {
  const f = fixture(); const sent: string[] = [];
  try {
    if (mode === 'legacy') f.legacy(); else await f.actions.reconcileResults([f.item]);
    const report = f.store.listTasks().find(task => task.eventId === `${f.item.id}:release-result`)!;
    const runtime = f.runtime({ send: async message => { sent.push(message.text); } });
    try { await runtime.runUntilIdle(); assert.equal(f.store.task(report.id)?.state, 'waiting_for_provider'); assert.equal(f.store.task(report.id)?.error, 'provider_configuration'); assert.deepEqual(sent, []); }
    finally { await runtime.stop(); }
  } finally { f.close(); }
});

for (const change of ['reply-target', 'text', 'policy', 'forget', 'correction', 'message-boundary'] as const) test(`prepared release report rechecks ${change} before sending`, async () => {
  const f = fixture(); const sent: string[] = [];
  await f.actions.reconcileResults([f.item]); const report = f.store.listTasks().find(task => task.eventId === `${f.item.id}:release-result`)!;
  const withdraw = () => { const memory = f.store.listMemories(f.origin.conversationId).find(memory => memory.source === `task:${f.origin.id}`)!; f.store.forgetMemory(memory.id, memory.scope); };
  const actions = change === 'policy' ? new ConversationActions({ store: f.store, userIds: [], sourceContext: () => '' }) : f.actions;
  const runtime = f.runtime({ actions, send: async message => { sent.push(message.text); }, authorize: boundary => { if (change === 'message-boundary' && boundary === 'message') withdraw(); } });
  try {
    if (change === 'reply-target') f.store.updateTask(report.id, { checkpoint: { ...object(report.checkpoint), replyTo: 'FOREIGN_THREAD' } });
    if (change === 'text') f.store.updateTask(report.id, { checkpoint: { ...object(report.checkpoint), answer: 'PRIVATE_REPLACEMENT_REPORT' } });
    if (change === 'forget') withdraw();
    if (change === 'correction') f.store.appendEvent('task.corrected', { originalId: f.origin.id, replacementId: 'replacement' });
    await runtime.runUntilIdle(); assert.deepEqual(sent, []); assert.equal(f.store.task(report.id)?.state, 'cancelled');
    if (change === 'message-boundary') assert.deepEqual(f.store.effect(`${report.id}:result`)?.result, { delivered: false, rejected: true, reason: 'report_context_changed' });
    else assert.equal(f.store.effect(`${report.id}:result`), undefined);
  } finally { await runtime.stop(); f.close(); }
});

for (const state of ['reserved', 'unknown', 'completed'] as const) test(`legacy release ${state} effects remain immutable and unreplayed through recovery`, async () => {
  const f = fixture(); const report = f.legacy(); const sent: string[] = []; const runtime = f.runtime({ actions: f.actions, send: async message => { sent.push(message.text); } });
  try {
    f.store.updateTask(report.id, { state: 'running' }); f.store.reserveEffect({ id: `${report.id}:result`, taskId: report.id, kind: 'communication', payload: { text: 'PRIVATE_LEGACY_RELEASE_REPORT', replyTo: 'ROOT' } });
    if (state === 'unknown') f.store.markEffectUnknown(`${report.id}:result`, 'Uncertain');
    if (state === 'completed') f.store.completeEffect(`${report.id}:result`, { delivered: true });
    f.store.recoverInterrupted(); const before = f.store.effect(`${report.id}:result`);
    await runtime.runUntilIdle(); assert.deepEqual(sent, []); assert.deepEqual(f.store.effect(`${report.id}:result`), before); assert.equal(object(f.store.task(report.id)!.checkpoint).answer, 'PRIVATE_LEGACY_RELEASE_REPORT');
    assert.equal(f.store.listMemories(f.origin.conversationId).filter(memory => memory.source === `task:${report.id}`).length, 0);
  } finally { await runtime.stop(); f.close(); }
});

for (const protocol of ['legacy', 'autark-turn/1'] as const) test(`saved ${protocol} proposal waits for a missing action receiver instead of silently dropping work`, async () => {
  const store = new Store(':memory:'); const sent: string[] = [];
  const task = store.enqueue({ source: 'direct', conversationId: 'ordinary', input: 'Please consider a source improvement.' });
  const { reply, ...fields } = decision;
  store.updateTask(task.id, { checkpoint: { calls: 1, interactive: true, decisionText: protocol === 'legacy' ? JSON.stringify(decision)
    : JSON.stringify({ version: protocol, actions: [{ name: 'say', arguments: { text: reply } }], ...fields }), ...(protocol === 'legacy' ? {} : { deliberationProtocol: protocol }) } });
  const runtime = new AgentRuntime({ store, provider: forbiddenProvider, communications: [{ name: 'direct', async send(message) { sent.push(message.text); } }] });
  try { await runtime.runUntilIdle(); assert.equal(store.task(task.id)?.state, 'waiting_for_provider'); assert.equal(store.task(task.id)?.error, 'provider_configuration'); assert.deepEqual(sent, []); assert.equal(store.listGrowth().length, 0); }
  finally { await runtime.stop(); store.close(); }
});

for (const refusal of ['author_policy', 'source_path', 'source_binding', 'silent'] as const) test(`a ${refusal} admission refusal receives one separate fixed host notice without exposing interpretation`, async () => {
  const store = new Store(':memory:'); const sent: { text: string; taskId: string; replyTo?: string }[] = []; let calls = 0;
  const speech = refusal === 'silent' ? null : 'I intend to evaluate this change.';
  const privateProposal = { ...proposal, files: [{ path: refusal === 'source_path' || refusal === 'silent' ? 'src/PRIVATE_GOVERNANCE.ts' : 'src/agent/brain.ts', content: 'PRIVATE_SOURCE' }] };
  const raw = JSON.stringify({ version: 'autark-turn/1', actions: speech === null ? [] : [{ name: 'say', arguments: { text: speech } }],
    disposition: 'propose', rationale: 'PRIVATE_ADMISSION_REASON', proposal: privateProposal, ...(refusal === 'silent' ? { outcomes: [{ topicId: null, question: 'PRIVATE_QUESTION', stance: 'PRIVATE_STANCE', rationale: 'PRIVATE_TOPIC_REASON', unresolved: ['PRIVATE_UNRESOLVED'], status: 'pending', reflection: { question: 'PRIVATE_REFLECTION' } }] } : {}) });
  const provider = { name: 'fixture', async complete() { calls++; return { text: raw, provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } };
  const actions = new ConversationActions({ store, userIds: refusal === 'author_policy' ? [] : ['AUTHOR'], sourceContext: () => '',
    ...(refusal === 'source_binding' ? { observeSource: () => { throw new Error('PRIVATE_BINDING_FAILURE'); } } : {}) });
  const continuity = refusal === 'silent' ? new ConversationContinuity({ store, provider, now: () => 0 }) : undefined;
  const runtime = new AgentRuntime({ store, provider, conversationActions: actions, ...(continuity ? { conversationContinuity: continuity } : {}),
    communications: [{ name: 'slack', async send(message) { sent.push(message); } }] });
  try {
    const task = store.enqueue({ id: 'refused-origin', source: 'slack', conversationId: 'slack:T:C:ROOT', input: 'Please evaluate a source change.', eventId: 'original-message', slackAuthor: { teamId: 'T', userId: 'AUTHOR' } });
    store.updateTask(task.id, { checkpoint: { replyTo: 'ROOT', ...(refusal === 'author_policy' ? { deliberationProtocol: 'autark-turn/1', interactive: true, decisionText: raw } : {}) } });
    await runtime.runUntilIdle();
    assert.equal(store.task(task.id)?.state, 'succeeded'); assert.equal(store.listGrowth().length, 0);
    assert.deepEqual(sent.map(message => message.text), [...(speech === null ? [] : [speech]), 'Host notice: The source proposal was not admitted. No source work was queued or changed.']);
    assert.ok(sent.every(message => message.replyTo === 'ROOT')); assert.doesNotMatch(JSON.stringify(sent), /PRIVATE_/);
    const report = store.listTasks().find(value => value.id !== task.id)!;
    assert.equal(store.listMemories(task.conversationId).filter(memory => memory.source === `task:${report.id}`).length, 0);
    assert.equal(JSON.parse(store.listMemories(task.conversationId).find(memory => memory.source === `task:${task.id}`)!.content).response, speech);
    if (continuity) { const topic = store.listConversationTopics(task.conversationId)[0]!; assert.equal(topic.report.owedRevision, topic.revision); assert.notEqual(topic.report.delivery, 'delivered'); }
    const effects = store.listEffects(report.id); const count = sent.length;
    // Replaying action admission after an interrupted acceptance cannot duplicate
    // its already delivered fixed notice or perform another provider request.
    const { actions: _actions, version: _version, outcomes: _outcomes, ...fields } = JSON.parse(raw);
    actions.accept(store.task(task.id)!, JSON.stringify({ reply: speech ?? '', ...fields }));
    await runtime.runUntilIdle(); assert.equal(sent.length, count); assert.equal(store.listTasks().length, 2); assert.deepEqual(store.listEffects(report.id), effects); assert.equal(calls, refusal === 'author_policy' ? 0 : 1);
  } finally { await runtime.stop(); store.close(); }
});

test('an already admitted proposal does not acquire a false no-work notice when current author policy refuses recovery', async () => {
  const store = new Store(':memory:'); const sent: string[] = [];
  const task = store.enqueue({ source: 'slack', conversationId: 'slack:T:C:ROOT', input: 'Please evaluate a source change.', slackAuthor: { teamId: 'T', userId: 'AUTHOR' } });
  store.updateTask(task.id, { state: 'running' });
  new ConversationActions({ store, userIds: ['AUTHOR'], sourceContext: () => '' }).accept(store.task(task.id)!, JSON.stringify(decision));
  const { reply, ...fields } = decision;
  store.updateTask(task.id, { state: 'queued', checkpoint: { replyTo: 'ROOT', deliberationProtocol: 'autark-turn/1', interactive: true,
    decisionText: JSON.stringify({ version: 'autark-turn/1', actions: [{ name: 'say', arguments: { text: reply } }], ...fields }) } });
  const actions = new ConversationActions({ store, userIds: [], sourceContext: () => '' });
  const runtime = new AgentRuntime({ store, provider: forbiddenProvider, conversationActions: actions, communications: [{ name: 'slack', async send(message) { sent.push(message.text); } }] });
  try { await runtime.runUntilIdle(); assert.deepEqual(sent, [reply]); assert.equal(store.listGrowth().length, 1); assert.equal(store.listTasks().length, 1); }
  finally { await runtime.stop(); store.close(); }
});

for (const failure of ['unknown', 'rejected'] as const) test(`fixed refusal remains deliverable when the original say is ${failure}, without replaying speech`, async () => {
  const store = new Store(':memory:'); const sent: string[] = []; let attempts = 0;
  const actions = new ConversationActions({ store, userIds: [], allowDirectOperator: true, sourceContext: () => '' });
  const task = store.enqueue({ source: 'direct', conversationId: 'ordinary', input: 'Consider changing the host.' });
  const { reply, ...fields } = decision;
  store.updateTask(task.id, { checkpoint: { deliberationProtocol: 'autark-turn/1', interactive: true, decisionText: JSON.stringify({
    version: 'autark-turn/1', actions: [{ name: 'say', arguments: { text: reply } }], ...fields, proposal: { ...proposal, files: [{ path: 'src/host.ts', content: 'PRIVATE_SOURCE' }] } }) } });
  const runtime = new AgentRuntime({ store, provider: forbiddenProvider, conversationActions: actions, communications: [{ name: 'direct', async send(message) {
    if (message.taskId === task.id) { attempts++; throw new CommunicationsError('Simulated delivery failure', failure === 'unknown' ? 'uncertain' : 'rejected'); }
    sent.push(message.text);
  } }] });
  try {
    await runtime.runUntilIdle(); assert.equal(attempts, 1);
    assert.deepEqual(sent, ['Host notice: The source proposal was not admitted. No source work was queued or changed.']);
    const effect = store.effect(`${task.id}:result`); assert.equal(effect?.state, failure === 'unknown' ? 'unknown' : 'completed');
    await runtime.runUntilIdle(); assert.equal(attempts, 1); assert.equal(sent.length, 1); assert.deepEqual(store.effect(`${task.id}:result`), effect);
    assert.equal(store.listMemories('ordinary').length, 0);
  } finally { await runtime.stop(); store.close(); }
});

for (const boundary of ['missing-receiver', 'route', 'forget', 'destination-policy'] as const) test(`prepared refusal notice preserves the ${boundary} delivery boundary`, async () => {
  const store = new Store(':memory:'); const sent: string[] = [];
  const actions = new ConversationActions({ store, userIds: ['AUTHOR'], sourceContext: () => '',
    ...(boundary === 'destination-policy' ? { authorizeReport: () => false } : {}) });
  const task = store.enqueue({ source: 'slack', conversationId: 'slack:T:C:ROOT', input: 'Consider a source change.', slackAuthor: { teamId: 'T', userId: 'AUTHOR' } });
  const rejected = { ...decision, proposal: { ...proposal, files: [{ path: 'src/host.ts', content: 'PRIVATE_SOURCE' }] } };
  const { reply, ...fields } = rejected;
  store.updateTask(task.id, { state: 'running', checkpoint: { replyTo: 'ROOT', deliberationProtocol: 'autark-turn/1', decisionText: JSON.stringify({
    version: 'autark-turn/1', actions: [{ name: 'say', arguments: { text: reply } }], ...fields }) } });
  actions.accept(store.task(task.id)!, JSON.stringify(rejected));
  store.finishTask(task.id, reply, { scope: task.conversationId, kind: 'episodic', source: `task:${task.id}`, content: 'Recorded source exchange.', confidence: 1 });
  const report = store.listTasks().find(value => value.id !== task.id)!;
  if (boundary === 'route') store.updateTask(report.id, { checkpoint: { ...object(report.checkpoint), replyTo: 'FOREIGN_THREAD' } });
  if (boundary === 'forget') { const memory = store.listMemories(task.conversationId)[0]!; store.forgetMemory(memory.id, memory.scope); }
  const runtime = new AgentRuntime({ store, provider: forbiddenProvider, ...(boundary === 'missing-receiver' ? {} : { conversationActions: actions }),
    communications: [{ name: 'slack', async send(message) { sent.push(message.text); } }] });
  try { await runtime.runUntilIdle(); assert.deepEqual(sent, []); assert.equal(store.task(report.id)?.state, boundary === 'missing-receiver' ? 'waiting_for_provider' : 'cancelled'); assert.equal(store.effect(`${report.id}:result`), undefined); }
  finally { await runtime.stop(); store.close(); }
});
