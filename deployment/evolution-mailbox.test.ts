import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { identity, type EvaluationEvidence, type JsonValue } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { ReleaseController, policyDescriptor } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { AutarkApplication } from './application.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { EvolutionMailbox, ordinaryServiceTools, type ExternalEvaluation } from './evolution-mailbox.ts';
import type { EvaluationRequest, SubmissionReceipt } from './evolution-tools.ts';
import { materializeConfiguration } from './materialize.ts';
import { rewriteSourceEntries } from './source-workspace.ts';
import { validateEvolutionMetadata } from './service-process.ts';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
function copySource(target: string): void {
  mkdirSync(target);
  for (const entry of rewriteSourceEntries) if (existsSync(join(repository, entry))) {
    mkdirSync(dirname(join(target, entry)), { recursive: true }); cpSync(join(repository, entry), join(target, entry), { recursive: true });
  }
  cpSync(realpathSync(join(repository, 'node_modules')), join(target, 'node_modules'), { recursive: true });
}
async function eventually<T>(read: () => T, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 30000;
  while (true) { const value = read(); if (accept(value)) return value; if (Date.now() > end) throw Error(`Fixture deadline: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function response(name?: string, args: unknown = {}) {
  return { status: 200, body: JSON.stringify({ model: 'fixture-v1', choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: name ? { role: 'assistant', content: null, tool_calls: [{ id: name.replaceAll('_', '').slice(0, 9), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'Finite fixture finished.' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) };
}

test('ordinary service model tools queue evaluation, resume bound feedback and stage through the real controller', { timeout: 90000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-evolution-host-'));
  const source = join(root, 'source'); copySource(source);
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspaces'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  for (const directory of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) mkdirSync(directory);
  const key = Buffer.alloc(32, 51), evaluatorId = 'external-engineering-fixture';
  const store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
  const evaluatorArtifact = store.putArtifact('External deterministic compiler fixture. No live independence or H1 competence claim.');
  const policyFields = { kind: 'engineering' as const, requiredCases: ['exact-build'], evaluatorKeys: new Map([[evaluatorId, key]]), evaluatorArtifacts: new Map([[evaluatorId, evaluatorArtifact.sha256]]) };
  const resources = { maxRequests: 100, maxTokens: 10000000, maxCostUsd: 10, maxElapsedMs: 600000, maxConcurrency: 2 };
  const inputs: DeploymentInputs = { createdBy: 'accepted-engineering-host', prompts: { mind: 'Finite deterministic evolution host fixture.', compaction: 'Preserve evidence.' }, runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, policy: policyDescriptor(policyFields),
    configuration: { bootstrapInitiative: false, model: { id: 'fixture-v1', reasoning: false, effort: 'none', contextWindow: 128000, maxRequestsPerSlice: 12, maxOutputTokens: 256, timeoutMs: 30000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 60000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: true } } };
  const accepted = freezeApplication(source, host.artifactStore, inputs), config = materializeConfiguration(accepted, host);
  const authorityStore = new AuthorityStore(join(host.stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('ordinary-author', accepted.manifest.controls, accepted.manifest.id);
  const fields = { ...policyFields, controlRevision: authority.controlRevision }, policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const policies = new Map<string, AdmissionPolicy>([[policy.policyDigest, policy]]);
  const lease = new ProcessLease(join(host.stateDirectory, 'supervisor-fixture-lease.sqlite'));
  const controller = new ReleaseController({ statePath: join(host.stateDirectory, 'release.sqlite'), artifactStore: host.artifactStore, operationalStatePath: host.stateDirectory, authorityStore, exclusiveProcessLease: lease, getPolicy: digest => policies.get(digest)!, readArtifact: uri => store.readArtifact({ uri: `aeon:artifact:${uri.split(':').at(-1)!}`, sha256: uri.split(':').at(-1)! }), hooks: { async stopAndDrain() { throw Error('Staging must not activate'); }, async start() { throw Error('Staging must not activate'); } } });
  const rescue = store.putArtifact(readFileSync(join(host.artifactStore, accepted.manifest.id, 'candidate.json')));
  function proof(requestId: string, candidate: typeof accepted.manifest, observation: JsonValue): ExternalEvaluation {
    const stored = store.putJsonArtifact(observation), artifact = { ...stored, uri: `sha256:${stored.sha256}` };
    const evidence: EvaluationEvidence = { id: `external:${requestId}`, candidateId: candidate.id, controlRevision: authority.controlRevision, evaluatorId, evaluatorArtifact: { ...evaluatorArtifact, uri: `sha256:${evaluatorArtifact.sha256}` }, independent: true, verdict: 'pass', artifact, caseResults: [{ id: 'exact-build', status: 'pass', observations: artifact, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: ['Engineering fixture; live/product reviewer qualification absent.'] }] };
    return { receipt: { requestId, candidateId: candidate.id, policyDigest: policy.policyDigest, evidence: [evidence], receipt: { kind: 'engineering' } }, proof: { proposal: { id: requestId, candidate, priorAuthority: authority, evidence: [evidence], recoveryArtifact: { ...rescue, uri: `sha256:${rescue.sha256}` } }, signed: [signEvaluation(evidence, key, policy.policyDigest)] } };
  }
  controller.bootstrap(proof('bootstrap', accepted.manifest, { bootstrap: 'engineering fixture' }).proof, policy);
  const mailbox = new EvolutionMailbox({ store, assertAuthority: grant => authorityStore.assert(grant), waitMs: 40, pollMs: 5 });
  let calls = 0, app: AutarkApplication | undefined;
  const modifiedPath = 'packages/narrow-schema/vendor/cfworker/ucs2-length.ts';
  const modifiedBytes = readFileSync(join(source, modifiedPath), 'utf8') + '\nexport const hostFixtureRevision = "external-build-bound";\n';
  const createApp = () => new AutarkApplication({ config, authority, authorityStore, secrets: { mistralApiKey: 'no-provider-call', directToken: 'fixture' },
      additionalTools: context => ordinaryServiceTools(context, { config, artifactStore: host.artifactStore, evolution: { policyDigest: policy.policyDigest }, assertAuthority: grant => authorityStore.assert(grant) }),
      performRequest: async payload => {
        const request = JSON.parse(payload);
        for (const name of ['source_checkout', 'candidate_freeze', 'candidate_evaluate', 'release_submit']) assert.ok(request.tools.some((value: any) => value.function.name === name));
        calls++;
        if (calls === 1) return response('source_checkout');
        if (calls === 2) return response('workspace_write', { path: modifiedPath, content: modifiedBytes, expectedSha256: hashBytes(readFileSync(join(source, modifiedPath))) });
        if (calls === 3) return response('change_propose', { changeId: 'finite', justification: 'Verify exact candidate external build and host stage.', objective: 'Stage this bounded engineering source change.', successCriteria: ['exact candidate compiles under the accepted closure'], experienceIds: [] });
        if (calls === 4) return response('candidate_freeze', { changeId: 'finite' });
        if (calls === 5) return response('candidate_evaluate', { changeId: 'finite' });
        if (calls === 7) return response('change_status', { changeId: 'finite' });
        if (calls === 8) return response('release_submit', { changeId: 'finite' });
        return response();
      } });
  try {
    app = createApp();
    const run = app.communications.receive({ source: 'direct', externalId: 'finite', revision: '1', conversation: 'finite', text: 'Make the finite engineering change.', actor: { id: 'operator', scope: config.direct.scope, modificationEligible: true } }).run;
    const execution = app.resume(run.id);
    const evaluation = await eventually(() => {
      const found = mailbox.jobs().find(job => job.kind === 'evaluation');
      if (!found && ['completed', 'blocked'].includes(app!.runtime.getRun(run.id)!.status)) throw Error(JSON.stringify({ calls, run: app!.runtime.getRun(run.id), resources: app!.resources.snapshot(run.id), lastResult: app!.store.get<{ lastResult?: { reason?: string; kind?: string; status?: string } }>('execution', run.id)?.value.lastResult?.reason, observations: app!.runtime.observations(run.id).map(value => ({ kind: value.kind, sourceId: value.sourceId, error: value.value && typeof value.value === 'object' && !Array.isArray(value.value) ? value.value.error : undefined })) }));
      return found;
    }, Boolean);
    assert.equal((await execution).status, 'waiting');
    assert.equal(calls, 6); assert.equal(app.effects.unresolved(run.id).length, 0);
    assert.equal(mailbox.readEvaluation(mailbox.request(evaluation!.id) as EvaluationRequest).status, 'pending');
    const usedBeforeRestart = app.resources.snapshot(run.id);
    await app.close(); app = undefined;
    // A known queued review can finish while no author process is alive.
    await new Promise(resolve => setTimeout(resolve, 80));
    let engineeringResult: ExternalEvaluation | undefined;
    await mailbox.processEvaluation(evaluation!.id, async request => {
      const payload = join(host.artifactStore, request.candidate.manifest.id, 'payload');
      assert.equal(readFileSync(join(payload, modifiedPath), 'utf8'), modifiedBytes);
      const checked = spawnSync(process.execPath, [join(payload, 'node_modules/typescript/bin/tsc'), '--project', join(payload, 'tsconfig.json'), '--noEmit'], { encoding: 'utf8', timeout: 30000 });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      engineeringResult = proof(request.requestId, request.candidate.manifest, JSON.parse(JSON.stringify({ compilerExit: checked.status, manifest: request.candidate.manifest })) as JsonValue); return engineeringResult;
    });
    app = createApp();
    assert.equal(app.runtime.getRun(run.id)!.status, 'waiting');
    assert.deepEqual(app.resources.snapshot(run.id).requests, usedBeforeRestart.requests);
    assert.equal(calls, 6, 'Restart does not repeat the author or reviewer request');
    await app.start();
    const submission = await eventually(() => mailbox.jobs().find(job => job.kind === 'submission'), Boolean);
    await mailbox.processSubmission(submission!.id, async (request, externalProof) => {
      assert.deepEqual(externalProof, engineeringResult!.proof);
      const nextFields = { ...policyFields, controlRevision: request.candidate.manifest.controls }, next = { ...nextFields, policyDigest: admissionPolicyIdentity(nextFields) };
      policies.set(next.policyDigest, next);
      const stageId = controller.stageControlUpgrade(externalProof, next);
      return { requestId: request.requestId, candidateId: request.candidate.manifest.id, status: 'staged', receipt: { stageId, kind: 'engineering' } };
    });
    await eventually(() => app!.runtime.getRun(run.id), value => value?.status === 'completed'); assert.equal(calls, 9);
    assert.equal(app.store.events(run.id).filter(event => event.type === 'steering' && (event.data as any).source === 'host.evolution').length, 1);
    assert.equal(controller.status()!.phase, 'accepted'); assert.equal(authorityStore.current()!.artifactId, accepted.manifest.id);
    assert.equal(mailbox.status(submission!.id)!.status, 'completed');
    const changes = app.store.list<{ state: string }>('release.changes'); assert.equal(changes[0]!.value.state, 'submitted');

    await t.test('lost evaluator response and restart never redispatch; exact external result reconciles', async () => {
      const original = mailbox.request(evaluation!.id) as EvaluationRequest;
      const request = { ...original, requestId: identity({ fixture: 'lost-evaluation' }) };
      await assert.rejects(mailbox.requestEvaluation(request), error => (error as { mayHaveApplied?: boolean }).mayHaveApplied === true);
      let dispatches = 0; const result = proof(request.requestId, request.candidate.manifest, { evaluatorCompleted: true });
      await assert.rejects(mailbox.processEvaluation(request.requestId, async () => { dispatches++; throw Error('Response lost after external operation'); }), /Response lost/);
      assert.equal(mailbox.status(request.requestId)!.status, 'uncertain');
      const reopened = new OperationalStore({ filename: store.filename });
      try {
        const resumed = new EvolutionMailbox({ store: reopened, assertAuthority: grant => authorityStore.assert(grant), waitMs: 40, pollMs: 5 });
        await assert.rejects(resumed.processEvaluation(request.requestId, async () => { dispatches++; return result; }), /reconcile/);
        resumed.completeEvaluation(request.requestId, result);
        assert.deepEqual(await resumed.requestEvaluation(request), result.receipt); assert.equal(dispatches, 1);
        assert.throws(() => resumed.completeEvaluation(request.requestId, { ...result, receipt: { ...result.receipt, policyDigest: 'wrong-policy' } }), /binding/);
        await assert.rejects(resumed.requestEvaluation({ ...request, policyDigest: 'different-policy' }), /identity reused/);
      } finally { reopened.close(); }
    });
    await t.test('lost controller receipt retains uncertainty and requires explicit reconciliation', async () => {
      const original = mailbox.request(submission!.id);
      const request = { ...original, requestId: identity({ fixture: 'lost-submission' }) } as Parameters<EvolutionMailbox['submitRelease']>[0];
      await assert.rejects(mailbox.submitRelease(request), /remains pending/);
      const receipt: SubmissionReceipt = { requestId: request.requestId, candidateId: request.candidate.manifest.id, status: 'rejected', receipt: { reason: 'explicit fixture decision' } };
      let dispatches = 0;
      await assert.rejects(mailbox.processSubmission(request.requestId, async () => { dispatches++; throw Error('Controller reply lost'); }), /reply lost/);
      await assert.rejects(mailbox.processSubmission(request.requestId, async () => { dispatches++; return receipt; }), /reconcile/);
      mailbox.completeSubmission(request.requestId, receipt);
      assert.deepEqual(await mailbox.submitRelease(request), receipt); assert.equal(dispatches, 1);
    });
    await t.test('restart marks an interrupted dispatch uncertain without invoking the evaluator again', async () => {
      const request = { ...(mailbox.request(evaluation!.id) as EvaluationRequest), requestId: identity({ fixture: 'restart-dispatched' }) };
      await assert.rejects(mailbox.requestEvaluation(request), /remains pending/);
      let rejectExternal!: (error: Error) => void;
      const processing = mailbox.processEvaluation(request.requestId, async () => await new Promise<ExternalEvaluation>((_resolve, reject) => { rejectExternal = reject; }));
      const interrupted = assert.rejects(processing, /interrupted evaluator/);
      assert.equal(mailbox.status(request.requestId)!.status, 'dispatched');
      const reopened = new OperationalStore({ filename: store.filename });
      try {
        const restarted = new EvolutionMailbox({ store: reopened, assertAuthority: grant => authorityStore.assert(grant) });
        assert.deepEqual(restarted.recover(), [request.requestId]); assert.deepEqual(restarted.recover(), []);
        await assert.rejects(restarted.processEvaluation(request.requestId, async () => { throw Error('Must never rerun interrupted evaluation'); }), /reconcile/);
        assert.equal(restarted.status(request.requestId)!.status, 'uncertain');
      } finally { reopened.close(); rejectExternal(Error('interrupted evaluator')); await interrupted; }
    });
    await t.test('abort preserves queued job and authority fencing forbids evaluator dispatch', async () => {
      const request = { ...(mailbox.request(evaluation!.id) as EvaluationRequest), requestId: identity({ fixture: 'abort-fence' }) };
      const abort = new AbortController(); abort.abort(Error('cancelled finite wait'));
      await assert.rejects(mailbox.requestEvaluation(request, abort.signal), /cancelled/);
      assert.equal(mailbox.status(request.requestId)!.status, 'pending');
      const transferRequest = { ...mailbox.request(submission!.id), requestId: identity({ fixture: 'author-fenced-by-transfer' }) } as Parameters<EvolutionMailbox['submitRelease']>[0];
      const waiting = mailbox.submitRelease(transferRequest);
      const transferReceipt: SubmissionReceipt = { requestId: transferRequest.requestId, candidateId: transferRequest.candidate.manifest.id, status: 'admitted', receipt: { kind: 'engineering-fencing-fixture' } };
      await mailbox.processSubmission(transferRequest.requestId, async () => { authorityStore.withdraw(authority); return transferReceipt; });
      assert.deepEqual(await waiting, transferReceipt, 'Retain the trusted decision even when the controller fenced the author');
      let dispatched = false;
      await assert.rejects(mailbox.processEvaluation(request.requestId, async () => { dispatched = true; return engineeringResult!; }), /stale|withdrawn|authority/i);
      assert.equal(dispatched, false);
    });
    await t.test('engineering metadata absence reports unavailability and public metadata rejects keys', () => {
      assert.throws(() => validateEvolutionMetadata({ policyDigest: policy.policyDigest, reviewerKey: 'secret' } as any), /Public frozen/);
      const context = { runId: run.id, store: app!.store, scope: config.direct.scope, authority, workspace: host.workspaceDirectory };
      const unavailable = ordinaryServiceTools(context, { config, artifactStore: host.artifactStore, assertAuthority: () => {} });
      assert.throws(() => unavailable.find(value => value.name === 'candidate_evaluate')!.execute({ changeId: 'finite' }), /omitted accepted judging policy/);
    });
  } finally { await app?.close(); controller.close(); lease.close(); authorityStore.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
