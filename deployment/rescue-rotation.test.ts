import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { identity, type Effect, type JsonValue, type PhysicalRequest, type Run } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { freezeCandidate, hashBytes } from '../packages/release/artifacts.ts';
import type { ReleaseState, ReleaseTarget } from '../packages/release/controller.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { initializeBootstrap, publishBootstrapSelection, rotateBootstrapRescue } from './bootstrap-evolution.ts';
import type { SupervisorFile } from './cli.ts';
import { RescueRotationHost, rescueRotationTools, type RescueRotationOptions, type RescueRotationRecord } from './rescue-rotation.ts';

function fixture(mode: 'normal' | 'lost-reply' | 'lost-settlement' | 'duplicate-lost-reply' | 'completed-duplicate-lost-reply' = 'normal', selected: ReleaseTarget = { candidateId: identity('current-candidate'), policyDigest: identity('current-policy') }, externalRoot?: string) {
  const root = externalRoot ?? mkdtempSync(join(tmpdir(), 'aeon-rescue-tools-')), filename = join(root, 'operational.sqlite');
  const store = new OperationalStore({ filename }), authorities = new AuthorityStore(join(root, 'authority.sqlite'));
  const authority = authorities.bootstrap('accepted-host', identity('controls'), selected.candidateId); chmodSync(join(root, 'authority.sqlite'), 0o600);
  const scope = { kind: 'restricted' as const, principals: ['operator'] }, resources = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 100 });
  const envelope = { maxRequests: 20, maxTokens: 10000, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 1 };
  resources.allocate('operating', envelope);
  let runId = '', calls = 0, rotations = 0, afterTool: (() => Promise<void> | void) | undefined, ready = true;
  let state: ReleaseState = { phase: 'accepted', accepted: selected, active: selected, authority: authorities.current()!, operationalStatePath: root, admissionEvidenceIds: ['fresh-proof'] };
  const tools = (effectId?: string, overrides = {}) => rescueRotationTools({ store, runId, scope, authority, workspace: root, ...(effectId ? { effectId } : {}), ...overrides }, { ...selected, assertAuthority: grant => authorities.assert(grant) });
  const effects = new EffectJournal(store, authorities, { async dispatch(effect) {
    const value = await tools(effect.id).find(tool => tool.name === effect.kind)!.execute(effect.payload);
    if (mode === 'lost-reply' || ['duplicate-lost-reply', 'completed-duplicate-lost-reply'].includes(mode) && effect.id === 'tool:duplicate-rescue-call') throw Error('Local reply lost after durable explicit rescue request');
    return { outcome: 'succeeded', receipt: store.putJsonArtifact(value as JsonValue) };
  }, async reconcile() { throw Error('No unknown external receiver replay'); } });
  const call = () => ({ id: 'rescue-call', runId, stepId: 'rescue-step', name: 'rescue_rotate', arguments: { candidateId: selected.candidateId } });
  const runtime = new DurableRuntime({ store, effects, resources, shell: { async run(input, bridge) {
    calls++; const observation = await bridge.execute(mode === 'completed-duplicate-lost-reply' && calls > 1 ? { ...call(), id: 'duplicate-rescue-call' } : call());
    if (mode === 'duplicate-lost-reply') await bridge.execute({ ...call(), id: 'duplicate-rescue-call' });
    await afterTool?.();
    const checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, 'fixture', { observationIds: [observation.id], phase: 'rescue-requested' });
    return { status: mode === 'completed-duplicate-lost-reply' && calls === 1 ? 'checkpointed' : 'completed', checkpoint, observations: [observation] };
  } } });
  const run = runtime.admit({ id: 'input', source: 'direct', externalId: 'rescue', externalRevision: '1', actorId: 'operator', authenticated: true, scope, value: 'Explicit retained rescue rotation engineering fixture.' }, authority, envelope, 'operating'); runId = run.id;
  const options = (targetStore = store, rotate?: RescueRotationOptions['rotate']): RescueRotationOptions => ({ store: targetStore, authority: authorities, status: () => state, ready: () => ready,
    rotate: rotate ?? ((_request, commit) => authorities.dispatch(authority, () => commit(() => { rotations++; }))) });
  const host = new RescueRotationHost(options());
  const record = () => store.list<RescueRotationRecord>('host.rescue-rotations')[0]!.value;
  const originalSettle = resources.settle.bind(resources);
  if (mode === 'lost-settlement') resources.settle = request => { if (request.model === 'rescue_rotate' && request.status === 'succeeded') throw Error('Crash after effect success before settlement'); originalSettle(request); };
  return { root, filename, store, authorities, authority, selected, scope, resources, effects, runtime, run, tools, options, host, record,
    prompt: { id: 'fixture', requestDigest: identity('no-physical-model'), fragments: [] }, calls: () => calls, rotations: () => rotations,
    setAfterTool: (value: typeof afterTool) => { afterTool = value; }, setState: (patch: Partial<ReleaseState>) => { state = { ...state, ...patch }; }, setReady: (value: boolean) => { ready = value; },
    restoreSettlement: () => { resources.settle = originalSettle; },
    async close() { await host.close(); store.close(); authorities.close(); if (!externalRoot) rmSync(root, { recursive: true, force: true }); } };
}

