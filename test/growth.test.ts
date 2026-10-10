import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { autarkOrientation } from '../src/autark.ts';
import { GrowthCoordinator } from '../src/growth.ts';
import { Store } from '../src/store.ts';
import { ProviderError, type Provider, type CompletionRequest } from '../src/providers.ts';

test('growth preserves host source identity across result-publication recovery', async () => {
  const binding = { version: 1 as const, releaseDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), baseCommit: 'c'.repeat(40) };
  let observed = 0;
  const f = fixture(async request => {
    assert.equal(observed, 1);
    assert.deepEqual((f.store.listGrowth().find(item => item.state === 'running')!.checkpoint as Record<string, unknown>).sourceBinding, binding);
    assert.deepEqual(JSON.parse(request.prompt).sourceBinding, binding);
    return { text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  });
  try {
    const original = f.store.addGrowth.bind(f.store);
    f.store.addGrowth = input => {
      if (input.origin.startsWith('growth:')) throw new Error('publication interrupted');
      return original(input);
    };
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, observeSource: () => { observed++; return binding; } });
    await assert.rejects(coordinator.tick(), /publication interrupted/);
    assert.deepEqual((f.store.listGrowth()[0]!.checkpoint as Record<string, unknown>).sourceBinding, binding);
    f.store.addGrowth = original;
    const result = await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, observeSource: () => assert.fail('publication must retain original binding') }).tick();
    assert.deepEqual((result!.outcome as Record<string, unknown>).sourceBinding, binding);
    assert.deepEqual((result!.checkpoint as Record<string, unknown>).sourceBinding, binding);
    assert.equal(f.requests.length, 1);
  } finally { f.cleanup(); }
});

test('interrupted growth call retains its source binding and a new allocated attempt observes a new base', async () => {
  const firstBinding = { version: 1 as const, releaseDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), baseCommit: 'c'.repeat(40) };
  const nextBinding = { ...firstBinding, releaseDigest: 'd'.repeat(64), sourceDigest: 'e'.repeat(64), baseCommit: 'f'.repeat(40) };
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    if (calls === 1) throw new ProviderError('unavailable', 'uncertain attempt');
    return { text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  });
  try {
    const first = await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, budgetPerExperiment: 2, observeSource: () => firstBinding }).tick();
    assert.equal(first?.state, 'paused');
    assert.deepEqual((first!.checkpoint as Record<string, unknown>).sourceBinding, firstBinding);
    assert.equal(first?.remainingBudget, 1);
    const result = await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, observeSource: () => nextBinding }).tick({ growthId: first!.id });
    assert.equal(result?.state, 'completed');
    assert.deepEqual((result!.outcome as Record<string, unknown>).sourceBinding, nextBinding);
    assert.equal(calls, 2);
    assert.equal(result?.remainingBudget, 0);
  } finally { f.cleanup(); }
});

test('unavailable source observation does not consume an inquiry allocation or call provider', async () => {
  const f = fixture();
  try {
    assert.equal(await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, observeSource: () => { throw new Error('source publication pending'); } }).tick(), null);
    assert.equal(f.requests.length, 0);
    assert.ok(f.store.listGrowth().every(item => item.remainingBudget === 1 && item.state === 'queued'));
  } finally { f.cleanup(); }
});

const reflection = {
  observation: 'There are no observed failures to justify changing this behavior yet.',
  lesson: 'The available evidence supports preserving the behavior pending a discriminating test.',
  nextQuestion: 'Which counterexample would distinguish a useful improvement from needless complexity?',
  proposedChange: null,
};

function fixture(complete?: Provider['complete']) {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-growth-test-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);
  const requests: CompletionRequest[] = [];
  const provider: Provider = { name: 'fixture', complete: async (request) => {
    requests.push(request);
    if (complete) return complete(request);
    return { text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: 10, outputTokens: 20 } };
  } };
  return { dir, path, store, requests, provider, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('idle growth seeds four stable dimensions and initiates without fresh human work', async () => {
  const f = fixture();
  try {
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false });
    coordinator.seedAgenda();
    coordinator.seedAgenda();
    assert.equal(f.store.listGrowth().length, 4);
    assert.equal(new Set(f.store.listGrowth().map((item) => item.dimension)).size, 4);
    const record = await coordinator.tick();
    assert.equal(record?.state, 'completed');
    assert.equal(record?.remainingBudget, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(f.store.listTasks().length, 0);
    assert.equal(f.store.listMemories('growth').length, 1);
    assert.match(f.store.listMemories('growth')[0]!.content, /preserving/);
    assert.equal(f.store.listMemories('growth')[0]!.confidence, 0.3);
    const followup = f.store.listGrowth().find((item) => item.origin === `growth:${record!.id}`);
    assert.equal(followup?.question, reflection.nextQuestion);
    assert.equal(followup?.budget, 0);
    assert.equal((record?.outcome as Record<string, unknown>).assessment, 'unverified_reflection');
  } finally { f.cleanup(); }
});

