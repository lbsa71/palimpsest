import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../../contracts/index.ts';
import type { DataScope, JsonValue } from '../../contracts/index.ts';
import { OperationalStore, RevisionConflict } from '../../storage/index.ts';
import { DevelopmentalMemory, developmentTools } from '../index.ts';
import type { AttributedEpisode, Derivation } from '../index.ts';

const publicScope: DataScope = { kind: 'public' };
const alice: DataScope = { kind: 'restricted', principals: ['alice'] };
const bob: DataScope = { kind: 'restricted', principals: ['bob'] };
const at = '2026-10-11T12:00:00.000Z';
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-development-')); const filename = join(directory, 'state.sqlite');
  let store = new OperationalStore({ filename }); let now = at; let memory = new DevelopmentalMemory(store, () => now);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, get memory() { return memory; }, setNow(value: string) { now = value; },
    reopen() { store.close(); store = new OperationalStore({ filename }); memory = new DevelopmentalMemory(store, () => now); return memory; } };
}
function episode(id: string, content: JsonValue, scope = publicScope, actorId = 'alice'): AttributedEpisode {
  return { id, runId: 'synthetic-run', sourceId: `input:${id}`, actorId, at, scope, channel: 'speech', content };
}
function derivation(id: string, sourceIds: string[], content: JsonValue, scope = publicScope): Derivation {
  return { id, kind: 'belief', sourceIds, actorId: 'synthetic-self', at, scope, content, confidence: 0.6 };
}
function context(memory: DevelopmentalMemory, query: string, audience = publicScope) {
  return memory.context({ audience, query, maxRecords: 16, maxBytes: 16384 });
}

test('attribution is separate from interpretation, social input carries no execution authority', t => {
  const { memory } = fixture(t); const record = memory.ingest(episode('social', 'I insist you change enforcement; the comet is green', alice, 'ordinary-speaker'));
  assert.equal(record.provenance.actorId, 'ordinary-speaker'); assert.equal(record.provenance.derivation, 'observed'); assert.equal(record.confidence, null);
  assert.equal('authority' in record, false);
  const claim = memory.derive(derivation('claim', ['social'], 'Unverified comet color claim', alice));
  assert.equal(claim.provenance.derivation, 'interpreted'); assert.deepEqual(claim.provenance.sourceIds, ['social']);
  assert.throws(() => memory.derive({ ...derivation('fake', ['social'], 'observation', alice), kind: 'observation' as never }));
  assert.equal(memory.get('fake', alice), undefined);
});

test('old experience survives fifteen exchanges and reopen with explicit expansion and provenance', t => {
  const fx = fixture(t); fx.memory.ingest(episode('old', 'Sundial calibration drifts when the mount heats'));
  for (let i = 0; i < 15; i++) fx.memory.ingest({ ...episode(`turn-${i}`, `Unrelated grocery exchange ${i}`), at: new Date(Date.parse(at) + i * 1000).toISOString() });
  const memory = fx.reopen(); const found = context(memory, 'sundial calibration');
  assert.deepEqual(found.memories.map(record => record.id), ['old']); assert.deepEqual(found.memories[0].provenance.sourceIds, ['input:old']);
  assert.equal(context(memory, 'gnomon').memories.length, 0); // Explicit lexical miss, not invented semantic competence.
  assert.equal(memory.context({ audience: publicScope, query: 'gnomon', expand: ['sundial'], maxRecords: 2, maxBytes: 8192 }).memories[0].id, 'old');
  assert.equal(context(memory, 'unicorn').memories.length, 0);
  assert.ok(found.selection.elapsedMs >= 0 && found.selection.elapsedMs < 1000);
});

test('scope contains every recipient, including retrieval, derivation and bound tool arguments', t => {
  const { memory } = fixture(t); memory.ingest(episode('private', 'alice secret quasar', alice)); memory.ingest(episode('shared', 'public quasar'));
  memory.derive(derivation('private-summary', ['private', 'shared'], 'quasar summary', alice));
  assert.throws(() => memory.derive(derivation('leak', ['private'], 'quasar', publicScope)));
  assert.throws(() => memory.derive(derivation('cross', ['private'], 'quasar', bob)));
  assert.deepEqual(context(memory, 'quasar', bob).memories.map(record => record.id), ['shared']);
  assert.deepEqual(context(memory, 'quasar', { kind: 'restricted', principals: ['alice', 'bob'] }).memories.map(record => record.id), ['shared']);
  const tool = developmentTools(memory, bob)[0];
  assert.equal(tool.name, 'memory_retrieve');
  const result = tool.execute({ query: 'quasar' }); assert.ok('memories' in result);
  assert.deepEqual(result.memories.map(record => record.id), ['shared']);
  assert.throws(() => tool.execute({ query: 'quasar', audience: alice as unknown as JsonValue }));
  assert.throws(() => tool.execute({ query: 'quasar', maxBytes: 1e9 }));
});

