import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type JsonValue } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { DerivedPolicyRegistry } from './policy-registry.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-policy-registry-')), filename = join(root, 'state.sqlite');
  const fields = { kind: 'engineering' as const, controlRevision: identity('old-controls'), requiredCases: ['independent-check'], evaluatorKeys: new Map([['reviewer', new Uint8Array(32).fill(5)]]), evaluatorArtifacts: new Map([['reviewer', identity('external-reviewer')]]) };
  const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const get = (digest: string) => { assert.equal(digest, policy.policyDigest, 'Only the original configured policy exists externally'); return policy; };
  const candidate = (control: string, descriptor = policyDescriptor(policy)) => ({ manifest: { id: identity({ control, descriptor }), controls: identity(control) }, inputs: { controls: { policy: descriptor } } } as unknown as FrozenCandidate);
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
    assert.equal(JSON.stringify(store.list('host.derived-policies')).includes('evaluatorKeys'), false, 'No signing secret is stored in public registry records');
    store.close(); store = new OperationalStore({ filename: f.filename }); registry = new DerivedPolicyRegistry(store, f.get);
    assert.equal(registry.get(second.policyDigest).controlRevision, second.controlRevision);
    assert.equal(registry.prepare(f.policy.policyDigest, f.candidate('first')).policyDigest, first.policyDigest);
    const returned = registry.get(second.policyDigest); returned.evaluatorKeys.get('reviewer')![0] = 99;
    assert.equal(registry.get(second.policyDigest).evaluatorKeys.get('reviewer')![0], 5, 'Caller cannot mutate configured keys through returned policy');
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('derived policies cannot weaken cases, replace evaluators or substitute a configured key authority', () => {
  const f = fixture(), store = new OperationalStore({ filename: f.filename });
  try {
    const registry = new DerivedPolicyRegistry(store, f.get), descriptor = policyDescriptor(f.policy);
    const changes: Record<string, JsonValue>[] = [{ requiredCases: [] }, { evaluatorArtifacts: [['reviewer', identity('author-evaluator')]] }, { evaluatorKeyDigests: [['reviewer', identity('author-key')]] }];
    for (const change of changes) assert.throws(() => registry.prepare(f.policy.policyDigest, f.candidate('changed', { ...(descriptor as Record<string, JsonValue>), ...change })), /Changed governance/);
    const next = registry.prepare(f.policy.policyDigest, f.candidate('valid'));
    const row = store.get<any>('host.derived-policies', next.policyDigest)!;
    store.put('host.derived-policies', next.policyDigest, { ...row.value, controlRevision: identity('tampered') }, row.revision);
    assert.throws(() => registry.get(next.policyDigest), /Exact host policy identity/);
    f.policy.evaluatorKeys.get('reviewer')![0] = 7;
    assert.throws(() => registry.get(f.policy.policyDigest), /Exact host policy identity/);
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