test('growth gives active commitments priority and never allocates itself additional calls', async () => {
  const f = fixture();
  try {
    let busy = true;
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => busy });
    assert.equal(await coordinator.tick(), null);
    assert.equal(f.requests.length, 0);
    busy = false;
    for (let n = 0; n < 10; n++) await coordinator.tick();
    assert.equal(f.requests.length, 4);
    assert.equal(f.store.listGrowth().filter((item) => item.state === 'completed').length, 4);
    coordinator.seedAgenda();
    assert.equal(await coordinator.tick(), null);
  } finally { f.cleanup(); }
});

test('an attempt debits before provider invocation and preserves negative lessons as observations', async () => {
  const f = fixture(async () => {
    const running = f.store.listGrowth().filter((item) => item.state === 'running');
    assert.equal(running.length, 1);
    assert.equal(running[0]!.remainingBudget, 0);
    assert.equal((running[0]!.checkpoint as Record<string, unknown>).phase, 'awaiting_provider');
    return { text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: null, outputTokens: null } };
  });
  try {
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false });
    const result = await coordinator.tick();
    assert.equal(result?.state, 'completed');
    assert.deepEqual((result?.outcome as Record<string, unknown>).usage, { inputTokens: null, outputTokens: null });
    assert.equal((result?.outcome as Record<string, unknown>).result && f.store.listMemories('growth')[0]!.source, `growth:${result!.id}`);
  } finally { f.cleanup(); }
});

test('fair selection persists across coordinator restart and provider failure', async () => {
  const f = fixture(async () => { throw new ProviderError('unavailable', 'fixture failure'); });
  try {
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, budgetPerExperiment: 2 });
    const first = await coordinator.tick();
    assert.equal(first?.state, 'paused');
    f.store.close();
    const reopened = new Store(f.path);
    try {
      const restarted = new GrowthCoordinator({ store: reopened, provider: f.provider, hasUserWork: () => false, budgetPerExperiment: 2 });
      const second = await restarted.tick();
      assert.notEqual(second?.dimension, first?.dimension);
      assert.equal(reopened.growth(first!.id)?.remainingBudget, 1);
      assert.equal(reopened.listGrowth().length, 4);
    } finally { reopened.close(); }
  } finally { f.cleanup(); }
});

test('cancellation and late output keep the same inquiry resumable without refunding spent calls', async () => {
  let finish: (() => void) | undefined;
  const f = fixture(async () => {
    await new Promise<void>((resolve) => { finish = resolve; });
    return { text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: 1, outputTokens: 1 } };
  });
  try {
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false });
    const controller = new AbortController();
    const pending = coordinator.tick({ signal: controller.signal });
    assert.equal(await coordinator.tick(), null);
    controller.abort();
    finish!();
    const paused = await pending;
    assert.equal(paused?.state, 'paused');
    assert.equal(paused?.outcome, null);
    assert.equal(paused?.remainingBudget, 0);
    assert.equal(f.store.listMemories('growth').length, 0);
    assert.equal(f.store.listGrowth().length, 4);
  } finally { f.cleanup(); }
});

test('recovery requires an explicit stopped-worker action and resumes persisted inquiry', async () => {
  const f = fixture();
  try {
    new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, budgetPerExperiment: 2 }).seedAgenda();
    const first = f.store.listGrowth()[0]!;
    assert.equal(f.store.claimGrowth(first.id)?.remainingBudget, 1);
    f.store.updateGrowth(first.id, { checkpoint: { phase: 'awaiting_provider', input: 'persisted question context' } });
    f.store.close();
    const reopened = new Store(f.path);
    try {
      const coordinator = new GrowthCoordinator({ store: reopened, provider: f.provider, hasUserWork: () => false });
      assert.equal(reopened.growth(first.id)?.state, 'running');
      reopened.recoverGrowthInterrupted();
      for (let n = 0; n < 4; n++) await coordinator.tick();
      assert.equal(reopened.growth(first.id)?.state, 'completed');
      assert.ok(f.requests.some((request) => request.prompt.includes('persisted question context')));
    } finally { reopened.close(); }
  } finally { f.cleanup(); }
});

