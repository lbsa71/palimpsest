import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutarkApplication } from '../../deployment/application.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import type { Effect, Observation } from '../../packages/contracts/index.ts';
import { assessScreenWitness, publicWorkload, seedBeforeDispatch, supportedCases, unavailableCases, runScreenCase, type ScreenWitness, type ToolWitness } from './screen.ts';
import { publicRehearsalPacket, validateAttemptPlan, runHostAuthorizedLiveCase } from './screen-driver.ts';
import { fixtureConfiguration } from './fixture.ts';
import { hash } from './adapter.ts';

const rootSource = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
/** Clearly synthetic witness data for pure checks; never reported as an application execution. */
function witness(): ScreenWitness { return { runId: 'pure-test-run', status: 'completed', outputs: [{ text: 'claimed complete' }], tools: [], children: [], delegations: [], files: {}, checkpoint: null }; }
function tool(sequence: number, name: string, payload: Record<string, unknown>, value: Record<string, unknown>, success = true): ToolWitness {
  return { sequence, effect: { id: `synthetic-${sequence}`, runId: 'pure-test-run', kind: name, payload, status: success ? 'succeeded' : 'failed' } as Effect,
    observation: { id: `synthetic-${sequence}`, runId: 'pure-test-run', kind: success ? 'result' : 'error', value } as Observation };
}
const passed = (id: typeof supportedCases[number], value: ScreenWitness) => assessScreenWitness(id, value, publicRehearsalPacket(id)).quality === 3;
test('eight-case boundary and frozen initial attempts preserve unavailable lifecycle cases', () => {
  assert.deepEqual(supportedCases, ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S10']);
  assert.deepEqual(unavailableCases, ['S08', 'S09', 'S11', 'S12']);
  assert.throws(() => validateAttemptPlan([{ caseId: 'S01', initialAttempts: 1 }]), /all eight/);
  const plan = validateAttemptPlan(supportedCases.map(caseId => ({ caseId, initialAttempts: 1 })));
  assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan[0]), true);
  assert.throws(() => validateAttemptPlan([...plan.slice(1), { caseId: 'S01', initialAttempts: 4 as 1 }]), /at most three/);
});
test('false completion and forged answer cannot pass any supported case', () => {
  for (const id of supportedCases) {
    const value = witness(); value.files['answer.json'] = JSON.stringify(publicRehearsalPacket(id).expectedAnswer);
    assert.equal(passed(id, value), false, id);
  }
});
test('S01 requires actual manifest then implementation reads', () => {
  const value = witness(); value.files['answer.json'] = JSON.stringify(publicRehearsalPacket('S01').expectedAnswer);
  value.tools = [tool(1, 'workspace_read', { path: 'package.json' }, {}), tool(2, 'workspace_read', { path: 'src/main.mjs' }, {})];
  assert.equal(passed('S01', value), true); value.tools.reverse(); assert.equal(passed('S01', value), false);
});
test('S02 rejects skipped failure, skipped successful same-check verification and changed checker', () => {
  const value = witness(); value.files['check.mjs'] = publicWorkload('S02').files['check.mjs'];
  const cmd = (sequence: number, success: boolean) => tool(sequence, 'command_run', { executable: '/runtime/node', args: ['check.mjs'] }, { exitCode: success ? 0 : 1 }, success);
  value.tools = [cmd(1, false), tool(2, 'workspace_read', { path: 'sum.mjs' }, { sha256: hash('observed') }), tool(3, 'workspace_write', { path: 'sum.mjs', expectedSha256: hash('observed') }, {}), cmd(4, true)];
  assert.equal(passed('S02', value), true);
  const original = [...value.tools]; value.tools = original.slice(1); assert.equal(passed('S02', value), false);
  value.tools = original.slice(0, 3); assert.equal(passed('S02', value), false);
  value.tools = original; value.files['check.mjs'] = 'process.exit(0)'; assert.equal(passed('S02', value), false);
});
test('S03 requires negative, equal and empty range receipts, not repeated easy checks', () => {
  const value = witness(); value.tools = [['-3', '-1', '-6\n'], ['4', '4', '4\n'], ['4', '2', '0\n']].map(([a, b, stdout], i) => tool(i + 1, 'command_run', { executable: '/runtime/node', args: ['range.mjs', a, b] }, { exitCode: 0, stdout }));
  assert.equal(passed('S03', value), true); value.tools[2] = value.tools[1]; assert.equal(passed('S03', value), false);
});
test('S04 requires a failed read before actual discovery and recovery', () => {
  const value = witness(); value.files['answer.json'] = JSON.stringify(publicRehearsalPacket('S04').expectedAnswer);
  value.tools = [tool(1, 'workspace_read', { path: 'data/value.txt' }, { error: 'missing' }, false), tool(2, 'workspace_discover', {}, {}), tool(3, 'workspace_read', { path: 'data/current/value.txt' }, { content: '29\n' })];
  assert.equal(passed('S04', value), true); value.tools.reverse(); assert.equal(passed('S04', value), false);
});
test('source cases require both real reads and preserved corroboration/correction uncertainty', () => {
  for (const id of ['S05', 'S06'] as const) {
    const value = witness(); value.files['answer.json'] = JSON.stringify(publicRehearsalPacket(id).expectedAnswer);
    value.tools = Object.keys(publicWorkload(id).files).map((path, i) => tool(i + 1, 'workspace_read', { path }, {}));
    assert.equal(passed(id, value), true); value.tools.pop(); assert.equal(passed(id, value), false);
    value.tools = Object.keys(publicWorkload(id).files).map((path, i) => tool(i + 1, 'workspace_read', { path }, {}));
    value.files['answer.json'] = JSON.stringify({ value: 17 }); assert.equal(passed(id, value), false);
  }
});
test('S07 demands observed temporary readback, digest-bound restore and original bytes', () => {
  const value = witness(); value.files['state.txt'] = 'original\n';
  value.tools = [tool(1, 'workspace_read', { path: 'state.txt' }, { content: 'original\n' }), tool(2, 'workspace_write', { path: 'state.txt', content: 'temporary\n', expectedSha256: hash('original\n') }, {}), tool(3, 'workspace_read', { path: 'state.txt' }, { content: 'temporary\n' }), tool(4, 'workspace_write', { path: 'state.txt', content: 'original\n', expectedSha256: hash('temporary\n') }, {})];
  assert.equal(passed('S07', value), true); value.tools.splice(2, 1); assert.equal(passed('S07', value), false);
});
test('fabricated child prose and executable cannot establish actual accepted/rejected children', () => {
  const value = witness(); value.files['double.mjs'] = 'console.log(2 * Number(process.argv[2]));';
  value.tools = [tool(1, 'workspace_write', { path: 'double.mjs', content: value.files['double.mjs'] }, {}), tool(2, 'command_run', { executable: '/runtime/node', args: ['double.mjs', '7'] }, { exitCode: 0, stdout: '14\n' })];
  value.outputs = [{ text: 'Accepted/rejected child results and integrated.' }];
  assert.equal(passed('S10', value), false);
});
test('real communication admission seeds only public files synchronously before queued dispatch; attempt cannot replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-screen-barrier-')); const config = fixtureConfiguration(root, rootSource);
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite')); const authority = authorityStore.bootstrap('pure-barrier', config.controlRevision, config.artifactId);
  let app: AutarkApplication | undefined;
  try {
    // No key, transport fixture, start(), or physical request is used in this pure admission check.
    app = new AutarkApplication({ config, authorityStore, authority, secrets: { directToken: 'pure-unused' } });
    const prepared = seedBeforeDispatch(app, 'S01', 'pure-barrier-initial-1');
    assert.equal(app.runtime.getRun(prepared.runId)?.status, 'ready'); assert.equal(app.store.list('requests').length, 0);
    assert.equal(readFileSync(join(prepared.workspace, 'src/main.mjs'), 'utf8'), publicWorkload('S01').files['src/main.mjs']);
    assert.equal(prepared.publicPreparation.actor, 'host-evaluator'); assert.equal(prepared.publicPreparation.phase, 'before-first-dispatch');
    assert.throws(() => seedBeforeDispatch(app!, 'S01', 'pure-barrier-initial-1'), /cannot reset/);
    await Promise.resolve(); assert.equal(app.store.list('requests').length, 0);
  } finally { await app?.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
test('live driver rejects fixture transport before constructing an application', async () => {
  await assert.rejects(runHostAuthorizedLiveCase({ application: { performRequest: async () => { throw new Error('must never dispatch'); } } } as unknown as Parameters<typeof runHostAuthorizedLiveCase>[0]), /forbids caller-supplied fixture/);
});
test('private packet digest mismatch refuses admission and live mode remains unavailable without independently qualified host grant', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-screen-refusal-')), privateRoot = mkdtempSync(join(tmpdir(), 'aeon-screen-refusal-private-'));
  const config = fixtureConfiguration(root, rootSource), privatePacketPath = join(privateRoot, 'packet.json'); writeFileSync(privatePacketPath, '{}');
  const options = { application: { config } as any, caseId: 'S01' as const, attempt: 1 as const, attemptId: 'refused', mode: 'synthetic-application' as const, observer: { id: 'pure-observer', privateRoot, evaluatorDigest: hash('e'), taskDigest: hash('wrong') }, manifest: { source: hash('s'), dependencies: hash('d'), protocol: hash('p') }, privatePacketPath, timeoutMs: 1000 };
  try {
    await assert.rejects(runScreenCase({ ...options, application: { ...options.application, performRequest: async () => { throw new Error('must never dispatch'); } } }), /packet digest mismatch/);
    await assert.rejects(runScreenCase({ ...options, mode: 'live-public-screen' }), /independently qualified host grant route/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true }); }
});
