import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { CodingAccounting, developmentAllocation } from '../src/coding-accounting.ts';
import type { CodingContract, CodingLane } from '../src/coding-accounting.ts';
import { DevelopmentExecutor } from '../src/development-executor.ts';
import { validateDevelopmentPlan } from '../src/development-plan.ts';
import { GrowthScheduler } from '../src/scheduler.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import type { Provider } from '../src/providers.ts';

const plan = validateDevelopmentPlan(JSON.parse(readFileSync(new URL('../config/development-plan.json', import.meta.url), 'utf8')));
const hex = (n: number) => n.toString(16).padStart(64, '0');
const contract = (id = 'one', lane: CodingLane = { kind: 'plan', cadence: 'hourly', maxCalls: 1 }): CodingContract => ({
  version: 'coding-session/1', sessionId: id, workRootId: 'root', attemptId: `attempt:${id}`, originTaskId: 'origin', taskId: `task:${id}`, lane,
  limits: { maxWorkCalls: 6, maxSessionCalls: 6, maxAttemptCalls: 6, maxAttempts: 2, maxCommands: 3 }, expiresAt: 20_000_000,
  binding: { baseRelease: hex(1), sourceTree: hex(2), workspace: id, provider: 'explicit-fixture', catalog: hex(3), reporting: 'original-scope' },
});
const reserve = (accounting: CodingAccounting, sessionId: string, ordinal: number, validateCurrent: () => void = () => {}) => accounting.reserve(sessionId,
  { requestId: `${sessionId}:request:${ordinal}`, ordinal, intent: { transcriptDigest: hex(ordinal), model: 'explicit-fixture' }, validateCurrent });
function durable() {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-coding-accounting-')); const path = join(dir, 'state.sqlite'); let store = new Store(path); let now = 1;
  return { get store() { return store; }, accounting: () => new CodingAccounting(store, { now: () => now }), time: (value: number) => { now = value; },
    reopen: () => { store.close(); store = new Store(path); }, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); }, path };
}
function legacy(store: Store, now: () => number, calls: () => void) {
  const source = { releaseId: hex(1), sourceDigest: hex(2), baseCommit: 'a'.repeat(40), files: [{ path: 'src/agent/brain.ts', content: 'old' }] };
  return new DevelopmentExecutor({ store, plan, now, proposalCallsPerDay: 1, proposalCadence: 'hourly', proposalCallsPerHour: 1, hasUserWork: () => false,
    readSource: async () => source, checkCurrent: async () => ({ catalogDigest: plan.digest, releaseId: source.releaseId, sourceDigest: source.sourceDigest, evidenceDigest: hex(4),
      checks: [{ id: 'memory-provenance', status: 'failed', detail: 'Missing current provenance' }, { id: 'memory-context-budget', status: 'failed', detail: 'Not yet reached' }] }),
    propose: async () => { calls(); return null; }, enqueue: async () => {}, observe: async () => undefined });
}
function reflection(store: Store, identity = 'reflection-origin'): string {
  store.enqueue({ id: identity, conversationId: 'reflection-scope', source: 'direct', input: 'Consider this question.' });
  store.updateTask(identity, { state: 'running', checkpoint: { calls: 1 } });
  const topic = store.prepareConversationTopics(identity, [{ outcome: { question: 'Which choice?', stance: 'Provisional', rationale: 'Needs evidence', unresolved: ['Remaining check'], status: 'pending' }, reflectionQuestion: 'Compare recorded evidence.' }], [],
    { now: 0, reviewMs: 1, lifetimeMs: 10_000, maxAttempts: 10 })[0]!;
  store.finishConversationTask(identity, 'Acknowledged', { scope: 'reflection-scope', kind: 'episodic', source: `task:${identity}`, confidence: .6, content: 'An actual exchange.' });
  return topic.reflectionId!;
}

