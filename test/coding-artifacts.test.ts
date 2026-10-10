import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/store.ts';
import { GenerationHost, releaseOf } from '../src/generations.ts';
import { digestJson, freezeBaseline, freezeCandidate } from '../src/candidates.ts';
import { DirectCommunications } from '../src/communications.ts';
import { CodingWorkspaces, workspaceTreeDigest } from '../src/workspaces.ts';
import type { WorkspaceFileInput, WorkspaceOperation } from '../src/workspaces.ts';
import type { CodingArtifactAuthority } from '../src/coding-artifacts.ts';
import { parseGrowthReflection } from '../src/growth.ts';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const evidence = (name: string, value: unknown) => {
  const directory = process.env.PALIMPSEST_TEST_EVIDENCE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true, mode: 0o700 }); writeFileSync(join(directory, name + '.json'), JSON.stringify(value, null, 2), { mode: 0o600 }); }
};
function removeFixture(directory: string): void {
  const writable = (path: string) => {
    const stat = lstatSync(path); if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) writable(join(path, name)); }
    else chmodSync(path, 0o600);
  };
  writable(directory); rmSync(directory, { recursive: true, force: true });
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-coding-artifacts-'));
  const repositoryRoot = join(directory, 'repo'), dataDir = join(directory, 'state');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), readFileSync(resolve('src/agent/brain.ts')));
  writeFileSync(join(repositoryRoot, 'src/host.ts'), 'export const admitted = true;\n');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic protected contract');
  writeFileSync(join(repositoryRoot, 'empty'), ''); writeFileSync(join(repositoryRoot, 'executable'), 'Synthetic executable\n', { mode: 0o755 });
  writeFileSync(join(repositoryRoot, 'binary'), Buffer.from([0, 255, 1, 128]));
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Synthetic Coding Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-qm', 'admitted source');
  const baseline = freezeBaseline({ repositoryRoot, dataDir, configuration: { maxCalls: 2 }, modelProfile: { provider: 'fixture', model: null } });
  const store = new Store(join(dataDir, 'state.sqlite')); let calls = 0;
  const host = new GenerationHost({ repositoryRoot, dataDir, store, provider: { name: 'fixture', async complete() { calls++; throw new Error('No fixture inference allowed'); } }, model: null,
    communications: [new DirectCommunications()], requiredChecks: ['typecheck', 'trusted-agent-contract'], rpcTimeoutMs: 250 });
  return { directory, repositoryRoot, dataDir, baseline, store, host, calls: () => calls, cleanup: async () => { await host.close(); store.close(); removeFixture(directory); } };
}

test('actual custody-selected full source imports exact admitted non-agent empty executable and binary bytes', { skip: process.platform !== 'darwin' }, async t => {
  const f = fixture(); let workspaces: CodingWorkspaces | undefined;
  try {
    chmodSync(join(f.baseline.candidateRoot, 'src'), 0o755);
    await f.host.start(f.baseline);
    const before = { release: f.baseline.id, files: f.baseline.files, jobs: f.host.candidateJobs.inspect(), active: f.host.custodian.inspect().active };
    t.diagnostic(JSON.stringify({ stage: 'actual-admitted-fixture-ready', release: before.release, files: before.files, jobCount: before.jobs.length }));
    if (process.env.PALIMPSEST_TEST_EVIDENCE_DIR) { mkdirSync(process.env.PALIMPSEST_TEST_EVIDENCE_DIR, { recursive: true, mode: 0o700 }); writeFileSync(join(process.env.PALIMPSEST_TEST_EVIDENCE_DIR, 'actual-import-ready.json'), JSON.stringify(before, null, 2), { mode: 0o600 }); }
    const { importAdmittedCodingSource } = await import('../src/coding-artifacts.ts');
    writeFileSync(join(f.repositoryRoot, 'src/host.ts'), 'Unadmitted checkout content');
    const imported = await importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot });
    assert.equal(imported.base.releaseDigest, f.baseline.id); assert.equal(imported.files.length, f.baseline.files.length);
    assert.equal(Buffer.from(imported.files.find(file => file.path === 'src/host.ts')!.content).toString(), 'export const admitted = true;\n');
    assert.equal(imported.files.find(file => file.path === 'empty')!.content.byteLength, 0);
    assert.equal(imported.files.find(file => file.path === 'executable')!.mode, 0o755);
    assert.deepEqual(Buffer.from(imported.files.find(file => file.path === 'binary')!.content), Buffer.from([0, 255, 1, 128]));
    const task = f.store.enqueue({ conversationId: 'coding:test', source: 'direct', input: 'Use admitted source' }); f.store.claimNext();
    workspaces = new CodingWorkspaces({ store: f.store, directory: join(f.directory, 'workspaces'), repositoryRoot: f.repositoryRoot,
      authorize: grant => grant.taskId === task.id && grant.epoch === f.host.custodian.inspect().epoch, runtime: imported.runtime, runtimeRelease: imported.runtimeRelease });
    const legacy = workspaces.create({ taskId: task.id, epoch: imported.epoch, base: imported.base, files: imported.files });
    assert.notEqual(lstatSync(join(workspaces.path(legacy.id), 'src')).mode & 0o777, 0o755, 'The old files-only import demonstrates the omitted metadata');
    const workspace = workspaces.create({ taskId: task.id, epoch: imported.epoch, base: imported.base, files: imported.files, directories: imported.directories, rootMode: imported.rootMode });
    assert.deepEqual(readFileSync(join(workspaces.path(workspace.id), 'binary')), Buffer.from([0, 255, 1, 128])); assert.equal(f.calls(), 0);
    assert.equal(lstatSync(join(workspaces.path(workspace.id), 'src')).mode & 0o777, 0o755); evidence('exact-source-directory-import', { source: imported, legacyWorkspace: legacy, workspace });
  } finally { await workspaces?.stop(); await f.cleanup(); }
});

