import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Custodian, digestCustodianValue } from '../src/custodian.ts';
import type { CustodianHooks } from '../src/custodian.ts';
import { digestJson, freezeBaseline } from '../src/candidates.ts';
import { Store } from '../src/store.ts';
import { assertPlatformMigrationReady } from '../src/platform-migration-gate.ts';
import { inspectMigrationSnapshot, importPlatformSnapshot, verifyPlatformRecovery, databaseDigest } from '../scripts/platform-migration.ts';

async function fixture(t: { after(fn: () => unknown): void }, badBrain = false) {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-platform-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, 'repository'), snapshot = join(root, 'snapshot'), destination = join(root, 'destination');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs')); mkdirSync(snapshot, { mode: 0o700 });
  for (const file of readdirSync(resolve('src/agent'))) copyFileSync(resolve('src/agent', file), join(repositoryRoot, 'src/agent', file));
  const brainPath = join(repositoryRoot, 'src/agent/brain.ts');
  writeFileSync(brainPath, readFileSync(brainPath, 'utf8').replace(/^import type .*;\n/gm, '')
    .replace('task: Task, memories: Memory[]', 'task: any, memories: any[]').replace('): CompletionRequest', '): any'));
  if (badBrain) writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest() { return { system: "fixture", prompt: "wrong", maxOutputTokens: 2 }; }');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic migration contract');
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Migration Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'synthetic source');
  const original = freezeBaseline({ repositoryRoot, dataDir: snapshot, configuration: { maxCallsPerTask: 2 }, modelProfile: { provider: 'fixture', model: null }, requiredChecks: ['typecheck', 'trusted-agent-contract', 'cross-scope-memory'] });
  // Explicit synthetic historical platform identity; never tested as a runnable release.
  const path = join(original.releaseDir, 'manifest.json');
  const old = JSON.parse(readFileSync(path, 'utf8')); old.runtime.compilerPath = '/synthetic/darwin/tsc'; old.runtime.nodeSha256 = 'd'.repeat(64);
  const { id: _id, manifestDigest: _digest, ...body } = old; old.id = old.manifestDigest = digestJson(body);
  chmodSync(path, 0o600); writeFileSync(path, JSON.stringify(old));
  const { renameSync } = await import('node:fs'); renameSync(original.releaseDir, join(snapshot, 'releases', old.id));
  const store = new Store(join(snapshot, 'state.sqlite'));
  const task = store.enqueue({ id: 'synthetic-task', conversationId: 'slack:T:C:1', source: 'slack', eventId: 'synthetic-event', input: 'Synthetic unfinished decision' });
  store.updateTask(task.id, { state: 'running', checkpoint: { calls: 1 } });
  store.reserveEffect({ id: 'known-delivery', taskId: task.id, kind: 'send', payload: { text: 'Synthetic answer' } });
  store.completeEffect('known-delivery', { receipt: 'synthetic-receipt' });
  store.prepareConversationTopics(task.id, [{ outcome: { question: 'Synthetic question', stance: 'Still considering', rationale: 'Synthetic context', unresolved: ['Synthetic open point'], status: 'pending' }, reflectionQuestion: 'Consider this synthetic point' }], [], { now: 1000, reviewMs: 1000, lifetimeMs: 1000000, maxAttempts: 2 });
  store.finishConversationTask(task.id, { answer: 'Synthetic answer' }, { scope: task.conversationId, kind: 'episodic', content: 'Synthetic exchange and outcome', source: `task:${task.id}`, confidence: 1 });
  const memory = store.addMemory({ scope: task.conversationId, kind: 'semantic', content: 'Synthetic initial conclusion', source: 'fixture', confidence: 0.5 });
  store.correctMemory(memory.id, task.conversationId, { content: 'Synthetic corrected conclusion', source: 'fixture correction', confidence: 0.8 });
  const forgotten = store.addMemory({ scope: 'other-scope', kind: 'episodic', content: 'Synthetic forgotten input', source: 'fixture', confidence: 1 });
  store.forgetMemory(forgotten.id, 'other-scope');
  store.enqueue({ id: 'queued-task', conversationId: 'local', source: 'direct', input: 'Synthetic queued request must not dispatch during verification' });
  store.addGrowth({ id: 'old-growth', dimension: 'interests_curiosity', question: 'Synthetic question', origin: 'fixture', budget: 1 });
  store.openGrowthWindow({ id: 'old-window', schedulerId: 'standing-growth-v1', startsAt: 0, endsAt: 10000, maxCalls: 4 });
  store.claimGrowthInWindow('old-growth', 'old-window', 1000); store.updateGrowth('old-growth', { state: 'paused' });
  store.appendEvent('development.attempt.started', { attempt: { id: 'old-attempt', state: 'paused', ordinal: 1, startedAt: 1000, catalogDigest: 'a'.repeat(64) } });
  store.appendEvent('evolution.scheduler.call_reserved', { startsAt: 0, reservedAt: 1000, attemptId: 'old-call', plan: true, interactive: false });
  store.close();
  const hooks: CustodianHooks = { verifyArtifact: async () => true, checkpoint: async () => ({ sequence: 2, snapshot: null, policyVersion: 'fixture', unresolvedEffects: [], quiesced: true }),
    launch: async (_release, _mode, context) => ({ pid: 999999, instanceId: context.launchId }), stop: async () => {}, probe: async () => ({ runtime: 'healthy', providerAvailable: false }), catchUp: async () => {}, activate: async () => {} };
  const custody = new Custodian({ storeDir: join(snapshot, 'custodian'), hooks, requiredChecks: ['typecheck', 'trusted-agent-contract', 'cross-scope-memory'] });
  await custody.bootstrap({ digest: old.id, artifactPath: '/synthetic/old-host/releases/' + old.id, governanceDigest: old.governanceDigest, dataSchemaVersion: 1 });
  const state = custody.inspect(), journal = custody.journal(); custody.close();
  writeFileSync(join(snapshot, 'api-token'), 'synthetic-operator-token', { mode: 0o600 });
  writeFileSync(join(snapshot, 'peer-api-token'), 'synthetic-peer-token', { mode: 0o600 });
  const metadata = inspectMigrationSnapshot(snapshot);
  const attestation = { version: 1 as const, snapshotDigest: metadata.snapshotDigest, sourceHost: 'synthetic-old-host', sourcePlatform: 'darwin', stoppedAt: new Date().toISOString(), evidenceDigest: 'e'.repeat(64), sourceStopped: true as const, keepStopped: true as const };
  return { root, repositoryRoot, snapshot, destination, metadata, attestation, state, journal, git };
}

