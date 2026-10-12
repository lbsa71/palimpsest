import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import type { ArtifactRef, Authority, Observation, PhysicalRequest, ResourceEnvelope, ShellPort } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { DurableRuntime, ResourceLedger } from '../../packages/runtime/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { DevelopmentalMemory } from '../../packages/development/index.ts';
import { FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry } from '../../packages/initiative/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
import { projectDevelopmentSources } from './development-observer.ts';
import type { DevelopmentSourceCapture, DevelopmentSourceInput } from './development-observer.ts';

const resources: ResourceEnvelope = { maxRequests: 20, maxTokens: 2000, maxCostUsd: 2, maxElapsedMs: 60000, maxConcurrency: 2 };
const authority: Authority = { generation: 'fixture-generation', epoch: 1, controlRevision: 'fixture-control' };
const scope = { kind: 'restricted', principals: ['fixture-user'] } as const;
const message = (revision = '1', text = 'bounded ordinary assignment'): AuthenticatedMessage => ({ source: 'direct', externalId: 'message', revision, conversation: 'conversation', text, actor: { id: 'fixture-user', scope: { ...scope, principals: [...scope.principals] }, modificationEligible: true } });
function fixture(outcome: 'succeeded' | 'failed' | 'uncertain' = 'succeeded', status: 'completed' | 'checkpointed' = 'completed') {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-development-observer-')), filename = join(directory, 'state.sqlite'); let now = Date.parse('2026-10-12T02:00:00Z'), ordinal = 0;
  let mode: 'observe' | 'equal-result' | 'checkpoint-failure' | 'failure' = 'observe', lastObservation: Observation | undefined;
  const store = new OperationalStore({ filename, documentJournal: { stream: 'journal:fixture', hostId: 'fixture-host', maxAnchorDocuments: 64, maxAnchorBytes: 65536 } });
  const memory = new DevelopmentalMemory(store, () => new Date(now).toISOString()), goals = new InitiativeRegistry(store), obligations = new ObligationRegistry(store);
  const raw = new Map<string, Uint8Array>();
  const retain = (bytes: Uint8Array): ArtifactRef => { const sha256 = createHash('sha256').update(bytes).digest('hex'); raw.set(sha256, Uint8Array.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  const retainJson = (value: unknown) => retain(Buffer.from(canonicalJson(value)));
  const read = (ref: ArtifactRef, bound: number) => { const bytes = raw.get(ref.sha256) ?? store.readArtifact(ref, bound); if (!bytes) throw Error('artifact missing'); return bytes; };
  const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { return { outcome, receipt: store.putJsonArtifact({ fixture: outcome }) }; }, async reconcile() { return { outcome: 'unresolved', receipt: store.putJsonArtifact({ unresolved: true }) }; } });
  const ledger = new ResourceLedger(store, { tokens: 20, costUsd: .01, elapsedMs: 100 }, () => now);
  const shell: ShellPort = { async run(input, bridge) {
    ordinal++; const payload = canonicalJson({ fixture: 'no provider', ordinal }), prompt = { id: `prompt:${ordinal}`, fragments: [], requestDigest: createHash('sha256').update(payload).digest('hex') };
    await bridge.capturePrompt(prompt, payload);
    const request: PhysicalRequest = { id: `physical:${ordinal}`, runId: input.run.id, purpose: 'reasoning', provider: 'fixture', model: 'offline', promptManifestId: prompt.id, requestDigest: prompt.requestDigest, reservationId: `physical:${ordinal}`, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    await bridge.reserve(request); await bridge.dispatched({ ...request, status: 'dispatched' }); await bridge.settle({ ...request, status: outcome });
    if (mode === 'checkpoint-failure') await bridge.persistCheckpoint(input.run.id, input.run.revision, 'fixture', { observationIds: [], progress: 'input read before interrupted result' });
    if (mode === 'checkpoint-failure' || mode === 'failure') throw Error('repeated fixture interruption');
    if (mode === 'equal-result') { assert.ok(lastObservation); return { status, observations: [lastObservation] }; }
    const observation = await bridge.execute({ id: `call:${ordinal}`, runId: input.run.id, stepId: `step:${ordinal}`, name: 'fixture-measure', arguments: { fixture: true } });
    lastObservation = observation;
    return { status, observations: [observation] };
  } };
  const runtime = new DurableRuntime({ store, shell, effects, resources: ledger, now: () => now });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources }) });
  const scheduler = new FairScheduler(store, goals, obligations, 'ordinary', { windowMs: 1000, maxSlicesPerWindow: 10, maxLifetimeSlices: 20, quantumMs: 1000, idleRetryMs: 1, maxStalls: 3, resources }, now);
  const runner = new InitiativeRunner({ scheduler, runtime, memory, authority, prompt: () => ({ id: 'runtime', fragments: [], requestDigest: identity('runtime') }), decide: (_g, observations) => ({ kind: 'continue', nextAction: 'inspect independent second measurement', evidenceIds: observations.map(o => o.id), reason: 'fixture continues without claiming success' }) });
  const stat = statSync(filename, { bigint: true }), pathIdentity = { device: String(stat.dev), inode: String(stat.ino) }, journal = store.documentJournalBinding()!, configurationDigest = identity({ fixture: true });
  const capture = () => {
    const value: DevelopmentSourceCapture = { roleId: 'candidate', configurationDigest, source: { pathIdentity, journalDigest: identity(journal) }, clock: { kind: 'synthetic', wallMs: now, monotonicMs: now - Date.parse('2026-10-12T02:00:00Z'), bootId: 'synthetic-boot', processStart: 'synthetic-process' }, snapshot: store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 }) };
    const artifacts = (v: unknown): void => { if (!v || typeof v !== 'object') return; if ('uri' in v && 'sha256' in v) { const ref = v as ArtifactRef; if (ref.uri.startsWith('aeon:artifact:')) retain(store.readArtifact(ref, 1_048_576)); return; } Object.values(v).forEach(artifacts); }; artifacts(value);
    return retainJson(value);
  };
  const assignmentPacket = (messages: AuthenticatedMessage[] = []) => retainJson({ version: 1, assignments: messages.map((m, i) => ({ id: `assignment:${i}`, roleId: 'candidate', message: m })) });
  const input = (before: ArtifactRef, after: ArtifactRef, packet = assignmentPacket(), current = after): DevelopmentSourceInput => ({ before, after, current, assignmentPacket: packet, roleId: 'candidate', configurationDigest, pathIdentity, journal, bounds: { maxCaptureBytes: 1_048_576, maxArtifactBytes: 1_048_576, maxRows: 512, maxProofBytes: 65536 }, readArtifact: read });
  const reviseCapture = (ref: ArtifactRef, mutate: (v: DevelopmentSourceCapture) => void) => { const v = JSON.parse(Buffer.from(read(ref, 1_048_576)).toString()) as DevelopmentSourceCapture; mutate(v); return retainJson(v); };
  const ready = () => { const g = goals.propose({ id: 'inquiry', origin: { kind: 'self' }, purpose: 'inspect ordinary source evidence', scope: { kind: 'public' }, successCriteria: ['retain measured uncertainty'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'inspect fixture measurement', reviewAt: new Date(now).toISOString() }, { sourceIds: ['unresolved-host-origin'], actorId: 'fixture-generation', recordedAt: new Date(now).toISOString(), derivation: 'interpreted' }); goals.accept(g.id, g.revision, 'fixture opportunity'); };
  return { store, raw, retainJson, capture, assignmentPacket, input, reviseCapture, core, runner, ready, runtime, scheduler, ledger, mode: (next: typeof mode) => { mode = next; }, advance: (ms = 100) => { now += ms; }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('ordinary scheduler, initiative execution, runtime, ledger and result bind exact retained versions', async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    const p = projectDevelopmentSources(f.input(before, after)); assert.deepEqual(p.unavailable, []); assert.equal(p.cycles.length, 1);
    const c = p.cycles[0]!; assert.equal(c.selection.stream, 'scheduler:ordinary'); assert.equal(c.origin, 'unknown'); assert.equal(c.requests.length, 2); assert.equal(c.observations[0]?.kind, 'result');
    assert.equal(c.runId, f.store.get<{ runId: string }>('initiative.execution', 'inquiry')!.value.runId); assert.equal(c.runStatus, 'completed');
    assert.ok(c.proof.versions.some(r => r.namespace === 'initiative.execution')); assert.ok(c.proof.versions.some(r => r.namespace === 'inbox')); assert.ok(c.proof.versions.some(r => r.namespace === 'effects'));
    assert.deepEqual(c.interval.before, before); assert.deepEqual(c.interval.after, after); assert.equal(c.interval.upperWallMs - c.interval.lowerWallMs, 100); assert.equal(p.clockQualification, 'synthetic');
  } finally { f.close(); }
});