async function submissionFixture() {
  const f = fixture(); await f.host.start(f.baseline);
  const task = f.store.enqueue({ conversationId: 'coding:submission', source: 'direct', input: 'Preserve a synthetic full-tree coding draft' }); f.store.claimNext();
  let allowed = true, now = Date.now();
  const authority: CodingArtifactAuthority = { taskId: task.id, sessionId: 'synthetic-session', attemptId: 'synthetic-attempt', epoch: f.host.custodian.inspect().epoch,
    expiresAt: now + 60_000, contractDigest: 'c'.repeat(64) };
  const { CodingArtifacts } = await import('../src/coding-artifacts.ts');
  const options = { host: f.host, store: f.store, repositoryRoot: f.repositoryRoot, directory: join(f.directory, 'artifacts'), authorize: () => allowed, now: () => now };
  const artifacts = new CodingArtifacts(options), source = await artifacts.importSource({ authority });
  const workspaces = new CodingWorkspaces({ store: f.store, directory: join(f.directory, 'workspaces'), repositoryRoot: f.repositoryRoot,
    authorize: grant => allowed && grant.taskId === task.id && grant.epoch === f.host.custodian.inspect().epoch, runtime: source.runtime, runtimeRelease: source.runtimeRelease });
  const workspace = workspaces.create({ taskId: task.id, epoch: authority.epoch, base: source.base, files: source.files, directories: source.directories, rootMode: source.rootMode });
  let effect = 0;
  const perform = async (operation: WorkspaceOperation) => { const result = await workspaces.perform(workspace.id, authority.epoch, `actual-operation-${++effect}`, operation); assert.equal(result.ok, true); return result; };
  const files = (): WorkspaceFileInput[] => source.files.filter(file => existsSync(join(workspaces.path(workspace.id), file.path))).map(file => ({ path: file.path,
    content: readFileSync(join(workspaces.path(workspace.id), file.path)), mode: (lstatSync(join(workspaces.path(workspace.id), file.path)).mode & 0o111 ? 0o755 : 0o644) as 0o644 | 0o755 }));
  const submit = (submissionId: string, expectedTreeDigest = workspaceTreeDigest(files()), signal?: AbortSignal) => artifacts.submit({ authority, workspaces, workspaceId: workspace.id,
    sourceArtifactId: source.sourceArtifactId, expectedTreeDigest, submissionId, signal });
  return { ...f, task, authority, artifacts, options, source, workspaces, workspace, perform, files, submit,
    allow: (value: boolean) => { allowed = value; }, now: (value: number) => { now = value; },
    cleanup: async () => { await workspaces.stop(); await f.cleanup(); } };
}

