import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GrowthScheduler } from '../src/scheduler.ts';
import { Store } from '../src/store.ts';
import type { GrowthCoding } from '../src/growth.ts';
import type { Provider } from '../src/providers.ts';
import { CodingServing } from '../src/coding-serving.ts';
import { CodingAccounting } from '../src/coding-accounting.ts';
import { CodingSessionCoordinator } from '../src/coding-session.ts';

test('a retained growth coding decision resumes after reopen in an exhausted window without another inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-coding-growth-recovery-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path), physicalCalls = 0, admissions = 0, busy = false;
  const decision = JSON.stringify({ observation: 'Observed a bounded code inquiry.', lesson: 'Check the hypothesis.',
    nextQuestion: 'Does the actual check support it?', proposedChange: null, coding: { objective: 'Investigate the observed behavior.' } });
  const provider: Provider = { name: 'fixture', complete: async () => {
    physicalCalls++;
    return { text: decision, provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const coding: GrowthCoding = {
    eligible: () => true,
    prepare: (_growth, request) => request,
    accept: async (growth, raw) => {
      assert.equal(raw, decision);
      admissions++;
      if (admissions === 1) throw new Error('Source admission temporarily held');
      return store.updateGrowth(growth.id, { state: 'completed', checkpoint: { phase: 'coding_session' },
        outcome: { assessment: 'coding_queued' }, nextStep: 'The admitted session owns the inquiry.' });
    },
  };
  const scheduler = () => new GrowthScheduler({ store, provider, coding, hasUserWork: () => busy,
    schedulerId: 'coding-recovery', now: () => 100, windowMs: 1000, callsPerWindow: 1 });
  let running = scheduler();
  try {
    const held = await running.tick();
    assert.equal(held?.state, 'paused');
    assert.equal((held?.checkpoint as Record<string, unknown>).phase, 'coding_decision');
    assert.equal(physicalCalls, 1);
    assert.equal(store.growthWindow('coding-recovery:0')?.usedCalls, 1);
    await running.stop(); store.close(); store = new Store(path); running = scheduler();
    busy = true;
    assert.equal(await running.tick(), null);
    assert.equal(admissions, 1);
    busy = false;
    const recovered = await running.tick();
    assert.equal(recovered?.id, held?.id);
    assert.equal(recovered?.state, 'completed');
    assert.equal(admissions, 2);
    assert.equal(physicalCalls, 1);
    assert.equal(store.growthWindow('coding-recovery:0')?.usedCalls, 1);
  } finally { await running.stop(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a retained coding decision without current eligibility does not starve other growth or replay its inference', async () => {
  const store = new Store(':memory:'); let calls = 0;
  const held = store.addGrowth({ id: 'held-coding-decision', dimension: 'code_quality', question: 'Retained source investigation.', origin: 'standing growth mission v1', budget: 0 });
  store.updateGrowth(held.id, { state: 'paused', checkpoint: { phase: 'coding_decision', decisionText: 'Retained unavailable decision.' } });
  const scheduler = new GrowthScheduler({ store, hasUserWork: () => false, schedulerId: 'held-coding', callsPerWindow: 4, now: () => 100, windowMs: 1000,
    provider: { name: 'fixture', complete: async () => { calls++; return { text: JSON.stringify({ observation: 'No new defect observed.', lesson: 'Preserve current behavior.', nextQuestion: 'What evidence would distinguish an improvement?', proposedChange: null }), provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } },
    coding: { eligible: () => false, prepare: () => assert.fail('No coding schema permitted'), accept: async () => assert.fail('No coding admission permitted') } });
  try {
    for (let tick = 0; tick < 4; tick++) await scheduler.tick();
    assert.equal(calls, 4);
    assert.equal(store.listGrowth().filter(item => item.state === 'completed').length, 4);
    assert.equal(store.growth(held.id)?.state, 'paused');
    assert.deepEqual(store.growth(held.id)?.checkpoint, { phase: 'coding_decision', decisionText: 'Retained unavailable decision.' });
  } finally { await scheduler.stop(); store.close(); }
});

test('failed verified-source admission retains an honest independent-growth disposition without a session or another call', async () => {
  const store = new Store(':memory:'); let imports = 0;
  const accounting = new CodingAccounting(store, { now: () => 100 });
  const coordinator = new CodingSessionCoordinator({ store, accounting, workspaces: { async stop() {} } as never,
    artifacts: { async importSource() { imports++; throw new Error('Verified source unavailable'); } } as never,
    epoch: () => 1, authorizeOrigin: () => false, authorizeGrowth: () => true, authorizeSession: () => true,
    policy: () => ({ lane: { kind: 'growth', schedulerId: 'fixture', windowMs: 1000, maxCalls: 1 },
      limits: { maxWorkCalls: 1, maxSessionCalls: 1, maxAttemptCalls: 1, maxAttempts: 1, maxCommands: 1 }, expiresAt: 10_000,
      providerProfile: { provider: 'fixture', model: 'fixture' }, catalogVersion: 'workspace-tools/1', providerLimits: {},
      maxTranscriptMessages: 64, maxTranscriptBytes: 20_000, commandTimeoutMs: 1000, maxCommandOutputBytes: 1000 }),
    providerFactory: () => { throw new Error('No physical request permitted'); },
    acquireProviderSlot: async () => { throw new Error('No physical request permitted'); }, now: () => 100 });
  const serving = new CodingServing({ store, coordinator: () => coordinator, artifacts: () => ({} as never),
    available: () => false, authorizeOrigin: () => false, authorizeGrowth: () => true, growthAvailable: () => true,
    authorizeSubmission: () => assert.fail('No submission permitted') });
  try {
    const growth = store.addGrowth({ id: 'growth-source-unavailable', dimension: 'code_quality', question: 'Investigate observed behavior.', origin: 'standing growth mission v1', budget: 1 });
    const result = await serving.growth.accept(growth, JSON.stringify({ observation: 'Observed inquiry.', lesson: 'Check it.', nextQuestion: 'What does the check show?', proposedChange: null, coding: { objective: growth.question } }));
    assert.equal(result?.state, 'completed');
    assert.equal((result?.outcome as Record<string, unknown>).assessment, 'coding_unavailable');
    assert.equal(imports, 1); assert.equal(accounting.list().length, 0); assert.equal(accounting.reservations().length, 0);
    assert.equal(store.task(`coding-growth:${growth.id}`)?.state, 'failed');
    assert.equal(store.listEvents().filter(event => event.type === 'coding.report.owed').length, 1);
    assert.equal(store.listEvents().filter(event => event.type === 'coding.serving.outcome').length, 1);
    serving.reconcile();
    assert.equal(store.listEvents().filter(event => event.type === 'coding.serving.report_prepared').length, 1);
  } finally { await coordinator.stop(); store.close(); }
});
