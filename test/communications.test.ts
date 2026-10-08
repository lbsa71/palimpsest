import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { DirectCommunications, createLocalServer, parseSlackEvent, parseSlackPayload, SlackCommunications } from '../src/communications.ts';
import type { InboundMessage, OutboundMessage } from '../src/communications.ts';

const message: InboundMessage = { id: 'request-1', conversationId: 'alice', text: 'Hello', source: 'direct' };
const output: OutboundMessage = { conversationId: 'alice', taskId: 'task-1', text: 'Working', kind: 'progress' };

test('direct transport reaches shared ingress and returns isolated output snapshots', async () => {
  const direct = new DirectCommunications();
  assert.equal(direct.name, 'direct');
  const inbound = { ...message };
  const result = await direct.receive(inbound, async (input) => {
    input.text = 'Runtime-owned copy';
    await direct.send(output);
    return { taskId: 'task-1' };
  });
  assert.deepEqual(result, { taskId: 'task-1' });
  assert.equal(inbound.text, 'Hello');
  const outgoing = { ...output, text: 'Another observation' };
  await direct.send(outgoing);
  outgoing.text = 'Mutated outside adapter';
  assert.equal(direct.messages('alice')[0]?.text, 'Working');
  assert.equal(direct.messages('alice')[1]?.text, 'Another observation');
  const snapshot = direct.messages('alice');
  snapshot[0]!.text = 'Mutated snapshot';
  assert.equal(direct.messages('alice')[0]?.text, 'Working');
  assert.deepEqual(direct.messages('bob'), []);
  await assert.rejects(direct.receive({ ...message, text: '' }, async () => 1), /invalid_message/);
});

test('local HTTP remains addressable while an ingress call is pending', async (t) => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const local = await createLocalServer({
    submit: async () => { await pending; return { id: 'long-task' }; },
    status: () => ({ state: 'running' }),
    cancel: () => { finish(); return { state: 'cancelled' }; },
    events: () => [],
  }, { token: 'local-token-at-least-16-characters' });
  t.after(() => { finish(); return local.close(); });
  const headers = { authorization: 'Bearer local-token-at-least-16-characters', 'content-type': 'application/json' };
  const submission = fetch(local.url + '/messages', { method: 'POST', headers, body: JSON.stringify(message) });
  const status = await fetch(local.url + '/tasks/long-task', { headers, signal: AbortSignal.timeout(2000) });
  assert.equal(status.status, 200);
  const cancellation = await fetch(local.url + '/tasks/long-task/cancel', { method: 'POST', headers, signal: AbortSignal.timeout(2000) });
  assert.equal(cancellation.status, 200);
  assert.equal((await submission).status, 202);
});

test('local HTTP shares submit/status/cancel/events and authenticates all routes', async (t) => {
  const received: InboundMessage[] = [];
  const cancellations: string[] = [];
  const local = await createLocalServer({
    submit: async (input) => { received.push(input); return { id: 't1' }; },
    status: (id) => id === 't1' ? { id, state: 'running' } : undefined,
    cancel: (id) => { cancellations.push(id); return { id, state: 'cancelled' }; },
    events: (after) => [{ sequence: after + 1 }],
  }, { token: 'local-token-at-least-16-characters' });
  t.after(() => local.close());
  const headers = { authorization: 'Bearer local-token-at-least-16-characters', 'content-type': 'application/json' };
  for (const path of ['/messages', '/tasks/t1', '/tasks/t1/cancel', '/events']) {
    assert.equal((await fetch(local.url + path)).status, 401);
  }
  const submitted = await fetch(local.url + '/messages', { method: 'POST', headers, body: JSON.stringify(message) });
  assert.equal(submitted.status, 202);
  assert.deepEqual(await submitted.json(), { id: 't1' });
  assert.deepEqual(received, [message]);
  assert.deepEqual(await (await fetch(local.url + '/tasks/t1', { headers })).json(), { id: 't1', state: 'running' });
  assert.equal((await fetch(local.url + '/tasks/missing', { headers })).status, 404);
  assert.equal((await fetch(local.url + '/tasks/t1/cancel', { method: 'POST', headers })).status, 200);
  assert.deepEqual(cancellations, ['t1']);
  assert.deepEqual(await (await fetch(local.url + '/events?after=7', { headers })).json(), [{ sequence: 8 }]);
});

