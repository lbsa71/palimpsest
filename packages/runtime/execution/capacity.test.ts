import assert from 'node:assert/strict';
import test from 'node:test';
import { CapacityUnavailable, BudgetExceeded } from '../resources/index.ts';
import { awaitCapacity } from './capacity.ts';

function changes() {
  const listeners = new Set<() => void>();
  return { subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify() { for (const listener of listeners) listener(); }, size: () => listeners.size };
}

test('capacity wait subscribes before attempt and does not lose an in-attempt release', async () => {
  const source = changes(); let attempts = 0, waiting = 0;
  const value = await awaitCapacity({ subscribe: source.subscribe, waiting() { waiting++; }, attempt() {
    assert.equal(source.size(), 1);
    if (++attempts === 1) { source.notify(); throw new CapacityUnavailable('occupied'); }
    return 'same request acquired';
  } });
  assert.equal(value, 'same request acquired'); assert.equal(attempts, 2); assert.equal(waiting, 1); assert.equal(source.size(), 0);
});

test('capacity wait retries only after a hint and removes abort and change listeners', async () => {
  const source = changes(), controller = new AbortController(); let attempts = 0;
  const pending = awaitCapacity({ subscribe: source.subscribe, signal: controller.signal, waiting() {}, attempt() {
    attempts++; throw new CapacityUnavailable('occupied');
  } });
  assert.equal(attempts, 1); await Promise.resolve(); assert.equal(attempts, 1);
  source.notify(); await Promise.resolve(); assert.equal(attempts, 2);
  controller.abort(Error('shutdown')); await assert.rejects(pending, /shutdown/);
  assert.equal(source.size(), 0); source.notify(); assert.equal(attempts, 2);
});

test('permanent budget failures and already aborted waits do not enter a queue', async () => {
  for (const signal of [undefined, AbortSignal.abort(Error('cancelled'))]) {
    const source = changes(); let attempts = 0, waits = 0;
    const pending = awaitCapacity({ subscribe: source.subscribe, signal, waiting() { waits++; }, attempt() {
      attempts++; throw new BudgetExceeded('spent');
    } });
    await assert.rejects(pending, signal ? /cancelled/ : BudgetExceeded);
    assert.equal(attempts, signal ? 0 : 1); assert.equal(waits, 0); assert.equal(source.size(), 0);
  }
});
