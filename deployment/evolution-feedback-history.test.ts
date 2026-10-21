import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { identity, type Authority, type CandidateManifest, type DataScope, type Run } from '../packages/contracts/index.ts';
import { ChangeProposals, type ChangeRecord } from '../packages/release/proposals.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { evolutionTools, type EvaluationReceipt, type EvolutionOptions } from './evolution-tools.ts';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-feedback-history-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const scope: DataScope = { kind: 'restricted', principals: ['owner'] };
  const prior: Authority = { epoch: 1, generation: 'prior', controlRevision: identity('prior-controls') };
  const current: Authority = { epoch: 2, generation: 'successor', controlRevision: identity('new-controls') };
  const run: Run = { id: 'adopted-run', revision: 2, status: 'waiting', scope, authority: current };
  store.put('runs', run.id, run, null);
  const proposals = new ChangeProposals(store, run.id, scope), policy = identity('prior-policy');
  const manifest = { source: identity('source'), dependencies: identity('deps'), prompts: identity('prompts'), model: identity('model'), configuration: identity('config'), controls: prior.controlRevision, createdBy: prior.generation };
  const candidate: CandidateManifest = { ...manifest, id: identity(manifest) };
  const requestId = identity({ change: proposals.key('change'), candidate: candidate.id, action: 'evaluate', policy });
  const observation = store.putJsonArtifact({ requestId, candidateId: candidate.id, policyDigest: policy, verdict: { verdict: 'pass', reason: 'Original independent checks passed.', findings: [] }, prompt: 'PRIVATE-PROMPT' });
  const receipt: EvaluationReceipt = { requestId, candidateId: candidate.id, policyDigest: policy, receipt: { verdict: 'pass' }, evidence: [{ id: 'independent-review', candidateId: candidate.id, controlRevision: prior.controlRevision, evaluatorId: 'independent', evaluatorArtifact: observation, independent: true, verdict: 'pass', artifact: observation,
    caseResults: [{ id: 'independent-source-review', status: 'pass', observations: observation, usage: { requests: 1, inputTokens: 2, outputTokens: 3, costUsd: 0, elapsedMs: 4 }, interventions: [] }] }] };
  const proposal: ChangeRecord = { id: 'change', runId: run.id, scope, authority: prior, provenance: { kind: 'human', inputId: 'old-input', actorId: 'owner' }, justification: 'Retained release history', goal: { objective: 'Repair', successCriteria: ['Reviewed'] }, experience: observation,
    state: 'evaluated', candidate, judgingPolicyDigest: policy, evaluation: proposals.artifact(receipt) };
  store.put('release.changes', proposals.key(proposal.id), proposal, null);
  const forbidden = () => { assert.fail('Historical reads and refused mutations must not call host evaluation, provenance, or submission ports'); };
  const options: EvolutionOptions = { artifactStore: join(root, 'unused'), acceptedCandidateId: identity('successor'), nodeBinary: process.execPath, policyDigest: identity('successor-policy'), maxFiles: 1, maxBytes: 1, eligibleHumanAuthors: new Set(['owner']),
    assertAuthority: authority => assert.deepEqual(authority, current), provenanceForRun: forbidden, enqueueEvaluation: forbidden, readEvaluation: forbidden, submitRelease: forbidden };
  const tool = (name: string, boundRun = run, policyDigest = options.policyDigest) => evolutionTools({ runId: boundRun.id, scope: boundRun.scope, authority: current, workspace: root, store }, { ...options, policyDigest }).find(value => value.name === name)!;
  return { store, run, proposal, proposals, receipt, tool, policy };
}

test('an adopted run reads its original-policy evaluation and bounded feedback without changing retained records', async t => {
  const f = fixture(t), before = f.store.list('release.changes');
  const result = await f.tool('change_status').execute({ changeId: 'change' });
  assert.deepEqual((result as { evaluation: unknown }).evaluation, f.receipt);
  assert.match(JSON.stringify(result), /Original independent checks passed/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-PROMPT/);
  assert.deepEqual(f.store.list('release.changes'), before);
});

test('historical status remains restricted to the owning run and audience', async t => {
  const f = fixture(t);
  for (const run of [{ ...f.run, id: 'other-run' }, { ...f.run, scope: { kind: 'restricted' as const, principals: ['other'] } }]) {
    const row = f.store.get('runs', run.id); f.store.put('runs', run.id, run, row?.revision ?? null);
    await assert.rejects(async () => f.tool('change_status', run).execute({ changeId: 'change' }), /Change unavailable for this run\/audience/);
  }
});

for (const field of ['requestId', 'candidateId', 'policyDigest'] as const) test(`historical status rejects a mismatched receipt ${field}`, async t => {
  const f = fixture(t), row = f.store.get('release.changes', f.proposals.key('change'))!;
  f.store.put('release.changes', f.proposals.key('change'), { ...f.proposal, evaluation: f.proposals.artifact({ ...f.receipt, [field]: identity('wrong') }) }, row.revision);
  await assert.rejects(async () => f.tool('change_status').execute({ changeId: 'change' }), /mismatched receipt/);
});

test('historical receipt access does not reopen evaluation or submission under successor policy or authority', async t => {
  const f = fixture(t), before = f.store.list('release.changes');
  for (const name of ['candidate_evaluate', 'release_submit'])
    await assert.rejects(async () => f.tool(name).execute({ changeId: 'change' }), /Frozen judging policy changed/);
  // Even restoring the old policy cannot grant the adopted run its predecessor's mutation authority.
  await assert.rejects(async () => f.tool('release_submit', f.run, f.policy).execute({ changeId: 'change' }), /authority/i);
  assert.deepEqual(f.store.list('release.changes'), before);
});
