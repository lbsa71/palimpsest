import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { candidateIdentity, identity, type JsonValue } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { DerivedPolicyRegistry } from './policy-registry.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-policy-registry-')), filename = join(root, 'state.sqlite');
  const rules = { kind: 'engineering' as const, requiredCases: ['independent-check'], evaluatorKeys: new Map([['reviewer', new Uint8Array(32).fill(5)]]), evaluatorArtifacts: new Map([['reviewer', identity('external-reviewer')]]) };
  const fields = { ...rules, controlRevision: identity({ source: 'original', policy: policyDescriptor(rules) }) };
  const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const get = (digest: string) => { assert.equal(digest, policy.policyDigest, 'Only the original configured policy exists externally'); return policy; };
  const candidate = (control: string, descriptor = policyDescriptor(policy)): FrozenCandidate => {
    const inputs = { dependencies: {}, prompts: {}, model: {}, configuration: {}, controls: { source: control, policy: descriptor }, createdBy: 'author' };
    const manifest = { source: identity([]), dependencies: identity(inputs.dependencies), prompts: identity(inputs.prompts), model: identity(inputs.model), configuration: identity(inputs.configuration), controls: identity(inputs.controls), createdBy: inputs.createdBy };
    return { manifest: { ...manifest, id: candidateIdentity(manifest) }, inputs, files: [] };
  };
  return { root, filename, policy, get, candidate };
}
test('successor source revisions retain exact old judging rules across restart without manual per-revision registration', () => {
  const f = fixture(); let store = new OperationalStore({ filename: f.filename });
  try {
    let registry = new DerivedPolicyRegistry(store, f.get);
    const first = registry.prepare(f.policy.policyDigest, f.candidate('first'));
    assert.notEqual(first.policyDigest, f.policy.policyDigest); assert.deepEqual(policyDescriptor(first), policyDescriptor(f.policy));
    const second = registry.prepare(first.policyDigest, f.candidate('second'));
    assert.equal(store.list('host.derived-policies').length, 2);
    assert.equal(store.list<{ basePolicyDigest: string }>('host.derived-policies').every(row => row.value.basePolicyDigest === f.policy.policyDigest), true);
    assert.equal(JSON.stringify(store.list('host.derived-policies')).includes('evaluatorKeys'), false, 'Registry records retain public descriptors, never signing keys');
    store.close(); store = new OperationalStore({ filename: f.filename }); registry = new DerivedPolicyRegistry(store, f.get);
    assert.equal(registry.get(second.policyDigest).controlRevision, second.controlRevision);
    assert.equal(registry.prepare(f.policy.policyDigest, f.candidate('first')).policyDigest, first.policyDigest);
    for (const digest of [f.policy.policyDigest, first.policyDigest, second.policyDigest]) {
      const expected = policyDescriptor(registry.get(digest)), returned = registry.get(digest);
      returned.evaluatorKeys.get('reviewer')![0] = 99;
      (returned.evaluatorKeys as Map<string, Uint8Array>).clear();
      (returned.evaluatorArtifacts as Map<string, string>).set('reviewer', identity('replacement'));
      returned.requiredCases.length = 0;
      assert.deepEqual(policyDescriptor(registry.get(digest)), expected, 'Returned arrays, maps and key bytes cannot mutate configured or retained policy');
    }
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('shared control closures are idempotent while conflicting retained records fail closed', () => {
  const f = fixture(), store = new OperationalStore({ filename: f.filename });
  try {
    const registry = new DerivedPolicyRegistry(store, f.get), first = f.candidate('first');
    const next = registry.prepare(f.policy.policyDigest, first);
    const another = f.candidate('first'); another.manifest.source = identity('different-source');
    const { id: _, ...manifest } = another.manifest; another.manifest.id = candidateIdentity(manifest);
    assert.notEqual(first.manifest.id, another.manifest.id);
    const original = store.get<any>('host.derived-policies', next.policyDigest)!;
    assert.equal(registry.prepare(f.policy.policyDigest, another).policyDigest, next.policyDigest);
    assert.deepEqual(store.get('host.derived-policies', next.policyDigest), original);
    const conflicting = { ...original.value, descriptor: { ...original.value.descriptor, requiredCases: [] } };
    store.put('host.derived-policies', next.policyDigest, conflicting, original.revision);
    assert.throws(() => registry.get(next.policyDigest), /changed its judging rules/);
    assert.throws(() => registry.prepare(f.policy.policyDigest, first), /Conflicting derived policy/);
    assert.deepEqual(store.get('host.derived-policies', next.policyDigest)!.value, conflicting, 'Failed registration never overwrites conflicting evidence');
    assert.throws(() => registry.get('not-a-digest'), /Exact policy digest/);
    assert.throws(() => registry.get(identity('unknown')), /Only the original configured policy/);
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('returning to configured controls never shadows the original policy, including after restart', () => {
  const f = fixture(); let store = new OperationalStore({ filename: f.filename });
  try {
    let registry = new DerivedPolicyRegistry(store, f.get);
    const first = registry.prepare(f.policy.policyDigest, f.candidate('first'));
    const second = registry.prepare(first.policyDigest, f.candidate('second'));
    assert.equal(registry.prepare(second.policyDigest, f.candidate('original')).policyDigest, f.policy.policyDigest);
    assert.equal(store.get('host.derived-policies', f.policy.policyDigest), undefined);
    assert.equal(store.list('host.derived-policies').length, 2);
    store.close(); store = new OperationalStore({ filename: f.filename }); registry = new DerivedPolicyRegistry(store, f.get);
    assert.deepEqual(registry.get(f.policy.policyDigest), f.policy);
    assert.equal(registry.prepare(f.policy.policyDigest, f.candidate('first')).policyDigest, first.policyDigest);
    assert.equal(registry.prepare(second.policyDigest, f.candidate('first')).policyDigest, first.policyDigest);
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('registration rejects mismatched immutable candidate and control identities without persisting records', () => {
  const f = fixture(), store = new OperationalStore({ filename: f.filename });
  try {
    const registry = new DerivedPolicyRegistry(store, f.get);
    const wrongManifest = f.candidate('first'); wrongManifest.manifest.id = identity('forged-id');
    const wrongControls = f.candidate('first'); wrongControls.inputs.controls = f.candidate('second').inputs.controls;
    for (const candidate of [wrongManifest, wrongControls]) {
      assert.throws(() => registry.prepare(f.policy.policyDigest, candidate), /identity|control/i);
      assert.equal(store.list('host.derived-policies').length, 0);
    }
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('derived policies cannot weaken cases, replace evaluators or substitute a configured key authority', () => {
  const f = fixture(), store = new OperationalStore({ filename: f.filename });
  try {
    const registry = new DerivedPolicyRegistry(store, f.get), descriptor = policyDescriptor(f.policy);
    const changes: Record<string, JsonValue>[] = [{ requiredCases: [] }, { kind: 'product' }, { evaluatorArtifacts: [['reviewer', identity('author-evaluator')]] }, { evaluatorKeyDigests: [['reviewer', identity('author-key')]] }, { extraAuthority: true }];
    for (const change of changes) assert.throws(() => registry.prepare(f.policy.policyDigest, f.candidate('changed', { ...(descriptor as Record<string, JsonValue>), ...change })), /Changed governance/);
    const next = registry.prepare(f.policy.policyDigest, f.candidate('valid'));
    const row = store.get<any>('host.derived-policies', next.policyDigest)!;
    store.put('host.derived-policies', next.policyDigest, { ...row.value, controlRevision: identity('tampered') }, row.revision);
    assert.throws(() => registry.get(next.policyDigest), /Exact host policy identity/);
    f.policy.evaluatorKeys.get('reviewer')![0] = 7;
    assert.throws(() => registry.get(f.policy.policyDigest), /Exact host policy identity/);
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
