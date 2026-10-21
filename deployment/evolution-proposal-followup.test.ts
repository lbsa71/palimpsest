import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ContractError, identity, type Goal, type InboundInput, type JsonValue } from '../packages/contracts/index.ts';
import { freezeCandidate, hashBytes } from '../packages/release/artifacts.ts';
import { ChangeProposals, type ChangeProvenance, type ChangeRecord } from '../packages/release/proposals.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { evolutionTools, goalDefinitionIdentity, type EvaluationRequest, type EvolutionOptions } from './evolution-tools.ts';
import { proposalProvenance } from './proposal-origin.ts';

function fixture(t: TestContext, self = false) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-proposal-followup-')), source = join(root, 'source'), artifactStore = join(root, 'artifacts'); mkdirSync(source);
  const lock = '{}'; writeFileSync(join(source, 'package-lock.json'), lock);
  const runtime = { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
  const candidate = freezeCandidate(source, artifactStore, ['package-lock.json'], { createdBy: 'author', prompts: {}, model: {}, configuration: {},
    dependencies: { installedRuntime: [], lockfile: hashBytes(lock), retainedForks: [], checkBuildToolchain: [], runtime },
    controls: { classifier: 'host-execution-closure-v1', files: [{ path: 'package-lock.json', sha256: hashBytes(lock) }], runtime, policy: {} } });
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const authority = { epoch: 1, generation: 'author', controlRevision: candidate.manifest.controls }, scope = { kind: 'restricted' as const, principals: ['audience'] }, runId = 'run';
  const context = { runId, authority, scope, workspace: source, store };
  store.put('runs', runId, { id: runId, revision: 1, status: 'waiting', authority, scope }, null);
  const original: InboundInput = { id: 'original-input', actorId: self ? 'author' : 'operator', source: self ? 'initiative' : 'direct', authenticated: true, externalId: self ? 'goal' : 'thread', externalRevision: '1', scope, value: 'Make one finite change' };
  store.append({ id: original.id, stream: runId, type: 'admitted', data: original });
  const origin: ChangeProvenance = self ? { kind: 'self', inputId: original.id, actorId: original.actorId, goalId: original.externalId } : { kind: 'human', inputId: original.id, actorId: original.actorId };
  if (self) {
    const goal: Goal = { id: 'goal', revision: 1, origin: { kind: 'self' }, purpose: 'Finite measured repair', scope, status: 'waiting', successCriteria: ['Independent check'], evidenceIds: [], dependencyIds: [], resources: { maxRequests: 1, maxTokens: 1, maxCostUsd: 1, maxElapsedMs: 1000, maxConcurrency: 1 }, priority: 1, nextAction: 'inspect', reviewAt: '2026-10-21T00:00:00Z' };
    store.put('initiative.goals', goal.id, goal, null); store.put('initiative.execution', goal.id, { runId }, null);
    store.put('host.bootstrap', 'development:v1', { runId: 'bootstrap-run' }, null);
    store.append({ id: 'bootstrap-input', stream: 'bootstrap-run', type: 'admitted', data: { ...original, id: 'bootstrap-input', source: 'host.bootstrap' } });
    store.put('host.release-self-origins', goal.id, { goalId: goal.id, goalDefinition: goalDefinitionIdentity(goal), basis: 'accepted-bootstrap', originRunId: 'bootstrap-run' }, null);
  }
  const proposals = new ChangeProposals(store, runId, scope), proposal: ChangeRecord = { id: 'change', runId, authority, scope, provenance: origin, justification: 'Measured defect', goal: { objective: 'Repair', successCriteria: ['Independent check'] }, experience: store.putJsonArtifact([]), state: 'evaluation-dispatched', candidate: candidate.manifest, judgingPolicyDigest: identity('policy') };
  store.put('release.changes', proposals.key(proposal.id), proposal, null);
  const requests: EvaluationRequest[] = [];
  const options: EvolutionOptions = { artifactStore, acceptedCandidateId: candidate.manifest.id, nodeBinary: process.execPath, policyDigest: proposal.judgingPolicyDigest!, maxFiles: 10, maxBytes: 1000, eligibleHumanAuthors: new Set(['operator', 'colleague']),
    assertAuthority: value => assert.deepEqual(value, authority), provenanceForRun: proposalProvenance,
    readEvaluation(request) { requests.push(request); return { status: 'uncertain', requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: request.policyDigest }; },
    enqueueEvaluation() { assert.fail('No fresh evaluation authorized'); }, async submitRelease() { assert.fail('No submission authorized'); } };
  const call = (name = 'change_status') => Promise.resolve().then(() => evolutionTools(context, options).find(tool => tool.name === name)!.execute({ changeId: 'change' }));
  const steer = (patch: Partial<InboundInput> = {}) => { const input = { ...original, id: 'followup', source: 'direct', actorId: 'operator', ...patch }; store.append({ id: input.id, stream: runId, type: 'steering', data: input }); };
  const replace = (patch: Partial<ChangeRecord>) => { const row = store.get('release.changes', proposals.key('change'))!; store.put('release.changes', proposals.key('change'), { ...proposal, ...patch }, row.revision); };
  return { root, store, candidate, original, proposal, proposals, options, requests, call, steer, replace };
}
const knownFailure = (error: unknown) => error instanceof ContractError && (error as Error & { mayHaveApplied?: boolean }).mayHaveApplied === false;

