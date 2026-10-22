import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodingLimb, type CodingOwner, type CodingSession, type CodingTurn } from './coding-limb.ts';
import type { CodingResult } from '../packages/coding/index.ts';
import type { JsonValue, ShellPort } from '../packages/contracts/index.ts';
import { authority, envelope, input, prompt, setup } from '../packages/runtime/test/fixtures.ts';

const nativeSessionId = '11111111-2222-4333-8444-555555555555';
const result = (status: CodingResult['status'] = 'completed'): CodingResult => ({ provider: 'codex', sessionId: nativeSessionId, status,
  summary: 'Changed calculator.ts and ran its test.', events: [{ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'calculator.ts', kind: 'update' }] } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'node --test calculator.test.ts', exit_code: 0, aggregated_output: 'pass 1' } }],
  stdout: 'retained raw evidence', stderr: '', exitCode: 0, elapsedMs: 7,
  usage: { inputTokens: 20, outputTokens: 10, cachedInputTokens: 0, costUsd: null, physicalRequests: null } });
type Execute = (session: CodingSession, turn: CodingTurn, signal: AbortSignal) => Promise<CodingResult>;
function fixture(execute: Execute = async () => result()) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-coding-limb-'));
  let limb!: CodingLimb;
  let next: { id: string; message: string; sessionId?: string } | undefined;
  let nextStatus: 'completed' | 'blocked' = 'completed';
  let owner!: CodingOwner;
  const shell: ShellPort = { async run({ run }, bridge) {
    const command = next; next = undefined;
    const observations = command ? [await bridge.execute({ id: command.id, runId: run.id, stepId: command.id, name: 'develop',
      arguments: { message: command.message, ...(command.sessionId ? { sessionId: command.sessionId } : {}) } })] : [];
    const status = nextStatus; nextStatus = 'completed';
    return limb.preserveWaiting(run.id, { status, observations });
  } };
  const state = setup(join(root, 'state.sqlite'), shell, async effect => {
    const args = effect.payload as { message: string; sessionId?: string };
    return { outcome: 'succeeded', value: limb.submit(owner, effect.id, args.message, args.sessionId) };
  });
  const run = state.runtime.admit(input, authority, envelope);
  owner = { key: 'conversation:owner', runId: run.id, workspace: join(root, 'workspace'), scope: input.scope, authority };
  const options = { store: state.store, runtime: state.runtime, provider: 'codex' as const, now: () => 1234,
    assertAuthority: (grant: typeof authority) => state.effects.fence.assert(grant), execute };
  limb = new CodingLimb(options);
  return { ...state, root, owner, run, get limb() { return limb; },
    restartLimb() { limb = new CodingLimb(options); return limb; },
    async blockOwner() { nextStatus = 'blocked'; return state.runtime.resume(run.id, prompt); },
    async enqueue(id = 'first', message = 'Repair the calculator', sessionId?: string) {
      next = { id, message, ...(sessionId ? { sessionId } : {}) };
      return state.runtime.resume(run.id, prompt);
    },
    async close() { await limb.close(); state.store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
async function settled(limb: CodingLimb): Promise<void> {
  for (let count = 0; count < 100 && limb.busy; count++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(limb.busy, false, 'coding executor must settle');
}
function current(f: ReturnType<typeof fixture>) { return f.store.list<CodingTurn>('host.coding-turns').at(-1)!.value; }

test('configured development audiences authorize the initial binding before any session or turn exists', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return result(); });
  try {
    for (const sharedAudiences of [[], [{ kind: 'restricted' as const, principals: ['another-audience'] }]]) {
      const denied = new CodingLimb({ ...f.limb.options, sharedAudiences });
      assert.throws(() => denied.bind(f.owner, 'initial-denied'), /Initial coding scope is outside configured development audiences/);
      assert.equal(f.store.list('host.coding-sessions').length, 0);
      assert.equal(f.store.list('host.coding-turns').length, 0);
    }
    const allowed = new CodingLimb({ ...f.limb.options, sharedAudiences: [f.owner.scope] });
    const session = allowed.bind(f.owner, 'initial-allowed');
    assert.equal(session.owner, f.owner.key);
    assert.deepEqual(session.scope, f.owner.scope);
    assert.equal(f.store.list('host.coding-sessions').length, 1);
    assert.equal(f.store.list('host.coding-turns').length, 0);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('coding acknowledgement is durable before dispatch; repeated identity cannot create another agent', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return result(); });
  try {
    assert.equal((await f.enqueue()).status, 'waiting');
    assert.equal(calls, 0);
    assert.equal(f.effects.get('tool:first')?.status, 'succeeded');
    assert.equal(f.limb.workspaceLocked(f.owner.workspace), true);
    const session = f.limb.session()!;
    const duplicate = f.limb.submit(f.owner, 'tool:first', 'Repair the calculator') as { sessionId: string };
    assert.equal(duplicate.sessionId, session.id);
    assert.equal(f.store.list('host.coding-sessions').length, 1);
    assert.equal(f.store.list('host.coding-turns').length, 1);
    f.limb.tick(false); assert.equal(calls, 0);
    f.limb.tick(); await settled(f.limb);
    assert.equal(calls, 1); assert.equal(current(f).status, 'completed');
    assert.equal(f.limb.workspaceLocked(f.owner.workspace), false);
    f.limb.tick(); await settled(f.limb); assert.equal(calls, 1);
    const status = f.limb.status(f.owner, 0, 1) as unknown as { nativeSessionId: string; result: { events: JsonValue[]; eventCount: number; nextOffset: number; artifact: CodingTurn['result'] } };
    assert.equal(status.nativeSessionId, nativeSessionId);
    assert.equal(status.result.eventCount, 2); assert.equal(status.result.nextOffset, 1);
    assert.match(JSON.stringify(status.result.events), /file_change/);
    assert.match(JSON.stringify(f.limb.status(f.owner, 1, 1)), /command_execution/);
    assert.equal(f.store.readJsonArtifact<CodingResult>(status.result.artifact!).stdout, 'retained raw evidence');
  } finally { await f.close(); }
});

