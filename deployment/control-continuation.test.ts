import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type ArtifactRef, type Authority, type EvaluationEvidence, type PhysicalRequest, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { freezeCandidate, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor, ReleaseController, type ReleaseProof } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { DurableRuntime } from '../packages/runtime/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { assertControlActivationClaim, assertProbationLineage, ControlContinuation, controlActivationStatus, enqueueControlActivation, type ControlActivationRequest, type ControlContinuationOptions, type ProbationReviewRequest } from './control-continuation.ts';
import { accountedReview, prepareReview, recoverReviewReservations, reviewPhysicalId } from './evaluation-resources.ts';
import { EvolutionMailbox } from './evolution-mailbox.ts';
import type { EvaluationRequest, SubmissionRequest } from './evolution-tools.ts';
import type { HostResourceLedgerFactory, HostResourceOptions } from './host-resources.ts';

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); });
}
async function fixture(resourceOptions: HostResourceOptions = {}, ordinary = false) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-host-control-')), source = join(root, 'source'), artifacts = join(root, 'artifacts'), state = join(root, 'state');
  mkdirSync(source); mkdirSync(state);
  const store = new OperationalStore({ filename: join(state, 'operational.sqlite') }), authority = new AuthorityStore(join(state, 'authority.sqlite')), lease = new ProcessLease(join(state, 'lease.sqlite'));
  const key = randomBytes(32), evaluator = store.putArtifact('Independent engineering fixture review; no live qualification');
  const ref = (bytes: string | Uint8Array): ArtifactRef => { const value = store.putArtifact(bytes); return { uri: `sha256:${value.sha256}`, sha256: value.sha256 }; };
  const read = (uri: string) => store.readArtifact({ uri: `aeon:artifact:${uri.split(':').at(-1)!}`, sha256: uri.split(':').at(-1)! });
  const fields = { kind: 'engineering' as const, requiredCases: ['running'], evaluatorKeys: new Map([['independent-fixture', key]]), evaluatorArtifacts: new Map([['independent-fixture', evaluator.sha256]]) };
  const candidate = (version: number) => {
    writeFileSync(join(source, 'main.mjs'), `console.log(${version});setInterval(()=>{},1000);`);
    return freezeCandidate(source, artifacts, ['main.mjs'], { createdBy: 'candidate-author', controls: { version: ordinary ? 1 : version, policy: policyDescriptor(fields) }, configuration: {}, dependencies: {}, prompts: { version }, model: {} });
  };
  const incumbent = candidate(1), successor = candidate(2);
  const policies = new Map<string, AdmissionPolicy>();
  const policy = (candidate: FrozenCandidate) => { const p = { ...fields, controlRevision: candidate.manifest.controls }; const complete = { ...p, policyDigest: admissionPolicyIdentity(p) }; policies.set(complete.policyDigest, complete); return complete; };
  const original = policy(incumbent), next = policy(successor), initial = authority.bootstrap('initial', incumbent.manifest.controls, incumbent.manifest.id);
  let child: ChildProcess | undefined, generation = 0, serial = 0; const starts: number[] = [];
  function proof(candidate: FrozenCandidate, prior: Authority, id = `proof-${++serial}`, judge = original): ReleaseProof {
    const observation = ref(`Physical lifecycle engineering observation ${id}`);
    const evidence: EvaluationEvidence = { id: `${id}:evidence`, candidateId: candidate.manifest.id, controlRevision: prior.controlRevision,
      evaluatorId: 'independent-fixture', evaluatorArtifact: { uri: `sha256:${evaluator.sha256}`, sha256: evaluator.sha256 }, independent: true, verdict: 'pass', artifact: observation,
      caseResults: [{ id: 'running', status: 'pass', observations: observation, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: [] }] };
    return { proposal: { id, candidate: candidate.manifest, priorAuthority: { generation: prior.generation, epoch: prior.epoch, controlRevision: prior.controlRevision }, evidence: [evidence], recoveryArtifact: ref(readFileSync(join(artifacts, incumbent.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, judge.policyDigest)] };
  }
  const controller = new ReleaseController({ statePath: join(state, 'release.sqlite'), artifactStore: artifacts, operationalStatePath: state, authorityStore: authority,
    exclusiveProcessLease: lease, getPolicy: digest => policies.get(digest)!, readArtifact: read, hooks: {
      async stopAndDrain() { await stop(child); child = undefined; },
      async start(target) {
        child = spawn(process.execPath, [join(target.payloadPath, 'main.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
        const value = await new Promise<string>((resolve, reject) => { child!.once('error', reject); child!.once('exit', () => reject(Error('Candidate failed before ready'))); child!.stdout!.once('data', bytes => resolve(String(bytes).trim())); }); starts.push(Number(value));
        // The real application adopts pending author runs without allocating a new allowance.
        const row = store.get<Run>('runs', 'author'); if (row && row.value.status !== 'cancelled') store.put('runs', 'author', { ...row.value, authority: target.authority }, row.revision);
      },
    } });
  controller.bootstrap(proof(incumbent, initial), original);
  const envelope = { maxRequests: 20, maxTokens: 100, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 1 }, ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 1000 }, resourceOptions.now);
  ledger.allocate('root', envelope); ledger.allocate('author', envelope, 'root');
  store.put('runs', 'author', { id: 'author', status: 'waiting', revision: 1, authority: initial, scope: { kind: 'public' } }, null);
  const mailbox = new EvolutionMailbox({ store, assertAuthority: grant => authority.assert(grant) });
  const proposal = { id: 'change', runId: 'author', scope: { kind: 'public' as const }, authority: initial, provenance: { kind: 'self' as const, inputId: 'initiative', goalId: 'goal', actorId: 'initial' }, justification: 'Fixture control lifecycle', goal: { objective: 'Control continuation', successCriteria: ['fresh old-policy acceptance'] }, experience: ref('experience'), state: 'evaluated' as const, candidate: successor.manifest };
  const evaluation: EvaluationRequest = { requestId: 'evaluation', proposal, candidate: successor, policyDigest: original.policyDigest };
  const externalProof = proof(successor, initial, evaluation.requestId);
  const evaluationReceipt = { requestId: evaluation.requestId, candidateId: successor.manifest.id, policyDigest: original.policyDigest, evidence: externalProof.proposal.evidence, receipt: {} };
  const evaluationWait = mailbox.requestEvaluation(evaluation); mailbox.completeEvaluation(evaluation.requestId, { receipt: evaluationReceipt, proof: externalProof }); await evaluationWait;
  const submission: SubmissionRequest = { ...evaluation, requestId: 'submission', evaluation: evaluationReceipt };
  const submissionWait = mailbox.submitRelease(submission); let stageId = '';
  await mailbox.processSubmission(submission.requestId, async () => { stageId = controller.stageControlUpgrade(externalProof, next); return { requestId: submission.requestId, candidateId: successor.manifest.id, status: 'staged', receipt: { stageId, policyDigest: next.policyDigest } }; }); await submissionWait;
  const binding: ControlActivationRequest = { id: 'activation', submissionId: 'submission', stageId, proposalId: 'change', runId: 'author', scope: { kind: 'public' }, authority: initial };
  const asEvaluation = (review: ProbationReviewRequest): EvaluationRequest => ({ requestId: review.id, proposal: review.proposal, candidate: review.candidate, policyDigest: review.policyDigest });
  const resources = (review: ProbationReviewRequest) => ({ ...resourceOptions, store, request: asEvaluation(review), evaluatorDigest: evaluator.sha256, evaluatorId: 'independent-fixture', maxElapsedMs: 1000, assertAuthority: (grant: Authority) => authority.assert(grant), dispatchAuthority: (grant: Authority, operation: () => void) => authority.dispatch(grant, operation) });
  const options: ControlContinuationOptions = { ...resourceOptions, store, mailbox, status: () => controller.status()!, stagedControl: id => controller.stagedControl(id), assertAuthority: grant => authority.assert(grant),
    reserveProbation: (review, commitReservation) => prepareReview({ ...resources(review), commitReservation }),
    activate: (id, review) => controller.activateStagedControl(id, `successor-${++generation}`, commit => store.transaction(() => {
      assertControlActivationClaim(store, id, review, resourceOptions); commit();
    })),
    reviewProbation: async (review, signal) => accountedReview({ ...resources(review), prepared: true, physicalAuthority: review.physicalAuthority, signal }, async gate => {
      let reviewer: ChildProcess | undefined;
      try {
        gate.dispatch(() => { reviewer = spawn(process.execPath, ['-e', 'console.log("fresh independent lifecycle check")'], { stdio: ['ignore', 'pipe', 'pipe'] }); });
        const code = await new Promise(resolve => reviewer!.once('exit', resolve)); assert.equal(code, 0);
        return proof(review.candidate, review.judgeAuthority, review.id);
      } finally { await stop(reviewer); }
    }), acceptProbation: async (signedProof, review) => authority.dispatch(review.physicalAuthority, () => store.transaction(() => {
      assertProbationLineage(store, review, resourceOptions); controller.acceptProbation(signedProof);
    })) };
  return { root, store, authority, controller, mailbox, ledger, binding, options, proof, original, next, incumbent, successor, starts,
    status: () => controlActivationStatus(store, binding.id, binding.runId, binding.scope)!,
    async dispose() { await stop(child); controller.close(); lease.close(); authority.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('durable authored activation actually starts control successor and accepts a fresh original-policy probation proof', async () => {
  const f = await fixture(), continuation = new ControlContinuation(f.options);
  try {
    const allocation = f.store.get('allocations', 'author');
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'accepted'); assert.deepEqual(f.starts, [2]);
    assert.equal(f.controller.status()?.accepted.policyDigest, f.next.policyDigest);
    assert.throws(() => f.authority.assert(f.binding.authority), /withdrawn/);
    const after = f.store.get<{ elapsedFloorMs?: number }>('allocations', 'author')!;
    const { elapsedFloorMs: beforeFloor, ...beforeGrant } = allocation!.value as unknown as { elapsedFloorMs: number };
    const { elapsedFloorMs: afterFloor, ...afterGrant } = after.value;
    assert.deepEqual(afterGrant, beforeGrant); assert.ok(afterFloor! >= beforeFloor);
    assert.equal(f.ledger.snapshot('author').requests, 1);
    assert.equal(f.ledger.request(reviewPhysicalId(f.status().review!.id))?.status, 'succeeded');
    assert.ok(f.controller.history().some(event => event.kind === 'probation-accepted'));
    assert.notEqual(f.status().review!.admissionEvidenceIds[0], (f.controller.proof(f.status().proofId!) as { proof: ReleaseProof }).proof.proposal.evidence[0]!.id);
    assert.equal(f.status().review!.policyDigest, f.original.policyDigest);
    assert.ok(f.status().physicalAuthority!.epoch > f.binding.authority.epoch);
  } finally { await continuation.close(); await f.dispose(); }
});

test('ordinary staged proposal uses the same durable activation and fresh original-policy probation continuation', async () => {
  const f = await fixture({}, true), continuation = new ControlContinuation(f.options);
  try {
    assert.equal(f.controller.status()!.phase, 'accepted'); assert.deepEqual(f.starts, []);
    assert.equal(f.successor.manifest.controls, f.incumbent.manifest.controls);
    assert.equal(f.next.policyDigest, f.original.policyDigest);
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'accepted'); assert.deepEqual(f.starts, [2]);
    assert.equal(f.controller.status()!.accepted.candidateId, f.successor.manifest.id);
    assert.equal(f.controller.status()!.accepted.policyDigest, f.original.policyDigest);
    assert.equal(f.status().review!.policyDigest, f.original.policyDigest);
    assert.notEqual(f.status().review!.admissionEvidenceIds[0], (f.controller.proof(f.status().proofId!) as { proof: ReleaseProof }).proof.proposal.evidence[0]!.id);
    assert.equal(f.ledger.request(reviewPhysicalId(f.status().review!.id))!.status, 'succeeded');
    assert.ok(f.controller.history().some(event => (event.value as { probationJudge?: { change: string } }).probationJudge?.change === 'ordinary'));
  } finally { await continuation.close(); await f.dispose(); }
});

for (const ordinary of [false, true]) test(`expired original root completes ${ordinary ? 'ordinary' : 'control'} staged activation and fresh probation only with accepted host policy, retaining old uncertainty`, async () => {
  let now = 0, f: Awaited<ReturnType<typeof fixture>>;
  const clock = () => now;
  const resourceLedger: HostResourceLedgerFactory = (store, ceiling, suppliedClock) => {
    const resources = new ResourceLedger(store, ceiling, suppliedClock ?? clock);
    const root = store.get<{ envelope: ResourceEnvelope }>('allocations', 'root')!.value;
    const current = f.authority.current()!;
    resources.applyAllowanceAmendment({ id: 'explicit-host-unlimited', rootId: 'root', expectedEnvelopeDigest: identity(root.envelope), authorizationRef: 'fixture-user-grant',
      cumulativeTokenLimit: null, cumulativeCostLimit: null, cumulativeRequestLimit: null, cumulativeElapsedLimit: null, descendantCostLimit: 'root', scope: 'root-and-descendants' },
    { authority: current as Authority, assertAuthority: () => f.authority.assert(current as Authority) });
    return resources;
  };
  f = await fixture({ now: clock, resourceLedger }, ordinary);
  const continuation = new ControlContinuation(f.options);
  try {
    const old: PhysicalRequest = { id: 'old-unknown', runId: 'author', purpose: 'review', provider: 'fixture', model: 'fixture', promptManifestId: 'old', requestDigest: identity('old'), reservationId: 'old-unknown', status: 'reserved',
      usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    f.ledger.reserve(old); f.ledger.dispatched({ ...old, status: 'dispatched' }); f.ledger.settle({ ...old, status: 'uncertain' });
    f.ledger.releaseConcurrency(old.id, { kind: 'host-recovery', reason: 'Fixture proves old transport is gone; financial outcome remains unknown' });
    const retained = f.store.get('requests', old.id), root = f.store.get<{ envelope: ResourceEnvelope; startedAt: number }>('allocations', 'root')!.value;
    now = 100000;
    assert.throws(() => f.ledger.reserve({ ...old, id: 'unbound', reservationId: 'unbound' }), /exhausted/);
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'accepted'); assert.deepEqual(f.starts, [2]); assert.equal(f.controller.status()!.phase, 'accepted');
    assert.equal(f.ledger.request(reviewPhysicalId(f.status().review!.id))!.status, 'succeeded');
    assert.deepEqual(f.store.get('requests', old.id), retained); assert.equal(f.ledger.request(old.id)!.status, 'uncertain');
    const current = f.store.get<{ envelope: ResourceEnvelope; startedAt: number }>('allocations', 'root')!.value;
    assert.equal(current.startedAt, root.startedAt); assert.deepEqual(current.envelope, root.envelope);
    assert.equal(f.ledger.snapshot('root').requests, 2);
  } finally { await continuation.close(); await f.dispose(); }
});

test('binding tampering, stale author and pending cancellation cannot activate or reserve a reviewer', async () => {
  for (const boundary of ['scope', 'proposal', 'stage', 'cancel', 'stale'] as const) {
    const f = await fixture(), continuation = new ControlContinuation(f.options);
    try {
      const binding = structuredClone(f.binding);
      if (boundary === 'scope') { binding.scope = { kind: 'restricted', principals: ['other-author'] }; assert.throws(() => enqueueControlActivation(f.store, binding), /audience/); continue; }
      if (boundary === 'proposal') binding.proposalId = 'other-proposal';
      if (boundary === 'stage') binding.stageId = 'other-stage';
      enqueueControlActivation(f.store, binding);
      if (boundary === 'cancel') { const row = f.store.get<Run>('runs', 'author')!; f.store.put('runs', 'author', { ...row.value, status: 'cancelled' }, row.revision); f.ledger.cancel('author'); }
      if (boundary === 'stale') await f.controller.recover('explicit-recovery');
      await continuation.processPending();
      assert.equal(f.status().status, 'rejected'); assert.equal(f.ledger.snapshot('author').requests, 0);
      assert.equal(f.controller.status()?.accepted.candidateId, f.incumbent.manifest.id);
      assert.equal(f.starts.includes(2), false);
    } finally { await continuation.close(); await f.dispose(); }
  }
});

test('producer winning the reservation race keeps activation pending without spending a reviewer request', async () => {
  const f = await fixture(); let finishProducer!: () => void, producer: Promise<Run> | undefined, raced = false;
  const done = new Promise<void>(resolve => { finishProducer = resolve; });
  const effects = new EffectJournal(f.store, f.authority, { async dispatch() { throw Error('No effects expected'); }, async reconcile() { throw Error('No effects expected'); } });
  const runtime = new DurableRuntime({ store: f.store, resources: f.ledger, effects,
    canResume: () => f.status().status === 'pending',
    shell: { async run() { await done; return { status: 'checkpointed', observations: [] }; } } });
  const continuation = new ControlContinuation({ ...f.options,
    readyToActivate: () => f.store.get<Run>('runs', 'author')?.value.status !== 'running',
    reserveProbation: (review, commitReservation) => {
      if (!raced) { raced = true; producer = runtime.resume('author', { id: 'producer', requestDigest: '0'.repeat(64), fragments: [] }); }
      f.options.reserveProbation(review, commitReservation);
    },
  });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.store.get<Run>('runs', 'author')?.value.status, 'running');
    assert.equal(f.status().status, 'pending'); assert.deepEqual(f.starts, []);
    assert.equal(f.ledger.snapshot('author').requests, 0); assert.equal(f.ledger.snapshot('author').concurrent, 0);
    assert.deepEqual(f.store.list('host.external-review-reservations'), []);
    finishProducer(); assert.equal((await producer)?.status, 'waiting');
    await continuation.processPending(); assert.equal(f.status().status, 'accepted'); assert.deepEqual(f.starts, [2]);
    assert.equal(f.ledger.snapshot('author').requests, 1);
  } finally { finishProducer(); await producer; await continuation.close(); await f.dispose(); }
});

test('cancelled caller before enqueue leaves no durable request; caller cancellation after enqueue does not revoke host continuation', async () => {
  const f = await fixture(), continuation = new ControlContinuation(f.options);
  try {
    const caller = new AbortController(); caller.abort();
    assert.throws(() => enqueueControlActivation(f.store, f.binding, caller.signal)); assert.equal(f.status(), undefined);
    const activeCaller = new AbortController(); enqueueControlActivation(f.store, f.binding, activeCaller.signal); activeCaller.abort();
    await continuation.processPending(); assert.equal(f.status().status, 'accepted');
    assert.throws(() => controlActivationStatus(f.store, f.binding.id, 'other-author', f.binding.scope), /audience/);
  } finally { await continuation.close(); await f.dispose(); }
});

test('cancellation after fresh review but before actual acceptance cannot accept successor; independent recovery remains usable', async () => {
  const f = await fixture();
  const continuation = new ControlContinuation({ ...f.options, acceptProbation: async (proof, review) => {
    const row = f.store.get<Run>('runs', 'author')!; f.store.put('runs', 'author', { ...row.value, status: 'cancelled' }, row.revision); f.ledger.cancel('author');
    await f.options.acceptProbation(proof, review);
  } });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'uncertain'); assert.equal(f.controller.status()?.phase, 'probation');
    assert.equal(f.controller.status()?.accepted.candidateId, f.incumbent.manifest.id);
    await f.controller.recover('offline-rescue'); assert.deepEqual(f.starts, [2, 1]);
    assert.equal(f.store.get<Run>('runs', 'author')?.value.status, 'cancelled');
    await continuation.processPending(); assert.deepEqual(f.starts, [2, 1]);
  } finally { await continuation.close(); await f.dispose(); }
});

