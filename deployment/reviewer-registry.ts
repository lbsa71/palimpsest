import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { canonicalJson, identity, invariant, type JsonValue } from '../packages/contracts/index.ts';
import { hashBytes, verifyCandidate, type FrozenCandidate } from '../packages/release/artifacts.ts';
import type { AdmissionPolicy } from '../packages/release/admission.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { ReviewerFile } from './evaluation-dispatch.ts';
import type { HostBindings } from './materialize.ts';
import { beneath } from './config.ts';
import { assertPrivateHostDirectory, readHostFile, type HostPolicyFile } from './host-policy.ts';

export const governanceProposalPath = 'deployment/governance-proposal.json';
export type PublicPolicy = HostPolicyFile['descriptor'];
export interface SourceReviewer {
  evaluatorId: string; executable: string; args: string[];
  files: ({ mount: string; sha256: string; source: string } | { mount: string; sha256: string; inherit: true })[];
}
export interface GovernanceProposal { version: 1; policy: PublicPolicy; reviewer?: SourceReviewer }
export interface ReviewerMetadata {
  version: 1; policy: PublicPolicy; reviewer: SourceReviewer;
  bounds: Pick<ReviewerFile, 'pollMs' | 'maxElapsedMs' | 'maxOutputBytes' | 'maxClosureBytes' | 'memoryBytes'>;
}
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value: unknown, keys: string[]): void => invariant(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'Exact public governance fields required');
export function publicPolicy(value: unknown, prior: JsonValue): PublicPolicy {
  exact(value, ['kind', 'requiredCases', 'evaluatorArtifacts', 'evaluatorKeyDigests']);
  const policy = value as PublicPolicy, previous = prior as unknown as PublicPolicy;
  invariant(policy.kind === previous.kind && ['engineering', 'product'].includes(policy.kind), 'Governance cannot grant a different qualification kind');
  invariant(Array.isArray(policy.requiredCases) && policy.requiredCases.length > 0 && policy.requiredCases.length <= 128 && new Set(policy.requiredCases).size === policy.requiredCases.length && policy.requiredCases.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256), 'Explicit bounded unique governance cases required');
  for (const entries of [policy.evaluatorArtifacts, policy.evaluatorKeyDigests]) invariant(Array.isArray(entries) && entries.length > 0 && entries.length <= 32 && new Set(entries.map(entry => entry?.[0])).size === entries.length && entries.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && entry[0].length > 0 && entry[0].length <= 256 && digest(entry[1])), 'Exact bounded governance evaluator identities required');
  invariant(identity(policy.evaluatorKeyDigests) === identity(previous.evaluatorKeyDigests) && identity(policy.evaluatorArtifacts.map(([id]) => id)) === identity(previous.evaluatorArtifacts.map(([id]) => id)), 'Governance must retain the configured signing-key authority');
  invariant(identity(policy.requiredCases) === identity([...policy.requiredCases].sort()) && identity(policy.evaluatorArtifacts) === identity([...policy.evaluatorArtifacts].sort(([a], [b]) => a.localeCompare(b))), 'Canonical public governance descriptor required');
  return structuredClone(policy);
}
export function sourceReviewer(value: unknown): SourceReviewer {
  exact(value, ['evaluatorId', 'executable', 'args', 'files']);
  const reviewer = value as SourceReviewer;
  invariant(typeof reviewer.evaluatorId === 'string' && reviewer.evaluatorId.length > 0 && reviewer.evaluatorId.length <= 256 && Array.isArray(reviewer.files) && reviewer.files.length > 0 && reviewer.files.length <= 64 && new Set(reviewer.files.map(file => file?.mount)).size === reviewer.files.length, 'Bounded unique source reviewer required');
  for (const file of reviewer.files) {
    exact(file, 'source' in file ? ['mount', 'sha256', 'source'] : ['mount', 'sha256', 'inherit']);
    invariant(digest(file.sha256) && typeof file.mount === 'string' && isAbsolute(file.mount) && resolve(file.mount) === file.mount && ['/reviewer', '/lib', '/lib64', '/usr/lib'].some(root => beneath(root, file.mount) && file.mount !== root), 'Declared reviewer mount and hash required');
    if ('source' in file) invariant(typeof file.source === 'string' && file.source.startsWith('deployment/') && !file.source.endsWith('.test.ts') && file.source.split('/').every(part => part && part !== '.' && part !== '..') && file.source.length <= 4096, 'Reviewer source must name a bounded control-owned deployment file');
    else invariant(file.inherit === true, 'Reviewer inheritance must be explicit');
  }
  invariant(reviewer.files.some(file => file.mount === reviewer.executable) && Array.isArray(reviewer.args) && reviewer.args.length <= 32 && reviewer.args.every(arg => typeof arg === 'string' && arg.length <= 4096), 'Declared reviewer executable and bounded arguments required');
  return structuredClone(reviewer);
}
export function governanceProposal(value: unknown, prior: JsonValue): GovernanceProposal {
  exact(value, ['version', 'policy', ...((value as GovernanceProposal)?.reviewer === undefined ? [] : ['reviewer'])]);
  const proposal = value as GovernanceProposal;
  invariant(proposal.version === 1, 'Supported governance proposal version required');
  return { version: 1, policy: publicPolicy(proposal.policy, prior), ...(proposal.reviewer ? { reviewer: sourceReviewer(proposal.reviewer) } : {}) };
}
function descriptor(reviewer: Pick<ReviewerFile, 'executable' | 'args' | 'files'>): string {
  return canonicalJson({ version: 1, executable: reviewer.executable, args: reviewer.args, files: reviewer.files.map(({ mount, sha256 }) => ({ mount, sha256 })).sort((a, b) => a.mount.localeCompare(b.mount)) });
}
export function validateReviewerMetadata(value: unknown): ReviewerMetadata {
  exact(value, ['version', 'policy', 'reviewer', 'bounds']);
  const metadata = value as ReviewerMetadata;
  invariant(metadata.version === 1, 'Supported reviewer metadata version required');
  const policy = publicPolicy(metadata.policy, metadata.policy as unknown as JsonValue), reviewer = sourceReviewer(metadata.reviewer);
  invariant(reviewer.files.every(file => 'inherit' in file), 'Public current reviewer metadata exposes inherited mounts only');
  exact(metadata.bounds, ['pollMs', 'maxElapsedMs', 'maxOutputBytes', 'maxClosureBytes', 'memoryBytes']);
  for (const [key, max] of [['pollMs', 1000], ['maxElapsedMs', 60000], ['maxOutputBytes', 8 * 1024 * 1024], ['maxClosureBytes', 256 * 1024 * 1024], ['memoryBytes', 8 * 1024 * 1024 * 1024]] as const)
    invariant(Number.isSafeInteger(metadata.bounds[key]) && metadata.bounds[key] > 0 && metadata.bounds[key] <= max, 'Finite existing reviewer metadata bounds required');
  invariant(new Map(policy.evaluatorArtifacts).get(reviewer.evaluatorId) === hashBytes(Buffer.from(descriptor({ ...reviewer, files: reviewer.files.map(file => ({ ...file, path: '' })) }))), 'Public reviewer metadata differs from policy artifact');
  return { version: 1, policy, reviewer, bounds: structuredClone(metadata.bounds) };
}
interface SavedReviewer { policyDigest: string; candidateId: string; reviewer: ReviewerFile; descriptorDigest: string }
const namespace = 'host.derived-reviewers';
export interface ReviewerRegistryOptions { store: OperationalStore; host: HostBindings; directory: string; configuredReviewer: ReviewerFile }
/** Sealed runnable snapshots are private host artifacts, never a live author workspace.
 * Preparation confers no admission or activation authority. Callers select the judge by
 * the old proof's policy, and only choose a new judge for later accepted-policy work.
 */
