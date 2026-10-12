import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, identity, type ArtifactRef, type ResourceEnvelope, type ShellPort } from '../../contracts/index.ts';
import { OperationalStore, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, type HistoricalSourceUse, type SourcePage, type SourceCut, type JournalRef } from '../index.ts';
import { ResourceLedger, DurableRuntime } from '../../runtime/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { DevelopmentalMemory } from '../../development/index.ts';
import { DevelopmentAccounting } from '../../../deployment/development-accounting.ts';
import type { DevelopmentRegistration, DevelopmentRoleBinding } from '../../../evaluations/development/review-envelope.ts';
import { QualificationStore } from '../../../evaluations/qualification/store.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const journal = { stream: 'historical-fence', hostId: 'fixture-host', maxAnchorDocuments: 512, maxAnchorBytes: 500_000 };
const bounds = { maxPageRows: 8, maxPageBytes: 100_000, maxPages: 128, maxPhysicalRows: 1024, maxConservativeBytes: 4_000_000, maxSerializedBytes: 2_000_000, maxOperationalArtifacts: 64, maxOperationalArtifactBytes: 100_000, maxOperationalArtifactTotalBytes: 200_000 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'cp2-historical-')), stores: OperationalStore[] = [], retained = new Map<string, Buffer>();
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  const open = (name = 'source') => { const store = new OperationalStore({ filename: join(dir, `${name}.sqlite`), documentJournal: journal }); stores.push(store); return store; };
  const retain = (bytes: Uint8Array): ArtifactRef => { const sha256 = hash(bytes); retained.set(sha256, Buffer.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  const capture = (store: OperationalStore) => store.captureDevelopmentPages(bounds, retain, (_original, bytes) => retain(bytes));
  const scope = (cut: SourceCut): HistoricalSourceUse => {
    const refs = cut.pages.flatMap(descriptor => {
      const page = JSON.parse(retained.get(descriptor.artifact.sha256)!.toString()) as SourcePage;
      return page.table === 'documents' ? page.rows.filter(row => row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).map(row => (row.value as unknown as { ref: JournalRef }).ref) : [];
    }).sort((a, b) => a.versionId < b.versionId ? -1 : 1);
    return { journalDigest: hash(canonicalJson(cut.journalBinding)), prefix: { lastSequence: cut.lastSequence, eventsDigest: cut.eventsDigest }, requiredVersions: refs, maxPageRows: bounds.maxPageRows, maxPageBytes: bounds.maxPageBytes, maxPrefixBytes: bounds.maxConservativeBytes, maxVersions: 512, maxVersionBytes: 1_000_000, maxWithdrawalMarkerBytes: bounds.maxPageBytes };
  };
  return { dir, open, capture, scope, retained, retain };
}

test('nested historical use releases its fence before ordinary memory writes and preserves the committed cut', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = f.scope(cut);
  store.transaction(() => {
    store.put('memory', 'entry', 'replacement', 1);
    store.transaction(() => store.withDevelopmentVersionsAvailable(input, observation => {
      assert.equal(store.transactionActive, true); assert.equal(observation.prefixSequence, cut.lastSequence);
      assert.ok(observation.observedLastSequence > cut.lastSequence); assert.ok(Object.isFrozen(observation));
      assert.deepEqual(store.documentJournalBinding(), cut.journalBinding);
    }));
    store.put('memory', 'after', 'ordinary write', null);
    assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => assert.fail('nested current cut')), /reentrant/);
    let pages = 0; assert.throws(() => store.captureDevelopmentPages(bounds, () => { pages++; return f.retain(Buffer.from('unexpected')); }, () => assert.fail('artifact capture')), /reentrant/); assert.equal(pages, 0);
    assert.ok(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 }).events.length > cut.lastSequence);
  });
  assert.equal(store.transactionActive, false); assert.equal(store.get('memory', 'after')!.value, 'ordinary write');
  assert.equal(store.withDevelopmentVersionsAvailable(input, o => o.checkedVersions), input.requiredVersions.length);
  assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => assert.fail('stale cut')), /source cut changed/);
});

