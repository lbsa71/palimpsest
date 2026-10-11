import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'aeon-pi-q1-'));
const commands: { phase: string; elapsedMs: number; command: string[]; exitCode: number }[] = [];
function run(phase: string, args: string[]): void {
  const started = performance.now(); const result = spawnSync(process.execPath, args, { cwd: scratch, encoding: 'utf8' });
  commands.push({ phase, elapsedMs: performance.now() - started, command: [process.execPath, ...args], exitCode: result.status ?? -1 });
  if (result.status !== 0) throw Error(`${phase} failed:\n${result.stdout}\n${result.stderr}`);
}
try {
  mkdirSync(join(scratch, 'packages'), { recursive: true });
  cpSync(join(root, 'packages'), join(scratch, 'packages'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  writeFileSync(join(scratch, 'package.json'), '{"type":"module"}\n');
  const entries = readdirSync(join(scratch, 'packages/agent-shell')).filter(name => name.endsWith('.ts')).map(name => `packages/agent-shell/${name}`);
  const compile = ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--target', 'es2024', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--strict', '--types', 'node', '--erasableSyntaxOnly', '--skipLibCheck', '--rewriteRelativeImportExtensions', '--rootDir', '.', '--outDir', 'dist', ...entries];
  run('clean-build', compile);
  run('warm-build', compile);
  const tests = entries.filter(name => name.endsWith('.test.ts')).map(name => `dist/${name.slice(0, -3)}.js`);
  run('baseline-regressions', ['--test', ...tests]);
  const dependency = join(scratch, 'packages/agent-shell/vendor/pi/ai/utils/text.ts');
  const original = readFileSync(dependency, 'utf8');
  const edited = original.replace('separator = "\\n"', 'separator = "|qualified-local-edit|"');
  if (edited === original) throw Error('Expected dependency function no longer matches; audit patch');
  writeFileSync(dependency, edited);
  run('changed-dependency-build', compile);
  run('changed-dependency-regressions', ['--test', ...tests]);
  writeFileSync(join(scratch, 'verify-loaded.mjs'), 'import assert from "node:assert/strict";\nimport {contentText} from "./dist/packages/agent-shell/vendor/pi/ai/utils/text.js";\nassert.equal(contentText([{type:"text",text:"one"},{type:"text",text:"two"}]),"one|qualified-local-edit|two");\n');
  run('fresh-successor-process-loads-edited-dependency', ['verify-loaded.mjs']);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const report = { evidenceKind: 'mechanical', node: process.version, upstreamCommit: '89e5c2c075535e2f427c30fc74720d65b2944ff9', runtimeDependencies: {}, sourceDependencies: { cfworkerJsonSchema: '4.1.1' }, commands, dependencyEdit: { file: 'packages/agent-shell/vendor/pi/ai/utils/text.ts', originalSha256: hash(original), editedSha256: hash(edited), function: 'contentText', freshProcessVerified: true }, networkUsedDuringCheckBuild: false, limits: ['Provisioned TypeScript and Node definitions required; runtime dependencies are retained source.', 'Fresh subprocess verifies loaded dependency; production successor activation belongs L09.', 'No live model competence or benchmark measured.'] };
  mkdirSync(join(root, 'experiments/agent-shell/results'), { recursive: true });
  const output = process.argv[2] ?? join(root, 'experiments/agent-shell/results/q1-source-owned-schema.json');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