test('delayed repeated capture never restamps an old selection as a new cycle', async () => {
  const f = fixture(); try { f.ready(); await f.runner.tick(); const before = f.capture(); f.advance(10000); const after = f.capture(); const p = projectDevelopmentSources(f.input(before, after)); assert.deepEqual(p.unavailable, []); assert.equal(p.cycles.length, 0); } finally { f.close(); }
});

test('one registered assignment revision reuses a run through exact admitted/steering ingress', async () => {
  const f = fixture(); try {
    const first = message(), revision = message('2', 'changed assignment'), packet = f.assignmentPacket([first, revision]), before = f.capture();
    const run = f.core.receive(first).run; assert.equal(f.core.receive(revision).run.id, run.id); await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') });
    f.advance(); const p = projectDevelopmentSources(f.input(before, f.capture(), packet)); assert.deepEqual(p.unavailable, []); assert.equal(p.assignments.length, 2);
    assert.deepEqual(p.assignments.map(a => a.linkage), ['admitted', 'steering']); assert.ok(p.assignments.every(a => a.runId === run.id && a.observations[0]?.kind === 'result'));
    assert.deepEqual(p.assignments[1]!.input.scope, revision.actor.scope); assert.equal(p.assignments[1]!.input.value, revision.text);
  } finally { f.close(); }
});

