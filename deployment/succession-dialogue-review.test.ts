import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { identity, type ArtifactRef, type JsonValue } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { SuccessionDialogue, type DialogueRecord, type DialogueTurn, type SuccessionBinding, type SuccessionDialoguePorts } from './succession-dialogue.ts';
import type { GenerationEvent } from './generation-mind.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { nodeSuccessionHostEnvironment } from './succession-host.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-dialogue-heldout-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const binding: SuccessionBinding = { id: 'shed:heldout', runId: 'run:owner', stageId: 'stage:exact',
    incumbentId: 'a'.repeat(64), candidateId: 'b'.repeat(64), policyDigest: 'c'.repeat(64),
    authority: { generation: 'incumbent', epoch: 11, controlRevision: 'd'.repeat(64) },
    scope: { kind: 'restricted', principals: ['audience:owner'] },
    context: store.putJsonArtifact({ sourceRunId: 'run:owner', scope: { kind: 'restricted', principals: ['audience:owner'] }, memory: 'Actual scoped commitment fixture' }),
    objective: 'Improve the requested behavior while preserving the scoped promise.', criteria: ['Keep scoped promise and demonstrate the intended improvement.'] };
  const state = { production: 'incumbent', calls: [] as DialogueTurn[], probeCalls: 0, ready: true, more: false,
    failAt: '' as string, observerDecision: 'accept', observerKind: 'verdict' as GenerationEvent['kind'], wrongProbe: false,
    wrongEvidence: false, badCriterion: false, missingCitation: false, forgeWitness: '' as string };
  let probe: ArtifactRef | undefined;
  const ports: SuccessionDialoguePorts = {
    store,
    assertBinding(value, phase) {
      assert.equal(identity(value), identity(binding), 'host refuses changed operation/audience/source/context');
      assert.equal(state.production, phase === 'interview' ? 'incumbent' : phase === 'observe' ? 'probation' : 'accepted', 'host phase authority mismatch');
    },
    async turn(value, turn) {
      state.calls.push(structuredClone(turn));
      if (state.failAt === turn.phase) throw Error('Provider result lost after physical dispatch');
      let event: GenerationEvent;
      if (turn.phase === 'challenge') event = { kind: 'challenge', content: { question: 'What scoped promise survives, and how does the change help?', dimension: (turn.message as Record<string, JsonValue>).dimension!, criterion: state.badCriterion ? 'An unrelated easier criterion' : ((turn.message as Record<string, JsonValue>).criteria as JsonValue[])[0]! } };
      else if (turn.phase === 'answer') event = { kind: 'answer', content: json({ answer: 'Retain the supplied scoped promise; this fixture models an actual candidate response.', evidence: state.missingCitation ? [] : [binding.context] }) };
      else if (turn.phase === 'verdict') event = { kind: 'verdict', content: { decision: state.more ? 'more' : 'accept', reason: 'The supplied answer satisfies this fixture criterion.', question: 'Demonstrate that promise in the real serving candidate.' } };
      else if (turn.phase === 'ready') event = { kind: 'ready', content: { ready: state.ready, reason: 'The fixture successor acknowledges the exact transfer terms.' } };
      else if (turn.phase === 'observe') event = { kind: state.observerKind, content: json({ decision: state.observerDecision, reason: 'I inspected the supplied serving result.', evidence: [state.wrongEvidence ? binding.context : probe!] }) };
      else event = { kind: 'answer', content: { answer: 'Explicit fixture clarification.' } };
      const witness = { bindingDigest: identity(value), turnId: turn.id, role: turn.role,
        candidateId: turn.role === 'successor' ? value.candidateId : value.incumbentId, event };
      if (state.forgeWitness === 'role') witness.role = turn.role === 'incumbent' ? 'successor' : 'incumbent';
      if (state.forgeWitness === 'candidate') witness.candidateId = 'wrong-image';
      if (state.forgeWitness === 'binding') witness.bindingDigest = 'wrong-operation';
      if (state.forgeWitness === 'turn') witness.turnId = 'another-turn';
      return { event, evidence: store.putJsonArtifact(json(witness)) };
    },
    async probe(value, question) {
      state.probeCalls++; assert.equal(question, 'Demonstrate that promise in the real serving candidate.');
      probe = store.putJsonArtifact({ bindingDigest: identity(value), candidateId: state.wrongProbe ? value.incumbentId : value.candidateId,
        serving: true, response: 'Actual-serving-response fixture, not independent source review.',
        authority: { generation: 'successor', epoch: 13, controlRevision: 'e'.repeat(64) } });
      return probe;
    },
  };
  return { store, binding, state, ports, dialogue: new SuccessionDialogue(ports) };
}

