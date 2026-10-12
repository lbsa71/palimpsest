import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { SlackClient, SlackError } from '../packages/communications/slack/client.ts';
import type { CommunicationSchedule } from '../packages/communications/environment.ts';

async function outcome(pending: Promise<unknown>) {
  return await pending.then(value => ({ fulfilled: true, value }), value => ({ fulfilled: false, value }));
}
function rejected(observed: Awaited<ReturnType<typeof outcome>>, failures: unknown[]) {
  assert.equal(observed.fulfilled, false);
  if (failures.length === 1) assert.equal(observed.value, failures[0]);
  else {
    assert.ok(observed.value instanceof AggregateError);
    assert.equal(observed.value.errors.length, failures.length);
    failures.forEach((failure, index) => assert.equal(observed.value.errors[index], failure));
    assert.equal(observed.value.cause, failures[0]);
  }
}
function timers(trace: string[], failures: unknown[] = []) {
  let fire!: () => void;
  const schedule: CommunicationSchedule = (_ms, callback) => {
    fire = callback;
    return { cancel() { trace.push('timer'); if (failures.length) throw failures[0]; } };
  };
  return { schedule, fire: () => fire() };
}
function readerFixture(options: {
  readFailure?: unknown[]; cancelFailure?: unknown[]; unlockFailure?: unknown[]; timerFailure?: unknown[];
  payload?: string; afterRead?: (index: number) => void; maxResponseBytes?: number;
} = {}) {
  const trace: string[] = [], timer = timers(trace, options.timerFailure);
  let reads = 0, dispatches = 0;
  const reader = {
    async read() {
      trace.push('read'); options.afterRead?.(reads);
      if (options.readFailure?.length) throw options.readFailure[0];
      return reads++ === 0 ? { done: false, value: new TextEncoder().encode(options.payload ?? '{"ok":true,"value":7}') } : { done: true, value: undefined };
    },
    async cancel() { trace.push('cancel'); if (options.cancelFailure?.length) throw options.cancelFailure[0]; },
    releaseLock() { trace.push('unlock'); if (options.unlockFailure?.length) throw options.unlockFailure[0]; },
  };
  const response = { status: 200, ok: true, body: {
    getReader() { trace.push('acquire'); return reader; },
    async cancel() { assert.fail('body cancellation duplicates reader ownership'); },
  } } as unknown as Response;
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, maxResponseBytes: options.maxResponseBytes,
    fetch: async () => { dispatches++; return response; } });
  return { client, trace, dispatches: () => dispatches };
}

for (const nonErrors of [false, true]) for (let mask = 0; mask < 8; mask++) {
  test(`repair read failure retains ordered cleanup mask ${mask} with ${nonErrors ? 'non-Error' : 'Error'} values`, async () => {
    const read = nonErrors ? undefined : Error('read');
    const cancel = nonErrors ? { cancel: true } : Error('cancel');
    const unlock = nonErrors ? 'unlock' : Error('unlock');
    const timer = nonErrors ? null : Error('timer');
    const f = readerFixture({ readFailure: [read], cancelFailure: mask & 1 ? [cancel] : [],
      unlockFailure: mask & 2 ? [unlock] : [], timerFailure: mask & 4 ? [timer] : [] });
    const expected = [read, ...(mask & 1 ? [cancel] : []), ...(mask & 2 ? [unlock] : []), ...(mask & 4 ? [timer] : [])];
    rejected(await outcome(f.client.call('auth.test', {})), expected);
    assert.deepEqual(f.trace, ['acquire', 'read', 'cancel', 'unlock', 'timer']); assert.equal(f.dispatches(), 1);
  });
}

for (let mask = 0; mask < 4; mask++) test(`repair EOF success does not cancel and preserves unlock/timer cleanup mask ${mask}`, async () => {
  const unlock = Error('unlock after EOF'), timer = { timer: 'after EOF' };
  const f = readerFixture({ unlockFailure: mask & 1 ? [unlock] : [], timerFailure: mask & 2 ? [timer] : [] });
  const observed = await outcome(f.client.call('auth.test', {}));
  if (mask) rejected(observed, [...(mask & 1 ? [unlock] : []), ...(mask & 2 ? [timer] : [])]);
  else { assert.equal(observed.fulfilled, true); assert.deepEqual(observed.value, { ok: true, value: 7 }); }
  assert.deepEqual(f.trace, ['acquire', 'read', 'read', 'unlock', 'timer']); assert.equal(f.dispatches(), 1);
});