test('late assignment reads and numeric stale backfill retain unavailable causal links', () => {
  const f = fixture(); try {
    const first = message('3'), stale = message('2'); const before = f.capture(); f.core.receive(first); f.core.receive(stale); f.advance(); const after = f.capture();
    const p = projectDevelopmentSources(f.input(before, after, f.assignmentPacket([stale]))); assert.equal(p.assignments.length, 0); assert.match(p.unavailable[0]!.reason, /ingress unavailable/);
    const late = projectDevelopmentSources(f.input(after, after, f.assignmentPacket([first]))); assert.equal(late.assignments.length, 0); assert.match(late.unavailable[0]!.reason, /ingress unavailable/);
  } finally { f.close(); }
});

for (const field of ['text', 'actor', 'scope', 'revision', 'eligibility', 'conversation'] as const) test(`registered assignment ${field} mismatch refuses source fact`, () => {
  const f = fixture(); try {
    const actual = message(), before = f.capture(); f.core.receive(actual); f.advance(); const after = f.capture(), wrong = message();
    if (field === 'text') wrong.text = 'fabricated success'; else if (field === 'actor') wrong.actor.id = 'foreign'; else if (field === 'scope') wrong.actor.scope = { kind: 'public' }; else if (field === 'revision') wrong.revision = '999'; else if (field === 'eligibility') wrong.actor.modificationEligible = false; else wrong.conversation = 'foreign';
    const p = projectDevelopmentSources(f.input(before, after, f.assignmentPacket([wrong]))); assert.equal(p.assignments.length, 0); assert.ok(p.unavailable.length);
  } finally { f.close(); }
});

test('current withdrawal fences previously available intermediate execution without substitution', async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture(); assert.equal(projectDevelopmentSources(f.input(before, after)).cycles.length, 1);
    f.store.withdrawDocumentJournalContent({ id: 'withdraw-execution', reason: 'forget', targets: [{ namespace: 'initiative.execution', key: 'inquiry', expectedRevision: f.store.get('initiative.execution', 'inquiry')!.revision }] }); f.advance();
    const p = projectDevelopmentSources(f.input(before, after, undefined, f.capture())); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /withdrawn/);
  } finally { f.close(); }
});

test('an intermediate execution payload cannot be replaced by earlier/later current rows', async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    const broken = f.reviseCapture(after, c => { const intermediate = c.snapshot.journalPayloads.find(p => p.ref.namespace === 'initiative.execution' && p.ref.revision === 1)!; c.snapshot.journalPayloads = c.snapshot.journalPayloads.filter(p => p !== intermediate); });
    const p = projectDevelopmentSources(f.input(before, broken)); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /missing\/changed\/orphan/);
  } finally { f.close(); }
});