test('retained admitted baseline is immutable and idempotent across receiver restart, with finalized read authority', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    const { CodingArtifacts } = await import('../src/coding-artifacts.ts');
    writeFileSync(join(f.repositoryRoot, 'src/host.ts'), 'Unadmitted checkout after import');
    const jobs = f.host.candidateJobs.inspect().length, restarted = new CodingArtifacts(f.options);
    const replay = await restarted.importSource({ authority: { ...f.authority, contractDigest: undefined } });
    assert.equal(replay.sourceArtifactId, f.source.sourceArtifactId); assert.deepEqual(replay.base, f.source.base);
    assert.equal(f.host.candidateJobs.inspect().length, jobs); assert.equal(lstatSync(replay.artifactPath).mode & 0o777, 0o400);
    assert.deepEqual(restarted.readBaseFiles({ authority: f.authority, sourceArtifactId: replay.sourceArtifactId }), f.source.files);
    assert.deepEqual(restarted.readBaseTree({ authority: f.authority, sourceArtifactId: replay.sourceArtifactId }), { files: f.source.files, directories: f.source.directories, rootMode: f.source.rootMode });
    assert.throws(() => restarted.readBaseFiles({ authority: { ...f.authority, contractDigest: '' }, sourceArtifactId: replay.sourceArtifactId }), /authority/i);
    assert.throws(() => restarted.readBaseFiles({ authority: { ...f.authority, attemptId: 'foreign-attempt' }, sourceArtifactId: replay.sourceArtifactId }), /provenance/i);
    const bytes = readFileSync(replay.artifactPath); chmodSync(replay.artifactPath, 0o600); writeFileSync(replay.artifactPath, Buffer.concat([bytes, Buffer.from(' ')])); chmodSync(replay.artifactPath, 0o400);
    // Formatting alone keeps the canonical identity, but tampered source bytes do not.
    const corrupted = JSON.parse(bytes.toString()); corrupted.files[0].base64 = Buffer.from('changed').toString('base64');
    chmodSync(replay.artifactPath, 0o600); writeFileSync(replay.artifactPath, JSON.stringify(corrupted)); chmodSync(replay.artifactPath, 0o400);
    assert.throws(() => restarted.readBaseFiles({ authority: f.authority, sourceArtifactId: replay.sourceArtifactId }), /changed/i);
    assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

test('actual full-tree submission preserves additions deletions modes binaries and empty directories with durable exact receipt', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    await f.perform({ kind: 'replace', path: 'src/host.ts', expected: { sha256: sha('export const admitted = true;\n'), mode: 0o644 }, content: 'export const authored = true;\n', mode: 0o755 });
    await f.perform({ kind: 'delete', path: 'empty', expected: { sha256: sha(''), mode: 0o644 } });
    await f.perform({ kind: 'create', path: 'new-nonagent.txt', content: '', mode: 0o755 });
    await f.perform({ kind: 'mkdir', path: 'retained-empty-directory' });
    const command = await f.workspaces.runCommand(f.workspace.id, f.authority.epoch, 'actual-before-submit-command', { tool: 'node', args: ['--check', 'src/host.ts'] });
    assert.equal(command.exitSuccessful, true); assert.equal(command.workspaceUsable, true);
    const expected = workspaceTreeDigest([...f.files(), { path: 'new-nonagent.txt', content: Buffer.alloc(0), mode: 0o755 }]);
    const pending = f.submit('broader-submission', expected); pending.catch(() => {});
    await assert.rejects(f.submit('broader-submission', expected), /already running/i);
    const receipt = await pending, savedBytes = readFileSync(receipt.artifactPath), artifact = JSON.parse(savedBytes.toString());
    assert.equal(receipt.disposition, 'awaiting_supported_admission'); assert.equal(receipt.cognitiveBridge, undefined);
    assert.deepEqual(receipt.changes.map(change => [change.path, change.kind]), [['empty', 'deleted'], ['new-nonagent.txt', 'added'], ['src/host.ts', 'modified']]);
    assert.equal(receipt.changes.find(change => change.path === 'src/host.ts')?.after?.mode, 0o755);
    assert.equal(artifact.version, 'coding-submission/1'); assert.equal(digestJson(artifact), receipt.id);
    assert.equal(artifact.treeDigest, expected); assert.equal(artifact.fullTreeDigest, receipt.fullTreeDigest);
    assert.deepEqual(Buffer.from(artifact.files.find((file: { path: string }) => file.path === 'binary').base64, 'base64'), Buffer.from([0, 255, 1, 128]));
    assert.equal(artifact.files.find((file: { path: string }) => file.path === 'new-nonagent.txt').bytes, 0);
    assert.ok(artifact.directories.some((directory: { path: string }) => directory.path === 'retained-empty-directory'));
    assert.deepEqual(artifact.originalBase, f.source.base); assert.deepEqual(artifact.currentBase, f.source.base);
    assert.deepEqual(artifact.provenance, { source: 'direct', conversationId: f.task.conversationId }); assert.equal(artifact.authority.contractDigest, f.authority.contractDigest);
    assert.deepEqual(artifact.commandReceipts, [{ effectId: 'actual-before-submit-command', resultDigest: digestJson(f.store.effect('actual-before-submit-command')!.result), outcome: f.store.effect('actual-before-submit-command')!.result }]);
    assert.equal(f.store.effect('broader-submission:manifest')?.state, 'completed');
    const otherStore = new Store(join(f.dataDir, 'state.sqlite'));
    try {
      const { CodingArtifacts } = await import('../src/coding-artifacts.ts');
      const restarted = new CodingArtifacts({ ...f.options, store: otherStore });
      assert.deepEqual(restarted.submissionReceipt('broader-submission'), receipt);
      await f.perform({ kind: 'replace', path: 'src/host.ts', expected: { sha256: sha('export const authored = true;\n'), mode: 0o755 }, content: 'Later revision\n', mode: 0o755 });
      const jobs = f.host.candidateJobs.inspect().length;
      assert.deepEqual(await restarted.submit({ authority: f.authority, workspaces: f.workspaces, workspaceId: f.workspace.id, sourceArtifactId: f.source.sourceArtifactId,
        expectedTreeDigest: expected, submissionId: 'broader-submission' }), receipt);
      assert.equal(f.host.candidateJobs.inspect().length, jobs); assert.deepEqual(readFileSync(receipt.artifactPath), savedBytes);
      await assert.rejects(f.submit('broader-submission', workspaceTreeDigest(f.files())), /identity conflict/i);
      assert.equal(otherStore.listEvents({ taskId: f.task.id }).filter(event => event.type === 'coding.submission.registered').length, 1);
    } finally { otherStore.close(); }
    assert.equal(existsSync(join(f.workspaces.controlPath(f.workspace.id), 'writer.json')), false); evidence('broader-submission', { receipt, artifact, manifestEffect: f.store.effect('broader-submission:manifest'), jobs: f.host.candidateJobs.inspect() });
    assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

test('only lossless direct cognitive modifications and additions produce an exact existing-route bridge', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    const original = Buffer.from(f.source.files.find(file => file.path === 'src/agent/brain.ts')!.content).toString(), authored = original + '\n// Synthetic coding bridge\n';
    await f.perform({ kind: 'replace', path: 'src/agent/brain.ts', expected: { sha256: sha(original), mode: 0o644 }, content: authored, mode: 0o644 });
    await f.perform({ kind: 'create', path: 'src/agent/new.ts', content: 'export const synthetic = true;\n', mode: 0o644 });
    const expectedFiles: WorkspaceFileInput[] = [...f.files(), { path: 'src/agent/new.ts', content: Buffer.from('export const synthetic = true;\n'), mode: 0o644 }];
    const receipt = await f.submit('cognitive-submission', workspaceTreeDigest(expectedFiles));
    assert.equal(receipt.disposition, 'cognitive_compatible'); assert.deepEqual(receipt.cognitiveBridge?.sourceBinding, { version: 1, releaseDigest: f.source.base.releaseDigest,
      sourceDigest: f.source.manifest.sourceDigest, baseCommit: f.source.base.baseCommit });
    assert.deepEqual(receipt.cognitiveBridge?.changes, [{ path: 'src/agent/brain.ts', content: authored }, { path: 'src/agent/new.ts', content: 'export const synthetic = true;\n' }]);
    const frozen = freezeCandidate({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: f.source.configuration, modelProfile: f.source.modelProfile, changes: receipt.cognitiveBridge!.changes });
    const frozenFiles = frozen.files.map(file => ({ path: file.path, content: readFileSync(join(frozen.candidateRoot, file.path)), mode: (file.mode === '100755' ? 0o755 : 0o644) as 0o644 | 0o755 }));
    assert.equal(workspaceTreeDigest(frozenFiles), receipt.treeDigest, 'Existing freezer exactly represents the complete submitted file tree');
    assert.equal(frozen.snapshotDigest, digestJson(frozen.files)); assert.notEqual(receipt.treeDigest, frozen.snapshotDigest);
    evidence('cognitive-submission', { receipt, frozen, actualManifestEffect: f.store.effect('cognitive-submission:manifest'), jobs: f.host.candidateJobs.inspect() }); assert.equal(f.calls(), 0);
    await f.perform({ kind: 'mkdir', path: 'unsupported-empty-directory' });
    const directoryChange = await f.submit('cognitive-plus-directory', workspaceTreeDigest(expectedFiles));
    assert.equal(directoryChange.disposition, 'awaiting_supported_admission'); assert.equal(directoryChange.cognitiveBridge, undefined);
    await f.perform({ kind: 'rmdir', path: 'unsupported-empty-directory' });
    writeFileSync(join(f.repositoryRoot, 'docs/seed-contract.md'), 'Current checkout content must not graft into historical drafting base');
    execFileSync('/usr/bin/git', ['add', '.'], { cwd: f.repositoryRoot, stdio: 'ignore' }); execFileSync('/usr/bin/git', ['commit', '-qm', 'Synthetic changed checkout revision'], { cwd: f.repositoryRoot, stdio: 'ignore' });
    const revisionChanged = await f.submit('checkout-revision-changed', workspaceTreeDigest(expectedFiles));
    assert.equal(revisionChanged.disposition, 'awaiting_supported_admission'); assert.equal(revisionChanged.cognitiveBridge, undefined);
    const retained = JSON.parse(readFileSync(revisionChanged.artifactPath, 'utf8'));
    assert.equal(Buffer.from(retained.files.find((file: { path: string }) => file.path === 'docs/seed-contract.md').base64, 'base64').toString(), 'Synthetic protected contract');
  } finally { await f.cleanup(); }
});