for (const status of [401, 429, 503]) test(`repair real HTTP ${status} body is cancelled without reading before timer cleanup`, async () => {
  const trace: string[] = [], timer = timers(trace); let dispatches = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { trace.push('body-cancel'); } }, { highWaterMark: 0 });
  const response = new Response(body, { status, headers: { 'retry-after': '4' } });
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, fetch: async () => { dispatches++; return response; } });
  try {
    const observed = await outcome(client.call('conversations.history', {}));
    assert.equal(observed.fulfilled, false); assert.ok(observed.value instanceof SlackError);
    assert.equal(observed.value.code, status === 429 ? 'ratelimited' : `http_${status}`);
    assert.equal(observed.value.retryAfterMs, status === 429 ? 4000 : undefined);
    assert.deepEqual(trace, ['body-cancel', 'timer']); assert.equal(response.body!.locked, false); assert.equal(dispatches, 1);
  } finally { if (!trace.includes('body-cancel')) await body.cancel(); }
});

for (const status of [401, 429, 503]) test(`repair HTTP ${status} preserves refusal with body and timer cancellation failures`, async () => {
  const cancel = { body: 'cancel failed' }, timerFailure = Error('timer failed');
  const trace: string[] = [], timer = timers(trace, [timerFailure]);
  const body = new ReadableStream<Uint8Array>({ cancel() { trace.push('body-cancel'); throw cancel; } }, { highWaterMark: 0 });
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule,
    fetch: async () => new Response(body, { status, headers: { 'retry-after': '2' } }) });
  try {
    const observed = await outcome(client.call('auth.test', {}));
    assert.ok(observed.value instanceof AggregateError); const primary = observed.value.errors[0];
    assert.ok(primary instanceof SlackError); assert.equal(primary.code, status === 429 ? 'ratelimited' : `http_${status}`);
    assert.equal(primary.retryAfterMs, status === 429 ? 2000 : undefined);
    rejected(observed, [primary, cancel, timerFailure]); assert.deepEqual(trace, ['body-cancel', 'timer']);
  } finally { if (!trace.includes('body-cancel')) rejected(await outcome(body.cancel()), [cancel]); }
});

for (const source of ['caller', 'timeout'] as const) test(`repair response arriving after ${source} abort is cancelled before settlement`, async () => {
  const trace: string[] = [], timer = timers(trace), parent = new AbortController();
  const reason = { caller: 'stopped' }; let resolve!: (response: Response) => void; let dispatches = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { trace.push('body-cancel'); } }, { highWaterMark: 0 });
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, fetch: async () => {
    dispatches++; return await new Promise<Response>(done => { resolve = done; });
  } });
  try {
    const pending = outcome(client.call('chat.postMessage', {}, parent.signal));
    if (source === 'caller') parent.abort(reason); else timer.fire();
    resolve(new Response(body)); const observed = await pending;
    if (source === 'caller') rejected(observed, [reason]);
    else { assert.equal(observed.fulfilled, false); assert.ok(observed.value instanceof Error); assert.match(observed.value.message, /timeout/); }
    assert.deepEqual(trace, ['body-cancel', 'timer']); assert.equal(dispatches, 1);
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  } finally { if (!trace.includes('body-cancel')) await body.cancel(); }
});

test('repair late abort, failed body disposal and failed timer retain exact values and detach parent', async () => {
  const trace: string[] = [], reason = 'abort', cancel = undefined, cleanup = null;
  const timer = timers(trace, [cleanup]), parent = new AbortController();
  let resolve!: (response: Response) => void;
  const body = new ReadableStream<Uint8Array>({ cancel() { trace.push('body-cancel'); throw cancel; } }, { highWaterMark: 0 });
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule,
    fetch: async () => await new Promise<Response>(done => { resolve = done; }) });
  const pending = outcome(client.call('chat.postMessage', {}, parent.signal)); parent.abort(reason); resolve(new Response(body));
  try {
    rejected(await pending, [reason, cancel, cleanup]); assert.deepEqual(trace, ['body-cancel', 'timer']);
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  } finally { if (!trace.includes('body-cancel')) rejected(await outcome(body.cancel()), [cancel]); }
});

test('repair request awaits body cancellation before timer cleanup and settlement', async () => {
  const trace: string[] = [], timer = timers(trace); let release!: () => void, settled = false;
  function releaseCancellation() { release?.(); }
  const body = new ReadableStream<Uint8Array>({ cancel() {
    trace.push('body-cancel'); return new Promise<void>(resolve => { release = resolve; });
  } }, { highWaterMark: 0 });
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, fetch: async () => new Response(body, { status: 503 }) });
  const pending = outcome(client.call('auth.test', {})).then(value => { settled = true; return value; });
  try {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(trace, ['body-cancel']); assert.equal(settled, false);
  } finally {
    if (release) release();
    else { const cleanup = body.cancel(); releaseCancellation(); await cleanup; }
  }
  const observed = await pending; assert.equal(observed.fulfilled, false); assert.ok(observed.value instanceof SlackError);
  assert.deepEqual(trace, ['body-cancel', 'timer']);
});

