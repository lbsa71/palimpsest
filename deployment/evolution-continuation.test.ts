import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { candidateIdentity, identity, type EvaluationEvidence, type Run, type ShellResult } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { InitiativeRegistry } from '../packages/initiative/goals/index.ts';
import { ObligationRegistry } from '../packages/initiative/obligations/index.ts';
import { FairScheduler } from '../packages/initiative/scheduling/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ChangeRecord } from '../packages/release/proposals.ts';
import { EvolutionContinuations, reconcileEvaluationWatch, watchEvaluation } from './evolution-continuation.ts';
import { EvolutionMailbox } from './evolution-mailbox.ts';
import type { EvaluationRequest } from './evolution-tools.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-evolution-continuation-')), filename = join(root, 'operational.sqlite');
  const store = new OperationalStore({ filename }), authorities = new AuthorityStore(join(root, 'authority.sqlite'));
  const authority = authorities.bootstrap('author', 'old-controls', 'fixture-artifact');
  const scope = { kind: 'restricted' as const, principals: ['operator'] };
  const resources = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 100 });
  const envelope = { maxRequests: 100, maxTokens: 10000, maxCostUsd: 0, maxElapsedMs: 10000, maxConcurrency: 3 };
  resources.allocate('operating', envelope);
  const effects = new EffectJournal(store, authorities, { async dispatch() { throw Error('No physical effect in the continuation fixture'); }, async reconcile() { throw Error('No external repeat'); } });
  let calls = 0, continuations!: EvolutionContinuations;
  const runtime = new DurableRuntime({ store, resources, effects, shell: { async run(input) {
    calls++; const result: ShellResult = { status: 'completed', observations: [] };
    return continuations.preserveWaiting(input.run.id, result);
  } } });
  continuations = new EvolutionContinuations({ store, runtime, authorityStore: authorities });
  const run = runtime.admit({ id: 'input', source: 'direct', externalId: 'change', externalRevision: '1', authenticated: true, actorId: 'operator', scope, value: 'Engineering continuity fixture; H1 unaccepted.' }, authority, envelope, 'operating');
  const fields = { source: identity('source'), dependencies: identity('deps'), prompts: identity('prompts'), model: identity('model'), configuration: identity('config'), controls: authority.controlRevision, createdBy: authority.generation };
  const manifest = { ...fields, id: candidateIdentity(fields) };
  const experience = store.putArtifact('Engineering fixture evidence, not a qualification');
  const proposal: ChangeRecord = { id: 'change', runId: run.id, scope, authority, provenance: { kind: 'human', inputId: 'input', actorId: 'operator' }, justification: 'Observe continuation ordering', goal: { objective: 'Continue the original waiting run', successCriteria: ['no duplicate wake or physical redispatch'] }, experience, state: 'evaluation-dispatched', candidate: manifest, judgingPolicyDigest: identity('prior-policy') };
  const { state: _state, ...rest } = proposal;
  const request = { requestId: identity('review'), proposal: { ...rest, state: 'frozen' }, candidate: { manifest }, policyDigest: proposal.judgingPolicyDigest } as EvaluationRequest;
  store.put('release.changes', identity({ runId: run.id, id: proposal.id }), proposal, null);
  const mailbox = new EvolutionMailbox({ store, assertAuthority: grant => authorities.assert(grant), waitMs: 10, pollMs: 1 });
  mailbox.enqueueEvaluation(request); watchEvaluation(store, request, true);
  function complete() {
    const artifact = store.putArtifact('Engineering host result; no independently qualified live reviewer'), evaluatorArtifact = store.putArtifact('Engineering fixture evaluator');
    const evidence: EvaluationEvidence = { id: 'review-evidence', candidateId: manifest.id, controlRevision: authority.controlRevision, evaluatorId: 'external-fixture', evaluatorArtifact, independent: true,
      verdict: 'pass', artifact, caseResults: [{ id: 'continuity', status: 'pass', observations: artifact, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['Engineering fixture only; H1 unaccepted'] }] };
    mailbox.completeEvaluation(request.requestId, { receipt: { requestId: request.requestId, candidateId: manifest.id, policyDigest: request.policyDigest, evidence: [evidence], receipt: {} },
      proof: { proposal: { id: request.requestId, candidate: manifest, priorAuthority: authority, recoveryArtifact: artifact, evidence: [evidence] }, signed: [{ evidence, authentication: 'a'.repeat(64) }] } });
  }
  const prompt = { id: 'fixture-prompt', requestDigest: identity('no-physical-payload'), fragments: [] };
  return { root, filename, store, authorities, authority, scope, resources, runtime, continuations, run, request, mailbox, complete, envelope, prompt,
    calls: () => calls, close: () => { store.close(); authorities.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('known pending review immediately acknowledges enqueue and outlives its author slice without uncertain tool work', async () => {
  const f = fixture();
  try {
    assert.equal(f.mailbox.enqueueEvaluation(f.request).status, 'pending');
    assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'waiting');
    await new Promise(resolve => setTimeout(resolve, 40)); // Four times the old mailbox wait bound.
    assert.equal(f.mailbox.readEvaluation(f.request).status, 'pending');
    assert.deepEqual(f.continuations.wake(), []); assert.equal(f.calls(), 1);
    assert.equal(f.runtime.effects.unresolved(f.run.id).length, 0);
    assert.equal(f.resources.snapshot(f.run.id).requests, 0);
    assert.throws(() => f.mailbox.readEvaluation({ ...f.request, proposal: { ...f.request.proposal, runId: 'foreign' } }), /exact run/);
    assert.throws(() => f.mailbox.readEvaluation({ ...f.request, proposal: { ...f.request.proposal, scope: { kind: 'public' } } }), /exact run/);
  } finally { f.close(); }
});
test('host completion across reopened state wakes the original waiting author once and retains exact scoped result', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt); f.complete();
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const runtime = new DurableRuntime({ store: reopened, effects: f.runtime.effects, resources: f.resources, shell: f.runtime.shell });
      const continuation = new EvolutionContinuations({ store: reopened, runtime, authorityStore: f.authorities });
      assert.deepEqual(continuation.wake(), [f.run.id]); assert.deepEqual(continuation.wake(), []); assert.deepEqual(f.continuations.wake(), []);
      const events = reopened.events<any>(f.run.id).filter(event => event.type === 'steering');
      assert.equal(events.length, 1); assert.deepEqual(events[0]!.data.scope, f.scope);
      assert.equal(events[0]!.data.value.requestId, f.request.requestId);
      assert.equal(f.mailbox.readEvaluation(f.request).status, 'completed');
      assert.equal(f.mailbox.jobs().length, 1); assert.equal(f.calls(), 1);
      assert.ok(reopened.get('host.pending-runs', f.run.id));
    } finally { reopened.close(); }
  } finally { f.close(); }
});
test('cancelled, terminal, expired, scope-mismatched or withdrawn authors never wake', async () => {
  for (const reason of ['cancelled', 'completed', 'allocation', 'expired', 'scope', 'withdrawn']) {
    const f = fixture();
    try {
      await f.runtime.resume(f.run.id, f.prompt); f.complete();
      if (reason === 'cancelled') f.runtime.cancel(f.run.id, 'operator', 'Stop the finite fixture');
      if (reason === 'completed' || reason === 'scope') {
        const row = f.store.get<Run>('runs', f.run.id)!;
        f.store.put('runs', f.run.id, { ...row.value, ...(reason === 'completed' ? { status: 'completed' } : { scope: { kind: 'public' } }) }, row.revision);
      }
      if (reason === 'allocation') f.resources.cancel('operating');
      if (reason === 'expired') { const row = f.store.get<any>('allocations', 'operating')!; f.store.put('allocations', 'operating', { ...row.value, startedAt: Date.now() - 10001 }, row.revision); }
      if (reason === 'withdrawn') f.authorities.withdraw(f.authority);
      assert.deepEqual(f.continuations.wake(), [], reason); assert.equal(f.calls(), 1);
      assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 0);
    } finally { f.close(); }
  }
});
test('uncertain jobs remain inspectable without wake or reviewer repeat; declined subscription can finish', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt);
    await assert.rejects(f.mailbox.processEvaluation(f.request.requestId, async () => { throw Error('Lost physical reply'); }), /Lost physical reply/);
    assert.equal(f.mailbox.readEvaluation(f.request).status, 'uncertain'); assert.deepEqual(f.continuations.wake(), []);
    assert.equal(f.continuations.holds(f.run.id), true);
    watchEvaluation(f.store, f.request, false);
    assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'completed');
    f.complete(); assert.deepEqual(f.continuations.wake(), []); assert.equal(f.runtime.getRun(f.run.id)!.status, 'completed');
  } finally { f.close(); }
});
test('pending initiative review does not consume repeated scheduler lifetime slices and other goals stay fair', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt);
    const goals = new InitiativeRegistry(f.store), provenance = { sourceIds: ['fixture'], actorId: 'operator', recordedAt: new Date().toISOString(), derivation: 'observed' as const };
    let goal = goals.propose({ id: 'waiting-change', origin: { kind: 'self' }, purpose: 'Await exact external judgment', scope: f.scope, successCriteria: ['bound feedback'], evidenceIds: [], dependencyIds: [], resources: f.envelope, priority: 1, nextAction: 'read result', reviewAt: new Date().toISOString() }, provenance);
    goal = goals.accept(goal.id, goal.revision, 'Engineering eligible task');
    goals.revise(goal.id, goal.revision, { status: 'waiting', wakeup: { at: new Date().toISOString(), condition: 'external result' } }, 'Review is pending');
    f.store.put('initiative.execution', goal.id, { runId: f.run.id }, null);
    const policy = { windowMs: 10000, maxSlicesPerWindow: 8, maxLifetimeSlices: 8, quantumMs: 10, idleRetryMs: 1, maxStalls: 2, resources: f.envelope };
    const scheduler = new FairScheduler(f.store, goals, new ObligationRegistry(f.store), 'fixture', policy, Date.now(), value => f.continuations.eligibleGoal(value));
    for (let n = 0; n < 10; n++) assert.equal(scheduler.select(new Date().toISOString()).kind, 'idle');
    assert.equal(scheduler.snapshot().lifetimeSlices, 0); assert.equal(f.calls(), 1);
    let other = goals.propose({ ...goal, id: 'other', origin: { kind: 'self' }, purpose: 'Another eligible observation' }, provenance);
    other = goals.accept(other.id, other.revision, 'Other goal remains available');
    const selected = scheduler.select(new Date().toISOString()); assert.equal(selected.kind, 'selected');
    if (selected.kind === 'selected' && selected.selection.kind === 'goal') assert.equal(selected.selection.goal.id, other.id);
    f.complete(); assert.deepEqual(f.continuations.wake(), [f.run.id]);
    assert.equal(goals.goal(goal.id)!.status, 'ready'); assert.deepEqual(f.continuations.wake(), []);
  } finally { f.close(); }
});
test('already reconciled result never forces an otherwise completed model turn back to waiting', async () => {
  const f = fixture();
  try { f.complete(); reconcileEvaluationWatch(f.store, f.request.requestId); assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'completed'); assert.deepEqual(f.continuations.wake(), []); }
  finally { f.close(); }
});
