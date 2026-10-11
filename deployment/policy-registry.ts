import { identity, invariant, validateCandidate } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { publicPolicy } from './reviewer-registry.ts';

const namespace = 'host.derived-policies';
interface DerivedPolicy {
  policyDigest: string; basePolicyDigest: string; priorPolicyDigest: string;
  controlRevision: string; candidateId: string; descriptor: ReturnType<typeof policyDescriptor>;
}
function checked(policy: AdmissionPolicy, digest: string): AdmissionPolicy {
  invariant(policy.policyDigest === digest && admissionPolicyIdentity(policy) === digest, 'Exact host policy identity required');
  return { ...policy, requiredCases: [...policy.requiredCases], evaluatorArtifacts: new Map(policy.evaluatorArtifacts), evaluatorKeys: new Map([...policy.evaluatorKeys].map(([id, key]) => [id, Uint8Array.from(key)])) };
}
/** Private host registry for ordinary source/control and prior-policy judged governance revisions.
 * It copies neither signing secrets nor authority into model-visible candidate settings.
 * Registering a descriptor confers no release authority; old-policy staging still judges it.
 */
export class DerivedPolicyRegistry {
  readonly store: OperationalStore;
  readonly configured: (digest: string) => AdmissionPolicy;
  readonly prepareReviewer?: (prior: AdmissionPolicy, next: AdmissionPolicy, candidate: FrozenCandidate) => void;
  constructor(store: OperationalStore, configured: (digest: string) => AdmissionPolicy, prepareReviewer?: (prior: AdmissionPolicy, next: AdmissionPolicy, candidate: FrozenCandidate) => void) { this.store = store; this.configured = configured; this.prepareReviewer = prepareReviewer; }
  get = (digest: string): AdmissionPolicy => {
    invariant(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest), 'Exact policy digest required');
    const saved = this.store.get<DerivedPolicy>(namespace, digest)?.value;
    if (!saved) return checked(this.configured(digest), digest);
    invariant(saved.policyDigest === digest && /^[a-f0-9]{64}$/.test(saved.controlRevision) && /^[a-f0-9]{64}$/.test(saved.candidateId) && saved.basePolicyDigest !== digest, 'Invalid derived host policy');
    // Each record refers directly to the configured key authority: repeated self-upgrades
    // do not introduce an unbounded recursive chain or store private key copies.
    const base = checked(this.configured(saved.basePolicyDigest), saved.basePolicyDigest);
    const descriptor = publicPolicy(saved.descriptor, policyDescriptor(base));
    return checked({ ...base, kind: descriptor.kind, requiredCases: descriptor.requiredCases, evaluatorArtifacts: new Map(descriptor.evaluatorArtifacts), controlRevision: saved.controlRevision, policyDigest: digest }, digest);
  };
  prepare(priorDigest: string, candidate: FrozenCandidate): AdmissionPolicy {
    const prior = this.get(priorDigest);
    validateCandidate(candidate.manifest);
    invariant(identity(candidate.inputs.controls) === candidate.manifest.controls, 'Exact candidate control identity required');
    const descriptor = publicPolicy((candidate.inputs.controls as { policy?: unknown }).policy, policyDescriptor(prior));
    const changed = identity(descriptor) !== identity(policyDescriptor(prior));
    invariant(!changed || this.prepareReviewer, 'Changed governance requires a source-bound reviewer registry');
    const fields = { ...prior, kind: descriptor.kind, requiredCases: descriptor.requiredCases, evaluatorArtifacts: new Map(descriptor.evaluatorArtifacts), controlRevision: candidate.manifest.controls };
    const next = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    if (next.policyDigest === priorDigest) return prior;
    const parent = this.store.get<DerivedPolicy>(namespace, priorDigest)?.value;
    const basePolicyDigest = parent?.basePolicyDigest ?? priorDigest;
    // Returning to the original controls reuses their configured policy. Persisting a
    // derivation here would shadow that authority with an invalid self-reference.
    if (next.policyDigest === basePolicyDigest) return this.get(basePolicyDigest);
    this.prepareReviewer?.(prior, next, candidate);
    const value: DerivedPolicy = { policyDigest: next.policyDigest, basePolicyDigest,
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
