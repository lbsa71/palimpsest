import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { OperationalStore } from '../packages/storage/index.ts';
import { acceptHandoff, handoffTools } from './handoff.ts';
import type { EvolutionContext } from './evolution-tools.ts';

test('ordinary handoff tools expose the source-bound task pack without disclosing another audience witness or granting H1', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-handoff-')); const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const context: EvolutionContext = { runId: 'run', scope: { kind: 'public' }, authority: { generation: 'g', epoch: 1, controlRevision: 'controls' }, workspace: root, store };
  try {
    const tools = handoffTools(context, { artifactId: 'current', applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))) });
    const inspect = tools.find(tool => tool.name === 'handoff_inspect')!, plan = tools.find(tool => tool.name === 'handoff_plan')!;
    assert.equal((inspect.execute({}) as any).handoff.status, 'unaccepted');
    const all = plan.execute({}) as any;
    assert.equal(all.lanes.length, 5); assert.equal(all.lanes.reduce((sum: number, lane: any) => sum + lane.tasks.length, 0), 26);
    assert.equal((plan.execute({ lane: 'A2-L04' }) as any).lanes[0].tasks.length, 6);
    assert.throws(() => plan.execute({ lane: '../../private' }), /Known Aeon/);
    store.put('host.handoff', 'H1', { candidateId: 'current', controls: 'controls', scope: { kind: 'restricted', principals: ['alice'] }, sensitiveWitness: 'private-evidence-id' }, null);
    assert.equal(JSON.stringify(inspect.execute({})).includes('private-evidence-id'), false);
    assert.equal((inspect.execute({}) as any).handoff.status, 'unaccepted');
    assert.throws(() => acceptHandoff({ store, artifactStore: root, authority: context.authority, candidateId: 'current', scope: context.scope,
      policy: { kind: 'engineering', controlRevision: 'controls', policyDigest: 'fixture', requiredCases: ['unit-tests'], evaluatorArtifacts: new Map(), evaluatorKeys: new Map() }, proof: {} as any, readArtifact: () => Buffer.alloc(0), releaseController: undefined as any, authorityStore: undefined as any }), /all declared/);
    assert.equal(store.get('host.handoff', 'H1')?.revision, 1, 'engineering evidence cannot overwrite the host witness');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { identity, type ArtifactRef, type EvaluationEvidence } from '../packages/contracts/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { ReleaseController, type ReleaseProof } from '../packages/release/controller.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { freezeCandidate, hashBytes, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { handoffCases } from './handoff.ts';

// Synthetic signed product-shaped evidence exercises mechanics only. It is never a real H1 witness.
function witnessFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-handoff-witness-'));
  const source = join(root, 'source'), operational = join(root, 'operational'), artifactStore = join(root, 'artifacts'); mkdirSync(source); mkdirSync(operational);
  const store = new OperationalStore({ filename: join(operational, 'state.sqlite') });
  const blobs = new Map<string, Uint8Array>();
  const artifact = (uri: string, content: string): ArtifactRef => { const bytes = Buffer.from(content); blobs.set(uri, bytes); return { uri, sha256: hashBytes(bytes) }; };
  const evaluator = artifact('evaluator', 'synthetic test evaluator, no capability measurement');
  const observed = artifact('observed', 'synthetic gate exercise, no product acceptance');
  const key = randomBytes(32), controls = { fixture: true };
  const fields = { kind: 'product' as const, controlRevision: identity(controls), requiredCases: [...handoffCases], evaluatorKeys: new Map([['witness', key]]), evaluatorArtifacts: new Map([['witness', evaluator.sha256]]) };
  const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const candidate = (text: string) => { writeFileSync(join(source, 'main.js'), text); return freezeCandidate(source, artifactStore, ['main.js'], { dependencies: {}, prompts: {}, model: {}, configuration: {}, controls, createdBy: 'fixture-author' }); };
  const current = candidate('fixture accepted source'), other = candidate('fixture unaccepted source');
  const authorityStore = new AuthorityStore(join(root, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('fixture-generation', current.manifest.controls, current.manifest.id);
  const lease = new ProcessLease(join(root, 'lease.sqlite'));
  const readArtifact = (uri: string) => blobs.get(uri)!;
  const releaseController = new ReleaseController({ statePath: join(root, 'release.sqlite'), artifactStore, operationalStatePath: operational, authorityStore, exclusiveProcessLease: lease, getPolicy: () => policy, readArtifact, hooks: { async start() {}, async stopAndDrain() {} } });
  const proof = (value: FrozenCandidate): ReleaseProof => {
    const evidence: EvaluationEvidence = { id: `evidence:${value.manifest.id}`, candidateId: value.manifest.id, controlRevision: authority.controlRevision, evaluatorId: 'witness', evaluatorArtifact: evaluator, independent: true, verdict: 'pass', artifact: observed,
      caseResults: handoffCases.map(id => ({ id, status: 'pass', observations: observed, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: [] })) };
    return { proposal: { id: `proposal:${value.manifest.id}`, candidate: value.manifest, priorAuthority: authority, evidence: [evidence], recoveryArtifact: artifact('recovery', readFileSync(join(artifactStore, current.manifest.id, 'candidate.json'), 'utf8')) }, signed: [signEvaluation(evidence, key, policy.policyDigest)] };
  };
  const options = { store, artifactStore, authority, candidateId: current.manifest.id, scope: { kind: 'public' as const }, policy, proof: proof(current), readArtifact, releaseController, authorityStore };
  return { ...options, root, current, other, proofFor: proof, sign: (evidence: EvaluationEvidence) => signEvaluation(evidence, key, policy.policyDigest), dispose() { releaseController.close(); lease.close(); authorityStore.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

for (const scenario of ['uninitialized', 'foreign-candidate', 'probation', 'withdrawn', 'wrong-store'] as const) test(`H1 refuses signed evidence without exact accepted host state: ${scenario}`, async () => {
  const f = witnessFixture(); let foreignStore: OperationalStore | undefined;
  try {
    if (scenario !== 'uninitialized') f.releaseController.bootstrap(f.proof, f.policy);
    const options = { ...f };
    if (scenario === 'foreign-candidate') { options.candidateId = f.other.manifest.id; options.proof = f.proofFor(f.other); }
    if (scenario === 'probation') { await f.releaseController.transfer(f.proofFor(f.other), 'probation'); options.candidateId = f.other.manifest.id; options.proof = f.proofFor(f.other); }
    if (scenario === 'withdrawn') f.authorityStore.withdraw(f.authority);
    if (scenario === 'wrong-store') { foreignStore = new OperationalStore({ filename: join(f.root, 'foreign', 'state.sqlite') }); options.store = foreignStore; }
    assert.throws(() => acceptHandoff(options), /accepted|authority|state|withdrawn/i);
    assert.equal(options.store.get('host.handoff', 'H1'), undefined);
  } finally { foreignStore?.close(); f.dispose(); }
});

test('H1 admits only complete authenticated source-bound evidence for the accepted release', () => {
  const f = witnessFixture();
  try {
    f.releaseController.bootstrap(f.proof, f.policy);
    const unsigned = structuredClone(f.proof); unsigned.signed[0]!.authentication = '0'.repeat(64);
    assert.throws(() => acceptHandoff({ ...f, proof: unsigned }), /authentication/);
    const missing = structuredClone(f.proof); missing.proposal.evidence[0]!.caseResults.pop();
    missing.signed = [f.sign(missing.proposal.evidence[0]!)];
    assert.throws(() => acceptHandoff({ ...f, proof: missing }), /cases missing/);
    const record = acceptHandoff(f); assert.equal(record.candidateId, f.current.manifest.id);
    const context: EvolutionContext = { runId: 'fixture', scope: f.scope, authority: f.authority, workspace: f.root, store: f.store };
    const inspect = (artifactId: string, authority = f.authority) => handoffTools({ ...context, authority }, { artifactId, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))) })[0]!.execute({}) as any;
    assert.equal(inspect(f.candidateId).handoff.status, 'accepted');
    assert.equal(inspect(f.other.manifest.id).handoff.status, 'unaccepted');
    assert.equal(inspect(f.candidateId, { ...f.authority, controlRevision: 'different' }).handoff.status, 'unaccepted');
  } finally { f.dispose(); }
});
