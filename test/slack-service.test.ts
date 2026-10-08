import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSlackServer } from '../src/slack-service.ts';
import { Store } from '../src/store.ts';
import { AgentRuntime } from '../src/runtime.ts';
import type { InboundMessage } from '../src/communications.ts';

const options = { signingSecret: 'synthetic-signing-secret', allowedTeamIds: ['T1'], allowedUserIds: ['U1'] };
const envelope = (id = 'Ev1') => ({ type: 'event_callback', team_id: 'T1', event_id: id, event: { type: 'message', channel: 'C1', user: 'U1', text: 'Hello', ts: '123.001', thread_ts: '123.000' } });
function request(body: unknown, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { method: 'POST', headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': 'v0=' + createHmac('sha256', options.signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex') }, body: raw };
}

test('signed challenges and authorized messages route through shared normalized ingress', async (t) => {
  const received: InboundMessage[] = [];
  const server = await createSlackServer({ submit: async (input) => { received.push(input); return { id: 'accepted' }; } }, options);
  t.after(() => server.close());
  const challenge = await fetch(server.url, request({ type: 'url_verification', challenge: 'challenge-token' }));
  assert.equal(challenge.status, 200);
  assert.deepEqual(await challenge.json(), { challenge: 'challenge-token' });
  assert.equal((await fetch(server.url, request(envelope()))).status, 200);
  assert.deepEqual(received, [{ id: 'Ev1', conversationId: 'slack:T1:C1:123.000', text: 'Hello', source: 'slack', replyTo: '123.000' }]);
  assert.equal((await fetch(server.url, request({ ...envelope('denied'), team_id: 'T2' }))).status, 200);
  assert.equal((await fetch(server.url, request({ ...envelope('bot'), event: { ...envelope().event, bot_id: 'B1' } }))).status, 200);
  assert.equal(received.length, 1);
});

test('Slack retries deduplicate in the shared durable store, including after listener restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'palimpsest-slack-ingress-'));
  const store = new Store(join(directory, 'state.sqlite'));
  let calls = 0;
  const runtime = new AgentRuntime({ store, communications: [{ name: 'slack', send: async () => {} }], provider: { name: 'fixture', complete: async () => { calls++; return { text: 'Reply', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } } });
  const api = { submit: (input: InboundMessage) => runtime.submit(input) };
  let server = await createSlackServer(api, options);
  t.after(async () => { await server.close(); await runtime.stop(); store.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await fetch(server.url, request(envelope()))).status, 200);
  assert.equal(calls, 0, 'acknowledgement only queues, independent of inference');
  await runtime.runUntilIdle();
  await server.close();
  server = await createSlackServer(api, options);
  assert.equal((await fetch(server.url, request(envelope()))).status, 200);
  await runtime.runUntilIdle();
  assert.equal(store.listTasks().length, 1);
  assert.equal(calls, 1);
  const conflict = envelope(); conflict.event.text = 'Different body for same event';
  assert.equal((await fetch(server.url, request(conflict))).status, 503);
  assert.equal(store.listTasks().length, 1);
});

test('acknowledgement waits for durable commit and bounded uncertainty is retryable', async (t) => {
  let accepted = false; let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = () => { accepted = true; resolve(); }; });
  const server = await createSlackServer({ submit: async () => { await pending; return { id: 'later' }; } }, { ...options, ackTimeoutMs: 40 });
  t.after(async () => { finish(); await server.close(); });
  const response = await fetch(server.url, request(envelope()));
  assert.equal(response.status, 503);
  assert.equal(accepted, false);
  finish();
  assert.equal((await fetch(server.url, request(envelope()))).status, 200);
});

test('hostile HTTP/signature input never reaches durable submit or exposes secrets', async (t) => {
  let calls = 0;
  const server = await createSlackServer({ submit: async () => { calls++; throw new Error('PRIVATE_FAILURE'); } }, options);
  t.after(() => server.close());
  const invalidSignature = request(envelope()); invalidSignature.headers['x-slack-signature'] = 'v0=bad';
  assert.equal((await fetch(server.url, invalidSignature)).status, 401);
  assert.equal((await fetch(server.url, request(envelope(), '1'))).status, 401);
  assert.equal((await fetch(server.url, request('{'))).status, 400);
  assert.equal((await fetch(server.url, request('x'.repeat(70_000)))).status, 413);
  const wrongType = request(envelope()); wrongType.headers['content-type'] = 'text/plain';
  assert.equal((await fetch(server.url, wrongType)).status, 415);
  const origin = request(envelope());
  assert.equal((await fetch(server.url, { ...origin, headers: { ...origin.headers, origin: 'https://example.invalid' } })).status, 403);
  assert.equal((await fetch(server.url)).status, 404);
  assert.equal(calls, 0);
  const failed = await fetch(server.url, request(envelope()));
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('PRIVATE_FAILURE'), false);
  await assert.rejects(createSlackServer({ submit: async () => ({}) }, { ...options, host: '0.0.0.0' }), /loopback/);
});
