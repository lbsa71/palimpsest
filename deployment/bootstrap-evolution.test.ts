import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs, { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { freezeCandidate, hashBytes } from '../packages/release/artifacts.ts';
import { bootstrapCommands, initializeBootstrap, publishBootstrapSelection, rotateBootstrapRescue } from './bootstrap-evolution.ts';
import type { SupervisorFile } from './cli.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-boot-fixture-'));
  const config = { host: { stateDirectory: join(root, 'state'), artifactStore: join(root, 'artifacts'), workspaceDirectory: join(root, 'work'), nodeBinary: process.execPath }, mode: 'engineering', policyFiles: [], evidenceDirectory: join(root, 'evidence') } as SupervisorFile;
  for (const path of [config.host.stateDirectory, config.host.artifactStore, config.host.workspaceDirectory]) mkdirSync(path, { mode: 0o700 });
  const create = (text: string) => {
    const source = join(root, `source-${text}`); mkdirSync(join(source, 'deployment'), { recursive: true });
    writeFileSync(join(source, 'deployment/bootstrap-evolution.ts'), text); writeFileSync(join(source, 'package-lock.json'), '{}');
    const files = [{ path: 'deployment/bootstrap-evolution.ts', sha256: hashBytes(text) }, { path: 'package-lock.json', sha256: hashBytes('{}') }];
    const runtime = { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
    return freezeCandidate(source, config.host.artifactStore, ['deployment', 'package-lock.json'], { createdBy: 'boot-fixture', model: {}, prompts: {}, configuration: {}, controls: { classifier: 'host-execution-closure-v1', files, runtime, policy: {} }, dependencies: { installedRuntime: [], lockfile: hashBytes('{}'), retainedForks: [], checkBuildToolchain: [], runtime } }).manifest.id;
  };
  const first = { candidateId: create('first'), policyDigest: 'a'.repeat(64) }, next = { candidateId: create('next'), policyDigest: 'b'.repeat(64) };
  const database = join(config.host.stateDirectory, 'release.sqlite'), db = new DatabaseSync(database); chmodSync(database, 0o600);
  db.exec('CREATE TABLE release_state(singleton INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const authority = { generation: 'fixture', epoch: 3, controlRevision: 'c'.repeat(64), artifactId: next.candidateId };
  const ledgerPath = join(config.host.stateDirectory, 'authority.sqlite'), ledger = new DatabaseSync(ledgerPath); chmodSync(ledgerPath, 0o600);
  ledger.exec('CREATE TABLE authority(singleton INTEGER PRIMARY KEY, epoch INTEGER, generation TEXT, control_revision TEXT, artifact_id TEXT)');
  ledger.prepare('INSERT INTO authority VALUES(1,?,?,?,?)').run(authority.epoch, authority.generation, authority.controlRevision, authority.artifactId); ledger.close();
  const state = (phase: string, selected = next) => db.prepare('INSERT OR REPLACE INTO release_state VALUES(1,?)').run(JSON.stringify({ phase, accepted: selected, authority }));
  return { root, config, first, next, state, authority, dispose: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('old-policy acceptance publishes one boot snapshot without changing retained rescue', () => {
  const f = fixture();
  try {
    initializeBootstrap(f.config, f.first); const boot = join(f.config.host.stateDirectory, 'boot');
    initializeBootstrap(f.config, f.first); // Preserved reinstall does not replace existing selections.
    f.state('probation'); assert.throws(() => publishBootstrapSelection(f.config, f.next), /completed incumbent-policy/);
    assert.equal(realpathSync(join(boot, 'active')), realpathSync(join(boot, 'rescue')));
    writeFileSync(join(boot, 'failed'), ''); f.state('accepted'); publishBootstrapSelection(f.config, f.next);
    assert.equal(realpathSync(join(boot, 'active')), join(boot, 'targets', f.next.candidateId));
    assert.equal(realpathSync(join(boot, 'rescue')), join(boot, 'targets', f.first.candidateId));
    initializeBootstrap(f.config, f.first);
    assert.equal(realpathSync(join(boot, 'active')), join(boot, 'targets', f.next.candidateId), 'reinstallation retains the accepted successor');
    assert.equal(existsSync(join(boot, 'failed')), false);
    assert.equal(hashBytes(readFileSync(join(boot, 'rescue/node'))), hashBytes(readFileSync(process.execPath)));
    assert.throws(() => rotateBootstrapRescue(f.config, f.first), /completed incumbent-policy/);
    writeFileSync(join(boot, 'failed'), ''); assert.throws(() => rotateBootstrapRescue(f.config, f.next), /latched/);
    rmSync(join(boot, 'failed')); assert.throws(() => rotateBootstrapRescue(f.config, f.next), /ENOENT/);
    const path = join(boot, 'targets', f.next.candidateId), descriptor = JSON.parse(readFileSync(join(path, 'target.json'), 'utf8'));
    // Explicit engineering fixture record; this test does not claim to have booted the full application.
    writeFileSync(join(path, 'boot-ready.json'), JSON.stringify({ target: f.next, authority: { ...f.authority, epoch: 2 }, runtimeHash: descriptor.runtimeHash }), { mode: 0o600 });
    assert.throws(() => rotateBootstrapRescue(f.config, f.next), /boot-ready under current authority/);
    writeFileSync(join(path, 'boot-ready.json'), JSON.stringify({ target: f.next, authority: f.authority, runtimeHash: descriptor.runtimeHash }));
    rotateBootstrapRescue(f.config, f.next);
    assert.equal(realpathSync(join(boot, 'rescue')), join(boot, 'targets', f.next.candidateId));
    assert.ok(existsSync(join(boot, 'targets', f.first.candidateId, 'node')), 'rotation retains previous independent snapshot');
  } finally { f.dispose(); }
});

test('changed retained runtime is refused before selection publication', () => {
  const f = fixture();
  try {
    initializeBootstrap(f.config, f.first); f.state('accepted', f.first);
    const node = join(f.config.host.stateDirectory, 'boot/targets', f.first.candidateId, 'node'); chmodSync(node, 0o700); writeFileSync(node, 'malformed');
    assert.throws(() => publishBootstrapSelection(f.config, f.first), /Retained bootstrap target changed/);
  } finally { f.dispose(); }
});

test('runtime copy must still match the accepted identity after application verification', () => {
  const f = fixture(), original = fs.readSync;
  try {
    const executable = join(f.root, 'node'); copyFileSync(process.execPath, executable); chmodSync(executable, 0o700); f.config.host.nodeBinary = executable;
    let changed = false;
    fs.readSync = ((fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
      const count = original(fd, buffer, offset, length, position);
      if (!changed && count === 0 && fs.readlinkSync(`/proc/self/fd/${fd}`) === executable) {
        changed = true; writeFileSync(executable, 'changed-after-verification');
      }
      return count;
    }) as typeof fs.readSync;
    syncBuiltinESMExports();
    assert.throws(() => initializeBootstrap(f.config, f.first), /runtime|Runtime/);
    assert.equal(existsSync(join(f.config.host.stateDirectory, 'boot/active')), false);
  } finally { fs.readSync = original; syncBuiltinESMExports(); f.dispose(); }
});

for (const phase of ['requested', 'ready'] as const) test(`selected launcher preserves readiness and reconciles ${phase} selection`, () => {
  const f = fixture();
  try {
    // Narrow launcher seam fixture: retained source imports the reviewed library closure.
    // This deliberately does not claim a complete installed application boot.
    const deployment = fileURLToPath(new URL('.', import.meta.url));
    const packages = fileURLToPath(new URL('../packages/', import.meta.url));
    const launcher = readFileSync(join(deployment, 'host-successor.ts'), 'utf8')
      .replaceAll("from './", `from '${deployment}`).replaceAll("from '../packages/", `from '${packages}`);
    const cli = "if (process.send) process.send({kind:'host-ready'}); setTimeout(()=>process.exit(0),100);";
    const source = join(f.root, 'launcher-source'); mkdirSync(join(source, 'deployment'), { recursive: true });
    const contents = [['deployment/host-successor.ts', launcher], ['deployment/cli.ts', cli], ['deployment/bootstrap-evolution.ts', '// seam fixture'], ['package-lock.json', '{}']];
    for (const [path, content] of contents) writeFileSync(join(source, path!), content!);
    const files = contents.map(([path, content]) => ({ path: path!, sha256: hashBytes(content!) })).sort((a, b) => a.path.localeCompare(b.path));
    const runtime = { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
    const candidate = freezeCandidate(source, f.config.host.artifactStore, ['deployment', 'package-lock.json'], { createdBy: 'launcher-seam', model: {}, prompts: {}, configuration: {}, controls: { classifier: 'host-execution-closure-v1', files, runtime, policy: {} }, dependencies: { installedRuntime: [], lockfile: hashBytes('{}'), retainedForks: [], checkBuildToolchain: [], runtime } });
    const selected = { candidateId: candidate.manifest.id, policyDigest: f.first.policyDigest };
    const path = join(f.config.host.stateDirectory, 'host-successor.sqlite'), db = new DatabaseSync(path); chmodSync(path, 0o600);
    db.exec('CREATE TABLE selection(singleton INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO selection VALUES(1,?)').run(JSON.stringify({ selected: phase === 'ready' ? f.first : selected, rescue: selected, phase })); db.close();
    if (phase === 'ready') { initializeBootstrap(f.config, f.first); f.state('accepted', selected); }
    const configPath = join(f.root, 'config'), marker = join(f.root, 'ready'); writeFileSync(configPath, JSON.stringify(f.config), { mode: 0o600 });
    const module = join(f.config.host.artifactStore, selected.candidateId, 'payload/deployment/host-successor.ts');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {launchHost} from ${JSON.stringify(module)}; import {writeFileSync} from 'node:fs'; await launchHost(${JSON.stringify(configPath)},undefined,()=>writeFileSync(${JSON.stringify(marker)},'ready'));`], { encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(existsSync(marker), 'selected normal bootstrap must retain the readiness callback');
    if (phase === 'ready') assert.equal(realpathSync(join(f.config.host.stateDirectory, 'boot/active')), join(f.config.host.stateDirectory, 'boot/targets', selected.candidateId), 'committed acceptance must finish interrupted boot publication');
  } finally { f.dispose(); }
});

test('redirected bootstrap directory is refused before publication lease writes', () => {
  const f = fixture();
  try {
    const outside = join(f.root, 'outside'); mkdirSync(outside, { mode: 0o700 });
    fs.symlinkSync(outside, join(f.config.host.stateDirectory, 'boot')); f.state('accepted');
    assert.throws(() => publishBootstrapSelection(f.config, f.next));
    assert.deepEqual(fs.readdirSync(outside), [], 'invalid boot path must not create an escaped lease');
    assert.throws(() => rotateBootstrapRescue(f.config, f.next));
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { f.dispose(); }
});

test('rescue rotation rejects a witness whose authority was withdrawn after the last release record', () => {
  const f = fixture();
  try {
    initializeBootstrap(f.config, f.first); f.state('accepted'); publishBootstrapSelection(f.config, f.next);
    const boot = join(f.config.host.stateDirectory, 'boot'), path = join(boot, 'targets', f.next.candidateId);
    const descriptor = JSON.parse(readFileSync(join(path, 'target.json'), 'utf8'));
    writeFileSync(join(path, 'boot-ready.json'), JSON.stringify({ target: f.next, authority: f.authority, runtimeHash: descriptor.runtimeHash }), { mode: 0o600 });
    const ledger = new DatabaseSync(join(f.config.host.stateDirectory, 'authority.sqlite'));
    ledger.exec('UPDATE authority SET epoch=epoch+1,generation=NULL'); ledger.close();
    assert.throws(() => rotateBootstrapRescue(f.config, f.next), /authority/i);
    assert.equal(realpathSync(join(boot, 'rescue')), join(boot, 'targets', f.first.candidateId));
  } finally { f.dispose(); }
});

test('one selected cwd pins runtime and source across active-pointer replacement', { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-boot-cwd-')), boot = join(root, 'boot');
  const entered = join(root, 'entered'), release = join(root, 'release'), result = join(root, 'result');
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (const name of ['first', 'next']) {
      const snapshot = join(boot, name); mkdirSync(join(snapshot, 'payload/deployment'), { recursive: true });
      writeFileSync(join(snapshot, 'node'), `#!/bin/sh\n/usr/bin/touch ${entered}\nwhile ! test -e ${release}; do /bin/sleep 0.01; done\nexec ${process.execPath} "$@"\n`, { mode: 0o700 });
      writeFileSync(join(snapshot, 'payload/deployment/bootstrap-evolution.ts'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(result)},JSON.stringify({source:${JSON.stringify(name)},cwd:process.cwd()}));`);
    }
    fs.symlinkSync(join(boot, 'first'), join(boot, 'active'));
    const command = bootstrapCommands(root, join(root, 'manifest')).start;
    child = spawn('/bin/sh', ['-c', command], { stdio: 'ignore' });
    const exit = new Promise<number | null>(resolve => child!.once('exit', resolve));
    const deadline = Date.now() + 3000;
    while (!existsSync(entered) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(entered));
    fs.symlinkSync(join(boot, 'next'), join(boot, '.active')); fs.renameSync(join(boot, '.active'), join(boot, 'active'));
    writeFileSync(release, ''); assert.equal(await exit, 0);
    assert.deepEqual(JSON.parse(readFileSync(result, 'utf8')), { source: 'first', cwd: join(boot, 'first') });
    for (const path of ['/tmp/x;touch_bad', '/tmp/$HOME', '/tmp/%n', '/tmp/a/../b']) assert.throws(() => bootstrapCommands(path, join(root, 'manifest')), /Canonical/);
  } finally { child?.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); }
});

test('interruption after active rename preserves latched independent rescue and latest state', () => {
  const f = fixture(), original = fs.renameSync;
  try {
    initializeBootstrap(f.config, f.first); f.state('accepted');
    const boot = join(f.config.host.stateDirectory, 'boot');
    writeFileSync(join(boot, 'failed'), ''); writeFileSync(join(f.config.host.stateDirectory, 'latest'), 'memory and uncertain effects');
    fs.renameSync = ((source, destination) => {
      original(source, destination);
      if (destination === join(boot, 'active')) throw new Error('interrupted after atomic active rename');
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();
    assert.throws(() => publishBootstrapSelection(f.config, f.next), /interrupted after atomic/);
    assert.equal(realpathSync(join(boot, 'active')), join(boot, 'targets', f.next.candidateId));
    assert.equal(realpathSync(join(boot, 'rescue')), join(boot, 'targets', f.first.candidateId));
    assert.equal(existsSync(join(boot, 'failed')), true, 'process manager still selects independent rescue');
    assert.equal(readFileSync(join(f.config.host.stateDirectory, 'latest'), 'utf8'), 'memory and uncertain effects');
    fs.renameSync = original; syncBuiltinESMExports();
    publishBootstrapSelection(f.config, f.next); assert.equal(existsSync(join(boot, 'failed')), false);
  } finally { fs.renameSync = original; syncBuiltinESMExports(); f.dispose(); }
});

const administrator = (binary: string, args: string[]) => execFileSync('/usr/bin/sudo', ['-n', binary, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('real systemd drains failed detached descendants before latched rescue, and clean stop does not latch', { skip: process.env.AEON_BOOTSTRAP_SYSTEMD !== '1', timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-boot-os-')), unitName = `aeon-bootstrap-probe-${process.pid}.service`, unitPath = `/run/systemd/system/${unitName}`;
  const boot = join(root, 'boot'), marker = join(root, 'rescue-ready'), manifest = join(root, 'manifest.json');
  writeFileSync(manifest, '{}');
  for (const slot of ['active', 'rescue']) {
    const directory = join(boot, slot); mkdirSync(join(directory, 'payload/deployment'), { recursive: true, mode: 0o700 });
    copyFileSync(process.execPath, join(directory, 'node')); chmodSync(join(directory, 'node'), 0o500);
  }
  const rescue = `import {readFileSync,writeFileSync} from 'node:fs'; const root=${JSON.stringify(root)}; let child; try {child=Number(readFileSync(root+'/child','utf8'));} catch {} if(child) {try {const stat=readFileSync('/proc/'+child+'/stat','utf8').split(') ')[1]; if(stat[0]!=='Z') throw Error('failed child still running');} catch(e) {if(e.code!=='ENOENT') throw e;}} writeFileSync(root+'/rescue-ready',readFileSync(root+'/lived','utf8')); setInterval(()=>{},1000);`;
  writeFileSync(join(boot, 'rescue/payload/deployment/bootstrap-evolution.ts'), rescue);
  writeFileSync(join(boot, 'active/payload/deployment/bootstrap-evolution.ts'), `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); writeFileSync(${JSON.stringify(join(root, 'child'))},String(child.pid)); process.exit(42);`);
  writeFileSync(join(root, 'lived'), JSON.stringify({ epoch: 9, memory: 'latest', uncertain: 'do not retry' }));
  const commands = bootstrapCommands(root, manifest);
  const unit = `[Unit]\nStartLimitIntervalSec=60\nStartLimitBurst=8\n[Service]\nType=exec\nUser=${process.getuid!()}\nGroup=${process.getgid!()}\nDelegate=cpu memory pids\nMemoryMax=268435456\nTasksMax=64\nCPUQuota=100%\nKillMode=control-group\nTimeoutStopSec=3\nRestart=on-failure\nRestartSec=1\nExecStart=${commands.start}\nExecStopPost=${commands.stopPost}\nStandardOutput=null\nStandardError=null\n`;
  const source = join(root, unitName); writeFileSync(source, unit);
  const waitReady = async () => { const deadline = Date.now() + 12000; while (!existsSync(marker) && Date.now() < deadline) await delay(50); assert.ok(existsSync(marker), 'independent rescue must start after failure'); assert.equal(readFileSync(marker, 'utf8'), readFileSync(join(root, 'lived'), 'utf8')); };
  try {
    administrator('/usr/bin/install', ['-o', 'root', '-g', 'root', '-m', '644', source, unitPath]); administrator('/usr/bin/systemctl', ['daemon-reload']); administrator('/usr/bin/systemctl', ['start', unitName]); await waitReady();
    assert.equal(administrator('/usr/bin/systemctl', ['show', unitName, '-p', 'NRestarts', '--value']).trim(), '1');
    administrator('/usr/bin/systemctl', ['stop', unitName]); rmSync(marker); rmSync(join(boot, 'failed'));
    // A malformed executable cannot run any application fallback; systemd still selects rescue.
    chmodSync(join(boot, 'active/node'), 0o700); writeFileSync(join(boot, 'active/node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]));
    administrator('/usr/bin/systemctl', ['start', unitName]); await waitReady();
    administrator('/usr/bin/systemctl', ['stop', unitName]); rmSync(marker); rmSync(join(boot, 'failed'));
    copyFileSync(process.execPath, join(boot, 'active/node')); chmodSync(join(boot, 'active/node'), 0o500);
    writeFileSync(join(boot, 'active/payload/deployment/bootstrap-evolution.ts'), 'setInterval(()=>{},1000);');
    administrator('/usr/bin/systemctl', ['start', unitName]); await delay(200); administrator('/usr/bin/systemctl', ['stop', unitName]);
    assert.equal(existsSync(join(boot, 'failed')), false, 'ordinary systemd stop must not spuriously select rescue');
    assert.equal(existsSync(marker), false);
  } finally {
    try { administrator('/usr/bin/systemctl', ['stop', unitName]); } catch {}
    administrator('/usr/bin/rm', ['-f', unitPath]); administrator('/usr/bin/systemctl', ['daemon-reload']);
    try { administrator('/usr/bin/systemctl', ['reset-failed', unitName]); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