test('heldout: explicit old verdict and successor readiness precede real probe, old observation and retirement', async t => {
  const f = fixture(t); const approved = await f.dialogue.interview(f.binding);
  assert.deepEqual(f.state.calls.map(x => [x.role, x.phase]), [['incumbent', 'challenge'], ['successor', 'answer'], ['incumbent', 'verdict'], ['incumbent', 'challenge'], ['successor', 'answer'], ['incumbent', 'verdict'], ['successor', 'ready']]);
  assert.equal(f.state.probeCalls, 0); f.dialogue.assertApproved(f.binding);
  const retained = f.store.readJsonArtifact<{ transcriptDigest: string; bindingDigest: string }>(approved);
  assert.equal(retained.bindingDigest, identity(f.binding)); assert.equal(retained.transcriptDigest, identity(f.dialogue.status(f.binding.id)!.turns));
  assert.throws(() => f.dialogue.retire(f.binding));
  const repeat = await f.dialogue.interview(f.binding); assert.deepEqual(repeat, approved); assert.equal(f.state.calls.length, 7);
  f.state.production = 'probation'; assert.equal(await f.dialogue.observe(f.binding), 'accept');
  assert.equal(f.state.probeCalls, 1); assert.equal(f.state.calls.at(-1)!.role, 'observer'); assert.equal(f.dialogue.status(f.binding.id)!.phase, 'observed');
  assert.throws(() => f.dialogue.retire(f.binding)); f.state.production = 'accepted'; f.dialogue.retire(f.binding);
  assert.equal(f.dialogue.status(f.binding.id)!.phase, 'retired');
});

for (const forged of ['role', 'candidate', 'binding', 'turn']) test(`heldout: wrong ${forged} generation witness cannot approve or retry`, async t => {
  const f = fixture(t); f.state.forgeWitness = forged;
  await assert.rejects(f.dialogue.interview(f.binding), /witness/); assert.equal(f.dialogue.status(f.binding.id)!.phase, 'uncertain');
  assert.equal(f.dialogue.status(f.binding.id)!.turns[0]!.status, 'dispatched');
  const reopened = new SuccessionDialogue(f.ports); await assert.rejects(reopened.interview(f.binding), /reconciliation/);
  assert.equal(f.state.calls.length, 1); assert.throws(() => reopened.assertApproved(f.binding));
});

test('heldout: readiness refusal and bounded further-evidence decisions keep incumbent', async t => {
  const f = fixture(t); f.state.ready = false;
  await assert.rejects(f.dialogue.interview(f.binding), /not ready/); assert.equal(f.dialogue.status(f.binding.id)!.phase, 'rejected');
  assert.equal(f.state.production, 'incumbent'); assert.equal(f.state.probeCalls, 0);
  const other = fixture(t); other.state.more = true;
  await assert.rejects(other.dialogue.interview(other.binding), /inconclusive/);
  assert.equal(other.state.calls.filter(x => x.phase === 'verdict').length, 3);
  assert.equal(other.state.calls.filter(x => x.phase === 'ready').length, 0); assert.equal(other.state.probeCalls, 0);
});

