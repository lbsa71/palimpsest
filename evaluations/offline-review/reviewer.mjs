// Prior-policy sealed reviewer. It never imports or executes candidate modules.
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const canonical = value => JSON.stringify(sort(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let input = ''; for await (const chunk of process.stdin) input += chunk;
const x = JSON.parse(input), r = x.request;
const planBytes = readFileSync('/reviewer/offline-validator-plan.json'), plan = JSON.parse(planBytes);
if (x.offlineObservations?.length !== plan.cases.length) throw Error('Missing original offline observations');
const artifacts = [], results = [];
for (const c of plan.cases) {
  const observation = x.offlineObservations.find(o => o.caseId === c.id);
  if (!observation || observation.requestId !== r.requestId || observation.candidateId !== r.candidate.manifest.id || observation.policyDigest !== r.policyDigest || observation.evaluatorDigest !== x.evaluatorArtifact.sha256 || observation.planDigest !== hash(planBytes) || observation.runnerDigest !== plan.runnerDigest || observation.inputDigest !== hash(canonical(c.inputs))) throw Error('Offline observation binding mismatch');
  const command = observation.command;
  let passed = false;
  try { passed = command.exitCode === 0 && !command.signal && !command.stoppedFor && canonical(JSON.parse(command.stdout)) === canonical(c.expected); } catch {}
  if (passed !== observation.passed || observation.physical.status !== 'succeeded') throw Error('Original offline assessment mismatch');
  const bytes = Buffer.from(canonical(observation)), sha256 = hash(bytes), artifact = { uri: 'sha256:' + sha256, sha256 };
  artifacts.push({ sha256, base64: bytes.toString('base64') });
  results.push({ id: c.id, status: passed ? 'pass' : 'fail', observations: artifact, usage: observation.physical.usage, interventions: [] });
}
const summary = Buffer.from(canonical({ version: 1, requestId: r.requestId, candidateId: r.candidate.manifest.id, planDigest: hash(planBytes), observations: artifacts.map(a => a.sha256) }));
const sha256 = hash(summary); artifacts.push({ sha256, base64: summary.toString('base64') });
const evidence = { id: 'offline:' + r.requestId, candidateId: r.candidate.manifest.id, controlRevision: r.proposal.authority.controlRevision,
  evaluatorId: x.evaluatorId, evaluatorArtifact: x.evaluatorArtifact, independent: true, verdict: results.every(c => c.status === 'pass') ? 'pass' : 'fail',
  artifact: { uri: 'sha256:' + sha256, sha256 }, caseResults: results };
const authentication = createHmac('sha256', readFileSync('/reviewer-key')).update(canonical({ evidence, policyDigest: r.policyDigest })).digest('hex');
process.stdout.write(JSON.stringify({ result: { receipt: { requestId: r.requestId, candidateId: r.candidate.manifest.id, policyDigest: r.policyDigest, evidence: [evidence], receipt: { offlinePlan: hash(planBytes) } },
  proof: { proposal: { id: r.requestId, candidate: r.candidate.manifest, priorAuthority: r.proposal.authority, evidence: [evidence], recoveryArtifact: x.recoveryArtifact }, signed: [{ evidence, authentication }] } }, artifacts }));
