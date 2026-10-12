import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { CommunicationsCore, SlackClient, SlackError, SlackIngress, SlackRecovery, SlackSocketMode, createDirectApi, bearerAuthenticator } from '../packages/communications/index.ts';
import type { SlackApi, SocketLike } from '../packages/communications/index.ts';
import type { CommunicationSchedule, HttpListenerFactory } from '../packages/communications/environment.ts';
import { communicationDelay, communicationTimeout } from '../packages/communications/environment.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { assertAuthority } from '../packages/contracts/common.ts';
import { authority, envelope } from '../packages/runtime/test/fixtures.ts';

class Timers {
  jobs: Array<{ ms: number; fire: () => void; cancellations: number }> = [];
  readonly schedule: CommunicationSchedule = (ms, fire) => {
    const job = { ms, fire, cancellations: 0 }; this.jobs.push(job);
    return { cancel() { job.cancellations++; } };
  };
  clean() { assert.ok(this.jobs.every(job => job.cancellations === 1)); }
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'di07-heldout-'));
  const filename = join(directory, 'state.sqlite');
  let store = new OperationalStore({ filename });
  const scope = { kind: 'restricted' as const, principals: ['channel:C1'] };
  function compose() {
    let id = 0;
    const effects = new EffectJournal(store, { assert: value => assertAuthority(value, authority) }, {
      async dispatch() { throw Error('no external effects'); }, async reconcile() { throw Error('no external effects'); },
    }, () => `effect:${++id}`);
    const resources = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 1000 }, () => 100000);
    const runtime = new DurableRuntime({ store, effects, resources, now: () => 100000, elapsedNow: () => 0, newId: () => `runtime:${++id}`, shell: { async run() { throw Error('no model'); } } });
    const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources: envelope }) });
    const ingress = new SlackIngress({ core, teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope }], eligibleHumanIds: ['U1'] });
    return { core, ingress, runtime };
  }
  return { ...compose(), scope, filename, get store() { return store; },
    reopen() { store.close(); store = new OperationalStore({ filename }); return compose(); },
    close() { store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
const emptyApi: SlackApi = { async call<T>() { return { messages: [] } as T; } };
function recovery(f: ReturnType<typeof fixture>, api: SlackApi = emptyApi, now = () => 100000, ingress = f.ingress) {
  return new SlackRecovery({ store: f.store, ingress, api, now, coverageStart: '1', lookbackSeconds: 100, retentionFloor: '1', maxPagesPerTick: 1, pageSize: 2 });
}
class Socket implements SocketLike {
  callbacks = new Map<string, (event: any) => void>();
  trace: string[] = []; acks: string[] = [];
  duringAdd?: (type: string) => void;
  beforeSend?: () => void;
  addEventListener(type: string, callback: (event: any) => void) { this.trace.push(`add:${type}`); this.callbacks.set(type, callback); this.duringAdd?.(type); }
  removeEventListener(type: string, _callback: (event: any) => void) { this.trace.push(`remove:${type}`); this.callbacks.delete(type); }
  close() { this.trace.push('close'); this.callbacks.get('close')?.({}); }
  send(bytes: string) { this.beforeSend?.(); this.acks.push(bytes); }
  emit(type: string, value: any = {}) { this.callbacks.get(type)?.(value); }
  message(envelope: unknown) { this.emit('message', { data: JSON.stringify(envelope) }); }
}
function mode(f: ReturnType<typeof fixture>, socket: Socket, timers: Timers, extra: Partial<ConstructorParameters<typeof SlackSocketMode>[0]> = {}) {
  return new SlackSocketMode({ ingress: f.ingress, recovery: recovery(f), botApi: { async call<T>() { return { team_id: 'T1', user_id: 'BOT' } as T; } }, appApi: { async call<T>() { return { url: 'wss://edge.slack.com/fixture' } as T; } }, socket: () => socket, schedule: timers.schedule, monotonicNow: () => 0, reconnectMinMs: 5, reconnectMaxMs: 10, recoveryIntervalMs: 1000, ...extra });
}
function mention(id = '50') { return { type: 'events_api', envelope_id: `envelope:${id}`, payload: { team_id: 'T1', event: { type: 'app_mention', channel: 'C1', ts: id, user: 'U1', text: '<@BOT> recover this' } } }; }
function contains(error: unknown, target: unknown): boolean {
  return error === target || error instanceof AggregateError && error.errors.some(value => contains(value, target)) || error instanceof Error && contains(error.cause, target);
}

for (const status of [429, 503]) test(`heldout rejected HTTP ${status} disposes the real response stream before request settlement`, async () => {
  const timers = new Timers(); let cancelled = 0, dispatched = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => { dispatched++; return new Response(body, { status, headers: { 'retry-after': '2' } }); } });
  try {
    await assert.rejects(client.call('conversations.history', {}), (error: unknown) => error instanceof SlackError && error.code === (status === 429 ? 'ratelimited' : 'http_503'));
    assert.equal(dispatched, 1); timers.clean();
    assert.equal(cancelled, 1, 'rejected response remains unread and uncancelled');
  } finally { if (!cancelled) await body.cancel(); }
});

