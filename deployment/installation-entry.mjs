#!/usr/bin/env node
// Explicit one-time administrator capability; never reachable from model workers or the service.
import { execFileSync } from 'node:child_process';
import { chownSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [operation, directory, uidText, gidText, bytesText, inodesText] = process.argv.slice(2);
const uid = Number(uidText), gid = Number(gidText), bytes = Number(bytesText), inodes = Number(inodesText);
const require = (condition, reason) => { if (!condition) throw new Error(reason); };
const run = (binary, args) => execFileSync(binary, args, { encoding: 'utf8', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
require(process.getuid?.() === 0 && process.platform === 'linux', 'Explicit Linux administrator required');
require(process.argv.length === 8 && ['create-host-data', 'mount-host-data'].includes(operation), 'Usage: installation-entry.mjs create-host-data|mount-host-data DIRECTORY UID GID BYTES INODES');
require(typeof directory === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(directory) && directory !== '/' && resolve(directory) === directory && !directory.split('/').some(part => part === '.' || part === '..'), 'Canonical ordinary absolute directory required');
require([uid, gid, bytes, inodes].every(Number.isSafeInteger) && uid > 0 && gid > 0 && uid <= 2147483647 && gid <= 2147483647 && bytes >= 16 * 1024 * 1024 && bytes <= 16 * 1024 * 1024 * 1024 && bytes % 4096 === 0 && inodes >= 128 && inodes <= 1000000, 'Explicit supported bounded UID/GID/byte/inode profile required');
const parent = dirname(directory); require(realpathSync(parent) === parent, 'Ordinary provisioning parent required');
const parentStat = lstatSync(parent); require(parentStat.uid === 0 && (parentStat.mode & 0o022) === 0, 'Stable root-owned provisioning parent required');
const root = join(directory, 'work'), image = join(directory, 'workspace.ext4');
if (operation === 'create-host-data') {
  // Reviewed workspace helper supplies the same fixed filesystem primitive, with an independent host-data layout.
  require(!existsSync(directory), 'Existing host data is never recreated, resized or truncated');
  run(process.execPath, [fileURLToPath(new URL('../packages/supervisor/provision-workspace.mjs', import.meta.url)), 'create', directory, String(uid), String(gid), String(bytes), String(inodes)]);
  // Change only the new mounted root; failure retains the created image for explicit inspection.
  chownSync(root, 0, 0); chmodSync(root, 0o755);
  for (const name of ['state', 'artifacts', 'evidence']) {
    const path = join(root, name); mkdirSync(path, { mode: 0o700 }); chownSync(path, uid, gid);
  }
  // systemd opens append output with host privilege. The service must not replace its pathname.
  mkdirSync(join(root, 'logs'), { mode: 0o755 });
  writeFileSync(join(root, 'logs/coordinator.log'), '', { flag: 'wx', mode: 0o600 });
} else {
  require(realpathSync(directory) === directory && realpathSync(image) === image && realpathSync(root) === root, 'Existing ordinary host-data layout required');
  const layoutStat = lstatSync(directory), imageStat = lstatSync(image);
  require(layoutStat.isDirectory() && layoutStat.uid === 0 && (layoutStat.mode & 0o022) === 0 && imageStat.isFile() && imageStat.nlink === 1 && imageStat.uid === 0 && (imageStat.mode & 0o077) === 0 && imageStat.size === bytes, 'Existing image/layout differs; refusing destructive provisioning');
  const mounted = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4] === root);
  if (!mounted) {
    const placeholder = lstatSync(root); require(placeholder.isDirectory() && placeholder.uid === 0 && (placeholder.mode & 0o022) === 0, 'Root-owned stable mountpoint required');
    run('/usr/bin/mount', ['-t', 'ext4', '-o', 'loop,nodev,nosuid', image, root]);
  }
}
const mount = JSON.parse(run('/usr/bin/findmnt', ['--json', '--mountpoint', root, '--output', 'SOURCE,FSTYPE,OPTIONS'])).filesystems?.[0];
require(mount && /^\/dev\/loop\d+$/.test(mount.source) && mount.fstype === 'ext4' && ['nodev', 'nosuid', 'rw'].every(option => mount.options.split(',').includes(option)) && readFileSync(`/sys/class/block/${basename(mount.source)}/loop/backing_file`, 'utf8').trim() === image, 'Host data must mount its exact bounded backing image');
const fs = statfsSync(root, { bigint: true }), rootStat = lstatSync(root);
require(fs.type === 0xef53n && fs.blocks * fs.bsize <= BigInt(bytes) && fs.files <= BigInt(inodes) && rootStat.uid === 0 && (rootStat.mode & 0o022) === 0, 'Host-data root capacity or ownership differs');
for (const name of ['state', 'artifacts', 'evidence', 'logs']) {
  const path = join(root, name);
  if (operation === 'mount-host-data' && name === 'evidence' && !existsSync(path)) continue;
  require(realpathSync(path) === path, 'Ordinary host-data subdirectory required');
  const stat = lstatSync(path);
  if (name === 'logs') {
    require(stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o022) === 0 && stat.dev === rootStat.dev, 'Root-owned bounded append-log directory required');
    const log = join(path, 'coordinator.log'); require(realpathSync(log) === log, 'Ordinary append-log file required');
    const file = lstatSync(log); require(file.isFile() && file.uid === 0 && file.nlink === 1 && (file.mode & 0o077) === 0 && file.dev === rootStat.dev, 'Root-owned bounded append-log file required');
  } else require(stat.isDirectory() && stat.uid === uid && stat.gid === gid && (stat.mode & 0o077) === 0 && stat.dev === rootStat.dev, 'Private same-filesystem host-data directory required');
}
process.stdout.write(JSON.stringify({ root, image, bytes, inodes, stateDirectory: join(root, 'state'), artifactStore: join(root, 'artifacts'), evidenceDirectory: join(root, 'evidence'), logDirectory: join(root, 'logs') }) + '\n');
