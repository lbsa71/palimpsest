import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Provenance } from '../../contracts/common.ts';
import { SlackError, type SlackApi } from '../slack/client.ts';
import { SlackSearch, SLACK_SEARCH_MAX_QUERY_CHARS, SLACK_SEARCH_MAX_RESULTS, SLACK_SEARCH_METHOD, type SlackSearchContext } from '../slack/search.ts';

const context: SlackSearchContext = {
  teamId: 'T1',
  userId: 'U1',
  channelId: 'C0',
  actionToken: 'secret-action-token',
  allowedChannelIds: ['C1', 'C2'],
};
const provenance: Omit<Provenance, 'recordedAt'> = {
  sourceIds: ['slack-event:assistant-action'],
  actorId: 'slack:T1:U1',
  derivation: 'observed',
};
const recordedAt = '2026-10-12T20:05:00.000Z';
const clock = () => recordedAt;

interface Call { method: string; parameters: Record<string, string>; signal?: AbortSignal }

function fakeApi(handler: (call: Call) => unknown): { api: SlackApi; calls: Call[] } {
  const calls: Call[] = [];
  const api: SlackApi = {
    async call<T>(method: string, parameters: Record<string, string>, signal?: AbortSignal): Promise<T> {
      const call: Call = { method, parameters, signal };
      calls.push(call);
      return handler(call) as T;
    },
  };
  return { api, calls };
}

function search(api: SlackApi, overrides: Partial<SlackSearchContext> = {}) {
  return new SlackSearch(api, { ...context, ...overrides }, provenance, clock);
}

function assertSafeFailure(failure: unknown, token: string): void {
  assert.ok(failure instanceof Error);
  assert.equal(failure.message, 'Slack search request failed');
  assert.equal(failure.cause, undefined);
  assert.deepEqual(Object.keys(failure), []);
  assert.equal(Object.getOwnPropertyNames(failure).includes('action_token'), false);
  assert.equal(Object.getOwnPropertyNames(failure).includes('request'), false);
  assert.equal(JSON.stringify(failure).includes(token), false);
  assert.equal(String(failure).includes(token), false);
  assert.equal(failure.message.includes(token), false);
}