export class ReviewerRegistry {
  readonly options: ReviewerRegistryOptions;
  constructor(options: ReviewerRegistryOptions) {
    this.options = { ...options, configuredReviewer: structuredClone(options.configuredReviewer) };
    const { directory, host } = options;
    invariant(isAbsolute(directory) && resolve(directory) === directory && [host.workspaceDirectory, host.artifactStore, host.stateDirectory].every(root => !beneath(root, directory)), 'Reviewer snapshots must remain outside application roots');
  }
  get(policy: AdmissionPolicy): ReviewerFile {
    const saved = this.options.store.get<SavedReviewer>(namespace, policy.policyDigest)?.value;
    const reviewer = saved?.reviewer ?? this.options.configuredReviewer;
    const expected = hashBytes(Buffer.from(descriptor(reviewer)));
    invariant(!saved || saved.policyDigest === policy.policyDigest && digest(saved.candidateId) && saved.descriptorDigest === expected, 'Retained reviewer binding changed');
    const configured = this.options.configuredReviewer;
    invariant(reviewer.evaluatorId === configured.evaluatorId && reviewer.keyFile === configured.keyFile && ['pollMs', 'maxElapsedMs', 'maxOutputBytes', 'maxClosureBytes', 'memoryBytes'].every(key => reviewer[key as keyof ReviewerFile] === configured[key as keyof ReviewerFile]), 'Reviewer cannot replace private authority or resource grants');
    invariant(policy.evaluatorArtifacts.get(reviewer.evaluatorId) === expected && policy.evaluatorKeys.has(reviewer.evaluatorId), 'Reviewer closure differs from selected policy');
    invariant(hashBytes(readHostFile(reviewer.keyFile, 65536)) === hashBytes(policy.evaluatorKeys.get(reviewer.evaluatorId)!), 'Reviewer signing key differs from configured authority');
    let bytes = 0;
    for (const file of reviewer.files) {
      if (saved) invariant(file.path === join(this.options.directory, file.sha256), 'Retained reviewer file escaped sealed storage');
      const content = readHostFile(file.path, reviewer.maxClosureBytes - bytes); bytes += content.length;
      invariant(hashBytes(content) === file.sha256, 'Retained reviewer executable closure changed');
    }
    return structuredClone(reviewer);
  }
  publicDescriptor(policy: AdmissionPolicy): ReviewerMetadata {
    const reviewer = this.get(policy);
    return { version: 1, policy: policyDescriptor(policy) as unknown as PublicPolicy, reviewer: { evaluatorId: reviewer.evaluatorId, executable: reviewer.executable, args: reviewer.args,
      files: reviewer.files.map(({ mount, sha256 }) => ({ mount, sha256, inherit: true })) },
      bounds: { pollMs: reviewer.pollMs, maxElapsedMs: reviewer.maxElapsedMs, maxOutputBytes: reviewer.maxOutputBytes, maxClosureBytes: reviewer.maxClosureBytes, memoryBytes: reviewer.memoryBytes } };
  }
  prepare(prior: AdmissionPolicy, next: AdmissionPolicy, candidate: FrozenCandidate): void {
    const previous = this.get(prior), { host, directory, store } = this.options;
    invariant(identity(verifyCandidate(host.artifactStore, candidate.manifest.id)) === identity(candidate) && next.controlRevision === candidate.manifest.controls && identity((candidate.inputs.controls as { policy?: unknown }).policy) === identity(policyDescriptor(next)), 'Reviewer preparation requires the exact frozen candidate and staged policy');
    publicPolicy(policyDescriptor(next), policyDescriptor(prior));
    invariant([...next.evaluatorArtifacts].every(([id, artifact]) => id === previous.evaluatorId || prior.evaluatorArtifacts.get(id) === artifact), 'Only the configured runnable evaluator may be replaced');
    const entry = candidate.files.find(file => file.path === governanceProposalPath);
    let proposal: GovernanceProposal | undefined;
    if (entry) {
      const bytes = readHostFile(join(host.artifactStore, candidate.manifest.id, 'payload', governanceProposalPath), 65536);
      invariant(hashBytes(bytes) === entry.sha256, 'Frozen governance proposal changed');
      proposal = governanceProposal(JSON.parse(bytes.toString('utf8')), policyDescriptor(prior));
      invariant(identity(proposal.policy) === identity(policyDescriptor(next)), 'Frozen governance proposal differs from staged policy');
    }
    const requested = proposal?.reviewer ?? { evaluatorId: previous.evaluatorId, executable: previous.executable, args: previous.args, files: previous.files.map(({ mount, sha256 }) => ({ mount, sha256, inherit: true as const })) };
    sourceReviewer(requested);
    invariant(requested.evaluatorId === previous.evaluatorId, 'Reviewer cannot replace configured signing identity');
    let total = 0;
    const files = requested.files.map(file => {
      let path: string;
      if ('source' in file) {
        invariant(candidate.files.some(entry => entry.path === file.source && entry.sha256 === file.sha256) && (candidate.inputs.controls as { files?: { path: string; sha256: string }[] }).files?.some(entry => entry.path === file.source && entry.sha256 === file.sha256), 'Reviewer source must bind the frozen control closure');
        path = join(host.artifactStore, candidate.manifest.id, 'payload', file.source);
      } else {
        const inherited = previous.files.find(entry => entry.mount === file.mount && entry.sha256 === file.sha256);
        invariant(inherited, 'Reviewer inherited mount differs from prior accepted closure'); path = inherited.path;
      }
      const bytes = readHostFile(path, previous.maxClosureBytes - total); total += bytes.length;
      invariant(hashBytes(bytes) === file.sha256, 'Proposed reviewer bytes changed');
      return { mount: file.mount, sha256: file.sha256, bytes };
    });
    const reviewer: ReviewerFile = { ...previous, executable: requested.executable, args: requested.args, files: files.map(({ mount, sha256 }) => ({ mount, sha256, path: join(directory, sha256) })) };
    const descriptorDigest = hashBytes(Buffer.from(descriptor(reviewer)));
    invariant(next.evaluatorArtifacts.get(reviewer.evaluatorId) === descriptorDigest, 'Proposed reviewer closure differs from next governance descriptor');
    mkdirSync(directory, { recursive: true, mode: 0o700 }); assertPrivateHostDirectory(directory);
    invariant(store.list(namespace).length < 64 || store.get(namespace, next.policyDigest), 'Reviewer revision retention limit reached');
    const retained = readdirSync(directory); invariant(retained.length <= 4096, 'Reviewer snapshot entry limit reached');
    let retainedBytes = 0;
    for (const name of retained) {
      invariant(digest(name), 'Unexpected interrupted reviewer snapshot; host cleanup required');
      const stat = lstatSync(join(directory, name));
      invariant(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'Private singly linked reviewer snapshot required');
      retainedBytes += stat.size;
    }
    const additions = new Map(files.filter(file => !existsSync(join(directory, file.sha256))).map(file => [file.sha256, file.bytes.length]));
    invariant(retainedBytes + [...additions.values()].reduce((sum, size) => sum + size, 0) <= previous.maxClosureBytes && retained.length + additions.size <= 4096, 'Reviewer retained snapshots exceed the existing closure byte grant');
    for (const file of files) {
      const destination = join(directory, file.sha256);
      if (!existsSync(destination)) {
        const temporary = join(directory, `.pending-${randomUUID()}`);
        try {
          writeFileSync(temporary, file.bytes, { flag: 'wx', mode: 0o500 });
          const fd = openSync(temporary, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
          linkSync(temporary, destination);
        } finally { rmSync(temporary, { force: true }); }
      }
      invariant(hashBytes(readHostFile(destination, previous.maxClosureBytes)) === file.sha256, 'Sealed reviewer snapshot changed');
    }
    const fd = openSync(directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    const value: SavedReviewer = { policyDigest: next.policyDigest, candidateId: candidate.manifest.id, reviewer, descriptorDigest };
    store.transaction(() => {
      const existing = store.get<SavedReviewer>(namespace, next.policyDigest);
      if (existing) invariant(identity(existing.value.reviewer) === identity(reviewer) && existing.value.descriptorDigest === descriptorDigest, 'Conflicting immutable reviewer policy binding');
      else store.put(namespace, next.policyDigest, value, null);
    });
    this.get(next);
  }
}
