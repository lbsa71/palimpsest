import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson, identity, type ArtifactRef} from '../../packages/contracts/index.ts';
import {hashBytes} from '../../packages/release/artifacts.ts';
import {QualificationStore} from '../qualification/store.ts';
import {authenticate, signDocument} from '../qualification/manifest.ts';
import {DevelopmentAcquisitionRecorder, AcquisitionUnavailable, AcquisitionUseWithdrawn} from './acquire.ts';
import {domains} from './witness.ts';
import {sourceRecorderFixture} from './source-admission-recorder.test-fixture.ts';
import type {DevelopmentSourceAdmissionProof} from './development-source-admission.ts';
import {evidenceRetentionDomain, evidenceCustodianDomain, retentionSourceDigest} from './acquisition-plan.ts';
import type {OperationalStore} from '../../packages/storage/index.ts';

type Fixture = ReturnType<typeof sourceRecorderFixture>;
type RawHooks = {
  beforePut?: (bytes: Uint8Array) => void;
  beforeRead?: (artifact: ArtifactRef, maxBytes: number | undefined) => void;
};

// The production option currently names a concrete class with private members.
// This explicitly injected public adapter delegates every actual operation to the
// controlled real store; it does not replace globals or mutate the fixture store.
function rawAdapter(raw: QualificationStore, hooks: RawHooks): QualificationStore {
  return {
    directory: raw.directory, capacityBytes: raw.capacityBytes, profile: raw.profile,
    identity: () => raw.identity(), usage: () => raw.usage(),
    get usedBytes() { return raw.usedBytes; },
    claim: (id: string, grant: string, manifest: unknown) => raw.claim(id, grant, manifest),
    put: (value: unknown) => raw.put(value),
    putBytes: (bytes: Uint8Array) => { hooks.beforePut?.(bytes); return raw.putBytes(bytes); },
    readArtifact: (artifact: ArtifactRef, maxBytes?: number) => {
      hooks.beforeRead?.(artifact, maxBytes); return raw.readArtifact(artifact, maxBytes);
    },
    close: () => {},
  } as QualificationStore;
}

function controlled(t: TestContext, full = false) {
  const fixture = sourceRecorderFixture(t, full), hooks: RawHooks = {};
  const options = {...fixture.options, raw: rawAdapter(fixture.raw, hooks)};
  return {...fixture, hooks, options, claim: () => DevelopmentAcquisitionRecorder.claim(options)};
}

function interference(f: Fixture): string {
  return f.m.opportunities.find(o => o.family === 'transfer')!.interferenceIds[0]!;
}

function admitCustodian(f: Fixture, store: OperationalStore) {
  const grant = {version: 1 as const, id: 'review-custody', attemptDigest: identity(f.m), sourceDigest: retentionSourceDigest(f.plan), rawStoreDigest: identity(f.plan.rawStore), custodianId: 'review-custodian', purpose: 'public synthetic review', audiences: [`principal:${f.m.observerId}`, ...new Set(f.roles.map(r => `provider:${r.profile?.provider ?? 'mistral'}`)), ...f.m.reviewers.map(r => `reviewer:${r.id}`)], dataScope: 'complete-operational-role-sources' as const, retention: 'independent-indefinite' as const, withdrawal: 'stop-use-retain-originals' as const};
  f.plan.retention = signDocument(evidenceRetentionDomain, grant, 'issuer', f.f.keys.get('issuer')!);
  f.trust.retention = {acceptedGrantDigest: identity(grant), issuers: f.f.trust.issuers, custodianSigner: 'issuer', custodianKey: f.f.keys.get('issuer')!};
  f.options.custodian = {store, key: grant.custodianId};
  const disposition = (status: 'active' | 'withdrawn') => {
    const prior = store.get('development.evidence-custodian', grant.custodianId);
    store.put('development.evidence-custodian', grant.custodianId, signDocument(evidenceCustodianDomain, {version: 1, grantDigest: identity(grant), attemptDigest: identity(f.m), custodianId: grant.custodianId, status}, 'issuer', f.f.keys.get('issuer')!), prior?.revision ?? null);
  };
  disposition('active'); f.accept(); f.options.document = f.sign();
  return {disposition, key: grant.custodianId};
}

