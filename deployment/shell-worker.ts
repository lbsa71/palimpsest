import { createInterface } from 'node:readline';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import type { JsonValue, ShellBridge, ShellInput } from '../packages/contracts/index.ts';

interface Startup { input: ShellInput; options: Omit<ShellOptions, 'apiKey' | 'fetch' | 'resolveFragment' | 'steering' | 'reservationEstimate'>; fragments: Record<string, string> }
const pending = new Map<string, { resolve(value: JsonValue): void; reject(error: Error): void }>();
let sequence = 0;
let started = false;
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: value => resolve(value as T), reject });
    send({ kind: 'request', id, method, args });
  });
}
async function main(start: Startup): Promise<void> {
  const shell = createAgentShell({ ...start.options, apiKey: () => 'host-transport-owned',
    async resolveFragment(fragment) {
      const content = start.fragments[fragment.artifact.sha256];
      if (content === undefined) throw new Error('Undeclared worker prompt fragment');
      return content;
    },
    async fetch(_url, init) {
      if (typeof init?.body !== 'string') throw new Error('Worker transport requires serialized payload');
      const response = await rpc<{ status: number; body: string }>('provider.fetch', init.body);
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const bridge: ShellBridge = {
    execute: call => rpc('execute', call),
    persistCheckpoint: (runId, revision, shell, content) => rpc('persistCheckpoint', runId, revision, shell, content),
    readCheckpoint: checkpoint => rpc('readCheckpoint', checkpoint),
    capturePrompt: (manifest, payload) => rpc('capturePrompt', manifest, payload),
    reserve: request => rpc('reserve', request),
    dispatched: request => rpc('dispatched', request),
    settle: receipt => rpc('settle', receipt),
  };
  const result = await shell.run(start.input, bridge);
  send({ kind: 'done', value: result });
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try {
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message.kind === 'start' && !started) {
      started = true;
      void main(message.value as Startup).catch(() => { process.exitCode = 1; input.close(); process.stdin.destroy(); });
    } else if (message.kind === 'reply' && typeof message.id === 'string') {
      const request = pending.get(message.id);
      if (!request) throw new Error('Unknown host reply');
      pending.delete(message.id);
      if (message.ok === true) request.resolve(message.value as JsonValue);
      else request.reject(new Error('Host operation refused or unavailable'));
    } else throw new Error('Invalid host message');
  } catch { process.exitCode = 1; input.close(); process.stdin.destroy(); }
});
