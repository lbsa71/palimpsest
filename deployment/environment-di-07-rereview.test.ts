import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { SlackClient, SlackError } from '../packages/communications/slack/client.ts';
import type { CommunicationSchedule } from '../packages/communications/environment.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function drain() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
async function observe(promise: Promise<unknown>) {
  return await promise.then(value => ({ ok: true, value }), value => ({ ok: false, value }));
}
function failure(result: Awaited<ReturnType<typeof observe>>, values: unknown[]) {
  assert.equal(result.ok, false);
  if (values.length === 1) assert.strictEqual(result.value, values[0]);
  else {
    assert.ok(result.value instanceof AggregateError);
    assert.equal(result.value.errors.length, values.length);
    values.forEach((value, i) => assert.strictEqual(result.value.errors[i], value));
    assert.equal(Object.hasOwn(result.value, 'cause'), true);
    assert.strictEqual(result.value.cause, values[0]);
  }
}
function timer(trace: string[], faults: unknown[] = []) {
  let fire!: () => void;
  const schedule: CommunicationSchedule = (_ms, callback) => {
    fire = callback;
    return { cancel() { trace.push('timer'); if (faults.length) throw faults[0]; } };
  };
  return { schedule, fire: () => fire() };
}
const bytes = (text: string) => new TextEncoder().encode(text);

for (const stage of ['read', 'cancel', 'unlock', 'timer'] as const) {
  test(`rereview undefined failure from ${stage} retains exact identity`, async () => {
    const trace: string[] = []; let index = 0;
    const reader = {
      async read() {
        trace.push('read');
        if (stage === 'read') throw undefined;
        if (stage === 'cancel') return { done: false, value: bytes('oversize') };
        return index++ === 0 ? { done: false, value: bytes('{"ok":true}') } : { done: true };
      },
      async cancel() { trace.push('cancel'); if (stage === 'cancel') throw undefined; },
      releaseLock() { trace.push('unlock'); if (stage === 'unlock') throw undefined; },
    };
    const t = timer(trace, stage === 'timer' ? [undefined] : []);
    // Cancellation follows a byte-bound failure; its undefined value must be
    // retained as a separate cleanup failure in the ordered aggregate.
    const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, maxResponseBytes: 1,
      fetch: async () => ({ status: 200, ok: true, body: { getReader: () => reader } }) as unknown as Response });
    // EOF paths use a separate sufficiently large bound.
    const successful = new SlackClient({ token: 'synthetic', schedule: t.schedule,
      fetch: async () => ({ status: 200, ok: true, body: { getReader: () => reader } }) as unknown as Response });
    const result = await observe((stage === 'cancel' ? client : successful).call('auth.test', {}));
    if (stage === 'cancel') {
      assert.ok(result.value instanceof AggregateError);
      assert.match(result.value.errors[0].message, /byte bound/);
      failure(result, [result.value.errors[0], undefined]);
    } else failure(result, [undefined]);
    assert.equal(trace.filter(v => v === 'timer').length, 1);
    assert.equal(trace.filter(v => v === 'unlock').length, 1);
    assert.equal(trace.filter(v => v === 'cancel').length, stage === 'read' || stage === 'cancel' ? 1 : 0);
  });
}

test('rereview four repeated undefined failures preserve multiplicity and own undefined cause', async () => {
  const trace: string[] = [], t = timer(trace, [undefined]);
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, fetch: async () => ({ status: 200, ok: true, body: {
    getReader() { return {
      async read() { trace.push('read'); throw undefined; },
      async cancel() { trace.push('cancel'); throw undefined; },
      releaseLock() { trace.push('unlock'); throw undefined; },
    }; },
  } }) as unknown as Response });
  failure(await observe(client.call('auth.test', {})), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(trace, ['read', 'cancel', 'unlock', 'timer']);
});

