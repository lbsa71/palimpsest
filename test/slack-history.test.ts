import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlackHistoryClient, SlackHistoryError } from '../src/slack-history.ts';

const token = 'xoxb-PRIVATE_TOKEN';
const signal = () => new AbortController().signal;
const identity = { ok: true, team_id: 'T1', user_id: 'U1', bot_id: 'B1' };
const request = { channelId: 'C1', threadTs: '123.000001', oldest: '123.000002', latest: '456.000001' };
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof SlackHistoryError);
  assert.equal(error.code, expected);
  assert.equal(error.cause, undefined);
  assert.equal(String(error).includes('PRIVATE'), false);
  return true;
};
const client = (response: unknown) => new SlackHistoryClient({ token, fetch: async () => Response.json(response) });

test('authenticates bot identity and pages replies through fixed credential-free URLs', async () => {
  const calls: URL[] = [];
  const api = new SlackHistoryClient({ token, fetch: async (input, options) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.origin, 'https://slack.com');
    assert.equal(url.username, ''); assert.equal(url.password, '');
    assert.equal(String(input).includes(token), false);
    assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${token}`);
    assert.equal(options?.redirect, 'error'); assert.equal(options?.method, 'GET');
    if (url.pathname === '/api/auth.test') return Response.json(identity);
    assert.equal(url.pathname, '/api/conversations.replies');
    assert.equal(url.searchParams.get('channel'), request.channelId);
    assert.equal(url.searchParams.get('ts'), request.threadTs);
    assert.equal(url.searchParams.get('oldest'), request.oldest);
    assert.equal(url.searchParams.get('latest'), request.latest);
    assert.equal(url.searchParams.get('inclusive'), 'false');
    assert.equal(url.searchParams.get('limit'), '100');
    if (!url.searchParams.has('cursor')) return Response.json({ ok: true, messages: [{ type: 'message', ts: '123.000003' }], has_more: false, response_metadata: { next_cursor: 'https://PRIVATE.invalid/?token=x&cursor=y' } });
    assert.equal(url.searchParams.get('cursor'), 'https://PRIVATE.invalid/?token=x&cursor=y');
    return Response.json({ ok: true, messages: [], has_more: false, response_metadata: { next_cursor: '' } });
  } });
  assert.deepEqual(await api.authenticate(signal()), { teamId: 'T1', userId: 'U1' });
  const first = await api.replies(request, signal());
  assert.equal(first.hasMore, true); assert.equal(first.messages.length, 1);
  assert.deepEqual(await api.replies({ ...request, cursor: first.nextCursor }, signal()), { messages: [], hasMore: false });
  assert.equal(calls.length, 3);
});

test('refuses malformed bot identity, history envelopes and incomplete pagination', async () => {
  for (const body of [{ ...identity, team_id: '' }, { ...identity, user_id: 'https://PRIVATE.invalid' }, { ...identity, bot_id: undefined }, { ...identity, team_id: 'T1\nPRIVATE' }, { ...identity, ok: 'true' }, { ...identity, team_id: 'T' + '1'.repeat(128) }]) {
    await assert.rejects(client(body).authenticate(signal()), code('protocol'));
  }
  for (const body of [null, [], { ok: true }, { ok: true, messages: [null] }, { ok: true, messages: [[]] },
    { ok: true, messages: [], has_more: 'false' }, { ok: true, messages: [], has_more: true },
    { ok: true, messages: [], response_metadata: [] }, { ok: true, messages: [], response_metadata: { next_cursor: 1 } },
    { ok: true, messages: [], response_metadata: { next_cursor: 'PRIVATE\n' } }]) {
    await assert.rejects(client(body).replies(request, signal()), code('protocol'));
  }
});

test('known Slack errors remain safe and all arbitrary remote or transport errors are opaque', async () => {
  for (const error of ['missing_scope', 'not_in_channel', 'channel_not_found', 'thread_not_found', 'invalid_cursor', 'token_revoked', 'invalid_auth']) {
    await assert.rejects(client({ ok: false, error, detail: 'PRIVATE' }).authenticate(signal()), code(error));
  }
  await assert.rejects(client({ ok: false, error: 'PRIVATE_REMOTE_PAYLOAD' }).authenticate(signal()), code('unavailable'));
  await assert.rejects(new SlackHistoryClient({ token, fetch: async () => { throw new Error('PRIVATE transport token'); } }).authenticate(signal()), code('unavailable'));
  for (const status of [302, 401, 500]) {
    const api = new SlackHistoryClient({ token, fetch: async () => new Response('PRIVATE response', { status, headers: { location: 'https://PRIVATE.invalid' } }) });
    await assert.rejects(api.authenticate(signal()), code('unavailable'));
  }
});

test('rate limits provide conservative bounded Retry-After without reading error bodies', async () => {
  for (const [header, expected] of [['12', 12_000], ['0', 1000], ['-1', 60_000], ['PRIVATE', 60_000], ['', 60_000], ['9999999999999999999999999999999999999', 2_147_483_647]] as const) {
    const api = new SlackHistoryClient({ token, fetch: async () => new Response('PRIVATE body', { status: 429, headers: { 'retry-after': header } }) });
    await assert.rejects(api.replies(request, signal()), (error: unknown) => { code('ratelimited')(error); assert.equal((error as SlackHistoryError).retryAfterMs, expected); return true; });
  }
  await assert.rejects(client({ ok: false, error: 'ratelimited' }).authenticate(signal()), (error: unknown) => { code('ratelimited')(error); assert.equal((error as SlackHistoryError).retryAfterMs, 60_000); return true; });
});

test('caps streamed and advertised response size and rejects malformed JSON', async () => {
  let cancelled = false;
  const streamed = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1_048_577)); }, cancel() { cancelled = true; } });
  await assert.rejects(new SlackHistoryClient({ token, fetch: async () => new Response(streamed) }).authenticate(signal()), code('limit'));
  assert.equal(cancelled, true);
  for (const response of [new Response('PRIVATE', { headers: { 'content-length': '1048577' } }), new Response('PRIVATE', { headers: { 'content-length': '999999999999999999999' } })]) {
    await assert.rejects(new SlackHistoryClient({ token, fetch: async () => response }).authenticate(signal()), code('limit'));
  }
  for (const response of [new Response('{PRIVATE'), new Response(null), new Response('{}', { headers: { 'content-length': 'PRIVATE' } })]) {
    await assert.rejects(new SlackHistoryClient({ token, fetch: async () => response }).authenticate(signal()), code('protocol'));
  }
});

test('caller cancellation stops waiting even when fetch ignores abort and prevents new requests', async () => {
  let calls = 0; let actualSignal: AbortSignal | undefined;
  const api = new SlackHistoryClient({ token, fetch: async (_url, options) => { calls++; actualSignal = options?.signal ?? undefined; return new Promise<Response>(() => {}); } });
  const controller = new AbortController();
  const work = api.authenticate(controller.signal);
  controller.abort('PRIVATE cancellation');
  await assert.rejects(work, code('cancelled'));
  assert.equal(actualSignal?.aborted, true);
  await assert.rejects(api.replies(request, controller.signal), code('cancelled'));
  assert.equal(calls, 1);
});

test('timeout also bounds uncooperative fetch and body cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hanging = new SlackHistoryClient({ token, timeoutMs: 25, fetch: async () => new Promise<Response>(() => {}) });
  const work = hanging.authenticate(signal());
  const rejected = assert.rejects(work, code('timeout'));
  t.mock.timers.tick(25); await rejected;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
  const body = new SlackHistoryClient({ token, timeoutMs: 25, fetch: async () => new Response(stream) });
  const reading = body.authenticate(signal());
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const bodyRejected = assert.rejects(reading, code('timeout'));
  t.mock.timers.tick(25); await bodyRejected;
  assert.equal(cancelled, true);
});

test('validates bounded configuration and request inputs before any network use', async () => {
  for (const value of ['', 'PRIVATE\n', 'x'.repeat(4097)]) assert.throws(() => new SlackHistoryClient({ token: value }), code('configuration'));
  for (const timeoutMs of [0, -1, 60_001, Infinity]) assert.throws(() => new SlackHistoryClient({ token, timeoutMs }), code('configuration'));
  let calls = 0;
  const api = new SlackHistoryClient({ token, fetch: async () => { calls++; return Response.json(identity); } });
  for (const bad of [{ ...request, channelId: 'https://PRIVATE.invalid' }, { ...request, threadTs: '1&token=PRIVATE' }, { ...request, oldest: '-1' }, { ...request, latest: 'Infinity' }, { ...request, cursor: 'x'.repeat(4097) }]) {
    await assert.rejects(api.replies(bad, signal()), code('configuration'));
  }
  assert.equal(calls, 0);
});


test('rejects a successful response from an unexpected URL and disposes of late responses', async (t) => {
  const redirected = Response.json(identity);
  Object.defineProperty(redirected, 'url', { value: 'https://PRIVATE.invalid/api/auth.test' });
  await assert.rejects(new SlackHistoryClient({ token, fetch: async () => redirected }).authenticate(signal()), code('protocol'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (response: Response) => void;
  let cancelled = false;
  const api = new SlackHistoryClient({ token, timeoutMs: 20, fetch: async () => new Promise<Response>(done => { resolve = done; }) });
  const pending = api.authenticate(signal());
  const rejected = assert.rejects(pending, code('timeout'));
  t.mock.timers.tick(20); await rejected;
  resolve(new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(cancelled, true);
});