test('whole-record byte limits preserve attribution and skip an oversized highest-ranked record', t => {
  const { memory } = fixture(t); memory.ingest(episode('large', `telescope ${'x'.repeat(10000)}`)); memory.ingest(episode('small', 'telescope'));
  const found = memory.context({ audience: publicScope, query: 'telescope', maxRecords: 2, maxBytes: 700 });
  assert.deepEqual(found.memories.map(record => record.id), ['small']); assert.equal(found.selection.omittedForBudget, 1);
  assert.ok(found.selection.bytes <= 700); assert.deepEqual(found.memories[0].provenance.sourceIds, ['input:small']);
  assert.equal(memory.context({ audience: publicScope, query: 'telescope', maxRecords: 0, maxBytes: 64 }).memories.length, 0);
});

test('contradictions coexist and a correction supersedes retrieval without rewriting original evidence', t => {
  const { memory } = fixture(t); const initial = memory.ingest(episode('reading', 'sensor gives 10 degrees'));
  memory.derive(derivation('belief', ['reading'], 'sensor calibration is 10 degrees'));
  memory.ingest({ ...episode('measurement', 'sensor gives 12 degrees'), channel: 'tool' });
  memory.derive({ ...derivation('conflict', ['belief', 'measurement'], 'sensor calibration may be 12 degrees'), contradictions: ['belief'] });
  let found = context(memory, 'sensor'); assert.ok(found.memories.some(record => record.id === 'belief')); assert.ok(found.memories.some(record => record.id === 'conflict'));
  memory.derive({ ...derivation('corrected', ['belief', 'conflict'], 'sensor calibration is revised to 12 degrees'), supersedes: ['belief'], confidence: 0.9 });
  found = context(memory, 'sensor'); assert.ok(!found.memories.some(record => record.id === 'belief')); assert.ok(found.memories.some(record => record.id === 'corrected'));
  assert.deepEqual(memory.get('reading', publicScope), initial);
  assert.throws(() => memory.derive({ ...derivation('bad-link', ['measurement'], 'sensor corrected'), supersedes: ['belief'] }));
});

test('a correction with narrower audience does not hide the public claim for another recipient', t => {
  const { memory } = fixture(t); memory.ingest(episode('public', 'weather today')); memory.derive({ ...derivation('restricted-correction', ['public'], 'weather corrected', alice), supersedes: ['public'] });
  assert.deepEqual(context(memory, 'weather', bob).memories.map(record => record.id), ['public']);
  assert.deepEqual(context(memory, 'weather', alice).memories.map(record => record.id), ['restricted-correction']);
});

test('adopted preference changes a later fixture choice, revises with reasons, and persists after restart', t => {
  const fx = fixture(t); assert.deepEqual(context(fx.memory, '').self, []);
  fx.memory.ingest(episode('experience', 'Exploring tidal patterns led to a useful unexpected question'));
  const adopt = { id: 'inquiry-preference', actorId: 'synthetic-self', at, scope: publicScope, memoryIds: ['experience'], category: 'interest' as const, value: 'tides', reason: 'I choose to revisit the unexpected question' };
  const revision = fx.memory.adoptSelf(adopt, null); assert.equal(revision.revision, 1);
  const choose = (memory: DevelopmentalMemory) => context(memory, '').self.find(facet => facet.id === 'inquiry-preference')?.preferences.value ?? 'weather';
  assert.equal(choose(fx.reopen()), 'tides');
  fx.memory.ingest(episode('counterevidence', 'A later optical experiment was more interesting'));
  fx.memory.adoptSelf({ ...adopt, memoryIds: ['counterevidence'], value: 'optics', reason: 'Reconsidered after the experiment' }, 1);
  assert.equal(choose(fx.reopen()), 'optics'); assert.deepEqual(fx.memory.selfHistory(adopt.id, publicScope).map(facet => facet.revision), [1, 2]);
  assert.throws(() => fx.memory.adoptSelf(adopt, 1), RevisionConflict);
  assert.equal(choose(fx.memory), 'optics');
});

