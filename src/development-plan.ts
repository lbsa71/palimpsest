import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export type DevelopmentWorkId = 'P06-memory-provenance' | 'P06-memory-context-budget';
export type DevelopmentCheckId = 'memory-provenance' | 'memory-context-budget';
export interface DevelopmentWorkItem {
  readonly id: DevelopmentWorkId;
  readonly planItem: 'P06';
  readonly requirements: readonly string[];
  readonly title: string;
  readonly problem: string;
  readonly expectedBehavior: string;
  readonly acceptanceCriteria: readonly string[];
  readonly nonGoals: readonly string[];
  readonly materialRisks: readonly string[];
  readonly dependencies: readonly DevelopmentWorkId[];
  readonly permittedPaths: readonly ['src/agent/brain.ts'];
  readonly authoritativeChecks: readonly DevelopmentCheckId[];
  readonly budget: { readonly proposalCalls: 1; readonly releaseCalls: 8; readonly maxAttempts: number; readonly retryAfterMs: number };
}
export interface DevelopmentPlan { readonly version: 1; readonly digest: string; readonly items: readonly DevelopmentWorkItem[] }
export interface LoadDevelopmentPlanOptions { repositoryRoot: string; expectedDigest?: string }
export const DEVELOPMENT_PLAN_PATH = 'config/development-plan.json';
const MAX_BYTES = 65_536;
const workIds: DevelopmentWorkId[] = ['P06-memory-provenance', 'P06-memory-context-budget'];
const checkIds: DevelopmentCheckId[] = ['memory-provenance', 'memory-context-budget'];
const requirementIds = ['R03', 'R07', 'R17', 'R19'];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Development plan requires plain JSON objects');
  return value as Record<string, unknown>;
}
function shape(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('Development plan has missing or unknown fields/options');
}
function text(value: unknown, maximum = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('Development plan text is empty or excessive');
  return value;
}
function strings(value: unknown, minimum: number, maximum: number, allowed?: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error('Development plan array has invalid size');
  const result = value.map(item => text(item));
  if (new Set(result).size !== result.length || (allowed && result.some(item => !allowed.includes(item)))) throw new Error('Development plan has duplicate or unknown identifiers');
  return result;
}
function equal(actual: readonly string[], expected: readonly string[]): boolean { return JSON.stringify(actual) === JSON.stringify(expected); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

/** Pure validation is diagnostic, not authorization. Runtime authority comes only
 * from loading the fixed tracked host catalog with loadDevelopmentPlan. */
export function validateDevelopmentPlan(input: unknown): DevelopmentPlan {
  const root = record(input); shape(root, ['version', 'items']);
  if (root.version !== 1) throw new Error('Unsupported development plan schema version');
  if (!Array.isArray(root.items) || root.items.length !== 2) throw new Error('Development plan v1 requires its two specified work items');
  const items = root.items.map(value => {
    const item = record(value);
    shape(item, ['id', 'planItem', 'requirements', 'title', 'problem', 'expectedBehavior', 'acceptanceCriteria', 'nonGoals', 'materialRisks', 'dependencies', 'permittedPaths', 'authoritativeChecks', 'budget']);
    if (!workIds.includes(item.id as DevelopmentWorkId) || item.planItem !== 'P06') throw new Error('Unknown development plan work or PLAN linkage');
    const id = item.id as DevelopmentWorkId;
    const dependencies = strings(item.dependencies, 0, 2, workIds) as DevelopmentWorkId[];
    const permittedPaths = strings(item.permittedPaths, 1, 1, ['src/agent/brain.ts']) as ['src/agent/brain.ts'];
    const authoritativeChecks = strings(item.authoritativeChecks, 1, 2, checkIds) as DevelopmentCheckId[];
    const budget = record(item.budget); shape(budget, ['proposalCalls', 'releaseCalls', 'maxAttempts', 'retryAfterMs']);
    if (budget.proposalCalls !== 1 || budget.releaseCalls !== 8 || !Number.isSafeInteger(budget.maxAttempts) || (budget.maxAttempts as number) < 1 || (budget.maxAttempts as number) > 3
      || !Number.isSafeInteger(budget.retryAfterMs) || (budget.retryAfterMs as number) < 60_000 || (budget.retryAfterMs as number) > 86_400_000) throw new Error('Development plan budget exceeds its bounded contract');
    return {
      id, planItem: 'P06' as const, requirements: strings(item.requirements, 1, 4, requirementIds),
      title: text(item.title, 512), problem: text(item.problem, 4000), expectedBehavior: text(item.expectedBehavior, 4000),
      acceptanceCriteria: strings(item.acceptanceCriteria, 1, 20), nonGoals: strings(item.nonGoals, 1, 10), materialRisks: strings(item.materialRisks, 1, 10),
      dependencies, permittedPaths, authoritativeChecks,
      budget: { proposalCalls: 1 as const, releaseCalls: 8 as const, maxAttempts: budget.maxAttempts as number, retryAfterMs: budget.retryAfterMs as number },
    } satisfies DevelopmentWorkItem;
  });
  if (new Set(items.map(item => item.id)).size !== items.length || workIds.some(id => !items.some(item => item.id === id))) throw new Error('Development plan has duplicate or missing work identities');
  const visited = new Set<DevelopmentWorkId>(); const visiting = new Set<DevelopmentWorkId>();
  const visit = (id: DevelopmentWorkId) => {
    if (visiting.has(id)) throw new Error('Development plan dependency cycle');
    if (visited.has(id)) return;
    const item = items.find(candidate => candidate.id === id); if (!item) throw new Error('Development plan dependency is missing');
    visiting.add(id); item.dependencies.forEach(visit); visiting.delete(id); visited.add(id);
  };
  items.forEach(item => visit(item.id));
  for (const item of items) {
    const expectedDependencies = item.id === workIds[0] ? [] : [workIds[0]!];
    const expectedChecks = item.id === workIds[0] ? [checkIds[0]!] : checkIds;
    if (!equal(item.dependencies, expectedDependencies) || !equal(item.authoritativeChecks, expectedChecks)) throw new Error('Development plan cannot weaken its dependency or authoritative check contract');
  }
  const payload = { version: 1 as const, items };
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BYTES) throw new Error('Development plan exceeds its total size bound');
  const digest = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  return freeze({ ...payload, digest });
}

