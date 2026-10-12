import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {identity, type ArtifactRef} from '../../packages/contracts/index.ts';
import {OperationalStore} from '../../packages/storage/index.ts';
import {QualificationStore} from '../qualification/store.ts';
import {AcquisitionUnavailable, AcquisitionUseWithdrawn, DevelopmentAcquisitionRecorder} from './acquire.ts';
import {sourceRecorderFixture} from './source-admission-recorder.test-fixture.ts';

type State = ReturnType<DevelopmentAcquisitionRecorder['status']>;
type Hooks = {put?: (bytes: Uint8Array) => void; read?: (ref: ArtifactRef) => void; afterOwnerPut?: (value: State) => void};
class ReviewOwner extends OperationalStore {
  readonly hooks: Hooks;
  constructor(filename: string, hooks: Hooks) {super({filename}); this.hooks = hooks;}
  override put(namespace: string, key: string, value: unknown, revision: number | null): number {
    const result = super.put(namespace, key, value, revision);
    if (namespace === 'development.acquisition') this.hooks.afterOwnerPut?.(value as State);
    return result;
  }
}
function fixture(t: TestContext, full = false, support = true) {
  const f = sourceRecorderFixture(t, full), hooks: Hooks = {};
  const state = new ReviewOwner(f.state.filename, hooks); t.after(() => state.close());
  const bytes = Buffer.from('independent exact public support\n'), artifact = f.raw.putBytes(bytes);
  if (support) {
    f.admission.composition.support = [{ordinal: 52, purpose: 'rereview-public', maxBytes: 65536, expected: artifact}];
    f.accept(); f.options.document = f.sign();
  }
  const raw = f.raw;
  const adapter = {
    directory: raw.directory, capacityBytes: raw.capacityBytes, profile: raw.profile,
    identity: () => raw.identity(), usage: () => raw.usage(), get usedBytes() {return raw.usedBytes;},
    claim: (id: string, grant: string, manifest: unknown) => raw.claim(id, grant, manifest),
    put: (value: unknown) => raw.put(value),
    putBytes: (value: Uint8Array) => {hooks.put?.(value); return raw.putBytes(value);},
    readArtifact: (ref: ArtifactRef, limit?: number) => {hooks.read?.(ref); return raw.readArtifact(ref, limit);},
    close() {},
  } as QualificationStore;
  const options = {...f.options, state, raw: adapter};
  return {...f, state, hooks, options, bytes, artifact,
    request: {ordinal: 52 as const, purpose: 'rereview-public', artifact},
    claim: () => DevelopmentAcquisitionRecorder.claim(options)};
}
function attach(r: DevelopmentAcquisitionRecorder, source: ReturnType<ReturnType<typeof sourceRecorderFixture>['setup']>) {
  for (const [id, value] of source.sources) r.attachApplication(id, value.application, value.accounting);
}

for (const error of [new AcquisitionUnavailable('document-history-withdrawn: unavailable callback'), new AcquisitionUseWithdrawn('document-history-withdrawn: withdrawn callback'), {failure: 'non-Error persistence'}]) {
  test(`rereview cause: post-pending ${error instanceof Error ? error.constructor.name : 'non-Error'} preserves exact cause and durable failure`, t => {
    const f = fixture(t), r = f.claim(), source = f.setup(r);
    let fired = false;
    f.hooks.put = bytes => {
      if (!fired && Buffer.from(bytes).equals(f.bytes)) {
        assert.ok(r.status().pending); assert.ok(r.status().admissionPending);
        fired = true; f.raw.putBytes(bytes); throw error;
      }
    };
    assert.throws(() => r.importSourceSupport(f.request), e => e instanceof Error && !(e instanceof AcquisitionUnavailable) && e.cause === error);
    assert.ok(fired); const stopped = r.status();
    assert.equal(stopped.phase, 'failed'); assert.ok(stopped.failure); assert.ok(stopped.pending); assert.ok(stopped.admissionPending);
    assert.equal(stopped.useDisposition, null); assert.equal(stopped.proofs!.some(p => p.ordinal === 52), false);
    assert.equal(stopped.inventory.some(i => i.artifact.sha256 === f.artifact.sha256), false);
    assert.deepEqual(f.raw.readArtifact(f.artifact, 65536), f.bytes);
    const terminal = JSON.parse(f.raw.readArtifact(stopped.failure, r.capacity.terminalRawBytes).toString());
    assert.equal(terminal.code, 'source-admission-pending');
    assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted/);
    f.hooks.put = undefined;
    assert.throws(() => r.importSourceSupport(f.request), AcquisitionUnavailable);
    assert.equal(identity(r.status()), identity(stopped));
    f.state.put('rereview.released', 'owner', true, null); source.store.put('rereview.released', 'source', true, null);
  });
}

