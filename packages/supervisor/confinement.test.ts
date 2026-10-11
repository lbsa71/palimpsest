import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { confinementArguments, runConfined, type ConfinedCommand } from './confinement.ts';

function fixture(): { root: string; command: ConfinedCommand; secret: string } {
  const root = mkdtempSync(join(tmpdir(), 'aeon-confinement-'));
  const workspace = join(root, 'work');
  const protectedPath = join(root, 'state');
  mkdirSync(workspace); mkdirSync(protectedPath);
  const secret = join(protectedPath, 'private-state');
  writeFileSync(secret, 'latest-lived-state');
  return { root, secret, command: { workspace, protectedPaths: [protectedPath],
    executable: '/runtime/node', nodeBinary: process.execPath, args: [], timeoutMs: 5000, maxOutputBytes: 65536 } };
}

test('real confined process can edit workspace but cannot see private state, host env or host processes', async () => {
  const { root, command, secret } = fixture();
  try {
    const result = await runConfined({ ...command, args: ['--input-type=module', '-e', `
      import {existsSync,writeFileSync,readFileSync} from 'node:fs';
      if(existsSync(${JSON.stringify(secret)})) throw Error('private state visible');
      if(process.env.HOME || process.env.AEON_TEST_SECRET) throw Error('host environment visible');
      writeFileSync('/work/result','edited inside namespace');
      console.log(readFileSync('/proc/1/status','utf8').includes('NSpid:'));
    `] });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(readFileSync(join(command.workspace, 'result'), 'utf8'), 'edited inside namespace');
    assert.equal(readFileSync(secret, 'utf8'), 'latest-lived-state');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('overlapping state mount is refused before spawning', () => {
  const { root, command } = fixture();
  try { assert.throws(() => confinementArguments({ ...command, workspace: root }), /overlaps/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('a preexisting hardlink into protected state is refused before spawning', () => {
  const { root, command, secret } = fixture();
  try {
    linkSync(secret, join(command.workspace, 'hidden-alias'));
    assert.throws(() => confinementArguments(command), /hardlink/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('timeout terminates the namespace including a child that creates a new process group', async () => {
  const { root, command } = fixture();
  try {
    const result = await runConfined({ ...command, timeoutMs: 300, executable: '/bin/sh', args: ['-c',
      "setsid /bin/sh -c 'sleep 1; echo escaped > /work/escaped' & wait"] });
    assert.equal(result.stoppedFor, 'timeout');
    await new Promise(resolve => setTimeout(resolve, 1100));
    const check = await runConfined({ ...command, executable: '/bin/sh', args: ['-c', 'test ! -e /work/escaped'] });
    assert.equal(check.exitCode, 0, check.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stream output and cancellation limits stop real commands', async () => {
  const { root, command } = fixture();
  try {
    const flooded = await runConfined({ ...command, executable: '/bin/sh', args: ['-c', 'yes x'], maxOutputBytes: 128 });
    assert.equal(flooded.stoppedFor, 'output-limit');
    assert.ok(Buffer.byteLength(flooded.stdout) + Buffer.byteLength(flooded.stderr) <= 128);
    const controller = new AbortController();
    const running = runConfined({ ...command, executable: '/bin/sh', args: ['-c', 'sleep 10'], signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    assert.equal((await running).stoppedFor, 'cancelled');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
