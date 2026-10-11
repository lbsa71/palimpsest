import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDevelopment } from './assess.ts';
import type { DevelopmentWindow, Opportunity } from './assess.ts';
const opportunities: Opportunity[] = ['transfer', 'belief-revision', 'inquiry', 'judgment'].flatMap((family) => [0, 1, 2].map(index => ({ id: `${family}-${index}`, family: family as Opportunity['family'], observedAt: '2026-11-02T00:00:00Z', learnedAt: '2026-11-01T00:00:00Z', outcome: index === 2 ? 'fail' as const : 'pass' as const, artifact: `artifact-${family}-${index}`, externalFeedback: `feedback-${family}-${index}`, audienceBoundaryPreserved: true, interveningExperienceReceipts: ['experience-a', 'experience-b', 'experience-c'], reviewDisposition: 'agreed' as const })));
const fixture: DevelopmentWindow = { evidenceKind: 'mechanical', registered: { schedulerWindowMs: 60000, configurationDigest: 'a'.repeat(64), deadlineAt: '2026-11-03T00:00:00Z' }, autonomousCycles: [1, 2, 3].map(n => ({ id: `cycle-${n}`, observedAt: `2026-11-01T00:0${n}:00Z`, receipt: `receipt-${n}` })), startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-03T00:00:00Z', trustedObserver: false, boundaryReceipts: { restart: 'r', contextReduction: 'c', laterRetrieval: 'l', spontaneousInitiative: 's', contradictoryFeedback: 'f', nonApplicableRule: 'n' }, freshReviewerIds: ['reviewer-a', 'reviewer-b'], controls: ['no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'], opportunities };
test('accelerated fixture never qualifies live development', () => assert.equal(assessDevelopment(fixture).status, 'unavailable'));
test('elapsed and independently observed receipt shape passes mechanical validation only', () => assert.equal(assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true }).status, 'receipt-shape-pass'));
test('self-praise without later outcomes and controls fails', () => {
  const result = assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true, opportunities: [], controls: [] });
  assert.equal(result.status, 'fail'); assert(result.reasons.length >= 9);
});
test('same-day transfer, disclosure, duplicate identity and disagreement cannot pass', () => {
  const bad = { ...opportunities[0]!, learnedAt: opportunities[0]!.observedAt, audienceBoundaryPreserved: false, reviewDisposition: 'unresolved' as const };
  const result = assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true, opportunities: [...opportunities, bad] });
  assert.equal(result.status, 'fail'); assert(result.reasons.some(reason => reason.includes('scheduler-window'))); assert(result.reasons.some(reason => reason.includes('duplicate')));
});

test('elapsed time alone and one reviewer cannot qualify boundary coverage', () => {
  const result = assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true, boundaryReceipts: { ...fixture.boundaryReceipts, restart: '' }, freshReviewerIds: ['one', 'one'] });
  assert.equal(result.status, 'fail'); assert(result.reasons.some(r => r.includes('restart'))); assert(result.reasons.some(r => r.includes('reviewer')));
});

test('missing interference, duplicate cycles and deadline overruns remain failures', () => {
 const result = assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true, endedAt: '2026-11-04T00:00:00Z', autonomousCycles: [fixture.autonomousCycles[0]!, fixture.autonomousCycles[0]!, fixture.autonomousCycles[0]!], opportunities: opportunities.map(o => ({ ...o, interveningExperienceReceipts: [] })) });
 assert.equal(result.status, 'fail'); assert(result.reasons.some(r => r.includes('deadline'))); assert(result.reasons.some(r => r.includes('cycles'))); assert(result.reasons.some(r => r.includes('intervening')));
});
