import { claudeInvocation } from './claude-configuration.ts';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

// This bridge runs inside the host's network/PID/mount namespace. It receives no
// provider credentials. Every HTTP attempt becomes a separately observed host RPC.
const pending = new Map();
let sequence = 0, started = false;
let stop = () => {};
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const rpc = (method, ...args) => new Promise((resolve, reject) => {
  const id = String(++sequence); pending.set(id, { resolve, reject });
  send({ kind: 'request', id, method, args });
});
async function main(start) {
  if (!start || typeof start.prompt !== 'string' || typeof start.model !== 'string' || (start.profile === 'anthropic' ? !['low', 'medium', 'high', 'xhigh', 'max'].includes(start.effort) || !start.claudeOptions || typeof start.claudeOptions.tools !== 'string' : start.effort !== 'low') ||
      !Number.isSafeInteger(start.maxRequestBytes) || start.maxRequestBytes < 1 || start.maxRequestBytes > 2_000_000 ||
      !Number.isSafeInteger(start.maxConcurrency) || start.maxConcurrency < 1 || start.maxConcurrency > 8 ||
      !Number.isSafeInteger(start.maxOutputBytes) || start.maxOutputBytes < 1 || start.maxOutputBytes > 2_000_000) throw new Error('Invalid bounded baseline invocation');
  Object.freeze(start);
  const recovery = start.nativeRecovery;
  if (recovery && (Object.keys(recovery).some(key => !['mode', 'sessionId'].includes(key)) || !['start', 'resume'].includes(recovery.mode) || (true) && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(recovery.sessionId))) throw new Error('Exact native recovery invocation required');
  const recoveryModule = recovery ? await import('./native-recovery.ts') : undefined;
  const gate = recoveryModule ? new recoveryModule.NativeSessionEvents('claude', recovery.sessionId, start.maxOutputBytes) : undefined;
  if (gate) recoveryModule.assertNativeLaunchContext(start.nativeLaunch);
  let nativeProcess;
  let recoveryError;
  const home = recovery ? '/work/.aeon-native-state/claude/home' : '/tmp/aeon-baseline-home'; mkdirSync(`${home}/claude`, { recursive: true, mode: 0o700 });
  let child, inFlight = 0, stopped = false;
  const refusedRoutes = [];
  const server = createServer(async (request, response) => {
    // No proxy routes, provider URL selection, WebSocket or ambient authentication.
    if (request.method !== 'POST' || !['/v1/messages', '/v1/messages?beta=true'].includes(request.url) || stopped || inFlight >= start.maxConcurrency) {
      if (refusedRoutes.length < 64) refusedRoutes.push({ method: request.method, path: request.url?.slice(0, 256), inFlight, stopped });
      else child?.kill('SIGKILL');
      response.writeHead(403).end(); return;
    }
    inFlight++; let bytes = 0; const chunks = [];
    try {
      for await (const chunk of request) { bytes += chunk.length; if (bytes > start.maxRequestBytes) throw new Error('Oversized baseline request'); chunks.push(chunk); }
      if (stopped) throw new Error('Baseline bridge stopped while reading request');
      if (gate) recoveryModule.assertNativeProcessLifetime(nativeProcess, start.nativeLaunch, false);
      const payload = Buffer.concat(chunks).toString('utf8');
      const reply = await rpc('baseline.provider', { method: request.method, path: '/v1/messages', payload,
        ...(gate ? { nativeSession: gate.beforeProvider() } : {}), nativeHttp: { path: request.url, headers: request.headers } });
      if (!reply || !Number.isInteger(reply.status) || typeof reply.body !== 'string' || typeof reply.contentType !== 'string') throw new Error('Invalid host response');
      response.writeHead(reply.status, { 'Content-Type': reply.contentType }).end(reply.body);
    } catch {
      stopped = true;
      response.writeHead(502).end('Host observer refused or could not complete the physical attempt');
      // Refusal/unknown usage ends this original grant; do not encourage native retries.
      child?.kill('SIGTERM');
    }
    finally { inFlight--; }
  });
  stop = () => {
    stopped = true; child?.kill('SIGTERM'); server.closeAllConnections();
    for (const request of pending.values()) request.reject(new Error('Host protocol stopped'));
    pending.clear();
  };
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  // Permission bypass applies only inside the independently imposed namespace.
  const { args, environment } = claudeInvocation(start, port);
  child = spawn('/app/claude', args, { cwd: '/work', env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  let outputBytes = 0, exceeded = false; const stdout = [], stderr = [];
  const collect = destination => chunk => {
    const remaining = Math.max(0, start.maxOutputBytes - outputBytes); destination.push(chunk.subarray(0, remaining)); outputBytes += chunk.length;
    if (outputBytes > start.maxOutputBytes) { exceeded = true; child.kill('SIGKILL'); }
  };
  child.stdout.on('data', chunk => {
    collect(stdout)(chunk);
    if (gate) try { gate.feed(chunk); } catch (error) { recoveryError = error.message; stopped = true; child.kill('SIGTERM'); }
  }); child.stderr.on('data', collect(stderr));
  child.stdin.on('error', () => {});
  if (!gate) child.stdin.end(start.prompt);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (nativeProcess) nativeProcess.close = { event: 'close', pid: child.pid, atNs: process.hrtime.bigint().toString(), code, signal };
      resolve({ code, signal });
    });
    child.once('spawn', () => {
      if (!gate) return;
      nativeProcess = recoveryModule.observeNativeProcessSpawn(child.pid, start.nativeLaunch);
      if (nativeProcess.observationError) { recoveryError = nativeProcess.observationError; stopped = true; child.kill('SIGTERM'); return; }
      child.stdin.end(start.prompt);
    });
  });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (pending.size) throw new Error('Baseline exited with a physical observation pending');
  if (gate && !recoveryError) try { gate.finish(); } catch (error) { recoveryError = error.message; }
  send({ kind: 'done', value: { ...result, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exceeded, refusedRoutes, ...(gate ? { recoveryError: recoveryError ?? null, nativeProcess: nativeProcess ?? null } : {}), invocation: { executable: '/app/claude', args, environment, authentication: 'dummy-bridge-token-only', maxConcurrency: start.maxConcurrency, maxRequestBytes: start.maxRequestBytes } } });
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
  } catch { stop(); process.exitCode = 1; input.close(); process.stdin.destroy(); }
});
