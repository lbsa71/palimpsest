import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, artifactDigest, calibrate, configurationDigest, families, freezePlan, executionKey, lowerInterval, planDigest, recordDigest, sampleVariance } from './index.ts';
import type { Case, Configuration, Product, ScoredRecord, Trust } from './index.ts';

const h = (x: unknown) => artifactDigest('synthetic-test', x);
const products: Product[] = ['candidate', 'codex', 'claude-code'];
const fixtureTrust: Trust = { verifySeal: () => true, verifyRecord: () => true };
function configuration(): Configuration {
  const system = { model: 'synthetic', modelVersion: 'fixture-v1', effort: 'fixture', source: h('source'), dependencies: h('deps'), prompts: h('prompts'), tools: h('tools'), context: h('context'), resources: h('resources'), grant: h('grant'), prices: h('prices') };
  return {
    protocol: 'A1-L08-v2', analysisSourceDigest: h('analysis'), mode: 'controlled',
    systems: { candidate: { ...system }, codex: { ...system }, 'claude-code': { ...system } }, evaluatorDigest: h('evaluator'),
    pilotCases: families.flatMap(family => Array.from({ length: 5 }, (_, i) => ({ id: `pilot-${family}-${i}`, family, digest: h(['pilot', family, i]) }))),
    families: Object.fromEntries(families.map(f => [f, { margin: 2, absoluteFloor: 1, failureCostUsd: 10, justification: 'Deliberately permissive synthetic test parameter, never empirical acceptance.' }])) as Configuration['families'],
    seed: 7, simulations: 500, maxTasksPerFamily: 120, maxSimulationDraws: 600000,
    monteCarloErrorAlpha: 0.01, sensitivity: [{ id: 'synthetic-tail', scale: 1, tailMass: 0.0001, justification: 'Synthetic test only.' }],
    assumptions: { independentTaskClusters: true, representativePilot: true, equalityModelJustification: 'Synthetic exchangeable comparator-cluster differences at equality; no live claim.', comparabilityJustification: 'Identical synthetic systems and resources.' },
    resources: { maxAcceptanceExecutions: 10000, maxAcceptanceCostUsd: 10000, worstCaseCostUsd: { candidate: 1, codex: 1, 'claude-code': 1 } },
  };
}
function records(c: Configuration, cases: Case[], phase: ScoredRecord['phase']): ScoredRecord[] {
  return cases.flatMap(task => (phase === 'pilot' ? products.slice(1) : products).flatMap(product => [0, 1, 2].map(repeat => ({
    phase, product, taskId: task.id, caseDigest: task.digest, repeat,
    systemDigest: artifactDigest('system', c.systems[product]!), evaluatorDigest: c.evaluatorDigest,
    outcome: 'scored' as const, score: 3, reason: null, evidenceDigest: h([task.id, product, repeat]),
    costUsd: 0.5, requests: 1, tokens: 10, hardViolations: [],
  }))));
}
function fixture() {
  const c = configuration(), pilot = records(c, c.pilotCases, 'pilot'), calibration = calibrate(c, pilot, fixtureTrust);
  assert.equal(calibration.status, 'planned', calibration.reasons.join(';'));
  const cases = families.flatMap(family => Array.from({ length: calibration.tasksPerFamily![family] }, (_, i) => ({ id: `accept-${family}-${i}`, family, digest: h(['accept', family, i]) })));
  const order = cases.flatMap(t => products.flatMap(p => [0, 1, 2].map(r => executionKey(t.id, p, r)))).reverse();
  const plan = freezePlan(c, calibration, cases, order, fixtureTrust);
  return { c, pilot, calibration, plan, results: records(c, cases, 'acceptance') };
}

test('deterministic finite pilot selection uses five task clusters and three repeats', () => {
  const c = configuration(), pilot = records(c, c.pilotCases, 'pilot');
  // Extreme within-task variation does not create fifteen independent task samples.
  for (const r of pilot) r.score = r.repeat === 0 ? 0 : 3;
  const a = calibrate(c, pilot, fixtureTrust), b = calibrate(c, pilot, fixtureTrust);
  assert.deepEqual(a, b); assert.equal(a.status, 'planned');
  for (const s of a.summaries) { assert.equal(s.tasks, 5); assert.equal(s.repeats, 3); assert.equal(s.mean, 2); assert.equal(s.betweenTaskVariance, 0); assert.equal(s.meanWithinTaskVariance, 3); }
  assert.ok(a.power.every(p => p.lowerPower >= 0.8 && p.tasks < c.maxTasksPerFamily));
  assert.equal(a.admissionEligible, false);
});

