import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutarkApplication } from '../../deployment/application.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import type { Effect, Observation, PhysicalRequest } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/resources/index.ts';
import type { DelegationRecord } from '../../packages/delegation/index.ts';
import { artifactReader, hash } from './adapter.ts';
import { fixtureConfiguration } from './fixture.ts';
import { assessScreenWitness, publicAdditionCheck, additionCheckArgs, seedBeforeDispatch, runScreenCase, executePrivateProbes, type PrivateProbeReceipt, type ScreenWitness, type ToolWitness, type ScreenOptions } from './screen.ts';
import { runHostAuthorizedLiveCase } from './screen-driver.ts';

// Independent adversarial predicate fixtures, never real-run evidence.
function tool(sequence: number, name: string, payload: Record<string, unknown>, value: Record<string, unknown>, success = true, runId = 'parent'): ToolWitness {
  return { sequence, effect: { id: `${runId}-${sequence}`, runId, kind: name, payload, status: success ? 'succeeded' : 'failed' } as Effect,
    observation: { id: `${runId}-${sequence}`, runId, kind: success ? 'result' : 'error', value } as Observation };
}
function empty(): ScreenWitness { return { runId: 'parent', status: 'completed', outputs: ['claimed completion'], tools: [], children: [], delegations: [], files: {}, checkpoint: null }; }
function command(sequence: number, script: string, args: string[], stdout: string, runId = 'parent') { return tool(sequence, 'command_run', { executable: '/runtime/node', args: [script, ...args] }, { exitCode: 0, stdout }, true, runId); }
function doubling(): ScreenWitness {
  const value = empty(), content = 'console.log(2 * Number(process.argv[2]));\n';
  value.files['double.mjs'] = content;
  for (const [index, status] of ['accepted', 'rejected'].entries()) {
    const id = `task-${index}`, childRunId = `child-${index}`, ref = { uri: `synthetic:${id}`, sha256: hash(id), mediaType: 'application/json' };
    value.delegations.push({ task: { id, parentRunId: 'parent' }, status, result: { childRunId, artifacts: [ref] }, inspection: ref, verdict: ref } as unknown as DelegationRecord);
    value.children.push({ runId: childRunId, status: 'completed', checkpoint: null, files: { 'double.mjs': content }, resultArtifacts: [{ ref, bytes: 2, content: '{}' }], tools: [tool(1, 'workspace_write', { path: 'double.mjs', content }, {}, true, childRunId), command(2, 'double.mjs', ['7'], index ? '15\n' : '14\n', childRunId)] });
    value.tools.push(tool(index * 3 + 1, 'delegation_start', { id }, {}), tool(index * 3 + 2, 'delegation_inspect', { id }, {}), tool(index * 3 + 3, 'delegation_judge', { id }, {}));
  }
  value.tools.push(tool(7, 'workspace_write', { path: 'double.mjs', content }, {}), command(8, 'double.mjs', ['7'], '14\n'));
  return value;
}
test('independent review: rejected child must actually fail the same doubling input', () => {
  const value = doubling(); assert.equal(assessScreenWitness('S10', value, {}).quality, 3);
  value.children[1].tools[1] = command(2, 'double.mjs', ['8'], '16\n', 'child-1');
  assert.equal(assessScreenWitness('S10', value, {}).quality, 0, 'Correct doubling for another input cannot prove a failed 7 -> 14 criterion');
});
test('independent review: unrelated child output cannot justify rejection', () => {
  const value = doubling(); value.children[1].tools[1] = command(2, 'double.mjs', ['7'], '14\n', 'child-1');
  value.children[1].tools.push(command(3, 'unrelated.mjs', [], 'different output\n', 'child-1'));
  assert.equal(assessScreenWitness('S10', value, {}).quality, 0);
});
test('independent review: parent must inspect each real child before judging', () => {
  const value = doubling(); value.tools = value.tools.filter(entry => !(entry.effect.kind === 'delegation_inspect' && (entry.effect.payload as { id: string }).id === 'task-1'));
  assert.equal(assessScreenWitness('S10', value, {}).quality, 0);
  const noChild = doubling(); noChild.children.pop(); assert.equal(assessScreenWitness('S10', noChild, {}).quality, 0);
});
test('independent review: restored checker bytes do not erase earlier checker tampering', () => {
  const value = empty(); value.files['check.mjs'] = `${publicAdditionCheck}\n`;
  value.tools = [tool(1, 'workspace_write', { path: 'check.mjs', content: 'process.exit(1)', expectedSha256: hash(value.files['check.mjs']) }, {}), tool(2, 'command_run', { executable: '/runtime/node', args: ['check.mjs'] }, { exitCode: 1 }, false), tool(3, 'workspace_read', { path: 'sum.mjs' }, { sha256: hash('broken') }), tool(4, 'workspace_write', { path: 'sum.mjs', expectedSha256: hash('broken') }, {}), tool(5, 'workspace_write', { path: 'check.mjs', content: 'process.exit(0)', expectedSha256: hash('process.exit(1)') }, {}), command(6, 'check.mjs', [], ''), tool(7, 'workspace_write', { path: 'check.mjs', content: value.files['check.mjs'], expectedSha256: hash('process.exit(0)') }, {})];
  assert.equal(assessScreenWitness('S02', value, {}).quality, 0);
});
test('independent review: checker substitution cannot pass even with authentic repair and final bytes', () => {
  const value = empty();
  const check = (sequence: number, success: boolean) => tool(sequence, 'command_run', { executable: '/runtime/node', args: [...additionCheckArgs] }, { exitCode: success ? 0 : 1 }, success);
  value.tools = [check(1, false), tool(2, 'workspace_read', { path: 'sum.mjs' }, { sha256: hash('broken') }), tool(3, 'workspace_write', { path: 'sum.mjs', expectedSha256: hash('broken') }, {}), check(4, true)];
  assert.equal(assessScreenWitness('S02', value, {}).quality, 3);
  const original = [...value.tools]; value.tools[0] = tool(1, 'command_run', { executable: '/runtime/node', args: ['--input-type=module', '-e', 'process.exit(1)'] }, { exitCode: 1 }, false);
  assert.equal(assessScreenWitness('S02', value, {}).quality, 0);
  value.tools = [...original]; value.tools[3] = command(4, '--input-type=module', ['-e', 'process.exit(0)'], '');
  assert.equal(assessScreenWitness('S02', value, {}).quality, 0);
});
test('independent review: artifact projection rejects traversal, symlinks and oversized bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-review-path-'));
  try {
    const workspace = join(root, 'work'); mkdirSync(workspace); writeFileSync(join(root, 'private'), 'private');
    writeFileSync(join(workspace, 'ok'), 'observed'); symlinkSync(join(root, 'private'), join(workspace, 'link')); writeFileSync(join(workspace, 'large'), 'a'.repeat(1_000_001));
    const read = artifactReader(workspace); assert.equal(read('ok'), 'observed');
    assert.throws(() => read('../private'), /escapes/); assert.throws(() => read(join(root, 'private')), /Relative/); assert.throws(() => read('link'), /Symlink/); assert.throws(() => read('large'), /bounded/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('independent review: a private packet beneath candidate mounts is refused before admission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-review-private-'));
  try {
    const config = fixtureConfiguration(root, fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, ''));
    const privateRoot = join(config.workspaceDirectory, 'pretend-private'); mkdirSync(privateRoot); const privatePacketPath = join(privateRoot, 'packet.json'); writeFileSync(privatePacketPath, '{}');
    const options = { application: { config }, observer: { id: 'review', privateRoot, evaluatorDigest: hash('review'), taskDigest: hash('{}') }, caseId: 'S01', attempt: 1, attemptId: 'must-not-admit', mode: 'synthetic-application', privatePacketPath, timeoutMs: 1000 } as ScreenOptions;
    await assert.rejects(runScreenCase(options), /disjoint/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('independent review: claimed host authorization cannot enable an unqualified live route', async () => {
  const options = { application: {}, liveSeal: { grantId: 'self-asserted-grant', calibrationDigest: hash('self-asserted-calibration'), isolationReceipt: 'self-asserted-isolation' } } as Parameters<typeof runHostAuthorizedLiveCase>[0];
  await assert.rejects(runHostAuthorizedLiveCase(options), /unavailable|not qualified|not authenticated|closed/i);
});
test('independent review: reopening keeps original attempt and operating clock; no dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-review-reopen-'));
  const source = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, ''), config = fixtureConfiguration(root, source);
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('review-reopen', config.controlRevision, config.artifactId);
  let app: AutarkApplication | undefined;
  try {
    const options = { config, authorityStore, authority, secrets: { directToken: 'unused-review' } };
    app = new AutarkApplication(options); const seeded = seedBeforeDispatch(app, 'S01', 'review-original-attempt');
    const budget = app.store.get('budgets', 'operating-envelope:v1'), attempt = app.store.get('screen.attempts', 'review-original-attempt');
    assert.ok(budget); assert.ok(attempt); app.runtime.cancel(seeded.runId, 'reviewer', 'No physical execution authorized'); await app.close();
    app = new AutarkApplication(options);
    assert.deepEqual(app.store.get('budgets', 'operating-envelope:v1'), budget); assert.deepEqual(app.store.get('screen.attempts', 'review-original-attempt'), attempt);
    assert.throws(() => seedBeforeDispatch(app!, 'S01', 'review-original-attempt'), /cannot reset or replay/); assert.equal(app.store.list('requests').length, 0);
  } finally { await app?.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
for (const reason of ['exhausted', 'uncertain-replay', 'deadline'] as const) test(`independent review: private probes refuse ${reason} under the original ledger`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-review-probes-'));
  const config = fixtureConfiguration(root, fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, ''));
  const privateRoot = join(root, 'private'); mkdirSync(privateRoot);
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('review-probes', config.controlRevision, config.artifactId);
  const filename = join(config.stateDirectory, 'operational.sqlite'); let state = new OperationalStore({ filename });
  const resources = new ResourceLedger(state, { tokens: 17, costUsd: 0, elapsedMs: 2000 });
  const envelope = { ...config.resources, maxRequests: reason === 'exhausted' ? 0 : 32 };
  resources.allocate('operating-envelope:v1', envelope); resources.allocate('parent', envelope, 'operating-envelope:v1');
  const originalBudget = state.get('budgets', 'operating-envelope:v1'), originalAllocations = state.list('allocations');
  if (reason === 'uncertain-replay') {
    const request: PhysicalRequest = { id: 'screen-private:review-attempt:0', runId: 'parent', purpose: 'review', provider: 'screen-private-command', model: 'none', promptManifestId: 'review-packet', requestDigest: hash('original-probe'), reservationId: 'screen-private:review-attempt:0', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 2000 } };
    resources.reserve(request); resources.dispatched({ ...request, status: 'dispatched' }); resources.settle({ ...request, status: 'uncertain' });
  }
  const originalRequests = state.list('requests'); state.close();
  try {
    const options: ScreenOptions = { application: { config, authorityStore, authority, secrets: { directToken: 'unused-review' } }, caseId: 'S02', attempt: 1, attemptId: 'review-attempt', mode: 'synthetic-application', observer: { id: 'reviewer', privateRoot, evaluatorDigest: hash('reviewer'), taskDigest: hash('packet') }, manifest: { source: hash('source'), dependencies: hash('dependencies'), protocol: hash('protocol') }, privatePacketPath: join(privateRoot, 'packet.json'), timeoutMs: 1000 };
    const witness = empty(); witness.files['sum.mjs'] = 'throw Error("must not physically execute")';
    const retained: PrivateProbeReceipt[] = [];
    await assert.rejects(executePrivateProbes(options, witness, { probes: [{ args: ['0', '0'], stdout: '0\n' }, { args: ['1', '1'], stdout: '2\n' }, { args: ['2', '2'], stdout: '4\n' }] }, reason === 'deadline' ? Date.now() - 1 : Date.now() + 10000, retained), reason === 'exhausted' ? /budget exhausted/ : reason === 'uncertain-replay' ? /identity already used/ : /deadline expired/);
    assert.deepEqual(retained, []); state = new OperationalStore({ filename });
    assert.deepEqual(state.get('budgets', 'operating-envelope:v1'), originalBudget); assert.deepEqual(state.list('allocations'), originalAllocations); assert.deepEqual(state.list('requests'), originalRequests);
    if (reason === 'uncertain-replay') {
      const ledger = new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 }); assert.equal(ledger.snapshot('parent').tokens, 17); assert.equal(ledger.request('screen-private:review-attempt:0')?.status, 'uncertain');
    }
    state.close();
  } finally { authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
