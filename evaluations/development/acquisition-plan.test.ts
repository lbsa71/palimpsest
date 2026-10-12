import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateIdentity, identity } from '../../packages/contracts/index.ts';
import { signDocument } from '../qualification/manifest.ts';
import { evidenceRetentionDomain, retentionSourceDigest, acquisitionCapacity, acquisitionPlanDomain, verifyAcquisitionPlan, type AcquisitionPlanTrust, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';

/** Explicitly synthetic facts/keys; no qualification or actual host access. */
export function syntheticAcquisitionPlanFixture() {
  const f = syntheticWitnessFixture(), m = f.m;
  m.limits = { maxRecords: 512, maxArtifactBytes: 1_000_000, maxEvidenceBytes: 8 * 1024 * 1024 };
  m.grant.originalAccounting = { grantId: m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 3000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] };
  const configuration = JSON.parse(Buffer.from(f.reader(m.configurationArtifact, 10000)).toString('utf8'));
  const roles: DevelopmentRoleBinding[] = ['candidate', ...m.controls.map(c => c.id), ...m.reviewers.map(r => r.id)].map((id, i) => ({ id, kind: i === 0 ? 'candidate' : i <= m.controls.length ? 'control' : 'reviewer', assignmentId: i === 0 ? null : id, allocationId: `role:${id}`, configurationDigest: m.candidate.configuration, closureDigest: identity({ id, synthetic: 'closure' }), profile: configuration.model, allowedEffects: ['fixture_read'], resources: m.grant.resources }));
  const assignmentPacket = f.put({ version: 1, assignments: [] });
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: f.at(290), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('synthetic closure verifier'), assignmentDigest: assignmentPacket.sha256, roles, originalRequests: [] };
  const plan: DevelopmentAcquisitionPlan = { version: 1, id: 'synthetic-acquisition', manifest: f.manifest(), registration: signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!), assignmentPacket, originalStateFile: '/tmp/aeon-acquisition/original.sqlite', closures: { node: identity('synthetic node'), dependencies: m.candidate.dependencies, prompts: m.candidate.prompts, tools: identity('synthetic tools'), acquisition: m.acquisitionDigest }, rawStore: { directory: '/tmp/aeon-acquisition/raw', device: '1', inode: '2', uid: '3', capacityBytes: 32 * 1024 * 1024 }, roles: roles.map(r => ({ roleId: r.id, stateFile: `/tmp/aeon-acquisition/${r.id === 'candidate' ? 'original' : r.id}.sqlite`, workspace: `/tmp/aeon-acquisition/work-${r.id}`, configuration: m.configurationArtifact, closure: f.put({ id: r.id, synthetic: 'closure' }), journal: null, maxDrafts: 1, maxPayloadBytes: 5000, maxPromptBytes: 5000, maxFragmentBytes: 1000, maxResponseBytes: 1000 })), capacity: { captureBytes: 6100000, maxSnapshots: 20, maxSnapshotBytes: 300000, envelopeBytes: 200000, transitionBytes: 5000, failureBytes: 4096, inventoryEntryBytes: 256, maxArtifacts: 256, maxObservations: 128 } };
  const trust: AcquisitionPlanTrust = { acceptedPlanDigest: identity(plan), issuers: f.trust.issuers, envelope: { acceptedRegistrationDigest: identity(registration), behavior: { ...f.trust, acceptedAttemptDigest: identity(m) }, acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'closer', key: Buffer.alloc(32, 9), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['transport', Buffer.alloc(32, 10)]]) } };
  const sign = () => signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!);
  const accept = () => { plan.registration = signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!); plan.manifest = f.manifest(); registration.attemptDigest = identity(m); trust.acceptedPlanDigest = identity(plan); trust.envelope.acceptedRegistrationDigest = identity(registration); trust.envelope.behavior.acceptedAttemptDigest = identity(m); trust.envelope.acceptedRoles = new Map(roles.map(r => [r.id, identity(r)])); };
  return { f, m, roles, registration, plan, trust, sign, accept, verify: () => verifyAcquisitionPlan(sign(), trust, f.reader, Date.parse(m.registeredAt)) };
}

