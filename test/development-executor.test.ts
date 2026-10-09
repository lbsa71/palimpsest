import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { validateDevelopmentPlan } from '../src/development-plan.ts';
import { DevelopmentExecutor } from '../src/development-executor.ts';
import type { DevelopmentAttempt, DevelopmentEvidence, DevelopmentReleaseObservation, DevelopmentSource } from '../src/development-executor.ts';

const plan = validateDevelopmentPlan(JSON.parse(readFileSync(new URL('../config/development-plan.json', import.meta.url), 'utf8')));
const hex = (n: number) => n.toString(16).padStart(64, '0');
const proposal = (content = 'new cognitive source') => ({ summary: 'Preserve provenance', rationale: 'Observed descriptor fields are missing.', acceptanceCriteria: ['Current lineage stays exact.'], files: [{ path: 'src/agent/brain.ts', content }] });
function fixture(store = new Store(':memory:')) {
  let now = 1_000_000; let users = false; let calls = 0; let sourceNumber = 0;
  let source: DevelopmentSource = { releaseId: hex(1), sourceDigest: hex(2), baseCommit: 'a'.repeat(40), files: [{ path: 'src/agent/brain.ts', content: 'old source' }] };
  const outcomes = new Map<string, DevelopmentReleaseObservation>(); const enqueued: DevelopmentAttempt[] = [];
  const evidence = (target = source): DevelopmentEvidence => ({ catalogDigest: plan.digest, releaseId: target.releaseId, sourceDigest: target.sourceDigest, evidenceDigest: hex(9), checks: [
    { id: 'memory-provenance', status: sourceNumber >= 1 ? 'passed' : 'failed', detail: sourceNumber >= 1 ? 'Current descriptor retained exact fields' : 'Missing version/evidence/updatedAt' },
    { id: 'memory-context-budget', status: sourceNumber >= 2 ? 'passed' : 'failed', detail: sourceNumber >= 2 ? 'Fresh UTF-8 bounds passed' : 'Unicode context exceeds 32768 bytes' },
  ] });
  const options = {
    store, plan, proposalCallsPerDay: 4, now: () => now, hasUserWork: () => users,
    readSource: async () => structuredClone(source), checkCurrent: async (s: DevelopmentSource) => evidence(s),
    propose: async (_input: unknown) => { calls++; return proposal(); },
    enqueue: async (attempt: DevelopmentAttempt) => { if (!enqueued.some(a => a.id === attempt.id)) enqueued.push(attempt); },
    observe: async (attempt: DevelopmentAttempt) => outcomes.get(attempt.id),
  };
  const complete = (attempt: DevelopmentAttempt, n: number) => {
    sourceNumber = n; source = { releaseId: hex(10 + n), sourceDigest: hex(20 + n), baseCommit: String(n).repeat(40), files: [{ path: 'src/agent/brain.ts', content: `admitted source ${n}` }] };
    const observation: DevelopmentReleaseObservation = { attemptId: attempt.id, growthId: attempt.growthId!, catalogDigest: plan.digest, status: 'promoted', reason: 'Observed known-good successor',
      candidateId: source.releaseId, candidateSourceDigest: source.sourceDigest, evidence: evidence(), publication: { status: 'published', publishedSourceDigest: source.sourceDigest, commit: source.baseCommit } };
    outcomes.set(attempt.id, observation); return observation;
  };
  return { store, options, enqueued, outcomes, evidence, complete, calls: () => calls, source: () => source, setSource: (s: DevelopmentSource) => { source = s; },
    setNow: (n: number) => { now = n; }, advance: () => { now += 60_000; }, users: (value: boolean) => { users = value; } };
}

