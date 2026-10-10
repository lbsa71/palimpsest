import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { freezeBaseline, freezeCandidate } from '../src/candidates.ts';
import { CoordinatorLock } from '../src/ownership.ts';
import { SystemdService } from '../scripts/systemd-service.ts';

function fixture(native = false, bindNative = native) {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-systemd-'));
  const repositoryRoot = join(directory, 'repo'), dataDir = join(directory, 'state'), credentialsPath = join(directory, 'credentials.env');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src/platform-migration-gate.ts'), 'export function assertPlatformMigrationReady(){}');
  mkdirSync(join(repositoryRoot, 'scripts'));
  mkdirSync(join(repositoryRoot, 'deploy/systemd'), { recursive: true });
  writeFileSync(join(repositoryRoot, 'scripts/systemd-native-inputs.ts'), readFileSync(new URL('../scripts/systemd-native-inputs.ts', import.meta.url)));
  writeFileSync(join(repositoryRoot, 'scripts/systemd-service.ts'), readFileSync(new URL('../scripts/systemd-service.ts', import.meta.url)));
  writeFileSync(join(repositoryRoot, 'deploy/systemd/palimpsest.service.in'), readFileSync(new URL('../deploy/systemd/palimpsest.service.in', import.meta.url)));
  mkdirSync(join(dataDir, 'custodian'), { recursive: true, mode: 0o700 });
  writeFileSync(join(repositoryRoot, 'src/cli.ts'), 'import "./bootstrap.ts";console.log("fixture");');
  writeFileSync(join(repositoryRoot, 'src/bootstrap.ts'), 'export {};');
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest(){return {};}');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Fixture');
  writeFileSync(credentialsPath, 'MISTRAL_API_KEY=PRIVATE-CANARY', { mode: 0o600 });
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const nativeSource = '/* native fixture source */\n';
  const nativeBinary = Buffer.alloc(64); nativeBinary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); nativeBinary[18] = 0x3e;
  const nativeReceipt = JSON.stringify({ version: 1, arch: 'x64', sourceSha256: hash(nativeSource), binarySha256: hash(nativeBinary) });
  const admittedNativeInputs = { sourceSha256: hash(nativeSource), binarySha256: hash(nativeBinary), receiptSha256: hash(nativeReceipt) };
  if (native) { mkdirSync(join(repositoryRoot, 'trusted')); writeFileSync(join(repositoryRoot, 'trusted/linux-isolation-launcher.c'), nativeSource);
    writeFileSync(join(repositoryRoot, '.gitignore'), '/trusted/linux-isolation-launcher\n/trusted/linux-isolation-launcher.json\n');
    writeFileSync(join(repositoryRoot, 'trusted/linux-isolation-launcher'), nativeBinary, { mode: 0o500 });
    writeFileSync(join(repositoryRoot, 'trusted/linux-isolation-launcher.json'), nativeReceipt, { mode: 0o400 }); }
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'baseline');
  const manifest = freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
  const db = new DatabaseSync(join(dataDir, 'custodian/custodian.sqlite'));
  db.exec('CREATE TABLE custodian_state(id INTEGER PRIMARY KEY,record TEXT NOT NULL)');
  const release = { digest: manifest.id, artifactPath: manifest.releaseDir, governanceDigest: manifest.governanceDigest, dataSchemaVersion: 1 };
  db.prepare('INSERT INTO custodian_state VALUES(1,?)').run(JSON.stringify({ knownGood: release }));
  let ready = true;
  const hostRoot = join(directory, 'sealed-hosts');
  const service = new SystemdService({ config: { repositoryRoot, dataDir, credentialsPath }, hostRoot, sealOwner: process.getuid!(),
    ...(bindNative ? { admittedNativeInputs, preparedNativeRoot: repositoryRoot } : {}),
    assertReady: async () => { if (!ready) throw new Error('Migration held'); } });
  return { directory, repositoryRoot, manifest, service, dataDir, credentialsPath,
    async install() { const installation = await service.prepare(); mkdirSync(hostRoot, { recursive: true, mode: 0o755 });
      cpSync(join(dataDir, 'host-installations', installation.releaseId), installation.bundlePath, { recursive: true, dereference: false });
      const seal = (path: string) => { const stat = lstatSync(path); if (stat.isSymbolicLink()) return;
        chmodSync(path, stat.isDirectory() || (stat.mode & 0o100) ? 0o550 : 0o440);
        if (stat.isDirectory()) for (const n of readdirSync(path)) seal(join(path, n)); };
      seal(installation.bundlePath); return installation; },
    hold: () => { ready = false; },
    custody: (value: typeof release) => db.prepare('UPDATE custodian_state SET record=? WHERE id=1').run(JSON.stringify({ knownGood: value })),
    release,
    close() { db.close(); const writable = (path: string) => { const s = lstatSync(path); if (s.isSymbolicLink()) return;
      chmodSync(path, s.isDirectory() ? 0o700 : 0o600); if (s.isDirectory()) for (const n of readdirSync(path)) writable(join(path, n)); };
      writable(directory); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('preparation projects exact admitted source privately and renders a continuous secret-free unit', async () => {
  const f = fixture(); try {
    const installation = await f.install();
    assert.equal(readFileSync(join(installation.bundlePath, 'src/cli.ts'), 'utf8'), 'import "./bootstrap.ts";console.log("fixture");');
    assert.equal(lstatSync(join(installation.bundlePath, 'src/cli.ts')).mode & 0o777, 0o440);
    assert.equal(lstatSync(installation.bundlePath).mode & 0o777, 0o550);
    assert.equal(lstatSync(join(f.dataDir, 'service/stdout.log')).mode & 0o777, 0o600);
    assert.deepEqual(await f.service.verify(installation.releaseId), installation);
    const unit = f.service.unit(installation);
    assert.match(unit, /KillMode=mixed/); assert.match(unit, /TimeoutStopSec=120/);
    assert.match(unit, /Restart=always/); assert.match(unit, /NoNewPrivileges=true/);
    assert.ok(unit.includes(`ReadOnlyPaths=${installation.bundlePath}`));
    assert.ok(unit.includes(`${installation.bundlePath}/scripts/systemd-service.ts`));
    assert.doesNotMatch(unit, /PRIVATE-CANARY|MISTRAL_API_KEY|EnvironmentFile|OnCalendar|RestrictNamespaces|MemoryDenyWriteExecute/);
    assert.equal(await f.service.prepare().then(x => x.releaseId), installation.releaseId);
  } finally { f.close(); }
});

test('startup rejects mutated projections, public credentials and descriptor substitution', async () => {
  const f = fixture(); try {
    const installation = await f.install();
    const source = join(installation.bundlePath, 'src/cli.ts'); chmodSync(source, 0o600); writeFileSync(source, 'changed');
    await assert.rejects(f.service.verify(installation.releaseId), /identity|source|projection/i);
    writeFileSync(source, 'import "./bootstrap.ts";console.log("fixture");'); chmodSync(source, 0o440);
    chmodSync(f.credentialsPath, 0o644); await assert.rejects(f.service.verify(installation.releaseId), /private/i); chmodSync(f.credentialsPath, 0o600);
    const descriptor = join(f.dataDir, 'service/systemd-installation.json');
    writeFileSync(descriptor, JSON.stringify({ ...installation, releaseId: '0'.repeat(64) }));
    await assert.rejects(f.service.verify(installation.releaseId), /identity|installation/i);
  } finally { f.close(); }
});

test('migration readiness and current governance are checked rather than inherited from installation', async () => {
  const f = fixture(); try {
    f.hold(); await assert.rejects(f.service.prepare(), /Migration held/);
    assert.equal(existsSync(join(f.dataDir, 'host-installations')), false);
  } finally { f.close(); }
  const g = fixture(); try {
    const installation = await g.install();
    const successor = freezeCandidate({ repositoryRoot: g.repositoryRoot, dataDir: g.dataDir, configuration: {},
      modelProfile: { provider: 'fixture', model: null }, changes: [{ path: 'src/agent/brain.ts', content: 'export function conversationRequest(){return {prompt:"successor"};}' }] });
    g.custody({ digest: successor.id, artifactPath: successor.releaseDir, governanceDigest: successor.governanceDigest, dataSchemaVersion: 1 });
    assert.equal((await g.service.verify(installation.releaseId)).releaseId, installation.releaseId, 'compatible cognitive succession retains the admitted host');
    g.custody({ ...g.release, governanceDigest: '0'.repeat(64) });
    await assert.rejects(g.service.verify(installation.releaseId), /governance|custody/i);
    g.custody(g.release); g.hold(); await assert.rejects(g.service.verify(installation.releaseId), /Migration held/);
  } finally { g.close(); }
});

test('preparation refuses an active destination coordinator and wrong frozen entrypoint root', async () => {
  const f = fixture(); try {
    const lock = new CoordinatorLock(join(f.dataDir, 'coordinator.sqlite'));
    try { await assert.rejects(f.service.prepare(), /coordinator|ownership/i); } finally { lock.close(); }
    const installation = await f.install();
    await assert.rejects(f.service.verify(installation.releaseId, f.directory), /entrypoint|root/i);
  } finally { f.close(); }
});

test('a valid version-two candidate stored under the old digest cannot replace admitted custody', async () => {
  const f = fixture(); try {
    const candidate = freezeCandidate({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: {},
      modelProfile: { provider: 'fixture', model: null }, changes: [{ path: 'src/agent/brain.ts', content: 'export function conversationRequest(){return {prompt:"unadmitted"};}' }] });
    assert.equal(candidate.version, 2);
    renameSync(f.manifest.releaseDir, `${f.manifest.releaseDir}.original`);
    renameSync(candidate.releaseDir, f.manifest.releaseDir);
    await assert.rejects(f.service.prepare(), /Frozen installation identity mismatch/);
    assert.equal(existsSync(join(f.dataDir, 'host-installations')), false);
  } finally { f.close(); }
});


test('independent checksum gate rejects altered imported bootstrap before executing its sentinel', async () => {
  const f = fixture(); try {
    const installation = await f.install();
    const checksum = join(f.dataDir, 'service', `host-${installation.releaseId}.sha256`);
    const checker = existsSync('/usr/bin/sha256sum') ? '/usr/bin/sha256sum' : '/sbin/sha256sum';
    assert.equal(execFileSync(checker, ['--quiet', '--strict', '--check', checksum], { encoding: 'utf8' }), '');
    const execute = `"${checker}" --quiet --strict --check "$1" && "$2" "$3"`;
    assert.match(execFileSync('/bin/sh', ['-c', execute, 'gate', checksum, process.execPath, join(installation.bundlePath, 'src/cli.ts')], { encoding: 'utf8' }), /fixture/);
    const module = join(installation.bundlePath, 'src/bootstrap.ts'), sentinel = join(f.directory, 'bootstrap-sentinel');
    chmodSync(module, 0o600); writeFileSync(module, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)}, 'unsafe');`); chmodSync(module, 0o440);
    assert.throws(() => execFileSync('/bin/sh', ['-c', execute, 'gate', checksum, process.execPath, join(installation.bundlePath, 'src/cli.ts')], { stdio: 'ignore' }));
    assert.equal(existsSync(sentinel), false);
  } finally { f.close(); }
});

test('service scratch stays private and is preserved through replacement environment', async () => {
  const f = fixture(); try {
    const installation = await f.install(), scratch = join(installation.dataDir, 'service/scratch');
    assert.equal(lstatSync(scratch).mode & 0o777, 0o700);
    assert.ok(f.service.unit(installation).includes(`TMPDIR=${scratch}`));
    assert.equal(f.service.environment(installation).TMPDIR, scratch);
    chmodSync(scratch, 0o755); await assert.rejects(f.service.verify(installation.releaseId), /private/i);
  } finally { f.close(); }
});


test('sealed native package copies only admitted ELF/receipt extras and bootstraps their exact hashes', async () => {
  const f = fixture(true); try {
    const installation = await f.install();
    const checksum = readFileSync(join(f.dataDir, 'service', `host-${installation.releaseId}.sha256`), 'utf8');
    for (const path of ['trusted/linux-isolation-launcher.c', 'trusted/linux-isolation-launcher', 'trusted/linux-isolation-launcher.json']) {
      assert.equal(existsSync(join(installation.bundlePath, path)), true);
      assert.ok(checksum.includes(join(installation.bundlePath, path)));
    }
    assert.equal(lstatSync(join(installation.bundlePath, 'trusted/linux-isolation-launcher')).mode & 0o777, 0o550);
    assert.deepEqual(await f.service.verify(installation.releaseId), installation);
    chmodSync(join(installation.bundlePath, 'trusted'), 0o700);
    writeFileSync(join(installation.bundlePath, 'trusted/unknown-native'), 'unreviewed', { mode: 0o440 });
    chmodSync(join(installation.bundlePath, 'trusted'), 0o550);
    await assert.rejects(f.service.verify(installation.releaseId), /projection|identity/i);
  } finally { f.close(); }
});

test('tracked native source without admitted prepared hashes refuses service preparation', async () => {
  const f = fixture(true, false); try {
    await assert.rejects(f.service.prepare(), /admitted.*native|native.*admitted/i);
  } finally { f.close(); }
});