test('bounded lower interval matches analytic zero-variance and paired variance behavior', () => {
  const xs = new Array<number>(100).fill(1.5), interval = lowerInterval(xs, 0, 3, 0.01);
  assert.equal(interval.variance, 0);
  assert.equal(interval.lower, Math.max(0, 1.5 - 7 * 3 * Math.log(200) / (3 * 99)));
  const candidate = Array.from({ length: 1000 }, (_, i) => i % 2 ? 3 : 0);
  const paired = candidate.map(x => x - x), unmatched = candidate.map((x, i) => x - candidate[(i + 1) % candidate.length]!);
  assert.equal(sampleVariance(paired), 0); assert.ok(sampleVariance(unmatched) > 9);
  assert.ok(lowerInterval(paired, -3, 3, 0.01).lower > lowerInterval(unmatched, -3, 3, 0.01).lower);
  assert.throws(() => lowerInterval([4, 3], 0, 3, 0.01));
});

test('known bounded population simulation checks conservative coverage without asserting exact coverage', () => {
  let state = 927;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  let misses = 0;
  for (let run = 0; run < 400; run++) {
    const xs = Array.from({ length: 200 }, () => random() < 0.25 ? 3 : 0);
    if (lowerInterval(xs, 0, 3, 0.01).lower > 0.75) misses++;
  }
  assert.equal(misses, 0); // Fixed synthetic draw, not a statistical coverage certification.
});

test('missing outcomes, unknown cost and unavailable baseline are explicit, never dropped or zero-filled', () => {
  const c = configuration(), pilot = records(c, c.pilotCases, 'pilot');
  pilot[0]!.outcome = 'missing'; pilot[0]!.score = null; pilot[0]!.reason = 'host unavailable'; pilot[1]!.costUsd = null;
  const report = calibrate(c, pilot.filter(r => r.product !== 'claude-code'), fixtureTrust);
  assert.equal(report.status, 'indeterminate'); assert.equal(report.tasksPerFamily, null);
  assert.ok(report.missing.some(x => x.includes('unknown costUsd'))); assert.ok(report.missing.some(x => x.includes('claude-code')));
  assert.ok(report.failures.some(x => x.includes('host unavailable'))); assert.deepEqual(report.records, pilot.filter(r => r.product !== 'claude-code'));
});

test('failed scored executions remain score zero in pilot summaries', () => {
  const c = configuration(), pilot = records(c, c.pilotCases, 'pilot');
  const r = pilot[0]!; r.outcome = 'failed'; r.score = 0; r.reason = 'verified incorrect artifact';
  const report = calibrate(c, pilot, fixtureTrust);
  assert.equal(report.summaries.find(s => s.family === 'coding' && s.product === 'codex')!.mean, 2.8);
  assert.equal(report.failures.length, 1); assert.equal(report.records[0]!.score, 0);
});

test('candidate outcomes and mismatched controlled models never enter sample selection', () => {
  const c = configuration(), pilot = records(c, c.pilotCases, 'pilot'); pilot[0]!.product = 'candidate';
  assert.match(calibrate(c, pilot, fixtureTrust).reasons.join(' '), /candidate outcomes forbidden/);
  const other = configuration(); other.systems.codex.modelVersion = 'different';
  assert.match(calibrate(other, records(other, other.pilotCases, 'pilot'), fixtureTrust).reasons.join(' '), /unmatched controlled modelVersion/);
});

test('unsupported assumptions, absent numeric margins, max work and weak planning power fail closed', () => {
  for (const mutation of [(c: Configuration) => { c.assumptions.independentTaskClusters = false; }, (c: Configuration) => { c.families.coding.margin = NaN; }, (c: Configuration) => { c.maxSimulationDraws = 1; }]) {
    const c = configuration(); mutation(c);
    // Non-JSON input is rejected even before digesting an artifact.
    if (Number.isNaN(c.families.coding.margin)) assert.throws(() => calibrate(c, records(c, c.pilotCases, 'pilot'), fixtureTrust));
    else assert.equal(calibrate(c, records(c, c.pilotCases, 'pilot'), fixtureTrust).status, 'indeterminate');
  }
  const c = configuration(); c.families.coding.margin = 0.01;
  const report = calibrate(c, records(c, c.pilotCases, 'pilot'), fixtureTrust);
  assert.equal(report.status, 'indeterminate'); assert.match(report.reasons.join(' '), /insufficient planning power/);
});