test('offline import preserves complete state/history and requires two provider-free native cold recoveries', async t => {
  const f = await fixture(t), before = databaseDigest(join(f.snapshot, 'state.sqlite'));
  const imported = await importPlatformSnapshot(f);
  assert.equal(imported.status, 'imported');
  assert.throws(() => assertPlatformMigrationReady(f.destination), /migration.*verified/i);
  assert.equal(databaseDigest(join(f.destination, 'state.sqlite')), before);
  for (const name of ['api-token', 'peer-api-token']) {
    assert.deepEqual(readFileSync(join(f.destination, name)), readFileSync(join(f.snapshot, name)));
    assert.equal(lstatSync(join(f.destination, name)).mode & 0o777, 0o600);
  }
  assert.equal(inspectMigrationSnapshot(f.snapshot).snapshotDigest, f.metadata.snapshotDigest);
  const db = new DatabaseSync(join(f.destination, 'custodian/custodian.sqlite'), { readOnly: true });
  const state = JSON.parse(String(db.prepare('SELECT record FROM custodian_state WHERE id=1').get()!.record));
  const prefix = db.prepare('SELECT sequence,type,payload,at FROM custodian_events ORDER BY sequence LIMIT ?').all(f.journal.length);
  db.close();
  assert.equal(state.epoch, f.state.epoch + 1); assert.notEqual(state.knownGood.digest, f.state.knownGood!.digest);
  assert.equal(state.platformMigration.previous.digest, f.state.knownGood!.digest);
  assert.deepEqual(prefix.map(row => ({ ...row, payload: JSON.parse(String(row.payload)) })), f.journal);
  assert.deepEqual(await importPlatformSnapshot(f), imported);
  const ready = await verifyPlatformRecovery({ repositoryRoot: f.repositoryRoot, dataDir: f.destination });
  assert.equal(ready.status, 'ready'); assert.equal(ready.recoveryEpochs.length, 2);
  assert.ok(ready.recoveryEpochs[0]! > state.epoch && ready.recoveryEpochs[1]! > ready.recoveryEpochs[0]!);
  assert.equal(databaseDigest(join(f.destination, 'state.sqlite')), before);
  assert.doesNotThrow(() => assertPlatformMigrationReady(f.destination));
  assert.deepEqual(await verifyPlatformRecovery({ repositoryRoot: f.repositoryRoot, dataDir: f.destination }), ready);
});