/** The host chooses its checkout; candidates cannot supply JSON, a file path,
 * untracked content, or frozen source directories as catalog authority. The
 * catalog must also be included in the frozen governance digest by admission. */
export function loadDevelopmentPlan(options: LoadDevelopmentPlanOptions): DevelopmentPlan {
  const value = record(options); shape(value, ['repositoryRoot'], ['expectedDigest']);
  const repositoryRoot = realpathSync(text(value.repositoryRoot, 4096));
  let actualRoot: string;
  try { actualRoot = realpathSync(execFileSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()); }
  catch { throw new Error('Development plan requires a trusted Git checkout root'); }
  if (actualRoot !== repositoryRoot) throw new Error('Development plan requires the exact checkout root');
  const directory = lstatSync(join(repositoryRoot, 'config'));
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error('Development plan config directory cannot be a symlink');
  const path = join(repositoryRoot, DEVELOPMENT_PLAN_PATH); const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Development plan must be a regular file, never a symlink');
  if (stat.size < 1 || stat.size > MAX_BYTES) throw new Error('Development plan file has invalid size');
  try { execFileSync('/usr/bin/git', ['ls-files', '--error-unmatch', '--', DEVELOPMENT_PLAN_PATH], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Development plan must be tracked host input'); }
  const contents = readFileSync(path);
  if (contents.length > MAX_BYTES) throw new Error('Development plan file exceeds its size bound');
  const plan = validateDevelopmentPlan(JSON.parse(contents.toString('utf8')));
  if (value.expectedDigest !== undefined && (typeof value.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedDigest) || value.expectedDigest !== plan.digest)) throw new Error('Development plan catalog digest mismatch');
  return plan;
}