for (const fault of ['payload', 'withdrawal', 'events', 'current', 'clock', 'session', 'binding', 'schema'] as const) test(`retained ${fault} corruption fails the source boundary`, async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    const broken = f.reviseCapture(after, c => {
      if (fault === 'payload') { const p = c.snapshot.journalPayloads.find(p => p.state === 'available')!; if (p.state === 'available') p.document.value = 'changed'; }
      else if (fault === 'withdrawal') { const p = c.snapshot.journalPayloads[0]!; c.snapshot.journalPayloads[0] = { ref: p.ref, state: 'withdrawn', withdrawalId: 'invented' }; }
      else if (fault === 'events') c.snapshot.events.splice(1, 1);
      else if (fault === 'current') c.snapshot.documents.find(d => d.namespace === 'initiative.execution')!.value = { runId: 'foreign' };
      else if (fault === 'clock') c.clock.wallMs -= 1000;
      else if (fault === 'session') c.clock.processStart = 'foreign-session';
      else if (fault === 'binding') c.source.pathIdentity.inode = 'different';
      else (c.snapshot.journalBinding as unknown as { schema: string }).schema = 'aeon.document-journal.v1';
    });
    const p = projectDevelopmentSources(f.input(before, broken)); assert.equal(p.cycles.length, 0); assert.equal(p.unavailable[0]!.subject, 'source');
  } finally { f.close(); }
});

test('capture/request/proof bounds and exact artifact digests fail without truncating source', async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture(), original = f.input(before, after);
    for (const bounds of [{ ...original.bounds, maxCaptureBytes: 2048 }, { ...original.bounds, maxArtifactBytes: 8 }, { ...original.bounds, maxRows: 10 }, { ...original.bounds, maxProofBytes: 2048 }]) {
      const p = projectDevelopmentSources({ ...original, bounds }); assert.equal(p.cycles.length, 0); assert.ok(p.unavailable.length); assert.ok(Buffer.byteLength(canonicalJson(p)) <= bounds.maxProofBytes);
    }
    const p = projectDevelopmentSources({ ...original, readArtifact: (_ref, _bound) => Buffer.from('{}') }); assert.match(p.unavailable[0]!.reason, /digest/);
  } finally { f.close(); }
});

test('raw host clock label still requires independent host qualification', () => {
  const f = fixture(); try { const first = f.capture(), before = f.reviseCapture(first, c => { c.clock.kind = 'host'; }), p = projectDevelopmentSources(f.input(before, before)); assert.equal(p.clockQualification, 'requires-host-qualification'); } finally { f.close(); }
});

test('failed opportunities preserve physical failure and error observation; unknown effects stay visible', async () => {
  for (const outcome of ['failed', 'uncertain'] as const) {
    const f = fixture(outcome); try {
      f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const p = projectDevelopmentSources(f.input(before, f.capture())); assert.deepEqual(p.unavailable, []); assert.equal(p.cycles.length, 1);
      assert.ok(p.cycles[0]!.requests.some(r => r.status === outcome)); assert.equal(p.cycles[0]!.runStatus, outcome === 'uncertain' ? 'blocked' : 'completed');
      assert.equal(p.cycles[0]!.observations.length, outcome === 'uncertain' ? 0 : 1); if (outcome === 'failed') assert.equal(p.cycles[0]!.observations[0]!.kind, 'error');
    } finally { f.close(); }
  }
});

test('a later steering revision cannot reuse an earlier runtime result as its consumed result', async () => {
  const f = fixture('succeeded', 'checkpointed'); try {
    const first = message(), revision = message('2'), before = f.capture(), run = f.core.receive(first).run;
    await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); assert.equal(f.core.receive(revision).run.id, run.id); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture(), f.assignmentPacket([first, revision])));
    assert.equal(p.assignments.length, 2); assert.ok(p.assignments[0]!.result); assert.equal(p.assignments[1]!.result, null); assert.deepEqual(p.assignments[1]!.observations, []); assert.equal(p.unavailable[0]!.subject, 'assignment-result:assignment:1');
  } finally { f.close(); }
});

test('a new ordinary selection without a new physical request cannot claim a cycle', async () => {
  const f = fixture(); try { f.ready(); await f.runner.tick(); const before = f.capture(); f.scheduler.select(new Date(f.runtime.now()).toISOString()); f.advance(); const p = projectDevelopmentSources(f.input(before, f.capture())); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /no bound physical request/); } finally { f.close(); }
});

