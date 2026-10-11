import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/store.ts';
import { SlackHistoryClient } from '../src/slack-history.ts';
import { SlackRecovery } from '../src/slack-recovery.ts';
import type { InboundMessage } from '../src/communications.ts';

const route = 'slack:T1:C1:100.000000';
const human = (ts: string, extra = {}) => ({ type: 'message', user: 'U1', ts, thread_ts: '100.000000', text: `message ${ts}`, ...extra });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'slack-recovery-'));
  const path = join(directory, 'state.sqlite'); let store = new Store(path);
  const enqueue = (input: InboundMessage) => store.enqueue({ source: input.source, eventId: input.id, conversationId: input.conversationId, input: input.text, slackAuthor: input.slackAuthor });
  const accept = (ts: string) => enqueue({ id: `slack-message:T1:C1:${ts}`, conversationId: route, source: 'slack', text: `message ${ts}`, slackAuthor: { teamId: 'T1', userId: 'U1' } });
  accept('100.000000');
  let now = 200_000;
  const requests: URLSearchParams[] = [];
  const pages: (Record<string, unknown> | Response | Error)[] = [];
  const client = new SlackHistoryClient({ token: 'xoxb-synthetic', fetch: async (url, init) => {
    if (String(url).endsWith('auth.test')) return Response.json({ ok: true, team_id: 'T1', user_id: 'UBOT', bot_id: 'B1' });
    requests.push(new URL(String(url)).searchParams);
    const page = pages.shift(); if (page instanceof Error) throw page;
    if (page instanceof Response) return page;
    assert.ok(page, 'unexpected history request'); return Response.json({ ok: true, ...page });
  } });
  const recovery = (overrides: Partial<ConstructorParameters<typeof SlackRecovery>[0]> = {}) => new SlackRecovery({
    store, client, submit: async input => enqueue(input), allowedTeamIds: ['T1'], now: () => now,
    maxPagesPerPass: 1, ...overrides,
  });
  return { get store() { return store; }, requests, pages, recovery, accept, enqueue,
    advance(ms: number) { now += ms; }, reopen() { store.close(); store = new Store(path); },
    close() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('restart history catches the offline gap despite a newer live arrival, with canonical dedup and original authors', async () => {
  const f = fixture(); try {
    f.accept('190.000000'); f.reopen();
    f.pages.push({ messages: [human('100.000000'), human('150.000000'), human('190.000000', { text: 'edited after acceptance' })], has_more: false });
    const recovery = f.recovery(); await recovery.tick();
    assert.equal(f.store.listTasks().length, 3);
    assert.deepEqual(f.store.listTasks().at(-1)!.slackAuthor, { teamId: 'T1', userId: 'U1' });
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '198.000000');
    assert.equal(f.requests[0]!.get('oldest'), '100.000000');
    f.advance(60_000); f.pages.push({ messages: [human('150.000000'), human('190.000000')], has_more: false });
    await recovery.tick(); assert.equal(f.store.listTasks().length, 3);
    await recovery.close();
  } finally { f.close(); }
});

test('paginated recovery persists exact cursor bounds and resumes after restart and invalid cursor', async () => {
  const f = fixture(); try {
    f.pages.push({ messages: [human('110.000000')], has_more: true, response_metadata: { next_cursor: 'page2' } });
    await f.recovery().tick(); f.reopen();
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '110.000000');
    f.pages.push({ ok: false, error: 'invalid_cursor' }); await f.recovery().tick();
    assert.equal(f.requests[1]!.get('oldest'), '100.000000');
    assert.equal(f.requests[1]!.get('latest'), '198.000000');
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.cursor, undefined);
    f.advance(60_000); f.pages.push({ messages: [human('120.000000')], has_more: false });
    await f.recovery().tick();
    assert.equal(f.requests[2]!.get('oldest'), '110.000000');
    assert.equal(f.requests[2]!.get('latest'), '198.000000');
    assert.equal(f.store.listTasks().length, 3);
  } finally { f.close(); }
});

test('uncertain durable acceptance retries without duplicate work or advancing across the unfinished page', async () => {
  const f = fixture(); try {
    f.pages.push({ messages: [human('110.000000'), human('120.000000')], has_more: false });
    const first = f.recovery({ submit: async input => { f.enqueue(input); throw new Error('private callback detail'); } });
    await first.tick();
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '100.000000');
    assert.equal(f.store.listTasks().length, 2);
    assert.doesNotMatch(JSON.stringify(first.status()), /private callback detail/);
    f.advance(60_000); f.pages.push({ messages: [human('110.000000'), human('120.000000')], has_more: false });
    await f.recovery().tick(); assert.equal(f.store.listTasks().length, 3);
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '198.000000');
  } finally { f.close(); }
});

test('rate limits persist across restart and prevent rotating threads around Retry-After', async () => {
  const f = fixture(); try {
    f.store.enqueue({ source: 'slack', eventId: 'slack-message:T1:C2:100.000000', conversationId: 'slack:T1:C2:100.000000', input: 'hello' });
    f.pages.push(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    await f.recovery({ maxPagesPerPass: 10 }).tick(); assert.equal(f.requests.length, 1);
    f.reopen(); await f.recovery({ maxPagesPerPass: 10 }).tick(); assert.equal(f.requests.length, 1);
    f.advance(120_000);
    f.pages.push({ messages: [], has_more: false }); await f.recovery().tick();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1]!.get('channel'), 'C2', 'an unattempted thread gets its turn');
  } finally { f.close(); }
});

