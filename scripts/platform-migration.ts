import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Custodian, digestCustodianValue } from '../src/custodian.ts';
import type { CustodianState, CustodianEvent, CustodianHooks } from '../src/custodian.ts';
import { digestJson, evaluateCandidate, freezeBaseline, readManifest, verifyFrozenCandidate } from '../src/candidates.ts';
import type { CandidateManifest, CandidateCheckName } from '../src/candidates.ts';
import { GenerationHost, releaseOf } from '../src/generations.ts';
import { CoordinatorLock } from '../src/ownership.ts';
import { resolveExternalPath } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { assertPlatformMigrationReady } from '../src/platform-migration-gate.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requiredChecks: CandidateCheckName[] = ['typecheck', 'trusted-agent-contract', 'cross-scope-memory'];
export interface ShutdownAttestation {
  version: 1; snapshotDigest: string; sourceHost: string; sourcePlatform: string; stoppedAt: string;
  evidenceDigest: string; sourceStopped: true; keepStopped: true;
}
interface Blocker { kind: string; id: string }
interface Snapshot {
  snapshotDigest: string; operationalDigest: string; sourceStateDigest: string; sourceJournalDigest: string;
  sourceEpoch: number; sourceReleaseId: string; blockers: Blocker[];
}
interface MigrationReceipt {
  version: 1; id: string; status: 'preparing' | 'held' | 'imported' | 'ready'; snapshotDigest: string;
  operationalDigest: string; sourceStateDigest: string; sourceJournalDigest: string; sourceEpoch: number;
  sourceReleaseId: string; repositoryRoot: string; dataDir: string; destinationPlatform: string; shutdown: ShutdownAttestation;
  historicalArtifactsRunnable: false; recoveryEpochs: number[]; candidateId?: string; evidenceDigest?: string; reason?: string;
}

/** Inventory follows no links, including historical service dependency links. */
function inventory(directory: string): Array<{ path: string; kind: string; mode: number; sha256?: string; size?: number; target?: string }> {
  const root = realpathSync(directory), entries: ReturnType<typeof inventory> = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const actual = join(path, name), local = relative(root, actual), stat = lstatSync(actual);
      if (stat.isSymbolicLink()) entries.push({ path: local, kind: 'link', mode: stat.mode & 0o777, target: readlinkSync(actual) });
      else if (stat.isDirectory()) { entries.push({ path: local, kind: 'directory', mode: stat.mode & 0o777 }); walk(actual); }
      else if (stat.isFile()) entries.push({ path: local, kind: 'file', mode: stat.mode & 0o777, sha256: hash(readFileSync(actual)), size: stat.size });
      else throw new Error('Snapshot contains a nonregular archival object');
    }
  };
  walk(root); return entries;
}
function regular(path: string): void { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Migration database/source must be a regular file'); }
function copyDatabaseFiles(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(source + suffix)) { regular(source + suffix); copyFileSync(source + suffix, destination + suffix); chmodSync(destination + suffix, 0o600); }
}
function withDatabaseCopy<T>(source: string, read: (db: DatabaseSync) => T): T {
  // Even SQLite read-only WAL access can touch shared-memory bookkeeping. Never
  // open the preserved archive: inspection always uses a disposable exact copy.
  const scratch = mkdtempSync(join(tmpdir(), 'palimpsest-migration-read-')), path = join(scratch, 'copy.sqlite');
  try { copyDatabaseFiles(source, path); const db = new DatabaseSync(path, { readOnly: true }); try { return read(db); } finally { db.close(); } }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}
