import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
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
  const root = mkdtempSync(join(tmpdir(), 'aeon-ordinary-staged-'));
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
    writeFileSync(join(source, 'prompt.txt'), version);
    writeFileSync(join(source, 'main.mjs'), `import{readFileSync}from'node:fs';import{join}from'node:path';
      console.log(JSON.stringify({version:readFileSync(new URL('./prompt.txt',import.meta.url),'utf8'),state:JSON.parse(readFileSync(join(process.argv[2],'memory.json'),'utf8'))}));setInterval(()=>{},1000);`);
    return freezeCandidate(source, store, ['main.mjs', 'prompt.txt'], { dependencies: {}, prompts: { version }, model: { unavailable: true },
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
    first, policies, blobs, starts, initialProof, hooks, async dispose() { await kill(worker); controller.close(); lease.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('ordinary prompt succession stages without withdrawal, then activates with fresh old-policy probation and retained state', async () => {
  const f = fixture();
  try {
    const prior = f.authorityStore.current() as Authority, before = readFileSync(join(f.operational, 'memory.json'));
    assert.equal(f.incumbent.manifest.controls, f.successor.manifest.controls);
    assert.notEqual(f.incumbent.manifest.prompts, f.successor.manifest.prompts);
    const admission = f.proof(f.successor, prior);
    const stage = f.controller.stageControlUpgrade(admission, f.first.policy);
    assert.equal(f.controller.status()!.phase, 'accepted');
    assert.deepEqual(f.authorityStore.current(), prior); assert.deepEqual(f.starts, []);
    const next = await f.controller.activateStagedControl(stage, 'ordinary-successor');
    assert.equal(f.controller.status()!.phase, 'probation');
    assert.equal(f.controller.status()!.probationJudge!.change, 'ordinary');
    assert.equal(f.controller.status()!.probationJudge!.policyDigest, f.first.policy.policyDigest);
    assert.equal(next.controlRevision, prior.controlRevision);
    assert.throws(() => f.authorityStore.assert(prior), /withdrawn/);
    assert.deepEqual(f.starts, [{ version: 'successor-v2', state: JSON.parse(before.toString()) }]);
    assert.throws(() => f.controller.acceptProbation(admission), /fresh evidence/);
    f.controller.acceptProbation(f.proof(f.successor, prior));
    assert.equal(f.controller.status()!.phase, 'accepted');
    assert.equal(f.controller.status()!.accepted.candidateId, f.successor.manifest.id);
    assert.equal(f.controller.status()!.accepted.policyDigest, f.first.policy.policyDigest);
    assert.deepEqual(readFileSync(join(f.operational, 'memory.json')), before);
  } finally { await f.dispose(); }
});

test('ordinary stage and activation reject policy replacement even when controls identity is unchanged', async () => {
  const f = fixture();
  try {
    const prior = f.authorityStore.current() as Authority;
    const modified = { ...f.first.policy, requiredCases: ['additional-case'] };
    const replacement = { ...modified, policyDigest: admissionPolicyIdentity(modified) };
    f.policies.set(replacement.policyDigest, replacement);
    const admission = f.proof(f.successor, prior);
    assert.throws(() => f.controller.stageControlUpgrade(admission, replacement), /retain the accepted policy/);
    assert.deepEqual(f.authorityStore.current(), prior); assert.deepEqual(f.starts, []);
    const stage = f.controller.stageControlUpgrade(admission, f.first.policy);
    const db = new DatabaseSync(join(f.root, 'release.sqlite'));
    try {
      const stored = f.controller.stagedControl(stage)!;
      db.prepare('UPDATE release_stages SET value=? WHERE id=?').run(JSON.stringify({ ...stored, nextPolicyDigest: replacement.policyDigest }), stage);
    } finally { db.close(); }
    await assert.rejects(f.controller.activateStagedControl(stage, 'forbidden-policy'), /retain the accepted policy/);
    assert.deepEqual(f.authorityStore.current(), prior); assert.deepEqual(f.starts, []);
    assert.equal(f.controller.status()!.phase, 'accepted');
  } finally { await f.dispose(); }
});

test('ordinary staged probation can recover the exact incumbent without model or evidence services', async () => {
  const f = fixture();
  try {
    const prior = f.authorityStore.current() as Authority;
    const stage = f.controller.stageControlUpgrade(f.proof(f.successor, prior), f.first.policy);
    const next = await f.controller.activateStagedControl(stage, 'ordinary-probation');
    const latest = { memory: 'retained through failed probation', uncertainEffects: ['dispatch-unknown', 'new-unknown'] };
    writeFileSync(join(f.operational, 'memory.json'), JSON.stringify(latest));
    f.blobs.clear(); await f.controller.recover('ordinary-recovery');
    assert.equal(f.controller.status()!.accepted.candidateId, f.incumbent.manifest.id);
    assert.deepEqual(f.starts.at(-1), { version: 'rescue-v1', state: latest });
    assert.throws(() => f.authorityStore.assert(next), /withdrawn/);
    await assert.rejects(f.controller.activateStagedControl(stage, 'stale'), /stale authority/);
  } finally { await f.dispose(); }
});
