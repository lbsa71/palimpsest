import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { freezeBaseline } from '../src/candidates.ts';
import { LocalService } from '../scripts/service.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-service-'));
  const repositoryRoot = join(directory, 'repo & "quoted"'); const dataDir = join(directory, 'state');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs')); mkdirSync(join(dataDir, 'custodian'), { recursive: true, mode: 0o700 });
  writeFileSync(join(repositoryRoot, 'src/cli.ts'), 'console.log("fixture host");');
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest() { return {}; }');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'fixture contract');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'baseline');
  const manifest = freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
  const path = join(dataDir, 'custodian/custodian.sqlite'); const db = new DatabaseSync(path);
  db.exec('CREATE TABLE custodian_state(id INTEGER PRIMARY KEY, record TEXT NOT NULL)');
  db.prepare('INSERT INTO custodian_state VALUES(1,?)').run(JSON.stringify({ phase: 'normal', knownGood: { digest: manifest.manifestDigest, artifactPath: manifest.releaseDir, governanceDigest: manifest.governanceDigest, dataSchemaVersion: manifest.dataSchemaVersion } })); db.close();
  const credentialsPath = join(directory, 'credentials.env'); writeFileSync(credentialsPath, 'MISTRAL_API_KEY=PRIVATE-SENTINEL\nSLACK_BOT_TOKEN=PRIVATE-SLACK\n', { mode: 0o600 });
  let loaded = false; let pid: number | undefined; let broken = false; let alive = false; let keepAlive = false;
  const calls: { program: string; args: string[] }[] = [];
  const execute = async (program: string, args: string[]) => {
    calls.push({ program, args });
    if (broken) return { exitCode: 1, stdout: '', stderr: 'Permission denied' };
    if (args[0] === 'print') return loaded ? { exitCode: 0, stdout: `state = ${pid ? 'running' : 'waiting'}\n${pid ? `pid = ${pid}\n` : ''}`, stderr: '' } : { exitCode: 113, stdout: '', stderr: 'Could not find service' };
    if (args[0] === 'bootstrap') { loaded = true; pid = 321; alive = true; }
    if (args[0] === 'bootout') { loaded = false; pid = undefined; if (!keepAlive) alive = false; }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const options = { config: { repositoryRoot, dataDir, credentialsPath }, homeDir: join(directory, 'home'), uid: 123, platform: 'darwin' as const, trustedInstallationRoot: resolve('.'), execute, wait: async () => {}, isProcessAlive: () => alive };
  return { directory, repositoryRoot, dataDir, manifest, calls, options, service: new LocalService(options), breakExecutor() { broken = true; }, keepProcessAlive() { keepAlive = true; }, processExited() { alive = false; }, close() {
    const writable = (path: string) => { chmodSync(path, 0o700); for (const name of readdirSync(path)) { const child = join(path, name); if (lstatSync(child).isDirectory()) writable(child); } };
    writable(directory); rmSync(directory, { recursive: true, force: true });
  } };
}

test('installer copies the verified known-good host privately and never embeds credentials or launches it', async () => {
  const f = fixture();
  try {
    const installed = await f.service.install();
    assert.equal(installed.releaseId, f.manifest.id);
    assert.equal(readFileSync(join(installed.bundlePath, 'src/cli.ts'), 'utf8'), 'console.log("fixture host");');
    assert.equal(statSync(join(installed.bundlePath, 'src/cli.ts')).mode & 0o777, 0o400);
    assert.equal(statSync(installed.bundlePath).mode & 0o777, 0o500);
    assert.equal(realpathSync(join(installed.bundlePath, 'node_modules')), realpathSync(resolve('node_modules')));
    const plist = readFileSync(installed.plistPath, 'utf8');
    assert.equal(statSync(installed.plistPath).mode & 0o777, 0o600);
    assert.match(plist, /repo &amp; &quot;quoted&quot;/);
    assert.match(plist, /<string>serve<\/string>\s*<string>59940<\/string>/);
    assert.match(plist, /PALIMPSEST_CREDENTIALS_FILE/); assert.match(plist, /PALIMPSEST_DATA_DIR/);
    assert.doesNotMatch(plist, /PRIVATE-SENTINEL|PRIVATE-SLACK|MISTRAL_API_KEY|SLACK_BOT_TOKEN/);
    assert.ok(f.calls.every(call => call.program === '/bin/launchctl' && call.args[0] === 'print'));
    const again = await f.service.install(); assert.equal(again.bundlePath, installed.bundlePath);
    assert.equal(readFileSync(join(f.manifest.candidateRoot, 'src/cli.ts'), 'utf8'), 'console.log("fixture host");');
  } finally { f.close(); }
});

