import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const lockBytes = await readFile(new URL('./package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
async function footprint(path) {
  let bytes = 0, files = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) { const sub = await footprint(child); bytes += sub.bytes; files += sub.files; }
    else if (entry.isFile()) { bytes += (await lstat(child)).size; files++; }
  }
  return { bytes, files };
}
const packages = [];
for (const [path, pin] of Object.entries(lock.packages)) {
  if (!path) continue;
  const installed = JSON.parse(await readFile(new URL(`./${path}/package.json`, import.meta.url)));
  const fp = await footprint(new URL(`./${path}`, import.meta.url).pathname);
  packages.push({ name: installed.name, version: installed.version, license: installed.license ?? pin.license, engines: installed.engines ?? null, ...fp, lifecycleScripts: Object.fromEntries(Object.entries(installed.scripts ?? {}).filter(([key]) => ['preinstall', 'install', 'postinstall', 'prepare'].includes(key))), integrity: pin.integrity });
}
const total = packages.reduce((sum, pkg) => ({ bytes: sum.bytes + pkg.bytes, files: sum.files + pkg.files }), { bytes: 0, files: 0 });
// This lock is flat. Derive the direct-adapter closure without another installation.
const directNames = new Set();
function collect(name) {
  if (directNames.has(name)) return;
  directNames.add(name);
  const pin = lock.packages[`node_modules/${name}`];
  if (!pin) throw new Error(`Unresolved lock dependency: ${name}`);
  for (const child of Object.keys({ ...pin.dependencies, ...pin.peerDependencies })) collect(child);
}
collect('@ai-sdk/mistral');
const directPackages = packages.filter(pkg => directNames.has(pkg.name));
const directAdapterClosure = { basis: 'flat-lock transitive dependencies and peers; not a separate installation or bundle', packageCount: directPackages.length, bytes: directPackages.reduce((sum, pkg) => sum + pkg.bytes, 0), names: [...directNames].sort() };
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, lockSha256: createHash('sha256').update(lockBytes).digest('hex'), packageCount: packages.length, total, directAdapterClosure, packages }, null, 2));
