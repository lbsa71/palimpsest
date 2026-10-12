import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson, identity} from '../../packages/contracts/index.ts';
import {OperationalStore} from '../../packages/storage/index.ts';
import {QualificationStore} from '../qualification/store.ts';
import {DevelopmentAcquisitionRecorder, AcquisitionUnavailable, AcquisitionUseWithdrawn} from './acquire.ts';
import {sourceRecorderFixture} from './source-admission-recorder.test-fixture.ts';
import {developmentOperationalArtifactBytes} from './witness.ts';

type Hooks = {put?: (bytes: Uint8Array) => void; ownerPut?: (namespace: string, value: unknown) => void};
class OwnerAdapter extends OperationalStore {
  private readonly hooks: Hooks;
  constructor(filename: string, hooks: Hooks) { super({filename}); this.hooks = hooks; }
  override put(namespace: string, key: string, value: unknown, revision: number | null): number {
    this.hooks.ownerPut?.(namespace, value); return super.put(namespace, key, value, revision);
  }
}
function controlled(t: TestContext, full = false) {
  const f = sourceRecorderFixture(t, full), hooks: Hooks = {};
  const state = new OwnerAdapter(f.state.filename, hooks); t.after(() => state.close());
  const raw = f.raw;
  // Explicit public adapter over actual retained SQLite/files; no ambient mocks.
  const adapter = {
    directory: raw.directory, capacityBytes: raw.capacityBytes, profile: raw.profile,
    identity: () => raw.identity(), usage: () => raw.usage(), get usedBytes() {return raw.usedBytes;},
    claim: (id: string, grant: string, manifest: unknown) => raw.claim(id, grant, manifest),
    put: (value: unknown) => raw.put(value),
    putBytes: (bytes: Uint8Array) => {hooks.put?.(bytes); return raw.putBytes(bytes);},
    readArtifact: raw.readArtifact.bind(raw), close: () => {},
  } as QualificationStore;
  const options = {...f.options, state, raw: adapter};
  return {...f, hooks, options, state, claim: () => DevelopmentAcquisitionRecorder.claim(options)};
}
function isProof(bytes: Uint8Array) {return JSON.parse(Buffer.from(bytes).toString()).kind === 'cycle';}

for (const stage of ['bytes-written', 'inventory', 'logical-proof', 'observation-commit', 'terminal-write'] as const) {
  test(`repair pending: typed failure at ${stage} stays failed with exact durable stages`, async t => {
    const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
    let fired = false;
    const error = new AcquisitionUseWithdrawn(`document-history-withdrawn: synthetic ${stage} persistence`);
    f.hooks.put = bytes => {
      if (!r.status().admissionPending || !r.status().pending) return;
      if (stage === 'terminal-write' && (fired || isProof(bytes))) {fired = true; throw error;}
      if (stage === 'bytes-written' && !fired && isProof(bytes)) {fired = true; f.raw.putBytes(bytes); throw error;}
    };
    f.hooks.ownerPut = (namespace, value) => {
      if (fired || namespace !== 'development.acquisition') return;
      const next = value as ReturnType<typeof r.status>;
      if (!next.admissionPending) return;
      const fire = stage === 'inventory' && !next.pending && next.inventory.some(i => i.artifact.sha256 === next.admissionPending!.planned[0]!.artifact.sha256)
        || stage === 'logical-proof' && next.proofs!.some(p => p.kind === 'cycle');
      if (fire) {fired = true; throw error;}
    };
    if (stage === 'observation-commit') f.hooks.ownerPut = (namespace, value) => {
      if (!fired && namespace === 'development.acquisition' && (value as ReturnType<typeof r.status>).admissions!.length) {fired = true; throw error;}
    };
    const result = r.recordCycle(selector), status = r.status();
    assert.equal(fired, true); assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.ok(status.admissionPending); assert.equal(status.admissions!.length, 0);
    assert.equal(status.observations.filter(o => o.value.data.kind === 'cycle').length, 0);
    assert.equal(status.useDisposition, null);
    assert.equal(status.admissionPending.planned.length, 2);
    assert.equal(status.phase, stage === 'terminal-write' ? 'acquiring' : 'failed');
    assert.equal(Boolean(status.failure), stage !== 'terminal-write');
    assert.equal(Boolean(status.pending), ['bytes-written', 'inventory', 'terminal-write'].includes(stage));
    assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted/);
    const stopped = identity(status); assert.notEqual(r.recordCycle(selector).status, 'recorded'); assert.equal(identity(r.status()), stopped);
    f.state.put('repair.fence', 'released', true, null); source.store.put('repair.fence', 'released', true, null);
  });
}

