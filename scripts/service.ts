import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { verifyFrozenCandidate } from '../src/candidates.ts';
import type { CandidateManifest } from '../src/candidates.ts';
import { loadConfig, resolveExternalPath } from '../src/config.ts';
import type { RuntimeConfig } from '../src/config.ts';
import type { CustodianState } from '../src/custodian.ts';

interface CommandResult { exitCode: number; stdout: string; stderr: string }
interface ServiceOptions {
  config: Pick<RuntimeConfig, 'repositoryRoot' | 'dataDir' | 'credentialsPath'>;
  homeDir?: string; uid?: number; platform?: NodeJS.Platform; trustedInstallationRoot?: string;
  execute?: (program: string, args: string[], timeoutMs: number) => Promise<CommandResult>;
  wait?: (milliseconds: number) => Promise<void>;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
}
export interface ServiceStatus { label: string; state: 'unloaded' | 'loaded' | 'running'; pid?: number }
interface Installation { version: 1; label: string; releaseId: string; releaseDir: string; bundlePath: string; plistPath: string; nodePath: string }
interface StopIntent { label: string; pid: number | null; commandCompleted: boolean; complete: boolean }
const installedRoot = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const xml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || (lstatSync(path).mode & 0o077)) throw new Error('Service directory must be private and real');
}
function privateFile(path: string, initial = ''): void {
  if (!existsSync(path)) writeFileSync(path, initial, { flag: 'wx', mode: 0o600 });
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() || (lstatSync(path).mode & 0o077)) throw new Error('Service file must be private and regular');
}
function requirePrivateFile(path: string): void {
  if (!existsSync(path)) throw new Error('Required private service/configuration file is missing');
  privateFile(path);
}
function writePrivateAtomic(path: string, value: string): void {
  if (existsSync(path)) requirePrivateFile(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
function execute(program: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((accept, reject) => execFile(program, args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1_048_576 }, (error, stdout, stderr) => {
    if (error && (typeof error.code !== 'number' || error.killed)) { reject(new Error('Bounded service command did not complete; inspect status before retry')); return; }
    accept({ exitCode: error?.code as number ?? 0, stdout, stderr });
  }));
}

/** Explicit operator service manager. No shell, credentials, mutable checkout
 * host imports, or cognitive authority enter launchd's fixed command surface. */
export class LocalService {
  readonly #config: ServiceOptions['config']; readonly #home: string; readonly #uid: number;
  readonly #root: string; readonly #execute: NonNullable<ServiceOptions['execute']>; readonly #wait: NonNullable<ServiceOptions['wait']>;
  readonly #isProcessAlive: NonNullable<ServiceOptions['isProcessAlive']>;
  readonly #now: () => number;
  readonly label: string;
  constructor(options: ServiceOptions) {
    if ((options.platform ?? process.platform) !== 'darwin') throw new Error('Local service management requires macOS');
    this.#config = { repositoryRoot: realpathSync(options.config.repositoryRoot),
      dataDir: resolveExternalPath(options.config.repositoryRoot, options.config.dataDir),
      credentialsPath: resolveExternalPath(options.config.repositoryRoot, options.config.credentialsPath) };
    this.#home = resolve(options.homeDir ?? homedir()); this.#uid = options.uid ?? process.getuid!();
    if (!Number.isSafeInteger(this.#uid) || this.#uid < 0) throw new Error('Invalid user service domain');
    this.#root = realpathSync(options.trustedInstallationRoot ?? installedRoot);
    this.label = `org.palimpsest.${createHash('sha256').update(this.#config.repositoryRoot).digest('hex').slice(0, 16)}`;
    this.#execute = options.execute ?? execute; this.#wait = options.wait ?? (ms => new Promise(done => setTimeout(done, ms)));
    this.#now = options.now ?? (() => performance.now());
    this.#isProcessAlive = options.isProcessAlive ?? (pid => {
      try { process.kill(pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw new Error('Cannot observe stopped service process'); }
    });
  }
  get #target(): string { return `gui/${this.#uid}/${this.label}`; }
  get #serviceDir(): string { return join(this.#config.dataDir, 'service'); }
  get #metadataPath(): string { return join(this.#serviceDir, 'installation.json'); }
  get #stopIntentPath(): string { return join(this.#serviceDir, 'stop-intent.json'); }
  get #plistPath(): string { return resolveExternalPath(this.#config.repositoryRoot, join(this.#home, 'Library/LaunchAgents', `${this.label}.plist`)); }

  #knownGood(): CandidateManifest {
    const path = resolveExternalPath(this.#config.repositoryRoot, join(this.#config.dataDir, 'custodian/custodian.sqlite'));
    const database = new DatabaseSync(path, { readOnly: true });
    let state: CustodianState;
    try {
      const row = database.prepare('SELECT record FROM custodian_state WHERE id=1').get();
      if (!row || typeof row.record !== 'string') throw new Error('Existing custody state is required');
      state = JSON.parse(row.record) as CustodianState;
    } finally { database.close(); }
    const release = state.knownGood;
    if (!release || !/^[a-f0-9]{64}$/.test(release.digest)) throw new Error('An admitted known-good host is required');
    const manifest = verifyFrozenCandidate({ repositoryRoot: this.#config.repositoryRoot, releaseDir: release.artifactPath, requireCurrentBase: false, expectedLegacyManifestDigest: release.digest });
    if (manifest.manifestDigest !== release.digest || manifest.governanceDigest !== release.governanceDigest || manifest.dataSchemaVersion !== release.dataSchemaVersion)
      throw new Error('Known-good host identity does not match custody');
    if (manifest.releaseDir !== join(this.#config.dataDir, 'releases', manifest.id)) throw new Error('Known-good artifact is outside the configured release store');
    this.#verifyToolchain(manifest);
    return manifest;
  }
  #verifyToolchain(manifest: CandidateManifest): void {
    const dependencies = realpathSync(join(this.#root, 'node_modules'));
    const compiler = realpathSync(join(dependencies, '@typescript', `typescript-${process.platform}-${process.arch}`, 'lib/tsc'));
    if (compiler !== manifest.runtime.compilerPath || sha256(readFileSync(process.execPath)) !== manifest.runtime.nodeSha256)
      throw new Error('Service runtime/toolchain identity changed');
  }
  #verifyBundle(manifest: CandidateManifest, bundle: string): void {
    if (lstatSync(bundle).isSymbolicLink() || !lstatSync(bundle).isDirectory() || (lstatSync(bundle).mode & 0o077)) throw new Error('Service bundle identity mismatch');
    const expected = new Set(manifest.files.map(file => file.path)); const found = new Set<string>();
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name); const local = relative(bundle, path); const stat = lstatSync(path);
        if (local === 'node_modules') {
          if (!stat.isSymbolicLink() || realpathSync(path) !== realpathSync(join(this.#root, 'node_modules'))) throw new Error('Service dependency link identity mismatch');
          continue;
        }
        if (stat.isSymbolicLink()) throw new Error('Service source identity mismatch: symlink');
        if (stat.isDirectory()) { if (stat.mode & 0o077) throw new Error('Service directory identity mismatch'); walk(path); }
        else if (stat.isFile() && expected.has(local)) {
          const file = manifest.files.find(file => file.path === local)!;
          if (sha256(readFileSync(path)) !== file.sha256 || ((stat.mode & 0o111) !== 0) !== (file.mode === '100755') || (stat.mode & 0o277) !== 0)
            throw new Error('Service source identity mismatch');
          found.add(local);
        } else throw new Error('Service source identity mismatch: unexpected file');
      }
    };
    walk(bundle);
    if (found.size !== expected.size || !existsSync(join(bundle, 'node_modules'))) throw new Error('Service source identity mismatch: missing file');
  }
  #installation(): { installation: Installation; manifest: CandidateManifest } {
    requirePrivateFile(this.#metadataPath);
    const installation = JSON.parse(readFileSync(this.#metadataPath, 'utf8')) as Installation;
    if (installation.version !== 1 || installation.label !== this.label || !/^[a-f0-9]{64}$/.test(installation.releaseId)
      || installation.bundlePath !== join(this.#config.dataDir, 'host-installations', installation.releaseId) || installation.plistPath !== this.#plistPath
      || installation.nodePath !== realpathSync(process.execPath) || installation.releaseDir !== join(this.#config.dataDir, 'releases', installation.releaseId))
      throw new Error('Service installation identity mismatch');
    const manifest = verifyFrozenCandidate({ repositoryRoot: this.#config.repositoryRoot, releaseDir: installation.releaseDir, requireCurrentBase: false, expectedLegacyManifestDigest: installation.releaseId });
    if (manifest.id !== installation.releaseId) throw new Error('Service installation identity mismatch');
    this.#verifyToolchain(manifest); this.#verifyBundle(manifest, installation.bundlePath);
    if (this.#knownGood().governanceDigest !== manifest.governanceDigest) throw new Error('Known-good host governance changed; stop and redeploy the host bundle');
    requirePrivateFile(installation.plistPath);
    if (readFileSync(installation.plistPath, 'utf8') !== this.#plist(installation)) throw new Error('Service plist identity mismatch');
    return { installation, manifest };
  }
  #pendingStop(): StopIntent | undefined {
    if (!existsSync(this.#stopIntentPath)) return undefined;
    requirePrivateFile(this.#stopIntentPath);
    const intent = JSON.parse(readFileSync(this.#stopIntentPath, 'utf8')) as StopIntent;
    if (intent.label !== this.label || (intent.pid !== null && (!Number.isSafeInteger(intent.pid) || intent.pid < 1))
      || typeof intent.complete !== 'boolean' || (intent.commandCompleted !== undefined && typeof intent.commandCompleted !== 'boolean')) throw new Error('Service stop intent identity mismatch');
    return intent.complete ? undefined : { ...intent, commandCompleted: intent.commandCompleted === true };
  }
  #recordStop(intent: StopIntent): void {
    privateDirectory(this.#serviceDir);
    writePrivateAtomic(this.#stopIntentPath, JSON.stringify(intent));
  }
  #assertStoppedIntent(status: ServiceStatus): void {
    const intent = this.#pendingStop(); if (!intent) return;
    if (status.state !== 'unloaded' || (intent.pid !== null && this.#isProcessAlive(intent.pid))) throw new Error('Service stop remains unconfirmed; no install or restart performed');
    if (intent.pid === null && !intent.commandCompleted) throw new Error('Unknown-PID service stop requires explicit operator reconciliation; no install or restart performed');
    this.#recordStop({ ...intent, complete: true });
  }
  #remaining(deadline: number, maximum: number): number {
    const remaining = Math.floor(Math.min(maximum, deadline - this.#now()));
    if (!Number.isFinite(remaining) || remaining < 1) throw new Error('Service stop deadline reached; stop remains unconfirmed');
    return remaining;
  }
  #plist(installation: Installation): string {
    const strings = (values: string[]) => values.map(value => `<string>${xml(value)}</string>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(this.label)}</string>
<key>ProgramArguments</key><array>${strings(['/usr/bin/env', '-i', `HOME=${this.#home}`, `PATH=${dirname(installation.nodePath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      `PALIMPSEST_DATA_DIR=${this.#config.dataDir}`, `PALIMPSEST_CREDENTIALS_FILE=${this.#config.credentialsPath}`,
      installation.nodePath, join(installation.bundlePath, 'src/cli.ts'), 'serve', '59940'])}</array>
<key>WorkingDirectory</key><string>${xml(this.#config.repositoryRoot)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>45</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(this.#serviceDir, 'stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(this.#serviceDir, 'stderr.log'))}</string>
</dict></plist>
`;
  }
  async status(): Promise<ServiceStatus> {
    return this.#status(5000);
  }
  async #status(timeoutMs: number): Promise<ServiceStatus> {
    const result = await this.#execute('/bin/launchctl', ['print', this.#target], timeoutMs);
    if (result.exitCode !== 0) {
      if (/Could not find (?:specified )?service|service.*not found/i.test(result.stderr)) return { label: this.label, state: 'unloaded' };
      throw new Error('Cannot observe service status; no lifecycle action inferred');
    }
    const match = result.stdout.match(/^\s*pid = (\d+)\s*$/m); const pid = match ? Number(match[1]) : undefined;
    return { label: this.label, state: pid && /^\s*state = running\s*$/m.test(result.stdout) ? 'running' : 'loaded', ...(pid ? { pid } : {}) };
  }
  async install(): Promise<Installation> {
    const status = await this.status();
    if (status.state !== 'unloaded') throw new Error('Stop the loaded service before installing a host bundle');
    this.#assertStoppedIntent(status);
    const manifest = this.#knownGood();
    if (!manifest.files.some(file => file.path === 'src/cli.ts')) throw new Error('Known-good source has no serving CLI');
    privateDirectory(this.#config.dataDir); requirePrivateFile(this.#config.credentialsPath);
    const parent = resolveExternalPath(this.#config.repositoryRoot, join(this.#config.dataDir, 'host-installations')); privateDirectory(parent);
    const bundle = join(parent, manifest.id);
    if (!existsSync(bundle)) {
      const temporary = join(parent, `.preparing-${manifest.id}-${randomUUID()}`); privateDirectory(temporary);
      for (const file of manifest.files) {
        const target = join(temporary, file.path); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, readFileSync(join(manifest.candidateRoot, file.path)), { flag: 'wx', mode: file.mode === '100755' ? 0o500 : 0o400 });
      }
      symlinkSync(realpathSync(join(this.#root, 'node_modules')), join(temporary, 'node_modules'), 'dir');
      this.#verifyBundle(manifest, temporary);
      const freeze = (path: string) => { for (const name of readdirSync(path)) { const child = join(path, name); if (lstatSync(child).isDirectory()) freeze(child); } chmodSync(path, 0o500); };
      freeze(temporary); renameSync(temporary, bundle);
    }
    this.#verifyBundle(manifest, bundle);
    privateDirectory(this.#serviceDir); privateFile(join(this.#serviceDir, 'stdout.log')); privateFile(join(this.#serviceDir, 'stderr.log'));
    const launchAgents = dirname(this.#plistPath); mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
    if (lstatSync(launchAgents).isSymbolicLink()) throw new Error('LaunchAgents directory must be real');
    const installation: Installation = { version: 1, label: this.label, releaseId: manifest.id, releaseDir: manifest.releaseDir,
      bundlePath: bundle, plistPath: this.#plistPath, nodePath: realpathSync(process.execPath) };
    writePrivateAtomic(this.#plistPath, this.#plist(installation));
    writePrivateAtomic(this.#metadataPath, JSON.stringify(installation));
    return installation;
  }
  async start(): Promise<ServiceStatus> {
    const before = await this.status(); this.#assertStoppedIntent(before);
    const { installation } = this.#installation();
    if (before.state === 'running') return before;
    const args = before.state === 'unloaded' ? ['bootstrap', `gui/${this.#uid}`, installation.plistPath] : ['kickstart', this.#target];
    if ((await this.#execute('/bin/launchctl', args, 50_000)).exitCode !== 0) throw new Error('Service start did not complete; inspect status before retry');
    return this.status();
  }
  async stop(): Promise<ServiceStatus> {
    const deadline = this.#now() + 55_000;
    const before = await this.#status(this.#remaining(deadline, 5000)); const pending = this.#pendingStop();
    if (before.state === 'unloaded') { this.#assertStoppedIntent(before); return before; }
    let intent: StopIntent = { label: this.label, pid: before.pid ?? pending?.pid ?? null, commandCompleted: false, complete: false };
    // Persist even when launchd has not exposed a PID. A command timeout can
    // remove the job while leaving an unidentified process outcome uncertain.
    this.#recordStop(intent);
    if ((await this.#execute('/bin/launchctl', ['bootout', '--wait', this.#target], this.#remaining(deadline, 50_000))).exitCode !== 0)
      throw new Error('Service stop did not complete; inspect status before retry');
    intent = { ...intent, commandCompleted: true }; this.#recordStop(intent);
    const observationDeadline = Math.min(deadline, this.#now() + 5000);
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await this.#status(this.#remaining(observationDeadline, 5000));
      if (result.state === 'unloaded' && (intent.pid === null || !this.#isProcessAlive(intent.pid))) {
        this.#recordStop({ ...intent, complete: true }); return result;
      }
      await this.#wait(this.#remaining(observationDeadline, 250));
    }
    throw new Error('Service stop remains unconfirmed; no restart performed');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (!['install', 'start', 'status', 'stop'].includes(command ?? '') || process.argv.length !== 3) {
    console.error('Usage: node scripts/service.ts install|start|status|stop'); process.exitCode = 1;
  } else {
    const service = new LocalService({ config: loadConfig() });
    void (command === 'install' ? service.install() : command === 'start' ? service.start() : command === 'stop' ? service.stop() : service.status())
      .then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error instanceof Error ? error.message : 'Service operation failed'); process.exitCode = 1; });
  }
}