function logicalDatabase(db: DatabaseSync): string {
  if (String(Object.values(db.prepare('PRAGMA quick_check').get()!)[0]) !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Snapshot database integrity failed');
  const schema = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string; sql: string }>;
  return digestJson(schema.map(table => ({ ...table, rows: db.prepare('SELECT * FROM "' + table.name.replaceAll('"', '""') + '"').all()
    .map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? { blob: Buffer.from(value).toString('hex') } : value])))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })));
}
export function databaseDigest(path: string): string { return withDatabaseCopy(path, logicalDatabase); }
function custodySnapshot(directory: string): { state: CustodianState; journal: CustodianEvent[] } {
  return withDatabaseCopy(join(directory, 'custodian/custodian.sqlite'), db => {
    logicalDatabase(db);
    const row = db.prepare('SELECT record FROM custodian_state WHERE id=1').get();
    if (!row || typeof row.record !== 'string') throw new Error('Snapshot custody is missing');
    const state = JSON.parse(row.record) as CustodianState;
    const journal = db.prepare('SELECT sequence,type,payload,at FROM custodian_events ORDER BY sequence').all().map(row => ({ sequence: Number(row.sequence), type: String(row.type), payload: JSON.parse(String(row.payload)), at: String(row.at) }));
    return { state, journal };
  });
}
function workBlockers(directory: string): Blocker[] {
  return withDatabaseCopy(join(directory, 'state.sqlite'), db => {
    const blockers: Blocker[] = [];
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of ['tasks', 'growth', 'memory_consolidations', 'conversation_reflections']) if (tables.has(table)) {
      const records = db.prepare(`SELECT record FROM ${table}`).all().map(row => JSON.parse(String(row.record)));
      for (const record of records) if (['running', 'waiting_for_provider'].includes(record.state)) blockers.push({ kind: table, id: String(record.id) });
    }
    for (const row of db.prepare("SELECT id FROM effects WHERE state != 'completed'").all()) blockers.push({ kind: 'effect', id: String(row.id) });
    const evolution = new Map<string, string>(), development = new Map<string, string>(), promoted = new Set<string>(), published = new Set<string>();
    for (const row of db.prepare('SELECT type,payload FROM journal ORDER BY seq').all()) {
      const p = object(JSON.parse(String(row.payload))), type = row.type;
      if (type === 'evolution.queue.enqueued') evolution.set(String(p.id), 'queued');
      if (type === 'evolution.queue.claimed') evolution.set(String(p.id), 'running');
      if (type === 'evolution.queue.observed') evolution.set(String(p.id), p.result?.status === 'probation' ? 'probation' : 'finished');
      if (type === 'development.attempt.started' || type === 'development.attempt.updated') development.set(String(p.attempt?.id), String(p.attempt?.state));
      if (type === 'evolution.finished' && p.report?.status === 'promoted') promoted.add(String(p.runId));
      if (type === 'release.publication.result' && p.result?.status === 'published') published.add(String(p.runId));
    }
    for (const [id, state] of evolution) if (state !== 'finished') blockers.push({ kind: 'evolution', id });
    for (const [id, state] of development) if (!['completed', 'paused'].includes(state)) blockers.push({ kind: 'development', id });
    for (const id of promoted) if (!published.has(id)) blockers.push({ kind: 'publication', id });
    if (existsSync(join(directory, 'candidate-jobs/active.json'))) blockers.push({ kind: 'candidate', id: 'active-collection' });
    // General coding workspace relocation is deliberately outside this importer.
    for (const entry of inventory(directory)) if (entry.path.endsWith(`${sep}writer.json`) || entry.path.startsWith(`workspaces${sep}`)) blockers.push({ kind: 'workspace', id: entry.path });
    return blockers;
  });
}
export function inspectMigrationSnapshot(directory: string): Snapshot {
  const entries = inventory(directory);
  if (entries.some(entry => entry.kind === 'link' && /^(?:state\.sqlite(?:-(?:wal|shm))?$|custodian(?:\/|$)|releases(?:\/|$))/.test(entry.path))) {
    throw new Error('Snapshot databases and frozen artifacts cannot contain symlink aliases');
  }
  const before = digestJson(entries), { state, journal } = custodySnapshot(directory);
  if (!state.knownGood || !state.active || state.active.release.digest !== state.knownGood.digest || state.phase !== 'normal'
    || state.pendingLaunch || state.pendingStops.length || state.baselineRestoreIntent || state.operatorBaseline?.status === 'prepared'
    || state.platformMigration || state.successions.some(item => ['evaluation', 'transfer', 'probation'].includes(item.state))) throw new Error('Snapshot custody is not a settled source installation');
  const result = { snapshotDigest: before, operationalDigest: databaseDigest(join(directory, 'state.sqlite')),
    sourceStateDigest: digestCustodianValue(state), sourceJournalDigest: digestCustodianValue(journal), sourceEpoch: state.epoch,
    sourceReleaseId: state.knownGood.digest, blockers: workBlockers(directory) };
  if (digestJson(inventory(directory)) !== before) throw new Error('Snapshot changed during inspection');
  return result;
}
function writeReceipt(directory: string, value: MigrationReceipt): void {
  const path = join(directory, 'platform-migration.json'), temp = path + '.next';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path); const parent = openSync(directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
}
function readReceipt(directory: string): MigrationReceipt {
  const path = join(directory, 'platform-migration.json'); regular(path);
  if (lstatSync(path).mode & 0o077) throw new Error('Migration receipt must be private');
  return JSON.parse(readFileSync(path, 'utf8')) as MigrationReceipt;
}
async function backupFromArchive(source: string, destination: string): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'palimpsest-migration-backup-')), path = join(scratch, 'copy.sqlite');
  try { copyDatabaseFiles(source, path); const db = new DatabaseSync(path, { readOnly: true }); try { await backup(db, destination); chmodSync(destination, 0o600); } finally { db.close(); } }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}
