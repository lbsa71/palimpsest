import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, identity, invariant, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { hashBytes, inventoryCandidateSource } from '../../packages/release/artifacts.ts';
import { runConfined, type CommandReceipt } from '../../packages/supervisor/confinement.ts';
import type { ResourceLimits } from '../../packages/supervisor/resource-limits.ts';
import { readHostFile } from '../../deployment/host-policy.ts';
import type { ReviewerFile } from '../../deployment/evaluation-dispatch.ts';
import type { EvaluationRequest } from '../../deployment/evolution-tools.ts';
import type { HostBindings } from '../../deployment/materialize.ts';
import { accountedReview, reviewOperationId, type ReviewResourceOptions } from '../../deployment/evaluation-resources.ts';
import { commandPassed, type ReviewPacket } from './review-core.ts';
import { ResourceLedger } from '../../packages/runtime/resources/index.ts';

export const offlinePlanMount = '/reviewer/offline-plan.json';
const ownRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export interface ValidatorInput { schema: { type: 'string'; minLength?: number; maxLength?: number }; value: string | number | boolean | null }
interface CaseBounds { id: string; timeoutMs: number; maxOutputBytes: number }
export interface ValidatorCase extends CaseBounds { kind: 'validator-string-length'; inputs: ValidatorInput[]; expected: boolean[] }
export interface ReviewerInput { packet: ReviewPacket; plan: OfflinePlan; keyHex: string }
export interface ReviewerCase extends CaseBounds { kind: 'reviewer-behavior'; inputs: ReviewerInput[]; expected: ('pass' | 'fail' | 'refuse')[] }
export type OfflineCase = ValidatorCase | ReviewerCase;
export interface OfflinePlan { version: 2; runnerDigest: string; cases: OfflineCase[] }
export interface OfflineObservation {
  version: 1; requestId: string; candidateId: string; policyDigest: string; evaluatorDigest: string;
  planDigest: string; runnerDigest: string; caseId: string; inputDigest: string;
  command: CommandReceipt; physical: PhysicalRequest; passed: boolean;
}
const exact = (value: unknown, keys: string[]) => invariant(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'Exact offline plan fields required');

