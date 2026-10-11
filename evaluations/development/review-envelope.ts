import type { ArtifactRef, PhysicalRequest, ResourceEnvelope, ResourceUsage } from '../../packages/contracts/index.ts';
import type { ModelProfile } from '../../deployment/model-grants.ts';
import type { Signed } from '../qualification/manifest.ts';
import type { Accounting, BoundedArtifactReader, CollectedDevelopment, DevelopmentAttempt, DevelopmentObservation, DevelopmentReview, DevelopmentTrust, Finding, ProposedDevelopment } from './witness.ts';

export const reviewEnvelopeDomains = Object.freeze({
  registration: 'aeon.development.registration.v2', behavior: 'aeon.development.behavior.v2',
  review: 'aeon.development.review-binding.v2', tail: 'aeon.development.accounting-tail.v2',
  closure: 'aeon.development.closure.v2', settlement: 'aeon.development.settlement.v2',
});
export interface DevelopmentRoleBinding {
  id: string; kind: 'candidate' | 'control' | 'reviewer' | 'observer'; assignmentId: string | null;
  allocationId: string; configurationDigest: string; closureDigest: string;
  profile: ModelProfile | null; allowedEffects: string[]; resources: ResourceEnvelope;
}
export interface DevelopmentRequestState {
  rootId: string; roleId: string; configurationDigest: string; closureDigest: string;
  allocationPath: string[]; observedAt: string; request: PhysicalRequest;
  ceiling: { tokens: number; costUsd: number; elapsedMs: number };
  charged: { tokens: number; costUsd: number; elapsedMs: number };
  payload: ArtifactRef; prompt: ArtifactRef | null;
}
export interface DevelopmentRegistration {
  version: 2; attemptDigest: string; rootId: string; registeredAt: string; reviewDeadlineAt: string;
  observerClosureDigest: string; closureVerifierDigest: string; assignmentDigest: string;
  roles: DevelopmentRoleBinding[]; originalRequests: DevelopmentRequestState[];
}
/** Signed original bytes plus an explicitly derived behavioral view. No v1 wire reinterpretation. */
export interface DevelopmentBehavior {
  version: 2; registrationDigest: string; frozenAt: string;
  manifest: Signed<DevelopmentAttempt>; observations: Signed<DevelopmentObservation>[];
  requests: DevelopmentRequestState[]; evidence: CollectedDevelopment;
  artifactIndex: { artifact: ArtifactRef; bytes: number }[];
}
export interface DevelopmentReviewBinding {
  version: 2; registrationDigest: string; behaviorDigest: string; roleId: string;
  review: Signed<DevelopmentReview>;
}
/** Host transport attestation, never candidate/reviewer-reported usage. */
export interface DevelopmentSettlement {
  version: 2; registrationDigest: string; requestIdentityDigest: string; observedAt: string;
  dispatched: boolean; status: 'succeeded' | 'failed' | 'uncertain'; usage: ResourceUsage;
  response: ArtifactRef | null;
}
export interface DevelopmentAccountingTransition {
  beforeDigest: string | null; state: DevelopmentRequestState;
  settlement: Signed<DevelopmentSettlement> | null;
}
export interface DevelopmentAccountingTail {
  version: 2; registrationDigest: string; behaviorDigest: string;
  transitions: DevelopmentAccountingTransition[];
}
export interface DevelopmentClosure {
  version: 2; registrationDigest: string; behaviorDigest: string; tailDigest: string;
  reviewDigests: string[]; closedAt: string;
  requestStates: { id: string; stateDigest: string }[]; accounting: Accounting;
}
/** Accepted external configuration; these digests are not supplied by the candidate. */
export interface DevelopmentEnvelopeTrust {
  acceptedRegistrationDigest: string; behavior: DevelopmentTrust;
  acceptedRoles: ReadonlyMap<string, string>;
  closure: { id: string; key: Uint8Array; verifierDigest: string };
  transports: ReadonlyMap<string, Uint8Array>;
}
export interface DevelopmentReviewEnvelope {
  version: 2; registration: Signed<DevelopmentRegistration>; behavior: Signed<DevelopmentBehavior>;
  reviews: Signed<DevelopmentReviewBinding>[]; accountingTail: Signed<DevelopmentAccountingTail>;
  closure: Signed<DevelopmentClosure> | null;
}
export interface ProposedDevelopmentEnvelope {
  kind: 'proposed-development-review-envelope'; version: 2; envelope: DevelopmentReviewEnvelope;
  behaviorDigest: string; behavioralReview: ProposedDevelopment | null; finalAccounting: Accounting | null;
  findings: Finding[]; status: ProposedDevelopment['status'];
  automaticReleaseEligible: false; h1Eligible: false;
}
export type DevelopmentEnvelopeReader = BoundedArtifactReader;
