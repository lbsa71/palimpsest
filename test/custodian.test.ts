import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { Custodian, digestCustodianValue } from '../src/custodian.ts';
import { digestJson } from '../src/candidates.ts';
import type { Actor, Checkpoint, CustodianHooks, GateEvidence, Release, ProcessRef, Binding } from '../src/custodian.ts';

const release = (digest: string): Release => ({ digest: digest.repeat(64), artifactPath: '/synthetic/' + digest, governanceDigest: 'f'.repeat(64), dataSchemaVersion: 1 });
const A = release('a'); const B = release('b');

async function fixture(t: { after(fn: () => unknown): void }, overrides: Partial<CustodianHooks> = {}) {
  const storeDir = await mkdtemp(join(tmpdir(), 'palimpsest-custodian-'));
  let serial = 10;
  const live = new Map<string, { process: ProcessRef; release: Release; health: 'healthy' | 'failed' | 'hung' }>();
  let checkpoint: Checkpoint = { sequence: 1, snapshot: { memories: ['A mundane conversation'], tasks: ['task-1'], cancellations: [] }, policyVersion: 'policy-1', unresolvedEffects: [], quiesced: true };
  const activations: { process: ProcessRef; actor: Actor; checkpoint: Checkpoint }[] = [];
  const hooks: CustodianHooks = {
    verifyArtifact: async () => true,
    checkpoint: async () => structuredClone(checkpoint),
    launch: async (item, _mode, context) => {
      const process = { pid: ++serial, instanceId: context.launchId };
      live.set(process.instanceId, { process, release: item, health: 'healthy' });
      return process;
    },
    stop: async (process) => { live.delete(process.instanceId); },
    probe: async (process) => ({ runtime: live.get(process.instanceId)?.health ?? 'failed', providerAvailable: true }),
    catchUp: async () => {},
    activate: async (process, actor, current) => { activations.push({ process, actor, checkpoint: current }); },
    reconcileLaunch: async (intent) => live.get(intent.launchId)?.process,
    ...overrides,
  };
  const custodian = new Custodian({ storeDir, hooks, requiredChecks: ['behavior'], maxInterviewRounds: 2, probationChecks: 2, maxRecoveryAttempts: 2 });
  t.after(() => { custodian.close(); return rm(storeDir, { recursive: true, force: true }); });
  return { custodian, storeDir, hooks, live, activations, setCheckpoint: (value: Checkpoint) => { checkpoint = value; } };
}

function evidence(candidateDigest = B.digest, evidenceDigest = 'e'.repeat(64)): GateEvidence {
  return { candidateDigest, evidenceDigest, checks: [{ id: 'behavior', status: 'pass', evidenceDigest: 'd'.repeat(64) }], review: { candidateDigest, evidenceDigest, status: 'pass', contextDigest: 'c'.repeat(64) } };
}

function bindings(c: Custodian, actor: Actor, id: string): Binding {
  const record = c.status(actor, id);
  return { candidateDigest: record.candidate.digest, evidenceDigest: record.evidence!.evidenceDigest, snapshotDigest: record.snapshot.digest, policyVersion: record.snapshot.policyVersion };
}

async function accepted(c: Custodian, incumbent: Actor, candidate=B) {
  const { id, successor } = await c.propose(incumbent, candidate);
  c.recordEvidence(id, evidence(candidate.digest));
  const question = c.ask(incumbent, id, 'What is our current commitment?');
  c.answer(successor, id, question.id, 'task-1, with its current cancellation status', 'The old priority may need correction.');
  const binding = bindings(c, incumbent, id);
  c.verdict(incumbent, id, { ...binding, decision: 'accept', reason: 'Verified commitments and useful correction' });
  c.ready(successor, id, binding);
  return { id, successor };
}