test('eligible human followups retain the original immutable request and provenance for status and freeze', async t => {
  const f = fixture(t); await f.call(); const before = f.store.list('release.changes'), request = f.requests[0];
  f.steer(); await f.call();
  f.steer({ id: 'colleague-followup', actorId: 'colleague' }); await f.call();
  await f.call('candidate_freeze');
  assert.equal(f.requests.length, 3); for (const actual of f.requests) assert.deepEqual(actual, request);
  assert.deepEqual(f.store.list('release.changes'), before); assert.equal(request!.proposal.provenance.inputId, f.original.id);
});

for (const attack of ['ineligible', 'unauthenticated', 'wrong-input', 'wrong-actor', 'wrong-scope'] as const) test(`${attack} cannot use retained proposal provenance`, async t => {
  const f = fixture(t);
  if (attack === 'ineligible') f.steer({ actorId: 'outsider' });
  if (attack === 'unauthenticated') f.steer({ authenticated: false });
  if (attack === 'wrong-input' || attack === 'wrong-actor') f.replace({ provenance: { ...f.proposal.provenance, ...(attack === 'wrong-input' ? { inputId: 'missing' } : { actorId: 'colleague' }) } });
  if (attack === 'wrong-scope') {
    // An authenticated event with a different audience cannot be promoted to this proposal's founding input.
    f.steer({ scope: { kind: 'restricted', principals: ['other'] } });
    f.replace({ provenance: { kind: 'human', inputId: 'followup', actorId: 'operator' } });
  }
  const before = f.store.list('release.changes');
  for (const tool of ['change_status', 'candidate_freeze']) await assert.rejects(f.call(tool), knownFailure);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.store.list('release.changes'), before);
});

test('self requests retain their original origin across authenticated host-only steering', async t => {
  const f = fixture(t, true); await f.call();
  f.steer({ source: 'host.evolution', actorId: 'author' }); await f.call();
  assert.deepEqual(f.requests[1], f.requests[0]);
});

for (const attack of ['human-steering', 'forged-attestation', 'forged-bootstrap', 'ancestor-cycle', 'human-grandparent'] as const) test(`self provenance rejects ${attack}`, async t => {
  const f = fixture(t, true);
  if (attack === 'human-steering') f.steer();
  else {
    const row = f.store.get('host.release-self-origins', 'goal')!, origin = row.value as Record<string, JsonValue>;
    if (attack === 'forged-attestation') f.store.put('host.release-self-origins', 'goal', { ...origin, goalDefinition: identity('forged') }, row.revision);
    if (attack === 'forged-bootstrap') f.store.put('host.release-self-origins', 'goal', { ...origin, originRunId: 'invented-bootstrap' }, row.revision);
    if (attack === 'ancestor-cycle') f.store.put('host.release-self-origins', 'goal', { ...origin, basis: 'independent-initiative', originRunId: 'run' }, row.revision);
    if (attack === 'human-grandparent') {
      const goal = f.store.get<Goal>('initiative.goals', 'goal')!.value, ancestor = { ...goal, id: 'ancestor-goal' };
      f.store.put('initiative.goals', ancestor.id, ancestor, null);
      f.store.put('host.release-self-origins', ancestor.id, { goalId: ancestor.id, goalDefinition: goalDefinitionIdentity(ancestor), basis: 'accepted-bootstrap', originRunId: 'bootstrap-run' }, null);
      f.store.append({ id: 'ancestor-input', stream: 'ancestor-run', type: 'admitted', data: { ...f.original, id: 'ancestor-input', externalId: ancestor.id } });
      f.store.put('host.release-self-origins', 'goal', { ...origin, basis: 'independent-initiative', originRunId: 'ancestor-run' }, row.revision);
      f.store.append({ id: 'bootstrap-human', stream: 'bootstrap-run', type: 'steering', data: { ...f.original, id: 'bootstrap-human', source: 'direct', actorId: 'operator' } });
    }
  }
  await assert.rejects(f.call(), knownFailure); assert.equal(f.requests.length, 0);
});

test('filesystem failures and ContractErrors after a host write remain uncertain', async t => {
  const f = fixture(t); f.steer();
  const effect = join(f.root, 'host-side-effect.txt');
  f.options.readEvaluation = request => { writeFileSync(effect, request.requestId); throw new ContractError('Lost host receipt after write'); };
  await assert.rejects(f.call(), error => error instanceof ContractError && !knownFailure(error));
  assert.ok(readFileSync(effect, 'utf8'));
  rmSync(join(f.options.artifactStore, f.candidate.manifest.id, 'candidate.json'));
  await assert.rejects(f.call(), error => error instanceof Error && !knownFailure(error));
});
