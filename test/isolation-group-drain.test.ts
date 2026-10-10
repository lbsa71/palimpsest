import assert from 'node:assert/strict';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IsolationError, runIsolated } from '../src/isolation.ts';
import { withIsolationOwnership } from '../src/isolation-ownership.ts';

const darwin = { skip: process.platform !== 'darwin' }, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }
function groupAlive(pid: number): boolean { try { process.kill(-pid, 0); return true; } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === 'ESRCH') return false; if (code === 'EPERM') return true; throw error; } }
async function until(predicate: () => boolean) { const start = performance.now(); while (!predicate()) { if (performance.now() - start > 3000) throw new Error('Actual group observation deadline'); await pause(10); } }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-group-drain-')), work = join(root, 'work'); mkdirSync(work);
  return { root, work, writer: join(work, 'writer'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function processGroup(pid: number): number { return Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); }

function launch(f: ReturnType<typeof fixture>, mode: 'natural' | 'leader-kill' | 'abort', owned: boolean) {
  const controller = new AbortController(); let leader: ChildProcess | undefined, descendant: number | undefined, scratch: string | undefined, leaderClosed = false, drained = false, receive!: () => void;
  const ready = new Promise<void>(resolve => { receive = resolve; }); let stream = '';
  const writer = `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(f.writer)},'started\\n');setInterval(()=>{try{fs.appendFileSync(${JSON.stringify(f.writer)},'tick\\n');}catch{}},10);`;
  const helper = `const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e',${JSON.stringify(writer)}],{detached:false,stdio:'ignore'});child.unref();console.log(JSON.stringify({leader:process.pid,descendant:child.pid,scratch:process.env.HOME}));${mode === 'natural' ? 'setTimeout(()=>process.exit(0),150)' : 'setInterval(()=>{},1000)'};`;
  const run = () => runIsolated({ program: process.execPath, args: ['-e', helper], cwd: f.work, writePaths: [f.work], allowNodeChildren: true, timeoutMs: 2000, signal: controller.signal,
    onSpawn(child) { leader = child; child.once('close', () => { leaderClosed = true; }); },
    onStdout(chunk) { stream += chunk.toString(); const end = stream.indexOf('\n'); if (end >= 0 && !descendant) { const line = JSON.parse(stream.slice(0, end)); assert.equal(line.leader, leader!.pid); descendant = line.descendant; scratch = line.scratch; receive(); } },
  });
  const pending = owned ? withIsolationOwnership({ signal: controller.signal, beforeSpawn: () => 'group-1', spawned: () => {}, drained() {
    assert.equal(leaderClosed, true); assert.equal(groupAlive(leader!.pid!), false, 'group absence precedes durable drain'); assert.equal(alive(descendant!), false);
    assert.equal(existsSync(scratch!), false); drained = true;
  } }, run) : run();
  // Attach rejection consumption now: red/negative probes must still clean up
  // their actual continuously observed group without an unhandled rejection.
  void pending.catch(() => {});
  return { controller, pending, ready, leader: () => leader!, descendant: () => descendant!, scratch: () => scratch!, drained: () => drained,
    async start() { await Promise.race([ready, pending.then(() => { throw new Error('Helper ended before descendant identity'); })]); await until(() => existsSync(f.writer) && statSync(f.writer).size > 0); assert.equal(processGroup(descendant!), leader!.pid); },
    async cleanup() {
      controller.abort();
      if (leader?.pid && groupAlive(leader.pid)) { assert.equal(processGroup(descendant!), leader.pid, 'cleanup uses only this continuously owned inherited group'); process.kill(-leader.pid, 'SIGKILL'); await until(() => !groupAlive(leader!.pid!)); }
      await pending.catch(() => {}); if (scratch) rmSync(scratch, { recursive: true, force: true }); f.cleanup();
    },
  };
}

for (const mode of ['natural', 'leader-kill', 'abort'] as const) for (const owned of [false, true]) {
  test(`${mode} ${owned ? 'owned' : 'ordinary'} finite helper drains same-group ignored-stdio children before releasing its paths`, darwin, async () => {
    const f = fixture(), p = launch(f, mode, owned);
    try {
      await p.start(); if (mode === 'leader-kill') p.leader().kill('SIGKILL'); if (mode === 'abort') p.controller.abort();
      const result = await p.pending;
      assert.equal(groupAlive(p.leader().pid!), false); assert.equal(alive(p.descendant()), false); assert.equal(existsSync(p.scratch()), false);
      assert.equal(p.drained(), owned); assert.equal(result.timedOut, false); assert.equal(result.aborted, mode === 'abort');
      if (mode === 'natural') assert.equal(result.exitCode, 0); if (mode === 'leader-kill') assert.equal(result.signal, 'SIGKILL');
      const settled = readFileSync(f.writer, 'utf8'); await pause(40); assert.equal(readFileSync(f.writer, 'utf8'), settled, 'no descendant writes after settlement');
    } finally { await p.cleanup(); }
  });
}

for (const fault of ['observation-eperm', 'observation-eio', 'kill-eperm'] as const) {
  test(`${fault} retains actual scratch and emits no drain when group absence is unproved`, darwin, async t => {
    const f = fixture(), p = launch(f, 'leader-kill', true), originalKill = process.kill; let observations = 0;
    try {
      await p.start();
      t.mock.method(process, 'kill', ((pid: number, signal?: number | NodeJS.Signals) => {
        if (pid === -p.leader().pid! && ((fault !== 'kill-eperm' && signal === 0) || (fault === 'kill-eperm' && signal === 'SIGKILL'))) {
          observations++; const error = new Error('Injected OS group observation/termination uncertainty') as NodeJS.ErrnoException; error.code = fault === 'observation-eio' ? 'EIO' : 'EPERM'; throw error;
        }
        return originalKill(pid, signal);
      }) as typeof process.kill);
      const started = performance.now(); p.leader().kill('SIGKILL');
      await assert.rejects(p.pending, error => { assert.ok(error instanceof IsolationError); assert.match(error.message, /group.*drain|drain.*group/i); return true; });
      assert.ok(performance.now() - started < 2500, 'uncertain drain has a finite observation limit'); assert.ok(observations > 0);
      assert.equal(p.drained(), false); assert.equal(existsSync(p.scratch()), true); assert.equal(alive(p.descendant()), true, 'actual ignored-stdio writer remains held');
    } finally { t.mock.restoreAll(); await p.cleanup(); }
  });
}
