import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { bindDevelopmentControl, prepareDevelopmentControl, validateDevelopmentControl, createScriptedControlShell, type DevelopmentControlConfig } from './development-controls.ts';
import type { ApplicationConfig } from './config.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'development-control-seal-')), workspaceDirectory = join(root, 'workspace'); mkdirSync(workspaceDirectory);
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const config = { workspaceDirectory } as ApplicationConfig;
  return { store, config, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const mode = (kind: DevelopmentControlConfig['kind']): DevelopmentControlConfig => ({ version: 1, kind, assignmentId: kind === 'ordinary' ? null : 'control-a', workloadDigest: identity('public-workload') });
test('exact mode wire rejects ambiguous assignments and unknown workload fields', () => {
  for (const kind of ['ordinary', 'no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'] as const) validateDevelopmentControl(mode(kind));
  for (const changed of [{ ...mode('ordinary'), assignmentId: 'control' }, { ...mode('no-memory'), assignmentId: null }, { ...mode('no-memory'), version: 2 }, { ...mode('no-memory'), workloadDigest: 'answer' }, { ...mode('no-memory'), secret: 'answer' }, { ...mode('no-memory'), kind: 'friendly' }]) assert.throws(() => validateDevelopmentControl(changed as DevelopmentControlConfig));
});
test('ordinary default retains lived state and seals against subsequent evaluation conversion', () => {
  const f = fixture();
  try {
    f.store.put('fixture.lived', 'experience', { retained: 'current experience' }, null);
    const control = bindDevelopmentControl(f.config, f.store, undefined, prepareDevelopmentControl(f.config, f.store));
    assert.equal(control.kind, 'ordinary'); assert.equal(control.isEvaluation, false); assert.ok(Object.isFrozen(control));
    assert.throws(() => createScriptedControlShell(control), /verified scripted/);
    const reopened = bindDevelopmentControl({ ...f.config, artifactId: 'normal-successor' }, f.store, undefined, prepareDevelopmentControl({ ...f.config, artifactId: 'normal-successor' }, f.store));
    assert.equal(reopened.modeSeal.sha256, control.modeSeal.sha256);
    assert.deepEqual(f.store.get('fixture.lived', 'experience')?.value, { retained: 'current experience' });
    assert.throws(() => prepareDevelopmentControl({ ...f.config, developmentControl: mode('no-memory') }, f.store), /cannot change/);
    const row = f.store.get('host.development-control', 'mode')!; f.store.delete('host.development-control', 'mode', row.revision);
    assert.throws(() => prepareDevelopmentControl(f.config, f.store), /seal missing/);
  } finally { f.close(); }
});
test('pre-accounting freshness detects operational contamination and rejects a substituted token/Store', () => {
  const a = fixture(), b = fixture();
  try {
    const cfg = { ...a.config, developmentControl: mode('ordinary') };
    a.store.put('development.memories', 'old-lesson', { learned: true }, null);
    assert.throws(() => prepareDevelopmentControl(cfg, a.store), /fresh operational/);
    const token = prepareDevelopmentControl(b.config, b.store);
    assert.throws(() => bindDevelopmentControl(a.config, a.store, undefined, token), /actual pre-accounting/);
    assert.throws(() => bindDevelopmentControl(b.config, b.store, undefined, {}), /actual pre-accounting/);
    assert.throws(() => bindDevelopmentControl({ ...b.config, developmentControl: mode('no-memory') }, b.store, undefined, prepareDevelopmentControl({ ...b.config, developmentControl: mode('no-memory') }, b.store)), /actual local accounting/);
  } finally { a.close(); b.close(); }
});


test('artifact-only learned state is refused before an accounting factory', () => {
  const f = fixture(); try { f.store.putArtifact('prior transfer answer'); assert.throws(() => prepareDevelopmentControl({ ...f.config, developmentControl: mode('no-memory') }, f.store), /prior operational artifacts/); } finally { f.close(); }
});