test('dispatches assistant.search.context once with documented public-channel parameters and projects checked fields', async () => {
  const { api, calls } = fakeApi(() => ({
    results: {
      messages: [
        { team_id: 'T1', channel_id: 'C1', message_ts: '1.2', content: 'first', permalink: 'https://example.test/1', extra: 'drop me' },
        { team_id: 'T1', channel_id: 'C2', message_ts: '3.4', content: 'second', permalink: 'https://example.test/2' },
      ],
    },
    response_metadata: { next_cursor: ' next ' },
  }));
  const result = await search(api).search({ query: '  bounded query  ', maxResults: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, SLACK_SEARCH_METHOD);
  assert.deepEqual(calls[0].parameters, {
    action_token: 'secret-action-token',
    query: 'bounded query',
    context_channel_id: 'C0',
    channel_types: 'public_channel',
    content_types: 'messages',
    limit: '2',
  });
  assert.equal(result.nextCursor, 'next');
  assert.equal(result.messages.length, 2);
  assert.deepEqual(Object.keys(result.messages[0]).sort(), ['channelId', 'content', 'messageTs', 'permalink', 'provenance', 'teamId']);
  assert.deepEqual(result.messages.map(message => [message.teamId, message.channelId, message.messageTs, message.content, message.permalink]), [
    ['T1', 'C1', '1.2', 'first', 'https://example.test/1'],
    ['T1', 'C2', '3.4', 'second', 'https://example.test/2'],
  ]);
  assert.deepEqual(result.messages[0].provenance, { ...provenance, sourceIds: [...provenance.sourceIds], recordedAt });
  assert.equal(result.messages[1].provenance.recordedAt, recordedAt);
});

test('rejects missing context, token and invalid query/result bounds before any API call', async () => {
  const missing: Array<[Partial<SlackSearchContext>, RegExp]> = [
    [{ teamId: '' }, /teamId/],
    [{ userId: '' }, /userId/],
    [{ channelId: '' }, /channelId/],
    [{ actionToken: '' }, /action token/],
    [{ actionToken: '   ' }, /action token/],
    [{ allowedChannelIds: [] }, /allowed public channels/],
    [{ allowedChannelIds: ['C1', 'C1'] }, /duplicate allowed/],
  ];
  for (const [overrides, pattern] of missing) {
    const { api, calls } = fakeApi(() => ({ results: { messages: [] } }));
    assert.throws(() => search(api, overrides), pattern);
    assert.equal(calls.length, 0);
  }

  const { api, calls } = fakeApi(() => ({ results: { messages: [] } }));
  const adapter = search(api);
  await assert.rejects(adapter.search({ query: '' }), /nonempty/);
  await assert.rejects(adapter.search({ query: '   ' }), /nonempty/);
  await assert.rejects(adapter.search({ query: 'x'.repeat(SLACK_SEARCH_MAX_QUERY_CHARS + 1) }), /exceeds/);
  await assert.rejects(adapter.search({ query: 'ok', maxResults: 0 }), /result count/);
  await assert.rejects(adapter.search({ query: 'ok', maxResults: SLACK_SEARCH_MAX_RESULTS + 1 }), /result count/);
  await assert.rejects(adapter.search({ query: 'ok', maxResults: 1.5 }), /result count/);
  assert.equal(calls.length, 0);
});

test('filters foreign teams and unauthorized channels, enforces the requested result bound, and rejects malformed results', async () => {
  const { api } = fakeApi(() => ({
    results: {
      messages: [
        { team_id: 'T2', channel_id: 'C1', message_ts: '1', content: 'foreign team', permalink: 'https://example.test/foreign-team' },
        { team_id: 'T1', channel_id: 'C9', message_ts: '2', content: 'unauthorized channel', permalink: 'https://example.test/private' },
        { team_id: 'T1', channel_id: 'C1', message_ts: '3', content: 'allowed', permalink: 'https://example.test/allowed' },
        { team_id: 'T1', channel_id: 'C2', message_ts: '4', content: 'beyond bound', permalink: 'https://example.test/beyond' },
      ],
    },
  }));
  const result = await search(api).search({ query: 'filter', maxResults: 2 });
  assert.deepEqual(result.messages.map(message => message.messageTs), ['3', '4']);
  assert.equal(result.nextCursor, null);

  const malformed = [
    { team_id: 'T1', channel_id: 'C1', message_ts: '1', content: '', permalink: 'https://example.test/x' },
    { team_id: 'T1', channel_id: 'C1', message_ts: '1', content: 'x', permalink: 42 },
    { team_id: 'T1', channel_id: 'C1', message_ts: '1', content: 'x' },
    'not-an-object',
  ];
  for (const message of malformed) {
    const failing = fakeApi(() => ({ results: { messages: [message] } }));
    await assert.rejects(search(failing.api).search({ query: 'malformed' }), /invalid|missing|object/);
    assert.equal(failing.calls.length, 1);
  }
  const missingMessages = fakeApi(() => ({ results: {} }));
  await assert.rejects(search(missingMessages.api).search({ query: 'missing' }), /messages missing/);
  const badCursor = fakeApi(() => ({ results: { messages: [] }, response_metadata: { next_cursor: 7 } }));
  await assert.rejects(search(badCursor.api).search({ query: 'cursor' }), /next_cursor/);
});

test('forwards cancellation and sanitizes failures that could expose the action token', async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = fakeApi(() => ({ results: { messages: [] } }));
  await assert.rejects(search(aborted.api).search({ query: 'cancelled', signal: controller.signal }), (error: unknown) => error instanceof Error && /abort/i.test(error.message));
  assert.equal(aborted.calls.length, 0);

  const inFlight = new AbortController();
  const dispatched = fakeApi(call => {
    inFlight.abort();
    assert.equal(call.signal, inFlight.signal);
    return { results: { messages: [] } };
  });
  await assert.rejects(search(dispatched.api).search({ query: 'in flight', signal: inFlight.signal }), (error: unknown) => error instanceof Error && /abort/i.test(error.message));
  assert.equal(dispatched.calls.length, 1);

  const token = context.actionToken;
  const cause = new Error(`request failed for ${token}`, { cause: { action_token: token, nested: [`${token}`] } });
  const leaking = Object.assign(new Error(`dispatch failed: ${token}`), {
    action_token: token,
    request: { action_token: token },
    cause,
  });
  const failing = fakeApi(() => { throw leaking; });
  const failure = await search(failing.api).search({ query: 'fails' }).then(() => null, (error: unknown) => error);
  assertSafeFailure(failure, token);
  assert.equal(failing.calls.length, 1);
  assert.equal(JSON.stringify(failing.calls).includes(token), true);

  const slackFailure = fakeApi(() => { throw new SlackError('invalid_auth'); });
  const sanitized = await search(slackFailure.api).search({ query: 'slack fails' }).then(() => null, (error: unknown) => error);
  assertSafeFailure(sanitized, token);
  assert.equal(slackFailure.calls.length, 1);
});

test('sanitizes a token-bearing AbortError from a nonaborted signal without retaining untrusted failure data', async () => {
  const token = context.actionToken;
  const controller = new AbortController();
  const leakingAbort = Object.assign(new Error(`dispatch failed: ${token}`), {
    name: 'AbortError',
    action_token: token,
    request: { action_token: token },
    cause: new Error(`nested ${token}`),
  });
  const failing = fakeApi(call => {
    assert.equal(call.signal, controller.signal);
    assert.equal(controller.signal.aborted, false);
    throw leakingAbort;
  });
  const failure = await search(failing.api).search({ query: 'fake abort', signal: controller.signal }).then(() => null, (error: unknown) => error);
  assertSafeFailure(failure, token);
  assert.equal(failing.calls.length, 1);
  assert.equal(controller.signal.aborted, false);
});

test('sanitizes token-bearing AggregateError failures from the injected API', async () => {
  const token = context.actionToken;
  const aggregate = new AggregateError([
    Object.assign(new Error(`first ${token}`), { action_token: token }),
    new Error(`second ${token}`, { cause: { request: { action_token: token } } }),
  ], `aggregate failed: ${token}`, { cause: new Error(`cause ${token}`) });
  const failing = fakeApi(() => { throw aggregate; });
  const failure = await search(failing.api).search({ query: 'aggregate fails' }).then(() => null, (error: unknown) => error);
  assertSafeFailure(failure, token);
  assert.equal(failing.calls.length, 1);
});