test('autonomous dependency-linked work requires exact checked promoted publication and survives restart', async () => {
  const base = mkdtempSync(join(tmpdir(), 'palimpsest-development-executor-')); const path = join(base, 'state.sqlite');
  const f = fixture(new Store(path));
  try {
    let executor = new DevelopmentExecutor(f.options);
    const first = await executor.tick(); assert.equal(first?.itemId, 'P06-memory-provenance'); assert.equal(first?.state, 'queued');
    assert.equal(f.calls(), 1); const recorded = f.store.growth(first!.growthId!)!; assert.equal(recorded.state, 'completed');
    assert.deepEqual((recorded.outcome as any).development, { catalogDigest: plan.digest, itemId: first!.itemId, attemptId: first!.id });
    assert.deepEqual((recorded.outcome as any).sourceBinding, { version: 1, releaseDigest: first!.source.releaseId, sourceDigest: first!.source.sourceDigest, baseCommit: first!.source.baseCommit });
    const observation = f.complete(first!, 1); observation.publication.status = 'pending';
    assert.equal((await executor.tick())?.state, 'queued'); assert.equal(f.calls(), 1, 'unpublished promotion holds further authoring');
    observation.publication.status = 'published';
    assert.equal((await executor.tick())?.state, 'completed');
    f.store.close(); const reopened = new Store(path);
    executor = new DevelopmentExecutor({ ...f.options, store: reopened }); executor.recoverInterrupted();
    const second = await executor.tick(); assert.equal(second?.itemId, 'P06-memory-context-budget'); assert.equal(second?.source.sourceDigest, f.source().sourceDigest);
    f.complete(second!, 2); assert.equal((await executor.tick())?.state, 'completed');
    assert.equal(await executor.tick(), null); assert.equal(f.calls(), 2);
    reopened.close();
  } finally { f.store.close(); rmSync(base, { recursive: true, force: true }); }
});

test('failed release feedback reaches a new allocated attempt after cooldown and finite ceiling', async () => {
  const f = fixture(); const inputs: any[] = [];
  const executor = new DevelopmentExecutor({ ...f.options, propose: async input => { inputs.push(input); return proposal(); } });
  try {
    for (let n = 0; n < 3; n++) {
      const attempt = await executor.tick(); assert.equal(attempt?.ordinal, n + 1);
      f.outcomes.set(attempt!.id, { attemptId: attempt!.id, growthId: attempt!.growthId!, catalogDigest: plan.digest, status: 'declined', reason: 'Authoritative Unicode fixture exceeded bound', publication: { status: 'disabled' } });
      assert.equal((await executor.tick())?.state, 'paused');
      assert.equal(await executor.tick(), null, 'cooldown prevents immediate retry'); f.advance();
    }
    assert.equal(await executor.tick(), null, 'three-attempt ceiling does not refill');
    assert.match(JSON.stringify(inputs[1].feedback), /Authoritative Unicode fixture exceeded bound/);
    assert.match(JSON.stringify(inputs[1].feedback), /Missing version\/evidence\/updatedAt/);
  } finally { f.store.close(); }
});

test('provider interruption consumes durable allocation without replay and resumes in a later window', async () => {
  const f = fixture(); let calls = 0;
  let executor = new DevelopmentExecutor({ ...f.options, proposalCallsPerDay: 1, propose: async () => { calls++; throw new Error('Provider outcome unknown'); } });
  try {
    assert.equal((await executor.tick())?.state, 'paused'); f.advance();
    executor = new DevelopmentExecutor({ ...f.options, proposalCallsPerDay: 1, propose: async () => { calls++; return proposal(); } }); executor.recoverInterrupted();
    assert.equal(await executor.tick(), null); assert.equal(calls, 1, 'restart does not refund unknown call');
    assert.throws(() => new DevelopmentExecutor({ ...f.options, proposalCallsPerDay: 2 }).allocation(), /immutable/);
    f.setNow(86_400_000); const resumed = await executor.tick(); assert.equal(resumed?.ordinal, 2); assert.equal(calls, 2);
  } finally { f.store.close(); }
});

