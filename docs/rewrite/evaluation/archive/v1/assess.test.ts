import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDevelopment } from './assess.ts';
import type { DevelopmentWindow, Opportunity } from './assess.ts';
const opportunities: Opportunity[] = ['transfer', 'belief-revision', 'inquiry', 'judgment'].flatMap((family) => [0, 1, 2].map(index => ({ id: `${family}-${index}`, family: family as Opportunity['family'], observedAt: `2026-11-${10 + index}T00:00:00Z`, learnedAt: '2026-11-01T00:00:00Z', outcome: index === 2 ? 'fail' as const : 'pass' as const, artifact: `artifact-${family}-${index}`, externalFeedback: `feedback-${family}-${index}`, audienceBoundaryPreserved: true, reviewDisposition: 'agreed' as const })));
const fixture: DevelopmentWindow = { evidenceKind: 'mechanical', startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-29T00:00:00Z', trustedObserver: false, controls: ['no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'], opportunities };
test('accelerated fixture never qualifies live development', () => assert.equal(assessDevelopment(fixture).status, 'unavailable'));
test('elapsed and independently observed receipt shape passes mechanical validation only', () => assert.equal(assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true }).status, 'pass'));
test('self-praise without later outcomes and controls fails', () => {
  const result = assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true, opportunities: [], controls: [] });
  assert.equal(result.status, 'fail'); assert(result.reasons.length >= 9);
});
test('same-day transfer, disclosure, duplicate identity and disagreement cannot pass', () => {
  const bad = { ...opportunities[0]!, learnedAt: opportunities[0]!.observedAt, audienceBoundaryPreserved: false, reviewDisposition: 'unresolved' as const };
  const result = assessDevelopment({ ...fixture, evidenceKind: 'live-development', trustedObserver: true, opportunities: [...opportunities, bad] });
  assert.equal(result.status, 'fail'); assert(result.reasons.some(reason => reason.includes('seven-day'))); assert(result.reasons.some(reason => reason.includes('duplicate')));
});
