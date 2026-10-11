import assert from 'node:assert/strict';
import test from 'node:test';
import { availableModelProfiles, selectModelProfile, validateModelGrants, validateModelProfile, type ModelProfile } from './model-grants.ts';
import { validateEvolutionMetadata, type EvolutionMetadata } from './service-process.ts';

const current: ModelProfile = { id: 'fixture-v1', contextWindow: 8192, reasoning: false, effort: 'none', maxOutputTokens: 256, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } };
const next: ModelProfile = { ...current, provider: 'openai', id: 'fixture-v2', reasoning: true, effort: 'high', contextWindow: 16384, maxOutputTokens: 512, pricesPerMillion: { input: 3, output: 4 } };
test('model selection changes provider and prices only with the complete host grant', () => {
  assert.deepEqual(selectModelProfile(next, current, [next]), next);
  assert.throws(() => selectModelProfile(next, current), /exact host profile/);
  for (const change of [{ pricesPerMillion: { input: 0, output: 0 } }, { provider: 'mistral' }, { effort: 'none' }, { id: 'fixture-v3' }, { maxRequestsPerSlice: 3 }, { timeoutMs: 1001 }]) {
    assert.throws(() => selectModelProfile({ ...next, ...change }, current, [next]), /exact host profile/);
  }
  assert.deepEqual(selectModelProfile({ ...next, maxOutputTokens: 128, timeoutMs: 500 }, current, [next]), { ...next, maxOutputTokens: 128, timeoutMs: 500 });
  assert.equal(selectModelProfile({ ...current, provider: 'mistral' }, current).provider, 'mistral');
});
test('profile schema rejects ambiguous provider configuration and invalid accounting input', () => {
  for (const model of [null, [], { ...current, provider: 'other' }, { ...current, id: 'fixture-LATEST' }, { ...current, pricesPerMillion: { input: -1, output: 1 } }, { ...current, pricesPerMillion: { input: 1 } }, { ...current, effort: 'high' }, { ...current, maxOutputTokens: 9000 }, { ...current, endpoint: 'https://ungranted.example' }, { ...current, timeoutMs: Infinity }]) assert.throws(() => validateModelProfile(model));
  assert.throws(() => validateModelGrants([current, { ...current, provider: 'mistral' }]), /Duplicate/);
  assert.throws(() => validateModelGrants(Array.from({ length: 33 }, (_, i) => ({ ...current, id: `fixture-${i}` }))), /Bounded/);
  const profiles = availableModelProfiles(current, [current, next]);
  assert.equal(profiles.length, 2);
  profiles[0]!.pricesPerMillion.input = 99;
  assert.equal(current.pricesPerMillion.input, 1, 'Published profile copies do not mutate host grants');
});

test('profile grants cannot combine independent ceilings or inherit another provider price', () => {
  const fast = { ...next, maxRequestsPerSlice: 4, timeoutMs: 500 };
  const patient = { ...next, maxRequestsPerSlice: 1, timeoutMs: 2000 };
  assert.throws(() => selectModelProfile({ ...next, maxRequestsPerSlice: 4, timeoutMs: 2000 }, current, [fast, patient]), /exact host profile/);
  for (const key of ['contextWindow', 'maxOutputTokens', 'maxRequestsPerSlice', 'timeoutMs'] as const) {
    assert.throws(() => selectModelProfile({ ...next, [key]: next[key] + 1 }, current, [next]), /exact host profile/);
  }
  assert.throws(() => selectModelProfile({ ...next, pricesPerMillion: current.pricesPerMillion }, current, [next]), /exact host profile/);
  assert.throws(() => selectModelProfile({ ...next, reasoning: false, effort: 'none' }, current, [next]), /exact host profile/);
  const { provider, ...implicitMistral } = next;
  assert.throws(() => selectModelProfile(implicitMistral, current, [next]), /exact host profile/);
  const selected = selectModelProfile(next, current, [next]);
  selected.pricesPerMillion.input = 0;
  assert.equal(next.pricesPerMillion.input, 3, 'Selections cannot mutate host price grants');
});

test('the current model remains available alongside 32 complete additional grants', () => {
  const grants = Array.from({ length: 32 }, (_, index) => ({ ...next, id: `fixture-grant-${index}` }));
  assert.equal(availableModelProfiles(current, grants).length, 33);
  assert.deepEqual(selectModelProfile(current, current, grants), current);
  assert.deepEqual(selectModelProfile(grants[31], current, grants), grants[31]);
  assert.throws(() => validateModelGrants(['fixture-v1'] as unknown as ModelProfile[]), /Model profile required/);
});

test('evolution metadata requires a string policy identity and complete bounded model grants', () => {
  const policyDigest = 'a'.repeat(64);
  for (const valid of [{ policyDigest }, { policyDigest, allowedModelProfiles: [] }, { policyDigest, allowedModelProfiles: [next] }]) assert.doesNotThrow(() => validateEvolutionMetadata(valid));
  for (const invalid of [null, [], { policyDigest: [policyDigest] }, { policyDigest, allowedModels: ['fixture-v1'] }, { policyDigest, allowedModelProfiles: ['fixture-v1'] }, { policyDigest, allowedModelProfiles: [next, next] }, { policyDigest, allowedModelProfiles: [{ ...next, pricesPerMillion: { input: 1 } }] }]) {
    assert.throws(() => validateEvolutionMetadata(invalid as unknown as EvolutionMetadata));
  }
});