function historicalManifest(snapshot: string, releaseId: string, repositoryRoot: string): CandidateManifest {
  const manifest = readManifest(join(snapshot, 'releases', releaseId));
  if (manifest.id !== releaseId) throw new Error('Historical custody/manifest identity mismatch');
  const actual = inventory(manifest.candidateRoot);
  const files = actual.filter(entry => entry.kind === 'file').map(entry => ({ path: entry.path, mode: entry.mode & 0o111 ? '100755' : '100644', sha256: entry.sha256, size: entry.size })).sort((a, b) => a.path.localeCompare(b.path));
  if (actual.some(entry => entry.kind === 'link') || digestJson(files) !== manifest.snapshotDigest || digestJson(files) !== digestJson(manifest.files)) throw new Error('Historical source digest mismatch');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 67_108_864 });
  // Retain historical Git objects as integrity evidence, without calling the
  // current-runtime verifier on a Darwin manifest.
  for (const name of readdirSync(join(snapshot, 'releases'))) if (/^[a-f0-9]{64}$/.test(name)) {
    const retained = readManifest(join(snapshot, 'releases', name));
    const rows = git('ls-tree', '-rz', '--full-tree', retained.baseCommit).toString().split('\0').filter(Boolean);
    for (const row of rows) { const blob = row.slice(0, row.indexOf('\t')).split(' ')[2]; if (!blob) throw new Error('Historical Git closure is missing'); git('cat-file', '-e', blob); }
  }
  return manifest;
}