test('foreign run physical request cannot fill a selected initiative cycle', async () => {
  const f = fixture(); try {
    f.ready(); await f.runner.tick(); const before = f.capture(); f.scheduler.select(new Date(f.runtime.now()).toISOString()); const foreign = f.core.receive(message()).run;
    f.ledger.reserve({ id: 'foreign', runId: foreign.id, purpose: 'reasoning', provider: 'fixture', model: 'offline', promptManifestId: 'foreign', requestDigest: identity('foreign'), reservationId: 'foreign', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } });
    f.advance(); const p = projectDevelopmentSources(f.input(before, f.capture())); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /no bound physical request/);
  } finally { f.close(); }
});

test('later current capture cannot replace the earlier retained event prefix', () => {
  const f = fixture(); try {
    const before = f.capture(); f.core.receive(message()); f.advance(); const after = f.capture(), changed = f.reviseCapture(after, c => { c.snapshot.events.find(e => e.stream === 'communications')!.id = 'replacement'; });
    const p = projectDevelopmentSources(f.input(before, after, undefined, changed)); assert.equal(p.assignments.length, 0); assert.match(p.unavailable[0]!.reason, /prefix changed/);
  } finally { f.close(); }
});

test('identical freshly returned result bytes bind a new invocation and consumption cursor', async () => {
  const f = fixture('succeeded', 'checkpointed'); try {
    const first = message(), second = message('2'), before = f.capture(), run = f.core.receive(first).run;
    await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') });
    const earlier = f.store.get<{ lastResult: unknown }>('execution', run.id)!.value.lastResult;
    f.core.receive(second); f.mode('equal-result'); await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') });
    assert.deepEqual(f.store.get<{ lastResult: unknown }>('execution', run.id)!.value.lastResult, earlier); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture(), f.assignmentPacket([first, second]))); assert.deepEqual(p.unavailable, []);
    const result = p.assignments[1]!.result!; assert.ok(result); assert.ok(result.origin.invocation.sequence > p.assignments[1]!.ingress.sequence); assert.equal(result.messageSequence, f.store.events(run.id).find(e => e.type === 'steering')!.sequence);
    assert.equal(result.origin.execution.namespace, 'execution'); assert.deepEqual(p.assignments[1]!.observations, [], 'returning an old issued observation is not a new observation');
  } finally { f.close(); }
});

test('repeated failure metadata cannot make a carried equal result a new initiative result', async () => {
  const f = fixture('succeeded', 'checkpointed'); try {
    f.ready(); await f.runner.tick(); f.advance(); f.mode('checkpoint-failure'); await f.runner.tick(); f.advance();
    const before = f.capture(); f.mode('failure'); await f.runner.tick(); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture())); assert.equal(p.cycles.length, 1); assert.equal(p.cycles[0]!.result, null); assert.equal(p.cycles[0]!.requests.length, 1);
  } finally { f.close(); }
});

test('recovery result with fresh issued observation has its own origin despite inherited failure', async () => {
  const f = fixture('succeeded', 'checkpointed'); try {
    const first = message(), second = message('2'), third = message('3'), before = f.capture(), run = f.core.receive(first).run;
    const prompt = { id: 'runtime', fragments: [], requestDigest: identity('runtime') }; await f.runtime.resume(run.id, prompt);
    f.core.receive(second); f.mode('checkpoint-failure'); await f.runtime.resume(run.id, prompt); f.core.receive(third); f.mode('observe'); await f.runtime.resume(run.id, prompt); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture(), f.assignmentPacket([third]))); assert.deepEqual(p.unavailable, []); assert.equal(p.assignments.length, 1);
    const result = p.assignments[0]!.result!; assert.ok(result); assert.ok(result.origin.invocation.sequence > p.assignments[0]!.ingress.sequence); assert.deepEqual(result.observationIds, ['tool:call:3']);
  } finally { f.close(); }
});

test('intermediate request identity substitution remains corruption after the final identity is restored', async () => {
  const f = fixture(); try {
    f.ready(); await f.runner.tick(); f.advance(); const before = f.capture(); await f.runner.tick();
    const first = f.store.get<{ request: PhysicalRequest }>('requests', 'physical:1')!.value.request, second = f.store.get<{ request: PhysicalRequest }>('requests', 'physical:2')!;
    f.store.put('requests', 'physical:2', { ...second.value, request: { ...second.value.request, promptManifestId: first.promptManifestId, requestDigest: first.requestDigest } }, second.revision);
    f.store.put('requests', 'physical:2', second.value, second.revision + 1); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture())); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /immutable physical request lineage/);
  } finally { f.close(); }
});
