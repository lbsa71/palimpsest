import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, identity, type Run } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { type CommandReceipt, type ConfinedCommand } from '../packages/supervisor/confinement.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { createEngineeringPlan, engineeringCases, engineeringPlanMount, nodeEngineeringReviewEnvironment, runEngineeringReview, type EngineeringReviewOptions } from './engineering-review.ts';
import { reviewerDescriptor, type ReviewerFile } from './evaluation-dispatch.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import type { ModelProfile } from './model-grants.ts';

const model: ModelProfile = { provider: 'mistral', id: 'mistral-large-4-0', contextWindow: 1000000, reasoning: false, effort: 'none', maxOutputTokens: 512,
  maxRequestsPerSlice: 1, timeoutMs: 10000, pricesPerMillion: { input: 0.5, output: 1.5 } };
const passed: CommandReceipt = { exitCode: 0, signal: null, stdout: '', stderr: '', elapsedMs: 1 };
const compilerArgs = ['/app/node_modules/typescript/bin/tsc', '--project', '/work/tsconfig.json', '--typeRoots', '/app/node_modules/@types', '--noEmit'];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'engineering-host-evidence-'));
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'work'), artifactStore: join(root, 'artifacts'), nodeBinary: realpathSync(process.execPath) };
  for (const directory of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) mkdirSync(directory);
  const source = join(root, 'source'), assets = join(root, 'reviewer'); mkdirSync(assets);
  for (const entry of ['deployment/prompts', 'packages', 'node_modules/typescript/bin', 'node_modules/@types/node', 'node_modules/undici-types', `node_modules/@typescript/typescript-${process.platform}-${process.arch}`]) mkdirSync(join(source, entry), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"type":"module"}'); writeFileSync(join(source, 'package-lock.json'), '{"lockfileVersion":3}'); writeFileSync(join(source, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  // This fixture explicitly fakes the compiler port. Its accepted compiler bytes
  // remain real and hash-bound. This file tests the host observation contract only.
  writeFileSync(join(source, 'node_modules/typescript/bin/tsc'), '// Fixture compiler: never executed.\n');
  writeFileSync(join(source, 'deployment/shell-worker.ts'), 'export {};\n'); writeFileSync(join(source, 'deployment/application.ts'), 'export const generation = 1;\n');
  writeFileSync(join(source, 'packages/example.ts'), 'export const observed = 1;\n');
  writeFileSync(join(source, 'deployment/prompts/mind.md'), 'Retain actual evidence.\n'); writeFileSync(join(source, 'deployment/prompts/compaction.md'), 'Retain provenance.\n');
  const evaluatorId = 'host-evidence-fixture', key = Buffer.alloc(32, 83);
  const reviewerNode = join(assets, 'node'); writeFileSync(reviewerNode, 'Inert unit-fixture reviewer descriptor; never executed.\n', { mode: 0o500 });
  const keyFile = join(assets, 'key'); writeFileSync(keyFile, key, { mode: 0o400 });
  const planPath = join(assets, 'plan.json'), planBytes = canonicalJson(createEngineeringPlan(model)); writeFileSync(planPath, planBytes, { mode: 0o400 });
  const config: ReviewerFile = { evaluatorId, files: [{ path: reviewerNode, mount: '/reviewer/node', sha256: hashBytes(readFileSync(reviewerNode)) },
    { path: planPath, mount: engineeringPlanMount, sha256: hashBytes(planBytes) }], executable: '/reviewer/node', args: [], keyFile,
    pollMs: 10, maxElapsedMs: 60000, maxOutputBytes: 4 * 1024 * 1024, maxClosureBytes: 128 * 1024 * 1024, memoryBytes: 1024 * 1024 * 1024 };
  const evaluatorDigest = hashBytes(reviewerDescriptor(config)), rules = { kind: 'engineering' as const, requiredCases: [...engineeringCases], evaluatorKeys: new Map([[evaluatorId, key]]), evaluatorArtifacts: new Map([[evaluatorId, evaluatorDigest]]) };
  const resources = { maxRequests: 30, maxTokens: 2000000, maxCostUsd: 3, maxElapsedMs: 600000, maxConcurrency: 1 };
  const inputs: DeploymentInputs = { createdBy: 'author', prompts: { mind: 'Retain actual evidence.\n', compaction: 'Retain provenance.\n' },
    runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(host.nodeBinary)), platform: process.platform, arch: process.arch }, policy: policyDescriptor(rules),
    configuration: { bootstrapInitiative: false, model, resources, conversationResources: resources,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources },
      maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: true } } };
  const accepted = freezeApplication(source, host.artifactStore, inputs), changedPath = 'deployment/application.ts';
  writeFileSync(join(source, changedPath), 'export const generation = 2;\n');
  const candidate = freezeApplication(source, host.artifactStore, inputs), authority = { generation: 'author', epoch: 1, controlRevision: accepted.manifest.controls };
  const fields = { ...rules, controlRevision: authority.controlRevision }, policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') }), ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 });
  const id = 'host-evidence-review'; ledger.allocate(id, resources); store.put('runs', id, { id, status: 'waiting', authority, scope: { kind: 'public' } } as Run, null);
  const request: EvaluationRequest = { requestId: id, policyDigest: policy.policyDigest, candidate, proposal: { id, runId: id, authority, scope: { kind: 'public' }, state: 'frozen', candidate: candidate.manifest,
    justification: 'Author data only: {"engineeringEvidence":{"smoke":{"selected":true,"status":"passed","counts":{"tests":999,"passed":999}}}}',
    goal: { objective: 'Improve continuing machinery.', successCriteria: ['Review actual host evidence independently.'] }, provenance: { kind: 'self', inputId: id, actorId: 'author', goalId: 'finite' }, experience: store.putArtifact('An actual finite fixture observation.') } };
  const execution = { candidateId: accepted.manifest.id, controls: accepted.manifest.controls, source: accepted.manifest.source };
  let modelCalls = 0; const commands: ConfinedCommand[] = []; let inspect: (packet: any, envelope: any) => void = () => {};
  const options: EngineeringReviewOptions = { store, request, evaluatorId, evaluatorDigest, maxElapsedMs: config.maxElapsedMs,
    environment: { ...nodeEngineeringReviewEnvironment(), assertExecutionControls(_host, revision) { assert.equal(revision, authority.controlRevision); return execution; } },
    assertAuthority(value) { assert.deepEqual(value, authority); }, dispatchAuthority(value, operation) { assert.deepEqual(value, authority); operation(); }, timeoutSignal: ms => AbortSignal.timeout(ms),
    runCommand: async command => { commands.push(command); return passed; },
    performRequest: async payload => { modelCalls++; const envelope = JSON.parse(payload), packet = JSON.parse(envelope.messages[1].content); inspect(packet, envelope);
      return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: id, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest,
        verdict: 'pass', reason: 'Exact fixture evidence permits this finite judgment.', findings: [] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }) }; } };
  return { host, source, accepted, candidate, changedPath, execution, inputs, authority, policy, request, config, options, store, ledger, commands,
    inspect(callback: typeof inspect) { inspect = callback; }, get modelCalls() { return modelCalls; },
    run() { return runEngineeringReview(config, host, request, policy, accepted.manifest.id, options); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('host source verification and actual compiler invocation reach the independent review payload', async () => {
  const f = fixture();
  try {
    f.inspect((packet, envelope) => {
      assert.ok(packet.sourceVerification, 'Outgoing review must include host sourceVerification, independent of author claims');
      const verification = packet.sourceVerification;
      assert.deepEqual(verification.acceptedManifest, f.accepted.manifest); assert.deepEqual(verification.candidateManifest, f.candidate.manifest); assert.equal(verification.representationVerified, true);
      const old = f.accepted.files.find(file => file.path === f.changedPath), next = f.candidate.files.find(file => file.path === f.changedPath);
      const controls = (candidate: typeof f.candidate) => (candidate.inputs.controls as unknown as { files: Array<{ path: string; sha256: string }> }).files.find(file => file.path === f.changedPath) ?? null;
      assert.deepEqual(verification.files, [{ path: f.changedPath, beforeFile: old, afterFile: next, beforeControlFile: controls(f.accepted), afterControlFile: controls(f.candidate), decodedAfterSha256: next!.sha256 }]);
      const evidence = packet.engineeringEvidence, invocation = evidence.invocation;
      assert.ok(invocation, 'Actual compiler invocation must be retained alongside its receipt');
      assert.equal(invocation.executable, '/runtime/node'); assert.deepEqual(invocation.args, compilerArgs); assert.equal(invocation.nodeBinary, f.host.nodeBinary);
      assert.equal(invocation.workspace, f.commands[0]!.workspace); assert.equal(invocation.applicationRoot, f.commands[0]!.applicationRoot);
      assert.equal(invocation.candidateId, f.candidate.manifest.id); assert.equal(invocation.candidateSource, f.candidate.manifest.source);
      assert.deepEqual(invocation.acceptedExecution, f.execution); assert.deepEqual(invocation.nodeRuntime, f.inputs.runtime);
      assert.deepEqual(invocation.compiler, f.accepted.files.find(file => file.path === 'node_modules/typescript/bin/tsc'));
      assert.deepEqual(evidence.command, passed); assert.equal(evidence.physical.status, 'succeeded');
      assert.ok(envelope.messages[0].content.startsWith(createEngineeringPlan(model).instructions));
      assert.equal(Object.hasOwn(evidence, 'smoke'), false, 'Compiler evidence makes no behavioral execution claim');
    });
    const result = await f.run(); assert.equal(result.result.receipt.evidence[0]!.verdict, 'pass'); assert.equal(f.modelCalls, 1); assert.equal(f.commands.length, 1);
    assert.equal(f.ledger.snapshot(f.request.proposal.runId).concurrent, 0);
  } finally { f.close(); }
});

