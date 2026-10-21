import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { candidateIdentity, identity, type Effect, type JsonValue, type PhysicalRequest, type Run, type ShellResult } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { InitiativeRegistry } from '../packages/initiative/goals/index.ts';
import { ObligationRegistry } from '../packages/initiative/obligations/index.ts';
import { FairScheduler } from '../packages/initiative/scheduling/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ChangeRecord } from '../packages/release/proposals.ts';
import type { ControlContinuationRecord } from './control-continuation.ts';
import { controlActivationAcknowledgmentPending, controlActivationId, ControlAuthorContinuations, controlTools } from './control-tools.ts';
import type { SubmissionRequest } from './evolution-tools.ts';
import type { HostResourceLedgerFactory } from './host-resources.ts';

function fixture(mode: 'normal' | 'lost-reply' | 'lost-settlement' = 'normal', concurrency = 1, now?: () => number) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-control-tools-')), filename = join(root, 'operational.sqlite');
  const store = new OperationalStore({ filename }), authorities = new AuthorityStore(join(root, 'authority.sqlite'));
  const authority = authorities.bootstrap('old-author', identity('old-controls'), identity('rescue'));
  const scope = { kind: 'restricted' as const, principals: ['operator'] }, resources = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 100 }, now);
  const envelope = { maxRequests: 30, maxTokens: 10000, maxCostUsd: 0, maxElapsedMs: 10000, maxConcurrency: concurrency };
  resources.allocate('operating', envelope);
  let calls = 0, afterTool: (() => Promise<void> | void) | undefined, controls!: ControlAuthorContinuations, runId = '';
  const effects = new EffectJournal(store, authorities, { async dispatch(effect) {
    const tool = tools(effect.id).find(tool => tool.name === effect.kind)!; const value = await tool.execute(effect.payload);
    if (mode === 'lost-reply') throw Error('Lost local return after durable activation enqueue');
    return { outcome: 'succeeded', receipt: store.putJsonArtifact(value as JsonValue) };
  }, async reconcile() { throw Error('No external review replay or arbitrary receiver lookup'); } });
  const prompt = { id: 'fixture', requestDigest: identity('no-physical-model'), fragments: [] };
  const call = () => ({ id: 'activation-call', runId, stepId: 'activation-step', name: 'control_activate', arguments: { changeId: 'finite' } });
  const runtime = new DurableRuntime({ store, effects, resources, now, shell: { async run(input, bridge) {
    calls++; const observation = await bridge.execute(call()); await afterTool?.();
    const checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, 'fixture', { observationIds: [observation.id], phase: 'control-requested' });
    return controls.preserveWaiting(input.run.id, { status: 'completed', checkpoint, observations: [observation] });
  } } });
  controls = new ControlAuthorContinuations({ store, runtime, authorityStore: authorities });
  const run = runtime.admit({ id: 'input', source: 'direct', externalId: 'finite', externalRevision: '1', actorId: 'operator', authenticated: true, scope, value: 'Engineering staged control fixture, no product qualification.' }, authority, envelope, 'operating'); runId = run.id;
  const fields = { source: identity('source'), dependencies: identity('deps'), prompts: identity('prompts'), model: identity('model'), configuration: identity('config'), controls: identity('new-controls'), createdBy: authority.generation };
  const candidate = { ...fields, id: candidateIdentity(fields) }, experience = store.putArtifact('Engineering proposal evidence');
  const proposal: ChangeRecord = { id: 'finite', runId, scope, authority, provenance: { kind: 'human', actorId: 'operator', inputId: 'input' }, justification: 'Exercise bounded ordinary control continuation', goal: { objective: 'Control activation', successCriteria: ['fresh original-policy decision'] }, experience, state: 'submitted', candidate, judgingPolicyDigest: identity('policy') };
  const receipt = { requestId: 'submission', candidateId: candidate.id, status: 'staged', receipt: { stageId: 'stage', policyDigest: identity('next-policy') } };
  const submission = { requestId: receipt.requestId, proposal: { ...proposal, state: 'frozen' }, candidate: { manifest: candidate }, policyDigest: proposal.judgingPolicyDigest } as SubmissionRequest;
  store.put('host.evolution-jobs', receipt.requestId, { id: receipt.requestId, kind: 'submission', status: 'completed', candidateId: candidate.id, policyDigest: proposal.judgingPolicyDigest,
    request: store.putJsonArtifact(submission as unknown as JsonValue), requestDigest: identity(submission), authority, receipt: store.putJsonArtifact(receipt) }, null);
  store.put('release.changes', identity({ runId, id: proposal.id }), { ...proposal, submission: store.putJsonArtifact(receipt) }, null);
  const tools = (effectId?: string, overrides = {}) => controlTools({ store, runId, scope, authority: runtime.getRun(runId)!.authority, workspace: root, ...(effectId ? { effectId } : {}), ...overrides }, grant => authorities.assert(grant));
  const id = controlActivationId(runId, proposal.id), record = () => store.get<ControlContinuationRecord>('host.control-continuations', id)!.value;
  const changeStatus = (status: ControlContinuationRecord['status']) => { const row = store.get<ControlContinuationRecord>('host.control-continuations', id)!; store.put('host.control-continuations', id, { ...row.value, status }, row.revision); };
  const originalSettle = resources.settle.bind(resources);
  if (mode === 'lost-settlement') resources.settle = request => { if (request.model === 'control_activate' && request.status === 'succeeded') throw Error('Host died after effect success before receiver ledger settlement'); originalSettle(request); };
  return { root, filename, store, authorities, authority, scope, resources, envelope, effects, runtime, controls, run, candidate, prompt, tools, id, record, changeStatus,
    calls: () => calls, setAfterTool: (callback: () => Promise<void> | void) => { afterTool = callback; }, restoreSettlement: () => { resources.settle = originalSettle; },
    close() { store.close(); authorities.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('ordinary activation acknowledges exact pending request and host waits for both settled receiver and finished producer slice', async () => {
  const f = fixture();
  try {
    f.setAfterTool(() => {
      assert.equal(f.effects.get('tool:activation-call')?.status, 'succeeded');
      assert.equal(f.resources.request('tool:activation-call')?.status, 'succeeded');
      assert.equal(controlActivationAcknowledgmentPending(f.store, f.record().request), true, 'A finished tool still belongs to a running producer slice');
    });
    assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'waiting');
    assert.equal(f.record().status, 'pending'); assert.equal(controlActivationAcknowledgmentPending(f.store, f.record().request), false);
    const observation = f.runtime.observations(f.run.id)[0]!.value as Record<string, JsonValue>;
    assert.equal((observation.activation as Record<string, JsonValue>).status, 'pending');
    assert.equal(JSON.stringify(observation).includes('allocationLineage'), false); assert.equal(JSON.stringify(observation).includes('evaluatorKeys'), false);
    assert.equal(f.controls.holds(f.run.id), true); assert.equal(f.controls.eligibleRun(f.run.id, false), false);
    assert.equal(f.controls.eligibleRun(f.run.id, true), true, 'Explicit steering remains allowed while queued');
    f.changeStatus('reviewing'); assert.equal(f.controls.eligibleRun(f.run.id, true), false, 'Review holds the current physical slot');
    assert.equal(f.calls(), 1); assert.equal(f.resources.snapshot(f.run.id).requests, 1);
  } finally { f.close(); }
});

test('successor adoption preserves original allocation and known outcome wakes the scoped waiting author once', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt); const allocation = f.store.get('allocations', f.run.id);
    const next = f.authorities.activate(f.authorities.withdraw(f.authority), 'successor', f.candidate.controls, f.candidate.id);
    f.runtime.adopt(f.run.id, next); f.changeStatus('accepted');
    const reopened = new OperationalStore({ filename: f.filename });
    const resources = new ResourceLedger(reopened, { tokens: 0, costUsd: 0, elapsedMs: 100 });
    const effects = new EffectJournal(reopened, f.authorities, f.effects.receiver), runtime = new DurableRuntime({ store: reopened, effects, resources, shell: f.runtime.shell });
    try {
      const controls = new ControlAuthorContinuations({ store: reopened, runtime, authorityStore: f.authorities });
      assert.deepEqual(controls.wake(), [f.run.id]); assert.deepEqual(controls.wake(), []); assert.deepEqual(f.controls.wake(), []);
      const events = reopened.events<any>(f.run.id).filter(event => event.type === 'steering'); assert.equal(events.length, 1);
      assert.deepEqual(events[0]!.data.scope, f.scope); assert.equal(events[0]!.data.actorId, next.generation);
      assert.deepEqual(reopened.get('allocations', f.run.id), allocation); assert.equal(reopened.list('allocations').length, 2); assert.equal(f.calls(), 1);
      const status = await f.tools().find(tool => tool.name === 'control_status')!.execute({ changeId: 'finite' }) as { activation: { status: string } };
      assert.equal(status.activation.status, 'accepted'); assert.equal(f.controls.holds(f.run.id), false);
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('expired original author wake requires explicit host allowance binding and retains runtime clock and grant', async () => {
  let now = 0; const f = fixture('normal', 1, () => now);
  try {
    await f.runtime.resume(f.run.id, f.prompt);
    const allocation = f.store.get('allocations', f.run.id), root = f.store.get('allocations', 'operating');
    const next = f.authorities.activate(f.authorities.withdraw(f.authority), 'successor', f.candidate.controls, f.candidate.id);
    f.runtime.adopt(f.run.id, next); f.changeStatus('accepted'); now = 20000;
    const resourceLedger: HostResourceLedgerFactory = (store, ceiling, clock) => {
      const ledger = new ResourceLedger(store, ceiling, clock);
      ledger.applyAllowanceAmendment({ id: 'accepted-unlimited', rootId: 'operating', expectedEnvelopeDigest: identity(f.envelope), authorizationRef: 'fixture-user-grant',
        cumulativeRequestLimit: null, cumulativeTokenLimit: null, cumulativeCostLimit: null, cumulativeElapsedLimit: null, scope: 'root-and-descendants', descendantCostLimit: 'root' },
      { authority: next, assertAuthority: () => f.authorities.assert(next) });
      return ledger;
    };
    // An audit record alone is insufficient; each callback needs the trusted composition binding.
    resourceLedger(f.store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, f.runtime.now);
    assert.deepEqual(f.controls.wake(), []);
    const bound = new ControlAuthorContinuations({ store: f.store, runtime: f.runtime, authorityStore: f.authorities, resourceLedger });
    assert.deepEqual(bound.wake(), [f.run.id]); assert.deepEqual(bound.wake(), []);
    assert.equal(f.store.get<{ requestedAt: number }>('host.pending-runs', f.run.id)!.value.requestedAt, 20000);
    assert.deepEqual(f.store.get('allocations', f.run.id), allocation); assert.deepEqual(f.store.get('allocations', 'operating'), root);
    assert.equal(f.calls(), 1);
  } finally { f.close(); }
});

for (const mode of ['lost-reply', 'lost-settlement'] as const) test(`${mode} reconciles only exact local acknowledgment after restart and preserves unknown external review usage`, async () => {
  // This mixed-unknown fixture declares both slots at initial admission. No limit changes
  // occur during recovery; the ordinary activation flow above uses exactly one slot.
  const f = fixture(mode, 2);
  try {
    assert.ok(['blocked', 'waiting'].includes((await f.runtime.resume(f.run.id, f.prompt)).status)); f.restoreSettlement();
    const physical: PhysicalRequest = { id: 'external-review:unknown', runId: f.run.id, purpose: 'review', provider: 'external-offline-review', model: 'fixture-reviewer', promptManifestId: 'reviewer', requestDigest: identity('external'), reservationId: 'external-review:unknown', status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 200 } };
    // A separate already-dispatched review is an independent unknown outcome, not a new dispatch.
    f.resources.reserve(physical); f.resources.dispatched({ ...physical, status: 'dispatched' });
    f.runtime.recover();
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const resources = new ResourceLedger(reopened, { tokens: 0, costUsd: 0, elapsedMs: 100 });
      const effects = new EffectJournal(reopened, f.authorities, f.effects.receiver), runtime = new DurableRuntime({ store: reopened, effects, resources, shell: f.runtime.shell });
      const controls = new ControlAuthorContinuations({ store: reopened, runtime, authorityStore: f.authorities });
      assert.deepEqual(controls.reconcileAcknowledgments(), ['tool:activation-call']); assert.deepEqual(controls.reconcileAcknowledgments(), []);
      assert.equal(effects.get('tool:activation-call')?.status, 'succeeded'); assert.equal(resources.request('tool:activation-call')?.status, 'succeeded');
      assert.equal(resources.request('tool:activation-call')?.usage.elapsedMs, 100); assert.equal(resources.request(physical.id)?.status, 'uncertain');
      assert.equal(resources.snapshot(f.run.id).concurrent, 1); assert.equal(controlActivationAcknowledgmentPending(reopened, f.record().request), false);
      assert.equal(reopened.list('host.control-continuations').length, 1); assert.equal(f.calls(), 1);
      assert.deepEqual(controls.wake(), []);
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('mismatched local effect payload, authority, receipt or reservation cannot release the host activation gate', async () => {
  for (const boundary of ['payload', 'authority', 'receipt', 'reservation']) {
    const f = fixture('lost-settlement');
    try {
      await f.runtime.resume(f.run.id, f.prompt); f.restoreSettlement(); f.runtime.recover();
      if (boundary === 'reservation') {
        const row = f.store.get<any>('requests', 'tool:activation-call')!; f.store.put('requests', 'tool:activation-call', { ...row.value, request: { ...row.value.request, provider: 'foreign' } }, row.revision);
      } else {
        const row = f.store.get<Effect>('effects', 'tool:activation-call')!;
        f.store.put('effects', 'tool:activation-call', { ...row.value, ...(boundary === 'payload' ? { payload: { changeId: 'foreign' } } : boundary === 'authority' ? { authority: { ...f.authority, generation: 'foreign' } } : { receipt: f.store.putJsonArtifact({ fake: true }) }) }, row.revision);
      }
      assert.deepEqual(f.controls.reconcileAcknowledgments(), [], boundary);
      assert.equal(controlActivationAcknowledgmentPending(f.store, f.record().request), true, boundary);
      assert.equal(f.resources.snapshot(f.run.id).concurrent, 1);
    } finally { f.close(); }
  }
});

test('scope and foreign proposal reads are rejected; status exposes only the original bound activation', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt);
    await assert.rejects(async () => f.tools().find(tool => tool.name === 'control_status')!.execute({ changeId: 'foreign' }), /unavailable/);
    await assert.rejects(async () => f.tools(undefined, { scope: { kind: 'public' } }).find(tool => tool.name === 'control_status')!.execute({ changeId: 'finite' }), /fenced/);
    await assert.rejects(async () => f.tools().find(tool => tool.name === 'control_status')!.execute({ changeId: 'finite', stageId: 'foreign' }), /Exact/);
    const row = f.store.get<any>('host.evolution-jobs', 'submission')!; f.store.put('host.evolution-jobs', 'submission', { ...row.value, requestDigest: identity('tampered') }, row.revision);
    await assert.rejects(async () => f.tools().find(tool => tool.name === 'control_status')!.execute({ changeId: 'finite' }), /binding mismatch/);
  } finally { f.close(); }
});

test('cancelled, terminal, expired and uncertain control authors never wake or mint new grants', async () => {
  for (const boundary of ['cancelled', 'completed', 'expired', 'uncertain', 'scope', 'withdrawn']) {
    const f = fixture();
    try {
      await f.runtime.resume(f.run.id, f.prompt); f.changeStatus(boundary === 'uncertain' ? 'uncertain' : 'rejected');
      if (boundary === 'cancelled') f.runtime.cancel(f.run.id, 'operator', 'Stop');
      if (boundary === 'completed' || boundary === 'scope') { const row = f.store.get<Run>('runs', f.run.id)!; f.store.put('runs', f.run.id, { ...row.value, ...(boundary === 'completed' ? { status: 'completed' } : { scope: { kind: 'public' } }) }, row.revision); }
      if (boundary === 'expired') { const row = f.store.get<any>('allocations', 'operating')!; f.store.put('allocations', 'operating', { ...row.value, startedAt: Date.now() - 10001 }, row.revision); }
      if (boundary === 'withdrawn') f.authorities.withdraw(f.authority);
      assert.deepEqual(f.controls.wake(), [], boundary); assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 0);
      assert.equal(f.store.list('allocations').length, 2); assert.equal(f.calls(), 1);
    } finally { f.close(); }
  }
});

