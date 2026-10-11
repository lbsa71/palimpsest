import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { AddressInfo } from 'node:net';
import { AutarkApplication, type ApplicationOptions } from '../../deployment/application.ts';
import { beneath } from '../../deployment/config.ts';
import { invariant, type PhysicalRequest } from '../../packages/contracts/index.ts';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface PublicTask { id: string; prompt: string }
export interface CaseObservation {
  runId: string;
  status: string;
  outputs: unknown[];
  observations: unknown[];
  workspace: string;
  usage: unknown;
  physicalRequests: PhysicalRequest[];
  transportReceipts: unknown[];
  effectivePrompts: unknown[];
  /** Read regular artifacts only, without following candidate-controlled symlinks. */
  readArtifact(path: string): string;
}
export interface EvaluationResult { quality: 0 | 1 | 2 | 3; checks: { id: string; passed: boolean; evidence: string }[] }
export interface AdapterOptions {
  application: ApplicationOptions;
  task: PublicTask;
  mode: 'integration' | 'live-product';
  observer: { id: string; privateRoot: string; evaluatorDigest: string; taskDigest: string };
  manifest: { source: string; dependencies: string; protocol: string };
  timeoutMs: number;
  evaluate(observation: CaseObservation): Promise<EvaluationResult>;
  /** A host-issued seal is a prerequisite, not authenticated merely by this string. */
  liveSeal?: { grantId: string; calibrationDigest: string; isolationReceipt: string };
}

export function assertPrivateRoot(privateRoot: string, roots: string[]): void {
  invariant(isAbsolute(privateRoot) && realpathSync(privateRoot) === privateRoot, 'Canonical evaluator-private directory required');
  for (const root of roots) invariant(!beneath(root, privateRoot) && !beneath(privateRoot, root), 'Evaluator-private files must be disjoint from candidate mounts and state');
}
export function artifactReader(workspace: string) {
  return (name: string) => {
    invariant(name.length > 0 && !isAbsolute(name), 'Relative artifact path required');
    const path = resolve(workspace, name);
    invariant(beneath(workspace, path) && path !== workspace, 'Artifact escapes workspace');
    let current = workspace;
    for (const part of relative(workspace, path).split('/')) { current = join(current, part); invariant(!lstatSync(current).isSymbolicLink(), 'Symlink artifact rejected'); }
    invariant(lstatSync(path).isFile() && lstatSync(path).size <= 1_000_000, 'Regular bounded artifact required');
    return readFileSync(path, 'utf8');
  };
}
export function observe(app: AutarkApplication, runId: string, outputs: unknown[]): Omit<CaseObservation, 'readArtifact'> {
  const runs = new Set([runId, ...app.resources.descendants(runId)]);
  const requests = app.store.list<{ request: PhysicalRequest }>('requests').map(row => row.value.request).filter(request => runs.has(request.runId));
  const promptIds = new Set(requests.map(request => request.promptManifestId));
  const requestIds = new Set(requests.map(request => request.id));
  const unknownCost = requests.some(request => request.usage.costUsd === null);
  const unknownTokens = requests.some(request => request.usage.inputTokens === null || request.usage.outputTokens === null);
  return { runId, status: app.runtime.getRun(runId)?.status ?? 'unknown', outputs, observations: app.runtime.observations(runId), workspace: app.store.get<{ workspace: string }>('host.run-grants', runId)?.value.workspace ?? '',
    usage: { sharedOperatingLedger: app.resources.snapshot(runId), caseKnownCostUsd: requests.reduce((sum, request) => sum + (request.usage.costUsd ?? 0), 0), caseTotalCostUsd: unknownCost ? null : requests.reduce((sum, request) => sum + request.usage.costUsd!, 0), caseTotalTokens: unknownTokens ? null : requests.reduce((sum, request) => sum + request.usage.inputTokens! + request.usage.outputTokens!, 0), caseRequests: requests.length, unknownCost, unknownTokens },
    physicalRequests: requests,
    transportReceipts: app.store.list('host-transport').filter(row => requestIds.has(row.key)).map(row => row.value),
    effectivePrompts: app.store.list('prompts').filter(row => promptIds.has(row.key)).map(row => row.value) };
}

/** Runs the actual confined Pi / durable runtime / tools / direct-output composition.
 * This trusted host observer is not release admission or a replacement isolation boundary. */