test('cancellation after reservation but before guarded withdrawal leaves the incumbent authority and controller accepted', async () => {
  const f = await fixture(); let reviews = 0;
  const continuation = new ControlContinuation({ ...f.options,
    activate: async (id, review) => { f.ledger.cancel('author'); return f.options.activate(id, review); },
    reviewProbation: async (review, signal) => { reviews++; return f.options.reviewProbation(review, signal); },
  });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'uncertain'); assert.equal(reviews, 0); assert.deepEqual(f.starts, []);
    assert.equal(f.controller.status()?.phase, 'accepted'); assert.equal(f.controller.status()?.accepted.candidateId, f.incumbent.manifest.id);
    assert.doesNotThrow(() => f.authority.assert(f.binding.authority));
    assert.equal(f.controller.history().filter(event => event.kind === 'transfer-intent').length, 0);
    assert.equal(f.ledger.snapshot('author').requests, 1, 'The original reservation remains accounted until exact cleanup');
  } finally { await continuation.close(); await f.dispose(); }
});

test('guarded withdrawal holds authority and author write locks through the actual authority write', async () => {
  const f = await fixture(), continuation = new ControlContinuation(f.options);
  const withdraw = f.authority.withdraw.bind(f.authority); let observed = 0;
  f.authority.withdraw = (grant, guard) => withdraw(grant, commit => {
    assert.ok(guard, 'Ordinary activation must guard its withdrawal');
    guard(() => {
      const observer = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import { DatabaseSync } from 'node:sqlite';
        const locks = process.argv.slice(1).map(path => {
          const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=1');
          try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); return false; }
          catch (error) { if (!/locked/.test(error.message)) throw error; return true; }
          finally { db.close(); }
        }); process.stdout.write(JSON.stringify(locks));
      `, join(f.root, 'state', 'authority.sqlite'), f.store.filename], { encoding: 'utf8', env: {} });
      assert.equal(observer.status, 0, observer.stderr); assert.deepEqual(JSON.parse(observer.stdout), [true, true]);
      observed++; commit();
    });
  });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(observed, 1); assert.equal(f.status().status, 'accepted'); assert.deepEqual(f.starts, [2]);
  } finally { await continuation.close(); await f.dispose(); }
});

test('actual probation acceptance holds authority and cancellation write locks through the controller commit', async () => {
  const f = await fixture(), continuation = new ControlContinuation(f.options);
  const commit = f.controller.acceptProbation.bind(f.controller); let commits = 0;
  f.controller.acceptProbation = proof => {
    const observer = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { DatabaseSync } from 'node:sqlite';
      const locks = process.argv.slice(1).map(path => {
        const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=1');
        try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); return false; }
        catch (error) { if (!/locked/.test(error.message)) throw error; return true; }
        finally { db.close(); }
      });
      process.stdout.write(JSON.stringify(locks));
    `, join(f.root, 'state', 'authority.sqlite'), f.store.filename], { encoding: 'utf8', env: {} });
    assert.equal(observer.status, 0, observer.stderr);
    assert.deepEqual(JSON.parse(observer.stdout), [true, true]);
    commit(proof); commits++;
  };
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(commits, 1); assert.equal(f.status().status, 'accepted');
    assert.equal(f.controller.status()?.accepted.candidateId, f.successor.manifest.id);
  } finally { await continuation.close(); await f.dispose(); }
});