test('selected sample exceeding explicit money/execution grant is infeasible', () => {
  const c = configuration(); c.resources.maxAcceptanceExecutions = 1;
  const report = calibrate(c, records(c, c.pilotCases, 'pilot'), fixtureTrust);
  assert.equal(report.status, 'infeasible'); assert.ok(report.requiredExecutions! > 1); assert.ok(report.tasksPerFamily);
});

test('host authentication binds full records and frozen configuration, not claimed trusted flags', () => {
  const c = configuration(), pilot = records(c, c.pilotCases, 'pilot');
  const receipts = new Set(pilot.map(recordDigest));
  const trust: Trust = { verifySeal: (_stage, d) => d !== configurationDigest(c), verifyRecord: (_r, d) => receipts.has(d) };
  assert.match(calibrate(c, pilot, trust).reasons.join(' '), /trusted pre-candidate seal/);
  trust.verifySeal = () => true; pilot[0]!.score = 2;
  assert.match(calibrate(c, pilot, trust).reasons.join(' '), /untrusted scored record/);
});

test('frozen case/seed/count/order tampering and pilot reuse are rejected before analysis', () => {
  const { plan, calibration, c, results } = fixture();
  const accepted = planDigest(plan), trust: Trust = { ...fixtureTrust, verifySeal: (stage, d) => stage !== 'plan-before-candidate' || d === accepted };
  const changed = structuredClone(plan); changed.executionOrder.reverse();
  assert.match(analyze(changed, results, trust).reasons.join(' '), /trusted pre-candidate seal/);
  const altered = structuredClone(calibration); altered.tasksPerFamily!.coding++;
  assert.throws(() => freezePlan(c, altered, plan.acceptanceCases, plan.executionOrder, fixtureTrust), /does not reproduce/);
  const reused = structuredClone(plan.acceptanceCases); reused[0] = c.pilotCases[0]!;
  assert.throws(() => freezePlan(c, calibration, reused, plan.executionOrder, fixtureTrust), /pilot task reused/);
  const changedSeed = structuredClone(plan); changedSeed.configuration.seed++;
  assert.equal(analyze(changedSeed, results, trust).status, 'indeterminate');
});

test('paired comparison clears every frozen family/baseline/floor while remaining inadmissible', () => {
  const { plan, results } = fixture();
  const report = analyze(plan, results, fixtureTrust);
  assert.equal(report.status, 'criterion-met', report.reasons.join(';')); assert.equal(report.families.length, 5);
  for (const family of report.families) { assert.equal(family.absolute.n, plan.calibration.tasksPerFamily![family.family]); assert.equal(family.comparisons.length, 2); assert.ok(family.comparisons.every(c => c.interval.variance === 0)); }
  assert.equal(report.admissionEligible, false);
  for (const r of results) if (r.product === 'candidate') { r.outcome = 'failed'; r.score = 0; r.reason = 'synthetic failure'; }
  const failed = analyze(plan, results, fixtureTrust);
  assert.equal(failed.status, 'indeterminate'); assert.ok(failed.failures.length > 0); assert.ok(failed.families.every(f => !f.clears));
  assert.equal(failed.planDigest, report.planDigest);
  for (const f of failed.families) assert.equal(f.absolute.n, plan.calibration.tasksPerFamily![f.family]);
});

test('hard invariants override mean quality, incomplete acceptance cannot pass, extras cannot expand', () => {
  const { plan, results } = fixture();
  const missing = results.slice(1); assert.equal(analyze(plan, missing, fixtureTrust).status, 'indeterminate');
  results[0]!.hardViolations = ['unauthorized-effect'];
  const bad = analyze(plan, results, fixtureTrust); assert.equal(bad.status, 'criterion-unmet'); assert.equal(bad.hardViolations.length, 1);
  results[0]!.hardViolations = []; results[0]!.costUsd = 2;
  assert.equal(analyze(plan, results, fixtureTrust).status, 'criterion-unmet');
  results[0]!.costUsd = 0.5;
  assert.match(analyze(plan, [...results, results[0]!], fixtureTrust).reasons.join(' '), /duplicate execution/);
});

