import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { createAgentShell } from '../../agent-shell/index.ts';
import { OperationalStore, RevisionConflict } from '../../storage/index.ts';
import { DevelopmentalMemory } from '../../development/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../../runtime/index.ts';
import { assertAuthority, identity } from '../../contracts/index.ts';
import type { Authority, Effect, Goal, JsonValue, Observation, ResourceEnvelope, ShellPort } from '../../contracts/index.ts';
import { DriveRegistry, FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry, PlanRegistry, applyProgress, growthDimensions, initiativeTools } from '../index.ts';
const at = '2026-10-11T12:00:00.000Z', scope = { kind: 'public' } as const;
const resources: ResourceEnvelope = { maxRequests: 30, maxTokens: 3000, maxCostUsd: 10, maxElapsedMs: 600000, maxConcurrency: 1 };
const authority: Authority = { generation: 'autark-test', epoch: 1, controlRevision: 'c1' };
const prompt = { id: 'fixture', fragments: [], requestDigest: identity('fixture') };
function filename(): string { return join(mkdtempSync(join(tmpdir(), 'aeon-initiative-')), 'state.sqlite'); }
function fixture(file = filename(), clock = () => at) { const store = new OperationalStore({ filename: file, checkoutRoot: process.cwd() }), memory = new DevelopmentalMemory(store, clock), goals = new InitiativeRegistry(store), obligations = new ObligationRegistry(store), drives = new DriveRegistry(store, memory), plans = new PlanRegistry(store); return { store, memory, goals, obligations, drives, plans }; }
function goal(f: ReturnType<typeof fixture>, id: string, extra: Partial<Omit<Goal, 'id' | 'revision' | 'status'>> = {}): Goal { return f.goals.propose({ id, origin: { kind: 'self' }, purpose: `Observe ${id}`, scope, successCriteria: ['obtain a new measured observation'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: `measure ${id}`, reviewAt: at, ...extra }, { sourceIds: ['test-input'], actorId: 'fixture', recordedAt: at, derivation: 'interpreted' }); }
function ready(f: ReturnType<typeof fixture>, id: string, extra: Partial<Omit<Goal, 'id' | 'revision' | 'status'>> = {}): Goal { const proposed = goal(f, id, extra); return f.goals.accept(id, proposed.revision, 'finite observation worthwhile'); }
function policy(extra = {}) { return { windowMs: 1000, maxSlicesPerWindow: 10, maxLifetimeSlices: 30, quantumMs: 2000, idleRetryMs: 100, maxStalls: 3, resources, ...extra }; }
function evidence(f: ReturnType<typeof fixture>, id = 'episode'): void { f.memory.ingest({ id, runId: 'prior-run', sourceId: `source:${id}`, actorId: 'fixture-observer', scope, channel: 'tool', at, content: { measurements: 'A reference trial disagreed with the estimate; image symmetries remain unexplained; duplicate parsing was observed; one benchmark task remained unsupported.' } }); }
function observation(kind: Observation['kind'], id = 'o'): Observation { return { id, kind, runId: 'r', stepId: 's', sourceId: id, value: kind === 'result' ? 'measured result' : 'hypothesis failed', provenance: { sourceIds: [id], actorId: 'instrument', recordedAt: at, derivation: 'observed' } }; }
function runtime(f: ReturnType<typeof fixture>, shell: ShellPort, now: () => number, dispatch: (effect: Effect) => Promise<{ outcome: 'succeeded' | 'failed' | 'uncertain'; value?: JsonValue }> = async () => ({ outcome: 'succeeded', value: { measured: true } })) {
  const fence = { assert(grant: Authority) { assertAuthority(grant, authority); } };
  const effects = new EffectJournal(f.store, fence, { async dispatch(effect) { const result = await dispatch(effect); return { outcome: result.outcome, ...(result.value !== undefined ? { receipt: f.store.putJsonArtifact(result.value) } : {}) }; }, async reconcile(effect) { return { outcome: 'unresolved', receipt: f.store.putJsonArtifact({ unknown: effect.id }) }; } });
  const ledger = new ResourceLedger(f.store, { tokens: 100, costUsd: .1, elapsedMs: 1000 }, now);
  return { effects, ledger, runtime: new DurableRuntime({ store: f.store, shell, effects, resources: ledger, now }) };
}

test('goal revisions/dependencies/reasons survive reopen; terminal evidence and allowance cannot disappear', async () => {
  const file = filename(); let f = fixture(file); const a = ready(f, 'a'), b = ready(f, 'b', { dependencyIds: ['a'] });
  assert.deepEqual((await f.goals.ready(at)).map(g => g.id), ['a']);
  assert.throws(() => f.goals.revise('a', a.revision, { dependencyIds: ['b'] }, 'cycle'), /cycle/);
  assert.throws(() => f.goals.revise('a', a.revision, { resources: { ...resources, maxRequests: 31 } }, 'more'), /additional resources/);
  assert.throws(() => f.goals.revise('a', a.revision, { status: 'completed' }, 'premature'), /invalid goal transition|completion requires/);
  let current = f.goals.revise('a', a.revision, { status: 'running' }, 'execute'); current = f.goals.revise('a', current.revision, { status: 'completed', evidenceIds: ['actual-receipt'] }, 'observed criteria');
  assert.equal(f.goals.readyNow(at)[0].id, 'b'); const paused = f.goals.revise('b', b.revision, { status: 'paused' }, 'reconsider feasibility');
  assert.throws(() => f.goals.revise('b', b.revision, { status: 'ready' }, 'stale revision'), RevisionConflict);
  f.store.close(); f = fixture(file); assert.equal(f.goals.goal('b')?.reason, 'reconsider feasibility'); assert.equal(f.goals.goal('b')?.status, 'paused'); assert.equal(f.goals.history('a', scope).length, 4);
  assert.throws(() => f.goals.revise('a', current.revision, { evidenceIds: [] }, 'hide failure'), /evidence|completion/); assert.equal(f.goals.goal('b')?.revision, paused.revision); f.store.close();
});

test('experience supplies all four adopted dimensions and concrete inquiry; no seeded questions or identities', () => {
  const f = fixture(); assert.deepEqual(f.drives.coverage(scope), { adopted: [], missing: [...growthDimensions] }); assert.deepEqual(f.drives.opportunities(scope), []); evidence(f);
  const questions = ['What invalidated the confidence estimate in the reference trial?', 'Which image symmetries distinguish the two observed patterns?', 'Can the observed duplicate parser be removed without changing results?', 'Which missing operation caused the unsupported benchmark?'];
  growthDimensions.forEach((dimension, i) => {
    const drive = f.drives.adopt({ id: dimension, dimension, purpose: questions[i], scope, reason: 'measured experience opens a specific uncertainty', weight: 1, active: true, provenance: { sourceIds: ['episode'], actorId: 'autark-test', recordedAt: at, derivation: 'interpreted' } }, null);
    f.drives.offer({ id: `opportunity-${i}`, driveId: drive.id, scope, sourceIds: ['episode'], question: questions[i], observationAction: `inspect observed artifact ${i}`, successCriteria: ['retain measured comparison and uncertainty'], reason: 'question follows the observed artifact', priority: 1 });
  });
  assert.deepEqual(f.drives.coverage(scope).missing, []); assert.equal(f.drives.opportunities(scope).length, 4);
  const selected = f.drives.select('opportunity-1', f.goals, { id: 'noncoding-inquiry', resources, dependencyIds: [], priority: 1, reviewAt: at }, authority.generation, at);
  assert.equal(selected.origin.kind, 'self'); assert.match(selected.purpose, /symmetries/); assert.deepEqual(selected.evidenceIds, ['episode']);
  f.drives.adopt({ ...f.drives.adopted(scope).find(d => d.dimension === 'capability')!, weight: 3, reason: 'unsupported trial now deserves earlier observation' }, 1);
  assert.equal(f.drives.opportunities(scope)[0].driveId, 'capability'); f.memory.forget(['episode']); assert.deepEqual(f.drives.opportunities(scope), []); f.store.close();
});

test('targeted failure replans; self-agreement cannot complete without observed successful evidence', () => {
  const f = fixture(); const accepted = ready(f, 'trial'); const running = f.goals.revise('trial', accepted.revision, { status: 'running' }, 'test hypothesis');
  assert.throws(() => applyProgress(f.goals, running, [observation('error')], { kind: 'continue', nextAction: running.nextAction!, evidenceIds: ['o'], reason: 'repeat critique' }), /targeted replanning/);
  assert.throws(() => applyProgress(f.goals, running, [observation('error')], { kind: 'complete', evidenceIds: ['o'], reason: 'I agree' }), /successful observations/);
  const revised = applyProgress(f.goals, running, [observation('error')], { kind: 'continue', nextAction: 'measure the alternative hypothesis on a different artifact', evidenceIds: ['o'], reason: 'the observed failure contradicts the initial hypothesis' });
  assert.equal(revised.status, 'ready'); assert.notEqual(revised.nextAction, running.nextAction); assert.deepEqual(revised.evidenceIds, ['o']); f.store.close();
});

test('round robin preserves active conversation and inquiry under new input; windows preserve lifetime and restart queues', () => {
  const file = filename(); let f = fixture(file); ready(f, 'old-conversation', { origin: { kind: 'request', inputId: 'i1' } }); ready(f, 'old-inquiry'); ready(f, 'due-work');
  f.obligations.owe({ id: 'owed', inputId: 'i2', goalId: 'due-work', audience: scope, promisedOutcome: 'report the investigation', dueAt: at });
  let scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'fair', policy({ maxSlicesPerWindow: 6, maxLifetimeSlices: 9 }), Date.parse(at));
  const selected: string[] = [];
  for (let i = 0; i < 6; i++) { ready(f, `new-conversation-${i}`, { origin: { kind: 'request', inputId: `new-${i}` }, priority: 999 }); const choice = scheduler.select(at); assert.equal(choice.kind, 'selected'); if (choice.kind === 'selected') { assert.equal(choice.selection.kind, 'goal'); if (choice.selection.kind === 'goal') selected.push(choice.selection.goal.id); } }
  assert.deepEqual(selected.slice(0, 3), ['due-work', 'new-conversation-0', 'old-inquiry']); assert.ok(selected.includes('old-conversation')); assert.equal(selected.filter(id => id === 'old-inquiry').length, 2);
  assert.equal(scheduler.select(at).kind, 'window-exhausted'); f.store.close(); f = fixture(file); scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'fair', policy({ maxSlicesPerWindow: 6, maxLifetimeSlices: 9 }), Date.parse(at));
  assert.equal(scheduler.snapshot().lifetimeSlices, 6); for (let i = 0; i < 3; i++) assert.equal(scheduler.select('2026-10-11T12:00:01.000Z').kind, 'selected'); assert.equal(scheduler.select('2026-10-11T12:00:02.000Z').kind, 'lifetime-exhausted');
  assert.throws(() => new FairScheduler(f.store, f.goals, f.obligations, 'fair', policy({ maxLifetimeSlices: 100 }), Date.parse(at)), /cannot reset/); f.store.close();
});

