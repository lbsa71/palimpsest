import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDevelopmentPlan, validateDevelopmentPlan } from '../src/development-plan.ts';

const source = fileURLToPath(new URL('../config/development-plan.json', import.meta.url));
const catalog = () => JSON.parse(readFileSync(source, 'utf8'));

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'palimpsest-development-plan-'));
  const repositoryRoot = join(base, 'repo'); mkdirSync(join(repositoryRoot, 'config'), { recursive: true });
  execFileSync('/usr/bin/git', ['init', '--quiet', repositoryRoot]);
  writeFileSync(join(repositoryRoot, 'config/development-plan.json'), readFileSync(source));
  execFileSync('/usr/bin/git', ['add', 'config/development-plan.json'], { cwd: repositoryRoot });
  return { base, repositoryRoot, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('trusted catalog describes dependency-linked P06 work with stable content identity', () => {
  const f = fixture();
  try {
    const plan = loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot });
    assert.deepEqual(plan.items.map(item => item.id), ['P06-memory-provenance', 'P06-memory-context-budget']);
    assert.deepEqual(plan.items[1]!.dependencies, ['P06-memory-provenance']);
    assert.deepEqual(plan.items[1]!.authoritativeChecks, ['memory-provenance', 'memory-context-budget']);
    assert.equal(loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot, expectedDigest: plan.digest }).digest, plan.digest);
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot, expectedDigest: '0'.repeat(64) }), /digest/);
    const reordered = catalog(); reordered.items[0] = Object.fromEntries(Object.entries(reordered.items[0]).reverse());
    assert.equal(validateDevelopmentPlan(reordered).digest, plan.digest);
    assert.throws(() => { (plan.items[0]!.dependencies as string[]).push('P06-memory-context-budget'); }, TypeError);
  } finally { f.cleanup(); }
});

test('unknown schema, work, check and source authority cannot enter the catalog', () => {
  const cases: Array<[string, (value: any) => void]> = [
    ['unknown top-level field', v => { v.catalogAuthority = 'model'; }],
    ['unknown item field', v => { v.items[0].command = 'sh'; }],
    ['unsupported schema', v => { v.version = 2; }],
    ['unknown work', v => { v.items[0].id = 'P14-custodian'; }],
    ['unknown check', v => { v.items[0].authoritativeChecks = ['candidate-tests']; }],
    ['protected source', v => { v.items[0].permittedPaths = ['src/custodian.ts']; }],
    ['unsafe source', v => { v.items[0].permittedPaths = ['src/agent/../custodian.ts']; }],
    ['unbounded resources', v => { v.items[0].budget.releaseCalls = 999; }],
    ['unknown budget field', v => { v.items[0].budget.provider = 'other'; }],
    ['weakened prerequisite', v => { v.items[1].dependencies = []; }],
    ['weakened inherited check', v => { v.items[1].authoritativeChecks = ['memory-context-budget']; }],
    ['invented requirement', v => { v.items[0].requirements = ['R99']; }],
  ];
  for (const [name, mutate] of cases) {
    const value = catalog(); mutate(value);
    assert.throws(() => validateDevelopmentPlan(value), Error, name);
  }
});

test('duplicate identities, missing dependencies, cycles and excessive text fail closed', () => {
  for (const mutate of [
    (v: any) => { v.items.push(v.items[0]); },
    (v: any) => { v.items[1].dependencies = ['missing']; },
    (v: any) => { v.items[0].dependencies = ['P06-memory-context-budget']; },
    (v: any) => { v.items[0].title = 'x'.repeat(513); },
    (v: any) => { v.items[0].acceptanceCriteria = []; },
    (v: any) => { v.items[0].acceptanceCriteria.push(...Array(21).fill('excess')); },
  ]) {
    const value = catalog(); mutate(value); assert.throws(() => validateDevelopmentPlan(value));
  }
});

test('loader accepts only the fixed tracked host checkout file, rejecting candidate content and aliases', () => {
  const f = fixture();
  try {
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot, catalog: catalog() } as any), /option/);
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: join(f.repositoryRoot, 'config') }), /root/);
    const candidate = join(f.base, 'candidate/source'); mkdirSync(join(candidate, 'config'), { recursive: true });
    writeFileSync(join(candidate, 'config/development-plan.json'), readFileSync(source));
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: candidate }), /checkout/);
    const path = join(f.repositoryRoot, 'config/development-plan.json'); rmSync(path);
    symlinkSync(source, path);
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot }), /regular|symlink/);
  } finally { f.cleanup(); }
});

test('untracked catalogs, symlink directories and oversized files are not host authority', () => {
  const f = fixture();
  try {
    execFileSync('/usr/bin/git', ['rm', '--cached', '--quiet', 'config/development-plan.json'], { cwd: f.repositoryRoot });
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot }), /tracked/);
    execFileSync('/usr/bin/git', ['add', 'config/development-plan.json'], { cwd: f.repositoryRoot });
    writeFileSync(join(f.repositoryRoot, 'config/development-plan.json'), ' '.repeat(65537));
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot }), /size/);
    rmSync(join(f.repositoryRoot, 'config'), { recursive: true });
    mkdirSync(join(f.base, 'external-config'));
    writeFileSync(join(f.base, 'external-config/development-plan.json'), readFileSync(source));
    symlinkSync(join(f.base, 'external-config'), join(f.repositoryRoot, 'config'));
    assert.throws(() => loadDevelopmentPlan({ repositoryRoot: f.repositoryRoot }), /symlink/);
  } finally { f.cleanup(); }
});
