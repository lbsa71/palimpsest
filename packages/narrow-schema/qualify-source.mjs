import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = new URL('./vendor/cfworker/validator.ts', import.meta.url);
const original = readFileSync(source, 'utf8');
const marker = '__a1_schema_dependency_probe__';
const match = '  public validate(instance: any): ValidationResult {\n';
assert.ok(original.includes(match));
const edited = original.replace(match, `${match}    if (instance === '${marker}') return { valid: false, errors: [] };\n`);
const commands = [];
function run(command, args) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  const record = { command: [command, ...args], elapsedMs: Math.round(performance.now() - started), exitCode: result.status };
  commands.push(record);
  if (result.error || result.status !== 0) throw new Error(`${JSON.stringify(record)}\n${result.stdout}\n${result.stderr}`, { cause: result.error });
  return result.stdout;
}
function freshLoad(expected) {
  const url = new URL('../../dist/packages/narrow-schema/index.js', import.meta.url).href;
  return JSON.parse(run(process.execPath, ['--input-type=module', '-e', `import { Validator } from ${JSON.stringify(url)}; const actual = new Validator({type:'string'}).validate('${marker}').valid; if (actual !== ${expected}) throw new Error('dependency edit not loaded'); console.log(JSON.stringify({valid: actual, freshProcess: true}));`]));
}
const head = run('git', ['rev-parse', 'HEAD']).trim();
let baseline; let changed;
try {
  rmSync(new URL('../../dist/', import.meta.url), { recursive: true, force: true });
  run('npm', ['run', 'check']);
  run('npm', ['run', 'build']);
  baseline = freshLoad(true);
  run('npm', ['run', 'build']);
  writeFileSync(source, edited);
  run('npm', ['run', 'check']);
  run(process.execPath, ['--test', 'packages/agent-shell/schema-regression.test.ts', 'packages/narrow-schema/schema.test.ts']);
  run('npm', ['run', 'build']);
  changed = freshLoad(false);
} finally {
  writeFileSync(source, original);
  run('npm', ['run', 'build']);
}
assert.deepEqual(readFileSync(source, 'utf8'), original);
const restored = freshLoad(true);
const hash = text => createHash('sha256').update(text).digest('hex');
const report = { evidenceKind: 'mechanical source edit/check/build/fresh-process-load', sourceHead: head, node: process.version, libraryVersion: '4.1.1', upstreamCommit: '5409fdc2bd144f68e8b28c61c71fcb16600000a6', commands, dependencyEdit: { file: 'packages/narrow-schema/vendor/cfworker/validator.ts', originalSha256: hash(original), editedSha256: hash(edited), baseline, changed, restored }, networkUsedDuringCheckBuild: false, limits: ['Provisioned pinned Node, TypeScript, and Node definitions required.', 'Fresh process proves edited compiled dependency loading; production successor activation belongs to L09.', 'No model inference or live effects performed.'] };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