test('cognitive deletions executable modes and invalid UTF8 remain full preserved unsupported submissions', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    const file = f.source.files.find(file => file.path === 'src/agent/brain.ts')!, original = Buffer.from(file.content).toString();
    await f.perform({ kind: 'delete', path: file.path, expected: { sha256: sha(file.content), mode: 0o644 } });
    const deleted = await f.submit('deleted-cognitive-file'); assert.equal(deleted.disposition, 'awaiting_supported_admission');
    assert.equal(deleted.changes.find(change => change.path === file.path)?.kind, 'deleted');
    await f.perform({ kind: 'create', path: file.path, content: original, mode: 0o755 });
    const executable = await f.submit('executable-cognitive-file'); assert.equal(executable.disposition, 'awaiting_supported_admission');
    assert.equal(executable.changes.find(change => change.path === file.path)?.after?.mode, 0o755);
    const location = join(f.workspaces.path(f.workspace.id), file.path); chmodSync(location, 0o644); writeFileSync(location, Buffer.from([255, 0, 128]));
    const binary = await f.submit('binary-cognitive-file'); assert.equal(binary.disposition, 'awaiting_supported_admission'); assert.equal(binary.cognitiveBridge, undefined);
    const artifact = JSON.parse(readFileSync(binary.artifactPath, 'utf8'));
    assert.deepEqual(Buffer.from(artifact.files.find((saved: { path: string }) => saved.path === file.path).base64, 'base64'), Buffer.from([255, 0, 128]));
    writeFileSync(location, original);
    await f.perform({ kind: 'create', path: 'src/agent/empty.ts', content: '', mode: 0o644 });
    const emptyFiles: WorkspaceFileInput[] = [...f.files(), { path: 'src/agent/empty.ts', content: Buffer.alloc(0), mode: 0o644 }];
    const empty = await f.submit('empty-cognitive-file', workspaceTreeDigest(emptyFiles)); assert.equal(empty.disposition, 'awaiting_supported_admission'); assert.equal(empty.cognitiveBridge, undefined);
    evidence('unsupported-cognitive-changes', { deleted, executable, binary }); assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

test('submission signal positively cancels and drains an actually stopped confined helper before returning', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture(), controller = new AbortController(), perform = f.workspaces.perform.bind(f.workspaces); let helperPid: number | undefined;
  try {
    f.workspaces.perform = async (...args: Parameters<typeof f.workspaces.perform>) => {
      const pending = perform(...args); pending.catch(() => {});
      if (args[2] === 'owned-stop:manifest') {
        await new Promise(resolve => setImmediate(resolve));
        const claim = JSON.parse(readFileSync(join(f.workspaces.controlPath(f.workspace.id), 'writer.json'), 'utf8'));
        assert.ok(claim.pid > 0); helperPid = claim.pid; process.kill(claim.pid, 'SIGSTOP'); controller.abort(new Error('Synthetic owned helper stop'));
      }
      return await pending;
    };
    await assert.rejects(f.submit('owned-stop', undefined, controller.signal), /stop|aborted|interrupted|helper failed/i);
    assert.ok(helperPid); assert.throws(() => process.kill(helperPid!, 0), { code: 'ESRCH' });
    assert.equal(existsSync(join(f.workspaces.controlPath(f.workspace.id), 'writer.json')), false); assert.equal(f.artifacts.submissionReceipt('owned-stop'), undefined);
    const effect = f.store.effect('owned-stop:manifest'); assert.equal(effect?.state, 'unknown');
    assert.equal((await f.workspaces.reconcile(f.workspace.id, f.authority.epoch, 'owned-stop:manifest')).status, 'not-staged');
    evidence('owned-submission-stop', { helperPid, interruptedEffect: effect, reconciledEffect: f.store.effect('owned-stop:manifest'), jobs: f.host.candidateJobs.inspect() }); assert.equal(f.calls(), 0);
  } finally { if (helperPid) { try { process.kill(helperPid, 'SIGCONT'); } catch {} } await f.cleanup(); }
});

