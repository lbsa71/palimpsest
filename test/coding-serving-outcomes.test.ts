import { spokenTurn } from './fixtures/autark.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, type Json, type Task } from '../src/store.ts';
import { CodingAccounting, type CodingSession } from '../src/coding-accounting.ts';
import { CodingServing } from '../src/coding-serving.ts';
import { CodingSessionCoordinator } from '../src/coding-session.ts';
import type { CodingSessionPolicy } from '../src/coding-contracts.ts';
import type { CodingArtifacts, CodingSubmissionReceipt } from '../src/coding-artifacts.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { ConversationActions } from '../src/conversation-actions.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import type { OutboundMessage } from '../src/communications.ts';
import type { Provider } from '../src/providers.ts';

// These mechanical serving regressions use actual SQLite/Runtime/Continuity.
// Successful native admission and artifact receipts are deterministic boundaries;
// the separate serving witnesses exercise real workers and native tool execution.
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const decision = (topicId: string | null = null, question = 'Observed module behavior', code = true) => ({
  reply: 'The question is retained.', disposition: code ? 'code' : 'converse', rationale: 'Actual evidence is required.', proposal: null,
  ...(code ? { coding: { objective: 'Inspect module' } } : {}),
  outcomes: [{ question, stance: `Pending: ${question}`, rationale: 'The evidence remains unavailable.', unresolved: [`Resolve: ${question}`], status: 'pending', reflection: null, topicId }],
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'p17-serving-outcomes-')); chmodSync(directory, 0o700);
  const store = new Store(join(directory, 'state.sqlite')), clock = { now: 1 }, accounting = new CodingAccounting(store, { now: () => clock.now });
  const sent: OutboundMessage[] = []; let calls = 0, receipt: CodingSubmissionReceipt | undefined;
  const provider: Provider = { name: 'deterministic-foreground', async complete() {
    calls++; return { text: spokenTurn(decision()), provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const authorize = (task: Task) => store.taskSourceCurrent(task.id) && (task.source === 'direct' || task.slackAuthor?.userId === 'ALLOWED');
  const admit = (task: Task, objective: string) => accounting.admit({ version: 'coding-session/1', sessionId: `coding:${task.id}`,
    workRootId: task.id, attemptId: `${task.id}:attempt`, originTaskId: task.id, taskId: `${task.id}:execution`,
    lane: task.source === 'coding-origin' ? { kind: 'growth', schedulerId: 'fixture', windowMs: 1000, maxCalls: 4 }
      : { kind: 'conversation', taskId: task.id, maxCalls: 4 },
    limits: { maxWorkCalls: 4, maxSessionCalls: 4, maxAttemptCalls: 4, maxAttempts: 1, maxCommands: 1 }, expiresAt: 10_000,
    binding: { objective } }, { data: { objective, messages: [{ role: 'tool', text: 'PRIVATE_SOURCE_AND_OUTPUT_CANARY' }] } });
  let coordinator = { status: (id: string) => accounting.get(id) ?? accounting.get(`coding:${id}`),
    admitTask: async (task: Task, objective: string) => admit(task, objective), admitGrowth: async (task: Task, objective: string) => admit(task, objective),
    cancel: async () => {}, pause: async () => {}, adoptEpoch: async () => {}, resume: () => {}, tick: async () => false } as unknown as CodingSessionCoordinator;
  const artifacts = { submissionReceipt: () => receipt } as unknown as CodingArtifacts;
  const serving = new CodingServing({ store, coordinator: () => coordinator, artifacts: () => artifacts, available: () => true,
    authorizeOrigin: authorize, authorizeGrowth: growth => !growth.sourceTaskId && growth.origin === 'standing growth mission v1',
    growthAvailable: () => true, authorizeSubmission: task => { if (!store.taskSourceCurrent(task.id)) throw new Error('Source withdrawn'); }, now: () => clock.now });
  const continuity = new ConversationContinuity({ store, provider, now: () => clock.now, reviewMs: 10, lifetimeMs: 10_000 });
  continuity.bindCodingWork(serving);
  const actions = new ConversationActions({ store, userIds: ['ALLOWED'], allowDirectOperator: true, sourceContext: () => '' });
  const runtime = new AgentRuntime({ store, provider, conversationActions: actions, conversationContinuity: continuity, coding: serving,
    selfModificationUserIds: ['ALLOWED'], communications: ['direct', 'slack'].map(name => ({ name, async send(message: OutboundMessage) {
      sent.push(message); return { transport: 'fixture', messageId: `observed-${sent.length}` };
    } })) });
  const running = (id: string, source = 'direct') => {
    store.enqueue({ id, source, conversationId: source === 'slack' ? 'slack:TEAM:CHANNEL:THREAD' : 'ordinary', input: 'Inspect module',
      ...(source === 'slack' ? { slackAuthor: { teamId: 'TEAM', userId: 'ALLOWED' } } : {}) });
    return store.updateTask(id, { state: 'running', checkpoint: { calls: 1, replyTo: source === 'slack' ? 'THREAD' : null } });
  };
  const stage = (id: string, topicId: string | null = null, question = 'Observed module behavior', code = true) => {
    const task = running(id);
    // Use the real trusted preparation so continuations carry current revision
    // refs and the actual scoped provenance closure, rather than fabricated refs.
    continuity.prepare(task, store.listMemories(task.conversationId), { system: 'Fixture request.', prompt: task.input, maxOutputTokens: 1024 });
    const raw = continuity.accept(store.task(id)!, JSON.stringify(decision(topicId, question, code)), true);
    return { task: store.task(id)!, raw, topicId: object(store.listEvents({ taskId: id }).find(event => event.type === 'conversation.outcomes.prepared')!.payload).topicIds[0] as string };
  };
  const confirm = (id: string) => store.finishConversationTask(id, 'Observed acknowledgment', { scope: 'ordinary', kind: 'episodic', source: `task:${id}`,
    confidence: 1, content: JSON.stringify({ user: 'Inspect module', response: 'Observed acknowledgment' }) });
  const finish = (session: CodingSession) => {
    const terminal = accounting.update(session.id, { state: 'terminal', phase: 'submitted', data: json({ ...object(session.data), submission: receipt ? { submissionId: receipt.submissionId } : null }) }, { expectedRevision: session.revision });
    serving.onOutcome({ session: terminal, originTask: store.task(session.contract.originTaskId)!, summary: 'Actual retained coding result' }); serving.reconcile(); return terminal;
  };
  return { directory, store, clock, accounting, serving, continuity, runtime, artifacts, running, stage, confirm, finish, sent,
    calls: () => calls, coordinator: () => coordinator, setCoordinator: (value: CodingSessionCoordinator) => { coordinator = value; },
    setReceipt: (value: CodingSubmissionReceipt) => { receipt = value; },
    cleanup: async () => { await runtime.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function failedImportCoordinator(f: ReturnType<typeof fixture>, onImport: () => void) {
  const policy = (task: Task): CodingSessionPolicy => ({ lane: { kind: 'conversation', taskId: task.id, maxCalls: 4 },
    limits: { maxWorkCalls: 4, maxSessionCalls: 4, maxAttemptCalls: 4, maxAttempts: 1, maxCommands: 1 }, expiresAt: 10_000,
    providerProfile: { provider: 'fixture', model: 'fixture' }, catalogVersion: 'workspace-tools/1', providerLimits: {},
    maxTranscriptMessages: 64, maxTranscriptBytes: 20_000, commandTimeoutMs: 1000, maxCommandOutputBytes: 1000 });
  return new CodingSessionCoordinator({ store: f.store, accounting: f.accounting, workspaces: {} as never,
    artifacts: { async importSource() { onImport(); throw new Error('Deterministic source verification unavailable'); } } as never,
    epoch: () => 1, authorizeOrigin: () => true, authorizeSession: () => true, policy,
    providerFactory: () => { throw new Error('Physical request forbidden in this fixture'); }, acquireProviderSlot: async () => { throw new Error('Physical request forbidden'); }, now: () => f.clock.now });
}

test('source import failure delivers honest unavailable acknowledgment and owed disposition without an admitted session', async () => {
  const f = fixture(); let imports = 0;
  try {
    f.setCoordinator(failedImportCoordinator(f, () => imports++));
    await f.runtime.submit({ id: 'unavailable', source: 'direct', conversationId: 'ordinary', text: 'Inspect module' }); await f.runtime.runUntilIdle();
    const origin = f.store.listTasks().find(task => task.eventId === 'unavailable')!;
    assert.equal(origin.state, 'succeeded'); assert.equal(f.sent[0]!.text, 'The question is retained.'); assert.match(String(object(origin.checkpoint).actionOutcome), /Coding is unavailable/); assert.doesNotMatch(f.sent[0]!.text, /durably queued/);
    assert.equal(imports, 1); assert.equal(f.calls(), 1); assert.equal(f.accounting.list().length, 0); assert.equal(f.accounting.reservations().length, 0);
    assert.equal(f.store.listEvents({ taskId: origin.id }).filter(event => event.type === 'coding.report.owed').length, 1);
    assert.equal(f.store.listEvents({ taskId: origin.id }).filter(event => event.type === 'coding.serving.outcome').length, 1);
    f.serving.reconcile(); await f.runtime.runUntilIdle();
    assert.equal(f.sent.length, 2); assert.match(f.sent[1]!.text, /Coding is unavailable/);
    assert.equal(f.store.listConversationTopics()[0]!.report.owedRevision, null);
  } finally { await f.cleanup(); }
});

test('cold unavailable admission repairs the owed bridge once without retrying the source import', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'p17-admission-cut-')); chmodSync(directory, 0o700); const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  try {
    store.enqueue({ id: 'cut-origin', source: 'direct', conversationId: 'ordinary', input: 'Inspect module' }); store.updateTask('cut-origin', { state: 'running' });
    store.prepareConversationTopics('cut-origin', [{ outcome: { question: 'Module inquiry', stance: 'Pending', rationale: 'Await evidence', unresolved: ['Observe'], status: 'pending' } }], [], { now: 1, reviewMs: 10, lifetimeMs: 10_000, maxAttempts: 1 });
    // Durable cut after the real coordinator journal, before bridge callback.
    store.appendEvent('coding.admission.unavailable', { originTaskId: 'cut-origin', sessionId: 'coding:cut-origin', reason: 'source-or-authority-unavailable' }, 'cut-origin'); store.close(); store = new Store(path);
    let retried = 0; const serving = new CodingServing({ store, coordinator: () => ({ admitTask: async () => { retried++; throw new Error('Do not retry'); } } as never),
      artifacts: () => ({} as never), available: () => true, authorizeOrigin: () => true, authorizeSubmission: () => {} });
    const raw = JSON.stringify({ reply: 'Investigate', disposition: 'code', rationale: 'Actual evidence', proposal: null, coding: { objective: 'Inspect module' } });
    assert.match((await serving.accept(store.task('cut-origin')!, raw))!, /Coding is unavailable/);
    await serving.accept(store.task('cut-origin')!, raw);
    assert.equal(retried, 0); assert.equal(store.listEvents().filter(event => event.type === 'coding.report.owed').length, 1);
    assert.equal(store.listEvents().filter(event => event.type === 'coding.serving.outcome').length, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const disposition of ['waived', 'source-corrected'] as const) test(`current continuation ${disposition} suppresses stale coding reports`, async () => {
  const f = fixture();
  try {
    const first = f.stage('first', null, 'Old question', false); f.confirm('first');
    const staged = f.stage('continuation', first.topicId); await f.serving.accept(staged.task, staged.raw); f.confirm('continuation');
    if (disposition === 'waived') f.store.waiveConversationReport(first.topicId, 'Explicit originating waiver');
    else {
      const command = f.running('correction-command'), replacement = f.running('replacement');
      f.store.recordTaskCorrection('continuation', replacement.id, command.id);
    }
    f.finish(f.accounting.get('coding:continuation')!);
    const prepared = f.store.listEvents().find(event => event.type === 'coding.serving.report_prepared')!;
    assert.deepEqual(object(prepared.payload).reportTaskIds, []);
    assert.equal(f.store.listTasks().filter(task => object(task.checkpoint).answer !== undefined).length, 0);
  } finally { await f.cleanup(); }
});

test('an old coding result cannot overwrite the newer confirmed topic or clear its report obligation', async () => {
  const f = fixture();
  try {
    const first = f.stage('first', null, 'Old question', false); f.confirm('first');
    const coding = f.stage('coding-continuation', first.topicId); await f.serving.accept(coding.task, coding.raw); f.confirm(coding.task.id);
    const newer = f.stage('newer', first.topicId, 'A separate newer pending question', false); f.confirm(newer.task.id);
    const current = f.store.conversationTopic(first.topicId)!;
    f.finish(f.accounting.get('coding:coding-continuation')!);
    assert.deepEqual(f.store.conversationTopic(first.topicId), current);
    await f.runtime.runUntilIdle();
    assert.deepEqual(f.store.conversationTopic(first.topicId), current);
    assert.equal(f.sent.length, 1); assert.match(f.sent[0]!.text, /^Host notice:/); assert.doesNotMatch(f.sent[0]!.text, /Actual retained coding result/);
  } finally { await f.cleanup(); }
});

test('ready, running and budget-paused coding keep a current topic pending despite no reflection', async () => {
  const f = fixture();
  try {
    const first = f.stage('first', null, 'Old question', false); f.confirm('first');
    const coding = f.stage('coding-continuation', first.topicId); await f.serving.accept(coding.task, coding.raw); f.confirm(coding.task.id); f.clock.now = 100;
    for (const state of ['ready', 'running', 'paused'] as const) {
      const prior = f.accounting.get('coding:coding-continuation')!;
      if (prior.state !== state) f.accounting.update(prior.id, { state, phase: state === 'paused' ? 'budget-wait' : 'model-intended' }, { expectedRevision: prior.revision });
      assert.equal(f.serving.pendingTopic(first.topicId), true); f.continuity.review();
      const topic = f.store.conversationTopic(first.topicId)!; assert.equal(topic.outcome.status, 'pending'); assert.equal(topic.reflectionId, null);
      assert.equal(f.store.listEvents().filter(event => event.type === 'conversation.report.prepared').length, 0);
    }
    assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

test('another Slack author receives safe coding status without transcript, source or command output', async () => {
  const f = fixture();
  try {
    const origin = f.running('protected-origin', 'slack'); await f.coordinator().admitTask(origin, 'Inspect module'); f.store.updateTask(origin.id, { state: 'succeeded' });
    await f.runtime.submit({ id: 'foreign-status', source: 'slack', conversationId: origin.conversationId, slackAuthor: { teamId: 'TEAM', userId: 'OTHER' }, text: `status ${origin.id}`, replyTo: 'THREAD' }); await f.runtime.runUntilIdle();
    assert.equal(f.calls(), 0); assert.equal(f.sent.length, 1); assert.match(f.sent[0]!.text, /Coding session coding:protected-origin: ready/);
    assert.doesNotMatch(f.sent[0]!.text, /PRIVATE_SOURCE_AND_OUTPUT_CANARY|messages|binding|objective/);
    const session = f.accounting.get('coding:protected-origin')!;
    // The real coordinator also stores free-form native stop text as reason.
    // A safe projection must not expose that source-bearing result to outsiders.
    f.accounting.update(session.id, { state: 'terminal', phase: 'terminated', reason: 'PRIVATE_TERMINAL_SOURCE_CANARY' }, { expectedRevision: session.revision });
    await f.runtime.submit({ id: 'foreign-terminal-status', source: 'slack', conversationId: origin.conversationId,
      slackAuthor: { teamId: 'TEAM', userId: 'OTHER' }, text: `status ${origin.id}`, replyTo: 'THREAD' }); await f.runtime.runUntilIdle();
    assert.equal(f.calls(), 0); assert.equal(f.sent.length, 2); assert.match(f.sent[1]!.text, /terminal, terminated/);
    assert.doesNotMatch(f.sent[1]!.text, /PRIVATE_TERMINAL_SOURCE_CANARY|PRIVATE_SOURCE_AND_OUTPUT_CANARY|messages|binding|objective/);
  } finally { await f.cleanup(); }
});

test('independent growth cognitive submission creates one linked proposal and preserves completed inquiry', async () => {
  const f = fixture();
  try {
    const growth = f.store.addGrowth({ id: 'independent', dimension: 'code_quality', question: 'Inspect source', origin: 'standing growth mission v1', budget: 2 }); f.store.claimGrowth(growth.id);
    await f.serving.growth.accept(f.store.growth(growth.id)!, JSON.stringify({ observation: 'Source inquiry', lesson: 'Use actual evidence', nextQuestion: 'Inspect', proposedChange: null, coding: { objective: 'Inspect source' } }));
    const completed = f.store.growth(growth.id)!;
    f.setReceipt({ version: 'coding-submission/1', id: 'a'.repeat(64), submissionId: 'fixture-submission', artifactPath: '/nonexistent/fixture', sourceArtifactId: 'fixture-source', workspaceId: 'fixture-workspace',
      treeDigest: 'b'.repeat(64), fullTreeDigest: 'c'.repeat(64), originalBase: {} as never, currentBase: {} as never, disposition: 'cognitive_compatible', reason: 'Exact cognitive draft', changes: [],
      cognitiveBridge: { submissionDigest: 'a'.repeat(64), treeDigest: 'b'.repeat(64), base: {} as never, changes: [{ path: 'src/agent/brain.ts', content: 'export const retained = true;\n' }],
        sourceBinding: { version: 1, releaseDigest: 'd'.repeat(64), sourceDigest: 'e'.repeat(64), baseCommit: 'f'.repeat(40) } } });
    f.finish(f.accounting.get('coding:coding-growth:independent')!); f.serving.reconcile();
    assert.deepEqual(f.store.growth(growth.id), completed);
    const proposals = f.store.listGrowth().filter(item => item.id.startsWith('coding-submission:'));
    assert.equal(proposals.length, 1); assert.equal(proposals[0]!.sourceTaskId, undefined); assert.equal(proposals[0]!.origin, 'coding:independent');
    assert.deepEqual(object(object(proposals[0]!.outcome).result).proposedChange.files, [{ path: 'src/agent/brain.ts', content: 'export const retained = true;\n' }]);
    assert.equal(f.store.listEvents().filter(event => event.type === 'coding.submission.queued').length, 1);
  } finally { await f.cleanup(); }
});