test('foreground claims can exclude internal coding tasks and compound writes roll back', () => {
  const f = durable();
  try {
    f.store.enqueue({ id: 'coding', source: 'coding-session', conversationId: 'c', input: 'Code' });
    f.store.enqueue({ id: 'foreground', source: 'direct', conversationId: 'c', input: 'Reply' });
    assert.equal(f.store.claimNext({ excludeSources: ['coding-session'] })?.id, 'foreground'); assert.equal(f.store.task('coding')!.state, 'queued');
    assert.throws(() => f.store.transaction(() => { f.store.appendEvent('fixture.debit', {}); throw Error('rollback'); }), /rollback/);
    assert.equal(f.store.listEvents().some(event => event.type === 'fixture.debit'), false);
    f.store.transaction(() => { f.store.appendEvent('fixture.outer', {}); assert.throws(() => f.store.transaction(() => { f.store.appendEvent('fixture.inner', {}); throw Error('inner'); }), /inner/); });
    assert.equal(f.store.listEvents().some(event => event.type === 'fixture.inner'), false); assert.equal(f.store.listEvents().some(event => event.type === 'fixture.outer'), true);
  } finally { f.cleanup(); }
});

test('async transaction callbacks are rejected and escaped async mutations cannot survive rollback', async () => {
  const f = durable(); let continuation: Promise<void> | undefined; let escaped = '';
  try {
    assert.throws(() => f.store.transaction(async () => { f.store.appendEvent('fixture.async', {}); }), /synchronous/);
    assert.throws(() => f.store.transaction(() => {
      f.store.appendEvent('fixture.before-await', {});
      continuation = (async () => { await Promise.resolve(); try { f.store.appendEvent('fixture.escape', {}); } catch (error) { escaped = String(error); } })();
      return continuation;
    }), /synchronous/);
    await continuation; assert.match(escaped, /Asynchronous transaction continuation/);
    assert.equal(f.store.listEvents().length, 0);
    f.store.transaction(() => f.store.appendEvent('fixture.usable', {})); assert.equal(f.store.listEvents().length, 1);
  } finally { f.cleanup(); }
});

test('legacy and iterative plan consumers exhaust one opportunity in both orders across reopen', async () => {
  for (const first of ['legacy', 'coding']) {
    const f = durable(); let calls = 0;
    try {
      let accounting = f.accounting(); accounting.admit(contract());
      if (first === 'legacy') { await legacy(f.store, () => 1, () => calls++).tick(); assert.equal(reserve(accounting, 'one', 1).disposition, 'blocked'); }
      else { assert.equal(reserve(accounting, 'one', 1).disposition, 'reserved'); assert.equal(await legacy(f.store, () => 1, () => calls++).tick(), null); }
      assert.equal(calls, first === 'legacy' ? 1 : 0); assert.equal(legacy(f.store, () => 1, () => calls++).allocation().used, 1);
      f.reopen(); accounting = f.accounting(); assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 1).used, 1);
      assert.equal(reserve(accounting, 'one', first === 'legacy' ? 1 : 2).disposition, 'blocked');
      assert.equal(accounting.get('one')!.contract.attemptId, 'attempt:one');
    } finally { f.cleanup(); }
  }
});

test('two independent Store owners cannot spend the final plan opportunity or duplicate a request', async () => {
  const f = durable(); const second = new Store(f.path);
  try {
    const a = f.accounting(); const b = new CodingAccounting(second, { now: () => 1 }); a.admit(contract('one')); b.admit(contract('two'));
    const results = await Promise.all([Promise.resolve().then(() => reserve(a, 'one', 1)), Promise.resolve().then(() => reserve(b, 'two', 1))]);
    assert.equal(results.filter(result => result.disposition === 'reserved').length, 1); assert.equal(a.reservations().length, 1);
    const winner = a.reservations()[0]!; assert.equal(reserve(b, winner.sessionId, 1).disposition, 'duplicate');
    assert.throws(() => b.reserve(winner.sessionId, { requestId: winner.id, ordinal: 1, intent: { changed: true }, validateCurrent: () => {} }), /conflicts/);
  } finally { second.close(); f.cleanup(); }
});