for (const rejects of [false, true]) test(`rereview deferred reader cancellation ${rejects ? 'rejection' : 'success'} is awaited before unlock and timer`, async () => {
  const trace: string[] = [], t = timer(trace, ['timer-failure']);
  const gate = deferred<void>(), primary = Symbol('read'), cleanup = 0; let settled = false;
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, fetch: async () => ({ status: 200, ok: true, body: {
    getReader() { return {
      async read() { trace.push('read'); throw primary; },
      cancel() { trace.push('cancel-enter'); return gate.promise.finally(() => { trace.push('cancel-exit'); }); },
      releaseLock() { trace.push('unlock'); throw false; },
    }; },
    cancel() { assert.fail('reader already owns cancellation'); },
  } }) as unknown as Response });
  const pending = observe(client.call('chat.postMessage', {})).then(value => { settled = true; return value; });
  try {
    await drain(); assert.equal(settled, false); assert.deepEqual(trace, ['read', 'cancel-enter']);
  } finally { if (rejects) gate.reject(cleanup); else gate.resolve(); }
  failure(await pending, [primary, ...(rejects ? [cleanup] : []), false, 'timer-failure']);
  assert.deepEqual(trace, ['read', 'cancel-enter', 'cancel-exit', 'unlock', 'timer']);
});

for (const field of ['status', 'headers'] as const) test(`rereview throwing ${field} accessor cannot escape response-body ownership`, async () => {
  const trace: string[] = [], t = timer(trace), thrown = { field };
  const body = new ReadableStream<Uint8Array>({ pull() { assert.fail('refused body read'); }, cancel() { trace.push('body-cancel'); } }, { highWaterMark: 0 });
  const response = {
    get body() { trace.push('body-owned'); return body; },
    get status() { trace.push('status'); if (field === 'status') throw thrown; return 429; },
    get headers() { throw thrown; },
  } as unknown as Response;
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, fetch: async () => response });
  try { failure(await observe(client.call('auth.test', {})), [thrown]); assert.deepEqual(trace, ['body-owned', 'status', 'body-cancel', 'timer']); }
  finally { if (!trace.includes('body-cancel')) await body.cancel(); }
});

test('rereview native errored stream reports read and cancel rejection and releases lock', async () => {
  const trace: string[] = [], reason = Symbol('native stream failure'), t = timer(trace, [null]);
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(reason); }, cancel() { assert.fail('errored source must not be cancelled again'); } });
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, fetch: async () => new Response(body) });
  failure(await observe(client.call('auth.test', {})), [reason, reason, null]);
  assert.equal(body.locked, false); assert.deepEqual(trace, ['timer']);
});

test('rereview foreign native lock rejects acquisition and disposal without claiming cleanup success', async () => {
  const trace: string[] = [], t = timer(trace); let sourceCancels = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { sourceCancels++; } }, { highWaterMark: 0 });
  const foreign = body.getReader();
  // Response construction rejects locked bodies itself. Return an explicit
  // Response-shaped adapter to exercise a foreign lock at client acquisition.
  const lockedClient = new SlackClient({ token: 'synthetic', schedule: t.schedule,
    fetch: async () => ({ status: 200, ok: true, body }) as Response });
  try {
    const result = await observe(lockedClient.call('auth.test', {}));
    assert.ok(result.value instanceof AggregateError);
    assert.equal(result.value.errors.length, 2);
    assert.ok(result.value.errors.every((value: unknown) => value instanceof TypeError));
    failure(result, result.value.errors);
    assert.equal(body.locked, true); assert.equal(sourceCancels, 0); assert.deepEqual(trace, ['timer']);
  } finally { await foreign.cancel(); foreign.releaseLock(); }
  assert.equal(sourceCancels, 1); assert.equal(body.locked, false);
});

