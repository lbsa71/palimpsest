import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { CommunicationsCore, SlackClient, SlackError, SlackIngress, SlackRecovery, SlackSocketMode, bearerAuthenticator, createDirectApi, createSpeechHandler, verifySlackSignature } from '../packages/communications/index.ts';
import type { SlackApi, SocketLike, SocketOptions } from '../packages/communications/index.ts';
import { communicationDelay, communicationTimeout } from '../packages/communications/environment.ts';
import type { CommunicationSchedule, HttpListenerFactory } from '../packages/communications/environment.ts';
import { authority, envelope } from '../packages/runtime/test/fixtures.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { assertAuthority } from '../packages/contracts/common.ts';
import type { Effect } from '../packages/contracts/execution/index.ts';

class ManualTimers {
  jobs: Array<{ ms: number; callback: () => void; cancelled: number; fired: boolean }> = [];
  setupError?: Error; cleanupError?: Error;
  readonly schedule: CommunicationSchedule;
  constructor() {
    const timers = this;
    this.schedule = function(ms, callback) {
      assert.equal(this, undefined, 'schedule callback received a receiver');
      if (timers.setupError) throw timers.setupError;
      const job = { ms, callback, cancelled: 0, fired: false }; timers.jobs.push(job);
      return { cancel() { job.cancelled++; assert.equal(job.cancelled, 1); if (timers.cleanupError) throw timers.cleanupError; } };
    };
  }
  pending(ms?: number) { return this.jobs.filter(j => !j.cancelled && !j.fired && (ms === undefined || j.ms === ms)); }
  fire(ms: number) { const job = this.pending(ms)[0]; assert.ok(job, `no pending ${ms} timer`); job.fired = true; job.callback(); }
  clean() { assert.ok(this.jobs.every(j => j.cancelled === 1), 'timer not disposed'); }
}
async function flush() { for (let n = 0; n < 24; n++) await Promise.resolve(); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-di07-'));
  const store=new OperationalStore({filename:join(root,'state.sqlite')});let runtimeId=0,effectId=0;
  const effects=new EffectJournal(store,{assert:grant=>assertAuthority(grant,authority)},{async dispatch(){throw Error('No physical effect in DI07 fixture');},async reconcile(){throw Error('No physical effect in DI07 fixture');}},()=>`effect:${++effectId}`);
  const resources=new ResourceLedger(store,{tokens:100,costUsd:1,elapsedMs:1000},()=>100000);
  const runtime=new DurableRuntime({store,effects,resources,now:()=>100000,elapsedNow:()=>0,newId:()=>`runtime:${++runtimeId}`,shell:{async run(){throw Error('No model or process in DI07 fixture');}}});
  const f={store,effects,resources,runtime};
  const scope = { kind: 'restricted' as const, principals: ['channel:C1'] };
  const core = new CommunicationsCore({ store: f.store, runtime: f.runtime, grant: () => ({ authority, resources: envelope }) });
  const ingress = new SlackIngress({ core, teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope }], eligibleHumanIds: ['U1'] });
  return { ...f, root, scope, core, ingress, close() { f.store.close(); rmSync(root, { recursive: true, force: true }); } };
}
function api(value: unknown): SlackApi { return { async call<T>() { return value as T; } }; }
class ManualSocket implements SocketLike {
  listeners = new Map<string, Set<(event:any)=>void>>(); removed: string[] = []; closes = 0; sent: string[] = [];
  closeError?: Error; addError?: string; onSend?: () => void;
  addEventListener(type: string, callback: (event:any)=>void) { if (type === this.addError) throw Error('listener registration failed'); const set = this.listeners.get(type) ?? new Set(); set.add(callback); this.listeners.set(type, set); }
  removeEventListener(type: string, callback: (event:any)=>void) { this.removed.push(type); this.listeners.get(type)?.delete(callback); }
  send(data: string) { this.onSend?.(); this.sent.push(data); }
  close() { this.closes++; if (this.closeError) throw this.closeError; }
  emit(type: string, event: any = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event); }
  envelope(event: unknown) { this.emit('message', { data: JSON.stringify(event) }); }
  clean() { assert.equal(this.closes, 1); assert.deepEqual([...this.removed].sort(), ['close', 'error', 'message']); assert.ok([...this.listeners.values()].every(s => s.size === 0)); }
}
function socketHarness(f: ReturnType<typeof fixture>, extra: Partial<SocketOptions> = {}) {
  const timers = new ManualTimers(), sockets: ManualSocket[] = []; let elapsed = 10; let opens = 0;
  const recovery = new SlackRecovery({ store: f.store, ingress: f.ingress, api: api({ messages: [] }), coverageStart: '1', lookbackSeconds: 100, retentionFloor: '1', now: () => 100000 });
  const options: SocketOptions = { botApi: api({ team_id: 'T1', user_id: 'BOT' }), appApi: { async call<T>() { opens++; return { url: 'wss://wss.slack.com/synthetic' } as T; } }, ingress: f.ingress, recovery,
    socket: function() { assert.equal(this, undefined); const socket = new ManualSocket(); sockets.push(socket); return socket; }, schedule: timers.schedule,
    monotonicNow: function() { assert.equal(this, undefined); return elapsed; }, reconnectMinMs: 5, reconnectMaxMs: 20, recoveryIntervalMs: 1000, ...extra };
  const mode = new SlackSocketMode(options);
  return { mode, options, timers, sockets, recovery, elapsed(value: number) { elapsed = value; }, opens() { return opens; } };
}