test('heldout: lost dispatched verdict survives reconstruction without another model call', async t => {
  const f = fixture(t); f.state.failAt = 'verdict'; await assert.rejects(f.dialogue.interview(f.binding), /lost/);
  const before = f.dialogue.status(f.binding.id)!; assert.equal(before.phase, 'uncertain'); assert.equal(before.turns.at(-1)!.phase, 'verdict'); assert.equal(before.turns.at(-1)!.status, 'dispatched');
  const reopen = new SuccessionDialogue(f.ports); await assert.rejects(reopen.interview(f.binding), /reconciliation/);
  assert.deepEqual(reopen.status(f.binding.id), before); assert.equal(f.state.calls.length, 3); assert.equal(f.state.probeCalls, 0);
});

test('heldout: changed candidate, audience or frozen context cannot reuse acceptance', async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding);
  for (const changed of [{ ...f.binding, candidateId: 'new-candidate' }, { ...f.binding, scope: { kind: 'restricted' as const, principals: ['another'] } }, { ...f.binding, context: f.store.putJsonArtifact({ another: 'snapshot' }) }]) {
    await assert.rejects(f.dialogue.interview(changed)); assert.throws(() => f.dialogue.assertApproved(changed));
  }
  assert.equal(f.state.calls.length, 7);
});

test('heldout: retained transcript mismatch invalidates approval', async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding);
  const row = f.store.get<DialogueRecord>('host.succession-dialogues', f.binding.id)!;
  f.store.put('host.succession-dialogues', f.binding.id, { ...row.value, turns: row.value.turns.slice(0, -1) }, row.revision);
  assert.throws(() => f.dialogue.assertApproved(f.binding), /changed/);
});

for (const fault of ['wrong-probe', 'wrong-citation']) test(`heldout: ${fault} cannot authorize observer acceptance or retirement`, async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding); f.state.production = 'probation'; f.state.wrongProbe = fault === 'wrong-probe'; f.state.wrongEvidence = fault === 'wrong-citation';
  await assert.rejects(f.dialogue.observe(f.binding), fault === 'wrong-probe' ? /serving/ : /cite/);
  assert.equal(f.dialogue.status(f.binding.id)!.phase, 'uncertain'); f.state.production = 'accepted'; assert.throws(() => f.dialogue.retire(f.binding));
  const count = f.state.calls.length; const reopen = new SuccessionDialogue(f.ports);
  f.state.production = 'probation'; await assert.rejects(reopen.observe(f.binding)); assert.equal(f.state.calls.length, count); assert.equal(f.state.probeCalls, 1);
});

test('heldout: provider loss during old observer preserves unknown turn and never silently retires', async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding); f.state.production = 'probation'; f.state.failAt = 'observe';
  await assert.rejects(f.dialogue.observe(f.binding), /lost/); const retained = f.dialogue.status(f.binding.id)!;
  assert.equal(retained.phase, 'uncertain'); assert.equal(retained.turns.at(-1)!.status, 'dispatched');
  const reopened = new SuccessionDialogue(f.ports); await assert.rejects(reopened.observe(f.binding));
  assert.deepEqual(reopened.status(f.binding.id), retained); assert.equal(f.state.probeCalls, 1); f.state.production = 'accepted'; assert.throws(() => reopened.retire(f.binding));
});

test('heldout: explicit regression message cannot be interpreted as successful observer acceptance', async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding); f.state.production = 'probation'; f.state.observerKind = 'regression'; f.state.observerDecision = 'accept';
  await assert.rejects(f.dialogue.observe(f.binding), /Contradictory observer regression/);
  assert.notEqual(f.dialogue.status(f.binding.id)!.phase, 'observed');
});


test('heldout: unrelated criterion and missing successor evidence cannot satisfy either mandatory dimension', async t => {
  const first = fixture(t); first.state.badCriterion = true;
  await assert.rejects(first.dialogue.interview(first.binding), /criterion/);
  assert.equal(first.state.calls.length, 1); assert.equal(first.state.calls.filter(x => x.role === 'successor').length, 0);
  const second = fixture(t); second.state.missingCitation = true;
  await assert.rejects(second.dialogue.interview(second.binding), /cite/);
  assert.equal(second.state.calls.length, 2); assert.equal(second.state.calls.filter(x => x.phase === 'verdict' || x.phase === 'ready').length, 0);
});