test('rereview marker rollback: throw after actual terminal owner write preserves pending and cannot be retried into success', t => {
  const f = fixture(t), r = f.claim(), source = f.setup(r), original = new AcquisitionUseWithdrawn('raw callback failed');
  let persistedAttempt = false, failureRaw: ArtifactRef | null = null;
  f.hooks.put = bytes => {if (Buffer.from(bytes).equals(f.bytes)) throw original;};
  f.hooks.afterOwnerPut = value => {
    if (value.phase === 'failed') {
      assert.equal(f.state.get<State>('development.acquisition', f.plan.id)!.value.phase, 'failed');
      persistedAttempt = true; failureRaw = value.failure; throw new Error('injected terminal owner failure after write');
    }
  };
  assert.throws(() => r.importSourceSupport(f.request), e => e instanceof Error && e.cause === original);
  assert.ok(persistedAttempt); assert.ok(failureRaw); assert.ok(f.raw.readArtifact(failureRaw, r.capacity.terminalRawBytes).length);
  const stopped = r.status(); assert.equal(stopped.phase, 'acquiring'); assert.equal(stopped.failure, null);
  assert.ok(stopped.pending); assert.ok(stopped.admissionPending); assert.equal(stopped.useDisposition, null);
  f.hooks.afterOwnerPut = undefined; f.hooks.put = undefined;
  assert.throws(() => r.assertCurrentUse(), /conservatively refused/);
  assert.throws(() => r.importSourceSupport(f.request), /pending|stopped/);
  assert.equal(identity(r.status()), identity(stopped));
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted/);
  f.state.put('rereview.released', 'owner', true, null); source.store.put('rereview.released', 'source', true, null);
});

for (const stage of ['read-before-pending', 'write-after-pending'] as const) {
  test(`rereview reentry: ${stage} support callback cannot poison outer import or later cycle and withdrawn replay`, async t => {
    const f = fixture(t), target = f.stores.get('no-memory')!;
    target.put('rereview.withdrawal', 'source', {public: true}, null);
    const r = f.claim(), source = f.setup(r); let called = false;
    const callback = () => {
      if (called) return; called = true;
      assert.equal(Boolean(r.status().admissionPending), stage === 'write-after-pending');
      const before = identity(r.status());
      const cut = r.status().snapshots.find(s => s.roleId === 'candidate')!.artifact;
      assert.equal(r.inspectAssignment({roleId: 'candidate', assignmentId: 'interference:0', before: cut, after: cut}).status, 'unavailable');
      assert.throws(() => r.importSourceSupport(f.request), /reentrant/);
      for (const store of [f.state, source.store, target, f.original.store]) assert.throws(() => store.put('rereview.forbidden', 'callback', true, null), /writes forbidden/);
      assert.equal(identity(r.status()), before);
    };
    if (stage === 'read-before-pending') f.hooks.read = ref => {if (ref.sha256 === f.artifact.sha256) callback();};
    else f.hooks.put = bytes => {if (Buffer.from(bytes).equals(f.bytes)) callback();};
    assert.equal(identity(r.importSourceSupport(f.request)), identity(f.artifact)); assert.ok(called);
    f.hooks.read = undefined; f.hooks.put = undefined;
    const selector = await source.cycle(), result = r.recordCycle(selector); assert.equal(result.status, 'recorded');
    const before = identity(r.status()), usage = f.raw.usage();
    assert.equal(identity(r.importSourceSupport(f.request)), identity(f.artifact)); assert.deepEqual(r.recordCycle(selector), result);
    assert.equal(identity(r.status()), before); assert.deepEqual(f.raw.usage(), usage);
    const reopened = DevelopmentAcquisitionRecorder.reopen(f.options); attach(reopened, source);
    assert.deepEqual(reopened.recordCycle(selector), result); assert.equal(identity(reopened.importSourceSupport(f.request)), identity(f.artifact));
    target.withdrawDocumentJournalContent({id: `rereview-${stage}`, reason: 'forget', targets: [{namespace: 'rereview.withdrawal', key: 'source', expectedRevision: 1}]});
    assert.equal(reopened.recordCycle(selector).status, 'unavailable');
    assert.equal(reopened.status().useDisposition!.value.status, 'document-history-withdrawn');
    assert.throws(() => reopened.importSourceSupport(f.request), AcquisitionUseWithdrawn);
    assert.equal(reopened.status().admissionPending, null);
  });
}