test('probation reservation ownership is finished after partial reserve or lost activation without retrying review', async () => {
  for (const failure of ['reserve', 'activate'] as const) {
    const f = await fixture(); let reserved: ProbationReviewRequest | undefined, finished = 0, reviews = 0;
    const continuation = new ControlContinuation({ ...f.options,
      reserveProbation: (review, commitReservation) => { reserved = review; f.options.reserveProbation(review, commitReservation); if (failure === 'reserve') throw Error('Lost reservation response'); },
      activate: async (id, review) => { await f.options.activate(id, review); throw Error('Lost activation response'); },
      reviewProbation: async (review, signal) => { reviews++; return f.options.reviewProbation(review, signal); },
      finishProbation: review => { assert.deepEqual(review, reserved); finished++; },
    });
    try {
      enqueueControlActivation(f.store, f.binding); await continuation.processPending();
      assert.equal(finished, 1); assert.equal(reviews, 0);
      assert.equal(f.status().status, failure === 'reserve' ? 'rejected' : 'uncertain');
      assert.equal(f.ledger.request(reviewPhysicalId(reserved!.id))?.status, 'reserved', 'Finishing logical ownership alone never discards physical accounting');
      await continuation.processPending(); assert.equal(finished, 1); assert.equal(reviews, 0);
      assert.equal(f.ledger.snapshot('author').requests, 1);
    } finally { await continuation.close(); await f.dispose(); }
  }
});

