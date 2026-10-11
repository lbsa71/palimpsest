import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationalStore, RevisionConflict } from '../index.ts';
function filename() { return join(mkdtempSync(join(tmpdir(), 'aeon-store-')), 'state.sqlite'); }
test('atomic projection/event rollback, CAS and reopened artifacts', () => {
  const path = filename(); const store = new OperationalStore({ filename: path });
  assert.throws(() => store.transaction(() => { store.put('runs', 'r', { status: 'ready' }, null); store.append({ id: 'e', stream: 'r', type: 'input', data: 1 }); throw Error('crash'); }));
  assert.equal(store.get('runs','r'), undefined); assert.equal(store.events().length, 0);
  assert.equal(store.put('runs','r',{ status: 'ready' },null),1);
  assert.throws(() => store.put('runs','r',{},null), RevisionConflict);
  const event = { id: 'e', stream: 'r', type: 'input', data: { x: 1 } };
  assert.equal(store.append(event).sequence,store.append(event).sequence);
  assert.throws(() => store.append({ ...event, data: 2 }));
  const ref = store.putArtifact({ observations: ['o1'] }); store.close();
  const reopened = new OperationalStore({ filename: path });
  assert.deepEqual(reopened.get('runs','r')?.value,{ status:'ready' });
  assert.deepEqual(reopened.readJsonArtifact(ref), { observations:['o1'] }); reopened.close();
});
test('checkout state and asynchronous transactions are refused', () => {
  assert.throws(() => new OperationalStore({ filename: '/tmp/checkout/state.sqlite', checkoutRoot: '/tmp/checkout' }));
  const store = new OperationalStore({ filename: filename() });
  assert.throws(() => store.transaction(() => Promise.resolve(1))); store.close();
});

test('dot-dot named checkout children and symlink aliases are rejected', async () => {
  const { mkdirSync, symlinkSync } = await import('node:fs');
  const root=mkdtempSync(join(tmpdir(),'aeon-checkout-'));mkdirSync(join(root,'checkout'));symlinkSync(join(root,'checkout'),join(root,'alias'));
  assert.throws(()=>new OperationalStore({filename:join(root,'checkout','..state','db.sqlite'),checkoutRoot:join(root,'checkout')}));
  assert.throws(()=>new OperationalStore({filename:join(root,'alias','db.sqlite'),checkoutRoot:join(root,'checkout')}));
});
test('incompatible and partially forged schemas produce open diagnostics', async () => {
  const { DatabaseSync }=await import('node:sqlite');const path=filename();const db=new DatabaseSync(path);db.exec('CREATE TABLE documents(wrong TEXT); CREATE TABLE events(sequence INTEGER); CREATE TABLE artifacts(bytes BLOB); PRAGMA user_version=1');db.close();
  assert.throws(()=>new OperationalStore({filename:path}),/cannot open operational state/);
});