test('finite plan covers candidate, all fixed controls, two reviewers and all future evidence pools', () => {
  const f = syntheticAcquisitionPlanFixture(), result = f.verify(); assert.equal(result.capacity.maxRequests, 8); assert.equal(result.capacity.records, 434); assert.equal(result.plan.manifest.value.evidenceKind, 'synthetic'); assert.ok(result.capacity.totalBytes < f.m.limits.maxEvidenceBytes);
});
test('huge maximum payloads fail capacity before claim or receiver execution', () => {
  const f = syntheticAcquisitionPlanFixture(); f.plan.roles.forEach(r => { r.maxDrafts = 2; r.maxPayloadBytes = 1_000_000; }); f.accept(); assert.throws(f.verify, /cannot cover/);
});
test('store size does not increase unchanged signed attempt evidence allowance', () => {
  const f = syntheticAcquisitionPlanFixture(); f.m.limits.maxEvidenceBytes = 500000; f.accept(); assert.throws(() => acquisitionCapacity(f.plan), /cannot cover/);
});
test('changed assignment bytes cannot inherit original registration', () => {
  const f = syntheticAcquisitionPlanFixture(); f.plan.assignmentPacket = f.f.put({ version: 1, assignments: ['changed'] }); f.accept(); assert.throws(f.verify, /Assignment packet changed/);
});
test('control same budget digest with changed real resource envelope fails', () => {
  const f = syntheticAcquisitionPlanFixture(); f.roles[1]!.resources = { ...f.roles[1]!.resources, maxTokens: 1 }; f.accept(); assert.throws(f.verify, /unmatched/);
});
test('state or workspace reuse cannot make an isolated control', () => {
  const f = syntheticAcquisitionPlanFixture(); f.plan.roles[1]!.stateFile = f.plan.roles[0]!.stateFile; f.accept(); assert.throws(f.verify, /isolated/);
});
test('missing source bytes and changed loaded context configuration cannot pass', () => {
  const f = syntheticAcquisitionPlanFixture(); f.f.artifacts.delete(f.m.candidateArtifact.sha256); assert.throws(f.verify, /source/);
  const changed = syntheticAcquisitionPlanFixture(); changed.plan.roles[0]!.configuration = changed.f.put({ scheduler: { windowMs: 60000 }, model: { contextWindow: 1 } }); changed.accept(); assert.throws(changed.verify, /configuration\/closure changed/);
});
test('late initial registration and forged signed plan fail before claim', () => {
  const f = syntheticAcquisitionPlanFixture(); assert.throws(() => verifyAcquisitionPlan(f.sign(), f.trust, f.f.reader, Date.parse(f.m.notBefore) + 1), /clock/);
  const document = f.sign(); document.value.capacity.failureBytes += 1; assert.throws(() => verifyAcquisitionPlan(document, f.trust, f.f.reader, Date.parse(f.m.registeredAt)), /signature/);
});

/** Exercises the live-plan wire branch with synthetic keys/configuration only; no host qualification. */
function pathFixture(direction: 'forward' | 'reverse' | 'peer') {
  const f = syntheticAcquisitionPlanFixture(), base = JSON.parse(Buffer.from(f.f.reader(f.m.configurationArtifact, 10000)).toString());
  const states = f.roles.map(r => `/tmp/aeon-live/state-${r.id}`);
  if (direction === 'forward') states[1] = `${states[0]}/..peer`;
  if (direction === 'reverse') states[0] = `${states[1]}/..peer`;
  if (direction === 'peer') states[1] = `${states[0]}..peer`;
  f.m.evidenceKind = 'live-development';
  for (let i = 0; i < f.roles.length; i++) {
    const rp = f.plan.roles[i]!, configuration = { ...base, stateDirectory: states[i], workspaceDirectory: `/tmp/aeon-live/work-${f.roles[i]!.id}`, nodeBinary: '/synthetic/node' };
    rp.stateFile = `${states[i]}/operational.sqlite`; rp.workspace = configuration.workspaceDirectory; rp.configuration = f.f.put(configuration); f.roles[i]!.configurationDigest = identity(configuration);
  }
  f.plan.originalStateFile = f.plan.roles[0]!.stateFile;
  const frozen = JSON.parse(Buffer.from(f.f.reader(f.m.candidateArtifact, 10000)).toString());
  frozen.inputs.configuration = JSON.parse(Buffer.from(f.f.reader(f.plan.roles[0]!.configuration, 10000)).toString());
  f.m.configurationArtifact = f.plan.roles[0]!.configuration; f.m.candidate.configuration = f.roles[0]!.configurationDigest;
  const { id: _priorId, ...fields } = f.m.candidate; f.m.candidate.id = candidateIdentity(fields); frozen.manifest = f.m.candidate; f.m.candidateArtifact = f.f.put(frozen);
  // Bind the new manifest before fixture accept() signs registration.
  f.registration.attemptDigest = identity(f.m); f.accept();
  const grant = {version: 1 as const, id: 'synthetic-copy-grant', attemptDigest: identity(f.m), sourceDigest: retentionSourceDigest(f.plan), rawStoreDigest: identity(f.plan.rawStore), custodianId: 'synthetic-custodian', purpose: 'synthetic path check only', audiences: [`principal:${f.m.observerId}`, ...f.roles.map(r => `provider:${r.profile?.provider ?? 'mistral'}`), ...f.roles.filter(r => r.kind === 'reviewer').map(r => `reviewer:${r.assignmentId}`)].filter((v,i,a) => a.indexOf(v) === i), dataScope: 'complete-operational-role-sources' as const, retention: 'independent-indefinite' as const, withdrawal: 'stop-use-retain-originals' as const};
  f.plan.retention = signDocument(evidenceRetentionDomain,grant,'issuer',f.f.keys.get('issuer')!); f.trust.retention = {acceptedGrantDigest:identity(grant),issuers:f.f.trust.issuers,custodianSigner:'issuer',custodianKey:f.f.keys.get('issuer')!}; f.accept(); return f;
}
for (const direction of ['forward', 'reverse'] as const) test(`live path isolation refuses literal '..peer' descendant in ${direction} ancestry direction`, () => {
  const f = pathFixture(direction); assert.throws(f.verify, /directories must be disjoint/);
});
test('live path isolation permits an actual sibling named with a dot prefix', () => { assert.doesNotThrow(pathFixture('peer').verify); });

test('live copy authority is independently required before claim even with an accepted signed plan',()=>{
 const f=pathFixture('peer');delete f.plan.retention;f.trust.retention=undefined;f.accept();assert.throws(f.verify,/Independent evidence retention grant required/);
});
