import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, identity, type Run } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { candidateNodeBinary, freezeApplication, type DeploymentInputs } from './candidate.ts';
import { createEngineeringPlan, engineeringCases, engineeringPlanMount, nodeEngineeringReviewEnvironment, runEngineeringReview } from './engineering-review.ts';
import { reviewerDescriptor, type ReviewerFile } from './evaluation-dispatch.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import type { ModelProfile } from './model-grants.ts';
import { stageRuntimeBundle } from './runtime-bundle.ts';

test('engineering compiler uses the accepted bundled runtime when bootstrap Node is inside protected state', { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'engineering-runtime-'));
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'work'), artifactStore: join(root, 'artifacts'), nodeBinary: join(root, 'state/boot/targets/installed/node') };
  for (const path of [host.stateDirectory, host.workspaceDirectory, host.artifactStore, dirname(host.nodeBinary)]) mkdirSync(path, { recursive: true });
  const node = readFileSync(process.execPath); writeFileSync(host.nodeBinary, node, { mode: 0o500 });
  const source = join(root, 'source'); mkdirSync(join(source, 'packages'), { recursive: true }); mkdirSync(join(source, 'deployment/prompts'), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"type":"module"}'); writeFileSync(join(source, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(join(source, 'tsconfig.json'), canonicalJson({ compilerOptions: { target: 'esnext', module: 'nodenext', strict: true, types: [], allowImportingTsExtensions: true, noEmit: true }, include: ['packages/*.ts'] }));
  writeFileSync(join(source, 'deployment/shell-worker.ts'), 'export {};\n');
  writeFileSync(join(source, 'deployment/prompts/mind.md'), 'Inspect exact evidence.\n'); writeFileSync(join(source, 'deployment/prompts/compaction.md'), 'Keep provenance.\n');
  writeFileSync(join(source, 'packages/observed.ts'), 'export const observed: number = 1;\n');
  const repository = dirname(dirname(fileURLToPath(import.meta.url)));
  cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
  const runtime = stageRuntimeBundle(dirname(realpathSync(process.execPath)), 'node', source,
    { nodeVersion: process.version, nodeSha256: hashBytes(node), platform: process.platform, arch: process.arch }, node.length);
  const model: ModelProfile = { provider: 'mistral', id: 'mistral-large-4-0', contextWindow: 262144, reasoning: false, effort: 'none',
    maxOutputTokens: 2048, maxRequestsPerSlice: 1, timeoutMs: 10000, pricesPerMillion: { input: 0.5, output: 1.5 } };
  const assets = join(root, 'reviewer'); mkdirSync(assets);
  const key = Buffer.alloc(32, 81), keyFile = join(assets, 'key'), reviewerNode = join(assets, 'node'), planPath = join(assets, 'plan.json');
  writeFileSync(keyFile, key, { mode: 0o400 }); writeFileSync(reviewerNode, node, { mode: 0o500 });
  const planBytes = canonicalJson(createEngineeringPlan(model)); writeFileSync(planPath, planBytes, { mode: 0o400 });
  const evaluatorId = 'independent-bundled-runtime-reviewer', config: ReviewerFile = { evaluatorId, executable: '/reviewer/node', args: [], keyFile,
    files: [{ path: reviewerNode, mount: '/reviewer/node', sha256: hashBytes(node) }, { path: planPath, mount: engineeringPlanMount, sha256: hashBytes(planBytes) }],
    pollMs: 10, maxElapsedMs: 30000, maxOutputBytes: 4 * 1024 * 1024, maxClosureBytes: 128 * 1024 * 1024, memoryBytes: 1024 * 1024 * 1024 };
  const evaluatorDigest = hashBytes(reviewerDescriptor(config)), rules = { kind: 'engineering' as const, requiredCases: [...engineeringCases],
    evaluatorKeys: new Map([[evaluatorId, key]]), evaluatorArtifacts: new Map([[evaluatorId, evaluatorDigest]]) };
  const resources = { maxRequests: 10, maxTokens: 1000000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 1 };
  const inputs: DeploymentInputs = { createdBy: 'author', runtime, policy: policyDescriptor(rules), prompts: { mind: 'Inspect exact evidence.\n', compaction: 'Keep provenance.\n' },
    configuration: { bootstrapInitiative: false, model, resources, conversationResources: resources,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources },
      maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: true } } };
  const accepted = freezeApplication(source, host.artifactStore, inputs), authority = { generation: 'author', epoch: 1, controlRevision: accepted.manifest.controls };
  const fields = { ...rules, controlRevision: authority.controlRevision }, policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const store = new OperationalStore({ filename: join(host.stateDirectory, 'operations.sqlite') });
  try {
    const bundledNode = candidateNodeBinary(accepted, host.artifactStore, host.nodeBinary);
    assert.equal(bundledNode, join(host.artifactStore, accepted.manifest.id, 'payload/.runtime/node')); assert.notEqual(bundledNode, host.nodeBinary);
    const protectedSource = join(host.stateDirectory, 'secret.ts'); writeFileSync(protectedSource, 'export const secret: number = 42;\n');
    for (const probe of [false, true]) {
      writeFileSync(join(source, 'packages/observed.ts'), probe ? `import { secret } from ${JSON.stringify(protectedSource)};\nexport const observed: number = secret;\n` : 'export const observed: number = 2;\n');
      const candidate = freezeApplication(source, host.artifactStore, inputs), id = probe ? 'protected-state-probe' : 'supported-bundle';
      new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }).allocate(id, resources);
      store.put('runs', id, { id, status: 'waiting', authority, scope: { kind: 'public' } } as Run, null);
      const request: EvaluationRequest = { requestId: id, policyDigest: policy.policyDigest, candidate, proposal: { id, runId: id, authority, scope: { kind: 'public' },
        state: 'frozen', candidate: candidate.manifest, justification: 'Review the bounded source change with the accepted runtime.',
        goal: { objective: 'Preserve supported compiler execution and protected state.', successCriteria: ['accepted compiler runs with state hidden'] },
        provenance: { kind: 'self', inputId: id, actorId: 'author', goalId: 'finite' }, experience: store.putArtifact('Bootstrap runtime lives inside protected state.') } };
      let models = 0;
      const response = await runEngineeringReview(config, host, request, policy, accepted.manifest.id, { store, request, evaluatorId, evaluatorDigest, maxElapsedMs: config.maxElapsedMs,
        environment: { ...nodeEngineeringReviewEnvironment(), assertExecutionControls(_host, revision) { assert.equal(revision, accepted.manifest.controls);
          return { candidateId: accepted.manifest.id, controls: accepted.manifest.controls, source: accepted.manifest.source }; } },
        assertAuthority(value) { assert.equal(identity(value), identity(authority)); }, dispatchAuthority(_value, operation) { operation(); }, timeoutSignal: ms => AbortSignal.timeout(ms),
        performRequest: async payload => { models++; const packet = JSON.parse(JSON.parse(payload).messages[1].content); assert.equal(packet.changes.length, 1);
          return { status: 200, body: JSON.stringify({ model: model.id, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ requestId: id, candidateId: candidate.manifest.id,
            policyDigest: policy.policyDigest, verdict: 'pass', reason: 'The accepted bundled compiler actually checked this exact source.', findings: [] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
        } });
      const evidence = response.result.receipt.evidence[0]!;
      assert.equal(evidence.verdict, probe ? 'fail' : 'pass'); assert.equal(models, probe ? 0 : 1);
      const summary = JSON.parse(Buffer.from(response.artifacts.find(blob => blob.sha256 === evidence.artifact.sha256)!.base64, 'base64').toString());
      const build = JSON.parse(Buffer.from(response.artifacts.find(blob => blob.sha256 === summary.build.sha256)!.base64, 'base64').toString());
      if (probe) {
        assert.ok(Number.isInteger(build.command.exitCode) && build.command.exitCode > 0); assert.equal(build.command.signal, null);
        const diagnostics = build.command.stdout + build.command.stderr;
        assert.match(diagnostics, /Cannot find module/); assert.ok(diagnostics.includes(protectedSource));
      } else assert.equal(build.command.exitCode, 0);
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
