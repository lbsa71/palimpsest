import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sourceWorkspaceTools } from './source-workspace.ts';

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
