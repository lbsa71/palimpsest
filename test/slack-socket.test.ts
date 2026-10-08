import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SlackSocketClient } from '../src/slack-socket.ts';
import type { SlackSocket, SlackSocketOptions } from '../src/slack-socket.ts';
import type { InboundMessage } from '../src/communications.ts';
import { Store } from '../src/store.ts';

const base = { appToken: 'xapp-synthetic-token', allowedTeamIds: ['T1'], allowedUserIds: ['U1'], allowedChannelIds: ['C1'] };
const payload = (id = 'Ev1') => ({ type: 'event_callback', team_id: 'T1', event_id: id, event: { type: 'app_mention', channel: 'C1', user: 'U1', text: 'Hello', ts: '123.001', thread_ts: '123.000' } });
const frame = (id = 'Ev1', envelopeId = id) => ({ type: 'events_api', envelope_id: envelopeId, payload: payload(id), accepts_response_payload: false });
const delay = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(5); }
  assert.fail('condition did not become true');
}

class SocketFixture extends EventTarget implements SlackSocket {
  readyState = 0;
  sent: string[] = [];
  closed = 0;
  constructor(open = true) { super(); if (open) queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.dispatchEvent(new Event('open')); } }); }
  send(value: string): void { if (this.readyState !== 1) throw new Error('fixture not open'); this.sent.push(value); }
  close(): void { if (this.readyState !== 3) { this.closed++; this.readyState = 3; this.dispatchEvent(new Event('close')); } }
  message(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
}
function fixture(overrides: Partial<SlackSocketOptions> = {}) {
  const sockets: SocketFixture[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const options: SlackSocketOptions = { ...base, reconnectDelayMs: 1,
    fetch: async (url, init) => { requests.push({ url: String(url), ...(init ? { init } : {}) }); return Response.json({ ok: true, url: 'wss://wss.slack.com/link/?ticket=synthetic-ticket' }); },
    createSocket: () => { const socket = new SocketFixture(); sockets.push(socket); return socket; }, ...overrides };
  return { sockets, requests, options };
}

test('Socket Mode authenticates once, scopes payloads and acknowledges only durable acceptance', async (t) => {
  const f = fixture(); const received: InboundMessage[] = []; let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const client = new SlackSocketClient({ submit: async input => { received.push(input); await pending; } }, f.options);
  t.after(async () => { finish(); await client.close(); });
  assert.equal(f.requests.length, 0, 'construction has no network effect');
  await client.start();
  assert.equal(f.requests[0]!.url, 'https://slack.com/api/apps.connections.open');
  assert.equal(f.requests[0]!.init!.method, 'POST');
  assert.equal(f.requests[0]!.init!.redirect, 'error');
  assert.equal(new Headers(f.requests[0]!.init!.headers).get('authorization'), 'Bearer xapp-synthetic-token');
  assert.equal(client.status().state, 'connected');
  f.sockets[0]!.message(frame()); await until(() => received.length === 1);
  assert.deepEqual(f.sockets[0]!.sent, []);
  assert.deepEqual(received[0], { id: 'slack-message:T1:C1:123.001', conversationId: 'slack:T1:C1:123.000', text: 'Hello', source: 'slack', replyTo: '123.000', slackAuthor: { teamId: 'T1', userId: 'U1' } });
  finish(); await until(() => f.sockets[0]!.sent.length === 1);
  assert.deepEqual(JSON.parse(f.sockets[0]!.sent[0]!), { envelope_id: 'Ev1' });
  for (const change of [ { team_id: 'T2' }, { event: { ...payload().event, user: 'U2' } }, { event: { ...payload().event, channel: 'C2' } }, { event: { ...payload().event, bot_id: 'B1' } } ]) {
    f.sockets[0]!.message({ ...frame(), payload: { ...payload(), ...change } });
  }
  await until(() => f.sockets[0]!.sent.length === 5);
  assert.equal(received.length, 2, 'a user outside the modification whitelist can converse');
  assert.deepEqual(received[1]!.slackAuthor, { teamId: 'T1', userId: 'U2' });
});

test('socket reconnect and client restart preserve durable event deduplication', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'palimpsest-socket-'));
  const store = new Store(join(directory, 'state.sqlite'));
  const api = { submit: async (input: InboundMessage) => store.enqueue({ input: input.text, conversationId: input.conversationId, source: input.source, eventId: input.id }) };
  const f = fixture(); let client = new SlackSocketClient(api, f.options);
  t.after(async () => { await client.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  await client.start(); f.sockets[0]!.message(frame()); await until(() => f.sockets[0]!.sent.length === 1);
  f.sockets[0]!.message({ type: 'disconnect', reason: 'refresh_requested' });
  await until(() => f.sockets.length === 2 && client.status().state === 'connected');
  f.sockets[1]!.message(frame('Ev1', 'new-envelope')); await until(() => f.sockets[1]!.sent.length === 1);
  await client.close(); client = new SlackSocketClient(api, f.options); await client.start();
  f.sockets[2]!.message(frame('Ev1', 'restart-envelope')); await until(() => f.sockets[2]!.sent.length === 1);
  assert.equal(store.listTasks().length, 1);
});