test('historical guard rejects every supported mutation, close and development reentry, even when caught', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = f.scope(cut), before = store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 });
  store.transaction(() => store.withDevelopmentVersionsAvailable(input, () => {
    const writes = [() => store.put('memory', 'entry', 'bad', 1), () => store.delete('memory', 'entry', 1), () => store.append({ id: 'bad', stream: 'bad', type: 'bad', data: null }), () => store.putArtifact('bad'), () => store.putJsonArtifact({ bad: true }), () => store.withdrawDocumentJournalContent({ id: 'bad-withdraw', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] }), () => store.close()];
    for (const write of writes) assert.throws(() => store.transaction(write), /source writes forbidden/);
    assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('nested historical')), /reentrant/);
    assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => assert.fail('current cut')), /reentrant/);
    assert.throws(() => f.capture(store), /reentrant/);
    assert.throws(() => store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 }), /reentrant/);
  }));
  assert.deepEqual(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 }), before); assert.equal(store.hasArtifacts(), false);
  const memory = new DevelopmentalMemory(store, () => '2026-10-12T00:00:00.000Z');
  memory.ingest({ id: 'after', runId: 'run', sourceId: 'source', actorId: 'actor', at: '2026-10-12T00:00:00.000Z', channel: 'speech', scope: { kind: 'public' }, content: 'after guard' });
  assert.ok(memory.get('after', { kind: 'public' }));
});

for (const result of ['throw', 'promise', 'object-thenable', 'function-thenable'] as const) test(`historical ${result} refusal unwinds only its savepoint and restores the write fence`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const input = f.scope(f.capture(store));
  store.transaction(() => {
    store.put('ordinary', 'before', 'survives', null);
    assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => {
      if (result === 'throw') throw new Error('callback failure');
      if (result === 'promise') return Promise.resolve('async');
      if (result === 'object-thenable') return { then: () => undefined };
      return Object.assign(() => undefined, { then: () => undefined });
    }), /document-history-corrupt-or-missing/);
    assert.equal(store.transactionActive, true); store.put('ordinary', 'after', 'survives', null);
  });
  assert.equal(store.transactionActive, false); assert.equal(store.get('ordinary', 'before')!.value, 'survives'); assert.equal(store.get('ordinary', 'after')!.value, 'survives');
  assert.equal(store.withDevelopmentVersionsAvailable(input, () => 'available'), 'available');
});

test('outer rollback discards uncommitted suffix despite successful call-local historical observation', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = f.scope(cut), artifacts = f.retained.size;
  assert.throws(() => store.transaction(() => {
    store.put('ordinary', 'rollback', 'uncommitted', null);
    const observation = store.withDevelopmentVersionsAvailable(input, o => o);
    assert.ok(observation.observedLastSequence > cut.lastSequence);
    assert.throws(() => f.capture(store), /reentrant/);
    const retainFull = () => { assert.equal(store.transactionActive, false, 'retained capture requires committed source'); f.retain(Buffer.from(canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 })))); };
    assert.throws(retainFull, /requires committed source/);
    throw new Error('outer rollback');
  }), /outer rollback/);
  assert.equal(f.retained.size, artifacts); assert.equal(store.get('ordinary', 'rollback'), undefined); assert.deepEqual(f.capture(store), cut);
  assert.equal(store.withDevelopmentVersionsAvailable(input, o => o.observedLastSequence), cut.lastSequence);
  store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => undefined);
});