test('actual manifest plus independent bytes refuse digest mismatch symlink and unproven writer/effect without submission', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    await assert.rejects(f.submit('wrong-digest', '0'.repeat(64)), /expected tree/i); assert.equal(f.artifacts.submissionReceipt('wrong-digest'), undefined);
    const claimPath = join(f.workspaces.controlPath(f.workspace.id), 'writer.json'), claim = JSON.stringify({ version: 1, operationId: 'unknown', pid: null });
    writeFileSync(claimPath, claim, { mode: 0o600 }); const beforeJobs = f.host.candidateJobs.inspect().length;
    await assert.rejects(f.submit('unknown-writer'), /quiescence/i); assert.equal(readFileSync(claimPath, 'utf8'), claim); assert.equal(f.host.candidateJobs.inspect().length, beforeJobs); unlinkSync(claimPath);
    f.store.reserveEffect({ id: 'unresolved', taskId: f.task.id, kind: 'workspace.files', payload: { workspaceId: f.workspace.id } });
    await assert.rejects(f.submit('unknown-effect'), /reconciled effects/i); assert.equal(f.artifacts.submissionReceipt('unknown-effect'), undefined);
    f.store.completeEffect('unresolved', { ok: false, code: 'not_applied' });
    const binary = join(f.workspaces.path(f.workspace.id), 'binary'); unlinkSync(binary); symlinkSync(join(f.repositoryRoot, 'binary'), binary);
    await assert.rejects(f.submit('linked-tree', workspaceTreeDigest(f.source.files)), /manifest|source|symbolic|symlink|linked/i);
    assert.equal(f.artifacts.submissionReceipt('linked-tree'), undefined); assert.equal(f.store.listEvents({ taskId: f.task.id }).filter(event => event.type === 'coding.submission.registered').length, 0);
    evidence('refused-submissions', { effects: f.store.listEffects(f.task.id), jobs: f.host.candidateJobs.inspect() });
  } finally { await f.cleanup(); }
});

test('actual collector late expiry revocation and cancellation veto source and submission, with no durable admission', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  const collect = f.host.collectCandidate.bind(f.host); let afterVerification = () => {};
  f.host.collectCandidate = (async (...args: Parameters<typeof f.host.collectCandidate>) => { const result = await collect(...args); afterVerification(); return result; }) as typeof f.host.collectCandidate;
  try {
    const { importAdmittedCodingSource } = await import('../src/coding-artifacts.ts');
    const pendingAuthority = { ...f.authority, sessionId: 'interrupted-import-session' }, pendingController = new AbortController();
    afterVerification = () => pendingController.abort(new Error('Synthetic initial import stopped'));
    await assert.rejects(f.artifacts.importSource({ authority: pendingAuthority, signal: pendingController.signal }), /initial import stopped/i);
    assert.equal(f.store.listEvents({ taskId: f.task.id }).filter(event => event.type === 'coding.source.import.intent' && (event.payload as { sessionId?: string }).sessionId === pendingAuthority.sessionId).length, 1);
    afterVerification = () => {};
    const retry = await f.artifacts.importSource({ authority: pendingAuthority }); assert.deepEqual(retry.base, f.source.base);
    assert.equal(f.store.listEvents({ taskId: f.task.id }).filter(event => event.type === 'coding.source.imported' && (event.payload as { sessionId?: string }).sessionId === pendingAuthority.sessionId).length, 1);
    const controller = new AbortController(); afterVerification = () => controller.abort(new Error('Synthetic source stop after actual verification'));
    await assert.rejects(importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot, signal: controller.signal }), /source stop/i);
    afterVerification = () => f.now(f.authority.expiresAt);
    await assert.rejects(f.submit('late-expiry'), /expired/i); assert.equal(f.artifacts.submissionReceipt('late-expiry'), undefined);
    f.now(f.authority.expiresAt - 1); afterVerification = () => f.allow(false);
    await assert.rejects(f.submit('late-revoke'), /revoked/i); assert.equal(f.store.effect('late-revoke:manifest'), undefined);
    f.allow(true); const aborted = new AbortController(); afterVerification = () => aborted.abort(new Error('Synthetic submission stop after actual verification'));
    await assert.rejects(f.submit('late-stop', undefined, aborted.signal), /submission stop/i); assert.equal(f.store.effect('late-stop:manifest'), undefined);
    afterVerification = () => {}; const originalPerform = f.workspaces.perform.bind(f.workspaces);
    f.workspaces.perform = async (...args: Parameters<typeof f.workspaces.perform>) => { const result = await originalPerform(...args); f.now(f.authority.expiresAt); return result; };
    await assert.rejects(f.submit('late-manifest-expiry'), /expired/i); assert.equal(f.store.effect('late-manifest-expiry:manifest')?.state, 'completed');
    assert.equal(f.artifacts.submissionReceipt('late-manifest-expiry'), undefined); assert.equal(existsSync(join(f.workspaces.controlPath(f.workspace.id), 'writer.json')), false);
    assert.equal(f.store.listEvents({ taskId: f.task.id }).filter(event => event.type === 'coding.submission.registered').length, 0); evidence('late-vetoes', { effects: f.store.listEffects(f.task.id), jobs: f.host.candidateJobs.inspect() });
  } finally { await f.cleanup(); }
});

