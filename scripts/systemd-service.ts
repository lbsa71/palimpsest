import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, resolveExternalPath } from '../src/config.ts';
import type { RuntimeConfig } from '../src/config.ts';
import { verifyFrozenCandidate } from '../src/candidates.ts';
import type { CandidateManifest } from '../src/candidates.ts';
import type { Release } from '../src/custodian.ts';
import { CoordinatorLock } from '../src/ownership.ts';

const installedRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export interface SystemdInstallation {
  version: 1; releaseId: string; bundlePath: string; nodePath: string;
  repositoryRoot: string; dataDir: string; credentialsPath: string;
}
interface Options {
  config: Pick<RuntimeConfig, 'repositoryRoot' | 'dataDir' | 'credentialsPath'>;
  /** Trusted fixture gate only; production loads the independently reviewed migration guard. */
  assertReady?: (dataDir: string) => void | Promise<void>;
  /** Trusted fixture layout/owner overrides; production is root-sealed under /opt. */
  hostRoot?: string; sealOwner?: number;
}
function privateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new Error('Service file must be private and regular');
}
function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 }); const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Service directory must be private and real');
}
function atomicPrivate(path: string, content: string): void {
  if (existsSync(path)) privateFile(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path);
}

/** Operator preparation and startup verification only; no admission or provider calls. */
export class SystemdService {
  readonly #config: Options['config']; readonly #ready: NonNullable<Options['assertReady']>;
  readonly #hostRoot: string; readonly #sealOwner: number; readonly #fixture: boolean;
  constructor(options: Options) {
    const repositoryRoot = realpathSync(options.config.repositoryRoot);
    this.#hostRoot = options.hostRoot ?? '/opt/palimpsest/hosts'; this.#sealOwner = options.sealOwner ?? 0;
    this.#fixture = options.hostRoot !== undefined || options.sealOwner !== undefined;
    this.#config = { repositoryRoot, dataDir: resolveExternalPath(repositoryRoot, options.config.dataDir),
      credentialsPath: resolveExternalPath(repositoryRoot, options.config.credentialsPath) };
    this.#ready = options.assertReady ?? (async dataDir => {
      const guard = await import(new URL('../src/platform-migration-gate.ts', import.meta.url).href) as { assertPlatformMigrationReady(path: string): void };
      guard.assertPlatformMigrationReady(dataDir);
    });
  }
  #verifyRuntimeOwnership(): void {
    const binary = realpathSync(process.execPath);
    if (this.#fixture) return; // Trusted fixture layout/owner is never selected by production CLI.
    if (!binary.startsWith('/opt/palimpsest/runtime/')) throw new Error('Service requires the root-owned /opt runtime');
    for (let path = binary; ; path = dirname(path)) {
      const stat = lstatSync(path);
      if (stat.uid !== 0 || (stat.mode & 0o022)) throw new Error('Runtime ancestry must be root-controlled');
      if (path === '/') break;
    }
  }
  get #serviceDir(): string { return join(this.#config.dataDir, 'service'); }
  #manifest(releaseId: string): CandidateManifest {
    if (!/^[a-f0-9]{64}$/.test(releaseId)) throw new Error('Invalid installation identity');
    const manifest = verifyFrozenCandidate({ repositoryRoot: this.#config.repositoryRoot,
      releaseDir: join(this.#config.dataDir, 'releases', releaseId), requireCurrentBase: false, expectedLegacyManifestDigest: releaseId });
    if (manifest.id !== releaseId || manifest.releaseDir !== join(this.#config.dataDir, 'releases', releaseId)) throw new Error('Frozen installation identity mismatch');
    return manifest;
  }
  async #knownGood(): Promise<CandidateManifest> {
    await this.#ready(this.#config.dataDir);
    const path = join(this.#config.dataDir, 'custodian/custodian.sqlite');
    const db = new DatabaseSync(path, { readOnly: true });
    let release: Release | undefined;
    try {
      const row = db.prepare('SELECT record FROM custodian_state WHERE id=1').get();
      if (!row || typeof row.record !== 'string') throw new Error('Admitted native custody is required');
      release = (JSON.parse(row.record) as { knownGood?: Release }).knownGood;
    } finally { db.close(); }
    if (!release) throw new Error('Admitted native custody is required');
    const manifest = this.#manifest(release.digest);
    if (realpathSync(release.artifactPath) !== manifest.releaseDir || release.governanceDigest !== manifest.governanceDigest
      || release.dataSchemaVersion !== manifest.dataSchemaVersion) throw new Error('Known-good custody identity mismatch');
    return manifest;
  }
  #verifyProjection(manifest: CandidateManifest, bundle: string, sealed = false): void {
    const root = lstatSync(bundle);
    const groupRead = sealed ? 0o050 : 0;
    if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o777) !== (0o500 | groupRead) || (sealed && root.uid !== this.#sealOwner)) throw new Error('Host projection root identity mismatch');
    const expected = new Map(manifest.files.map(file => [file.path, file])); const found = new Set<string>();
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name), local = relative(bundle, path), stat = lstatSync(path);
        if (sealed && stat.uid !== this.#sealOwner) throw new Error('Host projection owner differs from independent installation');
        if (local === 'node_modules') {
          if (!stat.isSymbolicLink() || realpathSync(path) !== realpathSync(join(installedRoot, 'node_modules'))) throw new Error('Host dependency link identity mismatch');
        } else if (stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === (0o500 | groupRead)
          && manifest.files.some(file => file.path.startsWith(`${local}/`))) walk(path);
        else {
          const file = expected.get(local);
          if (!file || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== ((file.mode === '100755' ? 0o500 : 0o400) | (sealed ? (file.mode === '100755' ? 0o050 : 0o040) : 0))
            || sha(readFileSync(path)) !== file.sha256) throw new Error('Host projection source identity mismatch');
          found.add(local);
        }
      }
    };
    walk(bundle);
    if (found.size !== expected.size || !existsSync(join(bundle, 'node_modules'))) throw new Error('Host projection is incomplete');
  }
  async prepare(): Promise<SystemdInstallation> {
    this.#verifyRuntimeOwnership();
    await this.#ready(this.#config.dataDir); privateDirectory(this.#config.dataDir); privateFile(this.#config.credentialsPath);
    const lock = new CoordinatorLock(join(this.#config.dataDir, 'coordinator.sqlite'));
    try {
      const manifest = await this.#knownGood();
      for (const path of ['src/cli.ts', 'src/platform-migration-gate.ts', 'scripts/systemd-service.ts', 'deploy/systemd/palimpsest.service.in']) {
        if (!manifest.files.some(file => file.path === path)) throw new Error('Admitted host lacks the systemd entrypoint/template');
      }
      if (manifest.files.some(file => /[\n\r\\]/u.test(file.path))) throw new Error('Checksum projection requires plain file names');
      const parent = join(this.#config.dataDir, 'host-installations'); privateDirectory(parent);
      const bundlePath = join(parent, manifest.id);
      if (!existsSync(bundlePath)) {
        const temporary = join(parent, `.preparing-${randomUUID()}`); privateDirectory(temporary);
        for (const file of manifest.files) {
          const path = join(temporary, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
          writeFileSync(path, readFileSync(join(manifest.candidateRoot, file.path)), { flag: 'wx', mode: file.mode === '100755' ? 0o500 : 0o400 });
        }
        symlinkSync(realpathSync(join(installedRoot, 'node_modules')), join(temporary, 'node_modules'));
        const freeze = (path: string) => { for (const name of readdirSync(path)) { const child = join(path, name); if (lstatSync(child).isDirectory()) freeze(child); } chmodSync(path, 0o500); };
        freeze(temporary); this.#verifyProjection(manifest, temporary); renameSync(temporary, bundlePath);
      }
      this.#verifyProjection(manifest, bundlePath);
      privateDirectory(this.#serviceDir); privateDirectory(join(this.#serviceDir, 'scratch'));
      for (const name of ['stdout.log', 'stderr.log']) { const path = join(this.#serviceDir, name); if (!existsSync(path)) writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); privateFile(path); }
      const installation: SystemdInstallation = { version: 1, releaseId: manifest.id, bundlePath: join(this.#hostRoot, manifest.id), nodePath: realpathSync(process.execPath), ...this.#config };
      atomicPrivate(join(this.#serviceDir, `host-${manifest.id}.sha256`),
        [...manifest.files.map(file => `${file.sha256}  ${join(installation.bundlePath, file.path)}`),
          `${manifest.runtime.nodeSha256}  ${installation.nodePath}`].join('\n') + '\n');
      atomicPrivate(join(this.#serviceDir, 'systemd-installation.json'), JSON.stringify(installation));
      atomicPrivate(join(this.#serviceDir, 'palimpsest.service'), this.unit(installation));
      return installation;
    } finally { lock.close(); }
  }
  async verify(releaseId: string, entrypointRoot?: string): Promise<SystemdInstallation> {
    // Independently checked/sealed bootstrap runs before interpreting mutable operational records.
    this.#verifyRuntimeOwnership();
    const manifest = this.#manifest(releaseId), bundlePath = join(this.#hostRoot, manifest.id);
    const hostRoot = lstatSync(this.#hostRoot);
    if (!hostRoot.isDirectory() || hostRoot.isSymbolicLink() || hostRoot.uid !== this.#sealOwner || (hostRoot.mode & 0o022)) throw new Error('Independent host installation root is unsafe');
    this.#verifyProjection(manifest, bundlePath, true);
    if (entrypointRoot !== undefined && realpathSync(entrypointRoot) !== realpathSync(bundlePath)) throw new Error('Service entrypoint root differs from frozen host');
    const descriptor = join(this.#serviceDir, 'systemd-installation.json'); privateFile(descriptor); privateFile(this.#config.credentialsPath);
    const installation = JSON.parse(readFileSync(descriptor, 'utf8')) as SystemdInstallation;
    const expected: SystemdInstallation = { version: 1, releaseId, bundlePath, nodePath: realpathSync(process.execPath), ...this.#config };
    if (JSON.stringify(installation) !== JSON.stringify(expected)) throw new Error('Systemd installation identity mismatch');
    const current = await this.#knownGood();
    if (current.governanceDigest !== manifest.governanceDigest) throw new Error('Current host governance requires a new installation');
    privateDirectory(join(this.#serviceDir, 'scratch'));
    for (const name of ['stdout.log', 'stderr.log']) privateFile(join(this.#serviceDir, name));
    return installation;
  }
  environment(installation: SystemdInstallation): Record<string, string> {
    return { HOME: '/home/palimpsest', PATH: `${dirname(installation.nodePath)}:/usr/bin:/bin`,
      PALIMPSEST_DATA_DIR: installation.dataDir, PALIMPSEST_CREDENTIALS_FILE: installation.credentialsPath,
      TMPDIR: join(installation.dataDir, 'service/scratch') };
  }
  unit(installation: SystemdInstallation): string {
    const values = { REPO: installation.repositoryRoot, DATA: installation.dataDir, CREDS: installation.credentialsPath,
      NODE: installation.nodePath, NODE_DIR: dirname(installation.nodePath), BUNDLE: installation.bundlePath, RELEASE: installation.releaseId, SCRATCH: join(installation.dataDir, 'service/scratch') };
    if (Object.values(values).some(value => /[\s"'\\%$]/u.test(value))) throw new Error('Systemd deployment paths require plain absolute paths');
    return readFileSync(join(this.#config.dataDir, 'host-installations', installation.releaseId, 'deploy/systemd/palimpsest.service.in'), 'utf8')
      .replace(/@([A-Z_]+)@/g, (_whole, key: string) => { const value = values[key as keyof typeof values]; if (!value) throw new Error('Unknown systemd template field'); return value; });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, releaseId, ...extra] = process.argv.slice(2);
  void (async () => {
    if (process.platform !== 'linux' || extra.length || !['prepare', 'verify', 'run'].includes(command ?? '')
      || (command === 'prepare' ? releaseId !== undefined : !releaseId)) throw new Error('Use on Linux: systemd-service.ts prepare|verify <digest>|run <digest>');
    // ExecStartPre already checked the root-sealed code before imports. Verify
    // frozen identity again before the CLI reads credentials
    // or operational content. Only explicit, secret-free deployment paths are
    // needed here; preparation remains a separate reviewed operator command.
    const dataDir = process.env.PALIMPSEST_DATA_DIR, credentialsPath = process.env.PALIMPSEST_CREDENTIALS_FILE;
    if (command !== 'prepare' && (!dataDir || !credentialsPath)) throw new Error('Explicit deployment paths are required');
    const config = command === 'prepare' ? loadConfig() : { repositoryRoot: process.cwd(), dataDir: dataDir!, credentialsPath: credentialsPath! };
    const service = new SystemdService({ config });
    if (command === 'prepare') { console.log(JSON.stringify(await service.prepare())); return; }
    const installation = await service.verify(releaseId!, command === 'run' ? installedRoot : undefined);
    if (command === 'verify') { console.log(JSON.stringify({ releaseId: installation.releaseId, verified: true })); return; }
    if (!process.execve) throw new Error('Linux runtime lacks process replacement');
    process.execve(installation.nodePath, [installation.nodePath, join(installation.bundlePath, 'src/cli.ts'), 'serve', '59940'], service.environment(installation));
  })().catch(() => { console.error('Systemd startup/preparation refused; inspect private installation and migration evidence.'); process.exitCode = 1; });
}