test('zero dispatch, uncertain response and invalid tool validation retain debit and coherent usage', () => {
  const f = durable();
  try {
    let a = f.accounting(); a.admit(contract()); const first = reserve(a, 'one', 1); assert.equal(first.disposition, 'reserved');
    a.setReservationOutcome('one', first.reservation!.id, { status: 'not_dispatched', reason: 'Interrupted before transport' });
    f.reopen(); a = f.accounting(); assert.equal(reserve(a, 'one', 1).disposition, 'duplicate'); assert.equal(reserve(a, 'one', 2).disposition, 'blocked');
    f.time(3_600_001); const next = reserve(a, 'one', 2); assert.equal(next.disposition, 'reserved');
    a.setReservationOutcome('one', next.reservation!.id, { status: 'unknown', reason: 'Response lost' });
    a.setReservationOutcome('one', next.reservation!.id, { status: 'observed', usage: { inputTokens: 4, outputTokens: 3 }, reason: 'Observed response; intents rejected' });
    f.reopen(); a = f.accounting(); assert.deepEqual(a.reservations('one')[1]!.usage, { inputTokens: 4, outputTokens: 3 });
    assert.throws(() => a.setReservationOutcome('one', first.reservation!.id, { status: 'reserved' }), /transition/);
    assert.equal(a.reservations('one').length, 2);
  } finally { f.cleanup(); }
});

test('cumulative work and attempt caps survive new sessions, catalog bindings, midnight and missed windows', () => {
  const f = durable();
  try {
    const one = contract(); one.limits = { ...one.limits, maxWorkCalls: 2, maxSessionCalls: 2, maxAttemptCalls: 2 }; one.expiresAt = 300_000_000;
    let a = f.accounting(); a.admit(one); assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
    a.update('one', { state: 'terminal', phase: 'cancelled' }, { expectedRevision: 1 }); f.reopen(); f.time(86_400_001); a = f.accounting();
    const two = { ...one, sessionId: 'two', attemptId: 'attempt:two', taskId: 'task:two', binding: { newCatalog: hex(8), sameWork: true } };
    a.admit(two); assert.equal(reserve(a, 'two', 1).disposition, 'reserved'); f.time(172_800_001);
    assert.equal(reserve(a, 'two', 2).reason, 'workRootId_call_limit');
    assert.equal(a.admit({ ...two, sessionId: 'three', attemptId: 'attempt:three' }).reason, 'attempt_limit');
    assert.throws(() => a.admit({ ...two, sessionId: 'four', attemptId: 'attempt:four', lane: { kind: 'plan', cadence: 'hourly', maxCalls: 2 } }), /work allocation is immutable/);
    assert.throws(() => a.admit({ ...one, sessionId: 'reuse' }), /another draft lineage/);
    assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 172_800_001).remaining, 1, 'unused windows do not bypass cumulative caps');
  } finally { f.cleanup(); }
});

test('authority and expiry are rechecked at the acquired-slot reservation and windows use current time', () => {
  const f = durable();
  try {
    const a = f.accounting(); const c = contract(); c.expiresAt = 7_200_000; a.admit(c);
    assert.throws(() => reserve(a, 'one', 1, () => { throw Error('epoch changed'); }), /epoch changed/); assert.equal(a.reservations().length, 0);
    f.time(3_600_001); const current = reserve(a, 'one', 1); assert.equal((current.reservation!.window as any).startsAt, 3_600_000);
    f.time(6_000_000); assert.equal(reserve(a, 'one', 2, () => f.time(7_200_000)).reason, 'expired');
    assert.equal(a.reservations().length, 1); assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 7_200_000).used, 0);
  } finally { f.cleanup(); }
});

test('ambiguous historical plan timestamps remain conservative and actual coding timestamps do not smear across hours', () => {
  const f = durable();
  try {
    f.store.appendEvent('development.attempt.started', { startsAt: 0, attempt: { id: 'legacy-ambiguous' } });
    assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 10 * 3_600_000).remaining, 0);
    f.store.appendEvent('development.attempt.started', { codingReservationId: 'actual', reservedAt: 86_400_001, startsAt: 86_400_000, cadence: 'daily' });
    assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 86_400_001).used, 1);
    assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 90_000_001).used, 0);
  } finally { f.cleanup(); }
});