for (const stage of ['proof', 'wrapper'] as const) {
  test(`repair reentry: repeated nested unsigned and typed calls at ${stage} cannot own outer pending`, async t => {
    const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
    let calls = 0;
    f.hooks.put = bytes => {
      if (calls || !r.status().admissionPending || !r.status().pending) return;
      const value = JSON.parse(Buffer.from(bytes).toString());
      if (stage === 'proof' ? value.kind !== 'cycle' : value.source !== 'host-source-admission') return;
      calls++;
      const pending = identity(r.status());
      for (let n = 0; n < 2; n++) assert.equal(r.inspectAssignment({roleId: selector.roleId, before: selector.before, after: selector.after, assignmentId: 'interference:0'}).status, 'unavailable');
      assert.throws(() => r.importSourceSupport({ordinal: 52, purpose: 'unaccepted', artifact: selector.before}), /reentrant/);
      assert.equal(identity(r.status()), pending);
    };
    const result = r.recordCycle(selector); assert.equal(calls, 1); assert.equal(result.status, 'recorded', JSON.stringify(result));
    const committed = identity(r.status()), usage = f.raw.usage();
    assert.deepEqual(r.recordCycle(selector), result); assert.equal(identity(r.status()), committed); assert.deepEqual(f.raw.usage(), usage);
    const reopened = DevelopmentAcquisitionRecorder.reopen(f.options);
    for (const [id, s] of source.sources) reopened.attachApplication(id, s.application, s.accounting);
    assert.deepEqual(reopened.recordCycle(selector), result); assert.deepEqual(f.raw.usage(), usage);
    assert.equal(r.status().failure, null); assert.equal(r.status().useDisposition, null); assert.equal(r.status().admissionPending, null);
    f.state.put('repair.fence', 'released', true, null); source.store.put('repair.fence', 'released', true, null);
  });
}

test('repair reentry: propagated refused typed import is an outer post-pending failure', async t => {
  const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  let fired = false;
  f.hooks.put = bytes => {if (!fired && r.status().admissionPending && r.status().pending && isProof(bytes)) {fired = true; r.importSourceSupport({ordinal: 52, purpose: 'unaccepted', artifact: selector.before});}};
  assert.equal(r.recordCycle(selector).status, 'failed'); assert.ok(fired); assert.equal(r.status().phase, 'failed');
  assert.ok(r.status().pending); assert.ok(r.status().admissionPending); assert.equal(r.status().useDisposition, null);
  assert.equal(r.status().admissions!.length, 0); assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted/);
});

for (const error of [AcquisitionUnavailable, AcquisitionUseWithdrawn]) {
  test(`repair typed support: ${error.name} retention failure remains terminal`, t => {
    const f = controlled(t), bytes = Buffer.alloc(65536, 34), artifact = f.raw.putBytes(bytes);
    f.admission.composition.support = [{ordinal: 52, purpose: 'public-repair', maxBytes: 65536, expected: artifact}]; f.accept(); f.options.document = f.sign();
    const r = f.claim(); f.setup(r); let fired = false;
    f.hooks.put = () => {if (!fired && r.status().admissionPending && r.status().pending) {fired = true; throw new error('document-history-withdrawn: support persistence');}};
    assert.throws(() => r.importSourceSupport({ordinal: 52, purpose: 'public-repair', artifact}), e => e instanceof Error && !(e instanceof AcquisitionUnavailable));
    assert.ok(fired); assert.equal(r.status().phase, 'failed'); assert.ok(r.status().admissionPending); assert.ok(r.status().pending);
    assert.equal(r.status().useDisposition, null); assert.equal(r.status().proofs!.some(p => p.ordinal === 52), false);
  });
}

