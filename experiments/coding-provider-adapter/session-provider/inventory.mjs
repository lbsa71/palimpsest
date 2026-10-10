import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const closure = realpathSync(join(here, 'fixture-sdk'));
const baseline = dirname(closure);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const lockBytes = readFileSync(join(baseline, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
const expectedLockHash = 'b19be919f3f5ebb9a3d631c77472e33d074eef2115c1f4bc2476ff8df012925e';
if (sha256(lockBytes) !== expectedLockHash) throw new Error('Selected experiment lockfile identity changed');
function filesBelow(root) {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error('Unexpected dependency closure entry');
    }
  };
  visit(root);
  return files;
}
const packages = Object.entries(lock.packages).filter(([path]) => path.startsWith('node_modules/')).map(([path, pinned]) => {
  const name = path.slice('node_modules/'.length), root = join(closure, name);
  const metadata = JSON.parse(readFileSync(join(root, 'package.json')));
  if (metadata.name !== name || metadata.version !== pinned.version) throw new Error('Installed dependency differs from selected lockfile');
  const files = filesBelow(root).map(path => { const bytes = readFileSync(path); return { path: relative(root, path), bytes: bytes.length, sha256: sha256(bytes) }; });
  return { name, version: metadata.version, license: metadata.license, engines: metadata.engines ?? null, integrity: pinned.integrity, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), treeSha256: sha256(JSON.stringify(files)), lifecycleScripts: Object.fromEntries(Object.entries(metadata.scripts ?? {}).filter(([name]) => /^(preinstall|install|postinstall|prepare)$/.test(name))) };
});
if (packages.length !== 9) throw new Error('Selected package closure count changed');
const sourcePaths = ['.gitignore', 'README.md', 'contracts.ts', 'facade.ts', 'inventory.mjs', 'tsconfig.json', 'test/baseline.test.ts', 'test/general.test.ts'];
const source = sourcePaths.map(path => { const bytes = readFileSync(join(here, path)); return { path, bytes: bytes.length, lines: bytes.toString().split('\n').length - 1, sha256: sha256(bytes) }; });
const sdkPaths = ['@ai-sdk/mistral/src/mistral-chat-language-model.ts', '@ai-sdk/mistral/src/convert-to-mistral-chat-messages.ts', '@ai-sdk/mistral/src/convert-mistral-usage.ts', '@ai-sdk/provider/dist/index.d.ts', '@ai-sdk/provider-utils/src/response-handler.ts', '@ai-sdk/provider-utils/src/read-response-with-size-limit.ts'];
const sdkSource = sdkPaths.map(path => ({ path, sha256: sha256(readFileSync(join(closure, path))) }));
const root = join(here, '../../..');
const inventory = {
  status: 'fixture-only; no production dependency installation or live conformance',
  node: process.version, platform: process.platform, architecture: process.arch,
  resolution: { importPrefix: './fixture-sdk/', localIgnoredSymlink: 'fixture-sdk', installedClosure: closure, selectedLockSha256: sha256(lockBytes), selectedBaselineFacadeSha256: sha256(readFileSync(join(baseline, 'facade.ts'))), selectedBaselineTestSha256: sha256(readFileSync(join(baseline, 'test/facade.test.ts'))) },
  developmentToolchain: Object.fromEntries(['typescript', '@types/node'].map(name => [name, JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'))).version])),
  packageCount: packages.length, total: { bytes: packages.reduce((sum, pkg) => sum + pkg.bytes, 0), files: packages.reduce((sum, pkg) => sum + pkg.files, 0) },
  packages, sdkSource, source,
};
writeFileSync(join(here, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ packageCount: inventory.packageCount, total: inventory.total, selectedLockSha256: inventory.resolution.selectedLockSha256, sourceFiles: source.length }));
