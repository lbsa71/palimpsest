import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type ArtifactRef, type Authority, type EvaluationEvidence } from '../contracts/index.ts';
import { AuthorityStore } from '../supervisor/authority.ts';
import { ProcessLease } from '../supervisor/process-lease.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from './admission.ts';
import { freezeCandidate, hashBytes, type FrozenCandidate } from './artifacts.ts';
import { policyDescriptor, ReleaseController, type ReleaseHooks, type ReleaseProof } from './controller.ts';

async function line(child: ChildProcess): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Child readiness timeout')), 5000);
    const data = (bytes: Buffer) => { output += bytes.toString(); if (output.includes('\n')) finish(undefined, output.trim()); };
    const exit = () => finish(new Error('Child exited before readiness'));
    const finish = (error?: Error, result?: string) => {
      clearTimeout(timer); child.stdout?.off('data', data); child.off('exit', exit);
      if (error) reject(error); else resolve(result!);
    };
    child.stdout!.on('data', data); child.once('exit', exit); child.once('error', error => finish(error));
  });
}
async function kill(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-release-cycle-'));
  const store = join(root, 'artifacts'); const source = join(root, 'source'); const operational = join(root, 'operational');
  mkdirSync(source); mkdirSync(operational);
  writeFileSync(join(operational, 'memory.json'), JSON.stringify({ memory: 'initial', uncertainEffects: ['dispatch-unknown'] }));
  const blobs = new Map<string, Uint8Array>(); const policies = new Map<string, AdmissionPolicy>();
  const key = randomBytes(32);
  const artifact = (name: string, bytes: string | Uint8Array): ArtifactRef => {
    const content = Buffer.from(bytes); blobs.set(name, content); return { uri: name, sha256: hashBytes(content) };
  };
  function policy(version: number) {
    // Separate evaluator processes run fixed host-owned files; test author still owns their criteria (engineering only).
    const evaluatorPath = join(root, `evaluator-${version}.mjs`);
    writeFileSync(evaluatorPath, `process.stdout.write(JSON.stringify({evaluator:${version},observed:process.argv[2]}))`);
    const evaluator = artifact(evaluatorPath, readFileSync(evaluatorPath));
    const fields = { kind: 'engineering' as const, requiredCases: ['behavior'], evaluatorKeys: new Map([['reviewer', key]]),
      evaluatorArtifacts: new Map([['reviewer', evaluator.sha256]]) };
    const controls = { version, policy: policyDescriptor(fields) };
    const complete = { ...fields, controlRevision: identity(controls) };
    const result = { ...complete, policyDigest: admissionPolicyIdentity(complete) };
    policies.set(result.policyDigest, result);
    return { policy: result, controls, evaluator };
  }
  const first = policy(1);
  function candidate(version: string, controls = first.controls) {
    writeFileSync(join(source, 'main.mjs'), `import{readFileSync}from'node:fs';import{join}from'node:path';
      console.log(JSON.stringify({version:${JSON.stringify(version)},state:JSON.parse(readFileSync(join(process.argv[2],'memory.json'),'utf8'))}));setInterval(()=>{},1000);`);
    return freezeCandidate(source, store, ['main.mjs'], { dependencies: {}, prompts: {}, model: { unavailable: true },
      configuration: { operational }, controls, createdBy: 'candidate-author' });
  }
  const incumbent = candidate('rescue-v1'); const successor = candidate('successor-v2');
  const authorityStore = new AuthorityStore(join(root, 'authority.sqlite'));
  const current = authorityStore.bootstrap('initial', incumbent.manifest.controls, incumbent.manifest.id);
  const lease = new ProcessLease(join(root, 'lease.sqlite'));
  let counter = 0;
  function proof(c: FrozenCandidate, authority: Authority, rescue = incumbent, policyInput = first): ReleaseProof {
    authority = { generation: authority.generation, epoch: authority.epoch, controlRevision: authority.controlRevision };
    const id = `proof-${++counter}`;
    const evaluated = spawnSync(process.execPath, [policyInput.evaluator.uri, c.manifest.id], { encoding: 'utf8' });
    assert.equal(evaluated.status, 0);
    const observation = artifact(`${id}:observation`, evaluated.stdout);
    const evidence: EvaluationEvidence = { id: `${id}:evidence`, candidateId: c.manifest.id,
      controlRevision: authority.controlRevision, evaluatorId: 'reviewer', evaluatorArtifact: policyInput.evaluator,
      independent: true, verdict: 'pass', artifact: observation, caseResults: [{ id: 'behavior', status: 'pass', observations: observation,
        usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: [] }] };
    return { proposal: { id, candidate: c.manifest, priorAuthority: authority, evidence: [evidence],
      recoveryArtifact: artifact(`${id}:rescue`, readFileSync(join(store, rescue.manifest.id, 'candidate.json'))) },
      signed: [signEvaluation(evidence, key, policyInput.policy.policyDigest)] };
  }
  let worker: ChildProcess | undefined; const starts: unknown[] = [];
  const hooks: ReleaseHooks = {
    async stopAndDrain(prior) { if (prior.generation) assert.throws(() => authorityStore.assert(prior as Authority), /withdrawn/); await kill(worker); worker = undefined; },
    async start(target) {
      authorityStore.assert(target.authority);
      worker = spawn(process.execPath, [join(target.payloadPath, 'main.mjs'), target.operationalStatePath], { stdio: ['ignore', 'pipe', 'pipe'] });
      starts.push(JSON.parse(await line(worker)));
    },
  };
  const options = { statePath: join(root, 'release.sqlite'), artifactStore: store, operationalStatePath: operational,
    authorityStore, exclusiveProcessLease: lease, getPolicy: (digest: string) => { const p = policies.get(digest); if (!p) throw new Error('No local policy'); return p; },
    readArtifact: (uri: string) => { const bytes = blobs.get(uri); if (!bytes) throw new Error('Evidence provider unavailable'); return bytes; }, hooks };
  const controller = new ReleaseController(options);
  const initialProof = proof(incumbent, current); controller.bootstrap(initialProof, first.policy);
  return { root, store, operational, incumbent, successor, authorityStore, lease, options, controller, proof, policy, candidate,
    first, blobs, starts, initialProof, hooks, async dispose() { await kill(worker); controller.close(); lease.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('actual successor probation and offline rescue retain latest memory and uncertain effects, with durable proof', async () => {
  const f = fixture();
  try {
    await f.hooks.start({ candidate: f.incumbent, payloadPath: join(f.store, f.incumbent.manifest.id, 'payload'),
      authority: f.authorityStore.current() as Authority, operationalStatePath: f.operational });
    const proof = f.proof(f.successor, f.authorityStore.current() as Authority);
    const old = f.authorityStore.current() as Authority;
    const next = await f.controller.transfer(proof, 'successor');
    assert.equal(f.controller.status()?.phase, 'probation'); assert.throws(() => f.authorityStore.assert(old), /withdrawn/);
    assert.deepEqual((f.controller.proof(proof.proposal.id) as { receipt: { kind: string } }).receipt.kind, 'engineering');
    assert.equal((f.starts[1] as { version: string }).version, 'successor-v2');
    await assert.rejects(f.controller.transfer(f.proof(f.successor, next), 'third'), /Accept probation/);
    const latest = { memory: 'learned during failed probation', uncertainEffects: ['dispatch-unknown', 'successor-send-unknown'] };
    writeFileSync(join(f.operational, 'memory.json'), JSON.stringify(latest));
    f.blobs.clear(); // No evaluator/recovery artifact service or model is available during recovery.
    assert.ok(f.controller.evidenceArtifact(proof.proposal.evidence[0]!.artifact.sha256));
    const rescued = await f.controller.recover('rescued');
    assert.deepEqual(f.starts[2], { version: 'rescue-v1', state: latest });
    assert.equal(f.controller.status()?.phase, 'accepted'); assert.ok(rescued.epoch > next.epoch);
    assert.deepEqual(JSON.parse(readFileSync(join(f.operational, 'memory.json'), 'utf8')), latest);
    assert.throws(() => f.authorityStore.assert(next), /withdrawn/);
  } finally { await f.dispose(); }
});

test('fresh signed probation judgment pins rescue; changed payload is rejected after drain before execution', async () => {
  const f = fixture();
  try {
    const proof = f.proof(f.successor, f.authorityStore.current() as Authority);
    const next = await f.controller.transfer(proof, 'next');
    assert.throws(() => f.controller.acceptProbation(proof), /fresh evidence/);
    f.controller.acceptProbation(f.proof(f.successor, proof.proposal.priorAuthority));
    assert.equal(f.controller.status()?.accepted.candidateId, f.successor.manifest.id);
    const third = f.candidate('third');
    const thirdProof = f.proof(third, next, f.successor);
    const originalDrain = f.hooks.stopAndDrain;
    f.hooks.stopAndDrain = async prior => {
      await originalDrain(prior);
      const path = join(f.store, third.manifest.id, 'payload', 'main.mjs'); chmodSync(path, 0o600); writeFileSync(path, 'tampered');
    };
    await assert.rejects(f.controller.transfer(thirdProof, 'third'), /payload changed/);
    assert.equal(f.authorityStore.current()?.generation, null);
    assert.equal(f.starts.length, 1);
    f.hooks.stopAndDrain = originalDrain;
    await f.controller.recover('second-rescue');
    assert.equal((f.starts[1] as { version: string }).version, 'successor-v2');
  } finally { await f.dispose(); }
});

test('evaluator/control replacement is separately staged under previous controls and can recover old controls', async () => {
  const f = fixture();
  try {
    const second = f.policy(2); const candidate = f.candidate('control-v2', second.controls);
    const current = f.authorityStore.current() as Authority;
    const oldJudgment = f.proof(candidate, current);
    await assert.rejects(f.controller.transfer(oldJudgment, 'control'), /separately staged/);
    const selfJudgment = f.proof(candidate, current, f.incumbent, second);
    assert.throws(() => f.controller.stageControlUpgrade(selfJudgment, second.policy), /authentication/);
    const stage = f.controller.stageControlUpgrade(oldJudgment, second.policy);
    assert.equal(f.authorityStore.current()?.controlRevision, f.first.policy.controlRevision);
    const newAuthority = await f.controller.activateStagedControl(stage, 'control-v2');
    assert.equal(newAuthority.controlRevision, second.policy.controlRevision);
    assert.equal((f.starts[0] as { version: string }).version, 'control-v2');
    f.blobs.clear(); await f.controller.recover('old-control-rescue');
    assert.equal(f.authorityStore.current()?.controlRevision, f.first.policy.controlRevision);
    await assert.rejects(f.controller.activateStagedControl(stage, 'stale-stage'), /stale authority/);
  } finally { await f.dispose(); }
});

test('failed child startup is fenced and recovery does not need provider access', async () => {
  const f = fixture();
  try {
    const originalStart = f.hooks.start;
    f.hooks.start = async target => { await originalStart(target); throw new Error('probation readiness failed'); };
    await assert.rejects(f.controller.transfer(f.proof(f.successor, f.authorityStore.current() as Authority), 'failed'), /readiness failed/);
    assert.equal(f.authorityStore.current()?.generation, null);
    f.hooks.start = originalStart; f.blobs.clear(); await f.controller.recover('working-rescue');
    assert.equal((f.starts.at(-1) as { version: string }).version, 'rescue-v1');
  } finally { await f.dispose(); }
});

test('new controls cannot judge their own probation; subsequent release uses the accepted new evaluator', async () => {
  const f = fixture();
  try {
    const second = f.policy(2); const candidate = f.candidate('control-v2', second.controls);
    const before = f.authorityStore.current() as Authority;
    const stage = f.controller.stageControlUpgrade(f.proof(candidate, before), second.policy);
    const running = await f.controller.activateStagedControl(stage, 'control-next');
    assert.throws(() => f.controller.acceptProbation(f.proof(candidate, running, f.incumbent, second)), /stale authority/);
    f.controller.acceptProbation(f.proof(candidate, before));
    const later = f.candidate('after-control-v2', second.controls);
    await assert.rejects(f.controller.transfer(f.proof(later, running, candidate), 'old-judge'), /authentication/);
    await f.controller.transfer(f.proof(later, running, candidate, second), 'new-judge');
    assert.equal((f.starts.at(-1) as { version: string }).version, 'after-control-v2');
    f.blobs.clear(); await f.controller.recover('new-controls-rescue');
    assert.equal((f.starts.at(-1) as { version: string }).version, 'control-v2');
    assert.equal(f.authorityStore.current()?.controlRevision, second.policy.controlRevision);
  } finally { await f.dispose(); }
});

test('failed drain prevents successor authority; changed state path and closed lease are rejected', async () => {
  const f = fixture();
  try {
    assert.throws(() => new ReleaseController({ ...f.options, operationalStatePath: join(f.root, 'another-state') }), /original operational state/);
    f.hooks.stopAndDrain = async () => { throw new Error('Unsettled process'); };
    await assert.rejects(f.controller.transfer(f.proof(f.successor, f.authorityStore.current() as Authority), 'never-start'), /Unsettled process/);
    assert.equal(f.authorityStore.current()?.generation, null); assert.equal(f.starts.length, 0);
    f.lease.close();
    await assert.rejects(f.controller.recover('closed-lease'), /lease is closed/);
  } finally { await f.dispose(); }
});

for (const crashAt of ['drain', 'start'] as const) test(`SIGKILL controller during ${crashAt} recovers accepted artifact with latest state`, async () => {
  const f = fixture(); let child: ChildProcess | undefined;
  try {
    const proof = f.proof(f.successor, f.authorityStore.current() as Authority);
    const configPath = join(f.root, 'host-private.json');
    writeFileSync(configPath, JSON.stringify({ proof, policy: { ...f.first.policy,
      evaluatorKeys: [...f.first.policy.evaluatorKeys].map(([id, key]) => [id, Buffer.from(key).toString('hex')]),
      evaluatorArtifacts: [...f.first.policy.evaluatorArtifacts] }, blobs: [...f.blobs].map(([uri, bytes]) => [uri, Buffer.from(bytes).toString('base64')]) }), { mode: 0o600 });
    // Close parent handles before a separate controller process acquires the same OS-backed exclusive lease.
    f.controller.close(); f.lease.close(); f.authorityStore.close();
    const controllerUrl = new URL('./controller.ts', import.meta.url).href;
    const authorityUrl = new URL('../supervisor/authority.ts', import.meta.url).href;
    const leaseUrl = new URL('../supervisor/process-lease.ts', import.meta.url).href;
    child = spawn(process.execPath, ['--input-type=module', '-e', `
      import {readFileSync} from 'node:fs'; import {spawn} from 'node:child_process';
      import {ReleaseController} from ${JSON.stringify(controllerUrl)};
      import {AuthorityStore} from ${JSON.stringify(authorityUrl)}; import {ProcessLease} from ${JSON.stringify(leaseUrl)};
      const config=JSON.parse(readFileSync(${JSON.stringify(configPath)},'utf8'));
      const policy={...config.policy,evaluatorKeys:new Map(config.policy.evaluatorKeys.map(([id,key])=>[id,Buffer.from(key,'hex')])),evaluatorArtifacts:new Map(config.policy.evaluatorArtifacts)};
      const blobs=new Map(config.blobs.map(([uri,bytes])=>[uri,Buffer.from(bytes,'base64')]));
      const lease=new ProcessLease(${JSON.stringify(join(f.root, 'lease.sqlite'))});
      const authorityStore=new AuthorityStore(${JSON.stringify(join(f.root, 'authority.sqlite'))});
      const hold=()=>new Promise(()=>{console.log('crash-ready');setInterval(()=>{},1000)});
      const hooks={async stopAndDrain(){if(${JSON.stringify(crashAt)}==='drain')await hold()},async start(target){
        const worker=spawn(process.execPath,[target.payloadPath+'/main.mjs',target.operationalStatePath],{stdio:['ignore','pipe','inherit']});
        await new Promise(resolve=>worker.stdout.once('data',resolve));await hold();}};
      const controller=new ReleaseController({statePath:${JSON.stringify(f.options.statePath)},artifactStore:${JSON.stringify(f.store)},
        operationalStatePath:${JSON.stringify(f.operational)},authorityStore,exclusiveProcessLease:lease,getPolicy:()=>policy,readArtifact:uri=>blobs.get(uri),hooks});
      await controller.transfer(config.proof,'crashing-successor');
    `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(await line(child), 'crash-ready');
    assert.throws(() => new ProcessLease(join(f.root, 'lease.sqlite')), /holds the instance lease/);
    const latest = { memory: `written during ${crashAt}`, uncertainEffects: ['unknown-must-not-retry'] };
    writeFileSync(join(f.operational, 'memory.json'), JSON.stringify(latest));
    const exit = new Promise(resolve => child!.once('exit', resolve)); process.kill(-child.pid!, 'SIGKILL'); await exit;
    const authorityStore = new AuthorityStore(join(f.root, 'authority.sqlite')); const lease = new ProcessLease(join(f.root, 'lease.sqlite'));
    let worker: ChildProcess | undefined;
    const restarted = new ReleaseController({ ...f.options, authorityStore, exclusiveProcessLease: lease,
      getPolicy() { throw new Error('Policy/evaluator provider unavailable'); }, readArtifact() { throw new Error('Provider unavailable'); },
      hooks: { async stopAndDrain() {}, async start(target) {
        worker = spawn(process.execPath, [join(target.payloadPath, 'main.mjs'), target.operationalStatePath], { stdio: ['ignore', 'pipe', 'pipe'] });
        assert.deepEqual(JSON.parse(await line(worker)), { version: 'rescue-v1', state: latest });
      } } });
    try {
      assert.notEqual(restarted.status()?.phase, 'accepted');
      await restarted.recover(`rescued-after-${crashAt}`);
      assert.equal(restarted.status()?.phase, 'accepted');
      assert.equal(authorityStore.current()?.artifactId, f.incumbent.manifest.id);
    } finally { await kill(worker); restarted.close(); lease.close(); authorityStore.close(); }
  } finally {
    if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await kill(child); }
    rmSync(f.root, { recursive: true, force: true });
  }
});
