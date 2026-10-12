#!/usr/bin/env node
// One-time administrator operation. The supervisor and worker never invoke sudo or receive this capability.
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function nodeProvisionEnvironment() {
  return { uid: () => process.getuid(), chmod: chmodSync, chown: chownSync, lstat: lstatSync, mkdir: mkdirSync,
    realpath: realpathSync, rm: rmSync, stat: statSync,
    run: (binary, args) => execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 65536 }),
    output: value => process.stdout.write(value) };
}

export function provisionWorkspace(arguments_, supplied = nodeProvisionEnvironment()) {
  const environment = {};
  for (const key of ['uid', 'chmod', 'chown', 'lstat', 'mkdir', 'realpath', 'rm', 'stat', 'run', 'output']) {
    const callback = supplied[key]; environment[key] = callback.bind(supplied);
  }

  const [operation, directory, uidText, gidText, bytesText, inodesText] = arguments_;
  if (environment.uid() !== 0 || !directory || !isAbsolute(directory) || environment.realpath(dirname(directory)) !== dirname(directory)) {
    throw new Error('Administrator and an absolute path under an existing ordinary parent required');
  }
  const run = environment.run;
  const image = join(directory, 'workspace.ext4'), workspace = join(directory, 'work');
  if (operation === 'create') {
    const uid = Number(uidText), gid = Number(gidText), bytes = Number(bytesText), inodes = Number(inodesText);
    if (![uid, gid, bytes, inodes].every(Number.isSafeInteger) || uid < 1 || gid < 1 ||
        bytes < 16 * 1024 * 1024 || bytes > 16 * 1024 * 1024 * 1024 || bytes % 4096 !== 0 || inodes < 128 || inodes > 1_000_000) {
      throw new Error('Explicit bounded UID/GID/byte/inode profile required (16 MiB–16 GiB)');
    }
    environment.mkdir(directory, { mode: 0o755 }); // Must be new: never truncate an existing workspace or lived state.
    let mounted = false;
    try {
      environment.mkdir(workspace, { mode: 0o700 });
      run('/usr/bin/fallocate', ['-l', String(bytes), image]); environment.chmod(image, 0o600);
      run('/usr/sbin/mkfs.ext4', ['-q', '-F', '-m', '0', '-N', String(inodes), image]);
      run('/usr/bin/mount', ['-o', 'loop,nodev,nosuid', image, workspace]); mounted = true;
      environment.rm(join(workspace, 'lost+found'), { recursive: true });
      environment.chown(workspace, uid, gid); environment.chmod(workspace, 0o700);
      environment.output(JSON.stringify({ workspace, image, workspaceBytes: bytes, workspaceInodes: inodes }) + '\n');
    } catch (error) {
      const failures = [error];
      if (mounted) {
        try { run('/usr/bin/umount', [workspace]); mounted = false; } catch (cleanup) { failures.push(cleanup); }
      }
      // Never recursively remove an image while its filesystem remains mounted.
      if (!mounted) { try { environment.rm(directory, { recursive: true, force: true }); } catch (cleanup) { failures.push(cleanup); } }
      if (failures.length > 1) throw new AggregateError(failures, 'Workspace provisioning and cleanup failed', { cause: error });
      throw error;
    }
  } else if (operation === 'remove') {
    // Removal only accepts this exact root-owned layout and a mounted loop filesystem backed by its image.
    if (environment.lstat(directory).isSymbolicLink() || environment.stat(directory).uid !== 0 || environment.stat(image).uid !== 0 ||
        environment.lstat(image).isSymbolicLink() || !environment.stat(image).isFile()) throw new Error('Not an administrator-owned provisioned workspace');
    const device = run('/usr/bin/findmnt', ['-n', '-o', 'SOURCE', '--mountpoint', workspace]).trim();
    if (!device.startsWith('/dev/loop') || environment.realpath(run('/usr/sbin/losetup', ['-n', '-O', 'BACK-FILE', device]).trim()) !== image) {
      throw new Error('Workspace mount does not match the owned backing image');
    }
    run('/usr/bin/umount', [workspace]);
    environment.rm(directory, { recursive: true });
  } else throw new Error('Usage: provision-workspace.mjs create NEW_DIRECTORY UID GID BYTES INODES | remove DIRECTORY');

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionWorkspace(process.argv.slice(2));
}