test('independent graph: signed cycle resolves to exact retained proof, wrapper and source events', async t => {
  const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  const result = r.recordCycle(selector);
  assert.equal(result.status, 'recorded', JSON.stringify(result));
  assert.ok(result.status === 'recorded');
  const signed = r.status().observations.find(o => o.value.id === result.observationId)!;
  const observation = authenticate(domains.observation, signed, new Map([[f.m.observerId, f.trust.envelope.behavior.observer.key]]));
  const proofBytes = r.readArtifact(result.proof, 65536);
  assert.equal(hashBytes(proofBytes), result.proof.sha256);
  const proof = JSON.parse(proofBytes.toString()) as DevelopmentSourceAdmissionProof;
  assert.equal(proofBytes.toString(), canonicalJson(proof));
  assert.equal(proof.kind, 'cycle');
  assert.ok(proof.kind === 'cycle');
  assert.equal(identity(proof.captures), identity([selector.before, selector.after]));
  assert.equal(proof.interval.lowerWallMs, Date.parse(f.f.at(60)));
  assert.equal(proof.interval.upperWallMs, Date.parse(f.f.at(61)));
  assert.equal(proof.autonomy, 'unavailable');
  const wrapper = JSON.parse(r.readArtifact(observation.artifact, 4096).toString());
  assert.equal(identity(wrapper.proof), identity(result.proof));
  assert.equal(identity(wrapper.data), identity(observation.data));
  assert.equal(wrapper.sourceAdmissionDigest, r.capacity.sourceAdmission!.digest);
  const after = r.openAcquiredCapture(selector.after);
  const selected = after.resolveEvent(proof.source.cycle.selection.sequence);
  assert.equal(selected.id, selector.selectionId);
  assert.equal(selected.type, 'selection');
  assert.ok(selected.sequence > r.openAcquiredCapture(selector.before).manifest.cut.lastSequence);
  for (const ref of proof.source.cycle.proof.versions) {
    const version = after.resolveJournalVersion(ref.versionId);
    assert.equal(identity(version.document), ref.sha256);
  }
  const beforeReplay = identity(r.status());
  assert.deepEqual(r.recordCycle(selector), result);
  assert.equal(identity(r.status()), beforeReplay);
});

for (const kind of ['assignment', 'cycle', 'experience'] as const) {
  test(`independent interval: ${kind} cannot use later current facts under a pre-ingress after cut`, async t => {
    const f = controlled(t, kind === 'experience'), r = f.claim(), source = f.setup(r);
    if (kind === 'cycle') {
      const selector = await source.cycle();
      const bad = r.recordCycle({...selector, after: selector.before});
      assert.notEqual(bad.status, 'recorded', JSON.stringify(bad));
      assert.equal(r.status().admissions!.length, 0);
      assert.equal(r.recordCycle(selector).status, 'recorded');
    } else {
      const selector = await source.assignment('interference:0', kind === 'experience');
      const bad = kind === 'assignment' ? r.inspectAssignment({...selector, after: selector.before})
        : r.recordExperience({...selector, after: selector.before, interferenceId: interference(f)});
      assert.ok(bad.status !== 'derived' && bad.status !== 'recorded', JSON.stringify(bad));
      assert.equal(r.status().admissions!.length, 0);
      const good = kind === 'assignment' ? r.inspectAssignment(selector)
        : r.recordExperience({...selector, interferenceId: interference(f)});
      assert.equal(good.status, kind === 'assignment' ? 'derived' : 'recorded', JSON.stringify(good));
    }
  });
}

test('independent origin: a real host ingestion marker without an attributed episode cannot sign experience', async t => {
  const f = controlled(t, true), r = f.claim(), source = f.setup(r), selector = await source.assignment();
  const assignment = r.inspectAssignment(selector);
  assert.ok(assignment.status === 'derived', JSON.stringify(assignment));
  const episodeId = `input:${assignment.proof.source.assignment.input.id}`;
  source.store.put('host.ingested', episodeId, true, null);
  f.setTime(12);
  const after = source.capture();
  const result = r.recordExperience({...selector, after, interferenceId: interference(f)});
  assert.notEqual(result.status, 'recorded', JSON.stringify(result));
  assert.equal(r.status().observations.filter(o => o.value.data.kind === 'experience').length, 0);
  assert.equal(r.status().admissionPending, null);
});

test('independent replay: unrelated journaled activity and a later current capture preserve the exact old proof', async t => {
  const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  const first = r.recordCycle(selector);
  assert.equal(first.status, 'recorded');
  source.store.put('review.unrelated', 'later', {note: 'not cycle evidence'}, null);
  f.setTime(62); source.capture();
  const before = identity(r.status());
  assert.deepEqual(r.recordCycle(selector), first);
  assert.equal(identity(r.status()), before);
  assert.equal(r.recordCycle({...selector, after: r.status().snapshots.at(-1)!.artifact}).status, 'failed');
});

