import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

// This bridge runs inside the host's network/PID/mount namespace. It receives no
// provider credentials. Every HTTP attempt becomes a separately observed host RPC.
const pending = new Map();
let sequence = 0, started = false;
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const rpc = (method, ...args) => new Promise((resolve, reject) => {
  const id = String(++sequence); pending.set(id, { resolve, reject });
  send({ kind: 'request', id, method, args });
});
async function main(start) {
  if (!start || typeof start.prompt !== 'string' || typeof start.model !== 'string' || !['none', 'low', 'medium', 'high', 'xhigh'].includes(start.effort) ||
      !Number.isSafeInteger(start.maxRequestBytes) || start.maxRequestBytes < 1 || start.maxRequestBytes > 2_000_000 ||
      !Number.isSafeInteger(start.maxOutputBytes) || start.maxOutputBytes < 1 || start.maxOutputBytes > 2_000_000) throw new Error('Invalid bounded baseline invocation');
  const home = '/tmp/aeon-baseline-home'; mkdirSync(`${home}/codex`, { recursive: true, mode: 0o700 });
  let child, busy = false;
  const server = createServer(async (request, response) => {
    // No proxy routes, provider URL selection, WebSocket or ambient authentication.
    if (request.method !== 'POST' || request.url !== '/v1/responses' || busy) { response.writeHead(403).end(); return; }
    busy = true; let bytes = 0; const chunks = [];
    try {
      for await (const chunk of request) { bytes += chunk.length; if (bytes > start.maxRequestBytes) throw new Error('Oversized baseline request'); chunks.push(chunk); }
      const payload = Buffer.concat(chunks).toString('utf8');
      const reply = await rpc('baseline.provider', { method: request.method, path: request.url, payload });
      if (!reply || !Number.isInteger(reply.status) || typeof reply.body !== 'string' || typeof reply.contentType !== 'string') throw new Error('Invalid host response');
      response.writeHead(reply.status, { 'Content-Type': reply.contentType }).end(reply.body);
    } catch { response.writeHead(502).end('Host observer refused or could not complete the physical attempt'); }
    finally { busy = false; }
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const configuration = {
    model_provider: 'host_observer', model_reasoning_effort: start.effort,
    'model_providers.host_observer.name': 'Aeon host observer',
    'model_providers.host_observer.base_url': `http://127.0.0.1:${port}/v1`,
    'model_providers.host_observer.env_key': 'AEON_OBSERVER_TOKEN',
    'model_providers.host_observer.wire_api': 'responses',
    'model_providers.host_observer.supports_websockets': false,
    'model_providers.host_observer.request_max_retries': 0,
    'model_providers.host_observer.stream_max_retries': 0,
    web_search: 'disabled',
  };
  const args = ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', 'danger-full-access', '--json', '--color', 'never', '--skip-git-repo-check', '--cd', '/work', '--model', start.model,
    ...Object.entries(configuration).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), '-'];
  // Native tool sandbox is disabled only inside the independently imposed namespace.
  // No caller-provided environment, CLI argument, hook, configuration or executable.
  child = spawn('/app/codex', args, { cwd: '/work', env: { PATH: '/runtime:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, CODEX_HOME: `${home}/codex`, AEON_OBSERVER_TOKEN: 'no-provider-authority' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let outputBytes = 0, exceeded = false; const stdout = [], stderr = [];
  const collect = destination => chunk => {
    const remaining = Math.max(0, start.maxOutputBytes - outputBytes); destination.push(chunk.subarray(0, remaining)); outputBytes += chunk.length;
    if (outputBytes > start.maxOutputBytes) { exceeded = true; child.kill('SIGKILL'); }
  };
  child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
  child.stdin.on('error', () => {}); child.stdin.end(start.prompt);
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (pending.size) throw new Error('Baseline exited with a physical observation pending');
  send({ kind: 'done', value: { ...result, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exceeded, invocation: { executable: '/app/codex', args, authentication: 'dummy-bridge-token-only' } } });
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.kind === 'start' && !started) {
      started = true; void main(message.value).catch(() => { process.exitCode = 1; input.close(); process.stdin.destroy(); });
    } else if (message.kind === 'reply' && typeof message.id === 'string' && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id);
      if (message.ok === true) request.resolve(message.value); else request.reject(new Error('Host operation refused or unavailable'));
    } else throw new Error('Invalid host protocol');
  } catch { process.exitCode = 1; input.close(); process.stdin.destroy(); }
});