test('two Slack clients capture independent receiver-free transports and timeout schedulers', async () => {
  const timersA = new ManualTimers(), timersB = new ManualTimers(); const seen: string[] = [];
  const options = { token: 'a', schedule: timersA.schedule, timeoutMs: 77, fetch: async function(this: unknown, _url: unknown, init?: RequestInit) { assert.equal(this, undefined); seen.push(new Headers(init?.headers).get('authorization')!); return Response.json({ ok: true, value: 'a' }); } as typeof fetch };
  const a = new SlackClient(options), b = new SlackClient({ token: 'b', schedule: timersB.schedule, timeoutMs: 99, fetch: async function(this: unknown) { assert.equal(this, undefined); return Response.json({ ok: true, value: 'b' }); } as typeof fetch });
  options.fetch = async () => { throw Error('mutated transport'); }; options.schedule = () => { throw Error('mutated timer'); };
  assert.equal((await a.call<{ value: string }>('auth.test', {})).value, 'a'); assert.equal((await b.call<{ value: string }>('auth.test', {})).value, 'b');
  assert.deepEqual(seen, ['Bearer a']); assert.deepEqual(timersA.jobs.map(j => j.ms), [77]); assert.deepEqual(timersB.jobs.map(j => j.ms), [99]); timersA.clean(); timersB.clean();
});
test('Slack timeout and caller abort dispose timers and caller listeners without retries', async () => {
  for (const source of ['timer', 'caller'] as const) {
    const timers = new ManualTimers(), parent = new AbortController(); let calls = 0;
    const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, timeoutMs: 8, fetch: async (_url, init) => { calls++; return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })); } });
    const operation = client.call('chat.postMessage', {}, parent.signal); const rejection = assert.rejects(operation, source === 'timer' ? /timeout/ : /cancel/);
    if (source === 'timer') timers.fire(8); else parent.abort(Error('cancel'));
    await rejection; assert.equal(calls, 1); assert.equal(getEventListeners(parent.signal, 'abort').length, 0); timers.clean();
  }
});
test('pre-aborted Slack dispatch and invalid timeout never construct timer or send', async () => {
  const timers = new ManualTimers(); let calls = 0; const parent = new AbortController(); parent.abort(Error('before dispatch'));
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => { calls++; return Response.json({ ok: true }); } });
  await assert.rejects(client.call('auth.test', {}, parent.signal), /before dispatch/);
  await assert.rejects(new SlackClient({ token: 'fixture', schedule: timers.schedule, timeoutMs: Infinity, fetch: client.fetch }).call('auth.test', {}), /timer delay/);
  assert.equal(calls, 0); assert.equal(timers.jobs.length, 0);
});
test('timeout setup and cleanup failures stay observable; API rejection and response byte cap dispose timer', async () => {
  const setup = new ManualTimers(); setup.setupError = Error('timer setup failed'); let calls = 0;
  const client = new SlackClient({ token: 'fixture', schedule: setup.schedule, fetch: async () => { calls++; return Response.json({ ok: true }); } });
  await assert.rejects(client.call('auth.test', {}), /timer setup failed/); assert.equal(calls, 0);
  const cleanup = new ManualTimers(); cleanup.cleanupError = Error('timer cleanup failed');
  await assert.rejects(new SlackClient({ token: 'fixture', schedule: cleanup.schedule, fetch: async () => Response.json({ ok: true }) }).call('auth.test', {}), /timer cleanup failed/); cleanup.clean();
  const timers = new ManualTimers(); const rejected = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => new Response('{}', { status: 429, headers: { 'retry-after': '3' } }) });
  await assert.rejects(rejected.call('auth.test', {}), (error: unknown) => error instanceof SlackError && error.retryAfterMs === 3000);
  await assert.rejects(new SlackClient({ token: 'fixture', schedule: timers.schedule, maxResponseBytes: 16, fetch: async () => Response.json({ ok: true, text: 'x'.repeat(100) }) }).call('conversations.history', {}), /byte bound/); timers.clean();
});
test('response reader cancellation failure retains both read and cleanup failures', async () => {
  const timers = new ManualTimers(); let releases = 0;
  const response = { ok: true, status: 200, body: { getReader() { return { async read() { throw Error('read failed'); }, async cancel() { throw Error('reader cancellation failed'); }, releaseLock() { releases++; } }; } } } as unknown as Response;
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => response });
  await assert.rejects(client.call('auth.test', {}), (error: unknown) => error instanceof AggregateError && error.errors.map(e => e.message).join('|') === 'read failed|reader cancellation failed');
  assert.equal(releases, 1); timers.clean();
});
test('cancelable delay fires only explicitly, aborts once, and removes its listener', async () => {
  for (const cancel of [false, true]) {
    const timers = new ManualTimers(), signal = new AbortController(); let finished = false;
    const wait = communicationDelay(timers.schedule, 4, signal.signal).then(() => { finished = true; });
    const observed = cancel ? assert.rejects(wait, /stop/) : wait;
    await flush(); assert.equal(finished, false); assert.equal(getEventListeners(signal.signal, 'abort').length, 1);
    if (cancel) signal.abort(Error('stop')); else timers.fire(4);
    await observed; assert.equal(finished, !cancel); assert.equal(getEventListeners(signal.signal, 'abort').length, 0); timers.clean();
  }
});
test('delay setup and cleanup failures remove abort listeners and timeout cancellation is idempotent', async () => {
  const signal = new AbortController(), timers = new ManualTimers(); timers.setupError = Error('setup');
  await assert.rejects(communicationDelay(timers.schedule, 1, signal.signal), /setup/); assert.equal(getEventListeners(signal.signal, 'abort').length, 0);
  timers.setupError = undefined; timers.cleanupError = Error('cleanup'); const wait = communicationDelay(timers.schedule, 1, signal.signal); timers.fire(1);
  await assert.rejects(wait, /cleanup/); assert.equal(getEventListeners(signal.signal, 'abort').length, 0); timers.clean();
  const clean = new ManualTimers(), timeout = communicationTimeout(clean.schedule, 2, signal.signal); timeout.cancel(); timeout.cancel(); clean.clean(); assert.equal(getEventListeners(signal.signal, 'abort').length, 0);
});
test('Socket Mode reconnect backoff is capped and resets after injected 30 second connection', async () => {
  const f = fixture(), h = socketHarness(f);
  try {
    h.mode.start(); await flush();
    for (const delay of [5, 10, 20]) { h.sockets.at(-1)!.emit('close'); await flush(); assert.equal(h.timers.pending(delay).length, 1); h.timers.fire(delay); await flush(); }
    h.elapsed(30010); h.sockets.at(-1)!.emit('close'); await flush(); assert.equal(h.timers.pending(5).length, 1); assert.equal(h.opens(), 4);
    await h.mode.stop(); for (const socket of h.sockets) socket.clean(); h.timers.clean();
  } finally { await h.mode.stop(); f.close(); }
});
test('Socket Mode durably admits before ACK, rejects bad intake, and retained callbacks are inert after close', async () => {
  const f = fixture(), errors: string[] = [], h = socketHarness(f, { onError: kind => errors.push(kind) });
  try {
    h.mode.start(); await flush(); const socket = h.sockets[0]!; const callback = [...socket.listeners.get('message')!][0]!;
    socket.onSend = () => assert.equal(f.store.list('communications.inputs').length, 1);
    const payload = { type: 'events_api', envelope_id: 'durable', payload: { team_id: 'T1', event: { type: 'app_mention', channel: 'C1', ts: '50', user: 'U1', text: '<@BOT> work' } } };
    socket.envelope(payload); assert.equal(socket.sent.length, 1);
    socket.envelope({ ...payload, envelope_id: 'must-not-ack', payload: { ...payload.payload, event: { ...payload.payload.event, text: 'conflicting' } } });
    assert.equal(socket.sent.length, 1); assert.deepEqual(errors, ['socket_intake_rejected']);
    await h.mode.stop(); socket.clean(); callback({ data: JSON.stringify(payload) }); assert.equal(socket.sent.length, 1); h.timers.clean();
    await h.mode.stop(); assert.equal(socket.closes, 1);
  } finally { await h.mode.stop(); f.close(); }
});
test('authenticated link rejection never constructs socket; supplied callback captured once', async () => {
  const f = fixture(), errors: string[] = [], h = socketHarness(f, { botApi: api({ team_id: 'FOREIGN', user_id: 'BOT' }), onError: kind => errors.push(kind) });
  h.options.onError = () => { throw Error('mutated callback'); };
  try { h.mode.start(); await flush(); assert.equal(h.opens(), 0); assert.equal(h.sockets.length, 0); assert.deepEqual(errors, ['socket_connection_failed']); await h.mode.stop(); h.timers.clean(); }
  finally { await h.mode.stop(); f.close(); }
});
test('two Socket Mode instances retain independent clocks, transports and timers', async () => {
  const a = fixture(), b = fixture(), x = socketHarness(a), y = socketHarness(b);
  try { x.mode.start(); y.mode.start(); await flush(); x.elapsed(40000); x.sockets[0]!.emit('close'); y.sockets[0]!.emit('close'); await flush();
    x.timers.fire(5); y.timers.fire(5); await flush(); x.elapsed(80000); x.sockets[1]!.emit('close'); y.sockets[1]!.emit('close'); await flush();
    assert.equal(x.timers.pending(5).length, 1); assert.equal(y.timers.pending(10).length, 1); await x.mode.stop(); assert.equal(y.sockets[1]!.closes, 1); assert.equal(y.timers.pending().length, 2); await y.mode.stop(); x.timers.clean(); y.timers.clean();
  } finally { await x.mode.stop(); await y.mode.stop(); a.close(); b.close(); }
});
test('socket close failure and error callback failure drain recovery timers and remain observable at stop', async () => {
  for (const stage of ['close', 'callback']) {
    const f = fixture(), h = socketHarness(f, { onError() { if (stage === 'callback') throw Error('callback failed'); } });
    try { h.mode.start(); await flush(); const socket = h.sockets[0]!;
      if (stage === 'close') { socket.closeError = Error('close failed'); socket.emit('close'); } else socket.envelope({ type: 'events_api', envelope_id: 'malformed' });
      await flush(); await assert.rejects(h.mode.stop(), (error: unknown) => error instanceof Error && error.message === 'communications lifecycle failure'); socket.clean(); h.timers.clean();
    } finally { await h.mode.stop(); f.close(); }
  }
});
test('socket listener registration failure cleans attached listeners and never ACKs', async () => {
  const f = fixture(), socket = new ManualSocket(); socket.addError = 'message'; const errors: string[] = [];
  const h = socketHarness(f, { socket: () => socket, onError: kind => errors.push(kind) });
  try { h.mode.start(); await flush(); socket.clean(); assert.deepEqual(errors, ['socket_connection_failed']); assert.equal(socket.sent.length, 0); await h.mode.stop(); h.timers.clean(); }
  finally { await h.mode.stop(); f.close(); }
});
test('clock regression and timer cleanup failures terminate both loops without leaking socket', async () => {
  for (const stage of ['clock', 'timer']) {
    const f = fixture(), h = socketHarness(f);
    try { h.mode.start(); await flush(); if (stage === 'clock') { h.elapsed(9); h.sockets[0]!.emit('close'); } else { h.timers.cleanupError = Error('timer cleanup failed'); }
      await flush(); await assert.rejects(h.mode.stop(), stage === 'clock' ? /regressed/ : /timer cleanup failed/); h.sockets[0]!.clean(); h.timers.clean();
    } finally { await h.mode.stop(); f.close(); }
  }
});
test('recovery captures independent clocks and rate-limit deadlines while preserving paginated backfill after restart', async () => {
  const f = fixture(); let wall = 100000, count = 0; const calls: Array<[string, Record<string,string>]> = [];
  const history: SlackApi = { async call<T>(method: string, parameters: Record<string,string>) { calls.push([method, parameters]); count++; if (count === 1) throw new SlackError('ratelimited', 5000);
    return (count === 2 ? { messages: [{ ts: '80', user: 'U1', text: '<@BOT> first offline', reply_count: 1 }], response_metadata: { next_cursor: 'next' } } : method === 'conversations.replies' ? { messages: [{ ts: '81', thread_ts: '80', user: 'U2', text: 'missed followup' }] } : { messages: [] }) as T; } };
  const options = { store: f.store, ingress: f.ingress, api: history, coverageStart: '1', lookbackSeconds: 100, retentionFloor: '1', maxPagesPerTick: 1, now: function() { assert.equal(this, undefined); return wall; } };
  const first = new SlackRecovery(options); options.now = () => { throw Error('changed clock'); }; history.call = async () => { throw Error('changed API'); };
  try { assert.equal((await first.tick()).retryAt, 105000); wall = 104999; assert.equal((await first.tick()).pages, 0); assert.equal(calls.length, 1); wall = 105000;
    assert.equal((await first.tick()).pages, 1); assert.equal(first.state().cycle!.current!.cursor, 'next');
    // A newly composed recovery uses its own explicit API and wall time, while resuming durable cursor/window.
    const resumed = new SlackRecovery({ ...options, api: { call: async function<T>(method: string, parameters: Record<string,string>) { calls.push([method, parameters]); return { messages: method === 'conversations.replies' ? [{ ts: '81', thread_ts: '80', user: 'U2', text: 'missed followup' }] : [] } as T; } }, now: () => 900000 });
    for (let i = 0; i < 4; i++) if ((await resumed.tick()).complete) break;
    assert.equal(resumed.state().lastCompleted, '100'); assert.equal(calls[2]![1].cursor, 'next'); assert.ok(calls.every(c => c[1].latest === '100')); assert.equal(f.store.list('runs').length, 1); const run = f.store.list<{id:string}>('runs')[0]!.value;
    assert.equal(f.store.events(run.id).filter(e => e.type === 'steering').length, 1); assert.equal(first.state().gaps.length, 0);
  } finally { f.close(); }
});
test('recovery rejects failed/invalid clock before mutation and releases the ticking latch', async () => {
  const f = fixture(); let fail = true, wall = NaN; let calls = 0;
  const r = new SlackRecovery({ store: f.store, ingress: f.ingress, api: { async call<T>() { calls++; return { messages: [] } as T; } }, coverageStart: '1', lookbackSeconds: 100, now: () => { if (fail) throw Error('clock failed'); return wall; } });
  try { await assert.rejects(r.tick(), /clock failed/); fail = false; await assert.rejects(r.tick(), /wall clock/); assert.deepEqual(r.state(), { gaps: [] }); assert.equal(calls, 0); wall = 100000; assert.equal((await r.tick()).complete, true); }
  finally { f.close(); }
});
test('aborted recovery API failure retains current page without manufacturing a gap or retry', async () => {
  const f = fixture(), controller = new AbortController(); let entered!: () => void, reject!: (error: unknown) => void;
  const entry = new Promise<void>(resolve => { entered = resolve; });
  const r = new SlackRecovery({ store: f.store, ingress: f.ingress, api: { async call<T>() { entered(); return await new Promise<T>((_resolve, fail) => { reject = fail; }); } }, coverageStart: '1', lookbackSeconds: 100, retentionFloor: '1', now: () => 100000 });
  try { const ticking = r.tick(controller.signal); const rejection = assert.rejects(ticking, /cancelled/); await entry; const before = r.state(); controller.abort(Error('cancelled')); reject(controller.signal.reason); await rejection; assert.deepEqual(r.state(), before); assert.equal(r.state().retryAt, undefined); }
  finally { f.close(); }
});
test('signature verifier uses supplied wall clock and preserves replay/body authentication checks', () => {
  const body = '{"fixture":true}', timestamp = '100', secret = 'fixture'; const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  assert.equal(verifySlackSignature({ body, timestamp, secret, signature, now: function() { assert.equal(this, undefined); return 100000; } }), true);
  assert.equal(verifySlackSignature({ body: body + ' ', timestamp, secret, signature, now: () => 100000 }), false);
  assert.equal(verifySlackSignature({ body, timestamp, secret, signature, now: () => 500000 }), false);
  assert.throws(() => verifySlackSignature({ body, timestamp, secret, signature, now: () => { throw Error('wall failed'); } }), /wall failed/);
});

