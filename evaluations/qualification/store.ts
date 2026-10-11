import { closeSync, constants, fsyncSync, fstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  private path(name: string): string { return `/proc/self/fd/${this.fd}/${name}`; }
  private read(name: string): Buffer {
    invariant(/^[a-f0-9]{64}$/.test(name) || /^(claim|grant)-[a-f0-9]{64}$/.test(name), 'Unknown evidence name');
    const fd = openSync(this.path(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const s = fstatSync(fd); invariant(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o077) === 0 && s.size <= this.capacityBytes, 'Private evidence file changed'); return readFileSync(fd); }
    finally { closeSync(fd); }
  }
  private write(name: string, bytes: Buffer): void {
    this.lease.assertHeld();
    const names = readdirSync(this.path('.')); invariant(names.length < 4096, 'Private evidence entry limit');
    const used = names.filter(file => !['writer.sqlite', 'writer.sqlite-journal'].includes(file)).reduce((total, file) => total + this.read(file).byteLength, 0);
    invariant(used + bytes.byteLength <= this.capacityBytes, 'Private evidence capacity exhausted');
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
    const bytes = Buffer.from(canonicalJson(value)), sha256 = hashBytes(bytes);
    try { this.write(sha256, bytes); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; invariant(this.read(sha256).equals(bytes), 'Existing immutable artifact changed'); }
    return { uri: `sha256:${sha256}`, sha256 };
  }
  readArtifact(ref: ArtifactRef): Buffer {
    invariant(ref.uri === `sha256:${ref.sha256}` && /^[a-f0-9]{64}$/.test(ref.sha256), 'Content-addressed qualification artifact required');
    const bytes = this.read(ref.sha256); invariant(hashBytes(bytes) === ref.sha256, 'Qualification artifact corrupted'); return bytes;
  }
}