test('initial conversation call links once and completed origin retains its original cumulative allowance', () => {
  const f = durable();
  try {
    f.store.enqueue({ id: 'origin', source: 'direct', conversationId: 'c', input: 'Code' });
    f.store.updateTask('origin', { state: 'running', checkpoint: { calls: 2 } });
    f.store.appendEvent('inference.started', { attempt: 1 }, 'origin'); f.store.appendEvent('inference.started', { attempt: 2 }, 'origin');
    const c = contract('one', { kind: 'conversation', taskId: 'origin', maxCalls: 3 }); c.limits.maxWorkCalls = c.limits.maxSessionCalls = c.limits.maxAttemptCalls = 2;
    let a = f.accounting(); a.admit(c, { initialCall: { taskId: 'origin', ordinal: 2 } }); a.admit(c, { initialCall: { taskId: 'origin', ordinal: 2 } });
    assert.equal(f.store.listEvents().filter(event => event.type === 'coding.initial_call.linked').length, 1);
    f.store.updateTask('origin', { state: 'succeeded', output: 'Queued' }); assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
    assert.equal(f.store.listEvents({ taskId: 'origin' }).filter(event => event.type === 'inference.started').length, 3); assert.equal(f.store.task('origin')!.state, 'succeeded');
    f.reopen(); a = f.accounting(); assert.equal(reserve(a, 'one', 2).disposition, 'blocked');
    assert.throws(() => a.admit({ ...c, sessionId: 'two', attemptId: 'attempt:two' }, { initialCall: { taskId: 'origin', ordinal: 2 } }), /already linked/);
  } finally { f.cleanup(); }
});

function chargedGrowth(f: ReturnType<typeof durable>, id = 'independent') {
  const growth = f.store.addGrowth({ id, dimension: 'code_quality', question: 'Inspect evidence', origin: 'standing growth mission v1', budget: 1 });
  f.store.openGrowthWindow({ id: 'fixture:0', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 3 });
  assert.ok(f.store.claimGrowthInWindow(growth.id, 'fixture:0', 1));
  const event = f.store.listEvents().filter(event => event.type === 'growth.window.call_reserved').at(-1)!;
  const originId = `coding-growth:${id}`;
  f.store.enqueue({ id: originId, source: 'coding-origin', conversationId: 'growth', input: 'Inspect evidence' });
  f.store.updateTask(originId, { state: 'running' });
  f.store.appendEvent('coding.growth.origin.admitted', { growthId: growth.id, objective: 'Inspect evidence' }, originId);
  const c = { ...contract('one', { kind: 'growth', schedulerId: 'fixture', windowMs: 100, maxCalls: 3 }), originTaskId: originId, workRootId: originId };
  return { c, growth, event, initialCall: { growthId: growth.id, eventSeq: event.seq } };
}

for (const limit of ['maxWorkCalls', 'maxSessionCalls', 'maxAttemptCalls'] as const) test(`charged growth decision counts toward ${limit} once across reopen without another window debit`, () => {
  const f = durable();
  try {
    const { c, initialCall } = chargedGrowth(f); c.limits[limit] = 1;
    if (limit === 'maxWorkCalls') c.limits.maxSessionCalls = c.limits.maxAttemptCalls = 1;
    let a = f.accounting(); a.admit(c, { initialCall });
    assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1);
    assert.equal(a.reservations().length, 0);
    f.reopen(); a = f.accounting(); a.admit(c, { initialCall });
    assert.equal(f.store.listEvents().filter(event => event.type === 'coding.initial_call.linked').length, 1);
    let target = 'one';
    if (limit === 'maxWorkCalls') {
      // Child caps cannot exceed the root. A fresh child has no session debit,
      // while the original root still owns the charged growth decision.
      a.update('one', { state: 'terminal', phase: 'cancelled' }, { expectedRevision: 1 }); target = 'two';
      a.admit({ ...c, sessionId: target, attemptId: 'attempt:two' });
    }
    assert.equal(reserve(a, target, 1).reason, `${limit === 'maxWorkCalls' ? 'workRootId' : limit === 'maxSessionCalls' ? 'sessionId' : 'attemptId'}_call_limit`);
    assert.equal(a.reservations().length, 0); assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1);
  } finally { f.cleanup(); }
});

test('growth conversion retains the original charged window and cannot relink its decision to a second session', () => {
  const f = durable();
  try {
    const { c, initialCall } = chargedGrowth(f); const a = f.accounting(); f.time(101);
    a.admit(c, { initialCall });
    assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1); assert.equal(f.store.growthWindow('fixture:100'), undefined);
    assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
    assert.equal(f.store.growthWindow('fixture:100')!.usedCalls, 1); assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1);
    assert.throws(() => a.admit({ ...c, sessionId: 'two', attemptId: 'attempt:two' }, { initialCall }), /already linked/);
    assert.equal(a.list().length, 1);
  } finally { f.cleanup(); }
});

