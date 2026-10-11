import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runWorker } from './worker-process.ts';
import type { ConfinedCommand } from './confinement.ts';

function setup(code: string) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-worker-'));
  mkdirSync(join(root, 'workspace')); mkdirSync(join(root, 'protected'));
  const command: ConfinedCommand = { workspace: join(root, 'workspace'), protectedPaths: [join(root, 'protected')],
    nodeBinary: process.execPath, executable: '/runtime/node', args: ['--input-type=module', '-e', code],
    timeoutMs: 3000, maxOutputBytes: 65536 };
  return { root, command };
}

test('isolated worker receives only host-approved RPC results', async () => {
  const { root, command } = setup(`
    import {createInterface} from 'node:readline';
    const input=createInterface({input:process.stdin});
    input.on('line',line=>{
      const message=JSON.parse(line);
      if(message.kind==='start') console.log(JSON.stringify({kind:'request',id:'one',method:'inspect',args:[message.value]}));
      else if(message.kind==='reply') console.log(JSON.stringify({kind:'done',value:message.value}));
    });
  `);
  try {
    const value = await runWorker({ command, initial: 'assigned-run', maxRequests: 2, maxMessageBytes: 4096,
      async handle(method, args) { assert.equal(method, 'inspect'); assert.deepEqual(args, ['assigned-run']); return { observed: 'actual host receipt' }; } });
    assert.deepEqual(value, { observed: 'actual host receipt' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('duplicate RPC IDs and malformed protocol cannot bypass the host', async () => {
  const { root, command } = setup(`process.stdin.once('data',()=>{const m=JSON.stringify({kind:'request',id:'same',method:'effect',args:[]});console.log(m);console.log(m)});`);
  let calls = 0;
  try {
    await assert.rejects(runWorker({ command, initial: null, maxRequests: 5, maxMessageBytes: 4096,
      async handle() { calls++; return null; } }), /duplicate worker request/);
    assert.equal(calls, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worker refusal is redacted and cancellation reaches an in-flight handler', async () => {
  const { root, command } = setup(`process.stdin.once('data',()=>console.log(JSON.stringify({kind:'request',id:'wait',method:'wait',args:[]})));setInterval(()=>{},1000);`);
  const controller = new AbortController();
  let interrupted = false;
  try {
    await assert.rejects(runWorker({ command: { ...command, signal: controller.signal }, initial: null, maxRequests: 5, maxMessageBytes: 4096,
      handle(_method, _args, signal) { setTimeout(() => controller.abort(), 20); return new Promise(resolve => signal.addEventListener('abort', () => { interrupted = true; resolve(null); }, { once: true })); } }), /cancelled/);
    assert.equal(interrupted, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