test('lost activation response and interrupted journal retain uncertainty and never re-dispatch', async () => {
  const f = await fixture(); let physicalReviews = 0;
  const continuation = new ControlContinuation({ ...f.options,
    activate: async (id, review) => { await f.options.activate(id, review); throw Error('Actual activation response lost'); },
    reviewProbation: async (request, signal) => { physicalReviews++; return f.options.reviewProbation(request, signal); } });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'uncertain'); assert.deepEqual(f.starts, [2]); assert.equal(physicalReviews, 0);
    const record = f.store.get('host.control-continuations', f.binding.id)!;
    f.store.put('host.control-continuations', f.binding.id, { ...f.status(), status: 'reviewing' }, record.revision);
    const restarted = new ControlContinuation(f.options); recoverReviewReservations(f.store);
    assert.equal(f.status().status, 'uncertain'); await restarted.processPending();
    assert.deepEqual(f.starts, [2]); assert.equal(physicalReviews, 0);
    assert.equal(f.ledger.request(reviewPhysicalId(f.status().review!.id))?.status, 'failed');
    await f.controller.recover('rescue-without-review'); assert.deepEqual(f.starts, [2, 1]); await restarted.close();
  } finally { await continuation.close(); await f.dispose(); }
});

test('self-judging or reused admission evidence fails probation and preserves accepted rescue', async () => {
  for (const mode of ['new-judge', 'reused-evidence'] as const) {
    const f = await fixture(); const continuation = new ControlContinuation({ ...f.options,
      reviewProbation: async request => mode === 'new-judge' ? f.proof(f.successor, request.physicalAuthority, request.id, f.next) : f.controller.stagedControl(f.binding.stageId)!.proof });
    try {
      enqueueControlActivation(f.store, f.binding); await continuation.processPending();
      assert.equal(f.status().status, 'uncertain'); assert.equal(f.controller.status()?.accepted.candidateId, f.incumbent.manifest.id);
      assert.equal(f.controller.status()?.phase, 'probation');
      assert.ok(f.status().probationProof); assert.ok(f.store.readJsonArtifact<ReleaseProof>(f.status().probationProof!).signed.length);
    } finally { await continuation.close(); await f.dispose(); }
  }
});