test('idle and future wakeups make no allocation or repeated model call; paused/blocked await explicit reconsideration', async () => {
  const f = fixture(); const scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'idle', policy(), Date.parse(at)); const d = scheduler.select(at); assert.equal(d.kind, 'idle'); assert.equal(d.nextWakeup, null); assert.equal(scheduler.snapshot().lifetimeSlices, 0);
  let calls = 0; const r = runtime(f, { async run() { calls++; return { status: 'completed', observations: [] }; } }, () => Date.parse(at)); const runner = new InitiativeRunner({ scheduler, runtime: r.runtime, memory: f.memory, authority, prompt: () => prompt, decide: () => { throw Error('should not decide'); } });
  await runner.tick(); assert.equal(calls, 0); const g = ready(f, 'future'); f.goals.revise(g.id, g.revision, { status: 'waiting', wakeup: { at: '2026-10-11T12:00:05.000Z', condition: 'external observation arrives' } }, 'wait for observation'); const waiting = await runner.tick(); assert.ok(waiting.kind !== 'selected'); assert.equal(waiting.nextWakeup, '2026-10-11T12:00:05.000Z'); assert.equal(calls, 0); f.store.close();
});

test('owes outcome independently of goal; confirmed report receipt alone clears it', async () => {
  const file = filename(); let f = fixture(file); const accepted = ready(f, 'owed-goal'); const running = f.goals.revise(accepted.id, accepted.revision, { status: 'running' }, 'execute'); f.goals.revise(running.id, running.revision, { status: 'completed', evidenceIds: ['verified'] }, 'verified criteria');
  let owed = f.obligations.owe({ id: 'owed-report', inputId: 'thread-input', goalId: accepted.id, audience: scope, promisedOutcome: 'deliver the measured outcome and remaining uncertainty', dueAt: at });
  const payload = { channel: 'C1', threadTs: '1.0', clientMsgId: 'report-1', text: 'Inconclusive measurement, next observation deferred.', kind: 'progress', obligationId: owed.id, obligationRevision: owed.revision };
  const effect: Effect = { id: 'delivery', runId: 'report-run', stepId: 's', kind: 'slack_speech', payload, scope, authority, status: 'succeeded', revision: 3, reservationId: 'reservation', receipt: f.store.putJsonArtifact({ ...payload, transport: 'slack', messageTs: '2.0', delivered: true }) };
  f.store.put('effects', effect.id, effect, null); owed = f.obligations.beginDelivery(owed.id, owed.revision, effect.id);
  assert.throws(() => f.obligations.confirmDelivery(owed.id, owed.revision), /progress acknowledgement/); assert.equal((await f.obligations.owed(scope)).length, 1); f.store.close(); f = fixture(file); assert.equal(f.obligations.obligation(owed.id)?.status, 'delivering');
  const success = { ...payload, kind: 'report' }; let row = f.store.get<Effect>('effects', effect.id)!; f.store.put('effects', effect.id, { ...row.value, payload: success, receipt: f.store.putJsonArtifact({ ...success, transport: 'slack', messageTs: '2.0', delivered: true, channel: 'wrong' }) }, row.revision);
  assert.throws(() => f.obligations.confirmDelivery(owed.id, owed.revision), /target mismatch/); row = f.store.get<Effect>('effects', effect.id)!; f.store.put('effects', effect.id, { ...row.value, receipt: f.store.putJsonArtifact({ ...success, transport: 'slack', messageTs: '2.0', delivered: true }) }, row.revision);
  assert.equal(f.obligations.confirmDelivery(owed.id, owed.revision).status, 'delivered'); assert.equal((await f.obligations.owed(scope)).length, 0); f.store.close();
});

