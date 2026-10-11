import { closeSync, constants, fsyncSync, fstatSync, openSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { canonicalJson, identity, invariant, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { ProcessLease } from '../../packages/supervisor/process-lease.ts';

/** A host-private, descriptor-pinned, write-once store. The caller provisions its directory. */
export class QualificationStore {
  private fd: number;
  private lease: ProcessLease;
  readonly directory: string;
  readonly capacityBytes: number;
  constructor(directory: string, capacityBytes = 32 * 1024 * 1024) {
    this.directory = directory; this.capacityBytes = capacityBytes;
    invariant(isAbsolute(directory) && resolve(directory) === directory && !directory.startsWith('/usr/'), 'Canonical private store required');
    invariant(Number.isSafeInteger(capacityBytes) && capacityBytes > 0 && capacityBytes <= 256 * 1024 * 1024, 'Bounded private store capacity required');
    let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      for (const part of directory.split('/').filter(Boolean)) { const next = openSync(`/proc/self/fd/${fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); closeSync(fd); fd = next; }
      const stat = fstatSync(fd); invariant(stat.isDirectory() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, 'Store directory must be owner-only');
      this.fd = fd;
      const leaseFd = openSync(this.path('writer.sqlite'), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try { const leaseStat = fstatSync(leaseFd); invariant(leaseStat.isFile() && leaseStat.nlink === 1 && leaseStat.uid === process.getuid?.() && (leaseStat.mode & 0o077) === 0, 'Invalid private writer lease'); }
      finally { closeSync(leaseFd); }
      this.lease = new ProcessLease(`/proc/self/fd/${fd}/writer.sqlite`);
    } catch (error) { closeSync(fd); throw error; }
  }
  close(): void { this.lease.close(); closeSync(this.fd); }
  /** Immutable host claim-store binding; uses the existing pinned descriptor and writer lease. */
  identity(): { directory: string; device: string; inode: string; uid: string; capacityBytes: number } {
    this.lease.assertHeld(); const stat = fstatSync(this.fd, { bigint: true });
    return { directory: this.directory, device: String(stat.dev), inode: String(stat.ino), uid: String(stat.uid), capacityBytes: this.capacityBytes };
  }
  get usedBytes(): number {
    return this.usage().usedBytes;
  }
  usage(): { usedBytes: number; entryCount: number } {
    this.lease.assertHeld(); const names = readdirSync(this.path('.'));
    invariant(names.length < 4096, 'Private evidence entry limit');
    return { usedBytes: names.filter(file => !['writer.sqlite', 'writer.sqlite-journal'].includes(file)).reduce((total, file) => total + this.read(file).byteLength, 0), entryCount: names.length };
  }
  private path(name: string): string { return `/proc/self/fd/${this.fd}/${name}`; }
  private read(name: string, maxBytes = this.capacityBytes): Buffer {
    this.lease.assertHeld();
    invariant(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= this.capacityBytes, 'Bounded private evidence read required');
    invariant(/^[a-f0-9]{64}$/.test(name) || /^(claim|grant)-[a-f0-9]{64}$/.test(name), 'Unknown evidence name');
    const fd = openSync(this.path(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd, { bigint: true });
      invariant(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!()) && (before.mode & 0o077n) === 0n, 'Private evidence file changed');
      invariant(before.size <= BigInt(maxBytes), 'Private evidence exceeds read bound');
      const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, Math.min(bytes.length - offset, 64 * 1024), offset);
        invariant(count > 0, 'Private evidence changed during read'); offset += count;
      }
      const eof = readSync(fd, Buffer.alloc(1), 0, 1, bytes.length), after = fstatSync(fd, { bigint: true });
      invariant(eof === 0 && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs &&
        before.mode === after.mode && before.uid === after.uid && before.gid === after.gid && before.dev === after.dev && before.ino === after.ino && after.nlink === 1n,
      'Private evidence changed during read');
      return bytes;
    }
    finally { closeSync(fd); }
  }
  private write(name: string, bytes: Buffer): void {
    this.lease.assertHeld();
    const { usedBytes: used, entryCount } = this.usage();
    invariant(used + bytes.byteLength <= this.capacityBytes, 'Private evidence capacity exhausted');
    invariant(entryCount + 1 < 4096, 'Private evidence entry limit');
    const fd = openSync(this.path(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    fsyncSync(this.fd);
  }
  /** Both IDs are one-use. A crash between writes conservatively strands the grant. */
  claim(id: string, grantId: string, manifest: unknown): void {
    const bytes = Buffer.from(canonicalJson({ manifest, claimedAt: new Date().toISOString() }));
    this.write(`grant-${identity(grantId)}`, bytes);
    this.write(`claim-${identity(id)}`, bytes);
  }
  put(value: unknown): ArtifactRef {
    return this.putBytes(Buffer.from(canonicalJson(value)));
  }
  /** Retains the exact byte stream; identical bytes deduplicate regardless of their source. */
  putBytes(value: Uint8Array): ArtifactRef {
    this.lease.assertHeld();
    invariant(value instanceof Uint8Array, 'Private evidence byte array required');
    invariant(value.byteLength <= this.capacityBytes, 'Private evidence capacity exhausted');
    const bytes = Buffer.from(value), sha256 = hashBytes(bytes);
    try { invariant(this.read(sha256, bytes.byteLength).equals(bytes), 'Existing immutable artifact changed'); return { uri: `sha256:${sha256}`, sha256 }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { this.write(sha256, bytes); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; invariant(this.read(sha256, bytes.byteLength).equals(bytes), 'Existing immutable artifact changed'); }
    return { uri: `sha256:${sha256}`, sha256 };
  }
  readArtifact(ref: ArtifactRef, maxBytes = this.capacityBytes): Buffer {
    invariant(ref.uri === `sha256:${ref.sha256}` && /^[a-f0-9]{64}$/.test(ref.sha256), 'Content-addressed qualification artifact required');
    const bytes = this.read(ref.sha256, maxBytes); invariant(hashBytes(bytes) === ref.sha256, 'Qualification artifact corrupted'); return bytes;
  }
}