test('structured result validation rejects malformed outcomes and unsafe code paths', async () => {
  for (const value of [
    { observation: 'observation', lesson: '', nextQuestion: 'question' },
    { ...reflection, extra: 'unsupported' },
    { ...reflection, proposedChange: { summary: 'change', rationale: 'why', acceptanceCriteria: ['check'], files: [{ path: '../credentials', content: 'x' }] } },
  ]) {
    const f = fixture(async () => ({ text: JSON.stringify(value), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: null, outputTokens: null } }));
    try {
      const result = await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false }).tick();
      assert.equal(result?.state, 'paused');
      assert.equal(f.store.listMemories('growth').length, 0);
      assert.equal((result?.checkpoint as Record<string, unknown>).reason, 'invalid_result');
    } finally { f.cleanup(); }
  }
});

test('code proposals remain data for governed release and context stays scope restricted', async () => {
  const proposedChange = { summary: 'Make the boundary explicit', rationale: 'The supplied fixture has an ambiguous error.', acceptanceCriteria: ['Malformed input has a stable error.'], files: [{ path: 'src/example.ts', content: 'export const example = 1;\n' }] };
  const f = fixture(async () => ({ text: JSON.stringify({ ...reflection, proposedChange }), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: 1, outputTokens: 1 } }));
  try {
    f.store.addMemory({ scope: 'private-conversation', kind: 'episodic', content: 'PRIVATE OTHER CONTEXT', source: 'user', confidence: 1 });
    const result = await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, context: () => 'AUTHORIZED SNAPSHOT' }).tick();
    assert.deepEqual(((result!.outcome as Record<string, unknown>).result as Record<string, unknown>).proposedChange, proposedChange);
    assert.ok(f.requests[0]!.system.startsWith(autarkOrientation));
    assert.equal(Object.hasOwn(f.requests[0]!.schema!.properties as object, 'actions'), false);
    assert.ok(f.requests[0]!.prompt.includes('AUTHORIZED SNAPSHOT'));
    assert.ok(!f.requests[0]!.prompt.includes('PRIVATE OTHER CONTEXT'));
    assert.equal(f.store.listEffects().length, 0);
  } finally { f.cleanup(); }
});

test('invalid budgets are rejected before creating agenda or calling providers', () => {
  const f = fixture();
  try {
    for (const value of [-1, NaN, Infinity, 1.5]) {
      assert.throws(() => new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false, budgetPerExperiment: value }), /budget/i);
    }
    assert.equal(f.store.listGrowth().length, 0);
  } finally { f.cleanup(); }
});

test('interrupted result publication resumes without another call or duplicate lesson', async () => {
  const f = fixture();
  try {
    const original = f.store.addGrowth.bind(f.store);
    f.store.addGrowth = (input) => {
      if (input.origin.startsWith('growth:')) throw new Error('synthetic publication interruption');
      return original(input);
    };
    const coordinator = new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false });
    await assert.rejects(coordinator.tick(), /publication interruption/);
    assert.equal(f.requests.length, 1);
    assert.equal(f.store.listMemories('growth').length, 1);
    assert.equal((f.store.listGrowth()[0]!.checkpoint as Record<string, unknown>).phase, 'publish_result');
    f.store.addGrowth = original;
    const resumed = await new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false }).tick();
    assert.equal(resumed?.state, 'completed');
    assert.equal(f.requests.length, 1);
    assert.equal(f.store.listMemories('growth').length, 1);
    assert.equal(typeof (resumed?.checkpoint as Record<string, unknown>).input, 'string');
  } finally { f.cleanup(); }
});

test('a forgotten lesson cannot be resurrected by interrupted publication replay', async () => {
  const f = fixture();
  try {
    const original = f.store.addGrowth.bind(f.store);
    f.store.addGrowth = (input) => {
      if (input.origin.startsWith('growth:')) throw new Error('synthetic publication interruption');
      return original(input);
    };
    await assert.rejects(new GrowthCoordinator({ store: f.store, provider: f.provider, hasUserWork: () => false }).tick(), /publication interruption/);
    const memory = f.store.listMemories('growth')[0]!;
    f.store.forgetMemory(memory.id, 'growth');
    f.store.close();
    const reopened = new Store(f.path);
    try {
      const result = await new GrowthCoordinator({ store: reopened, provider: f.provider, hasUserWork: () => false }).tick();
      assert.equal(result?.state, 'completed');
      assert.equal(f.requests.length, 1);
      assert.equal(reopened.listMemories('growth', { includeHistory: true }).length, 0);
      assert.equal(reopened.memory(memory.id, 'growth'), undefined);
    } finally { reopened.close(); }
  } finally { f.cleanup(); }
});