/** Actual prior-owned implementation identity, not a caller assertion. Tests/docs excluded. */
export function offlineRunnerDigest(): string {
  const files = inventoryCandidateSource(ownRoot, ['packages', 'deployment', 'evaluations/offline-review', 'package.json', 'package-lock.json'])
    .filter(file => !file.path.endsWith('.test.ts') && !file.path.endsWith('.md'));
  return identity({ version: 1, files, node: hashBytes(readFileSync(process.execPath)), nodeVersion: process.version });
}
export function parseOfflinePlan(bytes: Uint8Array): OfflinePlan {
  invariant(bytes.byteLength <= 65536, 'Offline plan exceeds byte bound');
  const text = Buffer.from(bytes).toString('utf8'), plan = JSON.parse(text) as OfflinePlan;
  // Canonical encoding also rejects duplicate JSON keys, alternate encodings and nonfinite numbers.
  invariant(canonicalJson(plan) === text, 'Canonical inert offline plan required');
  exact(plan, ['version', 'runnerDigest', 'cases']);
  invariant(plan.version === 2 && /^[a-f0-9]{64}$/.test(plan.runnerDigest), 'Supported offline plan and runner identity required');
  invariant(Array.isArray(plan.cases) && plan.cases.length > 0 && plan.cases.length <= 8 && new Set(plan.cases.map(c => c?.id)).size === plan.cases.length, 'Bounded unique offline cases required');
  for (const c of plan.cases) {
    exact(c, ['id', 'kind', 'inputs', 'expected', 'timeoutMs', 'maxOutputBytes']);
    invariant(typeof c.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(c.id), 'Bounded offline case identity required');
    invariant(Number.isSafeInteger(c.timeoutMs) && c.timeoutMs > 0 && c.timeoutMs <= 5000 && Number.isSafeInteger(c.maxOutputBytes) && c.maxOutputBytes > 0 && c.maxOutputBytes <= 65536, 'Bounded offline command required');
    invariant(Array.isArray(c.inputs) && c.inputs.length > 0 && c.inputs.length <= 64 && Array.isArray(c.expected) && c.expected.length === c.inputs.length, 'Bounded exact offline expectations required');
    invariant(c.kind === 'validator-string-length' || c.kind === 'reviewer-behavior', 'Supported offline case required');
    if (c.kind === 'reviewer-behavior') {
      invariant(c.inputs.length <= 24 && c.expected.every(v => ['pass', 'fail', 'refuse'].includes(v)), 'Bounded reviewer outcomes required');
      for (const input of c.inputs) {
        exact(input, ['packet', 'plan', 'keyHex']);
        invariant(typeof input.keyHex === 'string' && /^[a-f0-9]{64}$/.test(input.keyHex), 'Bounded nonauthority probe key required');
        invariant(input.packet && typeof input.packet === 'object' && !Array.isArray(input.packet), 'Inert reviewer packet required');
        invariant(Array.isArray(input.plan?.cases) && input.plan.cases.every(c => c.kind === 'validator-string-length'), 'Only nonrecursive validator packet probes are supported');
        parseOfflinePlan(Buffer.from(canonicalJson(input.plan)));
      }
      continue;
    }
    invariant(c.expected.every(v => typeof v === 'boolean'), 'Boolean validator outcomes required');
    for (const input of c.inputs) {
      exact(input, ['schema', 'value']);
      exact(input.schema, ['type', ...(input.schema.minLength === undefined ? [] : ['minLength']), ...(input.schema.maxLength === undefined ? [] : ['maxLength'])]);
      invariant(input.schema.type === 'string' && [input.schema.minLength, input.schema.maxLength].every(n => n === undefined || Number.isSafeInteger(n) && n >= 0 && n <= 1024), 'Bounded string-length schema required');
      invariant(input.value === null || typeof input.value === 'boolean' || typeof input.value === 'number' && Number.isFinite(input.value) || typeof input.value === 'string' && input.value.length <= 1024, 'Bounded primitive validator input required');
    }
  }
  invariant(plan.cases.reduce((n, c) => n + c.timeoutMs, 0) <= 15000 && plan.cases.reduce((n, c) => n + c.maxOutputBytes, 0) <= 262144, 'Aggregate offline command bounds exceeded');
  return plan;
}
/** The optional plan is already part of the old policy's hashed reviewer descriptor. */
export function loadOfflinePlan(config: ReviewerFile): { plan: OfflinePlan; digest: string } | undefined {
  const file = config.files.find(f => f.mount === offlinePlanMount);
  if (!file) return undefined;
  const bytes = readHostFile(file.path, 65536);
  invariant(hashBytes(bytes) === file.sha256, 'Offline plan differs from accepted reviewer closure');
  const plan = parseOfflinePlan(bytes);
  invariant(plan.runnerDigest === offlineRunnerDigest(), 'Offline runner differs from independently accepted implementation');
  return { plan, digest: file.sha256 };
}
export function offlineOperation(planDigest: string, c: OfflineCase): { id: string; digest: string } {
  return { id: c.id, digest: identity({ planDigest, case: c }) };
}
export function assessOffline(c: OfflineCase, command: CommandReceipt): boolean {
  return commandPassed(c, command);
}
/** Runs candidate imports only inside the sibling namespace, never in the judge process. */
export async function runOfflineCase(options: { config: ReviewerFile; host: HostBindings; request: EvaluationRequest;
  plan: OfflinePlan; planDigest: string; case: OfflineCase; resource: ReviewResourceOptions & { prepared?: boolean }; resourceLimits?: ResourceLimits }): Promise<OfflineObservation> {
  const { config, host, request, plan, planDigest, case: c } = options;
  invariant(plan.runnerDigest === offlineRunnerDigest(), 'Offline runner changed before invocation');
  const workspace = mkdtempSync(join(host.workspaceDirectory, 'offline-review-'));
  try {
    // Only the invocation inputs and runner are exposed. No private expected array/plan/key.
    writeFileSync(join(workspace, 'runner.mjs'), readFileSync(join(ownRoot, 'evaluations/offline-review', c.kind === 'reviewer-behavior' ? 'reviewer-runner.mjs' : 'runner.mjs')), { mode: 0o400 });
    writeFileSync(join(workspace, 'inputs.json'), canonicalJson(c.inputs), { mode: 0o400 });
    // A pre-transfer reservation includes activation time; do not reset its original clock.
    const resource = { ...options.resource, operation: offlineOperation(planDigest, c), maxElapsedMs: options.resource.prepared ? config.maxElapsedMs : c.timeoutMs };
    const command = await accountedReview(resource, async gate => {
      let pending: Promise<CommandReceipt> | undefined;
      gate.dispatch(() => { pending = runConfined({ workspace, protectedPaths: [host.stateDirectory, config.keyFile, ...config.files.map(f => f.path)],
        applicationRoot: join(host.artifactStore, request.candidate.manifest.id, 'payload'), nodeBinary: process.execPath,
        executable: '/runtime/node', args: ['--disable-proto=throw', '/work/runner.mjs'], timeoutMs: c.timeoutMs,
        maxOutputBytes: c.maxOutputBytes, signal: gate.signal, resourceLimits: options.resourceLimits }); });
      invariant(pending, 'Offline candidate command was not dispatched');
      return await pending;
    });
    invariant(plan.runnerDigest === offlineRunnerDigest(), 'Offline runner changed during invocation');
    const physical = new ResourceLedger(resource.store, { tokens: 0, costUsd: 0, elapsedMs: 0 }).request(reviewOperationId(resource));
    invariant(physical?.status === 'succeeded', 'Original offline physical receipt unavailable');
    return { version: 1, requestId: request.requestId, candidateId: request.candidate.manifest.id, policyDigest: request.policyDigest,
      evaluatorDigest: resource.evaluatorDigest, planDigest, runnerDigest: plan.runnerDigest, caseId: c.id, inputDigest: identity(c.inputs),
      // CommandReceipt has optional undefined fields; persist its exact JSON representation.
      command: JSON.parse(JSON.stringify(command)) as CommandReceipt, physical, passed: assessOffline(c, command) };
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}