test('a crashed authoring claim is interrupted explicitly and cannot replay the same call identity', async () => {
  const f = fixture();
  try {
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    const old = new DevelopmentExecutor({ ...f.options, propose: async () => { await blocked; return proposal(); } });
    const running = old.tick(); await new Promise(resolve => setImmediate(resolve));
    const restarted = new DevelopmentExecutor(f.options); restarted.recoverInterrupted();
    assert.equal(restarted.attempts()[0]?.state, 'paused'); assert.match(restarted.attempts()[0]!.feedback!.reason, /uncertain/);
    release(); await running;
    assert.equal(f.enqueued.length, 0, 'late completion from replaced owner is rejected');
    f.advance(); const next = await restarted.tick(); assert.equal(next?.ordinal, 2); assert.notEqual(next?.id, restarted.attempts()[0]?.id);
  } finally { f.store.close(); }
});

test('user priority and changed admitted source reject late proposals without dispatch', async () => {
  const f = fixture();
  try {
    f.users(true); const quiet = new DevelopmentExecutor(f.options); assert.equal(await quiet.tick(), null); assert.equal(f.calls(), 0);
    f.users(false);
    const changed = new DevelopmentExecutor({ ...f.options, propose: async () => { f.setSource({ ...f.source(), sourceDigest: hex(33) }); return proposal(); } });
    assert.equal((await changed.tick())?.state, 'paused'); assert.equal(f.enqueued.length, 0);
    assert.match(changed.attempts()[0]!.feedback!.reason, /source/);
    f.advance();
    const arrived = new DevelopmentExecutor({ ...f.options, propose: async () => { f.users(true); return proposal(); } });
    assert.equal((await arrived.tick())?.state, 'paused'); assert.equal(f.enqueued.length, 0);
  } finally { f.store.close(); }
});

test('forged bindings, failed checks and mismatched publication cannot mark an item complete', async () => {
  for (const mutate of [
    (v: DevelopmentReleaseObservation) => { v.catalogDigest = hex(88); },
    (v: DevelopmentReleaseObservation) => { v.candidateId = hex(88); },
    (v: DevelopmentReleaseObservation) => { v.evidence!.checks[0]!.status = 'failed'; },
    (v: DevelopmentReleaseObservation) => { v.evidence!.sourceDigest = hex(88); },
    (v: DevelopmentReleaseObservation) => { v.publication.publishedSourceDigest = hex(88); },
  ]) {
    const f = fixture(); const executor = new DevelopmentExecutor(f.options);
    try {
      const attempt = await executor.tick(); const observed = f.complete(attempt!, 1); mutate(observed);
      await executor.tick(); assert.notEqual(executor.attempts()[0]?.state, 'completed'); assert.equal(f.calls(), 1);
    } finally { f.store.close(); }
  }
});

test('rollback reopens missing capabilities without rewinding historical completion', async () => {
  const f = fixture(); const executor = new DevelopmentExecutor(f.options);
  try {
    const first = await executor.tick(); f.complete(first!, 1); await executor.tick();
    f.setSource({ releaseId: hex(1), sourceDigest: hex(2), baseCommit: 'a'.repeat(40), files: [{ path: 'src/agent/brain.ts', content: 'old source' }] });
    const reopened = new DevelopmentExecutor({ ...f.options, checkCurrent: async source => ({ ...f.evidence(source), checks: f.evidence(source).checks.map(check => ({ ...check, status: 'failed' as const })) }) });
    const repair = await reopened.tick(); assert.equal(repair?.itemId, 'P06-memory-provenance'); assert.equal(repair?.ordinal, 2);
    assert.equal(reopened.attempts()[0]?.state, 'completed', 'earlier evidence remains in history');
    assert.ok(f.store.listEvents().some(event => event.type === 'development.capability.reopened'));
  } finally { f.store.close(); }
});