for (const processStopped of [true, false, undefined]) test(`develop_status exposes retained uncertain session and cleanup metadata (${processStopped})`, async () => {
  const retained = { ...result('uncertain'), processStopped, exitCode: null,
    events: [{ type: 'thread.started', thread_id: nativeSessionId }] };
  const f = fixture(async () => retained);
  try {
    await f.enqueue(); f.limb.tick(); await settled(f.limb);
    const status = f.limb.status(f.owner) as unknown as { sessionId: string; nativeSessionId: string;
      result: { sessionId: string; processStopped: boolean | null; status: string; artifact: NonNullable<CodingTurn['result']> } };
    assert.equal(status.sessionId, f.limb.session()!.id);
    assert.notEqual(status.sessionId, nativeSessionId);
    assert.equal(status.nativeSessionId, nativeSessionId);
    assert.equal(status.result.sessionId, nativeSessionId);
    assert.equal(status.result.processStopped, processStopped ?? null);
    assert.equal(status.result.status, 'uncertain');
    assert.deepEqual(f.store.readJsonArtifact(status.result.artifact), JSON.parse(JSON.stringify(retained)));
    assert.equal(f.limb.workspaceLocked(f.owner.workspace), true);
    assert.throws(() => f.limb.submit(f.owner, 'held-after-status', 'Continue'), /requires host inspection/);
    assert.equal(f.store.list('host.coding-abandonments').length, 0);
  } finally { await f.close(); }
});

test('follow-up addresses the same durable native session and cannot change its identity', async () => {
  const seen: Array<{ id?: string; workspace: string; message: string }> = [];
  const f = fixture(async (session, turn) => { seen.push({ id: session.nativeSessionId, workspace: session.workspace, message: turn.message }); return result(); });
  try {
    await f.enqueue(); f.limb.tick(); await settled(f.limb); f.limb.wake();
    const session = f.limb.session()!;
    assert.throws(() => f.limb.submit(f.owner, 'tool:wrong', 'Adjustment', 'another-session'), /existing coding session/);
    assert.equal((await f.enqueue('followup', 'Also cover negative numbers', session.id)).status, 'waiting');
    f.limb.tick(); await settled(f.limb);
    assert.deepEqual(seen, [{ id: undefined, workspace: f.owner.workspace, message: 'Repair the calculator' },
      { id: nativeSessionId, workspace: f.owner.workspace, message: 'Also cover negative numbers' }]);
    assert.equal(f.store.list('host.coding-sessions').length, 1);
    assert.equal(f.limb.session()!.id, session.id);
    assert.equal(current(f).sequence, 2);
    assert.throws(() => f.limb.updateSession({ nativeSessionId: 'different' }), /identity cannot change/);
  } finally { await f.close(); }
});

