import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import type { ArtifactRef, Authority, PhysicalRequest, ResourceEnvelope, ShellPort } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { DurableRuntime, ResourceLedger } from '../../packages/runtime/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
import { DevelopmentalMemory } from '../../packages/development/index.ts';
import { FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry } from '../../packages/initiative/index.ts';
import { projectDevelopmentSources } from './development-observer.ts';
import type { DevelopmentSourceCapture, DevelopmentSourceInput } from './development-observer.ts';

// Independent fixture: actual journal/runtime/accounting, one deterministic local shell.
// Review controls were frozen in 9e8e462 before this fixture was written.
const resources: ResourceEnvelope = { maxRequests: 12, maxTokens: 1200, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 2 };
const authority: Authority = { generation: 'review', epoch: 1, controlRevision: 'review' };
const prompt = { id: 'review-runtime', fragments: [], requestDigest: identity('review-runtime') };
function message(revision: string): AuthenticatedMessage {
  return { source: 'direct', externalId: 'review-task', revision, conversation: 'review-thread', text: `Measure revision ${revision}`, actor: { id: 'review-human', scope: { kind: 'public' }, modificationEligible: true } };
}
function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'od2-independent-'));
  const store = new OperationalStore({ filename: join(dir, 'state.sqlite'), documentJournal: { stream: 'review-journal', hostId: 'review-host', maxAnchorDocuments: 64, maxAnchorBytes: 65536 } });
  const bytes = new Map<string, Uint8Array>();
  const keep = (value: Uint8Array): ArtifactRef => { const sha256 = createHash('sha256').update(value).digest('hex'); bytes.set(sha256, Uint8Array.from(value)); return { uri: `sha256:${sha256}`, sha256 }; };
  const json = (value: unknown) => keep(Buffer.from(canonicalJson(value)));
  const read = (ref: ArtifactRef, max: number) => { const found = bytes.get(ref.sha256); if (!found) throw Error('review retained artifact missing'); assert.ok(found.length <= max); return found; };
  const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { return { outcome: 'succeeded' as const, receipt: store.putJsonArtifact({ measured: 7 }) }; }, async reconcile() { throw Error('no review reconciliation'); } });
  let now = 10000, calls = 0, checkpointFailure = false;
  const ledger = new ResourceLedger(store, { tokens: 20, costUsd: .01, elapsedMs: 10 }, () => now);
  const shell: ShellPort = { async run(input, bridge) {
    calls++;
    const payload = canonicalJson({ input: input.messages, call: calls });
    const manifest = { id: `review-prompt:${calls}`, fragments: [], requestDigest: createHash('sha256').update(payload).digest('hex') };
    await bridge.capturePrompt(manifest, payload);
    const request: PhysicalRequest = { id: `review-request:${calls}`, runId: input.run.id, purpose: 'reasoning', provider: 'offline', model: 'review', promptManifestId: manifest.id, requestDigest: manifest.requestDigest, reservationId: `review-request:${calls}`, status: 'reserved', usage: { requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, elapsedMs: 1 } };
    await bridge.reserve(request); await bridge.dispatched({ ...request, status: 'dispatched' }); await bridge.settle({ ...request, status: 'succeeded' });
    if (checkpointFailure) {
      await bridge.persistCheckpoint(input.run.id, input.run.revision, 'review', { observationIds: [], progress: 'new input read; no new result yet' });
      throw Error('review interruption after checkpoint');
    }
    const observation = await bridge.execute({ id: `review-tool:${calls}`, runId: input.run.id, stepId: `step:${calls}`, name: 'local-review', arguments: { sample: calls } });
    return { status: 'checkpointed', observations: [observation] };
  } };
  const runtime = new DurableRuntime({ store, shell, effects, resources: ledger, now: () => now });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources }) });
  const goals = new InitiativeRegistry(store), obligations = new ObligationRegistry(store), memory = new DevelopmentalMemory(store, () => new Date(now).toISOString());
  const scheduler = new FairScheduler(store, goals, obligations, 'ordinary', { windowMs: 1000, maxSlicesPerWindow: 8, maxLifetimeSlices: 12, quantumMs: 1000, idleRetryMs: 1, maxStalls: 3, resources }, now);
  const runner = new InitiativeRunner({ scheduler, runtime, memory, authority, prompt: () => prompt, decide: (_goal, observations) => ({ kind: 'continue', nextAction: 'measure again', evidenceIds: observations.map(o => o.id), reason: 'review fixture' }) });
  const s = statSync(store.filename, { bigint: true }), pathIdentity = { device: String(s.dev), inode: String(s.ino) }, journal = store.documentJournalBinding()!, configurationDigest = identity('independent-review');
  const capture = () => {
    const snapshot = store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 });
    const copyArtifacts = (v: unknown): void => { if (!v || typeof v !== 'object') return; if ('uri' in v && 'sha256' in v && String(v.uri).startsWith('aeon:artifact:')) keep(store.readArtifact(v as ArtifactRef, 1_048_576)); else Object.values(v).forEach(copyArtifacts); };
    copyArtifacts(snapshot);
    return json({ roleId: 'candidate', configurationDigest, source: { pathIdentity, journalDigest: identity(journal) }, clock: { kind: 'synthetic', wallMs: now, monotonicMs: now, bootId: 'review-boot', processStart: 'review-process' }, snapshot } satisfies DevelopmentSourceCapture);
  };
  const packet = (messages: AuthenticatedMessage[] = []) => json({ version: 1, assignments: messages.map((message, i) => ({ id: `task:${i}`, roleId: 'candidate', message })) });
  const input = (before: ArtifactRef, after: ArtifactRef, assignmentPacket = packet(), current = after): DevelopmentSourceInput => ({ before, after, current, assignmentPacket, roleId: 'candidate', configurationDigest, pathIdentity, journal, bounds: { maxCaptureBytes: 1_048_576, maxArtifactBytes: 1_048_576, maxRows: 512, maxProofBytes: 65536 }, readArtifact: read });
  const mutate = (ref: ArtifactRef, change: (capture: DevelopmentSourceCapture) => void) => { const c = JSON.parse(Buffer.from(read(ref, 1_048_576)).toString()) as DevelopmentSourceCapture; change(c); return json(c); };
  const ready = () => { const g = goals.propose({ id: 'review-goal', origin: { kind: 'self' }, purpose: 'inspect causal sources', scope: { kind: 'public' }, successCriteria: ['measured evidence'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'measure', reviewAt: new Date(now).toISOString() }, { sourceIds: ['review-fixture'], actorId: authority.generation, recordedAt: new Date(now).toISOString(), derivation: 'interpreted' }); goals.accept(g.id, g.revision, 'review'); };
  return { store, bytes, json, read, capture, input, packet, mutate, core, runtime, runner, ready, advance: () => { now += 100; }, interruptAtCheckpoint: () => { checkpointFailure = true; }, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('review: new revision checkpoint cannot relabel an earlier result as consumed', async () => {
  const f = harness(); try {
    const one = message('1'), two = message('2'), before = f.capture(), run = f.core.receive(one).run;
    await f.runtime.resume(run.id, prompt);
    const old = f.store.get<{ lastResult: unknown; messageSequence: number }>('execution', run.id)!.value;
    assert.equal(f.core.receive(two).run.id, run.id);
    f.interruptAtCheckpoint(); await f.runtime.resume(run.id, prompt); f.advance();
    const interrupted = f.store.get<{ lastResult: unknown; messageSequence: number; failure: string }>('execution', run.id)!.value;
    assert.deepEqual(interrupted.lastResult, old.lastResult); assert.ok(interrupted.messageSequence > old.messageSequence); assert.match(interrupted.failure, /interruption/);
    const p = projectDevelopmentSources(f.input(before, f.capture(), f.packet([one, two])));
    assert.equal(p.assignments.length, 2); assert.ok(p.assignments[0]!.result);
    assert.equal(p.assignments[1]!.result, null, 'checkpoint cursor is not the previous lastResult consumption cursor');
    assert.deepEqual(p.assignments[1]!.observations, []);
  } finally { f.close(); }
});

test('review: later failed cycle cannot reuse a previous slice result', async () => {
  const f = harness(); try {
    f.ready(); await f.runner.tick(); f.advance(); const before = f.capture();
    f.interruptAtCheckpoint(); await f.runner.tick(); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture()));
    assert.equal(p.cycles.length, 1); assert.ok(p.cycles[0]!.requests.length);
    assert.equal(p.cycles[0]!.result, null, 'execution failure/checkpoint update is not a new shell result');
  } finally { f.close(); }
});

