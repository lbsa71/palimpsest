import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { claudeInvocation } from './claude-configuration.ts';
import { NativeSessionEvents, assertNativeLaunchContext, assertNativeProcessLifetime, observeNativeProcessSpawn } from './native-recovery.ts';
const session = '01a12d06-adad-7263-ace7-6f49aff47d3f';
const tick = () => new Promise(resolve => setImmediate(resolve));
function worker(kind: 'codex' | 'claude', mode: 'start' | 'resume' | undefined, observationCause?: 'missing' | 'race' | 'parent') {
  let serve: (request: any, response: any) => Promise<void>;
  const input = new EventEmitter() as any; input.close = () => {};
  const child = new EventEmitter() as any; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {}; let killed = 0, prompts = 0; child.pid = 9; child.stdin.end = () => { prompts++; }; child.kill = () => { killed++; };
  const records: any[] = []; let invocation: any;
  const source = readFileSync(new URL(`./${kind}-worker.mjs`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace("await import('./native-recovery.ts')", '({ NativeSessionEvents, assertNativeLaunchContext, assertNativeProcessLifetime, observeNativeProcessSpawn })');
  runInNewContext(source, { Buffer, NativeSessionEvents, assertNativeLaunchContext, assertNativeProcessLifetime, claudeInvocation,
    observeNativeProcessSpawn: (pid: number, context: any) => {
      let reads = 0, clock = 1000n;
      const stat = (pid: number, ppid: number, ticks: string) => `${pid} (native (fixture) child) ${['S', String(ppid), ...Array(17).fill('0'), ticks, ...Array(30).fill('0')].join(' ')}\n`;
      return observeNativeProcessSpawn(pid, context, { workerPid: 8, now: () => String(clock++), readlink: () => 'pid:[1234]', read: path => {
        if (path.endsWith('/boot_id')) return `${context.hostBootId}\n`;
        if (path === '/proc/self/stat') return stat(8,1,'100');
        if (observationCause === 'missing') throw new Error('mock child path disappeared');
        return stat(pid, observationCause === 'parent' ? 7 : 8, observationCause === 'race' && reads++ ? '201' : '200');
      } });
    }, process: { pid: 8, hrtime: { bigint: () => 2000n }, stdout: { write: (line: string) => records.push(JSON.parse(line)) }, stdin: { destroy() {} } }, mkdirSync() {}, createInterface: () => input,
    spawn(executable: string, args: string[], options: any) { invocation = { executable, args, environment: options.env }; queueMicrotask(() => child.emit('spawn')); return child; },
    createServer(handler: typeof serve) { serve = handler; return { on() {}, once() {}, listen(_port: number, _host: string, ready: () => void) { ready(); }, address: () => ({ port: 12345 }), closeAllConnections() {}, close(done: () => void) { done(); } }; } });
  input.emit('line', JSON.stringify({ kind: 'start', value: { prompt: 'pure bridge fixture', model: 'fixture', effort: 'high', profile: 'anthropic', claudeOptions: { tools: 'Agent,Bash,Read,Write', delegation: 'isolated-native', modelRoles: { haiku: 'fixture', sonnet: 'fixture', opus: 'fixture', subagent: 'fixture' } }, maxConcurrency: 1, maxRequestBytes: 4096, maxOutputBytes: 4096, ...(mode ? { nativeLaunch: { generation: mode === 'resume' ? 2 : 1, manifestSha256: 'a'.repeat(64), priorCleanupSha256: mode === 'resume' ? 'b'.repeat(64) : null, hostBootId: '11111111-2222-3333-4444-555555555555', hostPid: 100, startedNs: '900' }, nativeRecovery: { mode, ...(kind === 'claude' || mode === 'resume' ? { sessionId: session } : {}) } } : {}) } }));
  const request = () => {
    const req = Readable.from([Buffer.from('{}')]) as any; req.method = 'POST'; req.url = kind === 'codex' ? '/v1/responses' : '/v1/messages'; req.headers = {};
    const response = { status: 0, writeHead(status: number) { this.status = status; return this; }, end() {} };
    return { response, completed: serve!(req, response) };
  };
  const startup = (id = session) => child.stdout.emit('data', Buffer.from(JSON.stringify(kind === 'codex' ? { type: 'thread.started', thread_id: id } : { type: 'system', subtype: 'init', session_id: id }) + '\n'));
  const reply = () => input.emit('line', JSON.stringify({ kind: 'reply', id: records[0].id, ok: true, value: { status: 200, contentType: 'text/event-stream', body: 'synthetic' } }));
  return { records, request, startup, reply, invocation: () => invocation, killed: () => killed, prompts: () => prompts, finish: async () => { child.emit('close', 0, null); await tick(); } };
}
for (const kind of ['codex', 'claude'] as const) {
  test(`${kind} fixed persistence argv/home omit only ordinary persistence refusal and select exact UUID resume`, async () => {
    const ordinary = worker(kind, undefined), start = worker(kind, 'start'), resumed = worker(kind, 'resume'); await tick();
    const flag = kind === 'codex' ? '--ephemeral' : '--no-session-persistence';
    assert.ok(ordinary.invocation().args.includes(flag)); assert.ok(!start.invocation().args.includes(flag)); assert.ok(!resumed.invocation().args.includes(flag));
    assert.equal(resumed.invocation().environment.HOME, `/work/.aeon-native-state/${kind}/home`);
    if (kind === 'codex') assert.deepEqual(Array.from(resumed.invocation().args.slice(-3)), ['resume', session, '-']);
    else { const args = resumed.invocation().args; assert.equal(args[args.indexOf('--resume') + 1], session); assert.ok(args.includes('--safe-mode')); assert.equal(resumed.invocation().environment.CLAUDE_CONFIG_DIR, '/work/.aeon-native-state/claude/home/claude'); }
    await Promise.all([ordinary.finish(), start.finish(), resumed.finish()]);
  });
  for (const cause of ['missing', 'wrong', 'late'] as const) test(`${kind} ${cause} actual identity stops the real bridge before host RPC`, async () => {
    const valid = worker(kind, 'resume'); await tick(); valid.startup(); const positive = valid.request(); await tick(); assert.equal(valid.records.length, 1); assert.equal(valid.records[0].args[0].nativeSession.sessionId, session); valid.reply(); await positive.completed; await valid.finish();
    const w = worker(kind, 'resume'); await tick();
    if (cause === 'wrong') w.startup('11111111-1111-4111-8111-111111111111');
    const attempted = w.request(); await attempted.completed;
    if (cause === 'late') w.startup();
    assert.equal(w.records.length, 0); assert.ok(w.killed() > 0); const next = w.request(); await next.completed; assert.equal(next.response.status, 403); await w.finish();
  });
}

for (const kind of ['codex','claude'] as const) test(`${kind} real bridge source observes spawned child before prompt/RPC and fails missing/racing/foreign-parent observations`, async () => {
  const positive = worker(kind, 'start'); await tick(); assert.equal(positive.prompts(), 1); positive.startup();
  const attempt = positive.request(); await tick(); assert.equal(positive.records.length, 1); positive.reply(); await attempt.completed;
  await positive.finish(); const outcome = positive.records.at(-1).value; assert.equal(outcome.nativeProcess.version, 'proc-child-lifetime-v1'); assert.equal(outcome.nativeProcess.pid, 9); assert.equal(outcome.nativeProcess.close.pid, 9); assert.equal(outcome.nativeProcess.close.atNs, '2000');
  for (const cause of ['missing','race','parent'] as const) {
    const refused = worker(kind, 'start', cause); await tick(); assert.equal(refused.prompts(), 0, cause); assert.ok(refused.killed() > 0, cause);
    const attempt = refused.request(); await attempt.completed; assert.equal(attempt.response.status, 403); assert.equal(refused.records.length, 0, 'no observer handoff');
    await refused.finish(); assert.ok(refused.records.at(-1).value.nativeProcess.observationError); assert.ok(refused.records.at(-1).value.recoveryError);
  }
});
