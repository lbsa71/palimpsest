import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Goal, InboundInput, JsonValue } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DriveRegistry, InitiativeRegistry, PlanRegistry, initiativeTools } from '../packages/initiative/index.ts';
import { bindGoalOrigins, proposalProvenance } from './proposal-origin.ts';
import type { EvolutionContext } from './evolution-tools.ts';

test('host goal origin follows independent ancestry and cannot launder a human goal through initiative', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-origin-')); const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const memory = new DevelopmentalMemory(store), goals = new InitiativeRegistry(store), drives = new DriveRegistry(store, memory), plans = new PlanRegistry(store);
  const scope = { kind: 'public' } as const, authority = { generation: 'g1', epoch: 1, controlRevision: 'controls' };
  const resources = { maxRequests: 20, maxTokens: 100000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 1 };
  const context = (runId: string): EvolutionContext => ({ runId, scope, authority, store, workspace: root });
  const admit = (runId: string, source: string, externalId: string) => { const input: InboundInput = { id: `input:${runId}`, source, externalId, externalRevision: '1', actorId: source === 'direct' ? 'human' : 'g1', authenticated: true, scope, value: 'fixture' }; store.append({ id: `admitted:${runId}`, stream: runId, type: 'admitted', data: input }); };
  const call = (runId: string, name: string, args: JsonValue) => bindGoalOrigins(context(runId), initiativeTools(goals, drives, plans, scope, 'g1', resources, runId)).find(tool => tool.name === name)!.execute(args) as Goal;
  const propose = (runId: string, id: string) => call(runId, 'initiative_goal_propose', { id, purpose: 'Investigate actual evidence', successCriteria: ['observe result'], sourceIds: ['experience'], resources, priority: 1, nextAction: 'inspect', reviewAt: new Date(Date.now() + 60000).toISOString() });
  try {
    memory.ingest({ id: 'experience', runId: 'prior', sourceId: 'host-fixture', actorId: 'host', channel: 'action', scope, at: new Date().toISOString(), content: 'Attributed fixture evidence.' });
    admit('human', 'direct', 'human'); const humanGoal = propose('human', 'human-goal');
    assert.equal(store.get('host.release-self-origins', humanGoal.id), undefined);
    admit('human-derived', 'initiative', humanGoal.id); store.put('initiative.execution', humanGoal.id, { runId: 'human-derived' }, null);
    propose('human-derived', 'laundered-child'); assert.equal(store.get('host.release-self-origins', 'laundered-child'), undefined);
    assert.throws(() => proposalProvenance(context('human-derived')), /independently originated/);
    admit('bootstrap', 'host.bootstrap', 'development:v1'); store.put('host.bootstrap', 'development:v1', { runId: 'bootstrap' }, null);
    const parent = propose('bootstrap', 'chosen-parent'); assert.ok(store.get('host.release-self-origins', parent.id));
    admit('independent', 'initiative', parent.id); store.put('initiative.execution', parent.id, { runId: 'independent' }, null);
    const child = propose('independent', 'chosen-child'); assert.equal(store.get<{ basis: string }>('host.release-self-origins', child.id)?.value.basis, 'independent-initiative');
    assert.deepEqual(proposalProvenance(context('independent')), { kind: 'self', inputId: 'input:independent', goalId: parent.id, actorId: 'g1' });
    call('human', 'initiative_goal_revise', { id: child.id, expectedRevision: child.revision, nextAction: 'human-supplied operation', reason: 'new instruction' });
    assert.equal(store.get('host.release-self-origins', child.id), undefined, 'same-purpose human action revision must revoke independent origin');
    const revised = goals.goal(child.id)!;
    call('independent', 'initiative_goal_revise', { id: child.id, expectedRevision: revised.revision, reason: 'autonomous reconsideration', nextAction: 'inspect' });
    assert.equal(store.get('host.release-self-origins', child.id), undefined, 'editing a human-directed goal does not mint new independent origin');
    const originalPut = store.put.bind(store);
    store.put = (namespace, key, value, expected) => { if (namespace === 'host.release-self-origins') throw new Error('marker persistence unavailable'); return originalPut(namespace, key, value, expected); };
    assert.throws(() => propose('bootstrap', 'atomic-goal'), /marker persistence/); store.put = originalPut;
    assert.equal(goals.goal('atomic-goal'), undefined, 'goal and authenticated origin must commit together');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
