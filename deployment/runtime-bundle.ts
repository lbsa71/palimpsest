import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { invariant } from '../packages/contracts/index.ts';

export const runtimeBundlePath = '.runtime/node';
export const maxRuntimeBytes = 128 * 1024 * 1024;
export interface RuntimeIdentity { nodeVersion: string; nodeSha256: string; platform: string; arch: string; bundle?: { path: typeof runtimeBundlePath; bytes: number } }
export interface RuntimeProposal extends Omit<RuntimeIdentity, 'bundle'> { workspacePath: string }

export function validateRuntime(runtime: RuntimeIdentity): void {
  invariant(runtime && Object.keys(runtime).sort().join(',') === (runtime.bundle ? 'arch,bundle,nodeSha256,nodeVersion,platform' : 'arch,nodeSha256,nodeVersion,platform'), 'Exact runtime descriptor required');
  invariant(/^v24\.\d+\.\d+$/.test(runtime.nodeVersion) && /^[a-f0-9]{64}$/.test(runtime.nodeSha256) && runtime.platform === process.platform && runtime.arch === process.arch && process.platform === 'linux', 'Node 24 runtime for this physical platform required');
  if (runtime.bundle) invariant(Object.keys(runtime.bundle).sort().join(',') === 'bytes,path' && runtime.bundle.path === runtimeBundlePath && Number.isSafeInteger(runtime.bundle.bytes) && runtime.bundle.bytes > 0 && runtime.bundle.bytes <= maxRuntimeBytes, 'Bounded runtime bundle descriptor required');
}

/** Pin every ancestor; workspace paths, hardlinks, devices and symlinks cannot redirect the host copy. */
function readExecutable(root: string, path: string, limit: number): Buffer {
  invariant(isAbsolute(root) && !root.split('/').includes('..') && path && !isAbsolute(path) && path.split('/').every(part => part && part !== '.' && part !== '..') && !path.includes('\\') && !path.includes('\0'), 'Normalized runtime path required');
  let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const parts = [...root.split('/').filter(Boolean), ...path.split('/')];
    for (let i = 0; i < parts.length; i++) { const next = openSync(`/proc/self/fd/${fd}/${parts[i]}`, constants.O_RDONLY | constants.O_NOFOLLOW | (i < parts.length - 1 ? constants.O_DIRECTORY : constants.O_NONBLOCK)); closeSync(fd); fd = next; }
    const before = fstatSync(fd, { bigint: true });
    invariant(before.isFile() && before.nlink === 1n && (before.mode & 0o111n) !== 0n, 'Runtime requires a regular singly linked executable');
    invariant(before.size > 0n && before.size <= BigInt(limit), 'Runtime exceeds separately granted byte bounds');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const n = readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset); invariant(n > 0, 'Runtime changed during bounded read'); offset += n; }
    const after = fstatSync(fd, { bigint: true });
    invariant(readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0 && after.size === before.size && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs && after.mode === before.mode && after.nlink === 1n, 'Runtime changed during bounded read');
    invariant(bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])), 'Runtime must be an ELF executable');
    return bytes;
  } finally { closeSync(fd); }
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Return the exact bounded bytes verified against the accepted runtime identity. */
export function readVerifiedRuntimeFile(root: string, path: string, runtime: RuntimeIdentity): Buffer {
  validateRuntime(runtime);
  const bytes = readExecutable(root, path, maxRuntimeBytes);
  invariant(digest(bytes) === runtime.nodeSha256 && (!runtime.bundle || bytes.length === runtime.bundle.bytes), 'Pinned runtime changed or bundle size differs');
  return bytes;
}
export function verifyRuntimeFile(root: string, path: string, runtime: RuntimeIdentity): void { readVerifiedRuntimeFile(root, path, runtime); }
/** This verifier never executes the proposed binary; only already admitted launchers may execute it. */
export function stageRuntimeBundle(sourceRoot: string, sourcePath: string, stagingRoot: string, runtime: RuntimeIdentity, grantBytes: number): RuntimeIdentity {
  invariant(Number.isSafeInteger(grantBytes) && grantBytes > 0 && grantBytes <= maxRuntimeBytes, 'Explicit bounded runtime staging grant required');
  validateRuntime(runtime);
  const bytes = readExecutable(sourceRoot, sourcePath, grantBytes);
  invariant(digest(bytes) === runtime.nodeSha256 && (!runtime.bundle || runtime.bundle.bytes === bytes.length), 'Proposed runtime hash or retained bundle size mismatch');
  const destination = join(stagingRoot, runtimeBundlePath);
  mkdirSync(dirname(destination), { mode: 0o700 });
  writeFileSync(destination, bytes, { flag: 'wx', mode: 0o700 });
  return { nodeVersion: runtime.nodeVersion, nodeSha256: runtime.nodeSha256, platform: runtime.platform, arch: runtime.arch, bundle: { path: runtimeBundlePath, bytes: bytes.length } };
}