test('review: actual new cycle is unsigned and only interval bounded; old selection remains old', async () => {
  const f = harness(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    const p = projectDevelopmentSources(f.input(before, after)); assert.deepEqual(p.unavailable, []); assert.equal(p.cycles.length, 1);
    assert.equal(p.kind, 'proposed-source-facts'); assert.equal(p.clockQualification, 'synthetic'); assert.equal(p.cycles[0]!.origin, 'unknown');
    assert.equal(p.cycles[0]!.interval.lowerWallMs, 10000); assert.equal(p.cycles[0]!.interval.upperWallMs, 10100);
    assert.ok(p.cycles[0]!.proof.artifacts.length); f.advance(); assert.equal(projectDevelopmentSources(f.input(after, f.capture())).cycles.length, 0);
  } finally { f.close(); }
});

for (const fault of ['role', 'configuration', 'journal', 'clock-kind', 'clock-drift', 'paged-shape', 'missing-version', 'duplicate-version', 'orphan-version', 'ref-mismatch', 'revision-gap'] as const) test(`review: ${fault} substitution refuses source`, async () => {
  const f = harness(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    const bad = f.mutate(after, c => {
      if (fault === 'role') c.roleId = 'control';
      else if (fault === 'configuration') c.configurationDigest = identity('foreign');
      else if (fault === 'journal') c.source.journalDigest = identity('foreign');
      else if (fault === 'clock-kind') c.clock.kind = 'host';
      else if (fault === 'clock-drift') c.clock.wallMs += 1001;
      else if (fault === 'paged-shape') (c.snapshot as unknown as Record<string, unknown>).pages = [];
      else if (fault === 'missing-version') c.snapshot.journalPayloads.pop();
      else if (fault === 'duplicate-version') c.snapshot.journalPayloads.push(c.snapshot.journalPayloads[0]!);
      else if (fault === 'orphan-version') c.snapshot.journalPayloads.push({ ...c.snapshot.journalPayloads[0]!, ref: { ...c.snapshot.journalPayloads[0]!.ref, versionId: 'orphan' } });
      else if (fault === 'ref-mismatch') c.snapshot.journalPayloads[0]!.ref.key = 'foreign';
      else { const e = c.snapshot.events.find(e => e.type === 'document-mutation')!; (e.data as unknown as { after: { revision: number } }).after.revision += 1; }
    });
    const p = projectDevelopmentSources(f.input(before, bad)); assert.equal(p.cycles.length, 0); assert.equal(p.assignments.length, 0); assert.equal(p.unavailable[0]!.subject, 'source');
  } finally { f.close(); }
});