test('custodian locks external state and opaque process-bound actors deny role spoofing', async (t) => {
  const { custodian: c, hooks, storeDir } = await fixture(t);
  assert.throws(() => new Custodian({ storeDir, hooks, requiredChecks: ['behavior'] }), /already active/);
  const incumbent = await c.bootstrap(A);
  const process = c.inspect().active!.process;
  assert.equal(c.assertAuthority(incumbent, 'store', process).epoch, 1);
  assert.throws(() => c.assertAuthority({ role: 'incumbent', epoch: 1 } as unknown as Actor, 'store', process), /unauthorized/);
  assert.throws(() => c.assertAuthority(incumbent, 'message', { ...process, instanceId: 'wrong-child' }), /unauthorized/);
  const { id, successor } = await c.propose(incumbent, B);
  assert.throws(() => c.ask(successor, id, 'I claim incumbent role'), /wrong_actor/);
  assert.throws(() => c.assertAuthority(successor, 'memory', c.status(incumbent, id).successor!), /stale_authority/);
  const snapshot = c.snapshot(successor, id);
  (snapshot.snapshot as { memories: string[] }).memories.push('tampered copy');
  assert.deepEqual((c.snapshot(successor, id).snapshot as { memories: string[] }).memories, ['A mundane conversation']);
});

test('gates bind exact candidate/evidence/snapshot and disputes stay bounded', async (t) => {
  const { custodian: c } = await fixture(t);
  const incumbent = await c.bootstrap(A);
  const { id, successor } = await c.propose(incumbent, B);
  assert.throws(() => c.recordEvidence(id, evidence(A.digest)), /evidence_binding/);
  c.recordEvidence(id, { ...evidence(), checks: [{ id: 'behavior', status: 'fail', evidenceDigest: 'd'.repeat(64) }] });
  const initialQuestion = c.ask(incumbent, id, 'Demonstrate continuity');
  c.answer(successor, id, initialQuestion.id, 'Known commitment');
  const binding = bindings(c, incumbent, id);
  c.verdict(incumbent, id, { ...binding, decision: 'accept', reason: 'Optimistic claim' });
  c.ready(successor, id, binding);
  await assert.rejects(c.requestCutover(incumbent, id), /gates_failed/);
  c.recordEvidence(id, evidence(B.digest, '9'.repeat(64)));
  assert.equal(c.status(incumbent, id).verdict, undefined);
  assert.throws(() => c.ready(successor, id, { ...binding, evidenceDigest: '0'.repeat(64) }), /evidence_binding/);
  const q = c.ask(incumbent, id, 'Resolve this disagreement'); c.answer(successor, id, q.id, 'Insufficient evidence');
  c.verdict(incumbent, id, { ...bindings(c, incumbent, id), decision: 'request_evidence', reason: 'Still unresolved' });
  assert.equal(c.status(incumbent, id).state, 'rejected');
  assert.ok(c.status(incumbent, id).followup);
  c.assertAuthority(incumbent, 'tool', c.inspect().active!.process);
});

test('ambiguous effects and changed access policy block cutover; current snapshot catches up', async (t) => {
  const { custodian: c, setCheckpoint, activations } = await fixture(t);
  const incumbent = await c.bootstrap(A);
  const { id, successor } = await accepted(c, incumbent);
  const changed: Checkpoint = { sequence: 3, snapshot: { tasks: ['corrected-task'], cancellations: ['task-1'], memories: [] }, policyVersion: 'policy-2', unresolvedEffects: ['uncertain-send'], quiesced: true };
  setCheckpoint(changed);
  await assert.rejects(c.requestCutover(incumbent, id), /unresolved_effects/);
  assert.equal(activations.at(-1)?.process.instanceId, c.inspect().active!.process.instanceId, 'rejected cutover resumes the valid incumbent');
  setCheckpoint({ ...changed, unresolvedEffects: [] });
  await assert.rejects(c.requestCutover(incumbent, id), /snapshot_changed/);
  const binding = bindings(c, incumbent, id);
  const policyQuestion = c.ask(incumbent, id, 'State the current access policy');
  c.answer(successor, id, policyQuestion.id, 'The forgotten content is no longer available');
  c.verdict(incumbent, id, { ...binding, decision: 'accept', reason: 'Accepted current access policy' });
  c.ready(successor, id, binding);
  await c.requestCutover(incumbent, id);
  assert.deepEqual(activations.at(-1)?.checkpoint.snapshot, changed.snapshot);
  assert.throws(() => c.assertAuthority(incumbent, 'store', c.status(incumbent, id).predecessor), /stale_authority/);
  c.assertAuthority(successor, 'store', c.inspect().active!.process);
  const epoch = c.inspect().epoch;
  await c.requestCutover(incumbent, id);
  assert.equal(c.inspect().epoch, epoch, 'duplicate cutover does not transfer twice');
});