test('local HTTP rejects hostile input before runtime ingress and hides internal errors', async (t) => {
  let called = 0;
  const local = await createLocalServer({
    submit: async () => { called++; throw new Error('SECRET_INTERNAL_DATA'); },
    status: () => undefined, cancel: () => undefined, events: () => [],
  }, { token: 'local-token-at-least-16-characters' });
  t.after(() => local.close());
  const headers = { authorization: 'Bearer local-token-at-least-16-characters', 'content-type': 'application/json' };
  for (const body of ['{', 'null', '[]', JSON.stringify({ ...message, text: '' }), JSON.stringify({ ...message, source: 'slack' }), JSON.stringify({ ...message, privileged: true })]) {
    assert.equal((await fetch(local.url + '/messages', { method: 'POST', headers, body })).status, 400);
  }
  assert.equal((await fetch(local.url + '/messages', { method: 'POST', headers, body: JSON.stringify({ ...message, text: 'x'.repeat(70_000) }) })).status, 413);
  assert.equal((await fetch(local.url + '/messages', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(local.url + '/messages', { method: 'POST', headers: { ...headers, origin: 'https://example.com' }, body: JSON.stringify(message) })).status, 403);
  assert.equal((await fetch(local.url + '/events?after=-1', { headers })).status, 400);
  assert.equal((await fetch(local.url + '/events?after=1.5', { headers })).status, 400);
  assert.equal((await fetch(local.url + '/tasks/%ZZ', { headers })).status, 400);
  assert.equal(called, 0);
  const failure = await fetch(local.url + '/messages', { method: 'POST', headers, body: JSON.stringify(message) });
  assert.equal(failure.status, 500);
  assert.equal((await failure.text()).includes('SECRET_INTERNAL_DATA'), false);
  await assert.rejects(createLocalServer({ submit: async () => ({}), status: () => ({}), cancel: () => ({}), events: () => [] }, { token: 'short' }), /token/);
  await assert.rejects(createLocalServer({ submit: async () => ({}), status: () => ({}), cancel: () => ({}), events: () => [] }, { token: 'local-token-at-least-16-characters', host: '0.0.0.0' }), /loopback/);
});

const slackEvent = {
  type: 'event_callback', team_id: 'T1', event_id: 'Ev1',
  event: { type: 'app_mention', user: 'U1', channel: 'C1', text: 'Please work', ts: '123.456', thread_ts: '123.000' },
};

function signed(event: unknown, timestamp = '1770000000') {
  const rawBody = JSON.stringify(event);
  return {
    rawBody,
    options: { signingSecret: 'test-signing-secret', timestamp, signature: 'v0=' + createHmac('sha256', 'test-signing-secret').update(`v0:${timestamp}:${rawBody}`).digest('hex'), now: 1770000000000, allowedTeamIds: ['T1'], allowedUserIds: ['U1'] },
  };
}

test('Slack event auth preserves retry identity and isolates thread context', () => {
  const { rawBody, options } = signed(slackEvent);
  const parsed = parseSlackEvent(rawBody, options);
  assert.deepEqual(parsed, { kind: 'message', message: { id: 'slack-message:T1:C1:123.456', conversationId: 'slack:T1:C1:123.000', source: 'slack', text: 'Please work', replyTo: '123.000', slackAuthor: { teamId: 'T1', userId: 'U1' } } });
  assert.deepEqual(parseSlackEvent(rawBody, options), parsed, 'retries retain the same durable ingress identity');
  const other = signed({ ...slackEvent, event_id: 'Ev2', event: { ...slackEvent.event, thread_ts: '124.000' } });
  assert.notDeepEqual(parseSlackEvent(other.rawBody, other.options), parsed);
  assert.throws(() => parseSlackEvent(rawBody + ' ', options), /invalid_slack_signature/);
  assert.throws(() => parseSlackEvent(rawBody, { ...options, signature: 'v0=bad' }), /invalid_slack_signature/);
  assert.throws(() => parseSlackEvent(rawBody, { ...options, now: options.now + 301_000 }), /expired_slack_request/);
  assert.throws(() => parseSlackEvent(rawBody, { ...options, now: options.now - 301_000 }), /expired_slack_request/);
  assert.deepEqual(parseSlackEvent(rawBody, { ...options, allowedTeamIds: [] }), { kind: 'ignored' });
  assert.equal(parseSlackEvent(rawBody, { ...options, allowedUserIds: [] }).kind, 'message', 'user eligibility must not block conversation');
  assert.deepEqual(parseSlackEvent(rawBody, { ...options, allowedChannelIds: [] }), { kind: 'ignored' });
});

test('Slack ignores bots and edit notifications; signed challenges work', () => {
  for (const event of [{ ...slackEvent.event, bot_id: 'B1' }, { ...slackEvent.event, subtype: 'message_changed' }]) {
    const data = signed({ ...slackEvent, event });
    assert.deepEqual(parseSlackEvent(data.rawBody, data.options), { kind: 'ignored' });
  }
  const challenge = signed({ type: 'url_verification', challenge: 'one-time-challenge' });
  assert.deepEqual(parseSlackEvent(challenge.rawBody, challenge.options), { kind: 'challenge', challenge: 'one-time-challenge' });
  const missingId = signed({ ...slackEvent, event_id: undefined });
  assert.throws(() => parseSlackEvent(missingId.rawBody, missingId.options), /invalid_slack_event/);
});

test('Slack sends to original thread and refuses ambiguous context', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const slack = new SlackCommunications({ token: 'test-bot-token', fetch: async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ ok: true, channel: 'C1', ts: '125.000' }), { status: 200 });
  } });
  await slack.send({ conversationId: 'slack:T1:C1:123.000', replyTo: '123.000', taskId: 'task-1', text: 'Done', kind: 'result' });
  assert.equal(requests[0]?.url, 'https://slack.com/api/chat.postMessage');
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { channel: 'C1', thread_ts: '123.000', text: 'Done', mrkdwn: false, unfurl_links: false, unfurl_media: false });
  assert.equal(new Headers(requests[0]?.init.headers).get('authorization'), 'Bearer test-bot-token');
  assert.equal(requests[0]?.init.redirect, 'error', 'an authenticated outgoing body must never follow a redirect');
  await assert.rejects(slack.send({ ...output, conversationId: 'slack:T1:C1:123.000', replyTo: '999.000' }), /invalid_slack_context/);
  assert.equal(requests.length, 1);
});