test('connection credentials never follow redirects or non-Slack URLs and failures are bounded', async () => {
  for (const url of ['ws://wss.slack.com/path', 'wss://slack.com.evil.invalid/path', 'wss://user:password@wss.slack.com/path', 'wss://wss.slack.com:444/path', 'wss://wss.slack.com/path#secret']) {
    let connections = 0;
    const client = new SlackSocketClient({ submit: async () => {} }, { ...base, fetch: async () => Response.json({ ok: true, url }), createSocket: () => { connections++; return new SocketFixture(); } });
    await assert.rejects(client.start(), /^CommunicationsError: slack_socket_connection_failed$/);
    assert.equal(connections, 0); assert.equal(client.status().state, 'failed'); await client.close();
  }
  const huge = new SlackSocketClient({ submit: async () => {} }, { ...base, fetch: async () => new Response(' '.repeat(70_000)) });
  await assert.rejects(huge.start(), /slack_socket_connection_failed/); await huge.close();
  const timed = new SlackSocketClient({ submit: async () => {} }, { ...base, connectionTimeoutMs: 20, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(timed.start(), /slack_socket_connection_failed/); await timed.close();
});

test('malformed frames and acceptance timeouts reconnect within a finite budget without acknowledgements', async (t) => {
  const f = fixture({ maxReconnectAttempts: 2, submitTimeoutMs: 15 });
  const client = new SlackSocketClient({ submit: async () => { throw new Error('SECRET_CALLBACK_EXCEPTION'); } }, f.options);
  t.after(() => client.close()); await client.start();
  f.sockets[0]!.message('{'); await until(() => f.sockets.length === 2);
  f.sockets[1]!.message('x'.repeat(70_000)); await until(() => f.sockets.length === 3);
  f.sockets[2]!.message(frame()); await until(() => client.status().state === 'reconnecting');
  assert.equal(client.status().reconnectAttempts, 2);
  assert.equal(f.sockets.flatMap(socket => socket.sent).length, 0);
  assert.equal(JSON.stringify(client.status()).includes('SECRET'), false);
  const late = fixture({ submitTimeoutMs: 15 }); let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const second = new SlackSocketClient({ submit: async () => pending }, late.options);
  t.after(async () => { finish(); await second.close(); }); await second.start();
  late.sockets[0]!.message(frame()); await until(() => late.sockets.length === 2);
  finish(); await delay(10);
  assert.deepEqual(late.sockets[0]!.sent, []);
});

test('more than eight healthy Slack refreshes remain available without an operator restart', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const client = new SlackSocketClient({ submit: async () => {} }, f.options);
  t.after(() => client.close()); await client.start();
  for (let refresh = 0; refresh < 12; refresh++) {
    const socket = f.sockets.at(-1)!;
    socket.message({ type: 'hello' });
    t.mock.timers.tick(60_000);
    assert.equal(client.status().reconnectAttempts, 0, 'only sustained health replenishes the retry budget');
    socket.message({ type: 'disconnect', reason: 'refresh_requested' });
    t.mock.timers.tick(1);
    for (let i = 0; i < 100 && client.status().state !== 'connected'; i++) await Promise.resolve();
    assert.equal(client.status().state, 'connected');
    assert.equal(f.sockets.length, refresh + 2);
  }
});

test('immediate failures exhaust a bounded window, cool down, retry and stop cleanly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ maxReconnectAttempts: 2, reconnectDelayMs: 10 });
  const client = new SlackSocketClient({ submit: async () => {} }, f.options);
  t.after(() => client.close()); await client.start();
  const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  for (let attempt = 0; attempt < 2; attempt++) {
    f.sockets.at(-1)!.message({ type: 'hello' });
    f.sockets.at(-1)!.close();
    const wait = 10 * 2 ** attempt;
    t.mock.timers.tick(wait - 1); await settle();
    assert.equal(f.sockets.length, attempt + 1, 'no retry before its exponential backoff');
    t.mock.timers.tick(1); await settle();
    assert.equal(f.sockets.length, attempt + 2);
  }
  f.sockets.at(-1)!.message({ type: 'hello' }); f.sockets.at(-1)!.close();
  assert.equal(client.status().reconnectAttempts, 2, 'immediate hello did not reset the budget');
  assert.equal(client.status().state, 'reconnecting');
  t.mock.timers.tick(299_999); await settle(); assert.equal(f.sockets.length, 3);
  t.mock.timers.tick(1); await settle(); assert.equal(f.sockets.length, 4);
  assert.equal(client.status().reconnectAttempts, 1);
  f.sockets.at(-1)!.close(); t.mock.timers.tick(20); await settle();
  f.sockets.at(-1)!.close(); assert.equal(client.status().reconnectAttempts, 2);
  const beforeClose = f.requests.length; await client.close();
  t.mock.timers.tick(600_000); await settle();
  assert.equal(f.requests.length, beforeClose, 'close cancels the cooldown timer');
  assert.equal(client.status().state, 'stopped');
});