test('growth initial link rejects absent, mismatched or conversation-derived reservation and origin provenance atomically', () => {
  for (const invalid of ['missing-event', 'wrong-event-type', 'wrong-growth', 'foreign-origin', 'conversation-growth', 'wrong-scheduler', 'wrong-window', 'wrong-capacity', 'missing-grant', 'mixed-initial'] as const) {
    const f = durable();
    try {
      const { c, growth, initialCall } = chargedGrowth(f); let call: unknown = initialCall;
      if (invalid === 'missing-event') call = { ...initialCall, eventSeq: 1_000_000 };
      if (invalid === 'wrong-event-type') call = { ...initialCall, eventSeq: f.store.listEvents().find(event => event.type === 'growth.added')!.seq };
      if (invalid === 'wrong-growth') call = { ...initialCall, growthId: 'other' };
      if (invalid === 'foreign-origin' || invalid === 'missing-grant') {
        f.store.enqueue({ id: 'foreign', source: invalid === 'foreign-origin' ? 'slack' : 'coding-origin', conversationId: 'growth', input: 'Inspect evidence' }); c.originTaskId = 'foreign';
      }
      if (invalid === 'conversation-growth') {
        // A real charged growth record with a source exchange remains derived;
        // a host event cannot silently turn it into independent growth authority.
        f.store.addGrowth({ id: 'derived', dimension: 'code_quality', question: 'Inspect evidence', origin: 'conversation:foreign', sourceTaskId: 'foreign', budget: 1 });
        assert.ok(f.store.claimGrowthInWindow('derived', 'fixture:0', 1));
        const event = f.store.listEvents().filter(event => event.type === 'growth.window.call_reserved').at(-1)!;
        f.store.enqueue({ id: 'derived-origin', source: 'coding-origin', conversationId: 'growth', input: 'Inspect evidence' });
        f.store.appendEvent('coding.growth.origin.admitted', { growthId: 'derived', objective: 'Inspect evidence' }, 'derived-origin');
        c.originTaskId = 'derived-origin'; call = { growthId: 'derived', eventSeq: event.seq };
      }
      if (invalid === 'wrong-scheduler') c.lane = { ...c.lane as Extract<CodingLane, { kind: 'growth' }>, schedulerId: 'other' };
      if (invalid === 'wrong-window') c.lane = { ...c.lane as Extract<CodingLane, { kind: 'growth' }>, windowMs: 200 };
      if (invalid === 'wrong-capacity') c.lane = { ...c.lane as Extract<CodingLane, { kind: 'growth' }>, maxCalls: 4 };
      if (invalid === 'mixed-initial') call = { ...initialCall, taskId: c.originTaskId, ordinal: 1 };
      assert.throws(() => f.accounting().admit(c, { initialCall: call as any }));
      assert.equal(f.accounting().list().length, 0, invalid); assert.equal(f.store.listEvents().filter(event => event.type === 'coding.initial_call.linked').length, 0, invalid);
      assert.equal(f.store.growth(growth.id)!.state, 'running');
    } finally { f.cleanup(); }
  }
});

test('two Store owners cannot link one charged growth decision to two draft lineages', async () => {
  const f = durable(); const second = new Store(f.path);
  try {
    const { c, initialCall } = chargedGrowth(f); const a = f.accounting(), b = new CodingAccounting(second, { now: () => 1 });
    const results = await Promise.allSettled([Promise.resolve().then(() => a.admit(c, { initialCall })),
      Promise.resolve().then(() => b.admit({ ...c, sessionId: 'two', attemptId: 'attempt:two' }, { initialCall }))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(a.list().length, 1); assert.equal(f.store.listEvents().filter(event => event.type === 'coding.initial_call.linked').length, 1);
    assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1);
  } finally { second.close(); f.cleanup(); }
});

test('growth coding and legacy growth debit the actual shared window in both orders', () => {
  for (const first of ['coding', 'growth']) {
    const f = durable();
    try {
      const a = f.accounting(); a.admit(contract('one', { kind: 'growth', schedulerId: 'fixture', windowMs: 100, maxCalls: 1 }));
      f.store.openGrowthWindow({ id: 'fixture:0', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 });
      if (first === 'coding') assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
      const g = f.store.addGrowth({ id: 'growth', dimension: 'code_quality', question: 'Check evidence', origin: 'standing', budget: 0 });
      if (first === 'growth') { assert.ok(f.store.claimGrowthInWindow(g.id, 'fixture:0', 1)); assert.equal(reserve(a, 'one', 1).disposition, 'blocked'); }
      else assert.equal(f.store.claimGrowthInWindow(g.id, 'fixture:0', 1), undefined);
      assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1); f.reopen(); assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1);
    } finally { f.cleanup(); }
  }
});