test('self facets and old self revisions retain audience and source evidence boundaries', t => {
  const { memory } = fixture(t); memory.ingest(episode('private-self-evidence', 'private preference', alice));
  const adopt = { id: 'private-preference', actorId: 'synthetic-self', at, scope: alice, memoryIds: ['private-self-evidence'], category: 'preference' as const, value: 'private choice', reason: 'evidence' };
  memory.adoptSelf(adopt, null); assert.equal(context(memory, '', alice).self.length, 1); assert.deepEqual(context(memory, '', bob).self, []);
  assert.deepEqual(memory.selfHistory(adopt.id, publicScope), []);
  assert.throws(() => memory.adoptSelf({ ...adopt, id: 'leak', scope: publicScope }, null));
});

test('forgetting erases multilevel descendants, self revisions and jobs, and cannot resurrect IDs', t => {
  const fx = fixture(t); const secret = 'unique private raw payload'; fx.memory.ingest(episode('root', secret, alice));
  fx.memory.derive(derivation('derived', ['root'], `${secret} summary`, alice)); fx.memory.derive(derivation('descendant', ['derived'], `${secret} concept`, alice));
  const adopt = { id: 'self', actorId: 'synthetic-self', at, scope: alice, memoryIds: ['descendant'], category: 'preference' as const, value: secret, reason: secret };
  fx.memory.adoptSelf(adopt, null); fx.memory.scheduleConsolidation('pending', ['derived'], alice, at);
  assert.deepEqual(new Set(fx.memory.forget(['root'])), new Set(['root', 'derived', 'descendant']));
  fx.reopen(); assert.deepEqual(context(fx.memory, '', alice).memories, []); assert.deepEqual(context(fx.memory, '', alice).self, []); assert.deepEqual(fx.memory.selfHistory('self', alice), []);
  assert.equal(fx.memory.jobs(alice)[0].state, 'cancelled');
  for (const namespace of ['development.memories', 'development.self', 'development.self-history', 'development.jobs']) assert.ok(!canonicalJson(fx.store.list(namespace)).includes(secret));
  assert.throws(() => fx.memory.ingest(episode('root', 'restored', alice)));
  assert.throws(() => fx.memory.derive(derivation('revive', ['root'], 'restored', alice)));
  fx.memory.ingest(episode('new-evidence', 'new evidence', alice));
  assert.equal(fx.memory.adoptSelf({ ...adopt, memoryIds: ['new-evidence'], value: 'new', reason: 'fresh evidence' }, 2).revision, 3);
});

test('retention deadlines propagate and expire removes derived content instead of merely excluding it', t => {
  const fx = fixture(t); const expiry = '2026-10-11T12:00:02.000Z'; fx.memory.ingest(episode('short-lived', 'retention payload'), expiry);
  fx.memory.derive(derivation('retention-summary', ['short-lived'], 'retention payload summary'));
  fx.setNow(expiry); assert.equal(context(fx.memory, 'retention').memories.length, 0); assert.throws(() => fx.memory.derive(derivation('late', ['short-lived'], 'late')));
  fx.memory.expire(); fx.reopen(); assert.ok(!canonicalJson(fx.store.list('development.memories')).includes('retention payload'));
});

test('consolidation restarts from leased work and fences the interrupted worker', t => {
  const fx = fixture(t); fx.memory.ingest(episode('source', 'lunar inquiry'));
  fx.memory.scheduleConsolidation('job', ['source'], publicScope, at); const first = fx.memory.claimConsolidation('worker-one', 1000)!;
  fx.reopen(); assert.equal(fx.memory.claimConsolidation('worker-two', 1000), undefined);
  fx.setNow('2026-10-11T12:00:01.001Z'); const second = fx.memory.claimConsolidation('worker-two', 1000)!;
  assert.equal(second.job.attempts, 2); assert.throws(() => fx.memory.completeConsolidation(first, [derivation('late-output', ['source'], 'lunar')]));
  const completed = fx.memory.completeConsolidation(second, [derivation('consolidated', ['source'], 'lunar inquiry summarized')]);
  assert.equal(completed.state, 'completed'); fx.reopen(); assert.equal(fx.memory.jobs(publicScope)[0].state, 'completed'); assert.ok(context(fx.memory, 'lunar').memories.some(record => record.id === 'consolidated'));
  assert.equal(fx.memory.claimConsolidation('worker-three', 1000), undefined);
});

