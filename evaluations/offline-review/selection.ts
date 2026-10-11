import { identity, invariant } from '../../packages/contracts/index.ts';
import type { FrozenCandidate } from '../../packages/release/artifacts.ts';
import type { AdmissionPolicy } from '../../packages/release/admission.ts';
import { policyDescriptor } from '../../packages/release/controller.ts';
import type { ReviewerFile } from '../../deployment/evaluation-dispatch.ts';
import { governanceProposal, type SourceReviewer } from '../../deployment/reviewer-registry.ts';

export const reviewerCoreSource = 'evaluations/offline-review/review-core.ts';
export const reviewerAdapterSource = 'evaluations/offline-review/reviewer.mjs';
/** This case qualifies precisely one selected pure-core replacement, under inherited controls. */
export function verifyReviewerSelection(candidate: FrozenCandidate, value: unknown, prior: ReviewerFile, policy: AdmissionPolicy, adapterDigest: string): SourceReviewer {
  const proposal = governanceProposal(value, policyDescriptor(policy)), requested = proposal.reviewer;
  invariant(requested, 'Reviewer behavioral case requires an actual selected governance proposal');
  const controls = candidate.inputs.controls as { policy: unknown; files: { path: string; sha256: string }[] };
  const core = candidate.files.find(file => file.path === reviewerCoreSource), adapter = candidate.files.find(file => file.path === reviewerAdapterSource);
  invariant(core && controls.files.some(file => file.path === core.path && file.sha256 === core.sha256), 'Selected reviewer core must bind the frozen control closure');
  invariant(adapter?.sha256 === adapterDigest && prior.files.find(file => file.mount === '/reviewer/reviewer.mjs')?.sha256 === adapterDigest, 'Reviewer case requires unchanged prior CLI adapter');
  invariant(prior.files.some(file => file.mount === '/reviewer/review-core.ts'), 'Prior concrete reviewer core is absent');
  const expected: SourceReviewer = { evaluatorId: prior.evaluatorId, executable: prior.executable, args: prior.args,
    files: prior.files.map(({ mount, sha256 }) => mount === '/reviewer/review-core.ts' ? { mount, sha256: core.sha256, source: reviewerCoreSource } : { mount, sha256, inherit: true }) };
  const ordered = (reviewer: SourceReviewer) => ({ ...reviewer, files: [...reviewer.files].sort((a, b) => a.mount.localeCompare(b.mount)) });
  invariant(identity(ordered(requested)) === identity(ordered(expected)), 'Unsupported proposed reviewer selection; only the exact selected core may change');
  const descriptorDigest = identity({ version: 1, executable: requested.executable, args: requested.args,
    files: requested.files.map(({ mount, sha256 }) => ({ mount, sha256 })).sort((a, b) => a.mount.localeCompare(b.mount)) });
  const evaluatorArtifacts = new Map(policy.evaluatorArtifacts); evaluatorArtifacts.set(prior.evaluatorId, descriptorDigest);
  invariant(identity(proposal.policy) === identity(policyDescriptor({ ...policy, evaluatorArtifacts })) && identity(controls.policy) === identity(proposal.policy), 'Selected reviewer must bind the exact next evaluator descriptor and frozen policy');
  return requested;
}
