import { canonicalJson, candidateIdentity, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { boundaries, collectDevelopmentEvidence, controlKinds, DevelopmentArtifactUnavailable, domains, families, prepareDevelopmentEvidence, type Accounting, type DevelopmentAttempt, type DevelopmentObservation, type DevelopmentReview, type DevelopmentTrust } from './witness.ts';

/** Public synthetic demonstration only. These keys and judgments have no accepted host authority. */
export function syntheticWitnessFixture() {
  const keys = new Map(['issuer', 'observer', 'reviewer-a', 'reviewer-b'].map((id, i) => [id, Buffer.alloc(32, i + 1)]));
  const artifacts = new Map<string, Uint8Array>();
  const put = (value: unknown): ArtifactRef => { const bytes = Buffer.from(canonicalJson(value)), sha256 = hashBytes(bytes); artifacts.set(sha256, bytes); return { uri: `sha256:${sha256}`, sha256 }; };
  const reader = (ref: ArtifactRef, maxBytes: number): Uint8Array => { const bytes = artifacts.get(ref.sha256); if (!bytes) throw new DevelopmentArtifactUnavailable('Missing synthetic artifact'); if (bytes.byteLength > maxBytes) throw new Error('Synthetic artifact exceeds read bound'); return bytes; };
  const at = (seconds: number) => new Date(Date.parse('2026-10-11T10:00:00Z') + seconds * 1000).toISOString();
  const configuration = { scheduler: { windowMs: 60000 }, model: { contextWindow: 1000, provider: 'mistral', id: 'synthetic-model', reasoning: false, effort: 'none', maxOutputTokens: 100, maxRequestsPerSlice: 2, timeoutMs: 5000, pricesPerMillion: { input: 1, output: 2 } } };
  const files = [{ path: 'synthetic.ts', sha256: hashBytes('synthetic source'), executable: false }];
  const inputs = { dependencies: 'synthetic dependencies', prompts: 'synthetic prompts', model: configuration.model, configuration, controls: 'synthetic controls', createdBy: 'author' };
  const fields = { source: identity(files), dependencies: identity(inputs.dependencies), prompts: identity(inputs.prompts), model: identity(configuration.model), configuration: identity(configuration), controls: identity(inputs.controls), createdBy: 'author' };
  const original: Accounting = { grantId: 'original-grant', usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.1, elapsedMs: 5000 }, chargedTokens: 3, chargedCostUsd: 0.1, requestIds: ['prior-physical'], unknownRequestIds: [] };
  const m: DevelopmentAttempt = {
    version: 1, id: 'synthetic-attempt', evidenceKind: 'synthetic', candidate: { id: candidateIdentity(fields), ...fields }, protocolDigest: identity('fixed development v2'), acquisitionDigest: identity('synthetic acquisition'), priorPolicyDigest: identity('synthetic prior policy'), candidateArtifact: put({ manifest: { id: candidateIdentity(fields), ...fields }, files, inputs }), configurationArtifact: put(configuration), schedulerWindowMs: 60000, contextWindowTokens: 1000,
    grant: { id: 'original-grant', issuedAt: at(-5), expiresAt: at(300), resources: { maxRequests: 20, maxTokens: 2000, maxCostUsd: 5, maxElapsedMs: 600000, maxConcurrency: 2 }, originalAccounting: original },
    registeredAt: at(-2), notBefore: at(0), deadlineAt: at(180), observerId: 'observer', cycles: ['cycle-1', 'cycle-2', 'cycle-3'],
    opportunities: families.flatMap(family => [0, 1, 2].map(i => ({ id: `${family}-${i}`, family, budgetDigest: identity('matched-budget'), interferenceIds: family === 'transfer' ? [1, 2, 3].map(n => `unrelated-${i}-${n}`) : [] }))),
    controls: controlKinds.map(kind => ({ id: kind, kind, budgetDigest: identity('matched-budget'), opportunityIds: families.flatMap(f => [0, 1, 2].map(i => `${f}-${i}`)) })), boundaries: [...boundaries],
    reviewers: ['reviewer-a', 'reviewer-b'].map(id => ({ id, contextDigest: identity(`fresh synthetic context ${id}`) })), limits: { maxRecords: 128, maxArtifactBytes: 10000, maxEvidenceBytes: 1000000 },
  };
  const trust: DevelopmentTrust = { acceptedAttemptDigest: identity(m), issuers: new Map([['issuer', keys.get('issuer')!]]), issuerPrincipals: new Map([['issuer', 'issuer']]), observer: { id: 'observer', principalId: 'observer', independenceGroup: 'observer', key: keys.get('observer')!, artifactDigest: identity('synthetic observer') }, reviewers: new Map(m.reviewers.map(r => [r.id, { key: keys.get(r.id)!, principalId: r.id, independenceGroup: r.id, contextDigest: r.contextDigest, provenanceDigest: identity(`synthetic provenance ${r.id}`) }])), excludedPrincipals: ['author'], excludedIndependenceGroups: ['author', 'issuer'] };
  const observations: DevelopmentObservation[] = [];
  const add = (id: string, seconds: number, data: DevelopmentObservation['data']) => observations.push({ version: 1, id, attemptDigest: identity(m), configurationDigest: m.candidate.configuration, candidateId: m.candidate.id, observedAt: at(seconds), artifact: put({ synthetic: true, id, data }), data });
  add('start', 0, { kind: 'start' });
  m.cycles.forEach((assignmentId, i) => add(assignmentId, (i + 1) * 60, { kind: 'cycle', assignmentId, runId: `autonomous-run-${i}`, selectionId: `scheduler-selection-${i}` }));
  for (const o of m.opportunities) {
    if (o.family === 'transfer') { add(`learning-${o.id}`, 10, { kind: 'learning', opportunityId: o.id }); o.interferenceIds.forEach((assignmentId, i) => add(assignmentId, 20 + i * 10, { kind: 'experience', assignmentId, episodeId: `actual-episode-${assignmentId}` })); }
    add(o.id, 120, { kind: 'opportunity', assignmentId: o.id, result: o.id.endsWith('-2') ? 'failed' : 'completed', audienceBoundaryPreserved: true, feedback: put({ synthetic: true, opportunity: o.id, feedback: 'External fixture feedback; no empirical claim' }) });
  }
  m.controls.forEach(c => add(c.id, 130, { kind: 'control', assignmentId: c.id, result: 'completed' }));
  m.boundaries.forEach(boundary => add(boundary, 150, { kind: 'boundary', boundary, beforeState: put({ synthetic: true, state: 'before', boundary }), afterState: put({ synthetic: true, state: 'after', boundary }), openWorkIds: boundary === 'restart' ? ['open-task'] : [], contextInputTokens: boundary === 'contextReduction' ? 1001 : 0 }));
  const payload = put({ synthetic: true, input: 'exact emitted fixture payload' });
  const prompt = put({ manifest: { id: 'prompt-1', fragments: [{ id: 'fixture-owned', owner: 'application', role: 'system', order: 0, artifact: put('synthetic owned prompt'), scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }], requestDigest: payload.sha256, requestArtifact: payload }, artifact: payload });
  add('request-observation', 100, { kind: 'request', request: { id: 'physical-1', runId: 'run-1', purpose: 'reasoning', provider: 'mistral', model: 'synthetic-model', promptManifestId: 'prompt-1', requestDigest: payload.sha256, reservationId: 'reservation-1', status: 'succeeded', usage: { requests: 1, inputTokens: 3, outputTokens: 2, costUsd: 0.2, elapsedMs: 1000 } }, ceiling: { tokens: 100, costUsd: 1, elapsedMs: 5000 }, charged: { tokens: 5, costUsd: 0.2, elapsedMs: 1000 }, payload, prompt });
  add('observer-intervention', 110, { kind: 'intervention', reason: 'Synthetic stopped-process setup' });
  add('end', 180, { kind: 'end', accounting: { grantId: m.grant.id, usage: { requests: 2, inputTokens: 5, outputTokens: 3, costUsd: 0.3, elapsedMs: 185000 }, chargedTokens: 8, chargedCostUsd: 0.3, requestIds: ['prior-physical', 'physical-1'], unknownRequestIds: [] } });
  const manifest = () => signDocument(domains.attempt, m, 'issuer', keys.get('issuer')!);
  const records = () => observations.map(o => signDocument(domains.observation, o, 'observer', keys.get('observer')!));
  const now = Date.parse(at(200));
  const reviews = () => {
    const evidence = collectDevelopmentEvidence(manifest(), records(), trust, reader, now);
    return m.reviewers.map(reviewer => signDocument<DevelopmentReview>(domains.review, { version: 1, attemptDigest: identity(m), evidenceDigest: identity(evidence), contextDigest: reviewer.contextDigest, reviewedAt: at(190), opportunities: m.opportunities.map(o => ({ id: o.id, outcome: o.id.endsWith('-2') ? 'fail' : 'pass', judgment: put({ synthetic: true, reviewer: reviewer.id, opportunity: o.id }) })), controls: m.controls.map(c => ({ id: c.id, outcome: 'valid', judgment: put({ synthetic: true, reviewer: reviewer.id, control: c.id }) })), boundaries: m.boundaries.map(id => ({ id, outcome: 'valid', judgment: put({ synthetic: true, reviewer: reviewer.id, boundary: id }) })), overall: 'pass', judgment: put({ synthetic: true, reviewer: reviewer.id, overall: 'fixture mechanics only' }) }, reviewer.id, keys.get(reviewer.id)!));
  };
  const prepare = () => prepareDevelopmentEvidence(manifest(), records(), reviews(), trust, reader, now);
  return { m, trust, observations, artifacts, keys, put, reader, manifest, records, reviews, prepare, at, now };
}
