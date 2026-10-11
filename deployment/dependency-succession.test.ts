import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ArtifactRef, Authority, EvaluationEvidence, Run } from '../packages/contracts/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { InitiativeRegistry } from '../packages/initiative/goals/index.ts';
import { ObligationRegistry } from '../packages/initiative/obligations/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor, type ReleaseProof } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { WorkspaceTools } from '../packages/tools/index.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { contentAddressedEvidence } from './host-policy.ts';
import type { HostBindings } from './materialize.ts';
import { rewriteSourceEntries, sourceWorkspaceTools } from './source-workspace.ts';
import { ServiceSupervisor } from './supervisor.ts';

const dependencyPath = 'packages/narrow-schema/vendor/cfworker/validator.ts';
const marker = 'aeon-retained-validator-successor-v2';
// Installed only in disposable source before the incumbent is frozen. Both candidates
// share this transport; real shell, schema, tool, storage and service execution remain.
const fixtureTransport = String.raw`
      performRequest: async (payload: string) => {
        const request = JSON.parse(payload);
        const frame = request.messages.filter((m: any) => m.role === 'user').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } }).findLast((m: any) => m.hostContext)?.hostContext;
        const last = request.messages.findLast((m: any) => m.role === 'tool');
        const name = !last ? 'workspace_read' : last.content.includes('Validation failed for tool') ? 'workspace_write' : undefined;
        const args = !last ? { path: 7 } : { path: 'schema-witness.json', content: JSON.stringify({ diagnostic: last.content, hostContext: frame }), expectedSha256: null };
        return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: name ? { role: 'assistant', content: null, tool_calls: [{ id: name === 'workspace_read' ? 'invalid01' : 'witness01', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Finite synthetic schema witness complete.' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) };
      },
`;
type CommandResult = { exitCode: number | null; stdout: string; stderr: string };
async function eventually<T>(read: () => T, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20000;
  while (true) { const value = read(); if (accept(value)) return value; if (Date.now() > deadline) throw new Error(`Condition not reached: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}

test('edited retained validator is built, admitted under old controls and invoked by an ordinary successor with latest lived state', { timeout: 180000 }, async () => {
  const repository = process.env.AEON_TEST_SOURCE_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync(join(tmpdir(), 'aeon-dependency-succession-'));
  const source = join(root, 'incumbent-source'), editable = join(root, 'candidate-source');
  const host: HostBindings = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspaces'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  const evidenceDirectory = join(root, 'evidence');
  for (const directory of [source, editable, ...Object.values(host).filter(value => value !== process.execPath), evidenceDirectory]) mkdirSync(directory, { mode: 0o700 });
  let supervisor: ServiceSupervisor | undefined, store: OperationalStore | undefined;
  try {
    for (const entry of rewriteSourceEntries) if (existsSync(join(repository, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true }); cpSync(join(repository, entry), join(source, entry), { recursive: true }); }
    cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
    const servicePath = join(source, 'deployment/service-child.ts'), service = readFileSync(servicePath, 'utf8');
    assert.equal(service.split('      additionalTools: context =>').length, 2, 'fixture injection seam must be unique');
    writeFileSync(servicePath, service.replace('      additionalTools: context =>', `${fixtureTransport}      additionalTools: context =>`));
    const blob = (bytes: string | Uint8Array): ArtifactRef => { const sha256 = hashBytes(bytes); writeFileSync(join(evidenceDirectory, sha256), bytes, { mode: 0o600 }); return { uri: `sha256:${sha256}`, sha256 }; };
    const key = randomBytes(32), evaluator = blob('Synthetic engineering admission only; no independent product qualification.');
    const policyFields = { kind: 'engineering' as const, requiredCases: ['dependency-succession'], evaluatorKeys: new Map([['fixture-reviewer', key]]), evaluatorArtifacts: new Map([['fixture-reviewer', evaluator.sha256]]) };
    const envelope = { maxRequests: 30, maxTokens: 100000, maxCostUsd: 0, maxElapsedMs: 600000, maxConcurrency: 2 };
    const inputs: DeploymentInputs = { createdBy: 'dependency-fixture-author', policy: policyDescriptor(policyFields), prompts: { mind: 'Synthetic engineering transport. Exercise actual schema/tool mechanics.', compaction: 'Preserve attributed state.' },
      runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
      configuration: { bootstrapInitiative: false, model: { id: 'mistral-fixture-v1', reasoning: false, effort: 'none', contextWindow: 128000, maxOutputTokens: 2048, maxRequestsPerSlice: 8, timeoutMs: 10000, pricesPerMillion: { input: 0, output: 0 } }, resources: envelope, conversationResources: envelope,
        scheduler: { windowMs: 60000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources: envelope }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: false } } };
    const incumbent = freezeApplication(source, host.artifactStore, inputs);
    const fields = { ...policyFields, controlRevision: incumbent.manifest.controls };
    const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    const policies = new Map([[policy.policyDigest, policy]]);
    const initial: Authority = { generation: 'dependency-incumbent', epoch: 1, controlRevision: incumbent.manifest.controls };
    let proofCounter = 0;
    const proof = (candidate: FrozenCandidate, priorAuthority: Authority): ReleaseProof => {
      const id = `dependency-proof-${++proofCounter}`, observation = blob(`Synthetic engineering judgment ${id}; runtime assertions are measured separately.`);
      const evidence: EvaluationEvidence = { id: `${id}:evidence`, candidateId: candidate.manifest.id, controlRevision: priorAuthority.controlRevision, evaluatorId: 'fixture-reviewer', evaluatorArtifact: evaluator,
        independent: true, verdict: 'pass', artifact: observation, caseResults: [{ id: 'dependency-succession', status: 'pass', observations: observation, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: [] }] };
      return { proposal: { id, candidate: candidate.manifest, priorAuthority, evidence: [evidence], recoveryArtifact: blob(readFileSync(join(host.artifactStore, incumbent.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, policy.policyDigest)] };
    };
    supervisor = await ServiceSupervisor.open({ host, mode: 'engineering', secrets: { mistralApiKey: 'synthetic-no-provider', directToken: 'fixture-token' },
      getPolicy: digest => { const selected = policies.get(digest); assert.ok(selected); return selected; }, readArtifact: contentAddressedEvidence(evidenceDirectory), bootstrap: { proof: proof(incumbent, initial), policyDigest: policy.policyDigest } });
    store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
    async function witness(externalId: string) {
      const ready = supervisor!.status().ready!;
      const response = await fetch(`http://127.0.0.1:${ready.address.port}/inputs`, { method: 'POST', headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' }, body: JSON.stringify({ externalId, revision: '1', conversation: 'dependency', text: 'Exercise dependency succession schema witness and current state.' }) });
      assert.equal(response.status, 202, await response.clone().text()); const { run } = await response.json() as { run: Run };
      const completed = await eventually(() => store!.get<Run>('runs', run.id)?.value, value => value !== undefined && ['completed', 'blocked', 'waiting'].includes(value.status));
      assert.equal(completed!.status, 'completed', JSON.stringify(store!.get('execution', run.id)));
      const workspace = store!.get<{ workspace: string }>('host.run-grants', run.id)!.value.workspace;
      const bytes = readFileSync(join(workspace, 'schema-witness.json'));
      return { runId: run.id, bytes, value: JSON.parse(bytes.toString()) as { diagnostic: string; hostContext: { memory: { memories: { id: string }[] }; agenda: { id: string; nextAction: string }[]; obligations: { id: string }[] } } };
    }
    const before = await witness('incumbent-schema');
    assert.match(before.value.diagnostic, /Validation failed for tool "workspace_read"/); assert.equal(before.value.diagnostic.includes(marker), false);
    const firstPid = supervisor.status().processId!;
    const tools = sourceWorkspaceTools({ applicationRoot: join(host.artifactStore, incumbent.manifest.id, 'payload'), workspace: editable, protectedPaths: [host.stateDirectory], nodeBinary: process.execPath, maxFiles: 5000, maxBytes: 30_000_000, timeoutMs: 30000 });
    const checkout = await tools[0]!.execute({}) as CommandResult;
    assert.equal(checkout.exitCode, 0, checkout.stderr);
    assert.ok(JSON.parse(checkout.stdout).files.some((file: { path: string }) => file.path === dependencyPath));
    const dependency = join(editable, dependencyPath), original = readFileSync(dependency, 'utf8');
    assert.equal(original.split('    return validate(').length, 2, 'actual retained function seam must be unique');
    const edited = original.replace('    return validate(', '    const result = validate(').replace('      this.shortCircuit\n    );', `      this.shortCircuit\n    );\n    return { ...result, errors: result.errors.map(error => ({ ...error, error: error.error + ' [${marker}]' })) };`);
    assert.notEqual(edited, original);
    const edits = new WorkspaceTools({ workspace: editable, protectedPaths: [host.stateDirectory, host.artifactStore], nodeBinary: process.execPath, timeoutMs: 30000, maxBytes: 131072, maxFiles: 10000 });
    const invalid = edited.replace('    const result = validate(', '    const result: string = validate(');
    const invalidEdit = await edits.execute('write', { path: dependencyPath, content: invalid, expectedSha256: hashBytes(original) });
    const failed = await tools[1]!.execute({ emit: false }) as CommandResult;
    assert.notEqual(failed.exitCode, 0); assert.match(failed.stdout, /TS2322/);
    const repairedEdit = await edits.execute('write', { path: dependencyPath, content: edited, expectedSha256: hashBytes(invalid) });
    const checked = await tools[1]!.execute({ emit: false }) as CommandResult;
    assert.equal(checked.exitCode, 0, `${checked.stdout}\n${checked.stderr}`);
    const built = await tools[1]!.execute({ emit: true }) as CommandResult;
    assert.equal(built.exitCode, 0, `${built.stdout}\n${built.stderr}`);
    const emitted = readFileSync(join(editable, 'dist', dependencyPath.replace(/\.ts$/, '.js')));
    assert.ok(emitted.includes(marker));
    // The source-tool compiler mount is read-only; freeze copies the same accepted closure.
    cpSync(join(source, 'node_modules'), join(editable, 'node_modules'), { recursive: true });
    const successor = freezeApplication(editable, host.artifactStore, inputs);
    assert.notEqual(successor.manifest.dependencies, incumbent.manifest.dependencies);
    assert.notEqual(successor.manifest.controls, incumbent.manifest.controls, 'validator is control-classified');
    assert.equal(successor.files.find(file => file.path === dependencyPath)!.sha256, hashBytes(edited));
    assert.equal(readFileSync(join(host.artifactStore, successor.manifest.id, 'payload', dependencyPath), 'utf8'), edited);
    const changed = successor.files.filter(file => incumbent.files.find(old => old.path === file.path)?.sha256 !== file.sha256);
    assert.deepEqual(changed.map(file => file.path), [dependencyPath], 'only the invoked retained dependency changes');
    const nextFields = { ...policyFields, controlRevision: successor.manifest.controls };
    const nextPolicy: AdmissionPolicy = { ...nextFields, policyDigest: admissionPolicyIdentity(nextFields) }; policies.set(nextPolicy.policyDigest, nextPolicy);
    // Latest lived state is added after the candidate was frozen, so its source
    // snapshot cannot supply or reset these real development/initiative records.
    const scope = { kind: 'public' as const }, at = new Date().toISOString(), memory = new DevelopmentalMemory(store), goals = new InitiativeRegistry(store), obligations = new ObligationRegistry(store);
    memory.ingest({ id: 'dependency-latest-memory', runId: before.runId, sourceId: 'after-freeze-experience', actorId: initial.generation, channel: 'action', scope, at, content: 'Latest dependency succession experience after candidate freeze.' });
    let goal = goals.propose({ id: 'dependency-latest-goal', origin: { kind: 'self' }, purpose: 'Retain dependency succession inquiry', scope, successCriteria: ['Later observation'], evidenceIds: [], dependencyIds: [], resources: envelope, priority: 1, nextAction: 'Original action', reviewAt: at }, { sourceIds: ['after-freeze-experience'], actorId: initial.generation, recordedAt: at, derivation: 'observed' });
    goal = goals.accept(goal.id, goal.revision, 'Engineering fixture chosen inquiry');
    goal = goals.revise(goal.id, goal.revision, { status: 'paused', nextAction: 'Latest action after candidate freeze' }, 'Retain without automatic execution');
    obligations.owe({ id: 'dependency-latest-obligation', inputId: 'after-freeze-input', goalId: goal.id, audience: scope, promisedOutcome: 'Latest owed dependency succession report', dueAt: null });
    store.put('host.obligation-targets', 'dependency-latest-obligation', { channel: 'dependency', transport: 'direct', scope }, null);
    const state = () => ({ memory: store!.get('development.memories', 'dependency-latest-memory'), goal: store!.get('initiative.goals', goal.id), obligation: store!.get('initiative.obligations', 'dependency-latest-obligation') });
    const latest = state(), admission = proof(successor, initial);
    await assert.rejects(supervisor.release(admission), /control/i);
    const stageId = await supervisor.stageControl(admission, nextPolicy.policyDigest);
    await supervisor.activateControl(stageId);
    assert.equal(supervisor.status().release?.probationJudge?.policyDigest, policy.policyDigest, 'old policy judges the new dependency');
    await assert.rejects(supervisor.acceptProbation(admission), /fresh evidence/);
    const after = await witness('successor-schema');
    assert.ok(after.value.diagnostic.includes(marker), after.value.diagnostic);
    assert.ok(after.value.hostContext.memory.memories.some(record => record.id === 'dependency-latest-memory'));
    assert.equal(after.value.hostContext.agenda.find(record => record.id === goal.id)?.nextAction, goal.nextAction);
    assert.ok(after.value.hostContext.obligations.some(record => record.id === 'dependency-latest-obligation'));
    const probation = proof(successor, initial); await supervisor.acceptProbation(probation);
    const accepted = supervisor.status();
    assert.equal(accepted.release?.accepted.candidateId, successor.manifest.id);
    assert.equal(accepted.ready?.candidateId, successor.manifest.id); assert.notEqual(accepted.processId, firstPid);
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/, 'predecessor is stopped');
    assert.ok(readFileSync(`/proc/${accepted.processId}/cmdline`, 'utf8').includes(successor.manifest.id));
    assert.deepEqual(state(), latest);
    // A retained accepted restart also loads the same function and current state.
    await supervisor.recover(); const restarted = await witness('restarted-schema');
    assert.ok(restarted.value.diagnostic.includes(marker)); assert.deepEqual(state(), latest);
    const report = { kind: 'synthetic-engineering-only', sourceRevision: process.env.AEON_DEPENDENCY_SOURCE_REVISION ?? 'unrecorded', runtime: inputs.runtime,
      incumbent: incumbent.manifest, successor: successor.manifest, frozenCandidates: { incumbent, successor }, changed, invalidEdit, repairedEdit, emittedValidatorSha256: hashBytes(emitted), failedCheck: failed, pinnedCheck: checked, pinnedBuild: built,
      oldPolicyDigest: policy.policyDigest, successorPolicyDigest: nextPolicy.policyDigest, admissionId: admission.proposal.id, freshProbationId: probation.proposal.id,
      predecessorPid: firstPid, successorPid: accepted.processId, successorAuthority: accepted.ready!.authority, restartedAuthority: supervisor.status().ready!.authority,
      latestState: latest, afterState: state(), witnesses: [before, after, restarted].map(value => ({ runId: value.runId, sha256: hashBytes(value.bytes), ...value.value })),
      requests: store.list('requests'), externalProviderDispatches: 0, limitation: 'Synthetic transport and signed admission judgments; actual Node source service/broker/schema/tools/storage; no live model, product qualification, installed unit or full Q1-Q5 acceptance.' };
    console.log(JSON.stringify({ incumbent: incumbent.manifest.id, successor: successor.manifest.id, dependencySha256: changed[0]!.sha256, epochs: [initial.epoch, accepted.ready!.authority.epoch, supervisor.status().ready!.authority.epoch], latestStateRetained: true }));
    if (process.env.AEON_DEPENDENCY_EVIDENCE_DIRECTORY) { mkdirSync(process.env.AEON_DEPENDENCY_EVIDENCE_DIRECTORY, { recursive: true, mode: 0o700 }); writeFileSync(join(process.env.AEON_DEPENDENCY_EVIDENCE_DIRECTORY, 'dependency-succession.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); }
  } finally { await supervisor?.close(); store?.close(); rmSync(root, { recursive: true, force: true }); }
});