export async function importPlatformSnapshot(options: { repositoryRoot: string; snapshot: string; destination: string; attestation: ShutdownAttestation }): Promise<MigrationReceipt> {
  const repositoryRoot = realpathSync(options.repositoryRoot), snapshot = realpathSync(options.snapshot), destination = resolveExternalPath(repositoryRoot, options.destination);
  if (destination === snapshot || destination.startsWith(snapshot + sep) || snapshot.startsWith(destination + sep)) throw new Error('Migration source and destination must be disjoint');
  const info = inspectMigrationSnapshot(snapshot), a = structuredClone(options.attestation);
  if (!a || a.version !== 1 || a.snapshotDigest !== info.snapshotDigest || !digest(a.evidenceDigest) || a.sourceStopped !== true || a.keepStopped !== true
    || typeof a.sourceHost !== 'string' || !a.sourceHost.trim() || a.sourceHost.length > 256 || !/^[a-z0-9]+$/.test(a.sourcePlatform)
    || !Number.isFinite(Date.parse(a.stoppedAt)) || Date.parse(a.stoppedAt) > Date.now()) throw new Error('Shutdown attestation does not bind this stopped snapshot');
  if (info.blockers.length) throw new Error('Migration held: unfinished or uncertain work requires source-side reconciliation');
  const id = digestJson({ snapshotDigest: info.snapshotDigest, shutdown: a, repositoryRoot, destination, destinationPlatform: `${process.platform}-${process.arch}` });
  if (existsSync(destination)) {
    const prior = readReceipt(destination);
    if (prior.id !== id) throw new Error('Migration destination binding conflict');
    if (!['imported', 'ready'].includes(prior.status)) throw new Error('Partial migration is held; preserve evidence and retry in a fresh destination');
    const lock = new CoordinatorLock(join(destination, 'coordinator.sqlite'));
    try {
      if (prior.status === 'ready') assertPlatformMigrationReady(destination);
      else if (databaseDigest(join(destination, 'state.sqlite')) !== info.operationalDigest) throw new Error('Imported operational state changed before verification');
      if (digestJson(inventory(join(destination, 'migration-archive'))) !== info.snapshotDigest) throw new Error('Preserved migration archive changed');
      const custody = custodySnapshot(destination).state;
      if (custody.platformMigration?.id !== id || custody.knownGood?.digest !== prior.candidateId) throw new Error('Imported custody binding changed');
      verifyFrozenCandidate({ repositoryRoot, releaseDir: join(destination, 'releases', prior.candidateId!) });
      return prior;
    } finally { lock.close(); }
  }
  const old = historicalManifest(snapshot, info.sourceReleaseId, repositoryRoot);
  let receipt: MigrationReceipt = { version: 1, id, status: 'preparing', snapshotDigest: info.snapshotDigest, operationalDigest: info.operationalDigest,
    sourceStateDigest: info.sourceStateDigest, sourceJournalDigest: info.sourceJournalDigest, sourceEpoch: info.sourceEpoch, sourceReleaseId: info.sourceReleaseId,
    repositoryRoot, dataDir: destination, destinationPlatform: `${process.platform}-${process.arch}`, shutdown: a, historicalArtifactsRunnable: false, recoveryEpochs: [] };
  // Publish the directory and its closed gate together. A crash must not leave
  // an empty destination which ordinary CLI startup could treat as a new seed.
  const staging = mkdtempSync(join(dirname(destination), `.${basename(destination)}-migration-`));
  try { writeReceipt(staging, receipt); renameSync(staging, destination); }
  catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
  const lock = new CoordinatorLock(join(destination, 'coordinator.sqlite'));
  try {
    const archive = join(destination, 'migration-archive');
    cpSync(snapshot, archive, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    // Node cp preserves file modes but creates directories with the default mode.
    for (const entry of inventory(snapshot).filter(entry => entry.kind === 'directory')) chmodSync(join(archive, entry.path), entry.mode);
    chmodSync(archive, 0o700);
    if (digestJson(inventory(archive)) !== info.snapshotDigest || digestJson(inventory(snapshot)) !== info.snapshotDigest) throw new Error('Copied archive identity changed');
    await backupFromArchive(join(archive, 'state.sqlite'), join(destination, 'state.sqlite'));
    // Preserve operator/peer authentication identities as opaque private bytes.
    // Provider/Slack credentials remain separately provisioned by the operator.
    for (const name of ['api-token', 'peer-api-token']) if (existsSync(join(archive, name))) {
      const source = join(archive, name); regular(source);
      if ((lstatSync(source).mode & 0o777) !== 0o600) throw new Error('Imported API tokens must have private mode 600');
      copyFileSync(source, join(destination, name)); chmodSync(join(destination, name), 0o600);
    }
    mkdirSync(join(destination, 'custodian'), { mode: 0o700 });
    await backupFromArchive(join(archive, 'custodian/custodian.sqlite'), join(destination, 'custodian/custodian.sqlite'));
    if (databaseDigest(join(destination, 'state.sqlite')) !== info.operationalDigest) throw new Error('Operational database changed during import');
    const checks = [...new Set([...requiredChecks, ...old.requiredChecks])];
    const baseline = freezeBaseline({ repositoryRoot, dataDir: destination, configuration: old.configuration, modelProfile: old.modelProfile, requiredChecks: checks });
    if (baseline.sourceDigest !== old.sourceDigest) throw new Error('Platform baseline must preserve complete admitted cognitive source');
    const evidence = await evaluateCandidate({ repositoryRoot, releaseDir: baseline.releaseDir });
    if (evidence.status !== 'passed' || checks.some(name => !evidence.checks.some(check => check.name === name && check.status === 'passed'))) throw new Error(`Native migration checks failed: ${evidence.checks.filter(check => check.status !== 'passed').map(check => check.name).join(', ')}; evidence ${evidence.evidenceDigest}`);
    const noExecution = async (): Promise<never> => { throw new Error('Offline import cannot execute a generation'); };
    const hooks: CustodianHooks = {
      verifyArtifact: async release => verifyFrozenCandidate({ repositoryRoot, releaseDir: release.artifactPath }).id === baseline.id,
      checkpoint: async () => ({ sequence: 0, snapshot: null, policyVersion: info.operationalDigest, unresolvedEffects: [], quiesced: true }),
      launch: noExecution, stop: noExecution, probe: noExecution, catchUp: noExecution, activate: noExecution,
    };
    const custodian = new Custodian({ storeDir: join(destination, 'custodian'), hooks, requiredChecks: checks });
    try { await custodian.importPlatformBaseline({ id, snapshotDigest: info.snapshotDigest, shutdownEvidenceDigest: digestJson(a), sourceStateDigest: info.sourceStateDigest,
      sourceJournalDigest: info.sourceJournalDigest, sourceStopped: true, candidate: releaseOf(baseline), evidenceDigest: evidence.evidenceDigest,
      destinationPlatform: `${process.platform}-${process.arch}`, checks: evidence.checks.map(check => ({ id: check.name, status: check.status })) }); }
    finally { custodian.close(); }
    if (databaseDigest(join(destination, 'state.sqlite')) !== info.operationalDigest) throw new Error('Migration changed operational state');
    receipt = { ...receipt, status: 'imported', candidateId: baseline.id, evidenceDigest: evidence.evidenceDigest };
    writeReceipt(destination, receipt); return receipt;
  } catch (error) {
    writeReceipt(destination, { ...receipt, status: 'held', reason: error instanceof Error ? error.message : 'Migration failed' }); throw error;
  } finally { lock.close(); }
}

export async function verifyPlatformRecovery(options: { repositoryRoot: string; dataDir: string }): Promise<MigrationReceipt> {
  const repositoryRoot = realpathSync(options.repositoryRoot), dataDir = resolveExternalPath(repositoryRoot, options.dataDir);
  let receipt = readReceipt(dataDir);
  if (receipt.repositoryRoot !== repositoryRoot || receipt.dataDir !== dataDir || receipt.destinationPlatform !== `${process.platform}-${process.arch}`) throw new Error('Migration verification destination binding changed');
  if (receipt.status === 'ready') { assertPlatformMigrationReady(dataDir); return receipt; }
  if (receipt.status !== 'imported' || !digest(receipt.candidateId) || receipt.recoveryEpochs.length) throw new Error('Migration is held or lacks an independently checked native baseline');
  const lock = new CoordinatorLock(join(dataDir, 'coordinator.sqlite'));
  try {
    if (databaseDigest(join(dataDir, 'state.sqlite')) !== receipt.operationalDigest) throw new Error('Operational state changed before migration verification');
    if (digestJson(inventory(join(dataDir, 'migration-archive'))) !== receipt.snapshotDigest) throw new Error('Preserved migration archive changed');
    const manifest = verifyFrozenCandidate({ repositoryRoot, releaseDir: join(dataDir, 'releases', receipt.candidateId) });
    const epochs: number[] = [];
    for (let round = 0; round < 2; round++) {
      const store = new Store(join(dataDir, 'state.sqlite'));
      const host = new GenerationHost({ repositoryRoot, dataDir, store, provider: { name: manifest.modelProfile.provider,
        complete: async () => { throw new Error('Migration verification forbids provider calls'); } }, model: manifest.modelProfile.model,
        communications: [], requiredChecks: manifest.requiredChecks });
      try {
        const before = host.custodian.inspect();
        if (before.knownGood?.digest !== manifest.id || before.platformMigration?.id !== receipt.id) throw new Error('Migration native custody binding changed');
        await host.start(); await host.checkHealth();
        const current = host.custodian.inspect();
        if (current.phase !== 'normal' || current.active?.release.digest !== manifest.id || current.knownGood?.digest !== manifest.id || current.epoch <= before.epoch) throw new Error('Native cold recovery failed');
        epochs.push(current.epoch);
      } finally { await host.close(); store.close(); }
      if (databaseDigest(join(dataDir, 'state.sqlite')) !== receipt.operationalDigest) throw new Error('Native recovery changed operational state');
    }
    receipt = { ...receipt, status: 'ready', recoveryEpochs: epochs }; writeReceipt(dataDir, receipt); return receipt;
  } catch (error) {
    writeReceipt(dataDir, { ...receipt, status: 'held', reason: error instanceof Error ? error.message : 'Native recovery failed' }); throw error;
  } finally { lock.close(); }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inspect' && args.length === 1) console.log(JSON.stringify(inspectMigrationSnapshot(args[0]!), null, 2));
  else if (command === 'import' && args.length === 4) {
    const result = await importPlatformSnapshot({ repositoryRoot: args[0]!, snapshot: args[1]!, destination: args[2]!, attestation: JSON.parse(readFileSync(args[3]!, 'utf8')) });
    console.log(JSON.stringify({ id: result.id, status: result.status, candidateId: result.candidateId }));
  } else if (command === 'verify' && args.length === 2) {
    const result = await verifyPlatformRecovery({ repositoryRoot: args[0]!, dataDir: args[1]! });
    console.log(JSON.stringify({ id: result.id, status: result.status, candidateId: result.candidateId, recoveryEpochs: result.recoveryEpochs }));
  } else throw new Error('Usage: platform-migration.ts inspect <snapshot> | import <repo> <snapshot> <new-data-dir> <shutdown-attestation.json> | verify <repo> <data-dir>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
