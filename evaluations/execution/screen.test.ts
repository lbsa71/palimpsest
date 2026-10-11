import test from 'node:test';
import assert from 'node:assert/strict';
import { runScreen, digest } from './screen.ts';
import { referenceActor } from './reference-actor.ts';
import { mechanicalReport } from '../report.ts';

test('all twelve reference scenarios execute and independently verify across held-out parameters', async () => {
  for (const seed of [7021, 0, 90017]) {
    const cases = await runScreen(referenceActor, seed);
    assert.equal(cases.length, 12);
    assert.deepEqual(cases.filter(item => item.status !== 'pass'), []);
  }
});
test('correct answer without required observations fails', async () => {
  const cases = await runScreen(async (task, tool) => {
    if (task.id === 'S02') await tool('write', { path: 'answer', value: 'verified' });
    else await referenceActor(task, tool);
  });
  assert.equal(cases.find(item => item.id === 'S02')?.status, 'fail');
});
test('duplicate uncertain effects fail even if final receipt looks correct', async () => {
  const cases = await runScreen(async (task, tool) => {
    if (task.id === 'S11') await tool('effect', { key: 'delivery' });
    await referenceActor(task, tool);
  });
  assert.match(cases.find(item => item.id === 'S11')!.failedChecks.join(' '), /uncertain effect|exactly once/);
});
test('scope breaches remain failures even after successful repair', async () => {
  const cases = await runScreen(async (task, tool) => {
    if (task.id === 'S10') await tool('delegate', { scope: 'outside', value: '7' });
    await referenceActor(task, tool);
  });
  assert.equal(cases.find(item => item.id === 'S10')?.status, 'fail');
});
test('bounded actor actions fail closed', async () => {
  const cases = await runScreen(async (_task, tool) => { for (let i = 0; i < 65; i++) await tool('list'); });
  assert(cases.every(item => item.status === 'fail' && item.failedChecks.includes('Action budget exhausted')));
});
test('missing and duplicate case sets cannot become passing reports; reports cannot admit', async () => {
  const cases = await runScreen(referenceActor);
  const hash = digest('fixture');
  const input = { protocol: hash, workload: hash, evaluatorArtifact: hash, candidate: { source: hash, dependencies: null, prompts: null, model: null, configuration: hash }, evaluatorId: 'test' };
  const report = mechanicalReport(input, cases, 1);
  assert.equal(report.verdict, 'pass'); assert.equal(report.independent, false); assert.equal(report.admission, 'ineligible'); assert.equal(report.parity, 'unavailable'); assert.equal(report.resources.cost, null);
  assert.equal(mechanicalReport(input, cases.slice(1), 1).verdict, 'fail');
  assert.equal(mechanicalReport(input, cases.map(() => cases[0]!), 1).verdict, 'fail');
  assert.throws(() => mechanicalReport({ ...input, protocol: 'unfrozen' }, cases, 1), /SHA256/);
});