test('status, follow-up and cancellation reject other conversations or disclosure scopes', async () => {
  const f = fixture();
  try {
    await f.enqueue();
    for (const foreign of [{ ...f.owner, key: 'another-conversation' }, { ...f.owner, scope: { kind: 'restricted' as const, principals: ['outsider'] } }]) {
      assert.throws(() => f.limb.status(foreign), /another conversation or scope/);
      assert.throws(() => f.limb.cancel(foreign), /another conversation or scope/);
      assert.throws(() => f.limb.submit(foreign, 'foreign', 'Inspect private output'), /another conversation or scope/);
    }
    assert.throws(() => f.limb.status(f.owner, -1), /Bounded event/);
    assert.throws(() => f.limb.status(f.owner, 0, 51), /Bounded event/);
  } finally { await f.close(); }
});

test('lost running turn becomes uncertain at recovery and is never automatically replayed', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return result(); });
  try {
    await f.enqueue();
    const row = f.store.get<CodingTurn>('host.coding-turns', 'tool:first')!;
    f.store.put('host.coding-turns', 'tool:first', { ...row.value, status: 'running' }, row.revision);
    f.restartLimb(); f.limb.tick(); await settled(f.limb);
    assert.equal(calls, 0); assert.equal(current(f).status, 'uncertain');
    assert.equal(f.limb.workspaceLocked(f.owner.workspace), true);
    assert.throws(() => f.limb.submit(f.owner, 'tool:retry', 'Try again'), /requires host inspection/);
    f.limb.wake(); f.limb.wake();
    assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 1);
  } finally { await f.close(); }
});

test('coding result wakes only a waiting owner and the stable event is delivered once', async () => {
  const f = fixture();
  try {
    await f.enqueue(); f.limb.tick(); await settled(f.limb);
    const claimed = f.runtime.prepareResume(f.run.id);
    assert.equal(claimed.run.status, 'running');
    f.limb.wake(); assert.equal(current(f).notified, false);
    assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 0);
    assert.equal((await claimed.execute(prompt)).status, 'waiting');
    f.limb.wake(); f.limb.wake();
    assert.equal(current(f).notified, true);
    assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 1);
    assert.deepEqual(f.store.get('host.pending-runs', f.run.id)?.value, { requestedAt: 1234 });
    assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'completed');
  } finally { await f.close(); }
});

test('queued cancellation never launches a provider and active cancellation reaches its signal', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return result(); });
  try {
    await f.enqueue(); assert.deepEqual(f.limb.cancel(f.owner), { cancelled: true, turnId: 'tool:first', sessionRetained: true });
    f.limb.tick(); await settled(f.limb); assert.equal(calls, 0); assert.equal(current(f).status, 'cancelled');
  } finally { await f.close(); }
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const active = fixture(async (_session, _turn, signal) => {
    entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return result('cancelled');
  });
  try {
    await active.enqueue(); active.limb.tick(); await started;
    active.limb.tick(); assert.equal(active.limb.busy, true, 'an active turn retains the one execution slot');
    active.limb.cancel(active.owner); await settled(active.limb);
    assert.equal(current(active).status, 'cancelled'); assert.equal(active.limb.session()?.nativeSessionId, nativeSessionId);
  } finally { await active.close(); }
});

test('parent cancellation and authority withdrawal stop queued coding before external work', async () => {
  for (const withdrawal of ['cancel', 'fence'] as const) {
    let calls = 0;
    const f = fixture(async () => { calls++; return result(); });
    try {
      await f.enqueue();
      if (withdrawal === 'cancel') f.runtime.cancel(f.run.id, 'alice', 'Stop coding'); else f.withdraw();
      f.limb.tick(); f.limb.wake(); await settled(f.limb);
      assert.equal(calls, 0); assert.equal(current(f).status, 'cancelled');
      assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 0);
    } finally { await f.close(); }
  }
});

test('an executor failure remains visible in develop_status with unknown accounting', async () => {
  const f = fixture(async () => { throw new Error('Injected host executable unavailable'); });
  try {
    await f.enqueue(); f.limb.tick(); await settled(f.limb);
    const status = f.limb.status(f.owner) as unknown as { result: CodingResult };
    assert.equal(status.result.status, 'uncertain'); assert.match(status.result.summary, /Injected host executable unavailable/);
    assert.equal(status.result.sessionId, null); assert.equal(status.result.processStopped, null);
    assert.deepEqual(status.result.events, []); assert.equal(status.result.usage.costUsd, null); assert.equal(status.result.usage.physicalRequests, null);
  } finally { await f.close(); }
});