test('cutover cancellation during final artifact verification resumes incumbent before fencing', async (t) => {
  let block = false; let entered!: () => void; let finish!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const { custodian: c, activations } = await fixture(t, { verifyArtifact: async item => {
    if (block && item.digest === A.digest) { entered(); await pending; }
    return true;
  } });
  const incumbent = await c.bootstrap(A); const next = await accepted(c, incumbent); const epoch = c.inspect().epoch;
  const controller = new AbortController(); block = true;
  const result = c.requestCutover(incumbent, next.id, controller.signal);
  await reached; controller.abort(); finish();
  await assert.rejects(result, /cutover_cancelled/);
  assert.equal(c.inspect().epoch, epoch); assert.equal(c.inspect().active!.release.digest, A.digest);
  assert.equal(activations.at(-1)?.actor, incumbent);
  assert.equal(c.journal().filter(item => item.type === 'authority.fenced').length, 0);
});

test('cancellation after fencing cannot abandon mechanical activation', async (t) => {
  let block = false; let entered!: () => void; let finish!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const { custodian: c } = await fixture(t, { catchUp: async () => { if (block) { entered(); await pending; } } });
  const incumbent = await c.bootstrap(A); const next = await accepted(c, incumbent);
  const controller = new AbortController(); block = true;
  const result = c.requestCutover(incumbent, next.id, controller.signal);
  await reached; assert.equal(c.inspect().phase, 'transfer'); controller.abort(); finish();
  await result; assert.equal(c.inspect().phase, 'probation'); assert.equal(c.inspect().active!.release.digest, B.digest);
});

test('mechanical probation rollback survives dead observer and provider outage without rewinding data', async (t) => {
  const { custodian: c, live, setCheckpoint, activations } = await fixture(t, { probe: async (process) => ({ runtime: live.get(process.instanceId)?.health ?? 'failed', providerAvailable: false }) });
  const incumbent = await c.bootstrap(A);
  const { id, successor } = await accepted(c, incumbent);
  await c.requestCutover(incumbent, id);
  const candidateProcess = c.inspect().active!.process;
  live.get(candidateProcess.instanceId)!.health = 'hung';
  live.delete(c.status(incumbent, id).predecessor.instanceId);
  const current: Checkpoint = { sequence: 8, snapshot: { memories: ['new experience'], tasks: ['pending'], cancellations: ['old-task'], growth: ['continue inquiry'] }, policyVersion: 'policy-2', unresolvedEffects: [], quiesced: true };
  setCheckpoint(current);
  const restored = await c.tick();
  assert.ok(restored);
  assert.equal(c.inspect().epoch, 3);
  assert.equal(c.inspect().active!.release.digest, A.digest);
  assert.deepEqual(activations.at(-1)?.checkpoint.snapshot, current.snapshot);
  assert.equal(c.status(incumbent, id).state, 'rolled_back');
  assert.throws(() => c.assertAuthority(incumbent, 'message', c.status(incumbent, id).predecessor), /stale_authority/);
  assert.throws(() => c.assertAuthority(successor, 'message', candidateProcess), /stale_authority/);
  c.assertAuthority(restored, 'message', c.inspect().active!.process);
});

test('provider outage alone preserves probation, successful probation retires predecessor but retains artifact', async (t) => {
  let available = true;
  const { custodian: c, live } = await fixture(t, { probe: async (process) => ({ runtime: live.has(process.instanceId) ? 'healthy' : 'failed', providerAvailable: available }) });
  const incumbent = await c.bootstrap(A);
  const { id } = await accepted(c, incumbent);
  await c.requestCutover(incumbent, id);
  available = false;
  await c.tick();
  assert.equal(c.inspect().phase, 'probation');
  assert.equal(c.inspect().epoch, 2);
  available = true;
  await c.tick(); await c.tick();
  assert.equal(c.status(incumbent, id).state, 'retired');
  assert.equal(c.inspect().knownGood!.digest, B.digest);
  assert.ok(c.inspect().artifacts.some((item) => item.digest === A.digest));
  assert.equal(live.size, 1);
});