test('uncommitted withdrawal denies conservatively without retaining a capture or committed attestation', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = f.scope(cut), artifacts = f.retained.size; let callbacks = 0;
  assert.throws(() => store.transaction(() => {
    store.withdrawDocumentJournalContent({ id: 'uncommitted-withdrawal', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
    assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => callbacks++), /document-history-withdrawn/);
    assert.throws(() => f.capture(store), /reentrant/);
    assert.equal(store.transactionActive, true, 'owner must refuse retained full/diagnostic capture');
    assert.ok(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 }).events.some(e => e.id === 'uncommitted-withdrawal'));
    throw new Error('rollback withdrawal');
  }), /rollback withdrawal/);
  assert.equal(callbacks, 0); assert.equal(f.retained.size, artifacts); assert.equal(store.events().some(e => e.id === 'uncommitted-withdrawal'), false); assert.deepEqual(f.capture(store), cut);
  assert.equal(store.withDevelopmentVersionsAvailable(input, () => 'available'), 'available');
  store.withdrawDocumentJournalContent({ id: 'committed-withdrawal', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  assert.throws(() => store.transaction(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('withdrawn'))), /document-history-withdrawn/);
  store.put('ordinary', 'after-denial', 'allowed storage write', null); assert.ok(f.capture(store).lastSequence > cut.lastSequence);
});