test('host adoption rebinds a never-dispatched queued turn but cannot replay an interrupted turn', async () => {
  const seen: CodingTurn[] = [];
  const f = fixture(async (_session, turn) => { seen.push(turn); return result(); });
  try {
    await f.enqueue(); const next = f.withdraw(); f.runtime.adopt(f.run.id, next);
    f.limb.tick(); await settled(f.limb);
    assert.equal(seen.length, 1); assert.deepEqual(seen[0]!.authority, next); assert.deepEqual(current(f).authority, next);
    assert.equal(current(f).dispatched, true); assert.equal(current(f).status, 'completed');
  } finally { await f.close(); }
  let calls = 0;
  const interrupted = fixture(async () => { calls++; return result(); });
  try {
    await interrupted.enqueue();
    const row = interrupted.store.get<CodingTurn>('host.coding-turns', 'tool:first')!;
    interrupted.store.put('host.coding-turns', 'tool:first', { ...row.value, status: 'running', dispatched: true }, row.revision);
    interrupted.restartLimb(); const next = interrupted.withdraw(); interrupted.runtime.adopt(interrupted.run.id, next);
    interrupted.limb.tick(); await settled(interrupted.limb);
    assert.equal(calls, 0); assert.equal(current(interrupted).status, 'uncertain'); assert.deepEqual(current(interrupted).authority, authority);
  } finally { await interrupted.close(); }
});

test('a result supplies new evidence to its blocked owner without re-running the coding turn', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return result(); });
  try {
    await f.enqueue(); assert.equal((await f.blockOwner()).status, 'blocked');
    f.limb.tick(); await settled(f.limb); f.limb.wake(); f.limb.wake();
    assert.equal(calls, 1); assert.equal(current(f).notified, true);
    assert.equal(f.store.events(f.run.id).filter(event => event.type === 'steering').length, 1);
    assert.ok(f.store.get('host.pending-runs', f.run.id));
    assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'completed');
    f.limb.tick(); await settled(f.limb); assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('cancelling before the first dispatch preserves the unused session for one explicit new task', async () => {
  const started: Array<string | undefined> = [];
  const f = fixture(async session => { started.push(session.nativeSessionId); return result(); });
  try {
    await f.enqueue(); const sessionId = f.limb.session()!.id;
    f.limb.cancel(f.owner); f.limb.tick(); assert.equal(started.length, 0);
    assert.equal(current(f).dispatched, undefined);
    await f.enqueue('replacement', 'A revised finite task', sessionId);
    f.limb.tick(); await settled(f.limb);
    assert.deepEqual(started, [undefined]); assert.equal(f.store.list('host.coding-sessions').length, 1);
    assert.equal(f.limb.session()!.id, sessionId); assert.equal(f.limb.session()!.nativeSessionId, nativeSessionId);
    assert.equal(current(f).status, 'completed'); assert.equal(current(f).dispatched, true);
  } finally { await f.close(); }
});

test('an explicit stopped-turn acknowledgement retains uncertainty and permits only a later same-session message', async () => {
  const nativeIds: (string | undefined)[] = [];
  const f = fixture(async session => { nativeIds.push(session.nativeSessionId); return nativeIds.length === 1
    ? { ...result('uncertain'), processStopped: true, exitCode: null, events: [{ type: 'thread.started', thread_id: nativeSessionId }] }
    : result(); });
  try {
    await f.enqueue(); f.limb.tick(); await settled(f.limb);
    const turn = current(f), original = f.store.get('host.coding-turns', turn.id), requests = f.store.list('requests');
    const acknowledge = { turnId: turn.id, resultSha256: turn.result!.sha256 };
    assert.deepEqual(f.limb.cancel(f.owner), { cancelled: false, reason: 'No coding turn is active' });
    assert.throws(() => f.limb.submit(f.owner, 'held', 'Continue'), /requires host inspection/);
    assert.throws(() => f.limb.cancel(f.owner, { ...acknowledge, resultSha256: '0'.repeat(64) }), /Exact visible uncertain coding result acknowledgement required/);
    const disposition = f.limb.cancel(f.owner, acknowledge);
    assert.deepEqual(f.limb.cancel(f.owner, acknowledge), disposition);
    assert.deepEqual(f.store.get('host.coding-turns', turn.id), original);
    assert.deepEqual(f.store.list('requests'), requests);
    assert.equal(f.limb.workspaceLocked(f.owner.workspace), false);
    f.restartLimb().tick(); await settled(f.limb); assert.equal(nativeIds.length, 1, 'abandonment never retries original work');
    await f.enqueue('explicit-followup', 'Inspect the existing partial state.', f.limb.session()!.id);
    f.limb.tick(); await settled(f.limb);
    assert.deepEqual(nativeIds, [undefined, nativeSessionId]);
    assert.equal(f.store.get<CodingTurn>('host.coding-turns', turn.id)!.value.status, 'uncertain');
    assert.equal(f.store.list('host.coding-abandonments').length, 1);
  } finally { await f.close(); }
});