test('wrong shutdown binding and changed copied archive fail before destination creation', async t => {
  const f = await fixture(t);
  await assert.rejects(importPlatformSnapshot({ ...f, attestation: { ...f.attestation, snapshotDigest: '0'.repeat(64) } }), /shutdown|snapshot/i);
  assert.equal(existsSync(f.destination), false);
  writeFileSync(join(f.snapshot, 'unexpected'), 'synthetic changed archive');
  await assert.rejects(importPlatformSnapshot(f), /shutdown|snapshot/i);
  assert.equal(existsSync(f.destination), false);
});

test('unresolved effects and unfinished path-dependent work are explicit import blockers', async t => {
  const f = await fixture(t), store = new Store(join(f.snapshot, 'state.sqlite'));
  store.appendEvent('evolution.queue.enqueued', { id: 'unfinished', growthId: 'old-growth', proposalDigest: 'b'.repeat(64) }); store.close();
  const metadata = inspectMigrationSnapshot(f.snapshot);
  assert.ok(metadata.blockers.some(value => value.kind === 'evolution'));
  await assert.rejects(importPlatformSnapshot({ ...f, attestation: { ...f.attestation, snapshotDigest: metadata.snapshotDigest } }), /unfinished|held/i);
  assert.equal(existsSync(f.destination), false);
});

test('unknown delivery is preserved and cannot be silently replayed by import', async t => {
  const f = await fixture(t), store = new Store(join(f.snapshot, 'state.sqlite'));
  store.updateTask('queued-task', { state: 'running' });
  store.reserveEffect({ id: 'unknown-send', taskId: 'queued-task', kind: 'send', payload: { text: 'Synthetic uncertain delivery' } });
  store.markEffectUnknown('unknown-send', 'Synthetic interrupted sender');
  store.updateTask('queued-task', { state: 'waiting_for_provider', error: 'effect_reconciliation_required' }); store.close();
  const metadata = inspectMigrationSnapshot(f.snapshot), before = databaseDigest(join(f.snapshot, 'state.sqlite'));
  assert.ok(metadata.blockers.some(value => value.kind === 'effect' && value.id === 'unknown-send'));
  await assert.rejects(importPlatformSnapshot({ ...f, attestation: { ...f.attestation, snapshotDigest: metadata.snapshotDigest } }), /unfinished|held/i);
  assert.equal(databaseDigest(join(f.snapshot, 'state.sqlite')), before);
  assert.equal(existsSync(f.destination), false);
});

test('changed cognition cannot be hidden in the platform installation', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.repositoryRoot, 'src/agent/brain.ts'), readFileSync(join(f.repositoryRoot, 'src/agent/brain.ts'), 'utf8') + '\n// changed cognition\n');
  f.git('add', '.'); f.git('commit', '-qm', 'different cognition');
  await assert.rejects(importPlatformSnapshot(f), /cognitive/i);
  assert.throws(() => assertPlatformMigrationReady(f.destination), /migration.*verified/i);
  assert.equal(inspectMigrationSnapshot(f.snapshot).snapshotDigest, f.metadata.snapshotDigest);
});

