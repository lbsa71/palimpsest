import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../storage/index.ts';
import { InitiativeRegistry } from '../goals/index.ts';
import { ObligationRegistry } from '../obligations/index.ts';
import { FairScheduler, type SchedulerPolicy } from '../scheduling/index.ts';

test('trusted unlimited lifetime preserves original scheduler usage, rate windows and fair cursor across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-scheduler-lifetime-')), filename = join(directory, 'state.sqlite');
  let store = new OperationalStore({ filename }), serial = 0;
  const environment = { newId: () => `scheduler-event-${++serial}`, compareIds: (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0 };
  const at = (ms: number) => new Date(ms).toISOString(), scope = { kind: 'public' as const };
  const resources = { maxRequests: 30, maxTokens: 100, maxCostUsd: 1, maxElapsedMs: 10000, maxConcurrency: 1 };
  const policy: SchedulerPolicy = { windowMs: 1000, maxSlicesPerWindow: 3, maxLifetimeSlices: 1, quantumMs: 100, idleRetryMs: 10, maxStalls: 3, resources };
  const open = (unlimitedLifetime?: boolean, startedAt = 0) => new FairScheduler(store, new InitiativeRegistry(store), new ObligationRegistry(store), 'ordinary', policy, startedAt, undefined, environment,
    unlimitedLifetime === undefined ? undefined : { unlimitedLifetime });
  try {
    const goals = new InitiativeRegistry(store, () => `goal-event-${++serial}`), obligations = new ObligationRegistry(store);
    for (const id of ['commitment', 'conversation', 'inquiry']) {
      const goal = goals.propose({ id, origin: id === 'conversation' ? { kind: 'request', inputId: 'conversation-input' } : { kind: 'self' }, purpose: `Observe ${id}`, scope,
        successCriteria: ['obtain a measured observation'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: `measure ${id}`, reviewAt: at(0) },
      { sourceIds: ['fixture'], actorId: 'fixture', recordedAt: at(0), derivation: 'interpreted' });
      goals.accept(id, goal.revision, 'Finite scheduling fixture');
    }
    obligations.owe({ id: 'owed', inputId: 'owed-input', goalId: 'commitment', audience: scope, promisedOutcome: 'report measured result', dueAt: at(0) });
    const finite = open();
    const first = finite.select(at(0)); assert.equal(first.kind, 'selected');
    if (first.kind === 'selected') { assert.equal(first.selection.service, 'commitment'); assert.equal(first.sequence, 1); }
    assert.equal(finite.select(at(0)).kind, 'lifetime-exhausted');
    const original = finite.snapshot(), bound = open(true, 50000);
    assert.deepEqual(bound.snapshot(), original, 'Host binding does not reset any persisted scheduler state');
    for (const [service, sequence] of [['conversation', 2], ['inquiry', 3]] as const) {
      const decision = bound.select(at(0)); assert.equal(decision.kind, 'selected');
      if (decision.kind === 'selected') { assert.equal(decision.selection.service, service); assert.equal(decision.sequence, sequence); }
    }
    const exhausted = bound.select(at(0)); assert.equal(exhausted.kind, 'window-exhausted');
    if (exhausted.kind === 'window-exhausted') assert.equal(exhausted.nextWakeup, at(1000));
    const beforeRestart = bound.snapshot(); store.close(); store = new OperationalStore({ filename });
    assert.deepEqual(open().snapshot(), beforeRestart);
    assert.equal(open().select(at(1000)).kind, 'lifetime-exhausted');
    assert.equal(open(false).select(at(1000)).kind, 'lifetime-exhausted');
    const resumed = open(true, 999999), next = resumed.select(at(1000)); assert.equal(next.kind, 'selected');
    if (next.kind === 'selected') { assert.equal(next.selection.service, 'commitment'); assert.equal(next.sequence, 4); }
    assert.equal(resumed.snapshot().startedAt, original.startedAt); assert.deepEqual(resumed.snapshot().policy, original.policy);
    assert.equal(resumed.snapshot().windowStartedAt, 1000); assert.equal(resumed.snapshot().windowSlices, 1);
    assert.throws(() => resumed.select(at(999)), /clock went backwards/);
    assert.throws(() => new FairScheduler(store, goals, obligations, 'ordinary', { ...policy, maxLifetimeSlices: 999 }, 1000, undefined, environment, { unlimitedLifetime: true }), /cannot reset or change/);
    assert.deepEqual(store.list('allocations'), []);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
