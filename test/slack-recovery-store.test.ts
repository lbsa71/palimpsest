import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Store } from '../src/store.ts';
import type { Json, SlackRecoveryCheckpoint } from '../src/store.ts';

const route = 'slack:T1:C1:1700000000.000001';
const initial: SlackRecoveryCheckpoint = { conversationId: route, oldest: '1700000010.123456', bootstrap: 'canonical' };

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-slack-recovery-store-'));
  const path = join(directory, 'state.sqlite');
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, path };
}

function inbound(store: Store, conversationId = route, timestamp = initial.oldest) {
  const [, team, channel] = conversationId.split(':');
  return store.enqueue({ source: 'slack', conversationId,
    eventId: `slack-message:${team}:${channel}:${timestamp}`, input: 'PRIVATE_MESSAGE_TEXT',
    slackAuthor: { teamId: team!, userId: 'U1' } });
}

test('durable scan progress is independent of later live arrivals and survives reopening', t => {
  const { store, path } = fixture(t);
  const original = inbound(store);
  const pending: SlackRecoveryCheckpoint = { ...initial, oldest: '1700000020.000001',
    scanOldest: initial.oldest, latest: '1700000040.000001', cursor: 'PRIVATE_CURSOR==',
    lastAttemptAt: 1700000040000, lastCompletedAt: 1700000010000,
    retryAt: 1700000100000, error: 'ratelimited' };
  store.saveSlackRecoveryCheckpoint(pending);
  inbound(store, route, '1700000090.000001');
  assert.deepEqual(store.slackRecoveryCheckpoint(route), pending);
  assert.deepEqual(store.task(original.id), original);
  const events = store.listEvents({ typePrefix: 'slack.recovery.' });
  assert.equal(events.length, 1);
  assert.ok(!JSON.stringify(events).includes('PRIVATE_CURSOR'));
  assert.ok(!JSON.stringify(events).includes('PRIVATE_MESSAGE_TEXT'));
  store.close();
  const reopened = new Store(path);
  try {
    assert.deepEqual(reopened.slackRecoveryCheckpoint(route), pending);
    const copy = reopened.slackRecoveryCheckpoint(route)!;
    copy.oldest = '1700000999.000001';
    assert.equal(reopened.slackRecoveryCheckpoint(route)?.oldest, pending.oldest);
    const complete = { ...initial, oldest: pending.latest!, lastAttemptAt: 1700000100000, lastCompletedAt: 1700000100000 };
    reopened.saveSlackRecoveryCheckpoint(complete);
    assert.deepEqual(reopened.slackRecoveryCheckpoint(route), complete);
    assert.equal(reopened.listEvents({ typePrefix: 'slack.recovery.' }).length, 2);
  } finally { reopened.close(); }
});

test('canonical bootstrap starts at earliest accepted message, never at an older thread root', t => {
  const { store } = fixture(t);
  inbound(store, route, '1700000200.000001');
  inbound(store, route, '1700000100.000001');
  inbound(store, route, '1700000300.000001');
  assert.deepEqual(store.slackRecoveryThreads(), [
    { conversationId: route, oldest: '1700000100.000001', bootstrap: 'canonical' },
  ]);
  assert.equal(store.slackRecoveryCheckpoint(route), undefined, 'discovery must not invent committed scan progress');
});

test('bootstrap excludes synthetic reports, controls, non-Slack tasks and cross-route canonical identities', t => {
  const { store } = fixture(t);
  for (const eventId of ['origin:replacement', 'origin:proposal-refused', 'topic:report:1:final:0',
    'Evbad:replacement', 'slack-message:T2:C1:1700000010.123456',
    'slack-message:T1:C2:1700000010.123456', 'slack-message:T1:C1:1699999999.000001',
    'slack-message:T1:C1:1700000010.123456:report', 'Ev']) {
    store.enqueue({ source: 'slack', conversationId: route, eventId, input: 'synthetic or malformed' });
  }
  store.enqueue({ source: 'slack', conversationId: route, input: 'no inbound event identity' });
  store.enqueue({ source: 'direct', conversationId: 'slack:T1:C2:1700000000.000001', eventId: 'EvForeign', input: 'not Slack' });
  store.enqueue({ source: 'slack', conversationId: 'not-a-slack-route', eventId: 'EvMalformed', input: 'invalid route' });
  assert.equal(store.hasSlackThread(route), true, 'existing live-ingress participation semantics remain unchanged');
  assert.deepEqual(store.slackRecoveryThreads(), []);
  const actual = inbound(store);
  assert.deepEqual(store.slackRecoveryThreads(), [initial]);
  assert.deepEqual(store.task(actual.id), actual);
});

test('legacy bootstrap uses latest real legacy acceptance and preserves original records', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000050123 });
  const { store } = fixture(t);
  const first = store.enqueue({ source: 'slack', conversationId: route, eventId: 'EvFirst', input: 'first legacy' });
  t.mock.timers.tick(2000);
  const last = store.enqueue({ source: 'slack', conversationId: route, eventId: 'EvLast', input: 'last legacy' });
  t.mock.timers.tick(900000);
  store.enqueue({ source: 'slack', conversationId: route, eventId: `${last.id}:replacement`, input: 'later synthetic control' });
  assert.deepEqual(store.slackRecoveryThreads(), [
    { conversationId: route, oldest: '1700000052.123000', bootstrap: 'legacy' },
  ]);
  assert.deepEqual(store.task(first.id), first);
  assert.deepEqual(store.task(last.id), last);
});

