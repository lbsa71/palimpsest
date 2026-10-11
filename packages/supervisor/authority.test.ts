import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AuthorityStore } from './authority.ts';

test('independent receivers fence an old worker and persist withdrawal across restart', () => {
  const path = mkdtempSync(join(tmpdir(), 'aeon-authority-'));
  const first = new AuthorityStore(join(path, 'authority.sqlite'));
  const second = new AuthorityStore(join(path, 'authority.sqlite'));
  try {
    const original = first.bootstrap('worker-one', 'control-v1', 'artifact-one');
    second.assert(original);
    assert.throws(() => second.bootstrap('duplicate', 'control-v1', 'artifact-one'), /already initialized/);
    const withdrawn = first.withdraw(original);
    let invoked = false;
    assert.throws(() => second.dispatch(original, () => { invoked = true; }), /withdrawn/);
    assert.equal(invoked, false);
    const third = new AuthorityStore(join(path, 'authority.sqlite'));
    try {
      assert.equal(third.current()?.generation, null);
      const successor = third.activate(withdrawn, 'worker-two', 'control-v1', 'artifact-two');
      assert.ok(successor.epoch > original.epoch);
      first.assert(successor);
      assert.throws(() => second.activate(withdrawn, 'duplicate', 'control-v1', 'artifact-two'), /exact withdrawn/);
      assert.throws(() => first.assert(original), /withdrawn/);
      assert.deepEqual(third.history().map(event => event.kind), ['bootstrap', 'withdraw', 'activate']);
    } finally { third.close(); }
  } finally { first.close(); second.close(); rmSync(path, { recursive: true, force: true }); }
});

test('recovery can grant retained code a newer authority without a model', () => {
  const path = mkdtempSync(join(tmpdir(), 'aeon-recovery-'));
  const store = new AuthorityStore(join(path, 'authority.sqlite'));
  try {
    const original = store.bootstrap('one', 'control-v1', 'retained-rescue');
    const successor = store.activate(store.withdraw(original), 'two', 'control-v2', 'candidate');
    const recovered = store.activate(store.withdraw(successor), 'rescue', 'control-v1', 'retained-rescue');
    assert.ok(recovered.epoch > successor.epoch);
    store.assert(recovered);
    assert.throws(() => store.assert(successor), /withdrawn/);
  } finally { store.close(); rmSync(path, { recursive: true, force: true }); }
});