for (const roleId of ['candidate', 'control'] as const) test(`actual ${roleId} runtime reserve/dispatch composes with all-role historical gates and releases before receiver writes`, async t => {
  const f = fixture(t), candidate = f.open('candidate'), control = f.open('control'), rootId = 'operating-envelope:v1', at = Date.parse('2026-10-12T00:00:00.000Z');
  const resources: ResourceEnvelope = { maxRequests: 20, maxTokens: 100_000, maxCostUsd: 20, maxElapsedMs: 100_000, maxConcurrency: 4 };
  const original = new ResourceLedger(candidate, { tokens: 100, costUsd: 0.1, elapsedMs: 10 }, () => at); original.allocate(rootId, resources);
  const roles: DevelopmentRoleBinding[] = ['candidate', 'control'].map(id => ({ id, kind: id === 'candidate' ? 'candidate' : 'control', assignmentId: id === 'candidate' ? null : 'control', allocationId: `role:${id}`, configurationDigest: identity(`config:${id}`), closureDigest: identity(`closure:${id}`), profile: null, allowedEffects: ['fixture_write'], resources }));
  for (const role of roles) original.allocate(role.allocationId, resources, rootId);
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity('attempt'), rootId, rootCancelled: false, registeredAt: new Date(at).toISOString(), reviewDeadlineAt: new Date(at + resources.maxElapsedMs).toISOString(), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('verifier'), assignmentDigest: identity('assignment'), roles, originalRequests: [] };
  const rawDirectory = join(f.dir, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 }); const raw = new QualificationStore(rawDirectory, 2_000_000); t.after(() => raw.close());
  const scopes = new Map<OperationalStore, HistoricalSourceUse>(); const gateStates: string[] = [], wallMs: number[] = [], cpuMs: number[] = []; let reservations = 0;
  const assertCurrentUse = () => {
    const startedInRoleTransaction = (roleId === 'candidate' ? candidate : control).transactionActive;
    const visit = (index: number): void => {
      const source = [candidate, control][index]; if (!source) return;
      const scope = scopes.get(source)!;
      source.withDevelopmentVersionsAvailable(scope, () => {
        assert.throws(() => source.put('illegal', 'fenced', null, null), /source writes forbidden/);
        visit(index + 1);
      });
    };
    const started = performance.now(), cpu = process.cpuUsage();
    visit(0);
    wallMs.push(performance.now() - started); const spent = process.cpuUsage(cpu); cpuMs.push((spent.user + spent.system) / 1000);
    gateStates.push(startedInRoleTransaction ? 'outer' : 'entry');
  };
  const adapters = roles.map(role => new DevelopmentAccounting({ localStore: role.id === 'candidate' ? candidate : control, original, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant: { resources, issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + resources.maxElapsedMs).toISOString() }, behaviorWindow: { notBefore: new Date(at).toISOString(), deadlineAt: new Date(at + resources.maxElapsedMs - 1).toISOString() }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: null, rawStore: raw, transport: { id: 'fixture-transport', key: Buffer.alloc(32, 7) }, reserveEvidence: () => { reservations++; assert.equal(candidate.transactionActive, roleId === 'candidate'); candidate.put('capacity', 'reserved', true, null); }, maxResponseBytes: 10_000, assertCurrentUse }));
  for (const source of [candidate, control]) { source.put('memory', 'old', { role: source === candidate ? 'candidate' : 'control' }, null); scopes.set(source, f.scope(f.capture(source))); }
  const adapter = adapters[roleId === 'candidate' ? 0 : 1]!, store = roleId === 'candidate' ? candidate : control, authority = { generation: 'fixture', epoch: 1, controlRevision: 'fixture-controls' }; let entries = 0;
  const receiver = adapter.wrapReceiver({ dispatch: async effect => {
    entries++; assert.equal(store.transactionActive, false); assert.equal(candidate.transactionActive, false); assert.equal(control.transactionActive, false);
    assert.equal(adapter.originalRequest(effect.id)!.status, 'dispatched');
    const memory = new DevelopmentalMemory(store, () => new Date(at).toISOString());
    memory.ingest({ id: 'receiver-memory', runId: effect.runId, sourceId: effect.id, actorId: 'fixture', at: new Date(at).toISOString(), channel: 'speech', scope: { kind: 'public' }, content: 'normal write after immediate entry guard' });
    return { outcome: 'succeeded', receipt: store.putJsonArtifact({ observed: 'ordinary receiver' }) };
  }, reconcile: async () => { throw new Error('unexpected reconciliation'); } });
  const shell: ShellPort = { run: async (input, bridge) => ({ status: 'completed', observations: [await bridge.execute({ id: 'actual-effect', runId: input.run.id, stepId: 'step', name: 'fixture_write', arguments: { synthetic: true } })] }) };
  const runtime = new DurableRuntime({ store, resources: adapter.resources, effects: new EffectJournal(store, { assert() {} }, receiver), shell: adapter.wrapShell(shell), now: original.now });
  adapter.resources.allocate(rootId, resources);
  const run = runtime.admit({ id: 'input', source: 'direct', externalId: 'input', externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: 'ordinary fixture' }, authority, resources, rootId);
  const result = await runtime.resume(run.id, { id: 'base', requestDigest: identity('base'), fragments: [] });
  assert.equal(result.status, 'completed'); assert.equal(entries, 1); assert.equal(reservations, 1);
  assert.deepEqual(gateStates, ['entry', 'outer', 'outer', 'entry']);
  t.diagnostic(JSON.stringify({ roleId, gateWallMs: wallMs, gateCpuMs: cpuMs, processPeakRssKiB: process.resourceUsage().maxRSS }));
  assert.ok(Math.max(...wallMs) <= 1000, 'local historical gate exceeds adopted one-second ceiling');
  assert.deepEqual(adapter.transitions().map(transition => transition.state.request.status), ['reserved', 'dispatched', 'succeeded']);
  assert.equal(original.snapshot(rootId).requests, 1); assert.equal(adapter.originalRequest('tool:actual-effect')!.status, 'succeeded');
  assert.ok(new DevelopmentalMemory(store).get('receiver-memory', { kind: 'public' })); assert.equal(store.transactionActive, false);
  // A withdrawal in the other role stops this role's next actual accounting entry.
  const other = roleId === 'candidate' ? control : candidate;
  other.withdrawDocumentJournalContent({ id: 'other-role-withdrawal', reason: 'forget', targets: [{ namespace: 'memory', key: 'old', expectedRevision: 1 }] });
  assert.throws(() => adapter.captureTool({ id: 'late', runId: run.id, stepId: 'late', name: 'fixture_write', arguments: {} }), /document-history-withdrawn/);
  assert.equal(original.snapshot(rootId).requests, 1); assert.equal(entries, 1);
});
