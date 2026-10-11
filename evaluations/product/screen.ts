import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { AutarkApplication, type ApplicationOptions } from '../../deployment/application.ts';
import { beneath } from '../../deployment/config.ts';
import { identity, invariant, type ArtifactRef, type Effect, type Observation, type ShellCheckpoint, type PhysicalRequest } from '../../packages/contracts/index.ts';
import type { DelegationRecord } from '../../packages/delegation/index.ts';
import { artifactReader, assertPrivateRoot, hash, observe, type AdapterOptions, type EvaluationResult } from './adapter.ts';
import { runConfined, type CommandReceipt } from '../../packages/supervisor/confinement.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const supportedCases = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S10'] as const;
export type ScreenCaseId = typeof supportedCases[number];
export const unavailableCases = ['S08', 'S09', 'S11', 'S12'] as const;
export const screenVersion = 'A1-L02-L08-public-ordinary-screen-v1';
/** Frozen PUBLIC checker bytes execute directly as Node code, never from a writable workspace file. */
export const publicAdditionCheck = "import {execFileSync} from 'node:child_process';const got=execFileSync('/runtime/node',['sum.mjs','2','3'],{encoding:'utf8'}).trim();if(got!=='5'){console.error('Observed addition defect: '+got);process.exit(1);}console.log('addition check passed');";
export const additionCheckArgs = ['--input-type=module', '-e', publicAdditionCheck] as const;
/** Retained PUBLIC engineering workloads. This source is neither private nor held out. */
export function publicWorkload(id: ScreenCaseId): { prompt: string; files: Record<string, string> } {
  switch (id) {
    case 'S01': return { prompt: 'Discover this repository entrypoint from its manifest and read the implementation. Write answer.json as {entrypoint, behavior}, with behavior naming the exported function and result. Report your evidence.', files: { 'package.json': '{"type":"module","main":"src/main.mjs"}\n', 'src/main.mjs': 'export const greeting = () => "hello from the entrypoint";\n' } };
    case 'S02': return { prompt: 'Inspect sum.mjs and test-command.json. Execute the exact public test command from test-command.json, whose checker bytes run inline rather than from a mutable file. Repair the observed addition defect with a digest-bound edit, rerun exactly the same command successfully, and report the verified result.', files: { 'sum.mjs': 'console.log(Number(process.argv[2]) - Number(process.argv[3]));\n', 'test-command.json': `${JSON.stringify({ executable: '/runtime/node', args: additionCheckArgs })}\n` } };
    case 'S03': return { prompt: 'Implement range.mjs accepting two integer arguments and printing their inclusive range sum. Support negative endpoints and equal endpoints; a reversed (empty) range returns 0. Run edge checks and report the verified result.', files: { 'README.md': 'PUBLIC workload: inclusive integer range sum, reversed range is empty.\n' } };
    case 'S04': return { prompt: 'Read data/value.txt. If that path fails, discover the actual data location and read it. Write answer.json as {value, path}, preserving the real recovery evidence.', files: { 'data/current/value.txt': '29\n' } };
    case 'S05': return { prompt: 'Read both source documents, corroborate their observation and preserve attribution. Write answer.json as {value, sources}, using both source IDs. Report what the documents establish.', files: { 'sources/alpha.json': '{"id":"alpha-survey","value":17,"kind":"observation"}\n', 'sources/beta.json': '{"id":"beta-survey","value":17,"kind":"observation"}\n' } };
    case 'S06': return { prompt: 'Read both dated sources and resolve the contradiction using the newer correction. Write answer.json as {value, source, supersedes, uncertainty}, retaining its provisional status. Report the conflict and its resolution.', files: { 'sources/old.json': '{"id":"notice-old","date":"2026-09-01","value":17,"status":"confirmed"}\n', 'sources/correction.json': '{"id":"notice-correction","date":"2026-10-01","value":19,"supersedes":"notice-old","status":"provisional"}\n' } };
    case 'S07': return { prompt: 'Read state.txt, temporarily change it to temporary, read back the change, then restore the exact original bytes with digest-bound edits. Report the observed temporary state and restoration.', files: { 'state.txt': 'original\n' } };
    case 'S10': return { prompt: 'Use two sequential real scoped child tasks to produce double.mjs: one correct and one with an incorrect result. Each child must write and check its artifact. Inspect the immutable child results, accept the independently observed correct doubling and reject the incorrect result. Integrate the accepted executable as double.mjs, verify 7 doubles to 14, and report both judgments. Prepare host-approved workspaces and keep all work within the original resource grant.', files: { 'README.md': 'PUBLIC workload: double.mjs accepts one integer argument and prints twice its value. Parent must inspect, judge, reject incorrect result and integrate correct child bytes.\n' } };
  }
}
export interface PrivateScreenPacket { expectedAnswer?: unknown; probes?: { args: string[]; stdout: string }[] }
export interface ToolWitness { sequence: number; effect: Effect; observation: Observation }
export interface RetainedArtifact { ref: ArtifactRef; bytes: number; content: string }
export interface ChildWitness { runId: string; status: string; tools: ToolWitness[]; checkpoint: ShellCheckpoint | null; resultArtifacts: RetainedArtifact[]; files: Record<string, string> }
export interface ScreenWitness {
  runId: string; status: string; tools: ToolWitness[]; children: ChildWitness[]; delegations: DelegationRecord[];
  outputs: unknown[]; files: Record<string, string>; checkpoint: ShellCheckpoint | null;
}
export interface ScreenOptions {
  application: ApplicationOptions; caseId: ScreenCaseId; attempt: 1 | 2 | 3; attemptId: string;
  mode: 'synthetic-application' | 'live-public-screen'; observer: AdapterOptions['observer']; manifest: AdapterOptions['manifest'];
  privatePacketPath: string; timeoutMs: number; liveSeal?: AdapterOptions['liveSeal'];
}
function orderedTools(app: AutarkApplication, runId: string): ToolWitness[] {
  const events = app.store.events<Observation>(runId).filter(event => event.type === 'observation');
  invariant(events.length <= 128, 'Screen observation bound exceeded');
  return events.map(event => { const effect = app.effects.get(event.data.id); invariant(effect, 'Observation has no real effect'); return { sequence: event.sequence, effect, observation: event.data }; });
}
function retain(app: AutarkApplication, ref: ArtifactRef): RetainedArtifact {
  const bytes = app.store.readArtifact(ref); invariant(bytes.length <= 2_000_000, 'Screen artifact bound exceeded');
  return { ref, bytes: bytes.length, content: Buffer.from(bytes).toString('utf8') };
}
function capture(app: AutarkApplication, runId: string, caseId: ScreenCaseId): ScreenWitness {
  const descendantIds = new Set(app.resources.descendants(runId)); invariant(descendantIds.size <= 8, 'Screen child bound exceeded');
  const delegations = app.store.list<DelegationRecord>('delegations').map(row => row.value).filter(row => row.task.parentRunId === runId);
  const files = (id: string, names: string[]) => {
    const workspace = app.store.get<{ workspace: string }>('host.run-grants', id)?.value.workspace; const values: Record<string, string> = {};
    if (workspace) for (const name of names) { try { values[name] = artifactReader(workspace)(name); } catch { /* Missing/unsafe output remains absent and fails checks. */ } }
    return values;
  };
  const checkpoint = (id: string) => app.store.get<{ checkpoint?: ShellCheckpoint }>('execution', id)?.value.checkpoint ?? null;
  return { runId, status: app.runtime.getRun(runId)?.status ?? 'unknown', tools: orderedTools(app, runId), outputs: app.output(runId),
    checkpoint: checkpoint(runId), files: files(runId, caseId === 'S02' ? ['sum.mjs', 'test-command.json'] : caseId === 'S03' ? ['range.mjs'] : caseId === 'S07' ? ['state.txt'] : caseId === 'S10' ? ['double.mjs'] : ['answer.json']), delegations,
    children: [...descendantIds].filter(id => app.runtime.getRun(id)).map(id => ({ runId: id, status: app.runtime.getRun(id)!.status, tools: orderedTools(app, id), checkpoint: checkpoint(id),
      files: files(id, ['double.mjs']), resultArtifacts: delegations.filter(record => record.result?.childRunId === id).flatMap(record => record.result!.artifacts.map(ref => retain(app, ref))) })) };
}
const args = (tool: ToolWitness) => tool.effect.payload as Record<string, unknown>;
const receipt = (tool: ToolWitness) => tool.observation.value as Record<string, unknown>;
const named = (tool: ToolWitness, name: string, path?: string) => tool.effect.kind === name && (path === undefined || args(tool).path === path);
const ok = (tool: ToolWitness) => tool.effect.status === 'succeeded' && tool.observation.kind === 'result';
function inOrder(tools: ToolWitness[], predicates: ((tool: ToolWitness) => boolean)[]): boolean {
  let index = 0; for (const tool of tools) if (predicates[index]?.(tool)) index++; return index === predicates.length;
}
/** Temporal checks consume retained real tool receipts, never candidate claims or host setup. */
export function assessScreenWitness(caseId: ScreenCaseId, witness: ScreenWitness, packet: PrivateScreenPacket): EvaluationResult {
  const checks: EvaluationResult['checks'] = [];
  const check = (id: string, passed: boolean, evidence: unknown) => checks.push({ id, passed, evidence: hash(JSON.stringify(evidence) ?? 'undefined') });
  check('real-completed-run', witness.status === 'completed', { runId: witness.runId, status: witness.status });
  check('explicit-output', witness.outputs.length > 0, witness.outputs);
  const read = (path: string) => (tool: ToolWitness) => named(tool, 'workspace_read', path) && ok(tool);
  const write = (path: string) => (tool: ToolWitness) => ['workspace_write', 'workspace_patch'].includes(tool.effect.kind) && args(tool).path === path && typeof args(tool).expectedSha256 === 'string' && ok(tool);
  const command = (script: string, success: boolean) => (tool: ToolWitness) => named(tool, 'command_run') && args(tool).executable === '/runtime/node' && JSON.stringify(args(tool).args) === JSON.stringify(script === 'addition-check' ? additionCheckArgs : [script]) && receipt(tool).exitCode === (success ? 0 : 1) && tool.observation.kind === (success ? 'result' : 'error') && (success ? ok(tool) : tool.effect.status === 'failed');
  if (['S01', 'S04', 'S05', 'S06'].includes(caseId)) {
    let answer: unknown; try { answer = JSON.parse(witness.files['answer.json']); } catch { answer = null; }
    check('external-answer', packet.expectedAnswer !== undefined && identity(answer) === identity(packet.expectedAnswer), { actual: answer, expectedDigest: hash(JSON.stringify(packet.expectedAnswer) ?? 'missing') });
  }
  switch (caseId) {
    case 'S01': check('manifest-and-implementation-read', inOrder(witness.tools, [read('package.json'), read('src/main.mjs')]), witness.tools); break;
    case 'S02': {
      const firstFailure = witness.tools.findIndex(command('addition-check', false));
      const boundedCommand = (tool: ToolWitness) => { const values = args(tool).args; return args(tool).executable === '/runtime/node' && Array.isArray(values) && (JSON.stringify(values) === JSON.stringify(additionCheckArgs) || values.length === 3 && values[0] === 'sum.mjs' && values.slice(1).every(value => typeof value === 'string' && /^-?\d{1,6}$/.test(value))); };
      check('seeded-checker-untampered', firstFailure >= 0 && witness.tools.every((tool, index) => named(tool, 'command_run') ? boundedCommand(tool) : tool.effect.kind.startsWith('workspace_') && !['workspace_read', 'workspace_discover', 'workspace_search', 'workspace_diff'].includes(tool.effect.kind) ? index > firstFailure && ['workspace_write', 'workspace_patch'].includes(tool.effect.kind) && args(tool).path === 'sum.mjs' : true), witness.tools);
      check('failed-check-repair-same-check', inOrder(witness.tools, [command('addition-check', false), read('sum.mjs'), write('sum.mjs'), command('addition-check', true)]), witness.tools); check('frozen-inline-checker', inOrder(witness.tools, [command('addition-check', false), command('addition-check', true)]), { checkerDigest: hash(publicAdditionCheck), tools: witness.tools }); break; }
    case 'S03': check('actual-edge-verification', [['-3', '-1', '-6\n'], ['4', '4', '4\n'], ['4', '2', '0\n']].every(([a, b, expected]) => witness.tools.some(tool => named(tool, 'command_run') && ok(tool) && receipt(tool).exitCode === 0 && JSON.stringify(args(tool).args) === JSON.stringify(['range.mjs', a, b]) && receipt(tool).stdout === expected)), witness.tools); break;
    case 'S04': check('missing-path-discovery-recovery', inOrder(witness.tools, [tool => named(tool, 'workspace_read', 'data/value.txt') && tool.effect.status === 'failed' && tool.observation.kind === 'error', tool => named(tool, 'workspace_discover') && ok(tool), read('data/current/value.txt')]), witness.tools); break;
    case 'S05': check('both-attributed-sources-read', ['sources/alpha.json', 'sources/beta.json'].every(path => witness.tools.some(read(path))), witness.tools); break;
    case 'S06': check('contradiction-sources-read', ['sources/old.json', 'sources/correction.json'].every(path => witness.tools.some(read(path))), witness.tools); break;
    case 'S07': check('read-change-readback-restore', inOrder(witness.tools, [read('state.txt'), tool => write('state.txt')(tool) && args(tool).content === 'temporary\n', tool => read('state.txt')(tool) && receipt(tool).content === 'temporary\n', tool => write('state.txt')(tool) && args(tool).content === 'original\n']), witness.tools); check('original-bytes-restored', witness.files['state.txt'] === publicWorkload('S07').files['state.txt'], witness.files); break;
    case 'S10': {
      const accepted = witness.delegations.filter(record => record.status === 'accepted'), rejected = witness.delegations.filter(record => record.status === 'rejected');
      const authentic = (record: DelegationRecord) => {
        const child = witness.children.find(value => value.runId === record.result?.childRunId);
        return child?.status === 'completed' && child.resultArtifacts.length > 0 && record.inspection && record.verdict && child.tools.some(tool => named(tool, 'workspace_write', 'double.mjs') && ok(tool)) && child.tools.some(tool => named(tool, 'command_run') && ok(tool) && receipt(tool).exitCode === 0 && (args(tool).args as string[])?.[0] === 'double.mjs') && inOrder(witness.tools, [tool => ['delegation_start', 'delegation_start_batch'].includes(tool.effect.kind) && ok(tool) && JSON.stringify(args(tool)).includes(record.task.id), tool => named(tool, 'delegation_inspect') && args(tool).id === record.task.id && ok(tool), tool => named(tool, 'delegation_judge') && args(tool).id === record.task.id && ok(tool)]);
      };
      check('actual-child-inspected-accepted-and-rejected', accepted.length === 1 && rejected.length === 1 && [...accepted, ...rejected].every(authentic), { children: witness.children, delegations: witness.delegations, parent: witness.tools });
      const acceptedChild = witness.children.find(child => child.runId === accepted[0]?.result?.childRunId), rejectedChild = witness.children.find(child => child.runId === rejected[0]?.result?.childRunId);
      check('child-result-attribution', !!acceptedChild && !!rejectedChild && acceptedChild.tools.some(tool => named(tool, 'command_run') && ok(tool) && receipt(tool).exitCode === 0 && JSON.stringify(args(tool).args) === '[\"double.mjs\",\"7\"]' && receipt(tool).stdout === '14\n') && rejectedChild.tools.some(tool => named(tool, 'command_run') && ok(tool) && receipt(tool).exitCode === 0 && JSON.stringify(args(tool).args) === '[\"double.mjs\",\"7\"]' && typeof receipt(tool).stdout === 'string' && receipt(tool).stdout !== '14\n'), witness.children);
      check('accepted-bytes-integrated-and-verified', !!acceptedChild && !!acceptedChild.files['double.mjs'] && witness.files['double.mjs'] === acceptedChild.files['double.mjs'] && inOrder(witness.tools, [tool => named(tool, 'delegation_judge') && args(tool).id === accepted[0]?.task.id && ok(tool), tool => named(tool, 'workspace_write', 'double.mjs') && ok(tool), tool => named(tool, 'command_run') && ok(tool) && receipt(tool).exitCode === 0 && receipt(tool).stdout === '14\n' && JSON.stringify(args(tool).args) === '["double.mjs","7"]']), witness.tools); break;
    }
  }
  return { quality: checks.every(check => check.passed) ? 3 : 0, checks };
}
export interface PrivateProbeReceipt { index: number; command: { path: string; args: string[]; timeoutMs: number; deadline: number }; request: PhysicalRequest; receipt: CommandReceipt | null; failure: string | null }
function validateProbes(caseId: ScreenCaseId, packet: PrivateScreenPacket): void {
  if (!['S02', 'S03', 'S10'].includes(caseId)) return;
  invariant(packet.probes && packet.probes.length >= 3 && packet.probes.length <= 8, 'Three to eight frozen external probes required');
  for (const probe of packet.probes) invariant(probe.args.length >= 1 && probe.args.length <= 2 && probe.args.every(arg => /^-?\d{1,6}$/.test(arg)) && /^-?\d{1,12}\n$/.test(probe.stdout), 'Bounded integer probe required');
}
/** Uses existing parent allocation and original clocks; creates no new grant or allowance. */
export async function executePrivateProbes(options: ScreenOptions, witness: ScreenWitness, packet: PrivateScreenPacket, deadline: number, retained: PrivateProbeReceipt[]): Promise<EvaluationResult['checks']> {
  validateProbes(options.caseId, packet);
  if (!['S02', 'S03', 'S10'].includes(options.caseId)) return [];
  const config = options.application.config, name = options.caseId === 'S02' ? 'sum.mjs' : options.caseId === 'S03' ? 'range.mjs' : 'double.mjs';
  invariant(typeof witness.files[name] === 'string', 'Executable artifact missing');
  const workspace = mkdtempSync(join(config.workspaceDirectory, 'host-private-probe-'));
  const state = new OperationalStore({ filename: join(config.stateDirectory, 'operational.sqlite'), checkoutRoot: config.applicationRoot });
  const resources = new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 });
  try {
    writeFileSync(join(workspace, name), witness.files[name]);
    const checks: EvaluationResult['checks'] = [];
    for (const [index, probe] of packet.probes!.entries()) {
      options.application.authorityStore.assert(options.application.authority);
      invariant(Date.now() < deadline, 'Original screen deadline expired before private probe');
      const id = `screen-private:${options.attemptId}:${index}`;
      let request: PhysicalRequest = { id, runId: witness.runId, purpose: 'review', provider: 'screen-private-command', model: 'none', promptManifestId: `private-check:${options.observer.taskDigest}`, requestDigest: identity({ name, probe }), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 2000 } };
      resources.reserve(request); // exhaustion refuses dispatch under the original lineage
      const start = performance.now(); let receipt: CommandReceipt | null = null, failure: string | null = null;
      try {
        request = { ...request, status: 'dispatched' }; resources.dispatched(request);
        const physicalReceipt = await runConfined({ workspace, protectedPaths: [options.observer.privateRoot, config.applicationRoot, config.stateDirectory], nodeBinary: config.nodeBinary, executable: '/runtime/node', args: [name, ...probe.args], timeoutMs: 2000, maxOutputBytes: 4096, resourceLimits: config.resourceLimits, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        receipt = JSON.parse(JSON.stringify(physicalReceipt)) as CommandReceipt;
        request = { ...request, status: receipt.stoppedFor || receipt.exitCode === null ? 'uncertain' : receipt.exitCode === 0 ? 'succeeded' : 'failed', usage: { ...request.usage, elapsedMs: performance.now() - start } };
        resources.settle(request);
        invariant(artifactReader(workspace)(name) === witness.files[name], 'Candidate changed its tested source during private verification');
      } catch (error) {
        failure = error instanceof Error ? error.message : 'Private command outcome unknown';
        const current = resources.request(id);
        if (current?.status === 'dispatched') resources.settle({ ...current, status: 'uncertain', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: performance.now() - start } });
        else if (current?.status === 'reserved') resources.settle({ ...current, status: 'failed', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
      }
      const actual = resources.request(id)!;
      const result = { index, command: { path: name, args: probe.args, timeoutMs: 2000, deadline }, request: actual, receipt, failure }; retained.push(result);
      state.put('screen.private-receipts', id, { ...result, artifact: state.putJsonArtifact(JSON.parse(JSON.stringify(result))) }, null);
      checks.push({ id: `private-executable-${index}`, passed: !failure && actual.status === 'succeeded' && receipt?.stdout === probe.stdout, evidence: hash(JSON.stringify({ probe, result })) });
      if (failure || actual.status === 'uncertain') break; // unknown local physical outcome never replayed
    }
    invariant(retained.length === packet.probes!.length, 'Private verification stopped with incomplete physical outcomes');
    return checks;
  } finally { state.close(); rmSync(workspace, { recursive: true, force: true }); }
}

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
/** Fixed host preparation: synchronous receive+seed completes before queued onReady can dispatch.
 * No callback, model-visible seed tool, grant invention, or post-dispatch mutation is exposed. */
export function seedBeforeDispatch(app: AutarkApplication, caseId: ScreenCaseId, attemptId: string) {
  invariant(!app.store.get('screen.attempts', attemptId), 'Attempt cannot reset or replay');
  invariant(app.store.list<{ status: string }>('runs').every(row => ['completed', 'cancelled'].includes(row.value.status)), 'Prior application work must be terminal before public preparation');
  const requestsBefore = app.store.list('requests').length;
  invariant(!app.config.bootstrapInitiative, 'Screen requires host to disable unrelated bootstrap initiative');
  const workload = publicWorkload(caseId);
  const run = app.communications.receive({ source: 'direct', externalId: attemptId, revision: '1', conversation: attemptId, text: workload.prompt, actor: { id: app.config.direct.actorId, scope: app.config.direct.scope, modificationEligible: app.config.direct.modificationEligible } }).run;
  app.store.put('screen.attempts', attemptId, { caseId, runId: run.id, startedAt: new Date().toISOString() }, null);
  const workspace = join(app.config.workspaceDirectory, identity(run.id)); invariant(!app.store.get('host.run-grants', run.id), 'Candidate workspace already prepared');
  mkdirSync(workspace, { mode: 0o700 });
  const files = Object.entries(workload.files).map(([name, content]) => {
    invariant(!isAbsolute(name) && beneath(workspace, resolve(workspace, name)), 'Invalid public seed path');
    mkdirSync(join(workspace, name, '..'), { recursive: true, mode: 0o700 }); writeFileSync(join(workspace, name), content, { flag: 'wx', mode: 0o600 });
    return { path: name, sha256: hash(content), bytes: Buffer.byteLength(content) };
  });
  invariant(app.store.list('requests').length === requestsBefore && app.runtime.getRun(run.id)?.status === 'ready', 'Preparation raced candidate dispatch');
  return { runId: run.id, workspace, publicPreparation: { actor: 'host-evaluator', phase: 'before-first-dispatch', version: screenVersion, files, digest: hash(JSON.stringify(workload)), preparedAt: new Date().toISOString() } };
}
export async function runScreenCase(options: ScreenOptions) {
  const config = options.application.config;
  invariant(supportedCases.includes(options.caseId) && [1, 2, 3].includes(options.attempt) && options.attemptId, 'Fixed supported case/initial attempt required');
  assertPrivateRoot(options.observer.privateRoot, [config.applicationRoot, config.workspaceDirectory, config.stateDirectory]);
  invariant(realpathSync(options.privatePacketPath) === options.privatePacketPath && beneath(options.observer.privateRoot, options.privatePacketPath), 'Private packet must stay outside candidate mounts');
  invariant(!config.slack && !options.application.additionalTools && !options.application.slackBotApi && !options.application.slackAppApi && config.researchHosts.length === 0, 'Screen only permits ordinary local tools, no extensions/external speech/research');
  invariant(config.direct.port === 0 && !config.bootstrapInitiative, 'Fresh local application configuration required');
  invariant(Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 900000, 'Finite screen deadline required');
  for (const digest of [options.observer.evaluatorDigest, options.observer.taskDigest, ...Object.values(options.manifest)]) invariant(/^[a-f0-9]{64}$/.test(digest), 'Frozen artifact digests required');
  if (options.mode === 'synthetic-application') invariant(options.application.performRequest, 'Synthetic mode requires declared bounded transport fixture');
  else invariant(false, 'Live public screen unavailable until an independently qualified host grant route is bound');
  const packetBytes = readFileSync(options.privatePacketPath, 'utf8'); invariant(Buffer.byteLength(packetBytes) <= 65536 && hash(packetBytes) === options.observer.taskDigest, 'Frozen private packet digest mismatch');
  const packet = JSON.parse(packetBytes) as PrivateScreenPacket; validateProbes(options.caseId, packet);
  // Durable evaluator receipt is written before admission. Same attempt cannot be reset after failure.
  const attemptReceipt = join(options.observer.privateRoot, `screen-${options.caseId}-initial-${options.attempt}.json`);
  writeFileSync(attemptReceipt, JSON.stringify({ attemptId: options.attemptId, caseId: options.caseId, attempt: options.attempt, taskDigest: options.observer.taskDigest, manifest: options.manifest, configuration: hash(JSON.stringify(config)), recordedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  const attemptReceiptContent = readFileSync(attemptReceipt, 'utf8');
  const retainedAttemptReceipt = { path: attemptReceipt, sha256: hash(attemptReceiptContent), content: attemptReceiptContent };
  const startedAt = new Date().toISOString(), start = performance.now();
  let app: AutarkApplication | undefined; let preparation: ReturnType<typeof seedBeforeDispatch> | null = null;
  let observation: ReturnType<typeof observe> | null = null; let witness: ScreenWitness | null = null;
  let assessment: EvaluationResult | null = null; let failure: string | null = null;
  const privateCommands: PrivateProbeReceipt[] = []; let originalResources: unknown = null; const deadline = Date.now() + options.timeoutMs;
  let payloads: RetainedArtifact[] = [], checkpoints: RetainedArtifact[] = [], operatingLedger: unknown = null;
  try {
    app = new AutarkApplication(options.application);
    // Deliberately no await/start before this fixed synchronous barrier.
    preparation = seedBeforeDispatch(app, options.caseId, options.attemptId);
    const signal = AbortSignal.timeout(options.timeoutMs);
    while (true) {
      signal.throwIfAborted(); const run = app.runtime.getRun(preparation.runId); invariant(run, 'Screen run disappeared');
      if (['completed', 'waiting', 'blocked', 'cancelled'].includes(run.status)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  } catch (error) { failure = error instanceof Error ? error.message : 'Unknown screen failure'; }
  finally {
    if (app) {
      // At cancellation join the existing ordinary turn before capture; never resume waiting work.
      if (preparation) {
        try {
          if (!['completed', 'waiting', 'blocked', 'cancelled'].includes(app.runtime.getRun(preparation.runId)?.status ?? '')) app.runtime.cancel(preparation.runId, options.observer.id, 'Finite screen deadline reached');
          if (app.runtime.getRun(preparation.runId)?.status === 'cancelled') await app.resume(preparation.runId);
          // Terminal ordinary turns have finished their effects. Private checks follow app.close().
          witness = capture(app, preparation.runId, options.caseId);
          observation = observe(app, preparation.runId, app.output(preparation.runId)); operatingLedger = app.resources.snapshot('operating-envelope:v1');
          invariant(observation.physicalRequests.length <= 256 && observation.effectivePrompts.length <= 128, 'Screen physical evidence bound exceeded');
          payloads = (observation.effectivePrompts as { artifact: ArtifactRef }[]).map(value => retain(app!, value.artifact));
          checkpoints = [witness.checkpoint, ...witness.children.map(child => child.checkpoint)].filter((value): value is ShellCheckpoint => !!value).map(value => retain(app!, value.artifact));
        } catch (error) { failure = error instanceof Error ? error.message : 'Evidence capture failed'; }
      }
      await app.close(); app = undefined;
    }
  }
  if (witness && !failure) {
    try {
      witness = deepFreeze(JSON.parse(JSON.stringify(witness)) as ScreenWitness);
      assessment = assessScreenWitness(options.caseId, witness, packet);
      assessment.checks.push(...await executePrivateProbes(options, witness, packet, deadline, privateCommands));
      assessment.quality = assessment.checks.every(check => check.passed) ? 3 : 0;
    } catch (error) { failure = error instanceof Error ? error.message : 'Private verification failed'; }
  }
  if (preparation) {
    const state = new OperationalStore({ filename: join(config.stateDirectory, 'operational.sqlite'), checkoutRoot: config.applicationRoot });
    try {
      const resources = new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 });
      originalResources = { allocations: state.list('allocations'), budgets: state.list('budgets'), physicalLedger: state.list('requests'), attempts: state.list('screen.attempts'), snapshot: resources.snapshot(preparation.runId) };
      operatingLedger = resources.snapshot('operating-envelope:v1');
    } finally { state.close(); }
  }
  if (Date.now() > deadline) failure ??= 'Original screen deadline exceeded';
  const evidenceBytes = Buffer.byteLength(JSON.stringify({ observation, witness, payloads, checkpoints, operatingLedger, originalResources, privateCommands }));
  const evidenceDigest = hash(JSON.stringify({ observation, witness, payloads, checkpoints, operatingLedger, originalResources, privateCommands }));
  let boundedPrivateCommands: PrivateProbeReceipt[] | null = privateCommands;
  if (evidenceBytes > 32_000_000) { failure = 'Combined screen evidence bound exceeded; full witness unavailable'; observation = null; witness = null; payloads = []; checkpoints = []; originalResources = null; boundedPrivateCommands = null; }
  return deepFreeze({ schema: screenVersion, coverage: 'eight-case-partial', evidenceKind: options.mode, independent: false, admissionEligible: false,
    attemptReceipt, retainedAttemptReceipt, evidenceBytes, evidenceDigest, caseId: options.caseId, initialAttempt: options.attempt, attemptId: options.attemptId, startedAt, endedAt: new Date().toISOString(), wallMs: performance.now() - start,
    identities: { ...options.manifest, evaluator: options.observer.evaluatorDigest, privatePacket: options.observer.taskDigest, screen: hash(readFileSync(new URL(import.meta.url), 'utf8')), configuration: hash(JSON.stringify(config)), prompt: hash(readFileSync(config.promptFile, 'utf8')), compactionPrompt: hash(readFileSync(config.compactionPromptFile, 'utf8')) },
    candidateModel: config.model, configuration: { resources: config.resources, conversationResources: config.conversationResources, resourceLimits: config.resourceLimits ?? null, scheduler: config.scheduler, maxConcurrentRuns: config.maxConcurrentRuns, commands: config.commands }, originalResources, privateCommands: boundedPrivateCommands, environment: { node: process.version, platform: process.platform, architecture: process.arch }, preparation, observation, witness, payloads, checkpoints, operatingLedger, assessment, failure,
    verdict: !failure && assessment?.quality === 3 ? 'case-pass' : 'criterion-unmet', unavailable: unavailableCases,
    claims: { twelveCaseCompletion: false, Q3: 'unavailable', parity: 'unavailable', H1: 'unaccepted', modelCompetence: options.mode === 'synthetic-application' ? 'unavailable' : 'unqualified-public-screen' },
    limitations: ['Public retained engineering screen; no held-out benchmark or independent acceptance.', 'One original application resource ledger per initial attempt; failure and uncertain usage remain charged.', 'S08/S09/S11/S12 lifecycle driver is unavailable; no simulated restart, compaction, delivery reconciliation or prompt transition.', 'Fresh independent evaluator/host integrity review and externally issued live authority remain required.'] });
}
