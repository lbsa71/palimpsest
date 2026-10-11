import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DriveRegistry, InitiativeRegistry, PlanRegistry, initiativeTools } from '../packages/initiative/index.ts';
import { mindDevelopmentTools } from './development-tools.ts';
import type { DataScope, Observation } from '../packages/contracts/index.ts';
const publicScope = { kind: 'public' } as const;
const privateScope: DataScope = { kind: 'restricted', principals: ['alice'] };
const at = '2026-10-11T12:00:00.000Z';
const resources = { maxRequests: 20, maxTokens: 10000, maxCostUsd: 1, maxElapsedMs: 10000, maxConcurrency: 2 };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-app-boundary-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite'), checkoutRoot: process.cwd() });
  const memory = new DevelopmentalMemory(store), goals = new InitiativeRegistry(store), drives = new DriveRegistry(store, memory), plans = new PlanRegistry(store);
  return { store, memory, goals, drives, plans, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
function propose(f: ReturnType<typeof fixture>) {
  return f.goals.propose({ id: 'public-goal', origin: { kind: 'self' }, purpose: 'Investigate public evidence', scope: publicScope, successCriteria: ['observed result'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'observe', reviewAt: at }, { sourceIds: ['public-source'], actorId: 'mind', recordedAt: at, derivation: 'interpreted' });
}
test('private-context goal revisions cannot publish private text into a wider agenda', () => {
  const f = fixture();
  try {
    const goal = propose(f);
    const tools = initiativeTools(f.goals, f.drives, f.plans, privateScope, 'mind', resources, 'unrelated-run');
    assert.throws(() => tools.find(t => t.name === 'initiative_goal_revise')!.execute({ id: goal.id, expectedRevision: goal.revision, purpose: 'alice-secret', reason: 'private evidence alice-secret' }), /scope|audience/);
    assert.equal(JSON.stringify(f.goals.all(publicScope)).includes('alice-secret'), false);
  } finally { f.close(); }
});
test('forgetting public evidence does not reveal identifiers of private descendants', () => {
  const f = fixture();
  try {
    f.memory.ingest({ id: 'public-source', runId: 'prior', sourceId: 'public-input', actorId: 'mind', channel: 'speech', scope: publicScope, at, content: 'public evidence' });
    f.memory.derive({ id: 'alice-private-project', kind: 'belief', sourceIds: ['public-source'], content: 'private interpretation', confidence: .5, scope: privateScope, actorId: 'mind', at });
    const result = mindDevelopmentTools(f.memory, publicScope, 'mind').find(t => t.name === 'memory_forget')!.execute({ memoryIds: ['public-source'] });
    assert.deepEqual(result, ['public-source']);
    assert.equal(f.memory.get('alice-private-project', privateScope), undefined);
  } finally { f.close(); }
});
test('goal progress cannot borrow another run execution through a same-audience tool', () => {
  const f = fixture();
  try {
    let goal = propose(f); goal = f.goals.accept(goal.id, goal.revision, 'adopt'); goal = f.goals.revise(goal.id, goal.revision, { status: 'running' }, 'observe');
    f.store.put('initiative.execution', goal.id, { runId: 'owning-run' }, null);
    const observation: Observation = { id: 'actual-result', runId: 'owning-run', stepId: 'actual-step', sourceId: 'actual-effect', kind: 'result', value: 'observed', provenance: { sourceIds: ['actual-effect'], actorId: 'tool', recordedAt: at, derivation: 'observed' } };
    f.store.put('observations', observation.id, observation, null);
    const progress = initiativeTools(f.goals, f.drives, f.plans, publicScope, 'mind', resources, 'unrelated-run').find(t => t.name === 'initiative_goal_progress')!;
    assert.throws(() => progress.execute({ id: goal.id, expectedRevision: goal.revision, decision: { kind: 'complete', evidenceIds: [observation.id], reason: 'borrowed result' } }), /run|execution/);
    assert.equal(f.goals.goal(goal.id)?.status, 'running');
  } finally { f.close(); }
});