for (const full of [false, true]) {
  test(`repair slots: ${full ? 'full' : 'mechanical'} typed supports preserve reserves and all generic identities refuse`, t => {
    const f = controlled(t, full), q = 65536, bytes = Buffer.alloc(q, 45), artifact = f.raw.putBytes(bytes), over = f.raw.putBytes(Buffer.alloc(q + 1, 46));
    f.admission.composition.support = [52, 53].map(ordinal => ({ordinal: ordinal as 52 | 53, purpose: 'public-repair', maxBytes: q, expected: null})); f.accept(); f.options.document = f.sign();
    const r = f.claim(); f.setup(r); const before = identity(r.status()), usage = f.raw.usage();
    for (const ordinal of [0, 1, 3, 4, 16, 51, 52, 53, 54]) assert.throws(() => r.retainProtocolArtifact('adaptation', ordinal, bytes), /Composition-owned/);
    assert.throws(() => r.importSourceSupport({ordinal: 52, purpose: 'public-repair', artifact: over}), /bound|limit|exceeds/i);
    assert.equal(identity(r.status()), before); assert.deepEqual(f.raw.usage(), usage);
    for (const ordinal of [52, 53] as const) assert.equal(identity(r.importSourceSupport({ordinal, purpose: 'public-repair', artifact})), identity(artifact));
    const rows = r.status().proofs!.filter(p => p.kind === 'adaptation' && p.ordinal >= 52);
    assert.equal(rows.length, 2); assert.equal(rows.reduce((n, p) => n + p.bytes, 0), 2 * q);
    assert.equal(r.status().inventory.filter(i => i.artifact.sha256 === artifact.sha256).length, 1);
    const logical = r.status().proofs!.reduce((n, p) => n + p.bytes, 0), remaining = r.capacity.sourceAdmission!.slots.filter(s => !r.status().proofs!.some(p => p.kind === 'adaptation' && p.ordinal === s.ordinal));
    assert.ok(logical + remaining.reduce((n, s) => n + s.maxBytes, 0) + 202 * q <= f.plan.captureLayout!.proofPool.maxBytes);
    const committed = identity(r.status()); r.importSourceSupport({ordinal: 52, purpose: 'public-repair', artifact});
    assert.throws(() => r.importSourceSupport({ordinal: 52, purpose: 'public-repair', artifact: f.raw.putBytes(Buffer.alloc(q, 47))}), /Changed occupied/);
    assert.equal(identity(r.status()), committed);
  });
}

test('repair slots: absent source admission keeps bounded generic intake and immutable slots', t => {
  const f = controlled(t); const r = DevelopmentAcquisitionRecorder.claim({...f.options, sourceAdmission: undefined}); f.setup(r);
  const bytes = Buffer.from(canonicalJson({public: 'additional provenance'}));
  for (const ordinal of [1, 52, 53]) {const ref = r.retainProtocolArtifact('adaptation', ordinal, bytes); assert.equal(identity(r.retainProtocolArtifact('adaptation', ordinal, bytes)), identity(ref));}
  assert.throws(() => r.retainProtocolArtifact('adaptation', 52, Buffer.from('changed')), /Immutable/);
  assert.throws(() => r.retainProtocolArtifact('adaptation', 54, bytes), /Bounded/);
  assert.throws(() => r.retainProtocolArtifact('adaptation', 0, Buffer.alloc(developmentOperationalArtifactBytes + 1)), /Bounded/);
});