test('proposal callback cannot mutate trusted input, write protected source or duplicate inference concurrently', async () => {
  const f = fixture(); let calls = 0;
  const executor = new DevelopmentExecutor({ ...f.options, propose: async input => { calls++; (input.source as any).sourceDigest = hex(99); return { ...proposal(), files: [{ path: 'src/custodian.ts', content: 'weaken gate' }] }; } });
  try {
    const [one, two] = await Promise.all([executor.tick(), executor.tick()]); assert.equal(two, null); assert.equal(one?.state, 'paused');
    assert.equal(calls, 1); assert.equal(f.enqueued.length, 0); assert.notEqual(f.source().sourceDigest, hex(99));
  } finally { f.store.close(); }
});

test('temporary source-collector failure after inference pauses the attempt without leaving a stuck owner', async () => {
  const f = fixture(); let reads = 0;
  const executor = new DevelopmentExecutor({ ...f.options, readSource: async () => { if (++reads === 2) throw new Error('Source observer unavailable'); return f.source(); } });
  try {
    assert.equal((await executor.tick())?.state, 'paused'); assert.equal(f.enqueued.length, 0);
    assert.match(executor.attempts()[0]!.feedback!.reason, /source/);
    f.advance(); assert.equal((await executor.tick())?.ordinal, 2); assert.equal(f.enqueued.length, 1);
  } finally { f.store.close(); }
});

test('hourly proposal allocation survives durable restart and unknown outcomes, then opens the actual next hour', async () => {
  const base = mkdtempSync(join(tmpdir(), 'palimpsest-development-hourly-')); const path = join(base, 'state.sqlite');
  const f = fixture(new Store(path)); const hourly = { ...f.options, proposalCadence: 'hourly' as const, propose: async () => { throw new Error('Unknown inference outcome'); } };
  let reopened: Store | undefined;
  try {
    f.setNow(5 * 3_600_000 + 1_000); let executor = new DevelopmentExecutor(hourly);
    assert.equal((await executor.tick())?.state, 'paused');
    assert.deepEqual(executor.allocation(), { cadence: 'hourly', startsAt: 18_000_000, endsAt: 21_600_000, used: 1, remaining: 0 });
    f.store.close(); reopened = new Store(path); executor = new DevelopmentExecutor({ ...hourly, store: reopened }); executor.recoverInterrupted();
    f.setNow(21_599_999); assert.equal(await executor.tick(), null); assert.equal(executor.attempts().length, 1);
    assert.throws(() => new DevelopmentExecutor({ ...hourly, store: reopened!, proposalCallsPerHour: 2 }).allocation(), /immutable/);
    f.setNow(21_600_000); assert.equal(executor.allocation().remaining, 1);
    assert.equal((await executor.tick())?.ordinal, 2); assert.equal(executor.allocation().used, 1);
    assert.equal(reopened.listEvents().filter(e => e.type === 'development.attempt.started').length, 2);
  } finally { reopened?.close(); f.store.close(); rmSync(base, { recursive: true, force: true }); }
});

test('daily and hourly policy transitions count actual calls without refilling either allocation', async () => {
  const f = fixture(); const failure = async () => { throw new Error('Unknown inference outcome'); };
  try {
    f.setNow(18_000_000 + 1_000); const daily = new DevelopmentExecutor({ ...f.options, propose: failure });
    await daily.tick(); f.advance(); await daily.tick(); assert.equal(daily.allocation().used, 2);
    const hourly = new DevelopmentExecutor({ ...f.options, proposalCadence: 'hourly', propose: failure });
    assert.equal(hourly.allocation().used, 2, 'earlier daily calls in this hour remain spent');
    f.advance(); assert.equal(await hourly.tick(), null);
    f.setNow(21_600_000); await hourly.tick(); assert.equal(hourly.allocation().used, 1);
    const resumedDaily = new DevelopmentExecutor({ ...f.options, propose: failure });
    assert.equal(resumedDaily.allocation().used, 3, 'hourly calls consume the same actual daily history');
    assert.equal(resumedDaily.allocation().remaining, 1);
    assert.throws(() => new DevelopmentExecutor({ ...f.options, proposalCallsPerDay: 5 }).allocation(), /immutable/);
  } finally { f.store.close(); }
});