test('independent post-verifier scan refuses byte mode and manifest link changes after real verification', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); await f.host.start(f.baseline);
  const collect = f.host.collectCandidate.bind(f.host); let afterVerification = () => {};
  f.host.collectCandidate = (async (...args: Parameters<typeof f.host.collectCandidate>) => { const result = await collect(...args); afterVerification(); return result; }) as typeof f.host.collectCandidate;
  try {
    const { importAdmittedCodingSource } = await import('../src/coding-artifacts.ts'), location = join(f.baseline.candidateRoot, 'src/host.ts'), original = readFileSync(location);
    afterVerification = () => { chmodSync(location, 0o600); writeFileSync(location, 'Tampered after actual verification'); chmodSync(location, 0o400); };
    await assert.rejects(importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot }), /changed after verification/i);
    chmodSync(location, 0o600); writeFileSync(location, original); chmodSync(location, 0o400);
    afterVerification = () => chmodSync(location, 0o500);
    await assert.rejects(importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot }), /changed after verification/i); chmodSync(location, 0o400);
    const manifestPath = join(f.baseline.releaseDir, 'manifest.json'), manifestBytes = readFileSync(manifestPath), linkedManifest = join(f.directory, 'linked-manifest.json'); writeFileSync(linkedManifest, manifestBytes, { mode: 0o400 });
    afterVerification = () => { unlinkSync(manifestPath); symlinkSync(linkedManifest, manifestPath); };
    await assert.rejects(importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot }), /coding source|candidate manifest|changed after verification/i);
    afterVerification = () => {}; unlinkSync(manifestPath); writeFileSync(manifestPath, manifestBytes, { mode: 0o400 });
    const commit = f.baseline.baseCommit; unlinkSync(join(f.repositoryRoot, '.git/objects', commit.slice(0, 2), commit.slice(2)));
    await assert.rejects(importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot }), /base|git|candidate|collector/i);
    assert.equal(f.calls(), 0); evidence('post-verifier-refusals', { jobs: f.host.candidateJobs.inspect(), active: f.host.custodian.inspect().active });
  } finally { await f.cleanup(); }
});