test('review: supplied later current withdrawal fences proof but omitted later history is not detectable freshness', async () => {
  const f = harness(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    f.store.withdrawDocumentJournalContent({ id: 'review-withdraw', reason: 'expiry', targets: [{ namespace: 'prompts', key: 'review-prompt:1', expectedRevision: 1 }] }); f.advance();
    const current = f.capture(); const fenced = projectDevelopmentSources(f.input(before, after, undefined, current));
    assert.equal(fenced.cycles.length, 0); assert.match(fenced.unavailable[0]!.reason, /withdrawn/);
    assert.equal(projectDevelopmentSources(f.input(before, after)).cycles.length, 1, 'freshness requires recorder-owned latest retained inventory');
  } finally { f.close(); }
});

test('review: retained physical payload deletion and corrupt bytes refuse the cycle', async () => {
  const f = harness(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture(), input = f.input(before, after);
    const good = projectDevelopmentSources(input); const ref = good.cycles[0]!.proof.artifacts[0]!;
    const saved = f.bytes.get(ref.sha256)!; f.bytes.delete(ref.sha256);
    const missing = projectDevelopmentSources(input); assert.equal(missing.cycles.length, 0); assert.match(missing.unavailable[0]!.reason, /missing/);
    f.bytes.set(ref.sha256, Buffer.from('substituted request payload'));
    const corrupt = projectDevelopmentSources(input); assert.equal(corrupt.cycles.length, 0); assert.match(corrupt.unavailable[0]!.reason, /digest/); f.bytes.set(ref.sha256, saved);
  } finally { f.close(); }
});