for (const ErrorType of [AcquisitionUnavailable, AcquisitionUseWithdrawn]) {
  test(`rereview before pending: typed support ${ErrorType.name} read failure remains original and retryable`, t => {
    const f = fixture(t), r = f.claim(); f.setup(r); const before = identity(r.status()), usage = f.raw.usage();
    const error = new ErrorType('document-history-withdrawn: public raw read unavailable');
    f.hooks.read = ref => {if (ref.sha256 === f.artifact.sha256) throw error;};
    assert.throws(() => r.importSourceSupport(f.request), e => e === error);
    assert.equal(identity(r.status()), before); assert.deepEqual(f.raw.usage(), usage);
    f.hooks.read = undefined; assert.equal(identity(r.importSourceSupport(f.request)), identity(f.artifact));
    assert.equal(r.status().failure, null); assert.equal(r.status().useDisposition, null);
  });
}

for (const full of [false, true]) {
  test(`rereview default deny: every ${full ? 'full' : 'mechanical'} generic adaptation identity refuses without an explicit grant`, t => {
    const f = fixture(t, full, false), r = f.claim(); f.setup(r);
    assert.deepEqual(f.admission.composition.support, []);
    const before = identity(r.status()), usage = f.raw.usage();
    for (let ordinal = -1; ordinal <= 54; ordinal++) assert.throws(() => r.retainProtocolArtifact('adaptation', ordinal, f.bytes), /Composition-owned/);
    assert.equal(identity(r.status()), before); assert.deepEqual(f.raw.usage(), usage);
  });
}

test('rereview explicit support: typed authority remains distinct from generic calls after reopen', t => {
  const f = fixture(t), r = f.claim(), source = f.setup(r); r.importSourceSupport(f.request);
  const reopened = DevelopmentAcquisitionRecorder.reopen(f.options); attach(reopened, source);
  const before = identity(reopened.status()), usage = f.raw.usage();
  assert.throws(() => reopened.retainProtocolArtifact('adaptation', 52, f.bytes), /Composition-owned/);
  assert.equal(identity(reopened.importSourceSupport(f.request)), identity(f.artifact));
  assert.equal(identity(reopened.status()), before); assert.deepEqual(f.raw.usage(), usage);
});

test('rereview absent admission: immutable generic support persists through reopen without granting source authority', t => {
  const f = fixture(t, false, false), options = {...f.options, sourceAdmission: undefined};
  const r = DevelopmentAcquisitionRecorder.claim(options), source = f.setup(r);
  const artifact = r.retainProtocolArtifact('adaptation', 53, f.bytes);
  const reopened = DevelopmentAcquisitionRecorder.reopen(options); attach(reopened, source);
  const before = identity(reopened.status()), usage = f.raw.usage();
  assert.deepEqual(reopened.retainProtocolArtifact('adaptation', 53, f.bytes), artifact);
  assert.throws(() => reopened.retainProtocolArtifact('adaptation', 53, Buffer.from('different')), /Immutable/);
  assert.throws(() => reopened.retainProtocolArtifact('adaptation', 54, f.bytes), /Bounded/);
  assert.equal(identity(reopened.status()), before); assert.deepEqual(f.raw.usage(), usage);
});
