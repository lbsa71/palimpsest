import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CandidateFile } from '../src/candidates.ts';

/** Normalized hashes from already admitted native runtime/evaluation identity.
 * This is not inferred from the currently installed mutable build receipt. */
export interface AdmittedNativeInputs {
  sourceSha256: string; binarySha256: string; receiptSha256: string;
}
export const nativeInputPaths = [
  'trusted/linux-isolation-launcher.c',
  'trusted/linux-isolation-launcher',
  'trusted/linux-isolation-launcher.json',
] as const;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Only inspect/copy explicitly prepared artifacts. Never compile or execute. */
export function verifyPreparedNativeInputs(root: string, admitted: AdmittedNativeInputs): CandidateFile[] {
  if (![admitted.sourceSha256, admitted.binarySha256, admitted.receiptSha256]
    .every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) throw new Error('Admitted native input hashes are required');
  const bytes = nativeInputPaths.map(path => {
    const metadata = lstatSync(join(root, path));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o022)) throw new Error('Native input must be regular, unlinked and not writable by others');
    if (path === nativeInputPaths[1] && !(metadata.mode & 0o111)) throw new Error('Prepared native ELF must be executable');
    return readFileSync(join(root, path));
  });
  const hashes = bytes.map(digest);
  if (hashes[0] !== admitted.sourceSha256 || hashes[1] !== admitted.binarySha256 || hashes[2] !== admitted.receiptSha256) throw new Error('Prepared native inputs differ from admitted identity');
  let receipt: Record<string, unknown>;
  try { receipt = JSON.parse(bytes[2]!.toString('utf8')) as Record<string, unknown>; }
  catch { throw new Error('Prepared native receipt is invalid'); }
  if (!receipt || receipt.version !== 1 || receipt.arch !== 'x64' || receipt.sourceSha256 !== admitted.sourceSha256
    || receipt.binarySha256 !== admitted.binarySha256) throw new Error('Prepared native receipt identity is invalid');
  if (bytes[1]!.length < 64 || !bytes[1]!.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || bytes[1]![4] !== 2 || bytes[1]![5] !== 1 || bytes[1]![6] !== 1 || bytes[1]!.readUInt16LE(18) !== 0x3e) throw new Error('Prepared native launcher must be a x86-64 little-endian ELF');
  return nativeInputPaths.map((path, index) => ({ path, mode: index === 1 ? '100755' : '100644', sha256: hashes[index]!, size: bytes[index]!.length }));
}