for (const errorKind of ['plain-source-looking', 'unavailable', 'withdrawn'] as const) {
  for (const stage of ['proof', 'wrapper'] as const) {
    test(`independent pending taxonomy: ${errorKind} raw failure at ${stage} is failed, never unavailable`, async t => {
      const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
      let injected = false;
      f.hooks.beforePut = bytes => {
        const state = r.status();
        if (injected || !state.admissionPending || !state.pending) return;
        const value = JSON.parse(Buffer.from(bytes).toString());
        if (stage === 'proof' ? value.kind !== 'cycle' : value.source !== 'host-source-admission') return;
        injected = true;
        const message = 'document-history-withdrawn: injected raw persistence failure';
        throw errorKind === 'plain-source-looking' ? new Error(message)
          : errorKind === 'unavailable' ? new AcquisitionUnavailable(message) : new AcquisitionUseWithdrawn(message);
      };
      const result = r.recordCycle(selector);
      assert.equal(injected, true);
      // Assert durable safety before classification so a taxonomy failure does
      // not hide the actual recovery and authority facts.
      assert.equal(r.status().phase, 'failed');
      assert.ok(r.status().admissionPending);
      assert.ok(r.status().pending);
      assert.equal(r.status().useDisposition, null);
      assert.equal(r.status().admissions!.length, 0);
      assert.equal(r.status().observations.filter(o => o.value.data.kind === 'cycle').length, 0);
      assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted/);
      const stopped = identity(r.status());
      assert.notEqual(r.recordCycle(selector).status, 'recorded');
      assert.equal(identity(r.status()), stopped);
      source.store.put('review.fence', 'released', true, null);
      assert.equal(result.status, 'failed', JSON.stringify(result));
    });
  }
}

test('independent callbacks: swallowed write and public reentry refusals preserve a valid proof and release all fences', async t => {
  const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  let attempts = 0;
  f.hooks.beforePut = () => {
    if (!r.status().admissionPending || !r.status().pending) return;
    attempts++;
    for (const store of [f.state, source.store, f.stores.get('no-memory')!]) {
      assert.throws(() => store.put('review.callback', 'write', true, null), /writes forbidden/);
    }
    assert.throws(() => r.readArtifact(selector.before, 1048576), /reenter/);
    assert.notEqual(r.recordCycle(selector).status, 'recorded');
  };
  const result = r.recordCycle(selector);
  assert.equal(result.status, 'recorded', JSON.stringify(result));
  assert.equal(attempts, 2);
  assert.equal(r.status().useDisposition, null);
  assert.equal(r.status().admissionPending, null);
  for (const store of [f.state, source.store, f.stores.get('no-memory')!]) {
    assert.equal(store.get('review.callback', 'write'), undefined);
    store.put('review.callback', 'released', true, null);
  }
});

test('independent identity: an admission-absent claim cannot be upgraded and an enabled claim cannot be downgraded', t => {
  const absent = controlled(t);
  const legacy = DevelopmentAcquisitionRecorder.claim({...absent.options, sourceAdmission: undefined});
  assert.equal(legacy.status().sourceAdmissionDigest, undefined);
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen(absent.options), /binding/);
  const enabled = controlled(t), r = enabled.claim();
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen({...enabled.options, sourceAdmission: undefined}), /binding/);
  assert.equal(DevelopmentAcquisitionRecorder.reopen(enabled.options).status().sourceAdmissionDigest, r.status().sourceAdmissionDigest);
});

test('independent detachment: callback edits to accepted caller descriptors cannot alter the claimed policy', t => {
  const f = controlled(t, true), accepted = identity(f.admission.composition), original = f.admission.composition.maxExtractedBytes;
  let calls = 0;
  f.hooks.beforeRead = () => {
    if (calls++) return;
    f.admission.composition.maxExtractedBytes = 1;
    f.admission.trust.checker!.key.fill(199);
  };
  const r = f.claim();
  assert.ok(calls > 0);
  assert.notEqual(identity(f.admission.composition), accepted);
  assert.equal(r.capacity.sourceAdmission!.composition.maxExtractedBytes, original);
  assert.equal(r.status().proofs!.find(p => p.ordinal === 0)!.artifact.sha256, hashBytes(Buffer.from(canonicalJson(f.policy))));
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /composition|binding/);
});