test('scope, bot/subtype filters and exact thread validation hold during recovery', async () => {
  const f = fixture(); try {
    const denied = f.recovery({ allowedChannelIds: [] }); await denied.tick(); assert.equal(f.requests.length, 0);
    f.pages.push({ messages: [human('110.000000', { bot_id: 'B1' }), human('120.000000', { subtype: 'message_changed' }), human('130.000000', { thread_ts: '999.000000' })], has_more: false });
    await f.recovery().tick(); assert.equal(f.store.listTasks().length, 1);
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '100.000000', 'validate entire page before admitting any row');
    f.advance(60_000); f.pages.push({ messages: [human('110.000000', { bot_id: 'B1' }), human('120.000000', { subtype: 'file_share' }), human('130.000000')], has_more: false });
    await f.recovery().tick(); assert.equal(f.store.listTasks().length, 2);
  } finally { f.close(); }
});

test('out of order or future pages leave the gap open', async () => {
  for (const messages of [[human('120.000000'), human('110.000000')], [human('210.000000')]]) {
    const f = fixture(); try {
      f.pages.push({ messages, has_more: false }); await f.recovery().tick();
      assert.equal(f.store.listTasks().length, 1); assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '100.000000');
    } finally { f.close(); }
  }
});

test('malformed plain history records cannot silently close an unread gap', async () => {
  for (const extra of [{ user: undefined }, { user: 'malformed user' }, { type: undefined }, { type: 'unexpected' }, { text: undefined }]) {
    const f = fixture(); try {
      f.pages.push({ messages: [human('110.000000'), human('150.000000', extra)], has_more: false });
      await f.recovery().tick();
      assert.equal(f.store.listTasks().length, 1, 'entire page must validate before admitting its first message');
      assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '100.000000');
      assert.equal(f.store.slackRecoveryCheckpoint(route)!.error, 'protocol');
    } finally { f.close(); }
  }
});

test('authentication Retry-After survives restart and reconnect requests', async () => {
  const f = fixture(); let calls = 0;
  const client = new SlackHistoryClient({ token: 'xoxb-synthetic', fetch: async () => {
    calls++; return new Response('', { status: 429, headers: { 'retry-after': '3600' } });
  } });
  try {
    const first = f.recovery({ client }); await first.tick(); await first.tick(); assert.equal(calls, 1);
    f.reopen(); await f.recovery({ client }).tick(); assert.equal(calls, 1);
    f.advance(3_600_000); await f.recovery({ client }).tick(); assert.equal(calls, 2);
  } finally { f.close(); }
});

test('closing during durable acceptance does not advance recovery progress', async () => {
  const f = fixture(); let finish!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const recovery = f.recovery({ submit: async input => { entered(); await pending; f.enqueue(input); } });
    f.pages.push({ messages: [human('110.000000')], has_more: false });
    const tick = recovery.tick(); await started; await recovery.close();
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '100.000000');
    finish(); await tick; await Promise.resolve();
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.lastCompletedAt, undefined);
  } finally { finish?.(); f.close(); }
});

test('bounded passes are fair, serialized and retain failures without blocking healthy threads', async () => {
  const f = fixture(); try {
    const other = 'slack:T1:C2:100.000000';
    f.store.enqueue({ source: 'slack', conversationId: other, eventId: 'slack-message:T1:C2:100.000000', input: 'joined' });
    f.pages.push({ ok: false, error: 'not_in_channel' });
    const recovery = f.recovery();
    const first = recovery.tick(); assert.equal(first, recovery.tick(), 'overlapping triggers share one pass'); await first;
    f.pages.push({ messages: [], has_more: false }); await recovery.tick();
    assert.equal(f.requests[1]!.get('channel'), 'C2');
    assert.equal(recovery.status().state, 'degraded');
    assert.equal(recovery.status().failures[0]!.error, 'not_in_channel');
    await recovery.close();
  } finally { f.close(); }
});

test('repeated page boundaries deduplicate and same-cursor loops do not mark a gap complete', async () => {
  const f = fixture(); try {
    f.pages.push({ messages: [human('110.000000')], has_more: true, response_metadata: { next_cursor: 'page2' } });
    const recovery = f.recovery(); await recovery.tick();
    f.pages.push({ messages: [human('110.000000'), human('120.000000')], has_more: true, response_metadata: { next_cursor: 'page2' } });
    await recovery.tick();
    assert.equal(f.store.slackRecoveryCheckpoint(route)!.oldest, '110.000000');
    assert.equal(f.store.listTasks().length, 2);
    f.advance(60_000);
    f.pages.push({ messages: [human('110.000000'), human('120.000000')], has_more: false });
    await recovery.tick(); assert.equal(f.store.listTasks().length, 3);
    await recovery.close();
  } finally { f.close(); }
});

test('periodic and reconnect triggers recover messages without another socket event, and close cancels the schedule', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); try {
    const recovery = f.recovery();
    f.pages.push({ messages: [human('150.000000')], has_more: false });
    recovery.start(); t.mock.timers.tick(0); await recovery.tick();
    assert.equal(f.store.listTasks().length, 2);
    f.advance(60_000); f.pages.push({ messages: [human('220.000000')], has_more: false });
    t.mock.timers.tick(60_000); await recovery.tick(); assert.equal(f.store.listTasks().length, 3);
    f.advance(10_000); f.pages.push({ messages: [human('265.000000')], has_more: false });
    recovery.wake(); t.mock.timers.tick(0); await recovery.tick(); assert.equal(f.store.listTasks().length, 4);
    await recovery.close(); t.mock.timers.tick(120_000); assert.equal(f.requests.length, 3);
  } finally { f.close(); }
});
