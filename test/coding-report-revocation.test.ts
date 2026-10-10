import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, type Json } from '../src/store.ts';
import { CodingAccounting } from '../src/coding-accounting.ts';
import { CodingServing } from '../src/coding-serving.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import { CommunicationsError, type OutboundMessage } from '../src/communications.ts';
import type { Provider } from '../src/providers.ts';

// Actual file-backed Store/Runtime/Continuity/effects. Session execution and the
// artifact boundary are deterministic; no SDK, worker, model or network runs.
const object = (value: Json): Record<string, Json> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const pending = { question: 'Inspect module', stance: 'Pending observation', rationale: 'Await execution', unresolved: ['Observe module'], status: 'pending' as const };
function fixture(source: 'direct' | 'slack' = 'direct', withContinuity = true) {
  const directory = mkdtempSync(join(tmpdir(), 'coding-report-revocation-')); chmodSync(directory, 0o700);
  const path = join(directory, 'state.sqlite'); let store = new Store(path);
  let serving: CodingServing, runtime: AgentRuntime;
  const sent: OutboundMessage[] = [], policy = { execution: true, report: true, available: true };
  let messageBoundary = () => {}, sendFailure: 'unknown' | 'rejected' | undefined;
  const provider: Provider = { name: 'forbidden-inference', async complete() { throw new Error('Prepared reports must not infer'); } };
  const route = source === 'slack' ? 'slack:TEAM:CHANNEL:THREAD' : 'ordinary';
  const open = () => {
    serving = new CodingServing({ store, coordinator: () => ({ pause: async () => {}, cancel: async () => {}, status: () => undefined } as never),
      artifacts: () => ({} as never), available: () => policy.available,
      authorizeOrigin: task => policy.execution && store.taskSourceCurrent(task.id),
      // This option is the independently configured conversation delivery policy,
      // not the self-modification whitelist. It cannot change the sealed route.
      authorizeReport: () => policy.report, authorizeSubmission: () => {}, now: () => 1 });
    const continuity = new ConversationContinuity({ store, provider });
    runtime = new AgentRuntime({ store, provider, coding: serving, ...(withContinuity ? { conversationContinuity: continuity } : {}),
      authorize: boundary => { if (boundary === 'message') messageBoundary(); },
      communications: [{ name: source, async send(message) {
        sent.push(message);
        if (sendFailure === 'unknown') throw new CommunicationsError('fixture_uncertain', 'uncertain');
        if (sendFailure === 'rejected') throw new CommunicationsError('fixture_rejected', 'rejected');
        return { transport: source, messageId: '1700000000.000123' };
      } }] });
  };
  open();
  const running = (id: string) => {
    store.enqueue({ id, source, conversationId: route, input: 'Inspect module',
      ...(source === 'slack' ? { slackAuthor: { teamId: 'TEAM', userId: 'ALLOWED' } } : {}) });
    return store.updateTask(id, { state: 'running', checkpoint: { calls: 1, replyTo: source === 'slack' ? 'THREAD' : null } });
  };
  const confirm = (id: string) => store.finishConversationTask(id, 'Observed acknowledgment', { scope: route, kind: 'episodic', source: `task:${id}`,
    confidence: 1, content: JSON.stringify({ user: 'Inspect module', response: 'Observed acknowledgment' }) });
  const prepare = (kind: 'fallback' | 'progressed' | 'topic' = 'fallback') => {
    running('origin');
    const options = { now: 1, reviewMs: 100, lifetimeMs: 10000, maxAttempts: 1 };
    let topicId: string | undefined;
    if (kind !== 'fallback') topicId = store.prepareConversationTopics('origin', [{ outcome: pending }], [], options)[0]!.id;
    confirm('origin');
    const accounting = new CodingAccounting(store, { now: () => 1 });
    const session = accounting.admit({ version: 'coding-session/1', sessionId: 'session', workRootId: 'origin', attemptId: 'attempt', originTaskId: 'origin', taskId: 'execution',
      lane: { kind: 'plan', cadence: 'hourly', maxCalls: 1 }, limits: { maxWorkCalls: 1, maxSessionCalls: 1, maxAttemptCalls: 1, maxAttempts: 1, maxCommands: 1 }, expiresAt: 10000, binding: null });
    const terminal = accounting.update(session.id, { state: 'terminal', phase: 'terminated' }, { expectedRevision: session.revision });
    serving.onOutcome({ session: terminal, originTask: store.task('origin')!, summary: 'SOURCE_BEARING_RESULT_CANARY' });
    if (kind === 'progressed') {
      running('newer'); const topic = store.conversationTopic(topicId!)!;
      store.prepareConversationTopics('newer', [{ topicId, expectedRevision: topic.revision, outcome: { ...pending, question: 'Newer question' } }], topic.sourceRefs, options);
      confirm('newer');
    }
    serving.reconcile();
    const report = store.listTasks().find(task => typeof object(task.checkpoint).answer === 'string')!;
    assert.ok(report, 'A report must really have been queued before revocation');
    return { report, topicId };
  };
  const withdraw = () => {
    running('replacement'); running('correction'); store.recordTaskCorrection('origin', 'replacement', 'correction');
    store.updateTask('replacement', { state: 'cancelled' }); store.updateTask('correction', { state: 'cancelled' });
  };
  return { prepare, withdraw, sent, policy, store: () => store, serving: () => serving, runtime: () => runtime,
    atMessage: (operation: () => void) => { messageBoundary = operation; }, failure: (value: typeof sendFailure) => { sendFailure = value; },
    reopen: async () => { await runtime.stop(); store.close(); store = new Store(path); open(); },
    cleanup: async () => { await runtime.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

for (const reopened of [false, true]) test(`prepared fallback source correction prevents delivery${reopened ? ' after SQLite reopen' : ''}`, async () => {
  const f = fixture();
  try {
    const { report } = f.prepare(); f.withdraw(); if (reopened) await f.reopen();
    await f.runtime().runUntilIdle();
    assert.equal(f.sent.length, 0); assert.equal(f.store().task(report.id)!.state, 'cancelled');
    assert.equal(f.store().effect(`${report.id}:result`), undefined);
    f.serving().reconcile(); await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 0);
  } finally { await f.cleanup(); }
});

for (const change of ['waiver', 'revision', 'forgetting', 'policy', 'reply-target'] as const) test(`prepared progressed-topic fallback respects later ${change}`, async () => {
  const f = fixture('slack');
  try {
    const { report, topicId } = f.prepare('progressed');
    if (change === 'waiver') f.store().waiveConversationReport(topicId!, 'Explicit notification waiver');
    if (change === 'revision') {
      const topic = f.store().conversationTopic(topicId!)!; f.store().reviseConversationOutcome(topicId!, { ...topic.outcome, question: 'Later current question' }, 2, 'newer_question');
    }
    if (change === 'forgetting') {
      const memory = f.store().listMemories(report.conversationId).find(memory => memory.source === 'task:origin')!; f.store().forgetMemory(memory.id, memory.scope);
    }
    if (change === 'policy') f.policy.execution = false;
    if (change === 'reply-target') f.store().updateTask(report.id, { checkpoint: { ...object(report.checkpoint), replyTo: 'FOREIGN_THREAD' } });
    await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 0); assert.equal(f.store().task(report.id)!.state, 'cancelled');
  } finally { await f.cleanup(); }
});

for (const kind of ['fallback', 'topic'] as const) test(`message authorization withdrawal stops prepared ${kind} before the adapter`, async () => {
  const f = fixture();
  try {
    const { report } = f.prepare(kind); f.atMessage(f.withdraw); await f.runtime().runUntilIdle();
    assert.equal(f.sent.length, 0); assert.equal(f.store().task(report.id)!.state, 'cancelled');
    assert.deepEqual(f.store().effect(`${report.id}:result`)!.result, { delivered: false, rejected: true, reason: 'report_context_changed' });
  } finally { await f.cleanup(); }
});

for (const continuity of [false, true]) test(`unchanged fallback delivers once without a human episode${continuity ? ' with continuity' : ''}`, async () => {
  const f = fixture('slack', continuity);
  try {
    const { report } = f.prepare(); f.policy.available = false; await f.reopen(); await f.runtime().runUntilIdle();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0]!.replyTo, 'THREAD'); assert.match(f.sent[0]!.text, /^Host notice:/); assert.doesNotMatch(f.sent[0]!.text, /SOURCE_BEARING_RESULT_CANARY/);
    assert.equal(f.store().task(report.id)!.state, 'succeeded');
    assert.deepEqual(f.store().effect(`${report.id}:result`)!.result, { delivered: true, receipt: { transport: 'slack', messageId: '1700000000.000123' } });
    assert.equal(f.store().listMemories(report.conversationId).filter(memory => memory.source === `task:${report.id}`).length, 0);
    f.serving().reconcile(); await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 1);
  } finally { await f.cleanup(); }
});

