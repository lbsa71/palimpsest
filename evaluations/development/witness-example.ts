import { syntheticWitnessFixture } from './witness-fixture.ts';

// Writes no files, executes no model, and creates no release signature.
const result = syntheticWitnessFixture().prepare();
console.log(JSON.stringify({ evidenceKind: result.evidence.evidenceKind, evidenceDigest: result.evidenceDigest, status: result.status, findings: result.findings, automaticReleaseEligible: result.automaticReleaseEligible, h1Eligible: result.h1Eligible }, null, 2));