test('renewed epoch over a real changed serving base preserves historical draft and refuses compatible relabeling', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    const original = Buffer.from(f.source.files.find(file => file.path === 'src/agent/brain.ts')!.content).toString();
    await f.perform({ kind: 'replace', path: 'src/agent/brain.ts', expected: { sha256: sha(original), mode: 0o644 }, content: original + '\n// Historical authored draft\n', mode: 0o644 });
    const pendingAuthority = { ...f.authority, sessionId: 'unfinished-original-base-import' }, controller = new AbortController(), collect = f.host.collectCandidate.bind(f.host);
    f.host.collectCandidate = (async (...args: Parameters<typeof f.host.collectCandidate>) => { const result = await collect(...args); controller.abort(new Error('Synthetic interrupted source intent')); return result; }) as typeof f.host.collectCandidate;
    await assert.rejects(f.artifacts.importSource({ authority: pendingAuthority, signal: controller.signal }), /interrupted source intent/i); f.host.collectCandidate = collect;
    const candidate = freezeCandidate({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: f.source.configuration, modelProfile: f.source.modelProfile,
      changes: [{ path: 'src/agent/brain.ts', content: original + '\n// Independently serving changed base\n' }] });
    const custodian = f.host.custodian, actor = f.host.actor, proposal = await custodian.propose(actor, releaseOf(candidate));
    // Synthetic cognitive envelopes only drive the established mechanical
    // transfer. They are not evaluator passes, model review, or release evidence.
    custodian.recordEvidence(proposal.id, { candidateDigest: candidate.manifestDigest, evidenceDigest: 'e'.repeat(64),
      checks: f.host.requiredChecks.map(id => ({ id, status: 'pass', evidenceDigest: 'd'.repeat(64) })),
      review: { candidateDigest: candidate.manifestDigest, evidenceDigest: 'e'.repeat(64), status: 'pass', contextDigest: 'f'.repeat(64) } });
    const question = custodian.ask(actor, proposal.id, 'Synthetic mechanical base-change fixture?');
    custodian.answer(proposal.successor, proposal.id, question.id, 'Retain the historical draft and current journal.');
    const snapshot = custodian.snapshot(actor, proposal.id), binding = { candidateDigest: candidate.manifestDigest, evidenceDigest: 'e'.repeat(64), snapshotDigest: snapshot.digest, policyVersion: snapshot.policyVersion };
    custodian.verdict(actor, proposal.id, { ...binding, decision: 'accept', reason: 'Synthetic envelope for mechanical base-change protection only' }); custodian.ready(proposal.successor, proposal.id, binding);
    await f.host.custodyOperation(() => custodian.requestCutover(actor, proposal.id));
    const renewed = custodian.inspect().epoch; assert.ok(renewed > f.authority.epoch);
    assert.throws(() => f.artifacts.readBaseFiles({ authority: f.authority, sourceArtifactId: f.source.sourceArtifactId }), /authority/i);
    f.authority.epoch = renewed;
    // The real checkpoint returned interrupted ordinary work to pending.
    // Resume that same task before renewing its fixture session authority.
    assert.equal(f.store.claimNext()?.id, f.task.id);
    f.workspaces.adopt(f.workspace.id, renewed);
    pendingAuthority.epoch = renewed;
    await assert.rejects(f.artifacts.importSource({ authority: pendingAuthority }), /original coding import source is unavailable/i);
    const replay = await f.artifacts.importSource({ authority: f.authority });
    assert.equal(replay.sourceArtifactId, f.source.sourceArtifactId); assert.equal(replay.base.releaseDigest, f.baseline.manifestDigest);
    const receipt = await f.submit('changed-base-submission');
    assert.equal(receipt.disposition, 'awaiting_supported_admission'); assert.equal(receipt.reason, 'base_changed_reconciliation_required'); assert.equal(receipt.cognitiveBridge, undefined);
    assert.deepEqual(receipt.originalBase, f.source.base); assert.equal(receipt.currentBase.releaseDigest, candidate.manifestDigest); assert.notEqual(receipt.originalBase.treeDigest, receipt.currentBase.treeDigest);
    assert.equal(readFileSync(join(f.workspaces.path(f.workspace.id), 'src/agent/brain.ts'), 'utf8'), original + '\n// Historical authored draft\n');
    evidence('changed-base-preserved-draft', { receipt, candidate, jobs: f.host.candidateJobs.inspect(), custody: custodian.journal(), syntheticCognitiveEnvelopes: true }); assert.equal(f.calls(), 0);
    // A new session drafts from that actual cognitive successor. Its unchanged
    // inherited brain edit still differs from Git HEAD and must survive the
    // legacy freezer when this session authors a different file.
    const currentAuthority = { ...f.authority, sessionId: 'successor-source-session' }, currentSource = await f.artifacts.importSource({ authority: currentAuthority });
    const currentWorkspace = f.workspaces.create({ taskId: f.task.id, epoch: renewed, base: currentSource.base, files: currentSource.files, directories: currentSource.directories, rootMode: currentSource.rootMode });
    const addition = { path: 'src/agent/inherited.ts', content: Buffer.from('export const inheritedDraft = true;\n'), mode: 0o644 as const };
    assert.equal((await f.workspaces.perform(currentWorkspace.id, renewed, 'actual-inherited-addition', { kind: 'create', path: addition.path, content: Buffer.from(addition.content).toString(), mode: addition.mode })).ok, true);
    const complete = [...currentSource.files, addition], currentReceipt = await f.artifacts.submit({ authority: currentAuthority, workspaces: f.workspaces, workspaceId: currentWorkspace.id,
      sourceArtifactId: currentSource.sourceArtifactId, expectedTreeDigest: workspaceTreeDigest(complete), submissionId: 'inherited-cognitive-submission' });
    assert.equal(currentReceipt.disposition, 'cognitive_compatible'); assert.deepEqual(currentReceipt.changes.map(change => change.path), [addition.path]);
    assert.deepEqual(currentReceipt.cognitiveBridge?.changes.map(change => change.path), ['src/agent/brain.ts', addition.path]);
    const diffOnly = freezeCandidate({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: currentSource.configuration, modelProfile: currentSource.modelProfile,
      changes: [{ path: addition.path, content: Buffer.from(addition.content).toString() }] });
    const completeDigest = (manifest: typeof diffOnly) => workspaceTreeDigest(manifest.files.map(file => ({ path: file.path, content: readFileSync(join(manifest.candidateRoot, file.path)), mode: (file.mode === '100755' ? 0o755 : 0o644) as 0o644 | 0o755 })));
    assert.notEqual(completeDigest(diffOnly), currentReceipt.treeDigest, 'Actual former diff-only mechanism loses inherited serving edits');
    const represented = freezeCandidate({ repositoryRoot: f.repositoryRoot, dataDir: f.dataDir, configuration: currentSource.configuration, modelProfile: currentSource.modelProfile, changes: currentReceipt.cognitiveBridge!.changes });
    assert.equal(completeDigest(represented), currentReceipt.treeDigest);
    evidence('inherited-cognitive-fulltree-bridge', { receipt: currentReceipt, diffOnly, represented, jobs: f.host.candidateJobs.inspect(), syntheticMechanicalTransfer: true });
  } finally { await f.cleanup(); }
});