test('authenticated zero scores cannot change through accessors after canonical sealing', () => {
  const { plan, results } = fixture();
  for (const r of results) if (r.product === 'candidate') r.score = 0;
  const receipts = new Set(results.map(recordDigest));
  const trust: Trust = { ...fixtureTrust, verifyRecord: (r, d) => r.phase === 'pilot' || receipts.has(d) };
  for (const r of results) if (r.product === 'candidate') {
    let reads = 0;
    // recordsDigest, retained-record clone and receipt digest see the signed score.
    Object.defineProperty(r, 'score', { enumerable: true, get: () => ++reads <= 3 ? 0 : 3 });
  }
  assert.throws(() => analyze(plan, results, trust), /inert JSON/);
});

test('artifact identities reject hidden fields instead of authenticating a partial object', () => {
  const visible = { score: 0 };
  const hidden = { score: 0 };
  Object.defineProperty(hidden, 'hardViolations', { value: ['unauthorized-effect'] });
  assert.throws(() => artifactDigest('synthetic-test', hidden), /inert JSON/);
  assert.doesNotThrow(() => artifactDigest('synthetic-test', visible));
});

test('analysis authenticates detached immutable records even if the caller mutates its originals', () => {
  const { plan, results } = fixture();
  for (const r of results) if (r.product === 'candidate') r.score = 0;
  const receipts = new Set(results.map(recordDigest));
  let mutated = false;
  const trust: Trust = {
    ...fixtureTrust,
    verifyRecord: (record, d) => {
      assert.ok(Object.isFrozen(record)); assert.ok(Object.isFrozen(record.hardViolations));
      if (!mutated) { mutated = true; for (const r of results) r.score = 3; }
      return record.phase === 'pilot' || receipts.has(d);
    },
  };
  const report = analyze(plan, results, trust);
  assert.equal(report.status, 'indeterminate');
  assert.ok(report.records.filter(r => r.product === 'candidate').every(r => r.score === 0));
  assert.ok(report.families.every(f => f.absolute.mean === 0));
});

test('inert identity boundary rejects proxies, symbol keys, sparse arrays and nested getters without invoking them', () => {
  let invoked = false;
  const accessor = { get score() { invoked = true; return 3; } };
  const proxy = new Proxy({}, { ownKeys: () => { invoked = true; return []; } });
  const symbol = { [Symbol('hidden')]: 3 };
  const sparse = new Array(2); sparse[0] = 3; Object.assign(sparse, { extra: 3 });
  for (const bad of [accessor, proxy, symbol, sparse]) assert.throws(() => artifactDigest('boundary-test', { nested: bad }), /inert JSON/);
  assert.equal(invoked, false);
  assert.equal(artifactDigest('boundary-test', { b: [1, 2], a: 0 }), artifactDigest('boundary-test', { a: 0, b: [1, 2] }));
});

test('Monte Carlo uncertainty includes every searched family, baseline, count and sensitivity', () => {
  const c = configuration();
  c.sensitivity.push({ ...c.sensitivity[0]!, id: 'second-preregistered-model' });
  c.maxSimulationDraws *= 2;
  const report = calibrate(c, records(c, c.pilotCases, 'pilot'), fixtureTrust);
  assert.equal(report.status, 'planned'); assert.equal(report.power.length, 20);
  const penalty = Math.sqrt(Math.log(c.maxTasksPerFamily * 5 * 2 * 2 / c.monteCarloErrorAlpha) / (2 * c.simulations));
  for (const cell of report.power) assert.equal(cell.lowerPower, Math.max(0, cell.estimatedPower - penalty));
  c.sensitivity[1]!.tailMass = 1;
  const adverse = calibrate(c, records(c, c.pilotCases, 'pilot'), fixtureTrust);
  assert.equal(adverse.status, 'indeterminate'); assert.equal(adverse.tasksPerFamily, null);
  assert.ok(adverse.power.some(cell => cell.sensitivity === 'second-preregistered-model' && cell.lowerPower < 0.8));
});

test('each seal stage and analysis source identity remains mandatory', () => {
  const { plan, results } = fixture();
  for (const denied of ['pilot-design-before-pilot', 'configuration-before-candidate', 'calibration-before-candidate', 'plan-before-candidate']) {
    const report = analyze(plan, results, { ...fixtureTrust, verifySeal: stage => stage !== denied });
    assert.equal(report.status, 'indeterminate'); assert.equal(report.admissionEligible, false);
  }
  const changed = structuredClone(plan); changed.configuration.analysisSourceDigest = h('different-analysis');
  assert.equal(analyze(changed, results, fixtureTrust).status, 'indeterminate');
});