test('review: fixed read bounds, proof refusal and failed reader preserve unavailable disposition', () => {
  const f = harness(); try {
    const before = f.capture(), input = f.input(before, before); const reads: number[] = [];
    const p = projectDevelopmentSources({ ...input, readArtifact(ref, bound) { reads.push(bound); return f.read(ref, bound); } });
    assert.deepEqual(p.unavailable, []); assert.equal(reads.length, 4); assert.ok(reads.every(b => b === 1_048_576));
    const failed = projectDevelopmentSources({ ...input, readArtifact() { throw Error('retained source unavailable'); } }); assert.match(failed.unavailable[0]!.reason, /unavailable/);
    const bounded = projectDevelopmentSources({ ...input, bounds: { ...input.bounds, maxProofBytes: 512 } }); assert.ok(Buffer.byteLength(canonicalJson(bounded)) <= 512); assert.match(bounded.unavailable[0]!.reason, /proof/);
    assert.throws(() => projectDevelopmentSources({ ...input, bounds: { ...input.bounds, maxProofBytes: 1 } }), /cannot contain/);
  } finally { f.close(); }
});

test('review: a later request row cannot substitute an older physical prompt for its reservation', async () => {
  const f = harness(); try {
    f.ready(); await f.runner.tick(); f.advance(); const before = f.capture();
    await f.runner.tick(); f.advance();
    const first = f.store.get<{ request: PhysicalRequest }>('requests', 'review-request:1')!.value.request;
    const second = f.store.get<{ request: PhysicalRequest }>('requests', 'review-request:2')!;
    assert.notEqual(first.requestDigest, second.value.request.requestDigest);
    // Explicit source-corruption probe through the actual journal, not an ordinary ledger operation.
    f.store.put('requests', 'review-request:2', { ...second.value, request: { ...second.value.request, promptManifestId: first.promptManifestId, requestDigest: first.requestDigest } }, second.revision);
    const p = projectDevelopmentSources(f.input(before, f.capture()));
    assert.equal(p.cycles.length, 0, 'reserved physical request must bind the same prompt/digest as its later status');
    assert.ok(p.unavailable.length);
  } finally { f.close(); }
});

// Additional repair checks frozen at 5163d77. Original 18 tests above remain unchanged.
test('re-review: unfinished checkpoint preserves exact prior producer proof without consuming later input', async () => {
  const f = harness(); let release!: () => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const checkpointed = new Promise<void>(resolve => { reached = resolve; });
  let active: Promise<unknown> | undefined;
  try {
    const first = message('1'), second = message('2'), before = f.capture(), run = f.core.receive(first).run;
    await f.runtime.resume(run.id, prompt); f.advance();
    const original = projectDevelopmentSources(f.input(before, f.capture(), f.packet([first]))).assignments[0]!.result!;
    assert.ok(original.origin); assert.equal(f.core.receive(second).run.id, run.id);
    f.runtime.shell.run = async (input, bridge) => {
      await bridge.persistCheckpoint(input.run.id, input.run.revision, 'review', { observationIds: [] });
      reached(); await waiting; throw Error('review released unfinished invocation');
    };
    active = f.runtime.resume(run.id, prompt); await checkpointed; f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture(), f.packet([first, second])));
    assert.equal(f.runtime.getRun(run.id)!.status, 'running'); assert.equal(p.assignments.length, 2);
    assert.deepEqual(p.assignments[0]!.result, original); assert.equal(p.assignments[1]!.result, null);
    const proof = p.assignments[0]!.proof, origin = original.origin;
    assert.ok(proof.versions.some(v => canonicalJson(v) === canonicalJson(origin.execution)));
    for (const event of [origin.invocation, origin.disposition]) assert.ok(proof.events.some(e => canonicalJson(e) === canonicalJson(event)));
    const events = f.store.events();
    assert.equal((events[origin.invocation.sequence - 1]!.data as unknown as { status: string }).status, 'running');
    assert.equal((events[origin.disposition.sequence - 1]!.data as unknown as { status: string }).status, 'waiting');
    const producer = events.find(e => e.type === 'document-mutation' && (e.data as unknown as { after?: { versionId: string } }).after?.versionId === origin.execution.versionId)!;
    assert.ok(origin.invocation.sequence < producer.sequence && producer.sequence < origin.disposition.sequence);
    assert.equal(original.messageSequence, events.find(e => e.stream === run.id && e.type === 'admitted')!.sequence);
    assert.ok(origin.disposition.sequence < p.assignments[1]!.ingress.sequence);
  } finally { release(); await active; f.close(); }
});

