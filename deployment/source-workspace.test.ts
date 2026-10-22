import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sourceWorkspaceTools } from './source-workspace.ts';
import { runConfined } from '../packages/supervisor/confinement.ts';

test('a confined mind can obtain rewrite source, edit a dependency and run actual pinned checks/build', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'aeon-source-workspace-'));
  const protectedState = mkdtempSync(join(tmpdir(), 'aeon-source-private-'));
  const applicationRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const tools = sourceWorkspaceTools({ workspace, applicationRoot, protectedPaths: [protectedState], nodeBinary: process.execPath, maxFiles: 5000, maxBytes: 30_000_000, timeoutMs: 30000 });
  try {
    const checkedOut = await tools[0]!.execute({}) as { exitCode: number; stdout: string; stderr: string };
    assert.equal(checkedOut.exitCode, 0, checkedOut.stderr); assert.ok(JSON.parse(checkedOut.stdout).files.some((file: { path: string }) => file.path === 'packages/narrow-schema/vendor/cfworker/validator.ts'));
    const dependency = join(workspace, 'packages/narrow-schema/vendor/cfworker/validator.ts');
    const original = readFileSync(dependency, 'utf8'); writeFileSync(dependency, `${original}\nexport const sourceEditProof: string = 42;\n`);
    const failed = await tools[1]!.execute({ emit: false }) as { exitCode: number; stdout: string };
    assert.notEqual(failed.exitCode, 0); assert.match(failed.stdout, /sourceEditProof|number.*string|TS2322/);
    writeFileSync(dependency, `${original}\nexport const sourceEditProof: string = 'edited-locally';\n`);
    const built = await tools[1]!.execute({ emit: true }) as { exitCode: number; stdout: string; stderr: string };
    assert.equal(built.exitCode, 0, `${built.stdout}\n${built.stderr}`);
    assert.match(readFileSync(join(workspace, 'dist/packages/narrow-schema/vendor/cfworker/validator.js'), 'utf8'), /edited-locally/);
    const secondCheckout = await tools[0]!.execute({}) as { exitCode: number }; assert.notEqual(secondCheckout.exitCode, 0);
  } finally { rmSync(workspace, { recursive: true, force: true }); rmSync(protectedState, { recursive: true, force: true }); }
});


test('source checkout refuses a symlinked ancestor of an explicit nested source root', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'aeon-source-ancestor-'));
  const applicationRoot = join(temporary, 'application'), workspace = join(temporary, 'workspace');
  mkdirSync(join(applicationRoot, 'unselected', 'agent-shell'), { recursive: true }); mkdirSync(workspace); mkdirSync(join(temporary, 'state'));
  writeFileSync(join(applicationRoot, 'unselected', 'agent-shell', 'outside.txt'), 'unselected source');
  symlinkSync('unselected', join(applicationRoot, 'experiments'));
  try {
    const tools = sourceWorkspaceTools({ applicationRoot, workspace, protectedPaths: [join(temporary, 'state')], nodeBinary: process.execPath, maxFiles: 10, maxBytes: 1024, timeoutMs: 5000 });
    const result = await tools[0]!.execute({}) as { exitCode: number };
    assert.notEqual(result.exitCode, 0, 'nested source entries must not traverse links');
    assert.equal(existsSync(join(workspace, 'experiments', 'agent-shell', 'outside.txt')), false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('a confined source seed creates a clean Git baseline supporting branches, commits and reverts without private state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-source-git-')), applicationRoot = join(root, 'application'), workspace = join(root, 'source'), state = join(root, 'state');
  mkdirSync(applicationRoot); mkdirSync(workspace); mkdirSync(state);
  mkdirSync(join(applicationRoot, 'deployment'));
  writeFileSync(join(applicationRoot, 'deployment', '.gitignore'), 'notes.txt\n'); writeFileSync(join(applicationRoot, 'deployment', 'notes.txt'), 'Accepted despite ignore rule\n');
  writeFileSync(join(applicationRoot, 'README.md'), 'Accepted baseline\n'); writeFileSync(join(state, 'private.txt'), 'Not repository content');
  const options = { applicationRoot, workspace, protectedPaths: [state], nodeBinary: process.execPath, maxFiles: 20, maxBytes: 8192, timeoutMs: 10000 };
  try {
    const tools = sourceWorkspaceTools({ ...options, gitRepository: true });
    const seeded = await tools[0]!.execute({}) as { exitCode: number; stdout: string; stderr: string };
    assert.equal(seeded.exitCode, 0, seeded.stderr);
    const baseline = JSON.parse(seeded.stdout).git;
    assert.equal(baseline.branch, 'main'); assert.equal(baseline.clean, true); assert.match(baseline.commit, /^[a-f0-9]{40,64}$/);
    assert.equal(existsSync(join(workspace, '.git', 'objects')), true);
    const exercised = await runConfined({ ...options, executable: '/runtime/node', maxOutputBytes: 8192, args: ['--input-type=module', '-e', `
      import fs from 'node:fs'; import {execFileSync} from 'node:child_process';
      const git=(...args)=>execFileSync('/usr/bin/git',args,{encoding:'utf8'}).trim();
      git('switch','-c','improve');fs.appendFileSync('README.md','Finite improvement\\n');git('add','README.md');git('commit','--quiet','-m','Improve README');
      const changed=git('rev-parse','HEAD');git('revert','--no-edit',changed);
      console.log(JSON.stringify({branch:git('branch','--show-current'),changed,head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),files:git('ls-tree','-r','--name-only','HEAD').split('\\n'),
        content:fs.readFileSync('README.md','utf8'),status:git('status','--porcelain=v1'),privateVisible:fs.existsSync(process.argv[1])}));
    `, join(state, 'private.txt')] });
    assert.equal(exercised.exitCode, 0, exercised.stderr);
    const history = JSON.parse(exercised.stdout);
    assert.equal(history.branch, 'improve'); assert.notEqual(history.changed, baseline.commit); assert.notEqual(history.head, history.changed);
    assert.equal(history.tree, baseline.tree); assert.equal(history.content, 'Accepted baseline\n'); assert.equal(history.status, ''); assert.equal(history.privateVisible, false);
    assert.ok(history.files.includes('deployment/notes.txt'), 'Accepted source must be committed even when a nested ignore rule matches');
    const attemptedOverwrite = await tools[0]!.execute({}) as { exitCode: number };
    assert.notEqual(attemptedOverwrite.exitCode, 0); assert.equal(readFileSync(join(workspace, 'README.md'), 'utf8'), 'Accepted baseline\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
