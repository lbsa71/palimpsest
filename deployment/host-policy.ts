import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { identity, invariant } from '../packages/contracts/index.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../packages/release/admission.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { beneath } from './config.ts';

/** This file and its key locations are host configuration, never candidate/model arguments. */
export interface HostPolicyFile {
  controlRevision: string;
  policyDigest: string;
  descriptor: {
    kind: 'engineering' | 'product';
    requiredCases: string[];
    evaluatorArtifacts: [string, string][];
    evaluatorKeyDigests: [string, string][];
  };
  keyFiles: [string, string][];
}
/** Walk every component through pinned descriptors; pathname checks alone permit replacement races. */
function openHostPath(path: string, directory: boolean): number {
  invariant(isAbsolute(path) && resolve(path) === path, 'Canonical host path required');
  invariant(!beneath('/usr', path), 'Host private paths must remain outside worker system mounts');
  let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const parts = path.split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      const next = openSync(`/proc/self/fd/${fd}/${parts[index]}`, constants.O_RDONLY | constants.O_NOFOLLOW |
        (directory || index < parts.length - 1 ? constants.O_DIRECTORY : constants.O_NONBLOCK));
      closeSync(fd); fd = next;
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
export function assertPrivateHostDirectory(path: string): void {
  const fd = openHostPath(path, true);
  try {
    const stat = fstatSync(fd);
    invariant(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'Host directory must be owner-only');
  } finally { closeSync(fd); }
}
/** Host-selected limit applies to proofs/configuration/evidence; key reads use a smaller bound. */
export function readHostFile(path: string, maxBytes = 8 * 1024 * 1024): Buffer {
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Positive host file byte limit required');
  const fd = openHostPath(path, false);
  try {
    const before = fstatSync(fd, { bigint: true });
    invariant(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!()) && (before.mode & 0o077n) === 0n, 'Host file must be a singly linked owner-only regular file');
    invariant(before.size <= BigInt(maxBytes), 'Host file exceeds byte limit');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, Math.min(bytes.length - offset, 65536), offset);
      invariant(count > 0, 'Host file changed during read'); offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    invariant(readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) === 0 && after.size === before.size &&
      after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs && after.mode === before.mode && after.nlink === 1n, 'Host file changed during read');
    return bytes;
  } finally { closeSync(fd); }
}
export function loadHostPolicy(path: string, modelRoots: readonly string[] = []): AdmissionPolicy {
  invariant(modelRoots.every(root => !beneath(root, path)), 'Policy files must remain outside model-accessible roots');
  const file = JSON.parse(readHostFile(path).toString('utf8')) as HostPolicyFile;
  invariant(Object.keys(file).sort().join(',') === 'controlRevision,descriptor,keyFiles,policyDigest', 'Exact host policy fields required');
  const descriptor = file.descriptor;
  invariant(descriptor && ['engineering', 'product'].includes(descriptor.kind) && Array.isArray(descriptor.requiredCases) && descriptor.requiredCases.length > 0 && descriptor.requiredCases.every(id => typeof id === 'string' && id.length > 0), 'Explicit admission policy required');
  const maps = [descriptor.evaluatorArtifacts, descriptor.evaluatorKeyDigests, file.keyFiles];
  for (const entries of maps) invariant(Array.isArray(entries) && entries.length > 0 && entries.every(entry => Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string' && value.length > 0)) && new Set(entries.map(([id]) => id)).size === entries.length, 'Unique evaluator descriptors required');
  invariant(new Set(descriptor.requiredCases).size === descriptor.requiredCases.length, 'Unique required cases required');
  const expectedKeys = new Map(descriptor.evaluatorKeyDigests), artifacts = new Map(descriptor.evaluatorArtifacts);
  invariant(file.keyFiles.length === expectedKeys.size && artifacts.size === expectedKeys.size, 'Exact evaluator key set required');
  const keys = new Map<string, Uint8Array>();
  for (const [id, keyPath] of file.keyFiles) {
    invariant(modelRoots.every(root => !beneath(root, keyPath)), 'Evaluator keys must remain outside model-accessible roots');
    const key = readHostFile(keyPath, 64 * 1024);
    invariant(key.length >= 32 && hashBytes(key) === expectedKeys.get(id) && artifacts.has(id), 'Evaluator key differs from public descriptor');
    keys.set(id, key);
  }
  const policy: AdmissionPolicy = { controlRevision: file.controlRevision, policyDigest: file.policyDigest, kind: descriptor.kind,
    requiredCases: descriptor.requiredCases, evaluatorArtifacts: artifacts, evaluatorKeys: keys };
  invariant(identity(policyDescriptor(policy)) === identity(descriptor) && admissionPolicyIdentity(policy) === file.policyDigest, 'Host policy differs from exact public identity');
  return policy;
}
/** No URLs, relative paths or arbitrary files are resolved by admission. */
export function contentAddressedEvidence(directory: string): (uri: string) => Uint8Array {
  invariant(isAbsolute(directory) && resolve(directory) === directory, 'Canonical evidence store required');
  return uri => {
    invariant(/^sha256:[a-f0-9]{64}$/.test(uri), 'Evidence URI must name a content-addressed host blob');
    assertPrivateHostDirectory(directory);
    const digest = uri.slice(7), path = join(directory, digest);
    const bytes = readHostFile(path);
    invariant(hashBytes(bytes) === digest, 'Evidence blob identity changed');
    return bytes;
  };
}
