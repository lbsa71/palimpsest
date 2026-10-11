import { identity, digest, invariant } from '../../packages/contracts/common.ts';

export const families = ['coding', 'research', 'operations', 'recovery', 'delegation'] as const;
export type Family = typeof families[number];
export type Product = 'candidate' | 'codex' | 'claude-code';
export const comparators = ['codex', 'claude-code'] as const;
const products: Product[] = ['candidate', ...comparators];
const method = 'A1-L08-v2-cluster-empirical-bernstein-v1';
export interface SystemIdentity {
  model: string; modelVersion: string; effort: string;
  source: string; dependencies: string; prompts: string; tools: string; context: string;
  resources: string; grant: string; prices: string;
}
export interface Case { id: string; family: Family; digest: string }
export interface ScoredRecord {
  phase: 'pilot' | 'acceptance'; product: Product; taskId: string; caseDigest: string;
  repeat: number; systemDigest: string; evaluatorDigest: string;
  outcome: 'scored' | 'failed' | 'missing'; score: number | null;
  reason: string | null; evidenceDigest: string;
  costUsd: number | null; requests: number | null; tokens: number | null;
  hardViolations: string[];
}
export interface Sensitivity {
  id: string;
  /** Multiplier for the difference of independently resampled comparator cluster means. */
  scale: number;
  /** Explicit symmetric mass on -3/+3, representing pilot-unseen task tails. */
  tailMass: number;
  justification: string;
}
export interface Configuration {
  protocol: 'A1-L08-v2'; analysisSourceDigest: string;
  mode: 'controlled' | 'native'; systems: Record<Product, SystemIdentity>;
  evaluatorDigest: string; pilotCases: Case[];
  families: Record<Family, { margin: number; absoluteFloor: number; failureCostUsd: number; justification: string }>;
  seed: number; simulations: number; maxTasksPerFamily: number; maxSimulationDraws: number;
  monteCarloErrorAlpha: number; sensitivity: Sensitivity[];
  assumptions: { independentTaskClusters: boolean; representativePilot: boolean; equalityModelJustification: string; comparabilityJustification: string };
  resources: { maxAcceptanceExecutions: number; maxAcceptanceCostUsd: number; worstCaseCostUsd: Record<Product, number> };
}
/** Callbacks belong to the independent host. Returning true by assertion is fixture use only. */
export interface Trust {
  verifySeal(stage: 'pilot-design-before-pilot' | 'configuration-before-candidate' | 'calibration-before-candidate' | 'plan-before-candidate', digest: string): boolean;
  verifyRecord(record: ScoredRecord, digest: string): boolean;
}
export function artifactDigest(domain: string, value: unknown): string {
  return identity({ domain: `palimpsest:${method}:${domain}`, value });
}
export const configurationDigest = (config: Configuration): string => artifactDigest('configuration', config);
export const pilotDesignDigest = (config: Configuration): string => artifactDigest('pilot-design', { protocol: config.protocol, cases: config.pilotCases, systems: Object.fromEntries(comparators.map(p => [p, config.systems[p]])), evaluatorDigest: config.evaluatorDigest });
export const recordDigest = (record: ScoredRecord): string => artifactDigest('scored-record', record);
export interface ClusterSummary {
  family: Family; product: Product; tasks: number; repeats: number;
  mean: number; betweenTaskVariance: number; meanWithinTaskVariance: number;
}
export interface PowerCell { family: Family; comparator: typeof comparators[number]; sensitivity: string; tasks: number; successes: number; simulations: number; estimatedPower: number; lowerPower: number }
export interface CalibrationReport {
  status: 'planned' | 'indeterminate' | 'infeasible'; admissionEligible: false;
  method: string; configurationDigest: string; pilotDigest: string;
  records: ScoredRecord[]; missing: string[]; failures: string[]; reasons: string[];
  summaries: ClusterSummary[]; power: PowerCell[]; tasksPerFamily: Record<Family, number> | null;
  requiredExecutions: number | null; worstCaseCostUsd: number | null;
}
export interface FrozenPlan {
  configuration: Configuration; calibration: CalibrationReport;
  acceptanceCases: Case[];
  /** Concrete randomized order, every task/product/repeat key exactly once. */
  executionOrder: string[];
}
export const planDigest = (plan: FrozenPlan): string => artifactDigest('frozen-plan', plan);
export const calibrationDigest = (report: CalibrationReport): string => artifactDigest('calibration', report);
export interface Interval { n: number; mean: number; variance: number; lower: number }
export interface FamilyAnalysis { family: Family; absolute: Interval; comparisons: { comparator: typeof comparators[number]; interval: Interval; margin: number }[]; floor: number; clears: boolean }
export interface AnalysisReport {
  status: 'criterion-met' | 'criterion-unmet' | 'indeterminate'; admissionEligible: false;
  method: string; planDigest: string; recordsDigest: string; records: ScoredRecord[];
  reasons: string[]; missing: string[]; failures: string[]; hardViolations: string[];
  families: FamilyAnalysis[];
}

