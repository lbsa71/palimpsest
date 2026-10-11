import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, mkdtempSync, opendirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { canonicalJson, identity, invariant, validateEvaluation, type ArtifactRef, type Authority } from '../packages/contracts/index.ts';
import { admitCandidate, admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor, type ReleaseProof } from '../packages/release/controller.ts';
import { verifyApplication } from './candidate.ts';
import { beneath } from './config.ts';
import { EvolutionMailbox, type ExternalEvaluation } from './evolution-mailbox.ts';
import type { EvaluationRequest, SubmissionReceipt } from './evolution-tools.ts';
import { assertPrivateHostDirectory, readHostFile } from './host-policy.ts';
import type { HostBindings } from './materialize.ts';
import { materializeConfiguration } from './materialize.ts';
import { spawnBounded } from '../packages/supervisor/resource-limits.ts';
import { accountedReview, assertReviewLineage, recoverReviewReservations } from './evaluation-resources.ts';

/** All runnable bytes must be declared, including interpreters and dynamic libraries.
 * Nothing else on the host filesystem is mounted into the reviewer namespace.
 * Qualification/independence is external policy evidence, never inferred from this manifest.
 */
export interface ReviewerFile {
  evaluatorId: string;
  files: { path: string; mount: string; sha256: string }[];
  executable: string; args: string[]; keyFile: string;
  pollMs: number; maxElapsedMs: number; maxOutputBytes: number; maxClosureBytes: number; memoryBytes: number;
}
export interface ReviewResponse { result: ExternalEvaluation; artifacts: { sha256: string; base64: string }[] }
export function reviewerDescriptor(config: ReviewerFile): string {
  return canonicalJson({ version: 1, executable: config.executable, args: config.args,
    files: config.files.map(({ mount, sha256 }) => ({ mount, sha256 })).sort((a, b) => a.mount.localeCompare(b.mount)) });
}
function validateReviewer(config: ReviewerFile, host: HostBindings): void {
  invariant(config && Object.keys(config).sort().join(',') === 'args,evaluatorId,executable,files,keyFile,maxClosureBytes,maxElapsedMs,maxOutputBytes,memoryBytes,pollMs', 'Exact external reviewer configuration required');
  invariant(typeof config.evaluatorId === 'string' && config.evaluatorId.length > 0 && config.evaluatorId.length <= 256, 'Bounded external evaluator identity required');
  for (const [key, max] of [['pollMs', 1000], ['maxElapsedMs', 60000], ['maxOutputBytes', 8 * 1024 * 1024], ['maxClosureBytes', 256 * 1024 * 1024], ['memoryBytes', 8 * 1024 * 1024 * 1024]] as const)
    invariant(Number.isSafeInteger(config[key]) && config[key] > 0 && config[key] <= max, 'Finite external reviewer bounds required');
  const privatePath = (path: string) => invariant(typeof path === 'string' && isAbsolute(path) && resolve(path) === path &&
    [host.workspaceDirectory, host.artifactStore, host.stateDirectory].every(root => !beneath(root, path)), 'Reviewer files and keys must be canonical and outside application roots');
  privatePath(config.keyFile);
  invariant(Array.isArray(config.files) && config.files.length > 0 && config.files.length <= 64 && new Set(config.files.map(file => file.mount)).size === config.files.length, 'Bounded unique reviewer closure required');
  for (const file of config.files) {
    invariant(file && Object.keys(file).sort().join(',') === 'mount,path,sha256' && /^[a-f0-9]{64}$/.test(file.sha256), 'Exact reviewer closure file required');
    privatePath(file.path);
    invariant(isAbsolute(file.mount) && resolve(file.mount) === file.mount &&
      ['/reviewer', '/lib', '/lib64', '/usr/lib'].some(root => beneath(root, file.mount) && file.mount !== root), 'Reviewer closure mount must name a file in a declared executable/library root');
  }
  invariant(config.files.some(file => file.mount === config.executable) && Array.isArray(config.args) && config.args.length <= 32 && config.args.every(value => typeof value === 'string' && value.length <= 4096), 'Declared external executable and bounded arguments required');
}
export function loadReviewerFile(path: string, host: HostBindings): ReviewerFile {
  invariant([host.workspaceDirectory, host.artifactStore, host.stateDirectory].every(root => !beneath(root, path)), 'Reviewer configuration must remain outside application roots');
  const config = JSON.parse(readHostFile(path, 65536).toString('utf8')) as ReviewerFile;
  validateReviewer(config, host); return config;
}