test('ordinary explicit rescue acknowledgment waits for settled receiver and finished producer, then records one decision without reopening completed author', async () => {
  const f = fixture();
  try {
    const allocation = f.store.get('allocations', f.run.id);
    f.setAfterTool(async () => { await f.host.processPending(); assert.equal(f.record().status, 'pending'); assert.equal(f.rotations(), 0); });
    assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'completed');
    assert.equal(f.record().status, 'pending'); f.setReady(false); await f.host.processPending(); assert.equal(f.record().status, 'pending');
    f.setReady(true); await f.host.processPending(); await f.host.processPending();
    assert.equal(f.record().status, 'completed'); assert.equal(f.rotations(), 1); assert.equal(f.runtime.getRun(f.run.id)?.status, 'completed');
    assert.equal(f.calls(), 1); assert.equal(f.resources.snapshot(f.run.id).requests, 1); assert.deepEqual(f.store.get('allocations', f.run.id), allocation);
    assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 0);
    const decision = f.store.readJsonArtifact<any>(f.record().decision!); assert.equal(decision.outcome, 'rotated'); assert.deepEqual(decision.selected, f.selected);
    assert.equal(JSON.stringify(f.runtime.observations(f.run.id)[0]?.value).includes('authority.sqlite'), false);
  } finally { await f.close(); }
});