test('Slack reports API failure and uncertain external outcomes without replay', async () => {
  const outgoing: OutboundMessage = { ...output, conversationId: 'slack:T1:C1:123.000' };
  for (const [response, delivery] of [[new Response(JSON.stringify({ ok: false, error: 'not_in_channel' })), 'rejected'], [new Response('down', { status: 503 }), 'uncertain'], [new Response('limited', { status: 429 }), 'rejected'], [new Response('not-json'), 'uncertain']] as const) {
    let requests = 0;
    const slack = new SlackCommunications({ token: 'test-bot-token', fetch: async () => { requests++; return response; } });
    await assert.rejects(slack.send(outgoing), (error: unknown) => error instanceof Error && 'delivery' in error && error.delivery === delivery);
    assert.equal(requests, 1);
  }
  const slack = new SlackCommunications({ token: 'test-bot-token', fetch: async () => { throw new Error('network failure with credential'); } });
  await assert.rejects(slack.send(outgoing), (error: unknown) => error instanceof Error && error.message === 'slack_delivery_uncertain');
});


test('ordinary Slack follow-ups require durable joined-thread membership and retain all identity gates', () => {
  const joined = new Set(['slack:T1:C1:123.000']);
  const options = { allowedTeamIds: ['T1'], allowedUserIds: ['U1'], allowedChannelIds: ['C1'], hasJoinedThread: (id: string) => joined.has(id) };
  const event = { ...slackEvent, event: { ...slackEvent.event, type: 'message', channel_type: 'channel' } };
  const accepted = parseSlackPayload(event, options);
  assert.equal(accepted.kind, 'message');
  assert.deepEqual(parseSlackPayload({ ...event, event: { ...event.event, channel_type: 'group' } }, options), accepted);
  assert.deepEqual(parseSlackPayload(event, { ...options, hasJoinedThread: undefined }), { kind: 'ignored' });
  for (const change of [
    { team_id: 'T2' },
    { event: { ...event.event, channel: 'C2' } },
    { event: { ...event.event, thread_ts: '999.000' } },
    { event: { ...event.event, thread_ts: undefined } },
    { event: { ...event.event, channel_type: 'im' } },
    { event: { ...event.event, bot_id: 'B1' } },
    { event: { ...event.event, subtype: 'message_changed' } },
  ]) assert.deepEqual(parseSlackPayload({ ...event, ...change }, options), { kind: 'ignored' });
  const anotherUser = parseSlackPayload({ ...event, event: { ...event.event, user: 'U2' } }, options);
  assert.equal(anotherUser.kind, 'message', 'all humans may follow up in a joined thread');
  if (anotherUser.kind === 'message') assert.deepEqual(anotherUser.message.slackAuthor, { teamId: 'T1', userId: 'U2' });
  assert.deepEqual(parseSlackPayload({ ...event, event_id: 'other-subscription', event: { ...event.event, type: 'app_mention' } }, options), accepted);
  assert.deepEqual(parseSlackPayload({ ...event, event: { ...event.event, type: 'app_mention', channel_type: 'im' } }, options), { kind: 'ignored' });
  const malformed = { ...event, event: { ...event.event, ts: undefined } };
  assert.throws(() => parseSlackPayload(malformed, options), /invalid_slack_event/);
});