/** One physical operation; failure may have occurred after review and is never retryable automatically. */
export async function runExternalReview(config: ReviewerFile, host: HostBindings, request: EvaluationRequest,
  policy: AdmissionPolicy, acceptedCandidateId: string, assertAuthority: (authority: Authority) => void, signal?: AbortSignal, dispatch?: (launch: () => void) => void): Promise<ReviewResponse> {
  validateReviewer(config, host); signal?.throwIfAborted();
  const descriptor = Buffer.from(reviewerDescriptor(config)), descriptorDigest = hashBytes(descriptor);
  invariant(policy.policyDigest === request.policyDigest && admissionPolicyIdentity(policy) === request.policyDigest && policy.controlRevision === request.proposal.authority.controlRevision &&
    policy.evaluatorArtifacts.get(config.evaluatorId) === descriptorDigest, 'External reviewer is unavailable under the exact prior policy');
  const key = readHostFile(config.keyFile, 65536);
  invariant(policy.evaluatorKeys.has(config.evaluatorId) && hashBytes(key) === hashBytes(policy.evaluatorKeys.get(config.evaluatorId)!), 'External reviewer key differs from the prior policy');
  const candidate = verifyApplication(host.artifactStore, request.candidate.manifest.id, host.nodeBinary);
  invariant(identity(candidate) === identity(request.candidate), 'External review request differs from the frozen candidate');
  const accepted = verifyApplication(host.artifactStore, acceptedCandidateId, host.nodeBinary);
  const acceptedLimits = materializeConfiguration(accepted, host).resourceLimits;
  const recoveryBytes = readFileSync(join(host.artifactStore, acceptedCandidateId, 'candidate.json'));
  invariant(recoveryBytes.byteLength <= config.maxOutputBytes, 'Bounded retained rescue required');
  const recoveryArtifact: ArtifactRef = { uri: `sha256:${hashBytes(recoveryBytes)}`, sha256: hashBytes(recoveryBytes) };
  const directory = join(host.stateDirectory, 'host-review-dispatch'); mkdirSync(directory, { recursive: true, mode: 0o700 }); assertPrivateHostDirectory(directory);
  const workspace = mkdtempSync(join(directory, 'physical-'));
  try {
    let closureBytes = 0;
    const args = ['--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
      '--proc', '/proc', '--dev', '/dev', '--size', '16777216', '--tmpfs', '/tmp', '--chdir', '/tmp', '--clearenv', '--setenv', 'LANG', 'C',
      '--ro-bind', join(host.artifactStore, candidate.manifest.id), '/candidate'];
    for (const [index, file] of config.files.entries()) {
      const bytes = readHostFile(file.path, config.maxClosureBytes - closureBytes);
      closureBytes += bytes.byteLength; invariant(hashBytes(bytes) === file.sha256, 'External reviewer executable closure changed');
      const path = join(workspace, `closure-${index}`); writeFileSync(path, bytes, { mode: 0o500 }); args.push('--ro-bind', path, file.mount);
    }
    const keyPath = join(workspace, 'key'); writeFileSync(keyPath, key, { mode: 0o400 }); args.push('--ro-bind', keyPath, '/reviewer-key', '--', config.executable, ...config.args);
    const input = Buffer.from(JSON.stringify({ version: 1, request, candidateRoot: '/candidate', recoveryArtifact, recoveryBytes: recoveryBytes.toString('base64'),
      evaluatorArtifact: { uri: `sha256:${descriptorDigest}`, sha256: descriptorDigest }, evaluatorBytes: descriptor.toString('base64') }) + '\n');
    invariant(input.byteLength <= config.maxOutputBytes, 'External reviewer request exceeds bounds');
    // Authority is checked again after all verification/snapshot work, immediately before physical dispatch.
    assertAuthority(request.proposal.authority); signal?.throwIfAborted();
    let pendingConfined: ReturnType<typeof spawnBounded> | undefined;
    let directChild: ReturnType<typeof spawn> | undefined;
    const launch = () => {
      // spawnBounded creates/places the child and releases its gate synchronously on success;
      // capture its promise while authority and cancellation locks remain held, await afterward.
      if (acceptedLimits) pendingConfined = spawnBounded(args, { workspace: host.workspaceDirectory, timeoutMs: config.maxElapsedMs,
        resourceLimits: { ...acceptedLimits, memoryBytes: Math.min(acceptedLimits.memoryBytes, config.memoryBytes), pids: Math.min(acceptedLimits.pids, 32) }, input: 'pipe' });
      else directChild = spawn('/usr/bin/setpriv', ['--pdeathsig', 'SIGKILL', '--no-new-privs', '/bin/sh', '-c',
        '[ "$PPID" = "$1" ] || exit 125; shift; exec "$@"', 'aeon-review-gate', String(process.pid), '/usr/bin/prlimit',
        `--as=${config.memoryBytes}:${config.memoryBytes}`, '--nofile=128:128', '--nproc=1024:1024', '--core=0:0', '--fsize=16777216:16777216',
        `--cpu=${Math.ceil(config.maxElapsedMs / 1000)}:${Math.ceil(config.maxElapsedMs / 1000)}`, '--', '/usr/bin/bwrap', ...args],
        { detached: true, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    };
    if (dispatch) dispatch(launch); else launch();
    const confined = await pendingConfined;
    const child = confined?.child ?? directChild as import('node:child_process').ChildProcessWithoutNullStreams;
    invariant(child, 'External physical review was not launched');
    let output: Buffer;
    try { output = await new Promise<Buffer>((accept, reject) => {
      const chunks: Buffer[] = [], diagnostics: Buffer[] = []; let bytes = 0, failure: Error | undefined;
      const kill = () => { if (confined) { confined.stop(); return; } if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error; } } };
      const stop = (error: Error) => { failure ??= error; kill(); };
      const timer = setTimeout(() => stop(Error('External reviewer deadline exceeded; reconcile stable job ID')), config.maxElapsedMs);
      const abort = () => stop(Error('External reviewer interrupted; reconcile stable job ID'));
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      child.stdin.on('error', error => stop(error)); child.once('error', error => stop(error));
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length; if (bytes > config.maxOutputBytes) stop(Error('External reviewer output exceeded bounds'));
        else if (stream === child.stdout) chunks.push(chunk); else diagnostics.push(chunk);
      });
      child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); kill();
        if (failure || code !== 0) reject(failure ?? Error(`External reviewer exited without a complete response (code ${code})`, { cause: Buffer.concat(diagnostics).toString('utf8') })); else accept(Buffer.concat(chunks)); });
      child.stdin.end(input);
    }); } finally { await confined?.cleanup(); }
    const response = JSON.parse(output.toString('utf8')) as ReviewResponse;
    invariant(response && Object.keys(response).sort().join(',') === 'artifacts,result' && Array.isArray(response.artifacts) && response.artifacts.length <= 128, 'Complete bounded external review response required');
    const artifacts = new Map<string, Uint8Array>([[descriptorDigest, descriptor], [recoveryArtifact.sha256, recoveryBytes]]);
    let artifactBytes = descriptor.byteLength + recoveryBytes.byteLength;
    for (const blob of response.artifacts) {
      invariant(blob && Object.keys(blob).sort().join(',') === 'base64,sha256' && /^[a-f0-9]{64}$/.test(blob.sha256) && typeof blob.base64 === 'string', 'Exact external content-addressed blob required');
      const bytes = Buffer.from(blob.base64, 'base64'); artifactBytes += bytes.length;
      invariant(bytes.toString('base64') === blob.base64 && hashBytes(bytes) === blob.sha256 && artifactBytes <= config.maxOutputBytes, 'External content-addressed blob changed or exceeds bounds');
      artifacts.set(blob.sha256, bytes);
    }
    const result = response.result;
    invariant(result?.receipt && result.proof && result.receipt.evidence.every(evidence => evidence.evaluatorId === config.evaluatorId && evidence.evaluatorArtifact.sha256 === descriptorDigest), 'External result must bind the dispatched reviewer closure');
    invariant(identity(result.proof.proposal.recoveryArtifact) === identity(recoveryArtifact), 'External proof must bind the retained accepted rescue');
    const read = (uri: string) => { invariant(/^sha256:[a-f0-9]{64}$/.test(uri), 'External content address required'); const value = artifacts.get(uri.slice(7)); invariant(value, 'External response omitted signed artifact bytes'); return value; };
    assertAuthority(request.proposal.authority);
    // Authenticate failures/inconclusive reviews too: a known negative judgment is useful feedback,
    // not an uncertain physical review. Passing reviews additionally satisfy the full admission policy.
    const { receipt, proof } = result;
    invariant(receipt.requestId === request.requestId && receipt.candidateId === candidate.manifest.id && receipt.policyDigest === policy.policyDigest &&
      proof.proposal.id === request.requestId && identity(proof.proposal.candidate) === identity(candidate.manifest) &&
      identity(proof.proposal.priorAuthority) === identity(request.proposal.authority) && identity(proof.proposal.evidence) === identity(receipt.evidence) &&
      receipt.evidence.length > 0 && receipt.evidence.length <= 32 && proof.signed.length === receipt.evidence.length, 'Complete external result request binding required');
    for (const evidence of receipt.evidence) {
      validateEvaluation(evidence);
      invariant(evidence.candidateId === candidate.manifest.id && evidence.controlRevision === policy.controlRevision && evidence.independent &&
        evidence.evaluatorId !== candidate.manifest.createdBy && evidence.evaluatorId !== request.proposal.authority.generation, 'External result independence/binding mismatch');
      const signed = proof.signed.find(value => identity(value.evidence) === identity(evidence));
      invariant(signed && /^[a-f0-9]{64}$/.test(signed.authentication), 'Complete external reviewer authentication required');
      const expected = createHmac('sha256', key).update(canonicalJson({ evidence, policyDigest: policy.policyDigest })).digest();
      invariant(timingSafeEqual(expected, Buffer.from(signed.authentication, 'hex')), 'Invalid external reviewer authentication');
      for (const artifact of [evidence.evaluatorArtifact, evidence.artifact, ...evidence.caseResults.map(value => value.observations)])
        invariant(hashBytes(read(artifact.uri)) === artifact.sha256, 'External signed artifact differs from its content address');
    }
    if (receipt.evidence.every(evidence => evidence.verdict === 'pass')) admitCandidate(host.artifactStore, proof.proposal, request.proposal.authority, policy, proof.signed, read,
      candidate.manifest.controls === request.proposal.authority.controlRevision ? 'ordinary' : 'control-upgrade');
    return { result, artifacts: [...artifacts].map(([sha256, bytes]) => ({ sha256, base64: Buffer.from(bytes).toString('base64') })) };
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