test('coding, growth and reflection each advance within three one-call windows across cold reopen', () => {
  const f = durable(); const selected: string[] = []; let codingOrdinal = 0;
  try {
    f.accounting().admit(contract('one', { kind: 'growth', schedulerId: 'fixture', windowMs: 100, maxCalls: 1 }));
    f.store.addGrowth({ id: 'growth', dimension: 'code_quality', question: 'Check evidence', origin: 'standing', budget: 0 }); const reflectionId = reflection(f.store);
    for (let n = 0; n < 6; n++) {
      const now = n * 100 + 1; f.time(now); const id = `fixture:${n * 100}`;
      f.store.openGrowthWindow({ id, schedulerId: 'fixture', startsAt: n * 100, endsAt: n * 100 + 100, maxCalls: 1 });
      const coding = reserve(f.accounting(), 'one', codingOrdinal + 1);
      const growth = f.store.claimGrowthInWindow('growth', id, now); const thought = f.store.claimConversationReflection(reflectionId, id, now);
      const winners = [coding.disposition === 'reserved' ? 'coding' : null, growth ? 'growth' : null, thought ? 'reflection' : null].filter(Boolean);
      assert.equal(winners.length, 1); selected.push(winners[0]!);
      if (coding.disposition === 'reserved') codingOrdinal++;
      if (growth) f.store.updateGrowth('growth', { state: 'paused' });
      if (thought) f.store.updateConversationReflection(reflectionId, { state: 'paused', checkpoint: { reason: 'More evidence needed' } });
      assert.equal(f.store.growthWindow(id)!.usedCalls, 1); f.reopen();
    }
    assert.deepEqual(selected, ['reflection', 'growth', 'coding', 'reflection', 'growth', 'coding']);
  } finally { f.cleanup(); }
});

test('durable revisions reject late responses, terminal revival, malformed versions and SDK state', () => {
  const f = durable();
  try {
    let a = f.accounting(); const c = contract(); a.admit(c, { data: { transcript: [] } });
    const running = a.update('one', { state: 'running', phase: 'response-persisted', data: { transcript: [{ role: 'assistant', text: 'Actual observed response' }] } }, { expectedRevision: 1 });
    assert.throws(() => a.update('one', { phase: 'late' }, { expectedRevision: 1 }), /revision changed/);
    f.reopen(); a = f.accounting(); assert.deepEqual(a.get('one')!.data, running.data);
    a.update('one', { state: 'terminal', phase: 'cancelled' }, { expectedRevision: 2 });
    assert.throws(() => a.update('one', { state: 'running' }, { expectedRevision: 3 }), /revive/);
    assert.throws(() => a.admit({ ...c, version: 'coding-session/2' } as any), /Unsupported/);
    class SDKState { token = 'opaque'; }
    assert.throws(() => a.admit({ ...c, sessionId: 'bad', binding: new SDKState() as any }), /SDK-independent/);
    assert.throws(() => a.admit({ ...c, sessionId: 'infinite', limits: { ...c.limits, maxWorkCalls: Infinity } }), /JSON|finite/);
    assert.throws(() => a.admit({ ...c, sessionId: 'release', lane: { kind: 'release', maxCalls: 8 } as any }), /Unavailable/);
  } finally { f.cleanup(); }
});

test('session and attempt call ceilings independently block additional windows without resetting history', () => {
  for (const limit of ['maxSessionCalls', 'maxAttemptCalls'] as const) {
    const f = durable();
    try {
      const c = contract(); c.limits[limit] = 1; let a = f.accounting(); a.admit(c);
      assert.equal(reserve(a, 'one', 1).disposition, 'reserved'); f.time(3_600_001); f.reopen(); a = f.accounting();
      assert.equal(reserve(a, 'one', 2).reason, limit === 'maxSessionCalls' ? 'sessionId_call_limit' : 'attemptId_call_limit');
      assert.equal(a.reservations('one').length, 1);
    } finally { f.cleanup(); }
  }
});