test('failed native checks leave a held destination without changing original custody', async t => {
  const f = await fixture(t, true);
  await assert.rejects(importPlatformSnapshot(f), /checks.*failed/i);
  assert.throws(() => assertPlatformMigrationReady(f.destination), /migration.*verified/i);
  assert.equal(inspectMigrationSnapshot(f.snapshot).snapshotDigest, f.metadata.snapshotDigest);
  await assert.rejects(importPlatformSnapshot(f), /held|partial/i);
});

test('native artifact tampering cannot turn an imported receipt into readiness', async t => {
  const f = await fixture(t), imported = await importPlatformSnapshot(f);
  const path = join(f.destination, 'releases', imported.candidateId!, 'source/src/agent/brain.ts');
  chmodSync(path, 0o600); writeFileSync(path, 'export const changed = true;');
  await assert.rejects(verifyPlatformRecovery({ repositoryRoot: f.repositoryRoot, dataDir: f.destination }), /digest|modified/i);
  assert.throws(() => assertPlatformMigrationReady(f.destination), /migration.*verified/i);
  assert.equal(inspectMigrationSnapshot(f.snapshot).snapshotDigest, f.metadata.snapshotDigest);
});

test('operator import retains old baseline history but failed native rescue never selects Darwin', async t => {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-migration-custody-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = (char: string) => ({ digest: char.repeat(64), artifactPath: '/synthetic/' + char, governanceDigest: 'f'.repeat(64), dataSchemaVersion: 1 });
  const previous = release('a'), source = release('b'), native = release('c');
  const launches: string[] = []; let healthy = true, serial = 100;
  const hooks: CustodianHooks = { verifyArtifact: async () => true,
    checkpoint: async () => ({ sequence: 1, snapshot: null, policyVersion: 'synthetic', unresolvedEffects: [], quiesced: true }),
    launch: async (item, _mode, context) => { launches.push(item.digest); return { pid: ++serial, instanceId: context.launchId }; },
    stop: async () => {}, probe: async () => ({ runtime: healthy ? 'healthy' : 'failed', providerAvailable: false }), catchUp: async () => {}, activate: async () => {} };
  const options = { storeDir: root, hooks, requiredChecks: ['behavior'] };
  let custody = new Custodian(options);
  await custody.bootstrap(previous); await custody.installHostBaseline(source, previous.digest, 'e'.repeat(64));
  const state = custody.inspect(), journal = custody.journal(); custody.close(); custody = new Custodian(options);
  try {
    const input = { id: 'd'.repeat(64), snapshotDigest: 'e'.repeat(64), shutdownEvidenceDigest: 'f'.repeat(64), sourceStateDigest: digestCustodianValue(state),
      sourceJournalDigest: digestCustodianValue(journal), sourceStopped: true as const, candidate: native, evidenceDigest: '9'.repeat(64), destinationPlatform: 'linux-x64', checks: [{ id: 'behavior', status: 'passed' as const }] };
    await assert.rejects(custody.importPlatformBaseline({ ...input, checks: [] }), /platform_migration_checks/);
    assert.deepEqual(custody.inspect(), state); assert.deepEqual(custody.journal(), journal);
    await custody.importPlatformBaseline(input); const after = custody.journal(); await custody.importPlatformBaseline(input);
    assert.deepEqual(custody.journal(), after);
    assert.deepEqual(custody.inspect().operatorBaseline, state.operatorBaseline);
    await assert.rejects(custody.restoreHostBaseline(source.digest), /operator_baseline_binding/);
    launches.length = 0; healthy = false;
    assert.equal(await custody.recover(), undefined);
    assert.equal(custody.inspect().phase, 'recovery_required');
    assert.ok(launches.length > 0); assert.ok(launches.every(id => id === native.digest));
    assert.equal(custody.inspect().knownGood!.digest, native.digest);
    assert.deepEqual(custody.journal().slice(0, journal.length), journal);
  } finally { custody.close(); }
});
