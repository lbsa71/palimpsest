import assert from 'node:assert/strict';
import test from 'node:test';
import { syntheticWitnessFixture } from './witness-fixture.ts';

test('review: physical elapsed usage cannot disappear behind a shorter wall interval', () => {
  const f = syntheticWitnessFixture(), observation = f.observations.find(o => o.data.kind === 'request')!;
  assert(observation.data.kind === 'request');
  observation.data.request.usage.elapsedMs = 700000;
  observation.data.charged.elapsedMs = 700000;
  assert(f.prepare().findings.some(f => f.code === 'accounting'), 'physical elapsed usage must exceed the original grant');
});

test('review: uncertain physical time retains its original reservation', () => {
  const f = syntheticWitnessFixture(), observation = f.observations.find(o => o.data.kind === 'request')!, end = f.observations.find(o => o.data.kind === 'end')!;
  assert(observation.data.kind === 'request' && end.data.kind === 'end');
  observation.data.request.status = 'uncertain';
  end.data.accounting.unknownRequestIds = [observation.data.request.id];
  assert(f.prepare().findings.some(f => f.code === 'accounting'), 'uncertain elapsed charge must retain ceiling');
});

test('review: unavailable request bytes cannot hide authenticated physical charges', () => {
  const f = syntheticWitnessFixture(), observation = f.observations.find(o => o.data.kind === 'request')!, end = f.observations.find(o => o.data.kind === 'end')!;
  assert(observation.data.kind === 'request' && end.data.kind === 'end');
  f.artifacts.delete(observation.data.payload.sha256);
  end.data.accounting = structuredClone(f.m.grant.originalAccounting);
  end.data.accounting.usage.elapsedMs = 185000;
  const result = f.prepare();
  assert(result.findings.some(f => f.code === 'record' && f.status === 'unavailable'));
  assert(result.findings.some(f => f.code === 'accounting'), 'authenticated request must remain in cumulative reconciliation');
});

test('review: physical time is summed conservatively even when work overlaps wall time', () => {
  const f = syntheticWitnessFixture(), observation = f.observations.find(o => o.data.kind === 'request')!, end = f.observations.find(o => o.data.kind === 'end')!;
  assert(observation.data.kind === 'request' && end.data.kind === 'end');
  observation.data.request.usage.elapsedMs = 200000;
  observation.data.ceiling.elapsedMs = 200000;
  observation.data.charged.elapsedMs = 200000;
  end.data.accounting.chargedElapsedMs = 201000;
  end.data.accounting.usage.elapsedMs = 201000;
  assert.deepEqual(f.prepare().findings.map(f => f.code), ['synthetic']);
  end.data.accounting.chargedElapsedMs = 200000;
  assert(f.prepare().findings.some(f => f.code === 'accounting'), 'original elapsed charge must not be reset');
});

test('review: unavailable artifacts preserve valid accounting and uncertain reservations stay unavailable', () => {
  const f = syntheticWitnessFixture(), observation = f.observations.find(o => o.data.kind === 'request')!;
  assert(observation.data.kind === 'request');
  f.artifacts.delete(observation.data.payload.sha256);
  const missing = f.prepare();
  assert.equal(missing.status, 'unavailable');
  assert(!missing.findings.some(f => f.code === 'accounting'));
  assert.deepEqual(missing.evidence.finalAccounting?.requestIds, ['prior-physical', 'physical-1']);
  const g = syntheticWitnessFixture(), request = g.observations.find(o => o.data.kind === 'request')!, end = g.observations.find(o => o.data.kind === 'end')!;
  assert(request.data.kind === 'request' && end.data.kind === 'end');
  request.data.request.status = 'uncertain';
  request.data.charged.elapsedMs = request.data.ceiling.elapsedMs;
  end.data.accounting.chargedElapsedMs = 6000;
  end.data.accounting.unknownRequestIds = [request.data.request.id];
  const uncertain = g.prepare();
  assert.deepEqual(uncertain.findings.map(f => f.code), ['unknown-usage', 'synthetic']);
  assert.equal(uncertain.automaticReleaseEligible, false);
  assert.equal(uncertain.h1Eligible, false);
});