test('close cancels connection establishment, timers and pending acknowledgements', async () => {
  const f = fixture({ reconnectDelayMs: 25 }); let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const client = new SlackSocketClient({ submit: async () => pending }, f.options);
  await client.start(); f.sockets[0]!.message(frame()); await delay();
  await client.close(); finish(); await delay(40);
  assert.equal(client.status().state, 'stopped'); assert.equal(f.sockets.length, 1); assert.deepEqual(f.sockets[0]!.sent, []);
  const reconnecting = new SlackSocketClient({ submit: async () => {} }, f.options);
  await reconnecting.start(); f.sockets[1]!.close(); await reconnecting.close(); await delay(40);
  assert.equal(f.sockets.length, 2);
  const opening = new SlackSocketClient({ submit: async () => {} }, { ...base, fetch: async () => new Promise<Response>(() => {}) });
  const starting = opening.start(); await opening.close(); await assert.rejects(starting, /slack_socket_connection_failed/);
});

test('disabled links stop and unsupported interaction envelopes cannot become tasks', async (t) => {
  let submitted = 0; const f = fixture(); const client = new SlackSocketClient({ submit: async () => { submitted++; } }, f.options);
  t.after(() => client.close()); await client.start();
  f.sockets[0]!.message({ type: 'hello', connection_info: { app_id: 'A1' } });
  f.sockets[0]!.message({ type: 'slash_commands', envelope_id: 'unsupported', payload: { text: 'hello' } }); await delay();
  assert.equal(submitted, 0); assert.deepEqual(f.sockets[0]!.sent, []);
  f.sockets[0]!.message({ type: 'disconnect', reason: 'link_disabled' });
  await until(() => client.status().state === 'failed'); await delay(20); assert.equal(f.sockets.length, 1);
});


test('joined Slack threads accept plain follow-ups across socket/store restart and overlapping subscriptions deduplicate', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'palimpsest-joined-thread-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  const api = { submit: async (input: InboundMessage) => store.enqueue({ input: input.text, conversationId: input.conversationId, source: input.source, eventId: input.id }) };
  const f = fixture({ hasJoinedThread: id => store.hasSlackThread(id), hasAcceptedEvent: id => store.hasSlackEvent(id) });
  let client = new SlackSocketClient(api, f.options);
  t.after(async () => { await client.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const ordinary = (id: string, ts: string) => ({ ...frame(id), payload: { ...payload(id), event: { ...payload(id).event, type: 'message', channel_type: 'channel', ts } } });
  await client.start();
  // Message subscription arrives before the initiating mention: it cannot enroll.
  f.sockets[0]!.message(ordinary('pre-mention', '123.001'));
  await until(() => f.sockets[0]!.sent.length === 1);
  assert.equal(store.listTasks().length, 0);
  f.sockets[0]!.message(frame('mention')); await until(() => f.sockets[0]!.sent.length === 2);
  f.sockets[0]!.message(ordinary('mention-mirror', '123.001')); await until(() => f.sockets[0]!.sent.length === 3);
  assert.equal(store.listTasks().length, 1);
  await client.close(); store.close(); store = new Store(path);
  client = new SlackSocketClient(api, f.options); await client.start();
  f.sockets[1]!.message(ordinary('plain-followup', '123.002')); await until(() => f.sockets[1]!.sent.length === 1);
  assert.equal(store.listTasks().length, 2);
  assert.equal(store.listTasks()[1]!.conversationId, store.listTasks()[0]!.conversationId);
  const mentionAfter = { ...frame('followup-mention'), payload: { ...payload('followup-mention'), event: { ...payload().event, ts: '123.002' } } };
  f.sockets[1]!.message(mentionAfter); await until(() => f.sockets[1]!.sent.length === 2);
  assert.equal(store.listTasks().length, 2, 'message-first overlapping mention has no second task');
  store.enqueue({ source: 'direct', conversationId: 'slack:T1:C1:999.000', input: 'Synthetic direct task', eventId: 'direct' });
  assert.equal(store.hasSlackThread('slack:T1:C1:999.000'), false);
  store.enqueue({ source: 'slack', conversationId: 'slack:T1:C1:123.000', input: 'Hello', eventId: 'legacy-event' });
  f.sockets[1]!.message(frame('legacy-event')); await until(() => f.sockets[1]!.sent.length === 3);
  assert.equal(store.listTasks().length, 4, 'legacy event retry retains the previously accepted identity');
});
