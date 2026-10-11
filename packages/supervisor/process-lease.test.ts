import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProcessLease } from './process-lease.ts';

test('exclusive supervisor lease rejects overlap and recovers after actual process death', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-process-lease-'));
  const path = join(root, 'lease.sqlite');
  const moduleUrl = new URL('./process-lease.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {ProcessLease} from ${JSON.stringify(moduleUrl)};
    const lease=new ProcessLease(${JSON.stringify(path)});
    console.log('held');setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Lease child did not start')), 5000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); if (code !== null) reject(new Error('Lease child exited early')); });
    });
    assert.throws(() => new ProcessLease(path), /holds the instance lease/);
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); await exited;
    const recovered = new ProcessLease(path);
    recovered.close();
  } finally { child.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
});
