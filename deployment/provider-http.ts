import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { Readable } from 'node:stream';

export type ProviderHttpsRequest = (url: URL, options: RequestOptions, response: (message: IncomingMessage) => void) => ClientRequest;
export interface ProviderHttpResponse { status: number; body: ReadableStream<Uint8Array> }

/** No transport deadline: the caller owns cancellation for headers and body. */
export function providerHttps(request: ProviderHttpsRequest) {
  return (endpoint: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<ProviderHttpResponse> => {
    const url = new URL(endpoint), { signal } = init;
    if (url.protocol !== 'https:') return Promise.reject(new Error('Provider endpoint requires HTTPS'));
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      let outgoing: ClientRequest | undefined, incoming: IncomingMessage | undefined;
      const cleanup = () => signal.removeEventListener('abort', abort);
      const abort = () => {
        const error = signal.reason instanceof Error ? signal.reason : new Error('Provider request aborted');
        incoming?.destroy(error); outgoing?.destroy(error);
        cleanup(); reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        outgoing = request(url, {
          method: 'POST', headers: init.headers, agent: false, rejectUnauthorized: true,
        }, response => {
          incoming = response;
          if (signal.aborted) { response.destroy(); return; }
          const status = response.statusCode;
          if (status === undefined || status >= 300 && status < 400) {
            response.destroy(); outgoing?.destroy(); cleanup();
            reject(new Error(status === undefined ? 'Provider response has no status' : 'Provider redirect refused'));
            return;
          }
          const body = Readable.toWeb(response, {
            strategy: { highWaterMark: response.readableHighWaterMark, size: chunk => chunk.byteLength },
          }) as ReadableStream<Uint8Array>;
          response.once('end', cleanup); response.once('close', cleanup);
          resolve({ status, body });
        });
        outgoing.once('error', error => { incoming?.destroy(error); cleanup(); reject(error); });
        if (signal.aborted) { abort(); return; }
        outgoing.end(init.body);
      } catch (error) {
        incoming?.destroy(); outgoing?.destroy(); cleanup(); reject(error);
      }
    });
  };
}