test('fixed launchctl commands start idempotently, observe status and stop without shell execution', async () => {
  const f = fixture();
  try {
    const installed = await f.service.install();
    const started = await f.service.start(); assert.equal(started.state, 'running'); assert.equal(started.pid, 321);
    await f.service.start(); assert.equal(f.calls.filter(call => call.args[0] === 'bootstrap').length, 1);
    assert.deepEqual(f.calls.find(call => call.args[0] === 'bootstrap')!.args, ['bootstrap', 'gui/123', installed.plistPath]);
    await assert.rejects(f.service.install(), /loaded/);
    assert.equal((await f.service.stop()).state, 'unloaded');
    assert.equal(f.calls.filter(call => call.args[0] === 'bootout').length, 1);
    assert.deepEqual(f.calls.find(call => call.args[0] === 'bootout')!.args, ['bootout', '--wait', `gui/123/${installed.label}`]);
    await f.service.stop(); assert.equal(f.calls.filter(call => call.args[0] === 'bootout').length, 1);
    f.breakExecutor(); await assert.rejects(f.service.status(), /observe/);
  } finally { f.close(); }
});

test('an uncertain bootout without any observed PID persists and prevents restart or installation', async () => {
  const f = fixture(); let loaded = false;
  const execute = async (_program: string, args: string[]) => {
    if (args[0] === 'print') return loaded ? { exitCode: 0, stdout: 'state = waiting\n', stderr: '' } : { exitCode: 113, stdout: '', stderr: 'Could not find service' };
    if (args[0] === 'bootstrap') { loaded = true; return { exitCode: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'bootout') { loaded = false; throw new Error('Simulated launchctl timeout with unknown process outcome'); }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const service = new LocalService({ ...f.options, execute });
  try {
    await service.install(); await service.start();
    await assert.rejects(service.stop(), /timeout/);
    assert.equal((await service.status()).state, 'unloaded');
    const restored = new LocalService({ ...f.options, execute });
    await assert.rejects(restored.start(), /unconfirmed|reconciliation/);
    await assert.rejects(restored.install(), /unconfirmed|reconciliation/);
    await assert.rejects(restored.stop(), /unconfirmed|reconciliation/);
  } finally { f.close(); }
});

test('verified node starts through env -i with an exact secret-free environment allowlist', async () => {
  const f = fixture();
  try {
    const installation = await f.service.install();
    const plist = readFileSync(installation.plistPath, 'utf8');
    const array = plist.match(/<key>ProgramArguments<\/key><array>([\s\S]*?)<\/array>/)![1]!;
    const argv = [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(match => match[1]!);
    assert.deepEqual(argv.slice(0, 2), ['/usr/bin/env', '-i']);
    assert.equal(argv.length, 10);
    assert.ok(argv[2]!.startsWith('HOME=')); assert.ok(argv[3]!.startsWith('PATH='));
    assert.ok(argv[4]!.startsWith('PALIMPSEST_DATA_DIR=')); assert.ok(argv[5]!.startsWith('PALIMPSEST_CREDENTIALS_FILE='));
    assert.equal(argv[6], installation.nodePath); assert.equal(argv[8], 'serve'); assert.equal(argv[9], '59940');
    assert.doesNotMatch(plist, /EnvironmentVariables|NODE_OPTIONS|PRIVATE-SENTINEL|MISTRAL_API_KEY/);
    const preloader = join(f.directory, 'inherited-preloader.cjs');
    writeFileSync(preloader, 'throw new Error("INHERITED NODE_OPTIONS EXECUTED");');
    // Exercise the real environment boundary with a harmless Node probe. No
    // launchd or serving process is started; the injected preload must not run.
    const observed = JSON.parse(execFileSync('/usr/bin/env', [...argv.slice(1, 6), installation.nodePath, '--input-type=module', '-e',
      'process.stdout.write(JSON.stringify({nodeOptions:process.env.NODE_OPTIONS??null,apiKey:process.env.MISTRAL_API_KEY??null,dataDir:process.env.PALIMPSEST_DATA_DIR,home:process.env.HOME}))'],
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require=${preloader}`, MISTRAL_API_KEY: 'ENVIRONMENT-SENTINEL', PALIMPSEST_DATA_DIR: 'untrusted-override' } }));
    assert.deepEqual(observed, { nodeOptions: null, apiKey: null, dataDir: realpathSync(f.dataDir), home: f.options.homeDir });
  } finally { f.close(); }
});

test('stop command timeouts share one overall deadline instead of multiplying per observation', async () => {
  const f = fixture(); let now = 0; const limits: { args: string[]; milliseconds: number }[] = [];
  const execute = async (program: string, args: string[], milliseconds: number) => {
    limits.push({ args, milliseconds });
    now += args[0] === 'bootout' ? Math.min(50_000, milliseconds) : Math.min(2000, milliseconds);
    return f.options.execute(program, args);
  };
  const service = new LocalService({ ...f.options, execute, now: () => now, wait: async (ms: number) => { now += ms; } });
  try {
    await service.install(); await service.start(); f.keepProcessAlive(); limits.length = 0;
    const startedAt = now;
    await assert.rejects(service.stop(), /unconfirmed|deadline/);
    assert.ok(now - startedAt <= 55_000);
    assert.ok(limits.every(limit => Number.isFinite(limit.milliseconds) && limit.milliseconds > 0));
    assert.ok(limits.filter(limit => limit.args[0] === 'print').every(limit => limit.milliseconds <= 5000));
    assert.ok(limits.at(-1)!.milliseconds < 5000);
  } finally { f.close(); }
});

test('installer rejects modified copied host bytes and unsupported platforms', async () => {
  const f = fixture();
  try {
    assert.throws(() => new LocalService({ ...f.options, platform: 'linux' }), /macOS/);
    const installed = await f.service.install();
    // Owner can tamper with an installation, but a reinstallation/start must fail.
    execFileSync('/bin/chmod', ['u+w', join(installed.bundlePath, 'src/cli.ts')]);
    writeFileSync(join(installed.bundlePath, 'src/cli.ts'), 'unverified host');
    await assert.rejects(f.service.install(), /identity/);
    await assert.rejects(f.service.start(), /identity/);
    assert.ok(f.calls.every(call => call.args[0] !== 'bootstrap'));
  } finally { f.close(); }
});

test('an unloaded job with a still-live recorded process cannot be counted as stopped or restarted', async () => {
  const f = fixture();
  try {
    await f.service.install(); await f.service.start(); f.keepProcessAlive();
    await assert.rejects(f.service.stop(), /unconfirmed/);
    await assert.rejects(new LocalService(f.options).start(), /unconfirmed/);
    await assert.rejects(f.service.install(), /unconfirmed/);
    assert.equal(f.calls.filter(call => call.args[0] === 'bootstrap').length, 1);
    f.processExited(); assert.equal((await f.service.stop()).state, 'unloaded');
    assert.equal((await f.service.start()).state, 'running');
  } finally { f.close(); }
});

test('known-good mismatch and unsafe external paths fail before host installation', async () => {
  const f = fixture();
  try {
    assert.throws(() => new LocalService({ ...f.options, config: { ...f.options.config, dataDir: join(f.repositoryRoot, 'state') } }), /outside/);
    const db = new DatabaseSync(join(f.dataDir, 'custodian/custodian.sqlite'));
    db.prepare('UPDATE custodian_state SET record=? WHERE id=1').run(JSON.stringify({ knownGood: { digest: '0'.repeat(64), artifactPath: f.manifest.releaseDir } })); db.close();
    await assert.rejects(f.service.install(), /identity/);
    assert.ok(f.calls.every(call => call.args[0] === 'print'));
    assert.equal(readFileSync(join(f.manifest.candidateRoot, 'src/cli.ts'), 'utf8'), 'console.log("fixture host");');
  } finally { f.close(); }
});

test('a newer protected host baseline requires redeployment and retains the older bundle', async () => {
  const f = fixture();
  try {
    const first = await f.service.install();
    writeFileSync(join(f.repositoryRoot, 'src/cli.ts'), 'console.log("new verified fixture host");');
    execFileSync('/usr/bin/git', ['add', 'src/cli.ts'], { cwd: f.repositoryRoot });
    execFileSync('/usr/bin/git', ['commit', '-qm', 'operator host baseline fixture'], { cwd: f.repositoryRoot });
    const next = freezeBaseline({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
    const db = new DatabaseSync(join(f.dataDir, 'custodian/custodian.sqlite'));
    db.prepare('UPDATE custodian_state SET record=? WHERE id=1').run(JSON.stringify({ knownGood: { digest: next.manifestDigest, artifactPath: next.releaseDir, governanceDigest: next.governanceDigest, dataSchemaVersion: next.dataSchemaVersion } })); db.close();
    await assert.rejects(f.service.start(), /governance changed/);
    const second = await f.service.install(); assert.notEqual(second.bundlePath, first.bundlePath);
    assert.equal(readFileSync(join(first.bundlePath, 'src/cli.ts'), 'utf8'), 'console.log("fixture host");');
    assert.equal(readFileSync(join(second.bundlePath, 'src/cli.ts'), 'utf8'), 'console.log("new verified fixture host");');
    assert.equal((await f.service.start()).state, 'running');
  } finally { f.close(); }
});
