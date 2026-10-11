import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DurableRuntime } from '../index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { setup, authority, envelope, input, prompt } from './fixtures.ts';

test('runtime rechecks host eligibility after stale scheduling, preserving steering and unrelated progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-start-gate-')), filename = join(root, 'state.sqlite');
  let calls = 0, messages: unknown[] = [];
  const f = setup(filename, { async run(value) { calls++; messages = value.messages; return { status: 'completed', observations: [] }; } });
  const options = { store: f.store, shell: f.runtime.shell, effects: f.effects, resources: f.resources,
    canResume: (run: { id: string }) => !f.store.get('host.activation-holds', run.id) };
  const runtime = new DurableRuntime(options), other = new OperationalStore({ filename });
  try {
    const run = runtime.admit(input, authority, envelope);
    assert.equal(options.canResume(run), true, 'An earlier scheduler read allowed this author');
    runtime.steer(run.id, { ...input, id: 'steering', externalId: 'steering', value: 'Preserve my next step' });
    other.put('host.activation-holds', run.id, { status: 'activating' }, null);
    const before = f.store.get('runs', run.id), allocations = f.store.list('allocations');
    assert.equal((await runtime.resume(run.id, prompt)).status, 'ready');
    assert.equal(calls, 0); assert.equal(f.resources.snapshot(run.id).requests, 0);
    assert.deepEqual(f.store.get('runs', run.id), before); assert.deepEqual(f.store.list('allocations'), allocations);
    assert.equal(f.store.get('execution', run.id), undefined);
    const unrelated = runtime.admit({ ...input, id: 'unrelated', externalId: 'unrelated' }, authority, envelope);
    assert.equal((await runtime.resume(unrelated.id, prompt)).status, 'completed'); assert.equal(calls, 1);
    const hold = other.get('host.activation-holds', run.id)!; other.delete('host.activation-holds', run.id, hold.revision);
    assert.equal((await runtime.resume(run.id, prompt)).status, 'completed'); assert.equal(calls, 2);
    assert.match(JSON.stringify(messages), /Preserve my next step/);
  } finally { other.close(); f.store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('host eligibility and running claim share a write lock, released before shell execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-start-lock-')), filename = join(root, 'state.sqlite');
  const locked = () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=1');
      try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); process.stdout.write('free'); }
      catch (error) { if (!/locked/.test(error.message)) throw error; process.stdout.write('locked'); }
      finally { db.close(); }
    `, filename], { encoding: 'utf8', env: {} });
    assert.equal(child.status, 0, child.stderr); return child.stdout;
  };
  let checks = 0;
  const f = setup(filename, { async run({ run }) {
    assert.equal(f.runtime.getRun(run.id)?.status, 'running'); assert.equal(locked(), 'free');
    return { status: 'completed', observations: [] };
  } });
  const options = { store: f.store, shell: f.runtime.shell, effects: f.effects, resources: f.resources,
    canResume: () => { checks++; assert.equal(locked(), 'locked'); return true; } };
  const runtime = new DurableRuntime(options);
  try {
    const run = runtime.admit(input, authority, envelope);
    const prepared = f.store.transaction(() => runtime.prepareResume(run.id));
    assert.equal(runtime.getRun(run.id)?.status, 'running'); assert.equal(checks, 1);
    assert.equal((await prepared.execute(prompt)).status, 'completed');
    await assert.rejects(prepared.execute(prompt), /already executed/);
  } finally { f.store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('rolled back prepared claims leak no active ownership; cancellation before execution invokes no shell', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-claim-rollback-')); let calls = 0;
  const f = setup(join(root, 'state.sqlite'), { async run() { calls++; return { status: 'completed', observations: [] }; } });
  try {
    const run = f.runtime.admit(input, authority, envelope);
    assert.throws(() => f.store.transaction(() => { f.runtime.prepareResume(run.id); throw Error('Scheduler selection rollback'); }), /rollback/);
    assert.equal(f.runtime.getRun(run.id)?.status, 'ready');
    const prepared = f.runtime.prepareResume(run.id);
    f.runtime.cancel(run.id, 'operator', 'Cancel before cognition');
    assert.equal((await prepared.execute(prompt)).status, 'cancelled'); assert.equal(calls, 0);
    const unrelated = f.runtime.admit({ ...input, id: 'next', externalId: 'next' }, authority, envelope);
    assert.equal((await f.runtime.resume(unrelated.id, prompt)).status, 'completed'); assert.equal(calls, 1);
  } finally { f.store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('withdrawal after a committed start fences cognition and preserves unconsumed steering for takeover', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-claim-withdraw-')); let calls = 0, messages: unknown[] = [];
  const f = setup(join(root, 'state.sqlite'), { async run(value) { calls++; messages = value.messages; return { status: 'completed', observations: [] }; } });
  try {
    const run = f.runtime.admit(input, authority, envelope), claim = f.runtime.prepareResume(run.id);
    f.runtime.steer(run.id, { ...input, id: 'late-steering', externalId: 'late-steering', value: 'Retain this across authority transfer' });
    const successor = f.withdraw();
    assert.equal((await claim.execute(prompt)).status, 'waiting'); assert.equal(calls, 0);
    assert.equal(f.resources.snapshot(run.id).requests, 0);
    const allocation = f.store.get('allocations', run.id);
    f.runtime.adopt(run.id, successor);
    assert.equal((await f.runtime.resume(run.id, prompt)).status, 'completed'); assert.equal(calls, 1);
    assert.match(JSON.stringify(messages), /Retain this across authority transfer/);
    assert.deepEqual(f.store.get('allocations', run.id), allocation);
  } finally { f.store.close(); rmSync(root, { recursive: true, force: true }); }
});