test('independent reserve: accepted support aliases consume two logical charges and leave all 202 mandatory slots protected', t => {
  const f = controlled(t, true), bytes = Buffer.alloc(65536, 17), artifact = f.raw.putBytes(bytes);
  f.admission.composition.support = [52, 53].map(ordinal => ({ordinal: ordinal as 52 | 53, purpose: 'public-review-support', maxBytes: 65536, expected: artifact}));
  f.accept(); f.options.document = f.sign();
  const r = f.claim(); f.setup(r);
  assert.equal(r.capacity.sourceAdmission!.slots.length, 54);
  for (const ordinal of [52, 53] as const) r.importSourceSupport({ordinal, purpose: 'public-review-support', artifact});
  const state = r.status(), rows = state.proofs!.filter(p => p.kind === 'adaptation' && p.ordinal >= 52);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((n, p) => n + p.bytes, 0), 131072);
  assert.equal(state.inventory.filter(i => i.artifact.sha256 === artifact.sha256).length, 1);
  const remaining = r.capacity.sourceAdmission!.slots.filter(s => !state.proofs!.some(p => p.kind === 'adaptation' && p.ordinal === s.ordinal));
  assert.ok(state.proofs!.reduce((n, p) => n + p.bytes, 0) + remaining.reduce((n, s) => n + s.maxBytes, 0) + 202 * 65536 <= 16777216);
  const before = identity(r.status());
  assert.throws(() => r.retainProtocolArtifact('adaptation', 54, Buffer.from('overflow')));
  assert.equal(identity(r.status()), before);
});

test('independent current use: authentic source withdrawal stays terminal across reopen and exact replay', async t => {
  const f = controlled(t), target = f.stores.get('no-standing-goals')!;
  target.put('review.withdrawal', 'episode', {synthetic: true}, null);
  const r = f.claim(), source = f.setup(r), selector = await source.cycle();
  const result = r.recordCycle(selector); assert.equal(result.status, 'recorded');
  target.withdrawDocumentJournalContent({id: 'review-withdrawal', reason: 'forget', targets: [{namespace: 'review.withdrawal', key: 'episode', expectedRevision: 1}]});
  const count = r.status().observations.length;
  assert.equal(r.recordCycle(selector).status, 'unavailable');
  assert.equal(r.status().useDisposition!.value.status, 'document-history-withdrawn');
  const reopened = DevelopmentAcquisitionRecorder.reopen(f.options);
  assert.equal(reopened.recordCycle(selector).status, 'unavailable');
  assert.equal(reopened.status().observations.length, count);
});

test('independent pre-pending unavailability: unattached source handles do not create terminal pending failure', async t => {
  const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  const reopened = DevelopmentAcquisitionRecorder.reopen(f.options);
  const before = identity(reopened.status());
  assert.equal(reopened.recordCycle(selector).status, 'unavailable');
  assert.equal(identity(reopened.status()), before);
  assert.equal(reopened.status().phase, 'acquiring');
  assert.equal(reopened.status().admissionPending, null);
  for (const [id, value] of source.sources) reopened.attachApplication(id, value.application, value.accounting);
  assert.equal(reopened.recordCycle(selector).status, 'recorded');
});

test('independent custodian identity: adding, removing or replacing custody cannot reopen the same admission', t => {
  const plain = controlled(t), custodyStore = controlled(t).state;
  plain.claim();
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen({...plain.options, custodian: {store: custodyStore, key: 'new-custody'}}), /binding/);
  const f = controlled(t), custody = admitCustodian(f, custodyStore), r = f.claim(), replacement = controlled(t).state;
  const accepted = custodyStore.get('development.evidence-custodian', custody.key)!;
  replacement.put('development.evidence-custodian', custody.key, accepted.value, null);
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen({...f.options, custodian: undefined}), /custodian/);
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen({...f.options, custodian: {store: replacement, key: custody.key}}), /binding/);
  assert.equal(DevelopmentAcquisitionRecorder.reopen(f.options).status().sourceAdmissionDigest, r.status().sourceAdmissionDigest);
});