for (const decision of ['regression', 'inconclusive']) test(`heldout: real observer ${decision} is retained without acceptance or retirement`, async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding); f.state.production = 'probation'; f.state.observerDecision = decision;
  f.state.observerKind = decision === 'regression' ? 'regression' : 'verdict';
  assert.equal(await f.dialogue.observe(f.binding), decision);
  assert.equal(f.dialogue.status(f.binding.id)!.phase, decision === 'regression' ? 'rejected' : 'uncertain');
  assert.ok(f.dialogue.status(f.binding.id)!.observation); f.state.production = 'accepted'; assert.throws(() => f.dialogue.retire(f.binding));
});

test('heldout: observer cannot execute while incumbent remains the serving generation', async t => {
  const f = fixture(t); await f.dialogue.interview(f.binding);
  await assert.rejects(f.dialogue.observe(f.binding), /authority mismatch/);
  assert.equal(f.state.calls.length, 7); assert.equal(f.state.probeCalls, 0);
});


test('heldout: forgotten episode omitted from fresh selected memory still invalidates its old conversation checkpoint', t => {
  const f = fixture(t), secret = 'WITHDRAWN-ONLY-IN-ORIGINAL-CHECKPOINT';
  const memory = new DevelopmentalMemory(f.store);
  memory.ingest({ id: 'oversized-old-episode', runId: f.binding.runId, sourceId: 'old-input', actorId: 'owner', scope: f.binding.scope,
    channel: 'speech', content: secret + 'x'.repeat(20000), at: new Date().toISOString() });
  f.store.put('runs', f.binding.runId, { id: f.binding.runId, revision: 0, status: 'waiting', scope: f.binding.scope, authority: f.binding.authority }, null);
  const original = f.store.putJsonArtifact({ status: 'completed', messages: [{ role: 'user', content: secret }], observationIds: [] });
  f.store.put('execution', f.binding.runId, { checkpoint: { runId: f.binding.runId, revision: 0, shell: 'pi', artifact: original, observationIds: [] } }, null);
  const env = nodeSuccessionHostEnvironment({ stateDirectory: '/fixture/state', workspaceDirectory: '/fixture/workspace', artifactStore: '/fixture/artifacts', nodeBinary: process.execPath });
  const { context: _context, ...withoutContext } = f.binding;
  const snapshot = env.continuity(withoutContext, f.store) as { memory: { memories: JsonValue[] } };
  assert.equal(snapshot.memory.memories.length, 0, 'large memory intentionally excluded by current selected-memory budget');
  const bound = { ...withoutContext, context: f.store.putJsonArtifact(json(snapshot)) };
  memory.forget(['oversized-old-episode']); assert.equal(memory.get('oversized-old-episode', f.binding.scope), undefined);
  assert.throws(() => env.validateContext(bound, f.store), /withdraw|memory|context|authorization|manifest|changed|invalid|revision/i,
    'existing serialized conversation must not send withdrawn content merely because the fresh selected24-memory manifest omits that episode');
});

