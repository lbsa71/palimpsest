import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const vendor = new URL('./vendor/cfworker/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('source-manifest.json', vendor), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let physicalLines = 0; let bytes = 0;
const files = new Set(manifest.files.map(entry => entry.retained));
for (const entry of manifest.files) {
  const content = readFileSync(new URL(entry.retained, vendor));
  assert.equal(hash(content), entry.retainedSha256, `local hash: ${entry.retained}`);
  physicalLines += content.toString().split('\n').length - 1; bytes += content.length;
  for (const match of content.toString().matchAll(/from ['"]([^'"]+)['"]/g)) {
    assert.ok(match[1].startsWith('./'), `external import: ${match[1]}`);
    assert.ok(files.has(match[1].slice(2)), `unretained import: ${match[1]}`);
  }
  if (process.argv[2]) {
    const upstream = new URL(`${entry.source}`, new URL(`${process.argv[2].replace(/\/$/, '')}/`, 'file:///'));
    assert.equal(hash(readFileSync(upstream)), entry.upstreamSha256, `upstream hash: ${entry.source}`);
  }
}
const fixtures = new URL('./test/fixtures/', import.meta.url);
const fixtureManifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8'));
let assertions = 0;
for (const entry of fixtureManifest.files) {
  const content = readFileSync(new URL(entry.retained, fixtures));
  assert.equal(hash(content), entry.sha256, `fixture hash: ${entry.retained}`);
  assertions += JSON.parse(content).reduce((total, group) => total + group.tests.length, 0);
}
console.log(JSON.stringify({ upstream: manifest.commit, maintainedSourceFiles: files.size, physicalLines, bytes, externalRuntimeImports: [], fixtureFiles: fixtureManifest.files.length, officialAssertions: assertions, upstreamHashesChecked: Boolean(process.argv[2]) }, null, 2));