test('command permits retain cumulative work limits across replacement attempts and zero launches', () => {
  const f = durable();
  try {
    let a = f.accounting(); const c = contract(); c.limits.maxCommands = 1; a.admit(c);
    const command = { operationId: 'one:command:1', intent: { command: 'node', args: ['check.ts'] }, validateCurrent: () => {} };
    assert.equal(a.reserveCommand('one', command).disposition, 'reserved');
    a.update('one', { state: 'terminal', phase: 'cancelled' }, { expectedRevision: 1 });
    f.reopen(); a = f.accounting(); a.admit({ ...c, sessionId: 'two', attemptId: 'attempt:two', taskId: 'task:two' });
    assert.equal(a.reserveCommand('one', command).disposition, 'duplicate');
    assert.equal(a.reserveCommand('two', { ...command, operationId: 'two:command:1' }).reason, 'command_limit');
    assert.throws(() => a.reserveCommand('one', { ...command, intent: { different: true } }), /conflicts/);
    assert.equal(a.reservations().length, 0, 'command reservations do not create provider spending');
  } finally { f.cleanup(); }
});

test('reflection and coding reserve the actual shared capacity in both orders', () => {
  for (const first of ['coding', 'reflection']) {
    const f = durable();
    try {
      const a = f.accounting(); a.admit(contract('one', { kind: 'growth', schedulerId: 'fixture', windowMs: 100, maxCalls: 1 }));
      f.store.openGrowthWindow({ id: 'fixture:0', schedulerId: 'fixture', startsAt: 0, endsAt: 100, maxCalls: 1 });
      if (first === 'coding') assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
      const id = reflection(f.store);
      if (first === 'reflection') { assert.ok(f.store.claimConversationReflection(id, 'fixture:0', 1)); assert.equal(reserve(a, 'one', 1).disposition, 'blocked'); }
      else assert.equal(f.store.claimConversationReflection(id, 'fixture:0', 1), undefined);
      assert.equal(f.store.growthWindow('fixture:0')!.usedCalls, 1);
    } finally { f.cleanup(); }
  }
});

test('exhausted and stalled coding sessions cannot hold a durable growth turn after reopen', () => {
  const f = durable();
  try {
    let a = f.accounting(); const c = contract('one', { kind: 'growth', schedulerId: 'fixture', windowMs: 100, maxCalls: 1 }); c.limits.maxSessionCalls = 1;
    a.admit(c); assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
    const g = f.store.addGrowth({ id: 'growth', dimension: 'code_quality', question: 'Evidence?', origin: 'standing', budget: 0 });
    f.time(101); f.reopen(); a = f.accounting(); f.store.openGrowthWindow({ id: 'fixture:100', schedulerId: 'fixture', startsAt: 100, endsAt: 200, maxCalls: 1 });
    assert.ok(f.store.claimGrowthInWindow(g.id, 'fixture:100', 101));
    a.admit({ ...c, sessionId: 'two', attemptId: 'attempt:two' }); a.update('two', { state: 'paused', phase: 'provider-wait', nextEligibleAt: null }, { expectedRevision: 1 });
    f.store.updateGrowth(g.id, { state: 'paused' }); f.time(201); f.reopen();
    f.store.openGrowthWindow({ id: 'fixture:200', schedulerId: 'fixture', startsAt: 200, endsAt: 300, maxCalls: 1 });
    assert.ok(f.store.claimGrowthInWindow(g.id, 'fixture:200', 201));
  } finally { f.cleanup(); }
});

test('state changes during authority validation cannot authorize a stale dispatch intent', () => {
  const f = durable();
  try {
    const a = f.accounting(); a.admit(contract());
    assert.throws(() => reserve(a, 'one', 1, () => { a.update('one', { state: 'terminal', phase: 'cancelled' }, { expectedRevision: 1 }); }), /changed during/);
    assert.equal(a.reservations().length, 0); assert.equal(a.get('one')!.state, 'ready', 'failed atomic callback rolls back its own untrusted writes');
    assert.throws(() => reserve(a, 'one', 1, async () => {}), /synchronous/); assert.equal(a.reservations().length, 0);
  } finally { f.cleanup(); }
});

