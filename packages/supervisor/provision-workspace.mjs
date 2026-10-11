#!/usr/bin/env node
// One-time administrator operation. The supervisor and worker never invoke sudo or receive this capability.
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const [operation, directory, uidText, gidText, bytesText, inodesText] = process.argv.slice(2);
if (process.getuid() !== 0 || !directory || !isAbsolute(directory) || realpathSync(dirname(directory)) !== dirname(directory)) {
  throw new Error('Administrator and an absolute path under an existing ordinary parent required');
}
const run = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const image = join(directory, 'workspace.ext4'), workspace = join(directory, 'work');
if (operation === 'create') {
  const uid = Number(uidText), gid = Number(gidText), bytes = Number(bytesText), inodes = Number(inodesText);
  if (![uid, gid, bytes, inodes].every(Number.isSafeInteger) || uid < 1 || gid < 1 ||
      bytes < 16 * 1024 * 1024 || bytes > 16 * 1024 * 1024 * 1024 || bytes % 4096 !== 0 || inodes < 128 || inodes > 1_000_000) {
    throw new Error('Explicit bounded UID/GID/byte/inode profile required (16 MiB–16 GiB)');
  }
  mkdirSync(directory, { mode: 0o755 }); // Must be new: never truncate an existing workspace or lived state.
  let mounted = false;
  try {
    mkdirSync(workspace, { mode: 0o700 });
    run('/usr/bin/fallocate', ['-l', String(bytes), image]); chmodSync(image, 0o600);
    run('/usr/sbin/mkfs.ext4', ['-q', '-F', '-m', '0', '-N', String(inodes), image]);
    run('/usr/bin/mount', ['-o', 'loop,nodev,nosuid', image, workspace]); mounted = true;
    rmSync(join(workspace, 'lost+found'), { recursive: true });
    chownSync(workspace, uid, gid); chmodSync(workspace, 0o700);
    process.stdout.write(JSON.stringify({ workspace, image, workspaceBytes: bytes, workspaceInodes: inodes }) + '\n');
  } catch (error) {
    if (mounted) run('/usr/bin/umount', [workspace]);
    rmSync(directory, { recursive: true, force: true }); throw error;
  }
} else if (operation === 'remove') {
  // Removal only accepts this exact root-owned layout and a mounted loop filesystem backed by its image.
  if (lstatSync(directory).isSymbolicLink() || statSync(directory).uid !== 0 || statSync(image).uid !== 0 ||
      lstatSync(image).isSymbolicLink() || !statSync(image).isFile()) throw new Error('Not an administrator-owned provisioned workspace');
  const device = run('/usr/bin/findmnt', ['-n', '-o', 'SOURCE', '--mountpoint', workspace]).trim();
  if (!device.startsWith('/dev/loop') || realpathSync(run('/usr/sbin/losetup', ['-n', '-O', 'BACK-FILE', device]).trim()) !== image) {
    throw new Error('Workspace mount does not match the owned backing image');
  }
  run('/usr/bin/umount', [workspace]);
  rmSync(directory, { recursive: true });
} else throw new Error('Usage: provision-workspace.mjs create NEW_DIRECTORY UID GID BYTES INODES | remove DIRECTORY');