export interface DispatchOptions {
  mailbox: EvolutionMailbox; host: HostBindings; reviewer?: ReviewerFile;
  unavailableDiagnosis?: string;
  getPolicy(digest: string): AdmissionPolicy; policyDigests: readonly string[];
  /** Derive unchanged judging rules for a new control closure; grants no activation authority. */
  prepareControlPolicy?(request: EvaluationRequest): AdmissionPolicy;
  assertAuthority(authority: Authority): void; dispatchAuthority(authority: Authority, operation: () => void): void; acceptedCandidateId(): string;
  release(proof: ReleaseProof): Promise<Authority>; stageControl(proof: ReleaseProof, policyDigest: string): Promise<string>;
}
export interface DispatchStatus { available: boolean; activeJob?: string; pending: number; uncertain: number; diagnosis?: string }
function removeInterruptedSnapshots(host: HostBindings): void {
  const path = join(host.stateDirectory, 'host-review-dispatch');
  mkdirSync(path, { recursive: true, mode: 0o700 }); assertPrivateHostDirectory(path);
  const directory = opendirSync(path);
  try {
    let count = 0;
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      invariant(++count <= 128 && /^physical-[A-Za-z0-9]{6}$/.test(entry.name) && entry.isDirectory(), 'Unexpected or unbounded interrupted reviewer snapshots; host cleanup required');
      const snapshot = join(path, entry.name); assertPrivateHostDirectory(snapshot); rmSync(snapshot, { recursive: true, force: true });
    }
  } finally { directory.closeSync(); }
}
/** One host lease owner, one physical review at a time, finite per-job bounds, no uncertain-job retry. */
export class EvaluationDispatcher {
  readonly options: DispatchOptions;
  readonly #abort = new AbortController();
  #loop?: Promise<void>; #activeJob?: string; #diagnosis?: string;
  constructor(options: DispatchOptions) {
    this.options = options; this.#diagnosis = options.unavailableDiagnosis;
    // The owning supervisor lease and parent-death/PID-namespace boundary exclude a live old reviewer.
    removeInterruptedSnapshots(options.host); options.mailbox.recover(); recoverReviewReservations(options.mailbox.store); this.#publish();
  }
  status(): DispatchStatus {
    const jobs = this.options.mailbox.jobs();
    const diagnosis = this.#diagnosis ?? (!this.options.reviewer ? 'External evaluation unavailable: no qualified reviewer is configured' : undefined);
    return { available: !!this.options.reviewer && !this.#abort.signal.aborted, ...(this.#activeJob ? { activeJob: this.#activeJob } : {}), pending: jobs.filter(job => job.status === 'pending').length,
      uncertain: jobs.filter(job => job.status === 'uncertain').length, ...(diagnosis ? { diagnosis } : {}) };
  }
  #publish(): void {
    const store = this.options.mailbox.store, value = this.status(), row = store.get<DispatchStatus>('host.evaluation-dispatch', 'current');
    if (!row || identity(row.value) !== identity(value)) store.put('host.evaluation-dispatch', 'current', value, row?.revision ?? null);
  }
  start(): void { invariant(!this.#loop, 'Evaluation dispatcher already started'); this.#loop = this.#run(); }
  async #run(): Promise<void> {
    while (!this.#abort.signal.aborted) {
      try { await this.processPending(); } catch { this.#diagnosis = 'External evaluation processor failed; inspect and reconcile retained job IDs'; }
      this.#publish();
      if (!this.#abort.signal.aborted) await new Promise<void>(accept => {
        const done = () => { clearTimeout(timer); this.#abort.signal.removeEventListener('abort', done); accept(); };
        const timer = setTimeout(done, this.options.reviewer?.pollMs ?? 1000); this.#abort.signal.addEventListener('abort', done, { once: true });
      });
    }
  }
  async processPending(): Promise<void> {
    invariant(!this.#activeJob, 'Evaluation dispatcher operation already active');
    const { mailbox, reviewer } = this.options;
    const job = mailbox.jobs().find(value => value.status === 'pending' && (reviewer || value.kind === 'submission'));
    if (!job || this.#abort.signal.aborted) return;
    if (mailbox.fencePending(job.id)) { this.#diagnosis = mailbox.status(job.id)!.diagnosis; this.#publish(); return; }
    this.#activeJob = job.id;
    this.#publish();
    try {
      if (job.kind === 'evaluation') await mailbox.processEvaluation(job.id, async request => {
        const response = await accountedReview({ store: mailbox.store, request, evaluatorDigest: hashBytes(Buffer.from(reviewerDescriptor(reviewer!))),
          evaluatorId: reviewer!.evaluatorId, maxElapsedMs: reviewer!.maxElapsedMs, assertAuthority: this.options.assertAuthority, dispatchAuthority: this.options.dispatchAuthority, signal: this.#abort.signal },
        gate => runExternalReview(reviewer!, this.options.host, request, this.options.getPolicy(request.policyDigest),
          this.options.acceptedCandidateId(), this.options.assertAuthority, gate.signal, gate.dispatch));
        for (const blob of response.artifacts) mailbox.store.putArtifact(Buffer.from(blob.base64, 'base64'));
        return response.result;
      }, this.#abort.signal, (request, result) => this.options.dispatchAuthority(request.proposal.authority, () => mailbox.store.transaction(() => {
        this.#abort.signal.throwIfAborted(); assertReviewLineage(mailbox.store, request);
        mailbox.completeEvaluation(job.id, result);
      })));
      else await mailbox.processSubmission(job.id, async (request, proof) => {
        const policy = this.options.getPolicy(request.policyDigest);
        invariant(policy.controlRevision === request.proposal.authority.controlRevision, 'Submission must retain the exact prior policy');
        this.options.assertAuthority(request.proposal.authority);
        let receipt: SubmissionReceipt['receipt'], status: SubmissionReceipt['status'];
        if (request.candidate.manifest.controls === request.proposal.authority.controlRevision) {
          const authority = await this.options.release(proof); receipt = { authority: { ...authority } }; status = 'admitted';
        } else {
          const descriptor = (request.candidate.inputs.controls as { policy?: unknown }).policy;
          const next = this.options.policyDigests.map(digest => this.options.getPolicy(digest)).find(value => value.controlRevision === request.candidate.manifest.controls &&
            identity(policyDescriptor(value)) === identity(descriptor)) ?? this.options.prepareControlPolicy?.(request);
          invariant(next && next.controlRevision === request.candidate.manifest.controls && identity(policyDescriptor(next)) === identity(descriptor), 'Next control policy unavailable: exact candidate descriptor is absent from the host registry');
          receipt = { stageId: await this.options.stageControl(proof, next.policyDigest), policyDigest: next.policyDigest }; status = 'staged';
        }
        return { requestId: request.requestId, candidateId: request.candidate.manifest.id, status, receipt };
      }, this.#abort.signal);
      this.#diagnosis = undefined;
    } catch {
      // This status is shared with the application. Exceptions may contain private host paths
      // or fragments of malformed reviewer stdout, including held-out inputs and signing data.
      this.#diagnosis = `External ${job.kind} dispatch failed; reconcile stable job ID`;
    }
    finally { this.#activeJob = undefined; this.#publish(); }
  }
  async close(): Promise<void> { this.#abort.abort(); await this.#loop; this.#publish(); }
}