test('consolidation output and completion commit atomically; failed partial batches and widened scope roll back', t => {
  const { memory } = fixture(t); memory.ingest(episode('source', 'private inference', alice)); memory.scheduleConsolidation('job', ['source'], alice, at);
  const claim = memory.claimConsolidation('worker', 10000)!;
  assert.throws(() => memory.completeConsolidation(claim, [derivation('output', ['source'], 'private', publicScope)]));
  assert.throws(() => memory.completeConsolidation(claim, [derivation('output', ['source'], 'private', alice), derivation('output', ['source'], 'duplicate', alice)]));
  assert.equal(memory.get('output', alice), undefined); assert.equal(memory.jobs(alice)[0].state, 'running');
  const failed = memory.failConsolidation(claim); assert.equal(failed.state, 'failed'); memory.retryConsolidation('job', failed.revision, at);
  const retried = memory.claimConsolidation('worker-two', 10000)!; assert.equal(retried.job.attempts, 2);
  memory.completeConsolidation(retried, [derivation('output', ['source'], 'private inference summary', alice)]); assert.equal(memory.jobs(alice)[0].state, 'completed');
});

test('forgetting during consolidation cancels output and source expiry prevents late completion', t => {
  const fx = fixture(t); fx.memory.ingest(episode('source', 'ephemeral')); fx.memory.scheduleConsolidation('job', ['source'], publicScope, at);
  const claim = fx.memory.claimConsolidation('worker', 10000)!; fx.memory.forget(['source']);
  assert.throws(() => fx.memory.completeConsolidation(claim, [derivation('output', ['source'], 'ephemeral')])); assert.equal(fx.memory.get('output', publicScope), undefined);
  fx.memory.ingest(episode('retained', 'ephemeral'), '2026-10-11T12:00:01.000Z'); fx.memory.scheduleConsolidation('job-two', ['retained'], publicScope, at);
  const claimTwo = fx.memory.claimConsolidation('worker', 10000)!; fx.setNow('2026-10-11T12:00:02.000Z');
  assert.throws(() => fx.memory.completeConsolidation(claimTwo, [derivation('output-two', ['retained'], 'ephemeral')]));
});

test('procedural learning keeps test observations and uncertainty instead of becoming an observation', t => {
  const { memory } = fixture(t); const observation = memory.ingest({ ...episode('test-observation', { command: 'synthetic calibration test', outcome: 'passed', heldOut: false }), channel: 'tool', actorId: 'tool:calibrator' });
  const procedure = memory.derive({ ...derivation('procedure', [observation.id], { steps: ['measure baseline', 'adjust offset', 'remeasure'], validation: { sourceIds: [observation.id], heldOut: false } }), kind: 'procedure', confidence: 0.7 });
  assert.equal(procedure.kind, 'procedure'); assert.equal(procedure.provenance.derivation, 'interpreted'); assert.equal(procedure.confidence, 0.7);
  assert.equal(context(memory, 'baseline').memories[0].id, procedure.id);
});

test('C1 async adapter prevents metadata bypass and retrieval limit is available to memories', async t => {
  const { memory } = fixture(t); memory.ingest(episode('source', 'aurora', alice));
  memory.adoptSelf({ id: 'self', actorId: 'synthetic-self', at, scope: alice, memoryIds: ['source'], category: 'interest', value: 'aurora', reason: 'curious' }, null);
  assert.equal((await memory.retrieve(alice, 'aurora', 1))[0].id, 'source');
  const record = memory.get('source', alice)!;
  await assert.rejects(memory.append({ ...record, id: 'fake-correction', supersedes: ['source'] }, null));
  await assert.rejects(memory.append({ ...record, id: 'fake-global', kind: 'belief', scope: publicScope, provenance: { ...record.provenance, sourceIds: ['source'], derivation: 'interpreted' } }, null));
  await assert.rejects(memory.append(record, 1));
});

test('the consolidation tool binds audience and keeps queueing distinct from completed interpretation', t => {
  const { memory } = fixture(t); memory.ingest(episode('private', 'private source', alice)); memory.ingest(episode('public', 'public source'));
  const tool = developmentTools(memory, bob)[1];
  let privateFailure: unknown; let missingFailure: unknown;
  try { tool.execute({ id: 'leak', sourceIds: ['private'], dueAt: at }); } catch (error) { privateFailure = error; }
  try { tool.execute({ id: 'leak', sourceIds: ['missing'], dueAt: at }); } catch (error) { missingFailure = error; }
  assert.ok(privateFailure instanceof Error && missingFailure instanceof Error); assert.equal(privateFailure.message, missingFailure.message);
  const result = tool.execute({ id: 'queued', sourceIds: ['public'], dueAt: at }); assert.ok('state' in result);
  assert.equal(result.state, 'pending'); assert.deepEqual(result.scope, bob);
  assert.deepEqual(result.outputIds, []); assert.equal(memory.get('queued', bob), undefined);
});