test('injected HTTP listener routes authenticated bounded inputs and denies privileged or foreign output access', async () => {
  const f = fixture(); const actor = { id: 'owner', scope: f.scope, modificationEligible: true }, foreign = { ...actor, id: 'other', scope: { kind: 'restricted' as const, principals: ['other'] } };
  let handler!: Parameters<HttpListenerFactory>[0]; const listener = {} as Server; let outputReads = 0;
  const options = { core: f.core, authenticate: bearerAuthenticator([{ token: 'owner', principal: actor }, { token: 'foreign', principal: foreign }]), maxBodyBytes: 200, health: function() { assert.equal(this, undefined); return { alive: true }; }, outputForRun: function() { assert.equal(this, undefined); outputReads++; return ['explicit output']; }, createListener: function(callback: Parameters<HttpListenerFactory>[0]) { assert.equal(this, undefined); handler = callback; return listener; } };
  assert.equal(createDirectApi(options), listener); options.authenticate = () => { throw Error('changed authentication'); }; options.health = () => { throw Error('changed health'); };
  async function request(method: string, url: string, value?: unknown, token = 'owner') {
    const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]) as unknown as IncomingMessage; req.method = method; req.url = url; req.headers = { authorization: `Bearer ${token}` };
    return await new Promise<{ status: number; value: any }>(resolve => { let status = 0; const response = { headersSent: false, writeHead(code: number) { status = code; (this as {headersSent: boolean}).headersSent = true; }, end(bytes: string) { resolve({ status, value: JSON.parse(bytes) }); } } as unknown as ServerResponse; handler(req, response); });
  }
  try { assert.equal((await request('GET', '/health', undefined, 'wrong')).status, 401); assert.deepEqual((await request('GET', '/health')).value, { alive: true });
    const input = { externalId: 'x', revision: '1', conversation: 'x', text: 'hello' }; assert.equal((await request('POST', '/inputs', { ...input, authority })).status, 400); assert.equal((await request('POST', '/inputs', { ...input, text: 'x'.repeat(1000) })).status, 400);
    const admitted = await request('POST', '/inputs', input); assert.equal(admitted.status, 202); const runId = admitted.value.run.id;
    assert.equal((await request('GET', `/runs/${runId}/output`, undefined, 'foreign')).status, 400); assert.equal(outputReads, 0); assert.deepEqual((await request('GET', `/runs/${runId}/output`)).value, ['explicit output']); assert.equal(outputReads, 1);
    assert.equal((await request('POST', '/inputs', { externalId: 'stop', revision: '1', conversation: 'x', text: 'stop', targetRunId: runId, control: 'cancel' })).status, 202); assert.equal(f.runtime.getRun(runId)?.status, 'cancelled');
  } finally { f.close(); }
});
test('HTTP listener constructor failure propagates before any admission', () => {
  const f = fixture(); try { assert.throws(() => createDirectApi({ core: f.core, authenticate: () => { throw Error('must not authenticate'); }, createListener: () => { throw Error('listener unavailable'); } }), /listener unavailable/); assert.equal(f.store.list('runs').length, 0); } finally { f.close(); }
});
test('injected Slack transport lost send remains uncertain and reconciles without resend', async () => {
  const f = fixture(), timers = new ManualTimers(); let posts = 0, clientId = '';
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async (url, init) => { const args = new URLSearchParams(init!.body as URLSearchParams); if (String(url).endsWith('chat.postMessage')) { posts++; clientId = args.get('client_msg_id')!; throw Error('lost receipt'); } return Response.json({ ok: true, messages: [{ ts: '100', user: 'BOT', client_msg_id: clientId }] }); } });
  const speech = createSpeechHandler({ store: f.store, fence: f.effects.fence, api: client, botUserId: 'BOT', grants: [{ channel: 'C1', scope: f.scope }] });
  const effect: Effect = { id: 'lost', runId: 'r', stepId: 's', kind: 'speech.send', payload: { channel: 'C1', text: 'report' }, scope: f.scope, authority, status: 'pending', revision: 0 };
  try { assert.equal((await speech.dispatch(effect)).outcome, 'uncertain'); assert.equal((await speech.reconcile({ ...effect, status: 'uncertain' })).outcome, 'succeeded'); assert.equal(posts, 1); timers.clean(); }
  finally { f.close(); }
});