test('re-review: equal legitimate return after inherited failure cannot establish an unambiguous later producer', async () => {
  const f = harness(); try {
    const first = message('1'), second = message('2'), third = message('3'), before = f.capture(), run = f.core.receive(first).run;
    await f.runtime.resume(run.id, prompt);
    const earlier = f.store.get<{ lastResult: import('../../packages/contracts/index.ts').ShellResult }>('execution', run.id)!.value.lastResult;
    f.core.receive(second); f.interruptAtCheckpoint(); await f.runtime.resume(run.id, prompt);
    f.core.receive(third); f.runtime.shell.run = async () => earlier; await f.runtime.resume(run.id, prompt); f.advance();
    assert.equal(f.runtime.getRun(run.id)!.status, 'waiting');
    const p = projectDevelopmentSources(f.input(before, f.capture(), f.packet([first, second, third])));
    assert.equal(p.assignments.length, 3); assert.ok(p.assignments[0]!.result);
    assert.equal(p.assignments[1]!.result, null); assert.equal(p.assignments[2]!.result, null);
    assert.ok(p.unavailable.some(e => e.subject === 'assignment-result:task:2'));
  } finally { f.close(); }
});

for (const field of ['rootId', 'ceiling'] as const) test(`re-review: intermediate ${field} substitution cannot be hidden by restoring the final request`, async () => {
  const f = harness(); try {
    f.ready(); const before = f.capture(); await f.runner.tick();
    const original = f.store.get<{ request: PhysicalRequest; rootId: string; ceiling: { tokens: number; costUsd: number; elapsedMs: number } }>('requests', 'review-request:1')!;
    const corrupt = field === 'rootId' ? { ...original.value, rootId: 'foreign-allocation' } : { ...original.value, ceiling: { ...original.value.ceiling, tokens: original.value.ceiling.tokens + 1 } };
    f.store.put('requests', 'review-request:1', corrupt, original.revision);
    f.store.put('requests', 'review-request:1', original.value, original.revision + 1); f.advance();
    const p = projectDevelopmentSources(f.input(before, f.capture())); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /immutable physical request lineage/);
  } finally { f.close(); }
});

test('re-review: supplied-current withdrawal of producer execution fences an earlier supported result', async () => {
  const f = harness(); try {
    const first = message('1'), before = f.capture(), run = f.core.receive(first).run; await f.runtime.resume(run.id, prompt); f.advance();
    const after = f.capture(), packet = f.packet([first]), original = projectDevelopmentSources(f.input(before, after, packet));
    assert.ok(original.assignments[0]!.result!.origin.execution.versionId);
    f.store.withdrawDocumentJournalContent({ id: 'withdraw-exact-execution-producer', reason: 'forget', targets: [{ namespace: 'execution', key: run.id, expectedRevision: f.store.get('execution', run.id)!.revision }] }); f.advance();
    const refused = projectDevelopmentSources(f.input(before, after, packet, f.capture()));
    assert.equal(refused.assignments.length, 0); assert.match(refused.unavailable[0]!.reason, /withdrawn/);
  } finally { f.close(); }
});