test('pending completion proceeds with hourly authoring allocation exhausted and successor waits for next hour', async () => {
  const f = fixture(); const executor = new DevelopmentExecutor({ ...f.options, proposalCadence: 'hourly' });
  try {
    f.setNow(18_000_000); const first = await executor.tick(); assert.equal(first?.state, 'queued');
    assert.equal(executor.allocation().remaining, 0); const observed = f.complete(first!, 1); observed.publication.status = 'uncertain';
    assert.equal((await executor.tick())?.state, 'queued'); observed.publication.status = 'published';
    assert.equal((await executor.tick())?.state, 'completed'); assert.equal(await executor.tick(), null); assert.equal(f.calls(), 1);
    f.setNow(21_600_000); assert.equal((await executor.tick())?.itemId, 'P06-memory-context-budget'); assert.equal(f.calls(), 2);
  } finally { f.store.close(); }
});

test('hourly interrupted authoring and user priority retain the debit and discard late output', async () => {
  const f = fixture(); let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const executor = new DevelopmentExecutor({ ...f.options, proposalCadence: 'hourly', propose: async () => { await blocked; return proposal(); } });
  try {
    f.users(true); assert.equal(await executor.tick(), null); assert.equal(executor.allocation().used, 0);
    f.users(false); const running = executor.tick(); await new Promise(resolve => setImmediate(resolve));
    f.users(true); assert.equal(await executor.tick(), null); release(); assert.equal((await running)?.state, 'paused');
    f.users(false); f.advance(); assert.equal(await executor.tick(), null); assert.equal(executor.allocation().used, 1); assert.equal(f.enqueued.length, 0);
  } finally { release(); f.store.close(); }
});

test('legacy day reservations without timestamps conservatively consume overlapping hourly slots', () => {
  const f = fixture();
  try {
    f.store.appendEvent('development.attempt.started', { startsAt: 0, attempt: { catalogDigest: 'older-catalog' } });
    f.setNow(18_000_000); const hourly = new DevelopmentExecutor({ ...f.options, proposalCadence: 'hourly' });
    assert.equal(hourly.allocation().remaining, 0); assert.equal(new DevelopmentExecutor(f.options).allocation().used, 1);
    f.setNow(86_400_000); assert.equal(hourly.allocation().remaining, 1);
    assert.throws(() => new DevelopmentExecutor({ ...f.options, proposalCadence: 'weekly' as any }), /cadence/);
    assert.throws(() => new DevelopmentExecutor({ ...f.options, proposalCallsPerHour: -1 }), /finite/);
    assert.equal(new DevelopmentExecutor({ ...f.options, proposalCadence: 'hourly', proposalCallsPerHour: 0, now: () => 90_000_000 }).allocation().remaining, 0);
  } finally { f.store.close(); }
});

test('host authoring gate preserves pending completion without opening or spending a new window', async () => {
  const f = fixture(); let mayAuthor = true;
  const executor = new DevelopmentExecutor({ ...f.options, proposalCadence: 'hourly', mayAuthor: () => mayAuthor });
  try {
    f.setNow(18_000_000); const first = await executor.tick(); assert.equal(first?.state, 'queued');
    mayAuthor = false; f.setNow(21_600_000); const observed = f.complete(first!, 1); observed.publication.status = 'pending';
    assert.equal((await executor.tick())?.state, 'queued'); observed.publication.status = 'published';
    assert.equal((await executor.tick())?.state, 'completed');
    const count = f.store.listEvents().length;
    assert.equal(await executor.tick(), null); assert.equal(f.calls(), 1);
    assert.equal(f.store.listEvents().length, count, 'disabled authoring opens no allocation window or reservation');
    mayAuthor = true; assert.equal((await executor.tick())?.itemId, 'P06-memory-context-budget');
    assert.equal(executor.allocation().used, 1); assert.equal(f.calls(), 2);
  } finally { f.store.close(); }
});