test('heldout response arriving after caller abort is disposed without consuming its body', async () => {
  const timers = new Timers(), controller = new AbortController(); let cancelled = 0, resolve!: (value: Response) => void;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => await new Promise<Response>(done => { resolve = done; }) });
  const reason = Error('cancel while transport pending');
  try {
    const pending = client.call('chat.postMessage', {}, controller.signal); controller.abort(reason); resolve(new Response(body));
    await assert.rejects(pending, error => error === reason); timers.clean(); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(cancelled, 1, 'late transport response leaked its body');
  } finally { if (!cancelled) await body.cancel(); }
});

test('heldout reader unlock failure preserves original read and cancellation failures', async () => {
  const timers = new Timers(), read = Error('read failed'), cancel = Error('cancel failed'), unlock = Error('unlock failed');
  const trace: string[] = [];
  const response = { status: 200, ok: true, body: { getReader() { return {
    async read() { trace.push('read'); throw read; }, async cancel() { trace.push('cancel'); throw cancel; }, releaseLock() { trace.push('unlock'); throw unlock; },
  }; } } } as unknown as Response;
  const client = new SlackClient({ token: 'fixture', schedule: timers.schedule, fetch: async () => response });
  const observed = await client.call('auth.test', {}).then(() => assert.fail('must reject'), error => error as unknown);
  assert.deepEqual(trace, ['read', 'cancel', 'unlock']); timers.clean();
  assert.ok(contains(observed, read), 'original read failure lost'); assert.ok(contains(observed, cancel), 'cancellation failure lost'); assert.ok(contains(observed, unlock));
});

test('heldout byte-bound stream failure cancels and unlocks once and retains timer cleanup failure', async () => {
  const cleanup = Error('timer cancellation failed'); let cancels = 0, unlocks = 0, timerCancels = 0;
  const response = { status: 200, ok: true, body: { getReader() { return { async read() { return { value: new Uint8Array(5), done: false }; }, async cancel() { cancels++; }, releaseLock() { unlocks++; } }; } } } as unknown as Response;
  const client = new SlackClient({ token: 'fixture', maxResponseBytes: 4, schedule: () => ({ cancel() { timerCancels++; throw cleanup; } }), fetch: async () => response });
  await assert.rejects(client.call('auth.test', {}), (error: unknown) => error instanceof AggregateError && contains(error, cleanup) && error.errors.some(value => value instanceof Error && /byte bound/.test(value.message)));
  assert.deepEqual([cancels, unlocks, timerCancels], [1, 1, 1]);
});

