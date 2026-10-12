import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { Readable } from 'node:stream';
import test from 'node:test';
import { providerHttps, type ProviderHttpsRequest } from './provider-http.ts';

function fixture() {
  const outgoing = new EventEmitter() as EventEmitter & { end(body: string): void; destroy(error?: Error): void; setTimeout(ms: number): void };
  let dispatches = 0, destroys = 0, body = '', elapsedMs = 0, timeoutMs: number | undefined;
  let url: URL | undefined, options: RequestOptions | undefined, receive: ((response: IncomingMessage) => void) | undefined;
  outgoing.end = value => { body = value; };
  outgoing.destroy = error => { destroys++; if (error) queueMicrotask(() => outgoing.emit('error', error)); };
  outgoing.setTimeout = ms => { timeoutMs = ms; };
  const request: ProviderHttpsRequest = (target, config, response) => {
    dispatches++; url = target; options = config; receive = response; timeoutMs = config.timeout;
    return outgoing as unknown as ClientRequest;
  };
  return {
    request, outgoing,
    snapshot: () => ({ dispatches, destroys, body, elapsedMs, url, options, timeoutMs }),
    advance(ms: number) {
      elapsedMs += ms;
      if (timeoutMs !== undefined && elapsedMs >= timeoutMs) outgoing.emit('error', new Error('Fixture transport timeout'));
    },
    respond(status = 200) {
      const response = new Readable({ read() {} }) as IncomingMessage;
      response.statusCode = status; receive!(response); return response;
    },
  };
}

const endpoint = 'https://api.mistral.ai/v1/chat/completions';
const init = (signal: AbortSignal) => ({ signal, headers: { 'Content-Type': 'application/json' }, body: '{}' });

test('delayed headers beyond the old 300-second cutoff use only the caller deadline', async () => {
  const transport = fixture(), controller = new AbortController();
  let settled = false;
  const pending = providerHttps(transport.request)(endpoint, init(controller.signal));
  void pending.then(() => { settled = true; });
  transport.advance(300_001); await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(transport.snapshot().elapsedMs, 300_001);
  assert.equal(transport.snapshot().timeoutMs, undefined);
  assert.equal(transport.snapshot().options?.agent, false);
  assert.equal(transport.snapshot().options?.rejectUnauthorized, true);
  assert.equal(transport.snapshot().options?.method, 'POST');
  assert.equal(transport.snapshot().body, '{}');
  const incoming = transport.respond(); incoming.push(Buffer.from('delayed')); incoming.push(null);
  const response = await pending;
  assert.equal(await new Response(response.body).text(), 'delayed');
  controller.abort(); assert.equal(transport.snapshot().destroys, 0);
});

test('pre-dispatch cancellation and insecure endpoints never dispatch', async () => {
  const transport = fixture(), controller = new AbortController(); controller.abort(new Error('cancelled first'));
  await assert.rejects(providerHttps(transport.request)(endpoint, init(controller.signal)), /cancelled first/);
  await assert.rejects(providerHttps(transport.request)('http://api.mistral.ai/', init(new AbortController().signal)), /HTTPS/);
  assert.equal(transport.snapshot().dispatches, 0);
});

test('cancellation while awaiting headers destroys the request and any late response', async () => {
  const transport = fixture(), controller = new AbortController();
  const pending = providerHttps(transport.request)(endpoint, init(controller.signal));
  controller.abort(new Error('cancelled headers'));
  await assert.rejects(pending, /cancelled headers/);
  assert.equal(transport.snapshot().destroys, 1);
  assert.equal(transport.respond().destroyed, true);
});

test('cancellation interrupts a waiting body reader and destroys both streams', async () => {
  const transport = fixture(), controller = new AbortController();
  const pending = providerHttps(transport.request)(endpoint, init(controller.signal));
  const incoming = transport.respond(), reader = (await pending).body.getReader();
  incoming.push(Buffer.from('part')); assert.equal(Buffer.from((await reader.read()).value!).toString(), 'part');
  const reading = reader.read(); controller.abort(new Error('cancelled body'));
  await assert.rejects(reading, /cancelled body/);
  assert.equal(incoming.destroyed, true); assert.equal(transport.snapshot().destroys, 1);
});

test('request errors before headers and after headers reject their active consumer', async () => {
  const transport = fixture();
  const pending = providerHttps(transport.request)(endpoint, init(new AbortController().signal));
  transport.outgoing.emit('error', new Error('request failed'));
  await assert.rejects(pending, /request failed/);
  const next = fixture(), response = providerHttps(next.request)(endpoint, init(new AbortController().signal));
  const incoming = next.respond(), reading = (await response).body.getReader().read();
  next.outgoing.emit('error', new Error('request failed during body'));
  await assert.rejects(reading, /request failed during body/); assert.equal(incoming.destroyed, true);
});

test('response stream errors and premature closure propagate to the body reader', async () => {
  for (const error of [new Error('response failed'), undefined]) {
    const transport = fixture(), controller = new AbortController();
    const pending = providerHttps(transport.request)(endpoint, init(controller.signal));
    const incoming = transport.respond(), reading = (await pending).body.getReader().read();
    incoming.destroy(error);
    if (error) await assert.rejects(reading, /response failed/);
    else await assert.rejects(reading, failure => failure instanceof Error && failure.cause instanceof Error && 'code' in failure.cause && failure.cause.code === 'ERR_STREAM_PREMATURE_CLOSE');
    controller.abort(); assert.equal(transport.snapshot().destroys, 0);
  }
});

test('redirects fail without following the destination and release the connection', async () => {
  const transport = fixture(), controller = new AbortController();
  const pending = providerHttps(transport.request)(endpoint, init(controller.signal));
  const incoming = transport.respond(307);
  await assert.rejects(pending, /redirect refused/);
  assert.equal(incoming.destroyed, true); assert.equal(transport.snapshot().destroys, 1);
  assert.equal(transport.snapshot().dispatches, 1);
  controller.abort(); assert.equal(transport.snapshot().destroys, 1);
});

test('reader cancellation destroys a response and detaches later abort handling', async () => {
  const transport = fixture(), controller = new AbortController();
  const pending = providerHttps(transport.request)(endpoint, init(controller.signal));
  const incoming = transport.respond(), reader = (await pending).body.getReader();
  const closed = new Promise<void>(resolve => incoming.once('close', resolve));
  await reader.cancel(); await closed;
  assert.equal(incoming.destroyed, true);
  controller.abort(); assert.equal(transport.snapshot().destroys, 0);
});