test('recovery clock failure during multi-channel gap setup atomically rolls back prior gap events', async () => {
  const f = fixture(); let calls = 0;
  const ingress = new SlackIngress({ ...f.ingress.options, channels: [{ channel: 'C1', scope: f.scope }, { channel: 'C2', scope: f.scope }] });
  const r = new SlackRecovery({ store: f.store, ingress, api: api({ messages: [] }), coverageStart: '1', lookbackSeconds: 100, now: () => { if (++calls === 3) throw Error('second gap clock failed'); return 100000; } });
  try { const before = f.store.events('communications'); await assert.rejects(r.tick(), /second gap clock failed/); assert.deepEqual(r.state(), { gaps: [] }); assert.deepEqual(f.store.events('communications'), before); assert.equal((await r.tick()).complete, true); assert.equal(r.state().gaps.length, 2); }
  finally { f.close(); }
});
test('pre-aborted recovery never samples time, writes a scan, or dispatches history', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(Error('pre-abort'));
  const r = new SlackRecovery({ store: f.store, ingress: f.ingress, api: { async call() { throw Error('history must not dispatch'); } }, coverageStart: '1', lookbackSeconds: 100, now: () => { throw Error('time must not sample'); } });
  try { await assert.rejects(r.tick(controller.signal), /pre-abort/); assert.deepEqual(r.state(), { gaps: [] }); assert.equal(f.store.events('communications').length, 0); } finally { f.close(); }
});
test('recovery transport completing after cancellation cannot admit a returned message or advance cursor', async () => {
  const f = fixture(), controller = new AbortController(); let resolve!: (page: any) => void;
  const r = new SlackRecovery({ store: f.store, ingress: f.ingress, api: { async call<T>() { return await new Promise<T>(done => { resolve = done; }); } }, coverageStart: '1', lookbackSeconds: 100, retentionFloor: '1', now: () => 100000 });
  try { const pending = r.tick(controller.signal), rejected = assert.rejects(pending, /cancel page/); const before = r.state(); controller.abort(Error('cancel page')); resolve({ messages: [{ ts: '50', user: 'U1', text: '<@BOT> too late' }], response_metadata: { next_cursor: 'must-not-advance' } }); await rejected; assert.deepEqual(r.state(), before); assert.equal(f.store.list('runs').length, 0); } finally { f.close(); }
});
test('timer setup failure terminates socket and recovery loops and closes any constructed socket once', async () => {
  const f = fixture(), h = socketHarness(f); h.timers.setupError = Error('background timer setup failed');
  try { h.mode.start(); await flush(); await assert.rejects(h.mode.stop(), /background timer setup failed/); for (const socket of h.sockets) assert.equal(socket.closes, 1); assert.equal(h.timers.jobs.length, 0); }
  finally { await h.mode.stop(); f.close(); }
});
test('request and timer cleanup failures retain both causes', async () => {
  const timers = new ManualTimers(); timers.cleanupError = Error('cancel failed');
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => { throw Error('transport failed'); } });
  await assert.rejects(client.call('chat.postMessage', {}), (error: unknown) => error instanceof AggregateError && error.errors.map(e => e.message).join('|') === 'transport failed|cancel failed'); timers.clean();
});

test('socket listener removal failure still attempts every removal and exactly one close', async () => {
  class FailingRemovalSocket extends ManualSocket {
    override removeEventListener(type: string, callback: (event:any)=>void) { super.removeEventListener(type, callback); if (type === 'close') throw Error('remove failed'); }
  }
  const f = fixture(), socket = new FailingRemovalSocket(), h = socketHarness(f, { socket: () => socket });
  try { h.mode.start(); await flush(); await assert.rejects(h.mode.stop(), (error: unknown) => error instanceof Error && error.message === 'communications lifecycle failure'); socket.clean(); h.timers.clean(); }
  finally { await h.mode.stop(); f.close(); }
});
test('transport ignoring caller cancellation cannot manufacture a successful Slack response', async () => {
  const timers = new ManualTimers(), controller = new AbortController(); let complete!: (response: Response) => void;
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => await new Promise<Response>(resolve => { complete = resolve; }) });
  const pending = client.call('chat.postMessage', {}, controller.signal), rejected = assert.rejects(pending, /cancel before response/);
  controller.abort(Error('cancel before response')); complete(Response.json({ ok: true })); await rejected; assert.equal(getEventListeners(controller.signal, 'abort').length, 0); timers.clean();
});