for (const mode of ['lost-reply', 'lost-settlement'] as const) test(`${mode} recovers only its exact committed local receipt after restart, with conservative charge and no model retry`, async () => {
  const f = fixture(mode);
  try {
    await f.runtime.resume(f.run.id, f.prompt); f.restoreSettlement(); f.runtime.recover();
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const host = new RescueRotationHost(f.options(reopened)); await host.processPending(); await host.processPending();
      assert.equal(reopened.list<RescueRotationRecord>('host.rescue-rotations')[0]?.value.status, 'completed');
      assert.equal(reopened.get<Effect>('effects', 'tool:rescue-call')?.value.status, 'succeeded');
      const physical = reopened.get<{ request: PhysicalRequest }>('requests', 'tool:rescue-call')!.value.request;
      assert.equal(physical.status, 'succeeded'); assert.equal(physical.usage.elapsedMs, 100); assert.equal(f.rotations(), 1); assert.equal(f.calls(), 1);
      assert.equal(reopened.events(f.run.id).filter(event => event.type === 'local-rescue-reconciled').length, 1);
      await host.close();
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('duplicate explicit request lost reply has its own exact local receipt and frees only its receiver without another rotation', async () => {
  const f = fixture('duplicate-lost-reply');
  try {
    await f.runtime.resume(f.run.id, f.prompt); f.runtime.recover();
    assert.equal(f.store.list('host.rescue-rotations').length, 1); assert.equal(f.store.list('host.rescue-rotation-acknowledgments').length, 2);
    assert.equal(f.record().acknowledgment?.effectId, 'tool:rescue-call');
    assert.equal(f.effects.get('tool:duplicate-rescue-call')?.status, 'uncertain');
    await f.host.processPending(); await f.host.processPending();
    assert.equal(f.record().status, 'completed'); assert.equal(f.effects.get('tool:duplicate-rescue-call')?.status, 'succeeded');
    assert.equal(f.resources.request('tool:duplicate-rescue-call')?.status, 'succeeded'); assert.equal(f.resources.request('tool:duplicate-rescue-call')?.usage.elapsedMs, 100);
    assert.equal(f.resources.snapshot(f.run.id).requests, 2); assert.equal(f.resources.snapshot(f.run.id).concurrent, 0); assert.equal(f.rotations(), 1); assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});

test('duplicate known completed rescue decision recovers its own lost reply after restart without repeating the pointer operation', async () => {
  const f = fixture('completed-duplicate-lost-reply');
  try {
    assert.equal((await f.runtime.resume(f.run.id, f.prompt)).status, 'waiting');
    await f.host.processPending(); assert.equal(f.record().status, 'completed'); assert.equal(f.rotations(), 1);
    await f.runtime.resume(f.run.id, f.prompt); f.runtime.recover();
    assert.equal(f.effects.get('tool:duplicate-rescue-call')?.status, 'uncertain');
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const host = new RescueRotationHost(f.options(reopened)); await host.processPending(); await host.processPending();
      assert.equal(reopened.get<Effect>('effects', 'tool:duplicate-rescue-call')?.value.status, 'succeeded');
      const physical = reopened.get<{ request: PhysicalRequest }>('requests', 'tool:duplicate-rescue-call')!.value.request;
      assert.equal(physical.status, 'succeeded'); assert.equal(physical.usage.elapsedMs, 100);
      assert.equal(f.rotations(), 1); assert.equal(f.calls(), 2); assert.equal(reopened.list('host.rescue-rotations').length, 1); await host.close();
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('producer restarted between readiness check and actual guarded callback defers under the operational lock without applying', async () => {
  const f = fixture();
  try {
    await f.runtime.resume(f.run.id, f.prompt); let resumed = false, applied = 0;
    const host = new RescueRotationHost(f.options(f.store, (_request, commit) => f.authorities.dispatch(f.authority, () => {
      if (!resumed) { const row = f.store.get<Run>('runs', f.run.id)!; f.store.put('runs', f.run.id, { ...row.value, status: 'running' }, row.revision); resumed = true; }
      commit(() => { applied++; });
    })));
    await host.processPending(); assert.equal(f.record().status, 'pending'); assert.equal(applied, 0);
    const row = f.store.get<Run>('runs', f.run.id)!; f.store.put('runs', f.run.id, { ...row.value, status: 'completed' }, row.revision);
    await host.processPending(); assert.equal(f.record().status, 'completed'); assert.equal(applied, 1); assert.equal(f.calls(), 1); await host.close();
  } finally { await f.close(); }
});

test('exact pending local binding rejects changed effect payload, authority, receipt and physical reservation without releasing accounting', async () => {
  for (const boundary of ['payload', 'authority', 'receipt', 'reservation']) {
    const f = fixture('lost-settlement');
    try {
      await f.runtime.resume(f.run.id, f.prompt); f.restoreSettlement(); f.runtime.recover();
      if (boundary === 'reservation') { const row = f.store.get<any>('requests', 'tool:rescue-call')!; f.store.put('requests', 'tool:rescue-call', { ...row.value, request: { ...row.value.request, provider: 'foreign' } }, row.revision); }
      else { const row = f.store.get<Effect>('effects', 'tool:rescue-call')!; f.store.put('effects', 'tool:rescue-call', { ...row.value, ...(boundary === 'payload' ? { payload: { candidateId: identity('foreign') } } : boundary === 'authority' ? { authority: { ...f.authority, generation: 'foreign' } } : { receipt: f.store.putJsonArtifact({ fake: true }) }) }, row.revision); }
      await f.host.processPending(); assert.equal(f.record().status, 'rejected', boundary); assert.equal(f.rotations(), 0, boundary); assert.equal(f.resources.snapshot(f.run.id).concurrent, 1, boundary);
    } finally { await f.close(); }
  }
});

test('ordinary rescue tools bind current candidate, exact run and audience and expose only compact scoped status', async () => {
  const f = fixture();
  try {
    const tools = f.tools('tool:rescue-call'), rotate = tools[0]!, status = tools[1]!;
    await assert.rejects(async () => rotate.execute({ candidateId: identity('foreign') }), /Current candidate/);
    await assert.rejects(async () => rotate.execute({ candidateId: f.selected.candidateId, policyDigest: f.selected.policyDigest }), /Exact bounded/);
    const receipt = await rotate.execute({ candidateId: f.selected.candidateId }) as { requestId: string; status: string };
    assert.equal(receipt.status, 'pending'); assert.deepEqual(await status.execute({ requestId: receipt.requestId }), receipt);
    assert.deepEqual(await f.tools('tool:other-call')[0]!.execute({ candidateId: f.selected.candidateId }), receipt); assert.equal(f.store.list('host.rescue-rotations').length, 1);
    assert.equal(f.record().acknowledgment?.effectId, 'tool:rescue-call');
    await assert.rejects(async () => f.tools(undefined, { scope: { kind: 'public' } })[1]!.execute({ requestId: receipt.requestId }), /Live scoped/);
    const foreign = { ...f.record(), request: { ...f.record().request, id: `rescue:${identity('foreign-run')}`, runId: 'foreign-run' } }; f.store.put('host.rescue-rotations', foreign.request.id, foreign, null);
    await assert.rejects(async () => status.execute({ requestId: foreign.request.id }), /run\/audience/);
    assert.equal(JSON.stringify(receipt).includes('acknowledgment'), false); assert.equal(JSON.stringify(receipt).includes('scope'), false);
  } finally { await f.close(); }
});

test('cancelled, expired, fenced, foreign audience and unaccepted requests never rotate or mint grants', async () => {
  for (const boundary of ['cancelled', 'parent-cancelled', 'expired', 'fenced', 'scope', 'probation', 'target']) {
    const f = fixture();
    try {
      await f.runtime.resume(f.run.id, f.prompt);
      if (boundary === 'cancelled') f.resources.cancel(f.run.id);
      if (boundary === 'parent-cancelled') f.resources.cancel('operating');
      if (boundary === 'expired') { const row = f.store.get<any>('allocations', 'operating')!; f.store.put('allocations', 'operating', { ...row.value, startedAt: Date.now() - 60001 }, row.revision); }
      if (boundary === 'fenced') f.authorities.withdraw(f.authority);
      if (boundary === 'scope') { const row = f.store.get<Run>('runs', f.run.id)!; f.store.put('runs', f.run.id, { ...row.value, scope: { kind: 'public' } }, row.revision); }
      if (boundary === 'probation') f.setState({ phase: 'probation' });
      if (boundary === 'target') f.setState({ accepted: { ...f.selected, candidateId: identity('foreign') } });
      await f.host.processPending(); assert.equal(f.record().status, 'rejected', boundary); assert.equal(f.rotations(), 0, boundary);
      assert.equal(f.calls(), 1); assert.equal(f.store.list('allocations').length, 2);
    } finally { await f.close(); }
  }
});

test('actual mutation rechecks cancellation and preserves a known decision after lost callback return', async () => {
  for (const boundary of ['cancel-at-commit', 'lost-return']) {
    const f = fixture();
    try {
      await f.runtime.resume(f.run.id, f.prompt); let applied = 0;
      const host = new RescueRotationHost(f.options(f.store, (_request, commit) => f.authorities.dispatch(f.authority, () => {
        if (boundary === 'cancel-at-commit') f.resources.cancel('operating');
        commit(() => { applied++; }); if (boundary === 'lost-return') throw Error('Reply lost after exact pointer decision committed');
      })));
      await host.processPending(); await host.processPending();
      assert.equal(f.record().status, boundary === 'cancel-at-commit' ? 'rejected' : 'completed'); assert.equal(applied, boundary === 'cancel-at-commit' ? 0 : 1);
      await host.close();
    } finally { await f.close(); }
  }
});

test('pointer-before-decision failure and interrupted processing remain uncertain after restart and never retry', async () => {
  for (const boundary of ['pointer-failure', 'interrupted']) {
    const f = fixture();
    try {
      await f.runtime.resume(f.run.id, f.prompt); let applied = 0;
      if (boundary === 'interrupted') { const row = f.store.get<RescueRotationRecord>('host.rescue-rotations', f.record().request.id)!; f.store.put('host.rescue-rotations', f.record().request.id, { ...row.value, status: 'processing' }, row.revision); }
      const host = new RescueRotationHost(f.options(f.store, (_request, commit) => f.authorities.dispatch(f.authority, () => commit(() => { applied++; throw Error('Pointer mutation returned no durable decision'); }))));
      await host.processPending(); assert.equal(f.record().status, 'uncertain');
      if (boundary === 'pointer-failure') { const failure = f.store.readJsonArtifact<any>(f.record().failure!); assert.equal(failure.pointerEntered, true); assert.match(failure.cause, /Pointer mutation/); }
      const restarted = new RescueRotationHost(f.options(f.store, () => { applied++; })); await restarted.processPending(); await restarted.processPending();
      assert.equal(f.record().status, 'uncertain'); assert.equal(applied, boundary === 'pointer-failure' ? 1 : 0); assert.equal(f.calls(), 1);
      await host.close(); await restarted.close();
    } finally { await f.close(); }
  }
});

// One private fixture reuses two retained runtimes. The explicit readiness record is an
// engineering guard witness; installed full successor boot evidence is maintained separately.
test('actual bootstrap guarded rotation requires accepted boot-ready current target and retains both prior snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-rescue-bootstrap-'));
  const config = { host: { stateDirectory: join(root, 'state'), artifactStore: join(root, 'artifacts'), workspaceDirectory: join(root, 'work'), nodeBinary: process.execPath }, mode: 'engineering', policyFiles: [], evidenceDirectory: join(root, 'evidence') } as SupervisorFile;
  for (const path of [config.host.stateDirectory, config.host.artifactStore, config.host.workspaceDirectory]) mkdirSync(path, { mode: 0o700 });
  const runtime = { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
  const create = (text: string) => {
    const source = join(root, text); mkdirSync(join(source, 'deployment'), { recursive: true }); writeFileSync(join(source, 'deployment/bootstrap-evolution.ts'), text); writeFileSync(join(source, 'package-lock.json'), '{}');
    const files = [{ path: 'deployment/bootstrap-evolution.ts', sha256: hashBytes(text) }, { path: 'package-lock.json', sha256: hashBytes('{}') }];
    return freezeCandidate(source, config.host.artifactStore, ['deployment', 'package-lock.json'], { createdBy: 'rescue-guard-fixture', model: {}, prompts: {}, configuration: {}, controls: { classifier: 'host-execution-closure-v1', files, runtime, policy: {} }, dependencies: { installedRuntime: [], lockfile: hashBytes('{}'), retainedForks: [], checkBuildToolchain: [], runtime } }).manifest.id;
  };
  const first = { candidateId: create('first'), policyDigest: identity('first-policy') }, next = { candidateId: create('next'), policyDigest: identity('next-policy') };
  const f = fixture('normal', next, config.host.stateDirectory), dbpath = join(config.host.stateDirectory, 'release.sqlite'), db = new DatabaseSync(dbpath); chmodSync(dbpath, 0o600);
  db.exec('CREATE TABLE release_state(singleton INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const release = { phase: 'accepted', accepted: next, active: next, authority: f.authorities.current()! };
  db.prepare('INSERT INTO release_state VALUES(1,?)').run(JSON.stringify(release));
  try {
    initializeBootstrap(config, first); publishBootstrapSelection(config, next);
    const boot = join(config.host.stateDirectory, 'boot'), originalRescue = realpathSync(join(boot, 'rescue')), target = join(boot, 'targets', next.candidateId), descriptor = JSON.parse(readFileSync(join(target, 'target.json'), 'utf8'));
    assert.throws(() => rotateBootstrapRescue(config, next), /ENOENT/); assert.equal(realpathSync(join(boot, 'rescue')), originalRescue);
    writeFileSync(join(target, 'boot-ready.json'), JSON.stringify({ target: next, authority: { ...release.authority, epoch: 0 }, runtimeHash: descriptor.runtimeHash }), { mode: 0o600 });
    assert.throws(() => rotateBootstrapRescue(config, next), /boot-ready under current authority/);
    writeFileSync(join(target, 'boot-ready.json'), JSON.stringify({ target: next, authority: release.authority, runtimeHash: descriptor.runtimeHash }));
    writeFileSync(join(boot, 'failed'), ''); assert.throws(() => rotateBootstrapRescue(config, next), /latched/); rmSync(join(boot, 'failed'));
    await f.runtime.resume(f.run.id, f.prompt);
    const host = new RescueRotationHost(f.options(f.store, (request, commit) => rotateBootstrapRescue(config, request.selected, commit)));
    await host.processPending(); await host.processPending(); assert.equal(f.record().status, 'completed'); assert.equal(realpathSync(join(boot, 'rescue')), target);
    assert.ok(existsSync(join(originalRescue, 'node'))); assert.ok(existsSync(join(originalRescue, 'payload/deployment/bootstrap-evolution.ts')));
    assert.equal(f.runtime.getRun(f.run.id)?.status, 'completed'); assert.equal(f.calls(), 1); await host.close();
    f.authorities.withdraw(f.authority); assert.throws(() => rotateBootstrapRescue(config, next), /authority/i); assert.equal(realpathSync(join(boot, 'rescue')), target);
  } finally { db.close(); await f.close(); rmSync(root, { recursive: true, force: true }); }
});