test('actual recovery fencing after collector completion vetoes the old selected source result', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); await f.host.start(f.baseline); const epoch = f.host.custodian.inspect().epoch, collect = f.host.collectCandidate.bind(f.host); let recovered = false;
  f.host.collectCandidate = (async (...args: Parameters<typeof f.host.collectCandidate>) => {
    const result = await collect(...args);
    if (!recovered) { recovered = true; await f.host.custodyOperation(() => f.host.custodian.recover()); }
    return result;
  }) as typeof f.host.collectCandidate;
  try {
    const { importAdmittedCodingSource } = await import('../src/coding-artifacts.ts');
    await assert.rejects(importAdmittedCodingSource({ host: f.host, repositoryRoot: f.repositoryRoot }), /serving authority changed/i);
    assert.ok(f.host.custodian.inspect().epoch > epoch); assert.equal(f.host.custodian.inspect().active?.release.digest, f.baseline.manifestDigest);
    evidence('late-actual-epoch-veto', { previousEpoch: epoch, current: f.host.custodian.inspect(), jobs: f.host.candidateJobs.inspect(), custody: f.host.custodian.journal() }); assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

test('real manifest result cannot race workspace changes into an immutable submission', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture(); const perform = f.workspaces.perform.bind(f.workspaces);
  try {
    f.workspaces.perform = async (...args: Parameters<typeof f.workspaces.perform>) => {
      const result = await perform(...args); if (args[2] === 'raced-submission:manifest') writeFileSync(join(f.workspaces.path(f.workspace.id), 'src/host.ts'), 'Synthetic mutation after actual manifest'); return result;
    };
    await assert.rejects(f.submit('raced-submission'), /stable bytes mismatch/i);
    assert.equal(f.artifacts.submissionReceipt('raced-submission'), undefined); assert.equal(f.store.effect('raced-submission:manifest')?.state, 'completed');
    assert.equal(existsSync(join(f.workspaces.controlPath(f.workspace.id), 'writer.json')), false); assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});

test('exact preserved submissions exceeding actual legacy parser file content or path limits do not receive a compatible bridge', { skip: process.platform !== 'darwin' }, async () => {
  const f = await submissionFixture();
  try {
    const reflection = (files: { path: string; content: string }[]) => JSON.stringify({ observation: 'Synthetic artifact format probe.', lesson: 'Keep exact broader submissions.', nextQuestion: 'Await supported admission.',
      proposedChange: { summary: 'Synthetic format limit', rationale: 'Exercise the actual unchanged consumer.', acceptanceCriteria: ['Retain exact full tree.'], files } });
    const additions = Array.from({ length: 11 }, (_, i) => ({ path: `src/agent/limit-${i}.ts`, content: Buffer.from(`export const item${i} = true;\n`), mode: 0o644 as const }));
    for (const file of additions) writeFileSync(join(f.workspaces.path(f.workspace.id), file.path), file.content, { mode: file.mode });
    const many = await f.submit('eleven-cognitive-files', workspaceTreeDigest([...f.files(), ...additions]));
    assert.equal(many.disposition, 'awaiting_supported_admission'); assert.equal(many.reason, 'legacy_cognitive_format_limits_require_supported_admission'); assert.equal(many.changes.length, 11);
    assert.equal(many.cognitiveBridge, undefined); assert.throws(() => parseGrowthReflection(reflection(additions.map(file => ({ path: file.path, content: Buffer.from(file.content).toString() })))), /proposed files/i);
    const manyArtifact = JSON.parse(readFileSync(many.artifactPath, 'utf8')); assert.equal(manyArtifact.files.length, f.source.files.length + 11);
    for (const file of additions) unlinkSync(join(f.workspaces.path(f.workspace.id), file.path));
    const oversized = { path: 'src/agent/large.ts', content: Buffer.from('x'.repeat(100_001)), mode: 0o644 as const };
    writeFileSync(join(f.workspaces.path(f.workspace.id), oversized.path), oversized.content, { mode: oversized.mode });
    const large = await f.submit('long-cognitive-content', workspaceTreeDigest([...f.files(), oversized]));
    assert.equal(large.disposition, 'awaiting_supported_admission'); assert.equal(large.reason, 'legacy_cognitive_format_limits_require_supported_admission'); assert.equal(large.cognitiveBridge, undefined);
    assert.throws(() => parseGrowthReflection(reflection([{ path: oversized.path, content: Buffer.from(oversized.content).toString() }])), /proposed content/i);
    const largeArtifact = JSON.parse(readFileSync(large.artifactPath, 'utf8')); assert.equal(largeArtifact.files.find((file: { path: string }) => file.path === oversized.path).bytes, 100_001);
    unlinkSync(join(f.workspaces.path(f.workspace.id), oversized.path));
    const longPath = 'src/agent/' + 'p'.repeat(236) + '.ts', pathFile = { path: longPath, content: Buffer.from('export const longPath = true;\n'), mode: 0o644 as const };
    writeFileSync(join(f.workspaces.path(f.workspace.id), longPath), pathFile.content, { mode: pathFile.mode });
    const path = await f.submit('long-cognitive-path', workspaceTreeDigest([...f.files(), pathFile]));
    assert.equal(path.disposition, 'awaiting_supported_admission'); assert.equal(path.reason, 'legacy_cognitive_format_limits_require_supported_admission');
    assert.throws(() => parseGrowthReflection(reflection([{ path: longPath, content: Buffer.from(pathFile.content).toString() }])), /Invalid text/i);
    evidence('legacy-format-limit-preservation', { many, manyArtifact, large, largeArtifact, path, jobs: f.host.candidateJobs.inspect() }); assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});