test('mixed bootstrap conservatively retains the later floor and legacy coverage warning', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000050123 });
  const { store } = fixture(t);
  inbound(store, route, '1700000020.000001');
  store.enqueue({ source: 'slack', conversationId: route, eventId: 'EvMixed', input: 'legacy message' });
  inbound(store, route, '1700000300.000001');
  const second = 'slack:T1:C2:1700000000.000001';
  store.enqueue({ source: 'slack', conversationId: second, eventId: 'EvOther', input: 'legacy message' });
  inbound(store, second, '1700000200.000001');
  assert.deepEqual(store.slackRecoveryThreads(), [
    { conversationId: route, oldest: '1700000050.123000', bootstrap: 'legacy' },
    { conversationId: second, oldest: '1700000200.000001', bootstrap: 'legacy' },
  ]);
});

test('invalid checkpoint metadata cannot replace progress or append diagnostic payloads', t => {
  const { store } = fixture(t);
  inbound(store);
  store.saveSlackRecoveryCheckpoint(initial);
  const before = store.listEvents();
  const invalid: unknown[] = [null, [], { ...initial, privateText: 'secret' },
    { ...initial, conversationId: 'peer:T1:C1:1700000000.000001' },
    { ...initial, conversationId: 'slack:T1:C1:1700000000.000001:extra' },
    { ...initial, conversationId: 'slack:T1:C9:1700000000.000001' },
    { ...initial, oldest: 'not_a_timestamp' }, { ...initial, oldest: '1699999999.000001' },
    { ...initial, oldest: '1700000010.1234567' }, { ...initial, oldest: '1000000000000.0' },
    { ...initial, latest: '1700000005.000001' }, { ...initial, latest: null },
    { ...initial, scanOldest: '1700000030.000001' }, { ...initial, scanOldest: '1699999999.000001' },
    { ...initial, cursor: 'next' }, { ...initial, latest: '1700000020.0', cursor: 'next' },
    ...['', 'space separated', '\u0000', '\ud800', 'x'.repeat(2049)].map(cursor =>
      ({ ...initial, scanOldest: initial.oldest, latest: '1700000020.0', cursor })),
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1700000000000'].map(lastAttemptAt => ({ ...initial, lastAttemptAt })),
    { ...initial, lastCompletedAt: -1 }, { ...initial, retryAt: Infinity },
    { ...initial, error: 'PRIVATE provider diagnostic with credential' }, { ...initial, error: 'x'.repeat(65) },
    { ...initial, bootstrap: 'guessed' },
  ];
  for (const value of invalid) {
    assert.throws(() => store.saveSlackRecoveryCheckpoint(value as SlackRecoveryCheckpoint), /Slack recovery/);
    assert.deepEqual(store.slackRecoveryCheckpoint(route), initial);
    assert.deepEqual(store.listEvents(), before);
  }
});

test('checkpoint and journal roll back together on journal failure and enclosing page transaction failure', t => {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-slack-recovery-atomic-'));
  class JournalFailureStore extends Store {
    rejectRecovery = false;
    override appendEvent(type: string, payload: Json, taskId?: string) {
      if (this.rejectRecovery && type.startsWith('slack.recovery.')) throw new Error('injected journal failure');
      return super.appendEvent(type, payload, taskId);
    }
  }
  const store = new JournalFailureStore(join(directory, 'state.sqlite'));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  inbound(store);
  const before = store.listEvents();
  store.rejectRecovery = true;
  assert.throws(() => store.saveSlackRecoveryCheckpoint(initial), /injected journal failure/);
  assert.equal(store.slackRecoveryCheckpoint(route), undefined);
  assert.deepEqual(store.listEvents(), before);
  store.rejectRecovery = false;
  store.saveSlackRecoveryCheckpoint(initial);
  store.transaction(() => {
    store.rejectRecovery = true;
    assert.throws(() => store.saveSlackRecoveryCheckpoint({ ...initial, oldest: '1700000011.0' }), /injected journal failure/);
    store.rejectRecovery = false;
    store.appendEvent('outer.continued', {});
  });
  assert.deepEqual(store.slackRecoveryCheckpoint(route), initial, 'caught nested journal failure must not leave an unjournaled checkpoint');
  const committedEvents = store.listEvents();
  assert.throws(() => store.transaction(() => {
    inbound(store, route, '1700000020.000001');
    store.saveSlackRecoveryCheckpoint({ ...initial, oldest: '1700000020.000001' });
    throw new Error('page interrupted');
  }), /page interrupted/);
  assert.deepEqual(store.slackRecoveryCheckpoint(route), initial);
  assert.equal(store.hasSlackEvent('slack-message:T1:C1:1700000020.000001'), false);
  assert.deepEqual(store.listEvents(), committedEvents);
});

test('additive table creation on reopening preserves existing task, effect and memory bytes', t => {
  const { store, path } = fixture(t);
  const task = inbound(store);
  store.updateTask(task.id, { state: 'running' });
  store.reserveEffect({ id: 'unknown-delivery', taskId: task.id, kind: 'communication', payload: { text: 'already attempted' } });
  store.markEffectUnknown('unknown-delivery', 'retain uncertain outcome');
  store.addMemory({ scope: route, kind: 'episodic', content: 'retained history', source: 'task:' + task.id, confidence: 1 });
  store.close();
  const db = new DatabaseSync(path);
  const snapshot = () => Object.fromEntries(['tasks', 'effects', 'memories', 'journal'].map(table =>
    [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot();
  db.exec('DROP TABLE slack_recovery');
  const reopened = new Store(path);
  try {
    assert.equal(reopened.slackRecoveryCheckpoint(route), undefined);
    assert.deepEqual(reopened.slackRecoveryThreads(), [initial]);
    assert.deepEqual(snapshot(), before);
    assert.equal(reopened.effect('unknown-delivery')?.state, 'unknown');
  } finally { reopened.close(); db.close(); }
});
