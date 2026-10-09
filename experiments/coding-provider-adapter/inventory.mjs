import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const lockBytes = await readFile(new URL('./package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
async function footprint(path) {
  let bytes = 0, files = 0;
  for (const item of await readdir(path, { withFileTypes: true })) {
    const child = join(path, item.name);
    if (item.isDirectory()) { const sub = await footprint(child); bytes += sub.bytes; files += sub.files; }
    else if (item.isFile()) { bytes += (await lstat(child)).size; files++; }
  }
  return { bytes, files };
}
const packages = [];
for (const [path, pin] of Object.entries(lock.packages)) {
  if (!path) continue;
  const manifest = JSON.parse(await readFile(new URL(`./${path}/package.json`, import.meta.url)));
  packages.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? pin.license, engines: manifest.engines ?? null, ...await footprint(new URL(`./${path}`, import.meta.url).pathname), integrity: pin.integrity, lifecycleScripts: Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([key]) => ['preinstall', 'install', 'postinstall', 'prepare'].includes(key))) });
}
const source = [];
for (const path of ['facade.ts', 'test/facade.test.ts']) {
  const bytes = await readFile(new URL(path, import.meta.url));
  source.push({ path, bytes: bytes.length, lines: bytes.toString('utf8').trimEnd().split('\n').length, sha256: sha256(bytes) });
}
const toolchain = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
const total = packages.reduce((sum, item) => ({ bytes: sum.bytes + item.bytes, files: sum.files + item.files }), { bytes: 0, files: 0 });
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, lockSha256: sha256(lockBytes), packageCount: packages.length, total, source, developmentToolchain: toolchain.devDependencies, packages }, null, 2));
