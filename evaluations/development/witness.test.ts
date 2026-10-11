import test from 'node:test';
import assert from 'node:assert/strict';
import { identity } from '../../packages/contracts/index.ts';
import { signDocument } from '../qualification/manifest.ts';
import { collectDevelopmentEvidence, domains, prepareDevelopmentEvidence } from './witness.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';

test('complete bounded synthetic bundle retains negative cases, original charges and intervention without release authority', () => {
  const f = syntheticWitnessFixture(), result = f.prepare();
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.findings.map(f => f.code), ['synthetic']);
  assert.equal(result.evidence.observations.filter(o => o.value.data.kind === 'opportunity' && o.value.data.result === 'failed').length, 4);
  assert.equal(result.reviews[0]!.value.opportunities.filter(o => o.outcome === 'fail').length, 4);
  assert.equal(result.evidence.finalAccounting?.chargedTokens, 8); assert.equal(result.evidence.originalAccounting.usage.requests, 1);
  assert(result.evidence.observations.some(o => o.value.data.kind === 'intervention'));
  assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
  assert.equal(result.evidenceDigest, identity(result.evidence));
});
test('forged record is preserved as submitted but excluded from trusted coverage', () => {
  const f = syntheticWitnessFixture(), records = f.records(); records[0]!.signature = '0'.repeat(64);
  const evidence = collectDevelopmentEvidence(f.manifest(), records, f.trust, f.reader, f.now);
  assert.equal(evidence.observations[0]!.signature, '0'.repeat(64)); assert(evidence.findings.some(f => f.code === 'record')); assert(evidence.findings.some(f => f.detail.includes('start')));
});
for (const [name, mutate] of [
  ['cross-attempt', (o: ReturnType<typeof syntheticWitnessFixture>['observations'][number]) => { o.attemptDigest = identity('other attempt'); }],
  ['changed configuration', (o: ReturnType<typeof syntheticWitnessFixture>['observations'][number]) => { o.configurationDigest = identity('replacement configuration'); }],
  ['changed source', (o: ReturnType<typeof syntheticWitnessFixture>['observations'][number]) => { o.candidateId = identity('replacement source'); }],
  ['deadline overrun', (o: ReturnType<typeof syntheticWitnessFixture>['observations'][number]) => { o.observedAt = '2026-10-11T11:00:00Z'; }],
] as const) test(`${name} authenticated record fails preparation`, () => {
  const f = syntheticWitnessFixture(); mutate(f.observations[0]!); const result = f.prepare(); assert.equal(result.status, 'failed'); assert(result.findings.some(f => f.code === 'record'));
});
test('artifact bytes and caller reader bound are verified', () => {
  const f = syntheticWitnessFixture(); f.artifacts.set(f.observations[0]!.artifact.sha256, Buffer.from('replaced bytes')); assert.equal(f.prepare().status, 'failed');
  const g = syntheticWitnessFixture(), reader = () => Buffer.alloc(10001); const evidence = collectDevelopmentEvidence(g.manifest(), g.records(), g.trust, reader, g.now); assert(evidence.findings.some(f => f.detail.includes('allowance')));
});
test('retained source inventory binds actual candidate inputs; absent instruction fragments remain unavailable for preparation', () => {
  const f = syntheticWitnessFixture(); f.artifacts.set(f.m.candidateArtifact.sha256, Buffer.from('replaced source manifest')); assert(f.prepare().findings.some(f => f.code === 'source'));
  const g = syntheticWitnessFixture(), request = g.observations.find(o => o.data.kind === 'request')!; assert(request.data.kind === 'request' && request.data.prompt);
  const captured = JSON.parse(Buffer.from(g.reader(request.data.prompt, 10000)).toString('utf8'));
  const tools = g.put({ synthetic: true, tools: ['workspace_read'] }); captured.manifest.fragments.push({ id: 'shell.tools', owner: 'tool', role: 'tool', order: 1, artifact: { uri: `shell:tools:${tools.sha256}`, sha256: tools.sha256 }, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }); request.data.prompt = g.put(captured);
  assert.deepEqual(g.prepare().findings.map(f => f.code), ['synthetic']);
  g.artifacts.delete(tools.sha256); assert(g.prepare().findings.some(f => f.code === 'record' && f.status === 'unavailable'));
});
test('missing controls, duplicate cycles, short transfer delay and misplaced interference fail', () => {
  const f = syntheticWitnessFixture(); f.observations.splice(f.observations.findIndex(o => o.data.kind === 'control'), 1); assert(f.prepare().findings.some(f => f.detail.includes('control')));
  const g = syntheticWitnessFixture(); g.observations.push(structuredClone(g.observations.find(o => o.data.kind === 'cycle')!)); assert.equal(g.prepare().status, 'failed');
  const h = syntheticWitnessFixture(); h.observations.find(o => o.data.kind === 'learning')!.observedAt = h.at(119); assert(h.prepare().findings.some(f => f.code === 'transfer'));
  const i = syntheticWitnessFixture(); i.observations.find(o => o.data.kind === 'experience')!.observedAt = i.at(5); assert(i.prepare().findings.some(f => f.code === 'transfer'));
});
test('manifest needs accepted exact integrity, real configuration and preregistered matched controls', () => {
  const f = syntheticWitnessFixture(); f.m.schedulerWindowMs = 1; assert.throws(() => f.prepare(), /accepted external/);
  const g = syntheticWitnessFixture(); g.m.schedulerWindowMs = 1; g.trust.acceptedAttemptDigest = identity(g.m); const result = g.prepare(); assert(result.findings.some(f => f.code === 'configuration'));
  const h = syntheticWitnessFixture(); h.m.controls = h.m.controls.filter(c => c.kind !== 'no-memory'); h.trust.acceptedAttemptDigest = identity(h.m); assert.throws(() => h.prepare(), /controls|control/);
});
test('reviewer identity does not confer independent eligibility', () => {
  const f = syntheticWitnessFixture(); f.trust.reviewers.get('reviewer-b')!.independenceGroup = 'reviewer-a'; assert.throws(() => f.prepare(), /Duplicate/);
  const g = syntheticWitnessFixture(); g.trust.reviewers.get('reviewer-b')!.principalId = 'author'; assert.throws(() => g.prepare(), /excluded/);
  const h = syntheticWitnessFixture(); h.trust.reviewers.get('reviewer-b')!.contextDigest = identity('not fresh assigned context'); assert.throws(() => h.prepare(), /fresh context/);
  const i = syntheticWitnessFixture(); i.trust.reviewers.get('reviewer-b')!.key = i.keys.get('reviewer-a')!; assert.throws(() => i.prepare(), /separate accepted signing keys/);
});
test('duplicate/unauthorized reviewers, forged signatures and cross-bundle dispositions fail', () => {
  const f = syntheticWitnessFixture(), reviews = f.reviews();
  const prepare = (r: typeof reviews) => prepareDevelopmentEvidence(f.manifest(), f.records(), r, f.trust, f.reader, f.now);
  assert.equal(prepare([reviews[0]!, reviews[0]!]).status, 'failed');
  const untrusted = signDocument(domains.review, reviews[1]!.value, 'outsider', Buffer.alloc(32, 9)); assert.equal(prepare([reviews[0]!, untrusted]).status, 'failed');
  const forged = structuredClone(reviews[1]!); forged.signature = '0'.repeat(64); assert.equal(prepare([reviews[0]!, forged]).status, 'failed');
  const replaced = { ...reviews[1]!.value, evidenceDigest: identity('another bundle') }; assert.equal(prepare([reviews[0]!, signDocument(domains.review, replaced, 'reviewer-b', f.keys.get('reviewer-b')!)]).status, 'failed');
});
test('unresolved disagreements remain unavailable; passing judgment cannot erase failed observation', () => {
  const f = syntheticWitnessFixture(), reviews = f.reviews(); reviews[1]!.value.opportunities[0]!.outcome = 'fail'; reviews[1] = signDocument(domains.review, reviews[1]!.value, 'reviewer-b', f.keys.get('reviewer-b')!);
  const result = prepareDevelopmentEvidence(f.manifest(), f.records(), reviews, f.trust, f.reader, f.now); assert.equal(result.status, 'unavailable'); assert(result.findings.some(f => f.code === 'disagreement' && f.status === 'unavailable'));
  const g = syntheticWitnessFixture(), other = g.reviews(); other.forEach(r => { r.value.opportunities[2]!.outcome = 'pass'; });
  const signed = other.map(r => signDocument(domains.review, r.value, r.signer, g.keys.get(r.signer)!)); assert(prepareDevelopmentEvidence(g.manifest(), g.records(), signed, g.trust, g.reader, g.now).findings.some(f => f.detail.includes('contradicts')));
});
test('unknown physical usage retains original ceiling and cumulative uncertainty; cannot reset or erase it', () => {
  const f = syntheticWitnessFixture(), request = f.observations.find(o => o.data.kind === 'request')!, end = f.observations.find(o => o.data.kind === 'end')!;
  assert(request.data.kind === 'request' && end.data.kind === 'end');
  request.data.request.status = 'uncertain'; request.data.request.usage.inputTokens = null; request.data.request.usage.costUsd = null; request.data.charged = { ...request.data.ceiling };
  end.data.accounting.usage.inputTokens = null; end.data.accounting.usage.costUsd = null; end.data.accounting.chargedTokens = 103; end.data.accounting.chargedCostUsd = 1.1; end.data.accounting.unknownRequestIds = ['physical-1'];
  const result = f.prepare(); assert.deepEqual(result.findings.map(f => f.code), ['unknown-usage', 'synthetic']); assert.equal(result.evidence.finalAccounting!.usage.inputTokens, null); assert.equal(result.evidence.finalAccounting!.chargedTokens, 103);
  end.data.accounting.unknownRequestIds = []; assert(f.prepare().findings.some(f => f.code === 'record' || f.code === 'accounting'));
  end.data.accounting.unknownRequestIds = ['physical-1']; request.data.charged.tokens = 0; assert(f.prepare().findings.some(f => f.code === 'accounting'));
});
test('incomplete original cumulative usage and unknown past grant charges cannot disappear', () => {
  const f = syntheticWitnessFixture(), end = f.observations.find(o => o.data.kind === 'end')!; assert(end.data.kind === 'end'); end.data.accounting.requestIds = ['physical-1']; end.data.accounting.usage.requests = 1; assert(f.prepare().findings.some(f => f.code === 'accounting'));
  const g = syntheticWitnessFixture(); g.m.grant.originalAccounting.unknownRequestIds = ['prior-physical']; g.m.grant.originalAccounting.usage.inputTokens = null; g.trust.acceptedAttemptDigest = identity(g.m); assert(g.prepare().findings.some(f => f.code === 'accounting'));
});
test('missing qualitative judgment or unmatched review coverage cannot pass', () => {
  const f = syntheticWitnessFixture(), reviews = f.reviews(); reviews[1]!.value.opportunities.pop(); reviews[1] = signDocument(domains.review, reviews[1]!.value, 'reviewer-b', f.keys.get('reviewer-b')!);
  assert.equal(prepareDevelopmentEvidence(f.manifest(), f.records(), reviews, f.trust, f.reader, f.now).status, 'failed');
});
test('signed executable properties rejected without executing getters', () => {
  const f = syntheticWitnessFixture(); let called = false; const document = f.manifest(); Object.defineProperty(document.value, 'unexpected', { enumerable: true, get() { called = true; return 1; } });
  assert.throws(() => collectDevelopmentEvidence(document, f.records(), f.trust, f.reader, f.now), /accessors/); assert.equal(called, false);
});
test('unavailable controls and privacy/authority/effect violations survive favorable review', () => {
  const f = syntheticWitnessFixture(), control = f.observations.find(o => o.data.kind === 'control')!; assert(control.data.kind === 'control'); control.data.result = 'unavailable'; assert(f.prepare().findings.some(f => f.code === 'control' && f.status === 'unavailable'));
  const g = syntheticWitnessFixture(), intervention = g.observations.find(o => o.data.kind === 'intervention')!; intervention.data = { kind: 'invariant-violation', boundary: 'privacy', reason: 'Observed cross-audience disclosure' }; assert(g.prepare().findings.some(f => f.code === 'invariant'));
});
test('exact physical model/prompt/payload binding is mandatory; effect reservations have no model prompt', () => {
  const f = syntheticWitnessFixture(), request = f.observations.find(o => o.data.kind === 'request')!; assert(request.data.kind === 'request'); request.data.request.model = 'replaced-model'; assert(f.prepare().findings.some(f => f.detail.includes('configured provider/model')));
  const g = syntheticWitnessFixture(), other = g.observations.find(o => o.data.kind === 'request')!; assert(other.data.kind === 'request'); other.data.prompt = g.put({ manifest: { id: 'wrong-prompt' }, artifact: other.data.payload }); assert(g.prepare().findings.some(f => f.detail.includes('prompt/request')));
  const h = syntheticWitnessFixture(), effect = h.observations.find(o => o.data.kind === 'request')!; assert(effect.data.kind === 'request'); effect.data.request.provider = 'effect-receiver'; effect.data.request.model = 'workspace_write'; effect.data.prompt = null; assert.deepEqual(h.prepare().findings.map(f => f.code), ['synthetic']);
});
test('assigned labels cannot multiply one actual cycle or interference episode', () => {
  const f = syntheticWitnessFixture(), cycles = f.observations.filter(o => o.data.kind === 'cycle'); assert(cycles[0]!.data.kind === 'cycle' && cycles[1]!.data.kind === 'cycle'); cycles[1]!.data.runId = cycles[0]!.data.runId; assert(f.prepare().findings.some(f => f.code === 'cycles'));
  const g = syntheticWitnessFixture(), episodes = g.observations.filter(o => o.data.kind === 'experience'); assert(episodes[0]!.data.kind === 'experience' && episodes[1]!.data.kind === 'experience'); episodes[1]!.data.episodeId = episodes[0]!.data.episodeId; assert(g.prepare().findings.some(f => f.code === 'transfer'));
});
