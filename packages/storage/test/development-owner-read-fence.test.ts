import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { OperationalStore } from '../index.ts';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-owner-read-fence-'));
  const store = new OperationalStore({ filename: join(directory, 'owner.sqlite') });
  store.put('owner', 'value', { retained: true }, null);
  const artifact = store.putArtifact('retained bytes');
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, artifact };
}

test('owner read-only fence supports nested ordinary read transactions without journal metadata', t => {
  const { store, artifact } = fixture(t);
  const value = store.transaction(() => store.withDevelopmentReadOnly(() => store.transaction(() => {
    assert.equal(store.documentJournalBinding(), null);
    assert.deepEqual(store.get('owner', 'value')!.value, { retained: true });
    return Buffer.from(store.readArtifact(artifact, 100)).toString();
  })));
  assert.equal(value, 'retained bytes'); assert.equal(store.transactionActive, false);
});

test('every public owner mutation and close refuses before changing stored bytes', t => {
  const { store } = fixture(t), before = store.events();
  store.withDevelopmentReadOnly(() => {
    for (const mutate of [
      () => store.put('owner', 'value', { changed: true }, 1),
      () => store.delete('owner', 'value', 1),
      () => store.append({ id: 'forbidden', stream: 'owner', type: 'write', data: true }),
      () => store.putArtifact('forbidden artifact'),
      () => store.putJsonArtifact({ forbidden: true }),
      () => store.withdrawDocumentJournalContent({ id: 'forbidden-withdrawal', reason: 'forget', targets: [] }),
      () => store.close(),
    ]) assert.throws(mutate, /source writes forbidden/);
    assert.deepEqual(store.get('owner', 'value')!.value, { retained: true });
  });
  assert.deepEqual(store.events(), before);
  store.put('owner', 'after', true, null); assert.ok(store.get('owner', 'after'));
});

test('owner read-only fence refuses reentry and restores ordinary writes after a throw', t => {
  const { store } = fixture(t), error = new Error('callback failed');
  assert.throws(() => store.withDevelopmentReadOnly(() => {
    assert.throws(() => store.withDevelopmentReadOnly(() => assert.fail('reentry')), /reentrant/);
    throw error;
  }), value => value === error);
  store.put('owner', 'after-throw', true, null); assert.equal(store.transactionActive, false);
});

for (const kind of ['object', 'function'] as const) test(`owner read-only fence refuses ${kind} thenables without invoking then`, t => {
  const { store } = fixture(t); let called = false;
  const thenable = Object.assign(kind === 'object' ? {} : () => {}, { then() { called = true; } });
  assert.throws(() => store.withDevelopmentReadOnly(() => thenable), /synchronous/);
  assert.equal(called, false); store.put('owner', `after-${kind}`, true, null);
});