test('machine plan retains Aeon Lane Task ownership/evidence and rejects dependency loops', () => {
  const file = filename(); let f = fixture(file); const g = ready(f, 'plan-goal'); const plan = { id: 'plan', goalId: g.id, scope, aeon: 'Aeon 2', lane: 'A2-L02', owner: 'autark-test', slashGoal: '/goal Compare observed symmetries and retain uncertainty', dependencyIds: [], status: 'ready' as const, reason: null, handoff: null, tasks: [{ id: 'T01', objective: 'compare two artifacts', dependencyIds: [], writablePaths: [], inputs: ['artifact-a'], acceptance: ['record observed differences'], model: 'fixture-mistral', effort: null, status: 'ready' as const, evidenceIds: [], reason: null }] };
  f.plans.put(plan, null); f.store.close(); f = fixture(file); assert.equal(f.plans.get('plan', scope)?.owner, authority.generation);
  assert.throws(() => f.plans.put({ ...plan, tasks: [{ ...plan.tasks[0], dependencyIds: ['T02'] }, { ...plan.tasks[0], id: 'T02', dependencyIds: ['T01'] }] }, 1), /cycle/); f.store.close();
});

test('model tool descriptors capture audience, enforce host resource ceiling and permit independent goal adoption', () => {
  const f = fixture(); evidence(f); const tools = initiativeTools(f.goals, f.drives, f.plans, scope, authority.generation, resources, () => at); assert.ok(tools.every(t => /^[a-z0-9_]+$/.test(t.name))); const propose = tools.find(t => t.name === 'initiative_goal_propose')!;
  const args = { id: 'model-goal', purpose: 'compare unexplained observed patterns', successCriteria: ['retain comparison'], sourceIds: ['episode'], resources: { ...resources, maxRequests: 31 }, priority: 1, nextAction: 'inspect artifacts', reviewAt: at }; assert.throws(() => propose.execute(args), /host grant/); const result = propose.execute({ ...args, resources: { ...resources } }) as Goal;
  const accepted = tools.find(t => t.name === 'initiative_goal_accept')!.execute({ id: result.id, expectedRevision: result.revision, reason: 'independent curiosity merits observation' }) as Goal; assert.equal(accepted.status, 'ready'); assert.throws(() => propose.execute({ ...args, resources: { ...resources }, scope: { kind: 'public' } }), /unknown/); f.store.close();
});