test('already revoked execution prepares only a fixed host disposition under separate reporting permission', async () => {
  const f = fixture('slack');
  try {
    f.policy.execution = false; const { report } = f.prepare(); await f.runtime().runUntilIdle();
    assert.equal(f.sent.length, 1); assert.doesNotMatch(f.sent[0]!.text, /SOURCE_BEARING_RESULT_CANARY/);
    assert.match(f.sent[0]!.text, /Execution authority is unavailable/); assert.equal(f.store().task(report.id)!.state, 'succeeded');
  } finally { await f.cleanup(); }
});

test('separate conversation reporting policy can deny a generic sealed report', async () => {
  const f = fixture();
  try {
    f.policy.execution = false; const { report } = f.prepare(); f.policy.report = false;
    await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 0); assert.equal(f.store().task(report.id)!.state, 'cancelled');
  } finally { await f.cleanup(); }
});

test('changing prepared generic text cannot reuse its source-free delivery permission', async () => {
  const f = fixture('slack');
  try {
    f.policy.execution = false; const { report } = f.prepare();
    f.store().updateTask(report.id, { checkpoint: { ...object(report.checkpoint), answer: 'SOURCE_BEARING_RESULT_CANARY' } });
    await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 0); assert.equal(f.store().task(report.id)!.state, 'cancelled');
  } finally { await f.cleanup(); }
});

test('source authority revoked during message authorization prevents source-bearing delivery', async () => {
  const f = fixture('slack');
  try {
    const { report } = f.prepare(); f.atMessage(() => { f.policy.execution = false; });
    await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 0); assert.equal(f.store().task(report.id)!.state, 'cancelled');
    assert.deepEqual(f.store().effect(`${report.id}:result`)!.result, { delivered: false, rejected: true, reason: 'report_context_changed' });
  } finally { await f.cleanup(); }
});

for (const failure of ['unknown', 'rejected'] as const) test(`${failure} report delivery remains unreplayed after reopen`, async () => {
  const f = fixture();
  try {
    const { report } = f.prepare(); f.failure(failure); await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 1);
    const originalEffect = f.store().effect(`${report.id}:result`)!; assert.equal(originalEffect.state, failure === 'unknown' ? 'unknown' : 'completed');
    await f.reopen(); f.serving().reconcile(); await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 1);
    if (failure === 'unknown') {
      assert.throws(() => f.runtime().retry(report.id), /effect reconciliation/);
      await f.runtime().runUntilIdle(); assert.equal(f.sent.length, 1);
    }
    assert.deepEqual(f.store().effect(`${report.id}:result`), originalEffect);
  } finally { await f.cleanup(); }
});