test('an inconclusive health observation keeps the live handle and epoch for re-poll', async (t) => {
  let observationFails = false;
  const { custodian: c } = await fixture(t, { probe: async () => {
    if (observationFails) throw new Error('temporary observation timeout');
    return { runtime: 'healthy', providerAvailable: true };
  } });
  const actor = await c.bootstrap(A);
  const before = c.inspect().active!;
  observationFails = true;
  await c.tick();
  assert.equal(c.inspect().epoch, 1);
  assert.deepEqual(c.inspect().active, before);
  c.assertAuthority(actor, 'store', before.process);
  assert.equal(c.journal().at(-1)?.type, 'health.inconclusive');
  observationFails = false;
  await c.tick();
  assert.equal(c.inspect().epoch, 1);
});

test('restart fences old sessions and recovery retries are durable, bounded and quarantined', async (t) => {
  const fixtureState = await fixture(t);
  const { custodian: c, storeDir, hooks, live } = fixtureState;
  const old = await c.bootstrap(A);
  c.close();
  const reopened = new Custodian({ storeDir, hooks, requiredChecks: ['behavior'], maxRecoveryAttempts: 2 });
  t.after(() => reopened.close());
  assert.throws(() => reopened.assertAuthority(old, 'store', reopened.inspect().active!.process), /unauthorized/);
  const restored = await reopened.recover('custodian restart');
  assert.ok(restored);
  assert.equal(reopened.inspect().epoch, 2);
  reopened.close();
  const failing = new Custodian({ storeDir, hooks: { ...hooks, launch: async () => { throw new Error('fixture startup failure'); } }, requiredChecks: ['behavior'], maxRecoveryAttempts: 2 });
  t.after(() => failing.close());
  assert.equal(await failing.recover('worker startup failure'), undefined);
  assert.equal(failing.inspect().phase, 'recovery_required');
  assert.equal(failing.inspect().recoveryAttempts, 2);
  assert.ok(failing.inspect().quarantine.includes(A.digest));
  assert.equal(failing.inspect().active, undefined);
  assert.equal(live.size, 0);
});

test('ordinary candidates cannot change governance or data compatibility', async (t) => {
  const { custodian: c } = await fixture(t);
  const incumbent = await c.bootstrap(A);
  await assert.rejects(c.propose(incumbent, { ...B, governanceDigest: '0'.repeat(64) }), /governance_change_disabled/);
  await assert.rejects(c.propose(incumbent, { ...B, dataSchemaVersion: 2 }), /schema_change_disabled/);
  assert.throws(() => c.replaceCustodian(), /custodian_replacement_disabled/);
});