test('pending control initiative consumes no repeated lifetime slices; known outcome read can finish original author', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt); const goals = new InitiativeRegistry(f.store), provenance = { sourceIds: ['fixture'], actorId: 'operator', recordedAt: new Date().toISOString(), derivation: 'observed' as const };
    let goal = goals.propose({ id: 'control', origin: { kind: 'self' }, purpose: 'Await exact host outcome', scope: f.scope, successCriteria: ['inspect status'], evidenceIds: [], dependencyIds: [], resources: f.envelope, priority: 1, nextAction: 'inspect', reviewAt: new Date().toISOString() }, provenance);
    goal = goals.accept(goal.id, goal.revision, 'Fixture'); goals.revise(goal.id, goal.revision, { status: 'waiting', wakeup: { at: new Date().toISOString(), condition: 'host result' } }, 'Host pending');
    f.store.put('initiative.execution', goal.id, { runId: f.run.id }, null);
    const scheduler = new FairScheduler(f.store, goals, new ObligationRegistry(f.store), 'controls', { windowMs: 10000, maxSlicesPerWindow: 4, maxLifetimeSlices: 4, quantumMs: 10, idleRetryMs: 1, maxStalls: 2, resources: f.envelope }, Date.now(), goal => f.controls.eligibleGoal(goal));
    for (let n = 0; n < 8; n++) assert.equal(scheduler.select(new Date().toISOString()).kind, 'idle');
    assert.equal(scheduler.snapshot().lifetimeSlices, 0); f.changeStatus('rejected'); assert.deepEqual(f.controls.wake(), [f.run.id]);
    assert.equal(goals.goal(goal.id)?.status, 'ready'); assert.deepEqual(f.controls.wake(), []);
    await f.tools().find(tool => tool.name === 'control_status')!.execute({ changeId: 'finite' });
    assert.equal(f.controls.preserveWaiting(f.run.id, { status: 'completed', observations: [] }).status, 'completed');
  } finally { f.close(); }
});

test('known local acknowledgment can settle a cancelled old author under current serving authority without resurrection', async () => {
  const f = fixture('lost-reply');
  try {
    await f.runtime.resume(f.run.id, f.prompt); f.runtime.cancel(f.run.id, 'operator', 'Cancel before host transfer');
    f.authorities.activate(f.authorities.withdraw(f.authority), 'current-host', f.authority.controlRevision, identity('rescue'));
    assert.deepEqual(f.controls.reconcileAcknowledgments(), ['tool:activation-call']);
    assert.equal(f.resources.request('tool:activation-call')?.status, 'succeeded'); assert.equal(f.runtime.getRun(f.run.id)?.status, 'cancelled');
    f.changeStatus('rejected'); assert.deepEqual(f.controls.wake(), []); assert.equal(f.calls(), 1);
  } finally { f.close(); }
});
