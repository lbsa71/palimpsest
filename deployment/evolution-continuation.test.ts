import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { candidateIdentity, identity, type EvaluationEvidence, type PhysicalRequest, type Run, type ShellResult } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { InitiativeRegistry } from '../packages/initiative/goals/index.ts';
import { ObligationRegistry } from '../packages/initiative/obligations/index.ts';
import { FairScheduler } from '../packages/initiative/scheduling/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ChangeRecord } from '../packages/release/proposals.ts';
import { evaluationAcknowledgmentPending, EvolutionContinuations, reconcileEvaluationWatch, recordEvaluationAcknowledgment, watchEvaluation } from './evolution-continuation.ts';
import { EvaluationDispatcher, type ReviewerFile } from './evaluation-dispatch.ts';
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

test('lost local enqueue acknowledgment reconciles exact receiver effect while preserving unknown reviewer usage', async () => {
  const f = fixture();
  try {
    const call = { id: 'enqueue-call', runId: f.run.id, stepId: 'enqueue-step', name: 'candidate_evaluate', arguments: { changeId: f.request.proposal.id } };
    const effects = new EffectJournal(f.store, f.authorities, {
      async dispatch(effect) {
        const state = f.mailbox.enqueueEvaluation(f.request);
        f.store.transaction(() => recordEvaluationAcknowledgment(f.store, effect.id, f.request, effect.payload,
          { proposal: { ...f.request.proposal, state: 'evaluation-dispatched' }, evaluation: state }));
        throw Error('Host died after committing local enqueue but before returning its receipt');
      }, async reconcile() { throw Error('Never redispatch reviewer or arbitrary receiver'); }
    });
    const runtime = new DurableRuntime({ store: f.store, effects, resources: f.resources, shell: { async run(_input, bridge) {
      await bridge.execute(call); return { status: 'completed', observations: [] };
    } } });
    assert.equal((await runtime.resume(f.run.id, f.prompt)).status, 'blocked');
    const effect = effects.unresolved(f.run.id)[0]!; assert.equal(effect.status, 'uncertain');
    const review: PhysicalRequest = { id: 'external-review:unknown', runId: f.run.id, purpose: 'review', provider: 'external-offline-review', model: 'external-fixture',
      promptManifestId: 'closure', requestDigest: identity('physical-review'), reservationId: 'external-review:unknown', status: 'reserved',
      usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 200 } };
    f.resources.reserve(review); f.resources.dispatched({ ...review, status: 'dispatched' });
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const recoveredEffects = new EffectJournal(reopened, f.authorities, { async dispatch() { throw Error('No repeated local or external dispatch'); }, async reconcile() { throw Error('No external lookup'); } });
      const resources = new ResourceLedger(reopened, { tokens: 0, costUsd: 0, elapsedMs: 100 });
      const recovered = new DurableRuntime({ store: reopened, effects: recoveredEffects, resources, shell: f.runtime.shell });
      recovered.recover();
      const continuations = new EvolutionContinuations({ store: reopened, runtime: recovered, authorityStore: f.authorities });
      assert.deepEqual(continuations.reconcileAcknowledgments(), [effect.id]); assert.deepEqual(continuations.reconcileAcknowledgments(), []);
      assert.equal(recoveredEffects.get(effect.id)!.status, 'succeeded');
      assert.equal(resources.request(effect.id)!.status, 'succeeded'); assert.equal(resources.request(effect.id)!.usage.elapsedMs, 100);
      assert.equal(resources.request(review.id)!.status, 'uncertain'); assert.equal(resources.request(review.id)!.usage.elapsedMs, 200);
      assert.equal(resources.snapshot(f.run.id).concurrent, 1);
      assert.equal(recovered.getRun(f.run.id)!.status, 'ready'); assert.equal(continuations.holds(f.run.id), true);
      assert.deepEqual(continuations.wake(), []);
      f.complete(); assert.deepEqual(continuations.wake(), [f.run.id]); assert.deepEqual(continuations.wake(), []);
      assert.equal(reopened.events(f.run.id).filter(event => event.type === 'local-enqueue-reconciled').length, 1);
    } finally { reopened.close(); }
  } finally { f.close(); }
});
test('declining a pending review continuation finishes the author without cancelling the queued physical job', async () => {
  const f = fixture();
  try {
    watchEvaluation(f.store, f.request, false);
    assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'completed');
    assert.equal(f.mailbox.readEvaluation(f.request).status, 'pending');
    f.complete(); assert.deepEqual(f.continuations.wake(), []);
  } finally { f.close(); }
});
test('foreign, terminal, cancelled, fenced or malformed local acknowledgments cannot release receiver reservations', async () => {
  for (const reason of ['cancelled', 'completed', 'scope', 'withdrawn', 'request', 'receipt', 'reservation', 'payload']) {
    const f = fixture();
    try {
      const call = { id: 'enqueue', runId: f.run.id, stepId: 'step', name: 'candidate_evaluate', arguments: { changeId: f.request.proposal.id } };
      const effects = new EffectJournal(f.store, f.authorities, { async dispatch(effect) {
        recordEvaluationAcknowledgment(f.store, effect.id, f.request, effect.payload, { proposal: f.request.proposal, evaluation: f.mailbox.readEvaluation(f.request) });
        throw Error('Lost local reply');
      }, async reconcile() { throw Error('No replay'); } });
      const runtime = new DurableRuntime({ store: f.store, effects, resources: f.resources, shell: { async run(_input, bridge) { await bridge.execute(call); return { status: 'completed', observations: [] }; } } });
      await runtime.resume(f.run.id, f.prompt); const effect = effects.unresolved(f.run.id)[0]!;
      if (reason === 'cancelled') runtime.cancel(f.run.id, 'operator', 'Do not continue');
      if (reason === 'completed' || reason === 'scope') { const row = f.store.get<Run>('runs', f.run.id)!; f.store.put('runs', f.run.id,
        { ...row.value, ...(reason === 'completed' ? { status: 'completed' as const } : { scope: { kind: 'public' as const } }) }, row.revision); }
      if (reason === 'withdrawn') f.authorities.withdraw(f.authority);
      if (reason === 'request') { const row = f.store.get<any>('host.evolution-jobs', f.request.requestId)!; f.store.put('host.evolution-jobs', f.request.requestId, { ...row.value, requestDigest: identity('foreign request') }, row.revision); }
      if (reason === 'receipt') { const row = f.store.get<any>('host.evolution-acknowledgments', effect.id)!; f.store.put('host.evolution-acknowledgments', effect.id,
        { ...row.value, receipt: f.store.putJsonArtifact({ proposal: f.request.proposal, evaluation: { ...f.mailbox.readEvaluation(f.request), policyDigest: 'foreign' } } as any) }, row.revision); }
      if (reason === 'reservation') { const row = f.store.get<any>('requests', effect.id)!; f.store.put('requests', effect.id, { ...row.value, request: { ...row.value.request, model: 'foreign' } }, row.revision); }
      if (reason === 'payload') { const row = f.store.get<any>('effects', effect.id)!; f.store.put('effects', effect.id, { ...row.value, payload: { changeId: 'foreign' } }, row.revision); }
      const before = runtime.getRun(f.run.id)!;
      const continuation = new EvolutionContinuations({ store: f.store, runtime, authorityStore: f.authorities });
      assert.deepEqual(continuation.reconcileAcknowledgments(), [], reason); assert.deepEqual(runtime.getRun(f.run.id), before, reason);
      assert.equal(effects.get(effect.id)!.status, 'uncertain', reason); assert.equal(f.resources.request(effect.id)!.status, 'uncertain', reason);
      assert.equal(f.resources.snapshot(f.run.id).concurrent, 1, reason);
    } finally { f.close(); }
  }
});
test('host defers claiming a queued review until its successful local enqueue receiver releases the lineage slot', async () => {
  const f = fixture(); let dispatcher: EvaluationDispatcher | undefined;
  try {
    const call = { id: 'enqueue', runId: f.run.id, stepId: 'step', name: 'candidate_evaluate', arguments: { changeId: f.request.proposal.id } };
    const effectId = `tool:${call.id}`;
    const value = { proposal: f.request.proposal, evaluation: f.mailbox.readEvaluation(f.request) };
    const receipt = f.store.putJsonArtifact(value as any);
    const effects = new EffectJournal(f.store, f.authorities, { async dispatch() { return { outcome: 'succeeded', receipt }; }, async reconcile() { throw Error('No physical retry'); } });
    effects.create({ id: effectId, runId: f.run.id, stepId: call.stepId, kind: call.name, payload: call.arguments, scope: f.scope, authority: f.authority, status: 'pending', revision: 0 });
    const request: PhysicalRequest = { id: effectId, runId: f.run.id, purpose: 'reasoning', provider: 'effect-receiver', model: call.name, promptManifestId: effectId,
      requestDigest: identity(call), reservationId: effectId, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
    f.resources.reserve(request); effects.authorize(effectId, effectId, f.authority);
    recordEvaluationAcknowledgment(f.store, effectId, f.request, call.arguments, value);
    await effects.dispatch(effectId, f.authority, undefined, () => f.resources.dispatched({ ...request, status: 'dispatched' }));
    assert.equal(effects.get(effectId)!.status, 'succeeded'); assert.equal(f.resources.snapshot(f.run.id).concurrent, 1);
    dispatcher = new EvaluationDispatcher({ mailbox: f.mailbox, host: { stateDirectory: f.root, workspaceDirectory: join(f.root, 'workspace'), artifactStore: join(f.root, 'artifacts'), nodeBinary: process.execPath },
      reviewer: {} as ReviewerFile, policyDigests: [], getPolicy() { throw Error('Must not inspect or dispatch reviewer while enqueue slot is held'); },
      assertAuthority: grant => f.authorities.assert(grant), dispatchAuthority: (grant, operation) => f.authorities.dispatch(grant, operation), acceptedCandidateId: () => 'fixture-artifact',
      async release() { throw Error('No release'); }, async stageControl() { throw Error('No stage'); } });
    assert.equal(evaluationAcknowledgmentPending(f.store, f.request.requestId), true);
    await dispatcher.processPending(); assert.equal(f.mailbox.status(f.request.requestId)!.status, 'pending'); assert.equal(dispatcher.status().uncertain, 0);
    // A host crash after the effect success but before ledger settlement loses only
    // the receiver usage observation; the exact archived return still proves success.
    f.resources.recoverDispatched(); assert.equal(f.resources.request(effectId)!.status, 'uncertain');
    assert.deepEqual(f.continuations.reconcileAcknowledgments(), [effectId]); assert.deepEqual(f.continuations.reconcileAcknowledgments(), []);
    assert.equal(f.resources.request(effectId)!.usage.elapsedMs, 100);
    assert.equal(evaluationAcknowledgmentPending(f.store, f.request.requestId), false); assert.equal(f.resources.snapshot(f.run.id).concurrent, 0);
    const run = f.store.get<Run>('runs', f.run.id)!;
    f.store.put('runs', f.run.id, { ...run.value, status: 'running' }, run.revision);
    assert.equal(evaluationAcknowledgmentPending(f.store, f.request.requestId), true);
    await dispatcher.processPending(); assert.equal(f.mailbox.status(f.request.requestId)!.status, 'pending');
    const running = f.store.get<Run>('runs', f.run.id)!;
    f.store.put('runs', f.run.id, { ...running.value, status: 'waiting' }, running.revision);
    assert.equal(evaluationAcknowledgmentPending(f.store, f.request.requestId), false);
  } finally { await dispatcher?.close(); f.close(); }
});
