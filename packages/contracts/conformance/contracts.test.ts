import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthority, assertDerivationScope, candidateIdentity, canonicalJson, identity, inputIdentity, mayOriginateModification, scopeAllows, transitionEffect, transitionRun, validateCandidate, validateCapturedPrompt, validateCheckpoint, validateEvaluation, validateGoal, validateMemory, validateObligation, validatePhysicalRequest, validatePromptManifest, validateRelease } from '../index.ts';
import { candidateFixture, effectFixture, evidenceFixture, fixtureArtifact, fixtureAuthority, fixtureUsage, goalFixture, memoryFixture, obligationFixture, promptFixture, releaseFixture, runFixture } from './fixtures.ts';

test('immutable identity ignores property order and rejects lossy JSON', () => {
  assert.equal(identity({ b: 2, a: 1 }), identity({ a: 1, b: 2 }));
  for (const value of [undefined, NaN, Infinity, { a: undefined }, new Date(), new Array(1)]) assert.throws(() => canonicalJson(value));
  const cycle: unknown[] = []; cycle.push(cycle); assert.throws(() => canonicalJson(cycle));
});
test('duplicate intake has same identity while revision or source changes do not', () => {
  const input = { source: 'slack:workspace', externalId: 'channel:message', externalRevision: '1' };
  assert.equal(inputIdentity(input), inputIdentity({ ...input }));
  const fullInput = { ...input, value: 'edited metadata outside external revision', authenticated: true };
  assert.equal(inputIdentity(input), inputIdentity(fullInput));
  assert.notEqual(inputIdentity(input), inputIdentity({ ...input, externalRevision: '2' }));
  assert.notEqual(inputIdentity(input), inputIdentity({ ...input, source: 'direct' }));
});
test('uncertain delivery cannot dispatch again; reconciliation preserves effect identity', () => {
  const authorized = transitionEffect(effectFixture(), { kind: 'authorize', reservationId: 'reserved-1' }, fixtureAuthority);
  const sent = transitionEffect(authorized, { kind: 'dispatch' }, fixtureAuthority);
  const uncertain = transitionEffect(sent, { kind: 'settle', outcome: 'uncertain' }, fixtureAuthority);
  assert.throws(() => transitionEffect(uncertain, { kind: 'dispatch' }, fixtureAuthority), /reconcile/);
  const reconciled = transitionEffect(uncertain, { kind: 'reconcile', outcome: 'succeeded', receipt: fixtureArtifact }, { ...fixtureAuthority, epoch: 2, generation: 'generation-2' });
  assert.equal(reconciled.id, uncertain.id); assert.equal(reconciled.status, 'succeeded'); assert.equal(reconciled.revision, 4);
  assert.throws(() => transitionEffect(reconciled, { kind: 'dispatch' }, fixtureAuthority));
  assert.equal(effectFixture().status, 'pending');
});
test('unresolved effects remain uncertain and confirmed nonapplication requires a new intent', () => {
  const effect = { ...effectFixture(), status: 'uncertain' as const, reservationId: 'r' };
  assert.equal(transitionEffect(effect, { kind: 'reconcile', outcome: 'unresolved', receipt: fixtureArtifact }, fixtureAuthority).status, 'uncertain');
  const absent = transitionEffect(effect, { kind: 'reconcile', outcome: 'not-applied', receipt: fixtureArtifact }, fixtureAuthority);
  assert.equal(absent.status, 'failed'); assert.throws(() => transitionEffect(absent, { kind: 'dispatch' }, fixtureAuthority));
});
test('stale generation is fenced even when epoch matches', () => {
  assert.throws(() => assertAuthority({ ...fixtureAuthority, generation: 'other' }, fixtureAuthority));
  assert.throws(() => transitionEffect(effectFixture(), { kind: 'authorize', reservationId: 'r' }, { ...fixtureAuthority, epoch: 2 }));
});
test('checkpoint belongs to durable run and exact state revision, including cancelled run', () => {
  const run = runFixture(); const checkpoint = { runId: run.id, revision: run.revision, shell: 'pi-core', artifact: fixtureArtifact, observationIds: ['observation-1'] };
  validateCheckpoint(checkpoint, run); validateCheckpoint(checkpoint, { ...run, status: 'cancelled' });
  assert.throws(() => validateCheckpoint({ ...checkpoint, runId: 'other' }, run));
  assert.throws(() => validateCheckpoint({ ...checkpoint, revision: 1 }, run));
});
test('a summary preserves provenance and cannot widen private audience or become an observation', () => {
  const source = memoryFixture(); const summary = { ...source, id: 'summary-1', kind: 'interpretation' as const, provenance: { ...source.provenance, sourceIds: [source.id], derivation: 'summarized' as const } };
  assertDerivationScope([source], summary);
  assert.throws(() => assertDerivationScope([source], { ...summary, scope: { kind: 'public' } }));
  assert.throws(() => assertDerivationScope([source], { ...summary, provenance: { ...summary.provenance, sourceIds: ['other'] } }));
  assert.throws(() => validateMemory({ ...summary, kind: 'observation' }));
  assert.equal(scopeAllows(source.scope, { kind: 'restricted', principals: ['bob'] }), false);
});
test('paused goal and forgotten memory leave a separate owed obligation', () => {
  const obligation = obligationFixture(); const goal = { ...goalFixture(), status: 'paused' as const, reason: 'awaiting resources' }; const memory = { ...memoryFixture(), status: 'forgotten' as const };
  validateGoal(goal); validateMemory(memory); validateObligation(obligation); assert.equal(obligation.status, 'owed');
  assert.throws(() => validateObligation({ ...obligation, status: 'delivered' }));
});
test('goal completion needs evidence and waiting requires a wakeup', () => {
  assert.throws(() => validateGoal({ ...goalFixture(), status: 'completed' }));
  assert.throws(() => validateGoal({ ...goalFixture(), status: 'waiting' }));
  validateGoal({ ...goalFixture(), status: 'completed', evidenceIds: ['result-1'] });
});
test('speech admission does not imply eligibility to originate human modifications', () => {
  const input = { id: 'i', source: 'direct', externalId: 'e', externalRevision: '1', actorId: 'alice', authenticated: true, scope: { kind: 'public' as const }, value: 'hello' };
  assert.equal(mayOriginateModification(input, ['alice']), true);
  assert.equal(mayOriginateModification({ ...input, authenticated: false }, ['alice']), false);
  assert.equal(mayOriginateModification(input, ['bob']), false);
});
test('owned prompt instructions must be replaceable and final payload artifact must match', () => {
  const prompt = promptFixture(); validatePromptManifest(prompt);
  assert.throws(() => validatePromptManifest({ ...prompt, fragments: [{ ...prompt.fragments[0]!, replaceable: false }] }));
  assert.throws(() => validatePromptManifest({ ...prompt, requestDigest: identity('different payload') }));
});
test('physical retries are separately accounted and unknown usage is not zero', () => {
  const request = { id: 'request-1', runId: 'run-1', purpose: 'reasoning' as const, provider: 'mistral', model: 'configured-model', promptManifestId: 'prompt-1', requestDigest: fixtureArtifact.sha256, reservationId: 'r-1', status: 'uncertain' as const, usage: fixtureUsage };
  validatePhysicalRequest(request); validatePhysicalRequest({ ...request, id: 'request-2', parentRequestId: request.id });
  assert.equal(request.usage.costUsd, null); assert.throws(() => validatePhysicalRequest({ ...request, usage: { ...fixtureUsage, requests: 2 } }));
});
test('candidate identity covers source, dependencies, prompts, model, config and controls', () => {
  const candidate = candidateFixture(); validateCandidate(candidate);
  for (const field of ['source', 'dependencies', 'prompts', 'model', 'configuration', 'controls'] as const) assert.throws(() => validateCandidate({ ...candidate, [field]: identity('changed') }));
  const { id, ...rest } = candidate; assert.equal(candidateIdentity(rest), id);
});
test('release rejects self-review, untrusted evidence and substituted candidates or controls', () => {
  const proposal = releaseFixture(); validateRelease(proposal, fixtureAuthority, ['fixture-reviewer']);
  const evidence = proposal.evidence[0]!;
  for (const patch of [{ independent: false }, { evaluatorId: proposal.candidate.createdBy }, { candidateId: identity('another candidate') }, { controlRevision: 'candidate-new-controls' }]) assert.throws(() => validateRelease({ ...proposal, evidence: [{ ...evidence, ...patch }] }, fixtureAuthority, ['fixture-reviewer', proposal.candidate.createdBy]));
  assert.throws(() => validateRelease(proposal, fixtureAuthority, []));
  assert.throws(() => validateRelease(proposal, { ...fixtureAuthority, epoch: 2 }, ['fixture-reviewer']));
});
test('missing comparator or invalid evidence cannot be converted into a pass', () => {
  const evidence = evidenceFixture();
  for (const status of ['unavailable', 'invalid', 'fail'] as const) assert.throws(() => validateEvaluation({ ...evidence, caseResults: [{ ...evidence.caseResults[0]!, status }] }));
  assert.throws(() => validateEvaluation({ ...evidence, caseResults: [] }));
  validateEvaluation({ ...evidence, verdict: 'inconclusive', caseResults: [{ ...evidence.caseResults[0]!, status: 'unavailable' }] });
});

test('cancellation is terminal for execution without deleting uncertain external effects', () => {
  const cancelled = transitionRun(runFixture(), 'cancelled');
  assert.throws(() => transitionRun(cancelled, 'running'));
  assert.throws(() => transitionRun(cancelled, 'completed'));
  assert.equal(cancelled.revision, 3);
});
test('provider request capture detects byte-level payload drift', () => {
  const manifest = promptFixture(); validateCapturedPrompt(manifest, '"fixture"');
  assert.throws(() => validateCapturedPrompt(manifest, ' "fixture"'));
});