test('heldout delay abort plus cleanup preserves non-Error reason and removes listener', async () => {
  const controller = new AbortController(), reason = { cancelled: true }, cleanup = { cleanup: true }; let cancels = 0;
  const pending = communicationDelay(() => ({ cancel() { cancels++; throw cleanup; } }), 4, controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error instanceof AggregateError && contains(error, reason) && contains(error, cleanup));
  assert.equal(cancels, 1); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('heldout timeout captures cancel identity and detaches parent even when cancellation throws', () => {
  const parent = new AbortController(), failure = Error('cancel once'); let cancels = 0;
  const handle = { cancel() { cancels++; throw failure; } };
  const timeout = communicationTimeout(() => handle, 4, parent.signal);
  handle.cancel = () => assert.fail('mutated cancellation');
  assert.throws(() => timeout.cancel(), error => error === failure); timeout.cancel();
  parent.abort(Error('too late')); assert.equal(timeout.signal.aborted, false); assert.equal(cancels, 1); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('heldout ACK observes committed intake through a second SQLite connection and write failure never ACKs', async () => {
  const f = fixture(), timers = new Timers(), socket = new Socket(), errors: string[] = [];
  const observer = new OperationalStore({ filename: f.filename }), control = new DatabaseSync(f.filename);
  const worker = mode(f, socket, timers, { onError: value => errors.push(value) });
  try {
    worker.start(); await flush();
    socket.beforeSend = () => assert.equal(observer.list('communications.inputs').length, 1, 'ACK before commit');
    socket.message(mention()); assert.equal(socket.acks.length, 1); assert.equal(observer.list('runs').length, 1);
    control.exec("CREATE TRIGGER refuse_intake BEFORE INSERT ON documents WHEN NEW.namespace='communications.inputs' BEGIN SELECT RAISE(ABORT,'controlled intake failure'); END");
    socket.message(mention('51')); assert.equal(socket.acks.length, 1); assert.deepEqual(errors, ['socket_intake_rejected']);
    assert.equal(observer.list('communications.inputs').length, 1); assert.equal(observer.list('runs').length, 1); assert.equal(observer.list('communications.slack.threads').length, 1);
  } finally { await worker.stop(); control.close(); observer.close(); f.close(); }
  timers.clean(); assert.equal(socket.trace.filter(value => value === 'close').length, 1);
});

test('heldout synchronous socket close during registration cannot attach further listeners or ACK retained messages', async () => {
  const f = fixture(), timers = new Timers(), socket = new Socket();
  socket.duringAdd = type => { if (type === 'close') socket.emit('close'); };
  const worker = mode(f, socket, timers);
  try {
    worker.start(); await flush(); assert.deepEqual(socket.trace, ['add:close', 'remove:close', 'close']);
    socket.message(mention()); assert.equal(f.store.list('runs').length, 0); assert.equal(socket.acks.length, 0);
  } finally { await worker.stop(); f.close(); }
  timers.clean(); assert.equal(socket.trace.filter(value => value === 'close').length, 1);
});

test('heldout nonfinite connection clock drains recovery without socket construction or hidden fallback', async () => {
  for (const value of [NaN, Infinity, -1]) {
    const f = fixture(), timers = new Timers(), socket = new Socket();
    const worker = mode(f, socket, timers, { monotonicNow: () => value });
    try { worker.start(); await flush(); await assert.rejects(worker.stop(), error => error instanceof Error && error.cause instanceof Error && /monotonic clock/.test(error.cause.message)); assert.deepEqual(socket.trace, []); timers.clean(); }
    finally { await worker.stop(); f.close(); }
  }
});

test('heldout history page clock fault rolls back page gap and admission then permits the exact same page', async () => {
  const f = fixture(); let wall = 100000, calls = 0;
  const api: SlackApi = { async call<T>() { calls++; wall = NaN; return { messages: [{ ts: '50', user: 'U1', text: '<@BOT> held out' }], is_limited: true, response_metadata: { next_cursor: 'next' } } as T; } };
  const r = recovery(f, api, () => wall);
  try {
    await assert.rejects(r.tick(), /wall clock/); const state = r.state();
    assert.equal(state.cycle!.current!.cursor, ''); assert.equal(state.gaps.length, 0); assert.equal(f.store.list('runs').length, 0); assert.equal(f.store.events('communications').length, 0); assert.equal(calls, 1);
    const resumed = recovery(f, { async call<T>() { return { messages: [{ ts: '50', user: 'U1', text: '<@BOT> held out' }], response_metadata: { next_cursor: 'next' } } as T; } }, () => 200000);
    assert.equal((await resumed.tick()).pages, 1); assert.equal(resumed.state().cycle!.latest, '100'); assert.equal(resumed.state().cycle!.current!.cursor, 'next'); assert.equal(f.store.list('runs').length, 1);
  } finally { f.close(); }
});

test('heldout durable retry deadline and bounded cursor survive Store reopen and wall rollback', async () => {
  const f = fixture(); let wall = 100000, calls = 0; const requests: Record<string, string>[] = [];
  const api: SlackApi = { async call<T>(_method: string, parameters: Record<string, string>) { requests.push(parameters); if (++calls === 1) return { messages: [], response_metadata: { next_cursor: 'page2' } } as T; throw new SlackError('ratelimited', 5000); } };
  const r = recovery(f, api, () => wall);
  try {
    assert.equal((await r.tick()).pages, 1); assert.equal((await r.tick()).retryAt, 105000);
    const saved = r.state(); const reopened = f.reopen(); let resumedCalls = 0;
    const next = recovery(f, { async call<T>(_method: string, parameters: Record<string, string>) { resumedCalls++; requests.push(parameters); return { messages: [] } as T; } }, () => wall, reopened.ingress);
    for (wall of [50000, 104999]) { assert.equal((await next.tick()).retryAt, 105000); assert.deepEqual(next.state(), saved); }
    assert.equal(resumedCalls, 0); wall = 105000; assert.equal((await next.tick()).pages, 1); assert.equal(resumedCalls, 1);
    assert.deepEqual(requests.map(value => [value.oldest, value.latest, value.limit, value.cursor ?? '']), [['1', '100', '2', ''], ['1', '100', '2', 'page2'], ['1', '100', '2', 'page2']]);
  } finally { f.close(); }
});

test('heldout concurrent recovery tick rejection does not release the first invocation latch', async () => {
  const f = fixture(); let complete!: (page: unknown) => void;
  const r = recovery(f, { async call<T>() { return await new Promise<T>(resolve => { complete = resolve as (page: unknown) => void; }); } });
  try {
    const first = r.tick(); const saved = r.state();
    await assert.rejects(r.tick(), /already active/); await assert.rejects(r.tick(), /already active/); assert.deepEqual(r.state(), saved);
    complete({ messages: [] }); assert.equal((await first).pages, 1); assert.equal((await r.tick()).complete, true);
  } finally { f.close(); }
});

test('heldout reentrant listener construction retains authentication and isolates second instance handler', async () => {
  const f = fixture(); const actor = { id: 'A', scope: f.scope, modificationEligible: false };
  let first!: Parameters<HttpListenerFactory>[0], second!: Parameters<HttpListenerFactory>[0];
  const options = { core: f.core, authenticate: bearerAuthenticator([{ token: 'fixture', principal: actor }]), health: () => 'first', createListener: ((handler) => { first = handler; options.authenticate = () => actor; options.health = () => 'mutated'; return {} as Server; }) as HttpListenerFactory };
  createDirectApi(options); createDirectApi({ core: f.core, authenticate: () => undefined, createListener: handler => { second = handler; return {} as Server; }, health: () => 'second' });
  async function request(handler: Parameters<HttpListenerFactory>[0], token?: string) {
    const request = Readable.from([]) as unknown as IncomingMessage; request.method = 'GET'; request.url = '/health'; request.headers = token ? { authorization: `Bearer ${token}` } : {};
    return await new Promise<[number, unknown]>(resolve => { let status = 0; handler(request, { headersSent: false, writeHead(value: number) { status = value; }, end(bytes: string) { resolve([status, JSON.parse(bytes)]); } } as unknown as ServerResponse); });
  }
  try { assert.equal((await request(first))[0], 401); assert.deepEqual(await request(first, 'fixture'), [200, 'first']); assert.equal((await request(second, 'fixture'))[0], 401); assert.equal(f.store.list('runs').length, 0); }
  finally { f.close(); }
});