function response(content: string | null, toolCall = false): Response { return Response.json({ id: 'fixture-model', model: 'fixture-mistral', choices: [{ finish_reason: toolCall ? 'tool_calls' : 'stop', message: { content, ...(toolCall ? { tool_calls: [{ id: 'observed01', type: 'function', function: { name: 'measure', arguments: '{}' } }] } : {}) } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }); }

test('unattended actual Pi/runtime/memory cycles resume after window and restart with retained total physical usage', async t => {
  const file = filename(); let now = Date.parse(at), f = fixture(file, () => new Date(now).toISOString()); evidence(f);
  for (const [i, purpose] of ['compare image symmetries', 'test observed parsing duplicate', 'measure unsupported benchmark operation'].entries()) ready(f, `inquiry-${i}`, { purpose, evidenceIds: ['episode'] });
  const modelCalls: string[] = [], observations: string[] = []; let round = 0;
  const shell = createAgentShell({ resolveFragment: async () => '', tools: [{ name: 'measure', description: 'Observe a bounded fixture artifact', parameters: Type.Object({}, { additionalProperties: false }) }], apiKey: () => 'fixture-key', maxRequests: 2, fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); modelCalls.push(body.messages[0].content); return round++ % 2 === 0 ? response(null, true) : response('Observed fixture measurement; inference remains limited.'); } });
  let r = runtime(f, shell, () => now, async effect => { observations.push(effect.id); return { outcome: 'succeeded', value: { measured: effect.id, fixture: true } }; });
  let scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'joined', policy({ maxSlicesPerWindow: 1 }), now);
  const options = () => ({ scheduler, runtime: r.runtime, memory: f.memory, authority, prompt: () => prompt, decide: (_goal: Goal, observed: Observation[]) => ({ kind: 'complete' as const, evidenceIds: observed.map(o => o.id), reason: 'fixture observation satisfies finite comparison criteria; no live growth claim' }) });
  let runner = new InitiativeRunner(options()); await runner.tick(); assert.equal(f.goals.goal('inquiry-0')?.status, 'completed'); assert.equal(r.ledger.snapshot(runner.rootAllocation).requests, 3); assert.equal((await runner.tick()).kind, 'window-exhausted');
  const rootId = runner.rootAllocation; f.store.close(); now += 1000; f = fixture(file, () => new Date(now).toISOString()); r = runtime(f, shell, () => now, async effect => { observations.push(effect.id); return { outcome: 'succeeded', value: { measured: effect.id, fixture: true } }; }); scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'joined', policy({ maxSlicesPerWindow: 1 }), now); runner = new InitiativeRunner(options()); runner.recover(); assert.equal(r.ledger.snapshot(rootId).requests, 3); await runner.tick(); now += 1000; await runner.tick(); now += 1000; assert.equal((await runner.tick()).kind, 'idle');
  assert.equal(observations.length, 3); assert.equal(modelCalls.length, 6); assert.equal(r.ledger.snapshot(rootId).requests, 9); assert.equal(r.ledger.snapshot(rootId).tokens, 84); assert.equal(f.memory.context({ audience: scope, query: 'measured', maxBytes: 32768, maxRecords: 16 }).memories.length, 3);
  const trace = { label: 'fixture-verified actual Pi/runtime/memory unattended scheduling; no live model or growth claim', physicalUsage: r.ledger.snapshot(rootId), scheduler: scheduler.snapshot(), goals: f.goals.all(), selections: f.store.events(`scheduler:joined`), toolObservations: r.runtime.store.list<Observation>('observations').map(row => row.value), modelRequestCount: modelCalls.length, restart: { retainedRequests: 3 }, noAction: 'idle after all finite inquiry criteria observed' };
  if (process.env.AEON_INITIATIVE_TRACE) writeFileSync(process.env.AEON_INITIATIVE_TRACE, JSON.stringify(trace, null, 2) + '\n'); t.diagnostic(`unattended trace: ${observations.length} observations, ${modelCalls.length} fixture model requests, 9 total physical requests retained across restart`); f.store.close();
});