for (const failingCleanup of [false, true]) test(`repair reader acquisition fault disposes body with ${failingCleanup ? 'failed' : 'successful'} cleanup`, async () => {
  const trace: string[] = [], acquisition = Error('getReader'), cancel = { cancel: 'failed' }, timer = timers(trace);
  const response = { status: 200, ok: true, body: {
    getReader() { trace.push('acquire'); throw acquisition; },
    async cancel() { trace.push('body-cancel'); if (failingCleanup) throw cancel; },
  } } as unknown as Response;
  const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, fetch: async () => response });
  rejected(await outcome(client.call('auth.test', {})), [acquisition, ...(failingCleanup ? [cancel] : [])]);
  assert.deepEqual(trace, ['acquire', 'body-cancel', 'timer']);
});

for (const payload of ['{', '{"ok":false,"error":"missing_scope"}']) test(`repair fully consumed rejected payload ${payload} preserves unlock and timer faults without cancellation`, async () => {
  const unlock = 'unlock', timer = Error('timer'), f = readerFixture({ payload, unlockFailure: [unlock], timerFailure: [timer] });
  const observed = await outcome(f.client.call('auth.test', {}));
  assert.ok(observed.value instanceof AggregateError); const primary = observed.value.errors[0];
  if (payload === '{') assert.ok(primary instanceof SyntaxError);
  else { assert.ok(primary instanceof SlackError); assert.equal(primary.code, 'missing_scope'); }
  rejected(observed, [primary, unlock, timer]); assert.deepEqual(f.trace, ['acquire', 'read', 'read', 'unlock', 'timer']);
});

test('repair byte bound remains enforced and preserves cancellation unlock and timer failures', async () => {
  const cancel = 'cancel', unlock = null, timer = Error('timer');
  const f = readerFixture({ maxResponseBytes: 1, cancelFailure: [cancel], unlockFailure: [unlock], timerFailure: [timer] });
  const observed = await outcome(f.client.call('auth.test', {}));
  assert.ok(observed.value instanceof AggregateError); const primary = observed.value.errors[0];
  assert.ok(primary instanceof Error); assert.match(primary.message, /byte bound/);
  rejected(observed, [primary, cancel, unlock, timer]); assert.deepEqual(f.trace, ['acquire', 'read', 'cancel', 'unlock', 'timer']);
});

for (const eof of [false, true]) test(`repair abort during ${eof ? 'EOF' : 'partial'} read cancels only unread bodies`, async () => {
  const controller = new AbortController(), reason = { abort: true };
  const f = readerFixture({ afterRead: index => { if (index === (eof ? 1 : 0)) controller.abort(reason); } });
  rejected(await outcome(f.client.call('auth.test', {}, controller.signal)), [reason]);
  assert.deepEqual(f.trace, eof ? ['acquire', 'read', 'read', 'unlock', 'timer'] : ['acquire', 'read', 'cancel', 'unlock', 'timer']);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('repair controlled real success consumes to EOF and unlocks without cancellation', async () => {
  const trace: string[] = [], timer = timers(trace); let index = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    trace.push('pull'); if (index++ === 0) controller.enqueue(new TextEncoder().encode('{"ok":true}')); else controller.close();
  }, cancel() { assert.fail('consumed body must not be cancelled'); } }, { highWaterMark: 0 });
  const response = new Response(body), client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, fetch: async () => response });
  assert.deepEqual(await client.call('auth.test', {}), { ok: true });
  assert.deepEqual(trace, ['pull', 'pull', 'timer']); assert.equal(response.body!.locked, false);
  const reader = body.getReader();
  try { assert.equal((await reader.read()).done, true); } finally { reader.releaseLock(); }
});

test('repair absent response bodies retain API refusal or body invariant and clean timer', async () => {
  for (const status of [204, 503]) {
    const trace: string[] = [], timer = timers(trace);
    const client = new SlackClient({ token: 'synthetic', schedule: timer.schedule, fetch: async () => new Response(null, { status }) });
    const observed = await outcome(client.call('auth.test', {})); assert.equal(observed.fulfilled, false);
    if (status === 503) { assert.ok(observed.value instanceof SlackError); assert.equal(observed.value.code, 'http_503'); }
    else { assert.ok(observed.value instanceof Error); assert.match(observed.value.message, /body absent/); }
    assert.deepEqual(trace, ['timer']);
  }
});
