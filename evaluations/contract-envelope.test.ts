import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateIdentity, validateEvaluation } from '../packages/contracts/index.ts';
import { mechanicalToContract } from './contract-envelope.ts';
import { mechanicalReport } from './report.ts';
import { digest, runScreen } from './execution/screen.ts';
import { referenceActor } from './execution/reference-actor.ts';

test('C1 adapter preserves author-only mechanical evidence and checks referenced contents', async () => {
  const hash = digest('test');
  const cases = await runScreen(referenceActor);
  const report = mechanicalReport({ protocol: hash, workload: hash, evaluatorArtifact: hash, candidate: { source: hash, dependencies: null, prompts: null, model: null, configuration: hash }, evaluatorId: 'fixture-author' }, cases, 1);
  const fields = { source: hash, dependencies: hash, prompts: hash, model: hash, configuration: hash, controls: hash, createdBy: 'fixture-author' };
  const candidate = { ...fields, id: candidateIdentity(fields) };
  const artifact = { uri: 'fixture:report', sha256: digest(report) };
  const evaluator = { uri: 'fixture:evaluator', sha256: hash };
  const observations = Object.fromEntries(cases.map(item => [item.id, { uri: `fixture:${item.id}`, sha256: digest(item.observations) }]));
  const envelope = mechanicalToContract(report, candidate, 'prior-controls', artifact, evaluator, observations);
  validateEvaluation(envelope.evidence);
  assert.equal(envelope.evidence.independent, false); assert.equal(envelope.evaluatorRole, 'author'); assert.equal(envelope.evidenceKind, 'mechanical');
  assert.throws(() => mechanicalToContract(report, candidate, 'prior-controls', { ...artifact, sha256: hash }, evaluator, observations), /Report artifact/);
  assert.throws(() => mechanicalToContract(report, candidate, 'prior-controls', artifact, evaluator, {}), /observation artifact/);
});