test('independent custodian withdrawal: real signed Store transition is unavailable before pending and cannot be revived', async t => {
  const f = controlled(t), store = controlled(t).state, custody = admitCustodian(f, store), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  custody.disposition('withdrawn');
  assert.equal(r.recordCycle(selector).status, 'unavailable');
  assert.equal(r.status().admissionPending, null);
  assert.equal(r.status().admissions!.length, 0);
  assert.equal(r.status().useDisposition!.value.status, 'withdrawn');
  custody.disposition('active');
  assert.equal(r.recordCycle(selector).status, 'unavailable');
  const reopened = DevelopmentAcquisitionRecorder.reopen(f.options);
  assert.equal(reopened.recordCycle(selector).status, 'unavailable');
  assert.equal(reopened.status().observations.filter(o => o.value.data.kind === 'cycle').length, 0);
});

test('independent preclaim identity: owner/source and custodian/source aliases are refused without claiming raw capacity', t => {
  const f = controlled(t), before = f.raw.usage();
  assert.throws(() => DevelopmentAcquisitionRecorder.claim({...f.options, state: f.original.store}), /alias|Unavailable candidate\/configuration source/);
  assert.deepEqual(f.raw.usage(), before);
  assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  admitCustodian(f, f.stores.get('no-memory')!);
  const beforeCustody = f.raw.usage();
  assert.throws(() => f.claim(), /separate from operational/);
  assert.deepEqual(f.raw.usage(), beforeCustody);
  assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
});

test('independent inert preclaim: nested support proxy and source option accessor invoke no host code', t => {
  const f = controlled(t), before = f.raw.usage();
  let effects = 0;
  const trap = () => { effects++; throw new Error('host trap executed'); };
  const proxy = new Proxy({ordinal: 52, purpose: 'public', maxBytes: 1, expected: null}, {get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap});
  const admission = {...f.admission, composition: {...f.admission.composition, support: [proxy]}};
  assert.throws(() => DevelopmentAcquisitionRecorder.claim({...f.options, sourceAdmission: admission as typeof f.admission}));
  const accessor = {...f.options};
  Object.defineProperty(accessor, 'sourceAdmission', {enumerable: true, get: trap});
  assert.throws(() => DevelopmentAcquisitionRecorder.claim(accessor));
  assert.equal(effects, 0);
  assert.deepEqual(f.raw.usage(), before);
  assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
});

test('independent reentry: refused unsigned inspection cannot poison a surrounding valid pending admission', async t => {
  const f = controlled(t), r = f.claim(), source = f.setup(r), selector = await source.cycle();
  let attempted = false;
  f.hooks.beforePut = () => {
    if (attempted || !r.status().admissionPending || !r.status().pending) return;
    attempted = true;
    const refused = r.inspectAssignment({roleId: selector.roleId, before: selector.before, after: selector.after, assignmentId: 'interference:0'});
    assert.equal(refused.status, 'unavailable');
  };
  const result = r.recordCycle(selector);
  assert.ok(attempted);
  const reopened = DevelopmentAcquisitionRecorder.reopen(f.options);
  for (const [id, value] of source.sources) reopened.attachApplication(id, value.application, value.accounting);
  const replay = reopened.recordCycle(selector);
  assert.equal(replay.status, 'recorded', JSON.stringify(replay));
  // The unsigned operation was rejected before entering a scope. Its refusal
  // must not terminalize an admission whose pending marker it did not create.
  assert.equal(result.status, 'recorded', JSON.stringify({result, replay, phase: r.status().phase, pending: r.status().admissionPending, admissions: r.status().admissions!.length, observations: r.status().observations.filter(o => o.value.data.kind === 'cycle').length}));
  assert.equal(r.status().failure, null);
  assert.equal(r.status().admissionPending, null);
  assert.equal(r.status().useDisposition, null);
});

for (const {full, ordinal} of [{full: true, ordinal: 52}, {full: true, ordinal: 53}, {full: false, ordinal: 1}]) {
  test(`independent default-deny allocation: ${full ? 'full' : 'mechanical'} policy cannot generically occupy unaccepted adaptation:${ordinal}`, t => {
    const f = controlled(t, full), r = f.claim(); f.setup(r);
    assert.deepEqual(f.admission.composition.support, []);
    const before = identity(r.status());
    // Adopted c48f0b5 permits generic use only for explicitly unassigned
    // identities. This descriptor contains no such grant; an omitted optional
    // reservation is not authorization to occupy a composition identity.
    assert.throws(() => r.retainProtocolArtifact('adaptation', ordinal, Buffer.from('unaccepted caller support')), /Composition-owned|unassigned|reserved|support/i);
    assert.equal(identity(r.status()), before);
  });
}
