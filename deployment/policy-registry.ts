import { identity, invariant } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import type { OperationalStore } from '../packages/storage/index.ts';

const namespace = 'host.derived-policies';
interface DerivedPolicy {
  policyDigest: string; basePolicyDigest: string; priorPolicyDigest: string;
  controlRevision: string; candidateId: string; descriptor: ReturnType<typeof policyDescriptor>;
}
function checked(policy: AdmissionPolicy, digest: string): AdmissionPolicy {
  invariant(policy.policyDigest === digest && admissionPolicyIdentity(policy) === digest, 'Exact host policy identity required');
  return { ...policy, requiredCases: [...policy.requiredCases], evaluatorArtifacts: new Map(policy.evaluatorArtifacts), evaluatorKeys: new Map([...policy.evaluatorKeys].map(([id, key]) => [id, Uint8Array.from(key)])) };
}
/** Private host registry for ordinary source/control revisions with unchanged judging rules.
 * It copies neither signing secrets nor authority into model-visible candidate settings.
 * Registering a descriptor confers no release authority; old-policy staging still judges it.
 */
export class DerivedPolicyRegistry {
  readonly store: OperationalStore;
  readonly configured: (digest: string) => AdmissionPolicy;
  constructor(store: OperationalStore, configured: (digest: string) => AdmissionPolicy) { this.store = store; this.configured = configured; }
  get = (digest: string): AdmissionPolicy => {
    invariant(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest), 'Exact policy digest required');
    const saved = this.store.get<DerivedPolicy>(namespace, digest)?.value;
    if (!saved) return checked(this.configured(digest), digest);
    invariant(saved.policyDigest === digest && /^[a-f0-9]{64}$/.test(saved.controlRevision) && /^[a-f0-9]{64}$/.test(saved.candidateId) && saved.basePolicyDigest !== digest, 'Invalid derived host policy');
    // Each record refers directly to the configured key authority: repeated self-upgrades
    // do not introduce an unbounded recursive chain or store private key copies.
    const base = checked(this.configured(saved.basePolicyDigest), saved.basePolicyDigest);
    invariant(identity(policyDescriptor(base)) === identity(saved.descriptor), 'Derived policy changed its judging rules');
    return checked({ ...base, controlRevision: saved.controlRevision, policyDigest: digest }, digest);
  };
  prepare(priorDigest: string, candidate: FrozenCandidate): AdmissionPolicy {
    const prior = this.get(priorDigest);
    invariant(/^[a-f0-9]{64}$/.test(candidate.manifest.id) && /^[a-f0-9]{64}$/.test(candidate.manifest.controls), 'Exact candidate control identity required');
    const descriptor = policyDescriptor(prior);
    invariant(identity((candidate.inputs.controls as { policy?: unknown }).policy) === identity(descriptor), 'Changed governance requires a separately qualified host policy');
    const fields = { ...prior, controlRevision: candidate.manifest.controls };
    const next = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    if (next.policyDigest === priorDigest) return prior;
    const parent = this.store.get<DerivedPolicy>(namespace, priorDigest)?.value;
    const value: DerivedPolicy = { policyDigest: next.policyDigest, basePolicyDigest: parent?.basePolicyDigest ?? priorDigest,
      priorPolicyDigest: priorDigest, controlRevision: candidate.manifest.controls, candidateId: candidate.manifest.id, descriptor };
    this.store.transaction(() => {
      const existing = this.store.get<DerivedPolicy>(namespace, next.policyDigest);
      // Different source manifests can share the same control closure; the policy identity
      // binds judging rules and controls, while each release separately binds its candidate.
      if (existing) invariant(existing.value.basePolicyDigest === value.basePolicyDigest && identity(existing.value.descriptor) === identity(value.descriptor) && existing.value.controlRevision === value.controlRevision, 'Conflicting derived policy identity');
      else this.store.put(namespace, value.policyDigest, value, null);
    });
    return this.get(next.policyDigest);
  }
}
