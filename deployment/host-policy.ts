import { lstatSync, readFileSync, realpathSync } from 'node:fs';
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
export function readHostFile(path: string): Buffer {
  invariant(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'Canonical host file required');
  const stat = lstatSync(path);
  invariant(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'Host file must be a singly linked owner-only regular file');
  return readFileSync(path);
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
    const key = readHostFile(keyPath);
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
    invariant(realpathSync(directory) === directory, 'Canonical evidence store required');
    const digest = uri.slice(7), path = join(directory, digest), stat = lstatSync(path);
    invariant(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && realpathSync(path) === path, 'Evidence blob must be a regular unlinked file');
    const bytes = readFileSync(path);
    invariant(hashBytes(bytes) === digest, 'Evidence blob identity changed');
    return bytes;
  };
}