export async function runApplicationCase(options: AdapterOptions) {
  const { config } = options.application;
  assertPrivateRoot(options.observer.privateRoot, [config.applicationRoot, config.workspaceDirectory, config.stateDirectory]);
  invariant(!config.slack, 'Evaluation application must not configure external speech');
  invariant(config.direct.port === 0, 'Evaluation requires a fresh ephemeral direct port');
  invariant(options.task.id && options.task.prompt && options.observer.id, 'Task and observer identities required');
  invariant(Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 900000, 'Finite evaluation deadline required');
  for (const digest of [options.observer.evaluatorDigest, options.observer.taskDigest, ...Object.values(options.manifest)]) invariant(/^[a-f0-9]{64}$/.test(digest), 'Frozen artifact digests required');
  if (options.mode === 'integration') invariant(options.application.performRequest, 'Integration requires a bounded provider fixture');
  else {
    invariant(!options.application.performRequest, 'Live mode cannot use a provider fixture');
    invariant(options.liveSeal?.grantId && /^[a-f0-9]{64}$/.test(options.liveSeal.calibrationDigest) && options.liveSeal.isolationReceipt, 'Live scoring is closed until host grant, calibration and isolation seals exist');
  }
  const startedAt = new Date().toISOString(), start = performance.now();
  let app: AutarkApplication | undefined;
  let runId: string | null = null;
  let assessment: EvaluationResult | null = null;
  let failure: string | null = null;
  let observation: Omit<CaseObservation, 'readArtifact'> | null = null;
  const receipts: { requestSha256: string; responseSha256: string; status: number }[] = [];
  const perform = options.application.performRequest;
  const application = perform ? { ...options.application, performRequest: async (payload: string, signal: AbortSignal) => {
    const response = await perform(payload, signal);
    receipts.push({ requestSha256: hash(payload), responseSha256: hash(response.body), status: response.status });
    return response;
  } } : options.application;
  try {
    app = new AutarkApplication(application);
    await app.start();
    const origin = `http://${config.direct.host === '::1' ? '[::1]' : config.direct.host}:${(app.directApi.address() as AddressInfo).port}`;
    const headers = { authorization: `Bearer ${application.secrets.directToken}`, 'content-type': 'application/json' };
    const signal = AbortSignal.timeout(options.timeoutMs);
    // Only this allowlisted public projection enters candidate context. Private checks stay in the host.
    const admitted = await fetch(`${origin}/inputs`, { method: 'POST', headers, signal, body: JSON.stringify({ externalId: options.task.id, revision: '1', conversation: options.task.id, text: options.task.prompt }) });
    invariant(admitted.status === 202, 'Application did not admit evaluation task');
    const value = await admitted.json() as { run?: { id: string } };
    invariant(value.run?.id, 'Application omitted admitted run'); runId = value.run.id;
    while (true) {
      signal.throwIfAborted();
      const run = app.runtime.getRun(runId); invariant(run, 'Admitted run missing');
      if (['completed', 'waiting', 'blocked', 'cancelled', 'failed'].includes(run.status)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const response = await fetch(`${origin}/runs/${encodeURIComponent(runId)}/output`, { headers, signal });
    invariant(response.ok, 'Direct output unavailable');
    const workspace = app.store.get<{ workspace: string }>('host.run-grants', runId)?.value.workspace;
    invariant(workspace, 'Actual workspace grant missing');
    observation = observe(app, runId, await response.json() as unknown[]);
    // Stop all candidate activity before evaluator-private verification reads candidate artifacts.
    await app.close(); app = undefined;
    assessment = await options.evaluate({ ...observation, readArtifact: artifactReader(workspace) });
    invariant([0, 1, 2, 3].includes(assessment.quality) && assessment.checks.length > 0 && assessment.checks.every(check => check.id && typeof check.passed === 'boolean' && check.evidence), 'Invalid external evaluator result');
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Unknown evaluation failure';
    if (app && runId) observation = observe(app, runId, app.output(runId));
  } finally { await app?.close(); }
  const passed = !failure && observation?.status === 'completed' && assessment?.quality === 3 && assessment.checks.every(check => check.passed);
  return { schema: 'A1-L08-product-observation-v2', evidenceKind: options.mode, independent: false, admissionEligible: false,
    taskId: options.task.id, observerId: options.observer.id, startedAt, endedAt: new Date().toISOString(), wallMs: performance.now() - start,
    identities: { ...options.manifest, evaluator: options.observer.evaluatorDigest, task: options.observer.taskDigest, publicTask: hash(JSON.stringify(options.task)), configuration: hash(JSON.stringify(config)), prompt: hash(readFileSync(config.promptFile, 'utf8')), compactionPrompt: hash(readFileSync(config.compactionPromptFile, 'utf8')) },
    environment: { node: process.version, platform: process.platform, architecture: process.arch }, adapterDigest: hash(readFileSync(new URL(import.meta.url), 'utf8')),
    candidateModel: config.model, transportFixtures: options.mode === 'integration' ? receipts : null,
    verdict: passed ? 'case-pass' : 'criterion-unmet', assessment, observation, failure,
    claims: { parity: 'unavailable', longitudinalGrowth: 'unavailable', H1: 'unaccepted' },
    limitations: ['Author-operated host runner; fresh external review and authenticated receipts still required.', 'Public fixture source is mounted with the application; only externally supplied private cases can be held out.', 'Path separation is checked; full adversarial evaluator isolation requires an independently accepted host.'] };
}