for (const short of [false, true]) test(`rereview split UTF-8 response enforces exact byte boundary ${short ? 'below' : 'at'} payload length`, async () => {
  const payload = bytes('{"ok":true,"text":"🦉é"}'), trace: string[] = [], t = timer(trace); let cursor = 0, cancels = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (cursor < payload.length) controller.enqueue(payload.slice(cursor, ++cursor)); else controller.close();
  }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, maxResponseBytes: payload.length - Number(short), fetch: async () => new Response(body) });
  const result = await observe(client.call('auth.test', {}));
  if (short) { assert.equal(result.ok, false); assert.ok(result.value instanceof Error); assert.match(result.value.message, /byte bound/); }
  else { assert.equal(result.ok, true); assert.deepEqual(result.value, { ok: true, text: '🦉é' }); }
  assert.equal(cancels, Number(short)); assert.equal(body.locked, false); assert.deepEqual(trace, ['timer']);
});

for (const trigger of ['caller', 'timeout'] as const) test(`rereview late transport rejection after ${trigger} preserves dispatch failure and timer fault without retry`, async () => {
  const trace: string[] = [], t = timer(trace, [undefined]), parent = new AbortController(), gate = deferred<Response>();
  let dispatches = 0, sentSignal!: AbortSignal;
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, fetch: async (_url, init) => {
    dispatches++; sentSignal = init!.signal!; return await gate.promise;
  } });
  const pending = observe(client.call('chat.postMessage', {}, parent.signal));
  if (trigger === 'caller') parent.abort('stop'); else t.fire();
  assert.equal(sentSignal.aborted, true); gate.reject(false);
  failure(await pending, [false, undefined]); await drain();
  assert.equal(dispatches, 1); assert.deepEqual(trace, ['timer']); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('rereview concurrent requests isolate aborted deferred cleanup from successful EOF', async () => {
  const traces = [[], []] as string[][], gates = [deferred<Response>(), deferred<Response>()], parent = new AbortController();
  const cancelGate = deferred<void>(); let timerIndex = 0, dispatches = 0, firstSettled = false;
  const schedule: CommunicationSchedule = () => { const i = timerIndex++; return { cancel() { traces[i]!.push('timer'); } }; };
  const client = new SlackClient({ token: 'synthetic', schedule, fetch: async () => await gates[dispatches++]!.promise });
  const body = new ReadableStream<Uint8Array>({ cancel() { traces[0]!.push('cancel-enter'); return cancelGate.promise.finally(() => { traces[0]!.push('cancel-exit'); }); } }, { highWaterMark: 0 });
  const first = observe(client.call('chat.postMessage', {}, parent.signal)).then(value => { firstSettled = true; return value; });
  const second = observe(client.call('auth.test', {}));
  parent.abort('only-first'); gates[0]!.resolve(new Response(body)); gates[1]!.resolve(new Response('{"ok":true,"instance":2}'));
  try {
    const successful = await second; assert.equal(successful.ok, true); assert.deepEqual(successful.value, { ok: true, instance: 2 });
    assert.equal(firstSettled, false); assert.deepEqual(traces, [['cancel-enter'], ['timer']]);
  } finally { cancelGate.resolve(); }
  failure(await first, ['only-first']); assert.deepEqual(traces, [['cancel-enter', 'cancel-exit', 'timer'], ['timer']]);
  assert.equal(dispatches, 2); assert.equal(body.locked, false); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

for (const status of [401, 429, 503]) test(`rereview native HTTP ${status} cancellation rejection keeps primary API refusal and undefined cleanup`, async () => {
  const trace: string[] = [], t = timer(trace); let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancellations++; return Promise.reject(undefined); } }, { highWaterMark: 0 });
  const client = new SlackClient({ token: 'synthetic', schedule: t.schedule, fetch: async () => new Response(body, { status, headers: { 'retry-after': '0.25' } }) });
  const result = await observe(client.call('auth.test', {})); assert.ok(result.value instanceof AggregateError);
  const primary = result.value.errors[0]; assert.ok(primary instanceof SlackError);
  assert.equal(primary.code, status === 429 ? 'ratelimited' : `http_${status}`); assert.equal(primary.retryAfterMs, status === 429 ? 250 : undefined);
  failure(result, [primary, undefined]); assert.equal(cancellations, 1); assert.equal(body.locked, false); assert.deepEqual(trace, ['timer']);
});
