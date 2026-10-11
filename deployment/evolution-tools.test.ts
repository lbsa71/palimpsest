import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { appendFileSync, chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { identity, type Authority, type EvaluationEvidence, type Goal, type InboundInput, type JsonValue, type ReleaseProposal } from '../packages/contracts/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy, type SignedEvaluation } from '../packages/release/admission.ts';
import { hashBytes, verifyCandidate } from '../packages/release/artifacts.ts';
import { ReleaseController, policyDescriptor } from '../packages/release/controller.ts';
import type { ChangeRecord } from '../packages/release/proposals.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { setup as runtimeFixture, authority as priorAuthority, envelope as runtimeEnvelope } from '../packages/runtime/test/fixtures.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { candidateNodeBinary, freezeApplication, verifyApplication, type DeploymentInputs } from './candidate.ts';
import { evolutionTools, goalDefinitionIdentity, type EvolutionContext, type EvolutionOptions, type EvaluationReceipt, type SubmissionReceipt } from './evolution-tools.ts';
import { rewriteSourceEntries } from './source-workspace.ts';
import { ServiceProcess } from './service-process.ts';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const scope = { kind: 'restricted' as const, principals: ['operator'] };
function input(runId: string, actorId = 'operator', source = 'direct'): InboundInput { return { id: `input:${runId}`, source, actorId, authenticated: true, externalId: source === 'initiative' ? `goal:${runId}` : runId, externalRevision: '1', scope, value: 'A finite engineering fixture, not H1 acceptance.' }; }
function context(root: string, store: OperationalStore, authority: Authority, runId: string, source = 'direct'): EvolutionContext {
  const workspace = join(root, runId); mkdirSync(workspace);
  store.put('runs', runId, { id: runId, status: 'running', revision: 1, authority, scope }, null);
  store.append({ id: `admit:${runId}`, stream: runId, type: 'admitted', data: input(runId, source === 'initiative' ? authority.generation : 'operator', source) });
  return { runId, store, authority, scope, workspace };
}
function call(ctx: EvolutionContext, options: EvolutionOptions, name: string, args: unknown): Promise<any> { const descriptor = evolutionTools(ctx, options).find(tool => tool.name === name)!; return Promise.resolve().then(() => descriptor.execute(args as JsonValue)); }
const proposal = (id = 'change') => ({ changeId: id, justification: 'The fixture verifies actual dependency edit/load and the independent admission boundary.', objective: 'Build and submit one exact dependency candidate.', successCriteria: ['external build loads the modified dependency', 'admission uses the previously accepted policy'], experienceIds: [] });
function copySource(source: string, target: string): void { for (const entry of rewriteSourceEntries) if (existsSync(join(source, entry))) { mkdirSync(dirname(join(target, entry)), { recursive: true }); cpSync(join(source, entry), join(target, entry), { recursive: true }); } }

test('runtime adoption preserves authenticated self origin while requiring the successor grant', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-evolution-adopt-'));
  const fixture = runtimeFixture(join(root, 'state.sqlite'), { async run() { throw Error('No model execution in this fixture'); } });
  try {
    const admitted = input('continuity', priorAuthority.generation, 'initiative');
    const run = fixture.runtime.admit(admitted, priorAuthority, runtimeEnvelope);
    const goal: Goal = { id: admitted.externalId, revision: 1, origin: { kind: 'self' }, purpose: 'Continue a measured improvement across succession', scope, status: 'running', successCriteria: ['retain authenticated origin'], evidenceIds: [], dependencyIds: [], resources: runtimeEnvelope, priority: 1, nextAction: 'propose', reviewAt: new Date().toISOString() };
    fixture.store.put('initiative.goals', goal.id, goal, null);
    fixture.store.put('initiative.execution', goal.id, { runId: run.id }, null);
    fixture.store.put('host.release-self-origins', goal.id, { goalId: goal.id, goalDefinition: goalDefinitionIdentity(goal), basis: 'accepted-bootstrap' }, null);
    new DevelopmentalMemory(fixture.store).ingest({ id: 'continuity-observation', runId: run.id, sourceId: 'fixture:observation', actorId: priorAuthority.generation, scope, at: new Date().toISOString(), channel: 'tool', content: 'A retained measured fixture observation.' });
    const authority = fixture.withdraw(); fixture.runtime.adopt(run.id, authority);
    const ctx = { runId: run.id, store: fixture.store, workspace: root, scope, authority };
    const options: EvolutionOptions = { artifactStore: join(root, 'unused-artifacts'), acceptedCandidateId: identity('unused'), nodeBinary: process.execPath, policyDigest: identity('fixture-policy'), maxFiles: 100, maxBytes: 10000, eligibleHumanAuthors: new Set(), allowedModelProfiles: [], assertAuthority: grant => fixture.effects.fence.assert(grant), provenanceForRun: () => ({ kind: 'self', inputId: admitted.id, actorId: admitted.actorId, goalId: goal.id }), async requestEvaluation() { throw Error('Not used'); }, async submitRelease() { throw Error('Not used'); } };
    const created = await call(ctx, options, 'change_propose', { ...proposal(), experienceIds: ['continuity-observation'] });
    assert.equal(created.provenance.actorId, priorAuthority.generation);
    assert.equal(created.authority.generation, authority.generation);
    await assert.rejects(call({ ...ctx, authority: priorAuthority }, options, 'change_propose', { ...proposal('stale'), experienceIds: ['continuity-observation'] }), /stale or foreign authority/);
    fixture.runtime.steer(run.id, input('human-steering'));
    await assert.rejects(call(ctx, options, 'change_propose', { ...proposal('steered'), experienceIds: ['continuity-observation'] }), /relabel a human/);
  } finally { fixture.store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('bounded proposal→candidate→external build/evaluation→actual L09 admission preserves durable evidence', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-evolution-')), source = join(root, 'accepted-source'), artifactStore = join(root, 'artifacts'); mkdirSync(source);
  copySource(repository, source); cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
  const store = new OperationalStore({ filename: join(root, 'state/operational.sqlite') });
  const evaluatorKey = Buffer.alloc(32, 77), evaluatorId = 'external-frozen-engineering-evaluator';
  const evaluatorArtifact = store.putArtifact('Host-only deterministic full-closure build and modified dependency load evaluator.');
  const policyFields = { kind: 'engineering' as const, requiredCases: ['dependency-build-load'], evaluatorKeys: new Map([[evaluatorId, evaluatorKey]]), evaluatorArtifacts: new Map([[evaluatorId, evaluatorArtifact.sha256]]) };
  const resources = { maxRequests: 100, maxTokens: 100000, maxCostUsd: 5, maxElapsedMs: 60000, maxConcurrency: 2 };
  const inputs: DeploymentInputs = { createdBy: 'accepted-bootstrap', prompts: { mind: readFileSync(join(source, 'deployment/prompts/mind.md'), 'utf8'), compaction: readFileSync(join(source, 'deployment/prompts/compaction.md'), 'utf8') }, runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, policy: policyDescriptor(policyFields),
    configuration: { model: { id: 'fixture-v1', reasoning: false, effort: 'none', contextWindow: 128000, maxRequestsPerSlice: 3, maxOutputTokens: 256, timeoutMs: 5000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, scheduler: { windowMs: 1000, maxSlicesPerWindow: 3, maxLifetimeSlices: 5, quantumMs: 5000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope, modificationEligible: true } } };
  const accepted = freezeApplication(source, artifactStore, inputs);
  const authorityStore = new AuthorityStore(join(root, 'state/authority.sqlite'));
  const authority = authorityStore.bootstrap('author-generation', accepted.manifest.controls, accepted.manifest.id);
  const fields = { ...policyFields, controlRevision: authority.controlRevision };
  const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const policies = new Map([[policy.policyDigest, policy]]), lease = new ProcessLease(join(root, 'state/lease.sqlite'));
  const controller = new ReleaseController({ statePath: join(root, 'state/releases.sqlite'), artifactStore, operationalStatePath: join(root, 'state'), authorityStore, exclusiveProcessLease: lease, getPolicy: digest => policies.get(digest)!, readArtifact: uri => store.readArtifact({ uri, sha256: uri.split(':').at(-1)! }), hooks: { async stopAndDrain() { throw Error('Fixture must not activate'); }, async start() { throw Error('Fixture must not activate'); } } });
  const signed = new Map<string, SignedEvaluation[]>();
  function evidence(candidateId: string, observations: JsonValue): EvaluationEvidence {
    const artifact = store.putJsonArtifact(observations);
    return { id: `evidence:${candidateId}`, candidateId, controlRevision: authority.controlRevision, evaluatorId, evaluatorArtifact, independent: true, verdict: 'pass', artifact, caseResults: [{ id: 'dependency-build-load', status: 'pass', observations: artifact, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: ['Deterministic host fixture; no independent live/product judgment.'] }] };
  }
  const rescue = store.putArtifact(readFileSync(join(artifactStore, accepted.manifest.id, 'candidate.json')));
  const initialEvidence = evidence(accepted.manifest.id, { bootstrap: 'mechanical fixture acceptance' });
  controller.bootstrap({ proposal: { id: 'fixture-bootstrap', candidate: accepted.manifest, priorAuthority: authority, evidence: [initialEvidence], recoveryArtifact: rescue }, signed: [signEvaluation(initialEvidence, evaluatorKey, policy.policyDigest)] }, policy);
  let evaluations = 0, submissions = 0, failOnce = false;
  const durableEvaluations = new Map<string, EvaluationReceipt>(), durableSubmissions = new Map<string, SubmissionReceipt>();
  const requestBodies = new Map<string, string>();
  function stableRequest(req: Parameters<EvolutionOptions['requestEvaluation']>[0]): void {
    const previous = requestBodies.get(req.requestId);
    if (previous) assert.equal(identity(req), previous, 'A reconciled request keeps its complete canonical body');
    else requestBodies.set(req.requestId, identity(req));
  }
  const nextModel: DeploymentInputs['configuration']['model'] = { ...inputs.configuration.model, id: 'fixture-v2', provider: 'openai', reasoning: true, effort: 'high', pricesPerMillion: { input: 3, output: 7 } };
  const options: EvolutionOptions = { artifactStore, acceptedCandidateId: accepted.manifest.id, nodeBinary: process.execPath, policyDigest: policy.policyDigest, maxFiles: 20000, maxBytes: 128 * 1024 * 1024, eligibleHumanAuthors: new Set(['operator']), allowedModelProfiles: [nextModel], assertAuthority: grant => authorityStore.assert(grant), provenanceForRun: ctx => ({ kind: 'human', inputId: input(ctx.runId).id, actorId: 'operator' }),
    async requestEvaluation(req) {
      stableRequest(req);
      const previous = durableEvaluations.get(req.requestId); if (previous) return previous;
      evaluations++; assert.equal(identity(verifyCandidate(artifactStore, req.candidate.manifest.id).manifest), identity(req.candidate.manifest)); assert.equal(req.policyDigest, policy.policyDigest);
      const payload = join(artifactStore, req.candidate.manifest.id, 'payload'), build = join(root, `build-${evaluations}`);
      const checked = spawnSync(process.execPath, [join(payload, 'node_modules/typescript/bin/tsc'), '--project', join(payload, 'tsconfig.json'), '--noEmit', 'false', '--rewriteRelativeImportExtensions', '--outDir', build], { encoding: 'utf8', timeout: 30000 });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `import {ucs2length, evolutionFixtureRevision} from ${JSON.stringify(pathToFileURL(join(build, 'packages/narrow-schema/vendor/cfworker/ucs2-length.js')).href)}; console.log(JSON.stringify({length:ucs2length('a😀'),revision:evolutionFixtureRevision}));`], { encoding: 'utf8', timeout: 5000 });
      assert.equal(loaded.status, 0, loaded.stderr); assert.deepEqual(JSON.parse(loaded.stdout), { length: 2, revision: 'changed-dependency-v1' });
      const observed = evidence(req.candidate.manifest.id, JSON.parse(JSON.stringify({ compilerExit: checked.status, loaded: JSON.parse(loaded.stdout), exactManifest: req.candidate.manifest })) as JsonValue);
      signed.set(req.candidate.manifest.id, [signEvaluation(observed, evaluatorKey, policy.policyDigest)]);
      const receipt = { requestId: req.requestId, candidateId: req.candidate.manifest.id, policyDigest: policy.policyDigest, evidence: [observed], receipt: { kind: 'engineering-fixture', compilerExit: 0 } };
      durableEvaluations.set(req.requestId, receipt); if (failOnce) { failOnce = false; throw Error('Lost response after external evaluation finished'); } return receipt;
    },
    async submitRelease(req) {
      stableRequest(req);
      const previous = durableSubmissions.get(req.requestId); if (previous) return previous;
      submissions++;
      const proof: ReleaseProposal = { id: req.requestId, candidate: req.candidate.manifest, priorAuthority: req.proposal.authority, evidence: req.evaluation.evidence, recoveryArtifact: rescue };
      const nextFields = { ...policyFields, controlRevision: req.candidate.manifest.controls }, next = { ...nextFields, policyDigest: admissionPolicyIdentity(nextFields) }; policies.set(next.policyDigest, next);
      const stageId = controller.stageControlUpgrade({ proposal: proof, signed: signed.get(req.candidate.manifest.id)! }, next);
      const receipt: SubmissionReceipt = { requestId: req.requestId, candidateId: req.candidate.manifest.id, status: 'staged', receipt: { stageId, kind: 'engineering' } }; durableSubmissions.set(req.requestId, receipt); return receipt;
    },
  };
  try {
    const ctx = context(root, store, authority, 'dependency-change'); copySource(source, ctx.workspace);
    const dependency = join(ctx.workspace, 'packages/narrow-schema/vendor/cfworker/ucs2-length.ts');
    writeFileSync(dependency, readFileSync(dependency, 'utf8') + '\nexport const evolutionFixtureRevision = "changed-dependency-v1";\n');
    writeFileSync(join(ctx.workspace, 'deployment/prompts/mind.md'), 'Changed actual source-owned fixture prompt.');
    writeFileSync(join(ctx.workspace, 'deployment/candidate-settings.json'), JSON.stringify({ configuration: { ...inputs.configuration, model: nextModel, pollMs: 200 } }));
    const profiles = await call(ctx, options, 'model_profiles', {});
    assert.deepEqual(profiles.allowed, [inputs.configuration.model, nextModel]);
    await call(ctx, options, 'change_propose', proposal());
    const frozen = await call(ctx, options, 'candidate_freeze', { changeId: 'change' }) as ChangeRecord;
    assert.notEqual(frozen.candidate!.dependencies, accepted.manifest.dependencies); assert.notEqual(frozen.candidate!.controls, accepted.manifest.controls);
    const candidate = verifyCandidate(artifactStore, frozen.candidate!.id);
    assert.deepEqual(candidate.inputs.prompts, { mind: 'Changed actual source-owned fixture prompt.', compaction: inputs.prompts.compaction });
    assert.deepEqual(candidate.inputs.model, nextModel);
    assert.equal(existsSync(join(ctx.workspace, 'node_modules')), false);
    writeFileSync(dependency, 'The workspace changed after freezing.');
    failOnce = true;
    await assert.rejects(call(ctx, options, 'candidate_evaluate', { changeId: 'change' }), error => (error as { mayHaveApplied?: boolean }).mayHaveApplied === true);
    assert.equal((await call(ctx, options, 'change_status', { changeId: 'change' })).proposal.state, 'evaluation-dispatched');
    await t.test('changed host policy cannot redispatch an uncertain evaluation under a new identity', async () => {
      let redispatched = false;
      const reopened = new OperationalStore({ filename: store.filename });
      try {
        await assert.rejects(call({ ...ctx, store: reopened }, { ...options, policyDigest: hashBytes('different policy'), async requestEvaluation() { redispatched = true; throw Error('Operation dispatched again'); } }, 'candidate_evaluate', { changeId: 'change' }), /Frozen judging policy changed/);
        assert.equal(redispatched, false);
      } finally { reopened.close(); }
    });
    await call(ctx, options, 'candidate_evaluate', { changeId: 'change' });
    assert.equal(evaluations, 1, 'Reconcile exact request instead of running the external operation twice');
    const submitted = await call(ctx, options, 'release_submit', { changeId: 'change' });
    assert.equal(submitted.state, 'submitted'); assert.equal((await call(ctx, options, 'change_status', { changeId: 'change' })).submission.status, 'staged');
    await call(ctx, options, 'release_submit', { changeId: 'change' }); assert.equal(submissions, 1);
    assert.equal((await call(ctx, options, 'change_propose', proposal())).state, 'submitted');
    await assert.rejects(call(ctx, options, 'change_propose', { ...proposal(), objective: 'Replace original immutable proposal' }), /Changed proposal identity/);
    assert.equal(controller.status()!.phase, 'accepted'); assert.equal(authorityStore.current()!.artifactId, accepted.manifest.id, 'Staging never activates source edits');

    await t.test('source runtime proposal freezes under old controls and inherited blob survives a small source checkout', async () => {
      const runtimeContext = context(root, store, authority, 'runtime-change'); copySource(source, runtimeContext.workspace);
      const bytes = Buffer.from([127, 69, 76, 70, 11, 22, 33, 44]);
      const descriptor = { ...inputs.runtime, nodeSha256: hashBytes(bytes), workspacePath: 'runtime-input/node' };
      mkdirSync(join(runtimeContext.workspace, 'runtime-input')); writeFileSync(join(runtimeContext.workspace, descriptor.workspacePath), bytes, { mode: 0o700 });
      writeFileSync(join(runtimeContext.workspace, 'deployment/candidate-settings.json'), JSON.stringify({ runtime: descriptor }));
      await call(runtimeContext, options, 'change_propose', proposal());
      await assert.rejects(call(runtimeContext, options, 'candidate_freeze', { changeId: 'change' }), /staging grant/);
      await assert.rejects(call(runtimeContext, { ...options, runtimeMaxBytes: 7 }, 'candidate_freeze', { changeId: 'change' }), /byte bounds/);
      const record = await call(runtimeContext, { ...options, runtimeMaxBytes: 128 * 1024 * 1024 }, 'candidate_freeze', { changeId: 'change' }) as ChangeRecord;
      const frozenRuntime = verifyApplication(artifactStore, record.candidate!.id, process.execPath);
      assert.notEqual(frozenRuntime.manifest.controls, accepted.manifest.controls);
      assert.notEqual(frozenRuntime.manifest.dependencies, accepted.manifest.dependencies);
      assert.equal(hashBytes(readFileSync(candidateNodeBinary(frozenRuntime, artifactStore, process.execPath))), descriptor.nodeSha256);
      assert.equal(authorityStore.current()!.artifactId, accepted.manifest.id, 'staging confers no execution authority');
      const unqualifiedService = new ServiceProcess({ stateDirectory: join(root, 'state'), workspaceDirectory: runtimeContext.workspace, artifactStore, nodeBinary: process.execPath }, { directToken: 'fixture-token', mistralApiKey: 'unavailable' }, { mode: 'engineering' });
      await assert.rejects(unqualifiedService.start(frozenRuntime.manifest.id, authority), /does not qualify/);
      assert.equal(unqualifiedService.processId, undefined, 'unqualified ELF is never executed');
      const nextContext = context(root, store, authority, 'inherited-runtime'); copySource(join(artifactStore, frozenRuntime.manifest.id, 'payload'), nextContext.workspace);
      assert.equal(existsSync(join(nextContext.workspace, '.runtime')), false);
      assert.equal(existsSync(join(nextContext.workspace, descriptor.workspacePath)), false);
      await call(nextContext, options, 'change_propose', proposal());
      const next = await call(nextContext, { ...options, acceptedCandidateId: frozenRuntime.manifest.id }, 'candidate_freeze', { changeId: 'change' }) as ChangeRecord;
      assert.deepEqual((verifyApplication(artifactStore, next.candidate!.id, process.execPath).inputs.controls as unknown as { runtime: DeploymentInputs['runtime'] }).runtime, (frozenRuntime.inputs.controls as unknown as { runtime: DeploymentInputs['runtime'] }).runtime);
      const executable = candidateNodeBinary(frozenRuntime, artifactStore, process.execPath);
      chmodSync(executable, 0o700);
      writeFileSync(executable, Buffer.from([127, 69, 76, 70, 44, 33, 22, 11]));
      assert.throws(() => verifyApplication(artifactStore, frozenRuntime.manifest.id, process.execPath), /payload changed/);
    });

    await t.test('authenticated conversation cannot fabricate eligibility or self origin', async () => {
      const denied = context(root, store, authority, 'ineligible');
      await assert.rejects(call(denied, { ...options, eligibleHumanAuthors: new Set() }, 'change_propose', proposal()), /configured eligible/);
      await assert.rejects(call(denied, options, 'change_propose', { ...proposal(), origin: 'self' }), /Invalid evolution arguments/);
      await assert.rejects(call(denied, { ...options, provenanceForRun: ctx => ({ kind: 'self', inputId: input(ctx.runId).id, actorId: 'operator', goalId: 'fabricated' }) }, 'change_propose', { ...proposal(), experienceIds: ['fabricated'] }), /relabel a human/);
      assert.equal(store.get('runs', denied.runId)!.value !== undefined, true, 'Broad admitted conversation is retained');
    });
    await t.test('self initiative requires actual bound goal and visible experience, and rejects human steering', async () => {
      const self = context(root, store, authority, 'independent', 'initiative'), goalId = `goal:${self.runId}`;
      const goal: Goal = { id: goalId, revision: 1, origin: { kind: 'self' }, purpose: 'Measure a bounded improvement', scope, status: 'running', successCriteria: ['measure actual dependency result'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'propose candidate', reviewAt: new Date().toISOString() };
      store.put('initiative.goals', goalId, goal, null); store.put('initiative.execution', goalId, { runId: self.runId }, null);
      const memory = new DevelopmentalMemory(store); memory.ingest({ id: 'visible-experience', runId: self.runId, sourceId: 'measured:source', actorId: authority.generation, scope, at: new Date().toISOString(), channel: 'tool', content: 'A real attributed fixture observation.' });
      memory.ingest({ id: 'private-experience', runId: self.runId, sourceId: 'private:source', actorId: 'other', scope: { kind: 'restricted', principals: ['other'] }, at: new Date().toISOString(), channel: 'tool', content: 'Cannot disclose this observation.' });
      const selfOptions = { ...options, provenanceForRun: (ctx: EvolutionContext) => ({ kind: 'self' as const, inputId: input(ctx.runId).id, actorId: authority.generation, goalId }) };
      await assert.rejects(call(self, selfOptions, 'change_propose', { ...proposal(), experienceIds: ['visible-experience'] }), /goal-origin attestation/);
      store.put('host.release-self-origins', goalId, { goalId, goalDefinition: goalDefinitionIdentity(goal), basis: 'independent-initiative', originRunId: 'ineligible' }, null);
      await assert.rejects(call(self, selfOptions, 'change_propose', { ...proposal(), experienceIds: ['visible-experience'] }), /Human originating run/);
      // Accepted host bootstrap attests the exact goal definition, independent of the model body label.
      store.put('host.release-self-origins', goalId, { goalId, goalDefinition: goalDefinitionIdentity(goal), basis: 'accepted-bootstrap' }, 1);
      await assert.rejects(call(self, selfOptions, 'change_propose', proposal()), /sources/);
      await assert.rejects(call(self, selfOptions, 'change_propose', { ...proposal(), experienceIds: ['private-experience'] }), /Experience unavailable/);
      const created = await call(self, selfOptions, 'change_propose', { ...proposal(), experienceIds: ['visible-experience'] }); assert.equal(created.provenance.kind, 'self');
      store.append({ id: 'steer:self', stream: self.runId, type: 'steering', data: input(self.runId) });
      await assert.rejects(call(self, selfOptions, 'change_propose', { ...proposal('steered'), experienceIds: ['visible-experience'] }), /relabel a human/);
      await assert.rejects(call({ ...self, scope: { kind: 'public' } }, selfOptions, 'change_status', { changeId: 'change' }), /authorized/);
    });
    await t.test('symlink ancestor, hardlink, special file and byte bounds cannot ingest host content', async () => {
      for (const kind of ['symlink', 'hardlink', 'special', 'oversize']) {
        const attack = context(root, store, authority, `attack-${kind}`); copySource(source, attack.workspace); await call(attack, options, 'change_propose', proposal());
        const target = join(attack.workspace, 'packages/attack');
        if (kind === 'symlink') symlinkSync(join(root, 'state'), target);
        if (kind === 'hardlink') linkSync(join(attack.workspace, 'package.json'), target);
        if (kind === 'special') { const result = spawnSync('mkfifo', [target]); assert.equal(result.status, 0); }
        if (kind === 'oversize') writeFileSync(target, 'x'.repeat(500));
        await assert.rejects(call(attack, kind === 'oversize' ? { ...options, maxBytes: 400 } : options, 'candidate_freeze', { changeId: 'change' }));
        assert.equal((await call(attack, options, 'change_status', { changeId: 'change' })).proposal.state, 'proposed');
      }
      const ancestor = context(root, store, authority, 'ancestor'); const original = ancestor.workspace; rmSync(original, { recursive: true }); symlinkSync(source, original);
      await call(ancestor, options, 'change_propose', proposal()); await assert.rejects(call(ancestor, options, 'candidate_freeze', { changeId: 'change' }));
    });
    await t.test('source settings cannot grant network, spending or eligible-author authority', async () => {
      const attack = context(root, store, authority, 'grant-change'); copySource(source, attack.workspace);
      writeFileSync(join(attack.workspace, 'deployment/candidate-settings.json'), JSON.stringify({ configuration: { ...inputs.configuration, researchHosts: ['private.example'] } }));
      await call(attack, options, 'change_propose', proposal()); await assert.rejects(call(attack, options, 'candidate_freeze', { changeId: 'change' }), /host grants/);
    });
    await t.test('a file that grows after descriptor read cannot exceed the snapshot grant', async () => {
      const growing = context(root, store, authority, 'growing-file'); copySource(source, growing.workspace);
      const target = join(growing.workspace, 'packages/growing-file.txt'); writeFileSync(target, 'bounded bytes'); await call(growing, options, 'change_propose', proposal());
      const original = fs.readSync; let changed = false;
      const mock = t.mock.method(fs, 'readSync', ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => {
        const read = original(fd, buffer, offset, length, position);
        if (!changed && readlinkSync(`/proc/self/fd/${fd}`) === target) { changed = true; appendFileSync(target, ' growth beyond descriptor size'); }
        return read;
      }) as typeof fs.readSync);
      syncBuiltinESMExports();
      try { await assert.rejects(call(growing, options, 'candidate_freeze', { changeId: 'change' }), /Source grew/); assert.equal(changed, true); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal((await call(growing, options, 'change_status', { changeId: 'change' })).proposal.state, 'proposed');
    });
    await t.test('external callback self evidence and malformed receipt cannot submit; dispatch remains durable', async () => {
      const record = store.get<ChangeRecord>('release.changes', identity({ runId: ctx.runId, id: 'change' }))!;
      const victim = { ...record.value, id: 'bad-evidence', state: 'frozen' as const }; delete victim.evaluation; delete victim.submission;
      store.put('release.changes', identity({ runId: ctx.runId, id: victim.id }), victim, null);
      const bad = { ...options, async requestEvaluation(req: Parameters<EvolutionOptions['requestEvaluation']>[0]) { return { requestId: req.requestId, candidateId: req.candidate.manifest.id, policyDigest: policy.policyDigest, evidence: [{ ...evidence(req.candidate.manifest.id, {}), evaluatorId: authority.generation }], receipt: {} }; } };
      await assert.rejects(call(ctx, bad, 'candidate_evaluate', { changeId: victim.id }), /Author\/self/);
      assert.equal((await call(ctx, options, 'change_status', { changeId: victim.id })).proposal.state, 'evaluation-dispatched');
      await assert.rejects(call(ctx, { ...bad, async requestEvaluation(req) { return { requestId: req.requestId, candidateId: accepted.manifest.id, policyDigest: policy.policyDigest, evidence: [evidence(req.candidate.manifest.id, {})], receipt: {} }; } }, 'candidate_evaluate', { changeId: victim.id }), error => (error as { mayHaveApplied?: boolean }).mayHaveApplied === true && /mismatched receipt/.test((error as Error).message));
      await assert.rejects(call(ctx, options, 'release_submit', { changeId: victim.id }), /External evaluation required/);
      await assert.rejects(call(ctx, options, 'candidate_evaluate', { changeId: victim.id, evidence: [] }), /Invalid evolution arguments/);
    });
    await t.test('host submission response loss retains dispatch for idempotent reconciliation', async () => {
      const record = store.get<ChangeRecord>('release.changes', identity({ runId: ctx.runId, id: 'change' }))!;
      const pending = { ...record.value, id: 'uncertain-submit', state: 'frozen' as const }; delete pending.submission; delete pending.evaluation;
      store.put('release.changes', identity({ runId: ctx.runId, id: pending.id }), pending, null);
      await call(ctx, { ...options, async requestEvaluation(req) { return { requestId: req.requestId, candidateId: req.candidate.manifest.id, policyDigest: req.policyDigest, evidence: [evidence(req.candidate.manifest.id, { fixture: 'submission-retry' })], receipt: {} }; } }, 'candidate_evaluate', { changeId: pending.id });
      let dispatches = 0; const receipts = new Map<string, SubmissionReceipt>();
      const uncertain = { ...options, async submitRelease(req: Parameters<EvolutionOptions['submitRelease']>[0]) { if (receipts.has(req.requestId)) return receipts.get(req.requestId)!; dispatches++; receipts.set(req.requestId, { requestId: req.requestId, candidateId: req.candidate.manifest.id, status: 'rejected', receipt: { reason: 'bounded fixture decision' } }); throw Error('Lost reply after host decision'); } };
      await assert.rejects(call(ctx, uncertain, 'release_submit', { changeId: pending.id }), error => (error as { mayHaveApplied?: boolean }).mayHaveApplied === true);
      assert.equal((await call(ctx, options, 'change_status', { changeId: pending.id })).proposal.state, 'submission-dispatched');
      let changedPolicyDispatches = 0;
      await assert.rejects(call(ctx, { ...uncertain, policyDigest: hashBytes('changed submission policy'), async submitRelease() { changedPolicyDispatches++; throw Error('Must never dispatch'); } }, 'release_submit', { changeId: pending.id }), /Frozen judging policy changed/);
      assert.equal(changedPolicyDispatches, 0);
      await call(ctx, uncertain, 'release_submit', { changeId: pending.id }); assert.equal(dispatches, 1);
    });
    await t.test('an evaluation receipt cannot be transplanted to another proposal for submission', async () => {
      const record = store.get<ChangeRecord>('release.changes', identity({ runId: ctx.runId, id: 'change' }))!;
      const forged = { ...record.value, id: 'transplanted-evaluation', state: 'evaluated' as const }; delete forged.submission;
      store.put('release.changes', identity({ runId: ctx.runId, id: forged.id }), forged, null);
      let dispatched = false;
      await assert.rejects(call(ctx, { ...options, async submitRelease() { dispatched = true; throw Error('Must never dispatch'); } }, 'release_submit', { changeId: forged.id }), /mismatched receipt/);
      assert.equal(dispatched, false);
    });
    await t.test('cancellation after evaluator completion preserves uncertainty and the original retry request', async () => {
      const record = store.get<ChangeRecord>('release.changes', identity({ runId: ctx.runId, id: 'change' }))!;
      const pending = { ...record.value, id: 'cancel-evaluation', state: 'frozen' as const }; delete pending.evaluation; delete pending.submission;
      store.put('release.changes', identity({ runId: ctx.runId, id: pending.id }), pending, null);
      const abort = new AbortController(); let received: EvaluationReceipt | undefined, originalRequest: string | undefined, completed = 0;
      const interrupted = { ...options, async requestEvaluation(req: Parameters<EvolutionOptions['requestEvaluation']>[0]) {
        if (received) { assert.equal(identity(req), originalRequest); return received; }
        completed++; originalRequest = identity(req);
        received = { requestId: req.requestId, candidateId: req.candidate.manifest.id, policyDigest: req.policyDigest, evidence: [evidence(req.candidate.manifest.id, { fixture: 'cancel-after-completion' })], receipt: {} };
        abort.abort(); return received;
      } };
      const tool = evolutionTools(ctx, interrupted).find(tool => tool.name === 'candidate_evaluate')!;
      await assert.rejects(Promise.resolve().then(() => tool.execute({ changeId: pending.id }, abort.signal)), error => (error as { mayHaveApplied?: boolean }).mayHaveApplied === true);
      assert.equal((await call(ctx, options, 'change_status', { changeId: pending.id })).proposal.state, 'evaluation-dispatched');
      const evaluated = await call(ctx, interrupted, 'candidate_evaluate', { changeId: pending.id });
      assert.equal(evaluated.state, 'evaluated'); assert.equal(completed, 1);
    });
    // A new database handle/factory can retrieve exact artifacts after restart.
    const reopened = new OperationalStore({ filename: store.filename });
    try { const persisted = await call({ ...ctx, store: reopened }, options, 'change_status', { changeId: 'change' }); assert.equal(persisted.proposal.candidate.id, candidate.manifest.id); assert.equal(persisted.submission.status, 'staged'); assert.equal(persisted.evaluation.policyDigest, policy.policyDigest); }
    finally { reopened.close(); }
  } finally { controller.close(); lease.close(); authorityStore.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