test('reservation persisted before a lost journal write remains consumed and cannot re-activate after restart', async () => {
  const f = await fixture(); let reservations = 0;
  const continuation = new ControlContinuation({ ...f.options, reserveProbation: (request, commitReservation) => {
    f.options.reserveProbation(request, commitReservation); reservations++;
    // Represents death after the authoritative reservation commit and before journal acceptance.
    throw Error('Host died before continuation journal write');
  } });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(reservations, 1); assert.deepEqual(f.starts, []); assert.equal(f.ledger.snapshot('author').requests, 1);
    // A genuinely reopened database observes the retained request and reservation.
    const reopened = new OperationalStore({ filename: f.store.filename });
    assert.equal(controlActivationStatus(reopened, f.binding.id, f.binding.runId, f.binding.scope)?.status, 'rejected'); reopened.close();
    const row = f.store.get('host.control-continuations', f.binding.id)!;
    // At the actual crash boundary the pending write preceded the lost completion write.
    f.store.put('host.control-continuations', f.binding.id, { request: f.binding, status: 'pending' }, row.revision);
    recoverReviewReservations(f.store); const restarted = new ControlContinuation(f.options); await restarted.processPending();
    assert.equal(f.status().status, 'rejected'); assert.deepEqual(f.starts, []);
    assert.equal(f.ledger.snapshot('author').requests, 1);
    assert.equal(f.controller.status()?.accepted.candidateId, f.incumbent.manifest.id);
    await restarted.close();
  } finally { await continuation.close(); await f.dispose(); }
});

test('cancellation between accepted activation and fresh physical review cannot launch a reviewer', async () => {
  const f = await fixture();
  const continuation = new ControlContinuation({ ...f.options, activate: async (id, review) => {
    const grant = await f.options.activate(id, review);
    const row = f.store.get<Run>('runs', 'author')!; f.store.put('runs', 'author', { ...row.value, status: 'cancelled' }, row.revision); f.ledger.cancel('author'); return grant;
  } });
  try {
    enqueueControlActivation(f.store, f.binding); await continuation.processPending();
    assert.equal(f.status().status, 'uncertain'); assert.deepEqual(f.starts, [2]);
    assert.equal(f.ledger.request(reviewPhysicalId(f.status().review!.id))?.status, 'failed');
    assert.equal(f.controller.status()?.accepted.candidateId, f.incumbent.manifest.id);
    await f.controller.recover('cancelled-author-rescue'); assert.deepEqual(f.starts, [2, 1]);
  } finally { await continuation.close(); await f.dispose(); }
});