test('independent legacy executors cannot concurrently reuse one attempt identity', async () => {
  const f = durable(); let calls = 0;
  try {
    const options = { store: f.store, plan, now: () => 1, proposalCallsPerDay: 2, proposalCadence: 'hourly' as const, proposalCallsPerHour: 2, hasUserWork: () => false,
      readSource: async () => ({ releaseId: hex(1), sourceDigest: hex(2), baseCommit: 'a'.repeat(40), files: [{ path: 'src/agent/brain.ts', content: 'old' }] }),
      checkCurrent: async () => ({ catalogDigest: plan.digest, releaseId: hex(1), sourceDigest: hex(2), evidenceDigest: hex(4), checks: [{ id: 'memory-provenance' as const, status: 'failed' as const, detail: 'Needs repair' }] }),
      propose: async () => { calls++; return null; }, enqueue: async () => {}, observe: async () => undefined };
    await Promise.all([new DevelopmentExecutor(options).tick(), new DevelopmentExecutor(options).tick()]);
    assert.equal(calls, 1); assert.equal(f.store.listEvents().filter(event => event.type === 'development.attempt.started').length, 1);
  } finally { f.cleanup(); }
});

test('actual background scheduler and coding continuation share a live turn without an initial tie deadlock', async () => {
  const f = durable(); const selected: string[] = []; let now = 1; let ordinal = 0;
  const provider: Provider = { name: 'fixture', async complete(request) {
    const kind = request.system.includes('Reflect on the retained') ? 'reflection' : 'growth'; selected.push(kind);
    const text = kind === 'reflection' ? JSON.stringify({ stance: 'Provisional', rationale: 'Evidence observed.', unresolved: ['More evidence'], status: 'pending', evidence: 'Actual deterministic response.', actions: [] })
      : JSON.stringify({ observation: 'Current evidence', lesson: 'Provisional lesson', nextQuestion: 'Continue inquiry', proposedChange: null });
    return { text, provider: 'fixture', model: 'explicit-fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  try {
    f.accounting().admit(contract('one', { kind: 'growth', schedulerId: 'fixture', windowMs: 100, maxCalls: 1 }));
    for (let n = 0; n < 3; n++) reflection(f.store, `reflection:${n}`);
    for (let n = 0; n < 6; n++) {
      now = n * 100 + 1; f.time(now);
      const continuity = new ConversationContinuity({ store: f.store, provider, now: () => now });
      const scheduler = new GrowthScheduler({ store: f.store, provider, schedulerId: 'fixture', windowMs: 100, callsPerWindow: 1, now: () => now, hasUserWork: () => false, conversationContinuity: continuity });
      await scheduler.tick();
      if (reserve(f.accounting(), 'one', ordinal + 1).disposition === 'reserved') { ordinal++; selected.push('coding'); }
      assert.equal(f.store.growthWindow(`fixture:${n * 100}`)!.usedCalls, 1, 'one eligible consumer makes progress per window');
      await scheduler.stop(); f.reopen();
    }
    assert.deepEqual(selected, ['reflection', 'growth', 'coding', 'reflection', 'growth', 'coding']);
  } finally { f.cleanup(); }
});

test('a paused session cannot spend a late queued model or command request until explicit resumption', () => {
  const f = durable();
  try {
    const a = f.accounting(); a.admit(contract()); a.update('one', { state: 'paused', phase: 'preempted', nextEligibleAt: 1 }, { expectedRevision: 1 });
    assert.equal(reserve(a, 'one', 1).reason, 'paused');
    assert.equal(a.reserveCommand('one', { operationId: 'late-command', intent: { command: 'node' }, validateCurrent: () => {} }).disposition, 'blocked');
    assert.equal(a.reservations().length, 0); assert.equal(developmentAllocation(f.store, { cadence: 'hourly', maxCalls: 1 }, 1).used, 0);
    a.update('one', { state: 'running', phase: 'model-intended' }, { expectedRevision: 2 }); assert.equal(reserve(a, 'one', 1).disposition, 'reserved');
  } finally { f.cleanup(); }
});