function finite(value: number, min: number, max = Infinity): void { invariant(Number.isFinite(value) && value >= min && value <= max, 'invalid numeric configuration/record'); }
function integer(value: number, min: number): void { finite(value, min); invariant(Number.isSafeInteger(value), 'expected safe integer'); }
function text(value: string): void { invariant(typeof value === 'string' && value.trim().length > 0, 'missing explicit justification or identity'); }
function validateCases(cases: Case[], expected: Record<Family, number>): void {
  invariant(Array.isArray(cases), 'missing cases');
  const ids = new Set<string>(); const hashes = new Set<string>();
  for (const item of cases) {
    text(item.id); digest(item.digest); invariant(families.includes(item.family), 'unknown workload family');
    invariant(!ids.has(item.id) && !hashes.has(item.digest), 'duplicate task identity/content'); ids.add(item.id); hashes.add(item.digest);
  }
  for (const family of families) invariant(cases.filter(c => c.family === family).length === expected[family], `wrong task count: ${family}`);
}
function counts(n: number): Record<Family, number> { return Object.fromEntries(families.map(f => [f, n])) as Record<Family, number>; }
function validateConfiguration(c: Configuration, trust: Trust): void {
  invariant(c.protocol === 'A1-L08-v2', 'unsupported protocol'); digest(c.analysisSourceDigest); digest(c.evaluatorDigest);
  invariant(c.mode === 'controlled' || c.mode === 'native', 'unsupported comparison mode');
  for (const product of products) {
    const system = c.systems[product];
    for (const key of ['model', 'modelVersion', 'effort'] as const) text(system[key]);
    for (const key of ['source', 'dependencies', 'prompts', 'tools', 'context', 'resources', 'grant', 'prices'] as const) digest(system[key]);
  }
  if (c.mode === 'controlled') for (const product of comparators) for (const key of ['model', 'modelVersion', 'effort', 'tools', 'context', 'resources'] as const) {
    invariant(c.systems.candidate[key] === c.systems[product][key], `unmatched controlled ${key}: ${product}`);
  }
  validateCases(c.pilotCases, counts(5));
  for (const family of families) {
    const rule = c.families[family]; finite(rule.margin, Number.MIN_VALUE, 3); finite(rule.absoluteFloor, 0, 3);
    finite(rule.failureCostUsd, 0); text(rule.justification);
  }
  integer(c.seed, 0); finite(c.seed, 0, 0xffffffff); integer(c.simulations, 2); integer(c.maxTasksPerFamily, 2); integer(c.maxSimulationDraws, 1);
  finite(c.monteCarloErrorAlpha, Number.MIN_VALUE, 0.05);
  invariant(c.sensitivity.length > 0, 'missing sensitivity assumptions');
  const ids = new Set<string>();
  for (const s of c.sensitivity) { text(s.id); text(s.justification); finite(s.scale, 1); finite(s.tailMass, Number.MIN_VALUE, 1); invariant(!ids.has(s.id), 'duplicate sensitivity'); ids.add(s.id); }
  invariant(c.maxTasksPerFamily * c.simulations * c.sensitivity.length * 10 <= c.maxSimulationDraws, 'simulation work exceeds explicit ceiling');
  invariant(c.assumptions.independentTaskClusters && c.assumptions.representativePilot, 'unsupported task independence or pilot representativeness');
  text(c.assumptions.equalityModelJustification); text(c.assumptions.comparabilityJustification);
  integer(c.resources.maxAcceptanceExecutions, 1); finite(c.resources.maxAcceptanceCostUsd, 0);
  for (const p of products) finite(c.resources.worstCaseCostUsd[p], 0);
  invariant(trust.verifySeal('pilot-design-before-pilot', pilotDesignDigest(c)), 'pilot design lacks trusted pre-pilot seal');
  invariant(trust.verifySeal('configuration-before-candidate', configurationDigest(c)), 'configuration lacks trusted pre-candidate seal');
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
export function sampleVariance(xs: number[]): number { const m = mean(xs); return xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1); }
/** One-sided empirical Bernstein bound; independent bounded task clusters, never repeats. */
export function lowerInterval(xs: number[], lo: number, hi: number, alpha: number): Interval {
  invariant(xs.length >= 2 && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo, 'unsupported interval'); finite(alpha, Number.MIN_VALUE, 0.5);
  for (const x of xs) finite(x, lo, hi);
  const m = mean(xs), v = sampleVariance(xs), log = Math.log(2 / alpha);
  return { n: xs.length, mean: m, variance: v, lower: Math.max(lo, m - Math.sqrt(2 * v * log / xs.length) - 7 * (hi - lo) * log / (3 * (xs.length - 1))) };
}
export function executionKey(taskId: string, product: Product, repeat: number): string { return JSON.stringify([taskId, product, repeat]); }
function ingest(c: Configuration, cases: Case[], records: ScoredRecord[], phase: ScoredRecord['phase'], trust: Trust) {
  const allowed: readonly Product[] = phase === 'pilot' ? comparators : products;
  const byKey = new Map<string, ScoredRecord>(); const missing: string[] = []; const failures: string[] = []; const hardViolations: string[] = [];
  for (const record of records) {
    invariant(record.phase === phase && allowed.includes(record.product), 'wrong phase/product (candidate outcomes forbidden in calibration)');
    const task = cases.find(item => item.id === record.taskId);
    invariant(task && task.digest === record.caseDigest, 'unregistered task/content'); integer(record.repeat, 0); invariant(record.repeat < 3, 'unexpected repeat');
    invariant(record.systemDigest === artifactDigest('system', c.systems[record.product]) && record.evaluatorDigest === c.evaluatorDigest, 'unmatched system/evaluator identity');
    digest(record.evidenceDigest); invariant(trust.verifyRecord(record, recordDigest(record)), 'untrusted scored record');
    const key = executionKey(record.taskId, record.product, record.repeat); invariant(!byKey.has(key), 'duplicate execution record'); byKey.set(key, record);
    invariant(['scored', 'failed', 'missing'].includes(record.outcome), 'unknown outcome');
    if (record.outcome === 'scored') { integer(record.score!, 0); finite(record.score!, 0, 3); }
    else { text(record.reason!); invariant(record.score === (record.outcome === 'failed' ? 0 : null), 'failure must score zero; missing must remain null'); failures.push(`${key}: ${record.outcome}: ${record.reason}`); }
    for (const metric of ['costUsd', 'requests', 'tokens'] as const) {
      if (record[metric] === null) missing.push(`${key}: unknown ${metric}`);
      else if (metric === 'costUsd') finite(record[metric]!, 0); else integer(record[metric]!, 0);
    }
    invariant(Array.isArray(record.hardViolations), 'missing hard gate observations');
    for (const violation of record.hardViolations) { text(violation); hardViolations.push(`${key}: ${violation}`); }
  }
  for (const task of cases) for (const product of allowed) for (let repeat = 0; repeat < 3; repeat++) {
    const key = executionKey(task.id, product, repeat); const r = byKey.get(key);
    if (!r || r.outcome === 'missing') missing.push(`${key}: missing outcome`);
  }
  const clusters = (family: Family, product: Product): number[][] => cases.filter(c => c.family === family).map(task => [0, 1, 2].map(r => byKey.get(executionKey(task.id, product, r))!.score!));
  return { missing, failures, hardViolations, clusters };
}
function random(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function calibrate(config: Configuration, pilot: ScoredRecord[], trust: Trust): CalibrationReport {
  const report: CalibrationReport = { status: 'indeterminate', admissionEligible: false, method, configurationDigest: configurationDigest(config), pilotDigest: artifactDigest('pilot', pilot), records: structuredClone(pilot), missing: [], failures: [], reasons: [], summaries: [], power: [], tasksPerFamily: null, requiredExecutions: null, worstCaseCostUsd: null };
  try {
    validateConfiguration(config, trust);
    const data = ingest(config, config.pilotCases, pilot, 'pilot', trust);
    report.missing = data.missing; report.failures = data.failures;
    if (data.missing.length || data.hardViolations.length) { report.reasons.push('incomplete pilot or hard invariant violation', ...data.hardViolations); return report; }
    const rng = random(config.seed), selected = counts(0);
    const trials = config.maxTasksPerFamily * 10 * config.sensitivity.length;
    const mcPenalty = Math.sqrt(Math.log(trials / config.monteCarloErrorAlpha) / (2 * config.simulations));
    for (const family of families) {
      const cells: PowerCell[][] = [];
      for (const product of comparators) {
        const clusters = data.clusters(family, product), means = clusters.map(mean);
        report.summaries.push({ family, product, tasks: 5, repeats: 3, mean: mean(means), betweenTaskVariance: sampleVariance(means), meanWithinTaskVariance: mean(clusters.map(sampleVariance)) });
        for (const sensitivity of config.sensitivity) {
          invariant((Math.max(...means) - Math.min(...means)) * sensitivity.scale <= 3, 'sensitivity produces impossible score differences; revise comparator-only model');
          const success = new Array<number>(config.maxTasksPerFamily + 1).fill(0);
          for (let iteration = 0; iteration < config.simulations; iteration++) {
            let average = 0, m2 = 0;
            for (let n = 1; n <= config.maxTasksPerFamily; n++) {
              const x = rng() < sensitivity.tailMass ? (rng() < 0.5 ? -3 : 3) : sensitivity.scale * (means[Math.floor(rng() * 5)]! - means[Math.floor(rng() * 5)]!);
              const delta = x - average; average += delta / n; m2 += delta * (x - average);
              const log = Math.log(2 / (0.01 / 3));
              const lower = n < 2 ? -3 : Math.max(-3, average - Math.sqrt(2 * Math.max(0, m2 / (n - 1)) * log / n) - 14 * log / (n - 1));
              if (lower > -config.families[family].margin) success[n]!++;
            }
          }
          cells.push(success.map((s, n) => ({ family, comparator: product, sensitivity: sensitivity.id, tasks: n, successes: s, simulations: config.simulations, estimatedPower: s / config.simulations, lowerPower: Math.max(0, s / config.simulations - mcPenalty) })));
        }
      }
      let n = 2; for (; n <= config.maxTasksPerFamily; n++) if (cells.every(cs => cs[n]!.lowerPower >= 0.8)) break;
      if (n > config.maxTasksPerFamily) { report.reasons.push(`insufficient planning power through maxN: ${family}`); n = config.maxTasksPerFamily; }
      else selected[family] = n;
      report.power.push(...cells.map(cs => cs[n]!));
    }
    if (families.some(f => selected[f] === 0)) return report;
    report.tasksPerFamily = selected;
    const tasks = Object.values(selected).reduce((a, b) => a + b, 0);
    report.requiredExecutions = tasks * 3 * 3;
    report.worstCaseCostUsd = tasks * 3 * products.reduce((sum, p) => sum + config.resources.worstCaseCostUsd[p], 0);
    if (report.requiredExecutions > config.resources.maxAcceptanceExecutions || report.worstCaseCostUsd > config.resources.maxAcceptanceCostUsd) { report.status = 'infeasible'; report.reasons.push('selected design exceeds host resource grant'); }
    else report.status = 'planned';
  } catch (error) { report.reasons.push(errorText(error)); }
  return report;
}

export function freezePlan(configuration: Configuration, calibration: CalibrationReport, acceptanceCases: Case[], executionOrder: string[], trust: Trust): FrozenPlan {
  validateConfiguration(configuration, trust);
  invariant(calibration.status === 'planned' && calibration.tasksPerFamily !== null, 'calibration not feasible');
  // Recompute to prevent a trusted wrapper from accidentally sealing altered counts or stale pilots.
  invariant(calibrationDigest(calibrate(configuration, calibration.records, trust)) === calibrationDigest(calibration), 'calibration changed or does not reproduce');
  invariant(trust.verifySeal('calibration-before-candidate', calibrationDigest(calibration)), 'calibration lacks trusted pre-candidate seal');
  validateCases(acceptanceCases, calibration.tasksPerFamily);
  for (const c of acceptanceCases) invariant(!configuration.pilotCases.some(p => p.id === c.id || p.digest === c.digest), 'pilot task reused in acceptance');
  const keys = acceptanceCases.flatMap(c => products.flatMap(p => [0, 1, 2].map(r => executionKey(c.id, p, r))));
  invariant(executionOrder.length === keys.length && new Set(executionOrder).size === keys.length && keys.every(k => executionOrder.includes(k)), 'execution order not an exact permutation');
  return structuredClone({ configuration, calibration, acceptanceCases, executionOrder });
}
export function analyze(plan: FrozenPlan, records: ScoredRecord[], trust: Trust): AnalysisReport {
  const report: AnalysisReport = { status: 'indeterminate', admissionEligible: false, method, planDigest: planDigest(plan), recordsDigest: artifactDigest('acceptance-records', records), records: structuredClone(records), reasons: [], missing: [], failures: [], hardViolations: [], families: [] };
  try {
    const frozen = freezePlan(plan.configuration, plan.calibration, plan.acceptanceCases, plan.executionOrder, trust);
    invariant(planDigest(frozen) === report.planDigest && trust.verifySeal('plan-before-candidate', report.planDigest), 'plan lacks trusted pre-candidate seal');
    const data = ingest(plan.configuration, plan.acceptanceCases, records, 'acceptance', trust);
    report.missing = data.missing; report.failures = data.failures; report.hardViolations = data.hardViolations;
    if (data.hardViolations.length) { report.status = 'criterion-unmet'; report.reasons.push('hard invariant violation'); return report; }
    if (data.missing.length) { report.reasons.push('incomplete scored observations/accounting'); return report; }
    const budget = plan.configuration.resources;
    if (records.reduce((sum, r) => sum + r.costUsd!, 0) > budget.maxAcceptanceCostUsd || records.some(r => r.costUsd! > budget.worstCaseCostUsd[r.product])) {
      report.status = 'criterion-unmet'; report.reasons.push('observed costs exceed frozen grant or execution cost ceiling'); return report;
    }
    for (const family of families) {
      const candidate = data.clusters(family, 'candidate').map(mean), rule = plan.configuration.families[family];
      const absolute = lowerInterval(candidate, 0, 3, 0.01 / 3);
      const comparisons = comparators.map(comparator => { const baseline = data.clusters(family, comparator).map(mean); return { comparator, interval: lowerInterval(candidate.map((x, i) => x - baseline[i]!), -3, 3, 0.01 / 3), margin: rule.margin }; });
      report.families.push({ family, absolute, comparisons, floor: rule.absoluteFloor, clears: absolute.lower > rule.absoluteFloor && comparisons.every(c => c.interval.lower > -c.margin) });
    }
    report.status = report.families.every(f => f.clears) ? 'criterion-met' : 'indeterminate';
    if (report.status === 'indeterminate') report.reasons.push('one or more bounds do not clear preregistered margin/floor; no expansion permitted');
  } catch (error) { report.reasons.push(errorText(error)); }
  return report;
}