for (const variant of ['no-cleanup', 'no-ack', 'foreign-ack', 'pi', 'wrong-audience', 'stale-authority'] as const) test(`uncertain abandonment rejects ${variant} without changing the hold`, async () => {
  const f = fixture(async () => ({ ...result('uncertain'), provider: variant === 'pi' ? 'pi' : 'codex', processStopped: variant !== 'no-cleanup',
    events: variant === 'no-ack' ? [] : [{ type: 'thread.started', thread_id: variant === 'foreign-ack' ? 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' : nativeSessionId }] }));
  try {
    await f.enqueue(); f.limb.tick(); await settled(f.limb);
    const turn = current(f), rows = f.store.list('host.coding-turns');
    const owner = variant === 'wrong-audience' ? { ...f.owner, scope: { kind: 'restricted' as const, principals: ['other'] } } : variant === 'stale-authority' ? { ...f.owner, authority: { ...f.owner.authority, epoch: f.owner.authority.epoch + 1 } } : f.owner;
    assert.throws(() => f.limb.cancel(owner, { turnId: turn.id, resultSha256: turn.result!.sha256 }));
    assert.equal(f.store.list('host.coding-abandonments').length, 0); assert.deepEqual(f.store.list('host.coding-turns'), rows);
    assert.equal(f.limb.workspaceLocked(f.owner.workspace), true);
  } finally { await f.close(); }
});

test('stopped uncertainty cannot release a message queued before inspection', async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => { calls++; await gate; return { ...result('uncertain'), processStopped: true, events: [{ type: 'thread.started', thread_id: nativeSessionId }] }; });
  try {
    await f.enqueue(); f.limb.tick(); await f.enqueue('pre-timeout-queue', 'A second queued request.');
    release(); await settled(f.limb);
    const turn = f.store.list<CodingTurn>('host.coding-turns').find(row => row.value.status === 'uncertain')!.value;
    const acknowledgement = { turnId: turn.id, resultSha256: turn.result!.sha256 };
    assert.throws(() => f.limb.cancel(f.owner, acknowledgement), /Cancel queued or running/);
    assert.equal(f.store.list('host.coding-abandonments').length, 0);
    f.restartLimb().tick(); await settled(f.limb); assert.equal(calls, 1);
    f.limb.cancel(f.owner); f.limb.cancel(f.owner, acknowledgement); f.limb.tick(); await settled(f.limb);
    assert.equal(calls, 1); assert.equal(current(f).status, 'cancelled');
  } finally { release(); await f.close(); }
});

test('atomic coding claim stays queued during operator activation and probation without relying on the application gate', async () => {
  const f = fixture();
  try {
    await f.enqueue();
    const requests = f.store.list('requests');
    for (const status of ['activating', 'reviewing']) {
      const row = f.store.get('host.control-continuations', 'operator');
      f.store.put('host.control-continuations', 'operator', { request: { id: 'operator' }, status }, row?.revision ?? null);
      f.limb.tick();
      assert.equal(f.limb.busy, false);
      assert.equal(current(f).status, 'queued');
      assert.deepEqual(f.store.list('requests'), requests);
    }
    const row = f.store.get('host.control-continuations', 'operator')!;
    f.store.put('host.control-continuations', 'operator', { request: { id: 'operator' }, status: 'accepted' }, row.revision);
    f.limb.tick(); await settled(f.limb);
    assert.equal(current(f).status, 'completed');
  } finally { await f.close(); }
});