test('restart during checkpointed inquiry resumes same runtime, goal allocation and observation without new message', async () => {
  const file = filename(); let now = Date.parse(at), f = fixture(file, () => new Date(now).toISOString()); ready(f, 'restart-inquiry'); let calls = 0;
  const shell: ShellPort = { async run(input, bridge) { calls++; if (!input.checkpoint) { const observed = await bridge.execute({ id: 'first-observation', runId: input.run.id, stepId: 'step', name: 'measure', arguments: {} }); const checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, 'fixture', { observationIds: [observed.id], phase: 'observed-await-next' }); return { status: 'checkpointed', observations: [observed], checkpoint }; } const observed = await bridge.execute({ id: 'second-observation', runId: input.run.id, stepId: 'step2', name: 'measure', arguments: {} }); return { status: 'completed', observations: [observed] }; } };
  let r = runtime(f, shell, () => now), scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'restart', policy(), now), runner = new InitiativeRunner({ scheduler, runtime: r.runtime, memory: f.memory, authority, prompt: () => prompt, decide: (_g, obs) => ({ kind: 'complete', evidenceIds: obs.map(o => o.id), reason: 'later observation confirms criteria' }) });
  await runner.tick(); const prior = f.store.get<{ runId: string }>('initiative.execution', 'restart-inquiry')!.value; assert.equal(f.goals.goal('restart-inquiry')?.status, 'waiting'); assert.equal(r.ledger.snapshot(runner.rootAllocation).requests, 1); f.store.close(); now += 1000;
  f = fixture(file, () => new Date(now).toISOString()); r = runtime(f, shell, () => now); scheduler = new FairScheduler(f.store, f.goals, f.obligations, 'restart', policy(), now); runner = new InitiativeRunner({ scheduler, runtime: r.runtime, memory: f.memory, authority, prompt: () => prompt, decide: (_g, obs) => ({ kind: 'complete', evidenceIds: obs.map(o => o.id), reason: 'later observation confirms criteria' }) }); runner.recover(); await runner.tick(); assert.equal(f.goals.goal('restart-inquiry')?.status, 'completed'); assert.equal(f.store.get<{ runId: string }>('initiative.execution', 'restart-inquiry')!.value.runId, prior.runId); assert.equal(r.ledger.snapshot(runner.rootAllocation).requests, 2); assert.equal(calls, 2); assert.equal(f.memory.context({ audience: scope, query: 'measured', maxRecords: 16, maxBytes: 32768 }).memories.length, 2); f.store.close();
});