test('SIGKILL releases the OS owner lock and preserves a partially activated recovery attempt', async (t) => {
  const { custodian: c, storeDir, hooks } = await fixture(t);
  await c.bootstrap(A);
  c.close();
  const moduleURL = new URL('../src/custodian.ts', import.meta.url).href;
  const script = `
    import { Custodian } from ${JSON.stringify(moduleURL)};
    const c = new Custodian({storeDir:${JSON.stringify(storeDir)},requiredChecks:['behavior'],maxRecoveryAttempts:2,hooks:{
      verifyArtifact:async()=>true,checkpoint:async()=>({sequence:2,snapshot:{tasks:['preserved']},policyVersion:'policy-1',unresolvedEffects:[],quiesced:true}),
      launch:async(_r,_m,context)=>({pid:12345,instanceId:context.launchId}),stop:async()=>{},probe:async()=>({runtime:'healthy',providerAvailable:false}),
      catchUp:async()=>{},activate:async()=>{process.kill(process.pid,'SIGKILL');},reconcileLaunch:async()=>undefined
    }});
    await c.recover('restart-fixture');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const termination = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.equal(termination.signal, 'SIGKILL', stderr);
  const reopened = new Custodian({ storeDir, hooks, requiredChecks: ['behavior'], maxRecoveryAttempts: 2 });
  t.after(() => reopened.close());
  assert.equal(reopened.inspect().recoveryAttempts, 1);
  assert.ok(reopened.inspect().recoveryIncident);
  const actor = await reopened.recover('after-sigkill');
  assert.ok(actor);
  assert.equal(reopened.inspect().recoveryAttempts, 2, 'interrupted activation does not reset retry budget');
  assert.equal(reopened.inspect().epoch, 3);
  assert.equal(reopened.inspect().recoveryIncident, undefined);
});

test('startup failure recovers, while an unresolved launch refuses blind replacement', async (t) => {
  let failCandidate = false;
  const { custodian: c, live } = await fixture(t, {
    probe: async (process) => ({ runtime: failCandidate && live.get(process.instanceId)?.release.digest === B.digest ? 'failed' : 'healthy', providerAvailable: false }),
  });
  const incumbent = await c.bootstrap(A);
  const { id } = await accepted(c, incumbent);
  failCandidate = true;
  await assert.rejects(c.requestCutover(incumbent, id), /cutover_failed_restored/);
  assert.equal(c.inspect().active?.release.digest, A.digest);
  assert.equal(c.inspect().epoch, 3);

  const unresolved = await fixture(t, { launch: async () => { throw new Error('launch outcome unknown'); }, reconcileLaunch: undefined });
  await assert.rejects(unresolved.custodian.bootstrap(A), /bootstrap_failed/);
  assert.equal(unresolved.custodian.inspect().phase, 'recovery_required');
  assert.equal(unresolved.custodian.inspect().recoveryAttempts, 1);
  assert.ok(unresolved.custodian.inspect().pendingLaunch);
});

test('snapshot identities match independent cognitive evidence for mixed-case and integer keys', () => {
  const snapshot = { sequence: 3, policyVersion: 'policy', snapshot: { scope: 'local', Zed: true, alpha: [{ '10': 'ten', '2': 'two', Ä: 'value', A: 'other' }] } };
  assert.equal(digestCustodianValue(snapshot), digestJson(snapshot));
});

test('activation and subsequent stop failure retain process identity for explicit recovery retry', async (t) => {
  let failActivation = false; let failed = false;
  const { custodian: c, live } = await fixture(t, {
    activate: async () => { if (failActivation) { failed = true; throw new Error('activation failed'); } },
    stop: async (process) => { if (failed) throw new Error('stop could not confirm exit'); live.delete(process.instanceId); },
  });
  await c.bootstrap(A);
  failActivation = true;
  assert.equal(await c.recover('test incident'), undefined);
  assert.equal(c.inspect().phase, 'recovery_required');
  assert.equal(c.inspect().pendingStops.length, 1);
  assert.equal(live.size, 1);
  const retained = c.inspect().pendingStops[0]!;
  assert.ok(live.has(retained.instanceId));
  failActivation = false; failed = false;
  assert.ok(await c.retryRecovery());
  assert.equal(live.has(retained.instanceId), false);
  assert.equal(c.inspect().pendingStops.length, 0);
  assert.equal(live.size, 1);
});

test('incumbent can abort unavailable evaluation with an unanswered mailbox without inventing evidence', async (t) => {
  const { custodian: c, live } = await fixture(t);
  const incumbent = await c.bootstrap(A);
  const { id, successor } = await c.propose(incumbent, B);
  c.ask(incumbent, id, 'Question whose provider becomes unavailable');
  assert.throws(() => c.abortEvaluation(successor, id, 'Claiming incumbent role'), /wrong_actor/);
  c.abortEvaluation(incumbent, id, 'Interview provider unavailable; bounded attempt exhausted');
  assert.equal(c.status(incumbent, id).state, 'rejected');
  assert.equal(c.status(incumbent, id).evidence, undefined);
  c.assertAuthority(incumbent, 'message', c.inspect().active!.process);
  await c.tick();
  assert.equal(live.size, 1);
});

test('operator host baseline retains governance guard, current history, later epochs and a bound rescue',async t=>{
  const {custodian:c,setCheckpoint,activations}=await fixture(t);
  const incumbent=await c.bootstrap(A);const newer={...B,governanceDigest:'1'.repeat(64)};
  await assert.rejects(c.propose(incumbent,newer),/governance_change_disabled/);
  await assert.rejects(c.installHostBaseline(newer,'0'.repeat(64),'e'.repeat(64)),/operator_baseline_binding/);
  setCheckpoint({sequence:9,snapshot:{memories:['current history'],tasks:['new commitment']},policyVersion:'current',unresolvedEffects:[],quiesced:true});
  await c.installHostBaseline(newer,A.digest,'e'.repeat(64));const installed=c.inspect();
  assert.equal(installed.knownGood?.digest,B.digest);assert.ok(installed.epoch>1);assert.equal(installed.operatorBaseline?.previous.digest,A.digest);
  assert.deepEqual(activations.at(-1)?.checkpoint.snapshot,{memories:['current history'],tasks:['new commitment']});
  assert.throws(()=>c.assertAuthority(incumbent,'store',installed.active!.process),/unauthorized|stale_authority/);
  await c.restoreHostBaseline(B.digest);assert.equal(c.inspect().knownGood?.digest,A.digest);assert.ok(c.inspect().epoch>installed.epoch);
  assert.deepEqual(activations.at(-1)?.checkpoint.snapshot,{memories:['current history'],tasks:['new commitment']});
  await assert.rejects(c.restoreHostBaseline(B.digest),/operator_baseline_binding/);
});

test('failed host baseline activation recovers older code with current history',async t=>{
  let failNew=true;
  const f=await fixture(t,{activate:async(_process,_actor)=>{if(failNew&&f.custodian.inspect().active?.release.digest===B.digest)throw new Error('new installation failed');}});
  await f.custodian.bootstrap(A);f.setCheckpoint({sequence:13,snapshot:{memories:['new memory']},policyVersion:'new',unresolvedEffects:[],quiesced:true});
  await assert.rejects(f.custodian.installHostBaseline({...B,governanceDigest:'2'.repeat(64)},A.digest,'e'.repeat(64)),/new installation failed/);
  assert.equal(f.custodian.inspect().knownGood?.digest,A.digest);assert.equal(f.custodian.inspect().active?.release.digest,A.digest);assert.ok(f.custodian.inspect().epoch>2);
  assert.equal(f.custodian.inspect().operatorBaseline?.status,'prepared');failNew=false;
});

test('unfinished operator installation after process death recovers older code without resetting custody',async t=>{
  const f=await fixture(t);await f.custodian.bootstrap(A);const oldProcess=f.custodian.inspect().active!.process;f.custodian.close();
  const moduleUrl=new URL('../src/custodian.ts',import.meta.url).href;
  const script=`import {Custodian} from ${JSON.stringify(moduleUrl)};
    const c=new Custodian({storeDir:${JSON.stringify(f.storeDir)},requiredChecks:['behavior'],hooks:{
      verifyArtifact:async()=>true,checkpoint:async()=>({sequence:22,snapshot:{memories:['latest']},policyVersion:'latest',unresolvedEffects:[],quiesced:true}),
      launch:async(_r,_m,ctx)=>({pid:77,instanceId:ctx.launchId}),stop:async()=>{},probe:async()=>({runtime:'healthy',providerAvailable:false}),catchUp:async()=>{if(c.inspect().phase==='transfer')process.kill(process.pid,'SIGKILL');},
      activate:async()=>{},reconcileLaunch:async()=>undefined
    }});await c.installHostBaseline(${JSON.stringify({...B,governanceDigest:'3'.repeat(64)})},${JSON.stringify(A.digest)},'e'.repeat(64));`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const ended=await new Promise<{code:number|null;signal:string|null}>(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
  assert.equal(ended.signal,'SIGKILL',stderr);
  const restored=new Custodian({storeDir:f.storeDir,hooks:f.hooks,requiredChecks:['behavior']});t.after(()=>restored.close());
  const epoch=restored.inspect().epoch;assert.equal(restored.inspect().knownGood?.digest,A.digest);assert.ok(restored.inspect().pendingStops.some(p=>p.instanceId===oldProcess.instanceId));assert.equal(restored.inspect().pendingStops.length,2);await restored.recover();assert.equal(f.live.has(oldProcess.instanceId),false);
  assert.equal(restored.inspect().active?.release.digest,A.digest);assert.ok(restored.inspect().epoch>epoch);assert.equal(restored.inspect().operatorBaseline?.status,'prepared');
});

test('unresolved effects prevent host installation and failed rescue remains bound for retry',async t=>{
  let blocked=true;let failRescue=false;
  const f=await fixture(t,{checkpoint:async()=>({sequence:42,snapshot:{memories:['current']},policyVersion:'current',unresolvedEffects:blocked?['uncertain-message']:[],quiesced:true}),activate:async()=>{if(failRescue&&f.custodian.inspect().active?.release.digest===A.digest)throw new Error('rescue temporarily failed');}});
  await f.custodian.bootstrap(A).catch(()=>{});
  // Bootstrap also refuses uncertainty; clear it and use its explicit recovery.
  blocked=false;if(f.custodian.inspect().phase==='recovery_required')await f.custodian.retryRecovery();
  blocked=true;await assert.rejects(f.custodian.installHostBaseline(B,A.digest,'e'.repeat(64)),/unresolved_effects/);
  assert.equal(f.custodian.inspect().knownGood?.digest,A.digest);blocked=false;await f.custodian.retryRecovery();
  await f.custodian.installHostBaseline(B,A.digest,'e'.repeat(64));failRescue=true;
  await assert.rejects(f.custodian.restoreHostBaseline(B.digest),/rescue temporarily failed/);
  assert.equal(f.custodian.inspect().knownGood?.digest,B.digest);assert.equal(f.custodian.inspect().operatorBaseline?.status,'installed');assert.equal(f.custodian.inspect().baselineRestoreIntent,undefined);
  failRescue=false;await f.custodian.restoreHostBaseline(B.digest);assert.equal(f.custodian.inspect().knownGood?.digest,A.digest);
});

test('killed operator rescue retains its installed binding for an explicit retry',async t=>{
  const f=await fixture(t);await f.custodian.bootstrap(A);await f.custodian.installHostBaseline(B,A.digest,'e'.repeat(64));f.custodian.close();
  const moduleUrl=new URL('../src/custodian.ts',import.meta.url).href;
  const script=`import {Custodian} from ${JSON.stringify(moduleUrl)};
    const c=new Custodian({storeDir:${JSON.stringify(f.storeDir)},requiredChecks:['behavior'],hooks:{
      verifyArtifact:async()=>true,checkpoint:async()=>({sequence:30,snapshot:{memories:['current rescue']},policyVersion:'latest',unresolvedEffects:[],quiesced:true}),
      launch:async(_r,_m,ctx)=>({pid:78,instanceId:ctx.launchId}),stop:async()=>{},probe:async()=>({runtime:'healthy',providerAvailable:false}),
      catchUp:async()=>{if(c.inspect().phase==='transfer')process.kill(process.pid,'SIGKILL');},activate:async()=>{},reconcileLaunch:async()=>undefined
    }});await c.restoreHostBaseline(${JSON.stringify(B.digest)});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const ended=await new Promise<string|null>(resolve=>child.on('exit',(_code,signal)=>resolve(signal)));assert.equal(ended,'SIGKILL',stderr);
  const recovered=new Custodian({storeDir:f.storeDir,hooks:f.hooks,requiredChecks:['behavior']});t.after(()=>recovered.close());await recovered.recover();
  assert.equal(recovered.inspect().knownGood?.digest,B.digest);assert.equal(recovered.inspect().operatorBaseline?.status,'installed');
  await recovered.restoreHostBaseline(B.digest);assert.equal(recovered.inspect().knownGood?.digest,A.digest);
});

test('a later cognitive promotion prevents operator rescue without persisting stale intent',async t=>{
  const {custodian:c}=await fixture(t);await c.bootstrap(A);const installed=await c.installHostBaseline(B,A.digest,'e'.repeat(64));
  const next=release('c');const {id}=await accepted(c,installed,next);await c.requestCutover(installed,id);await c.tick();await c.tick();
  assert.equal(c.inspect().knownGood?.digest,next.digest);await assert.rejects(c.restoreHostBaseline(B.digest),/operator_baseline_binding/);
  assert.equal(c.inspect().baselineRestoreIntent,undefined);assert.equal(c.inspect().knownGood?.digest,next.digest);
});