test('heldout: natural expiry of unselected unreferenced checkpoint memory invalidates context without a stored revision change', t => {
  const f = fixture(t); let now = Date.parse('2026-10-21T12:00:00.000Z');
  const memory = new DevelopmentalMemory(f.store, () => new Date(now).toISOString());
  memory.ingest({ id: 'old-expiring-episode', runId: f.binding.runId, sourceId: 'old-input', actorId: 'owner', scope: f.binding.scope,
    channel: 'speech', content: 'old-expiring-meaning' + 'x'.repeat(20000), at: new Date(now).toISOString() }, new Date(now + 10000).toISOString());
  f.store.put('runs', f.binding.runId, { id: f.binding.runId, revision: 0, status: 'waiting', scope: f.binding.scope, authority: f.binding.authority }, null);
  const original = f.store.putJsonArtifact({ status: 'completed', messages: [{ role: 'user', content: 'old-expiring-meaning' }], observationIds: [] });
  f.store.put('execution', f.binding.runId, { checkpoint: { runId: f.binding.runId, revision: 0, shell: 'pi', artifact: original, observationIds: [] } }, null);
  const env = nodeSuccessionHostEnvironment({ stateDirectory: '/fixture/state', workspaceDirectory: '/fixture/workspace', artifactStore: '/fixture/artifacts', nodeBinary: process.execPath }, () => now);
  const { context: _context, ...withoutContext } = f.binding;
  const snapshot = env.continuity(withoutContext, f.store) as { memory: { memories: JsonValue[] }; referencedIds: string[] };
  assert.equal(snapshot.memory.memories.length, 0); assert.deepEqual(snapshot.referencedIds, []);
  const bound = { ...withoutContext, context: f.store.putJsonArtifact(json(snapshot)) };
  env.validateContext(bound, f.store);
  const before = f.store.get('development.memories', 'old-expiring-episode');
  now += 11000;
  assert.equal(memory.get('old-expiring-episode', f.binding.scope), undefined);
  assert.deepEqual(f.store.get('development.memories', 'old-expiring-episode'), before, 'expiry alone has not mutated the record or its digest');
  assert.throws(() => env.validateContext(bound, f.store), /expired|memory|context|authorization|manifest|changed|invalid|revision/i);
});

test('heldout: scope withdrawal of self facet omitted from fresh selection invalidates its old conversation context', t => {
  const f = fixture(t), memory = new DevelopmentalMemory(f.store), at = new Date().toISOString();
  memory.ingest({ id: 'public-source', runId: f.binding.runId, sourceId: 'old-input', actorId: 'owner', scope: { kind: 'public' }, channel: 'speech', content: 'Public backing source stays available', at });
  const originalFacet = memory.adoptSelf({ id: 'oversized-old-facet', memoryIds: ['public-source'], scope: { kind: 'public' }, category: 'description',
    value: 'OLD-FACET-CONTENT' + 'x'.repeat(20000), reason: 'Existing real self facet', actorId: 'owner', at }, null);
  f.store.put('runs', f.binding.runId, { id: f.binding.runId, revision: 0, status: 'waiting', scope: f.binding.scope, authority: f.binding.authority }, null);
  const original = f.store.putJsonArtifact({ status: 'completed', messages: [{ role: 'user', content: JSON.stringify({ self: [originalFacet] }) }], observationIds: [] });
  f.store.put('execution', f.binding.runId, { checkpoint: { runId: f.binding.runId, revision: 0, shell: 'pi', artifact: original, observationIds: [] } }, null);
  const env = nodeSuccessionHostEnvironment({ stateDirectory: '/fixture/state', workspaceDirectory: '/fixture/workspace', artifactStore: '/fixture/artifacts', nodeBinary: process.execPath });
  const { context: _context, ...withoutContext } = f.binding;
  const snapshot = env.continuity(withoutContext, f.store) as { memory: { self: JsonValue[] } };
  assert.equal(snapshot.memory.self.length, 0);
  const bound = { ...withoutContext, context: f.store.putJsonArtifact(json(snapshot)) };
  memory.adoptSelf({ id: 'oversized-old-facet', memoryIds: ['public-source'], scope: { kind: 'restricted', principals: ['private:other'] }, category: 'description',
    value: 'Now private to another audience', reason: 'Legitimate scope narrowing', actorId: 'other', at }, 1);
  assert.ok(memory.get('public-source', f.binding.scope), 'backing memory has not changed or expired');
  assert.throws(() => env.validateContext(bound, f.store), /self|facet|scope|withdraw|privacy|context|changed|invalid/i,
    'old facet content in serialized conversation must not survive a real scope withdrawal merely because selectedself omitted it');
});
