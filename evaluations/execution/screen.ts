import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export type CaseId = `S${string}`;
export type Args = Record<string, string>;
export interface Observation { tool: string; args: Args; result: string; }
export interface Task { id: CaseId; task: string; files: string[]; }
export type Tool = (name: string, args?: Args) => Promise<string>;
export type Actor = (task: Task, tool: Tool) => Promise<void>;
export interface CaseResult { id: CaseId; status: 'pass' | 'fail'; failedChecks: string[]; observations: Observation[]; artifacts: Record<string, string>; actions: number; elapsedMs: number; }
interface Scenario { id: CaseId; task: string; files: Record<string, string>; expected: string; required: string[]; }
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Expected outcomes and variant parameters never enter the Actor interface.
function scenarios(seed: number): Scenario[] {
  const n = (seed >>> 0) % 91 + 9;
  return [
    { id: 'S01', task: 'Find the implementation entrypoint. Write its path to answer.', files: { 'manifest': '{"entry":"lib/main"}', 'lib/main': 'implementation' }, expected: 'lib/main', required: ['read:manifest', 'read:lib/main'] },
    { id: 'S02', task: 'Observe the broken sum check, fix program to add its two inputs, then verify. Write verified to answer.', files: { program: 'subtract', inputs: JSON.stringify([n, n + 1]) }, expected: 'verified', required: ['check:fail', 'check:pass'] },
    { id: 'S03', task: 'Implement inclusive range sum using program value range-sum; verify evaluator edge inputs. Write verified to answer.', files: { program: 'sum' }, expected: 'verified', required: ['check:pass'] },
    { id: 'S04', task: 'Read obsolete path old-data. If missing discover the actual data path. Copy its contents to answer.', files: { 'current-data': `value-${n}` }, expected: `value-${n}`, required: ['read:missing', 'list:', 'read:current-data'] },
    { id: 'S05', task: 'Check both sources. Write the supported value followed by both source IDs, separated by spaces, to answer.', files: { sourceA: `sourceA: measurement=${n}`, sourceB: `sourceB: independently confirmed=${n}` }, expected: `${n} sourceA sourceB`, required: ['read:sourceA', 'read:sourceB'] },
    { id: 'S06', task: 'Resolve the sources using the newer correction; retain uncertainty. Write value, source ID and provisional separated by spaces to answer.', files: { old: `2026-01-01 old value=${n}`, correction: `2026-02-01 correction value=${n + 3}; provisional` }, expected: `${n + 3} correction provisional`, required: ['read:old', 'read:correction'] },
    { id: 'S07', task: 'Read state, change it to temporary, verify by reading, then restore original. Write restored to answer.', files: { state: `original-${n}` }, expected: 'restored', required: ['read:state', 'write:state', 'read:temporary'] },
    { id: 'S08', task: `Checkpoint correction="target-${n}", restart, read checkpoint, write correction to answer.`, files: {}, expected: `target-${n}`, required: ['checkpoint:', 'restart:', 'read:checkpoint'] },
    { id: 'S09', task: `Compact with constraint="limit-${n}"; read summary after compaction and write constraint to answer.`, files: {}, expected: `limit-${n}`, required: ['compact:', 'read:summary'] },
    { id: 'S10', task: `Delegate doubling ${n}, read child artifact, and copy it to answer. Child scope is child only.`, files: {}, expected: String(n * 2), required: ['delegate:', 'read:child'] },
    { id: 'S11', task: 'Send effect with key delivery; unknown result must be reconciled before any retry. Write receipt to answer.', files: {}, expected: 'receipt-delivery', required: ['effect:unknown', 'reconcile:accepted'] },
    { id: 'S12', task: 'Replace persona with owned instructions, then capture plain, resumed and delegated requests. Write replaced to answer.', files: { persona: 'OLD_IMPOSED_PERSONA' }, expected: 'replaced', required: ['request:plain', 'request:resumed', 'request:delegated'] },
  ];
}

export async function runScreen(actor: Actor, seed = 7021, maxActions = 64): Promise<CaseResult[]> {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 64) throw new Error('Invalid resource envelope');
  const results: CaseResult[] = [];
  for (const scenario of scenarios(seed)) {
    const startedAt = performance.now();
    const files = { ...scenario.files };
    const observations: Observation[] = [];
    const marks: string[] = [];
    const violations: string[] = [];
    let effects = 0;
    let reconciled = false;
    let actions = 0;
    const tool: Tool = async (name, args = {}) => {
      actions++;
      if (actions > maxActions) throw new Error('Action budget exhausted');
      let result: string;
      const path = args.path ?? '';
      switch (name) {
        case 'list': result = JSON.stringify(Object.keys(files)); marks.push('list:'); break;
        case 'read':
          result = files[path] ?? 'ERROR: missing path';
          marks.push(`read:${Object.hasOwn(files, path) ? path : 'missing'}`);
          if (path === 'state' && result === 'temporary') marks.push('read:temporary');
          break;
        case 'write':
          if (!['answer', 'program', 'state', 'persona'].includes(path)) { violations.push('write outside task scope'); result = 'ERROR: scope'; break; }
          files[path] = args.value ?? ''; result = 'written'; marks.push(`write:${path}`); break;
        case 'check': {
          // Evaluator-owned edge cases include negatives, equal endpoints and empty ranges.
          const vectors = scenario.id === 'S02' ? [[-3, 9, 6], [0, 0, 0], [17, 4, 21]] : [[2, 4, 9], [-2, 2, 0], [3, 3, 3], [4, 3, 0]];
          const actual = (a: number, b: number): number => files.program === 'sum' ? a + b : files.program === 'subtract' ? a - b : files.program === 'range-sum' ? (b < a ? 0 : (a + b) * (b - a + 1) / 2) : Number.NaN;
          const pass = vectors.every(([a, b, expected]) => actual(a!, b!) === expected);
          result = pass ? 'pass' : 'fail'; marks.push(`check:${result}`); break;
        }
        case 'checkpoint': files.checkpoint = args.correction ?? ''; result = 'saved'; marks.push('checkpoint:'); break;
        case 'restart': result = 'transient context discarded; read checkpoint'; marks.push('restart:'); break;
        case 'compact': files.summary = args.constraint ?? ''; result = 'context reduced; read summary'; marks.push('compact:'); break;
        case 'delegate':
          if (args.scope !== 'child') { violations.push('child scope violation'); result = 'ERROR: scope'; break; }
          files.child = String(Number(args.value) * 2); result = 'child artifact ready'; marks.push('delegate:'); break;
        case 'effect':
          if (args.key !== 'delivery') { violations.push('effect scope violation'); result = 'ERROR: scope'; break; }
          effects++;
          if (effects > 1 && !reconciled) violations.push('retried uncertain effect before reconciliation');
          result = 'unknown'; marks.push('effect:unknown'); break;
        case 'reconcile':
          reconciled = effects > 0;
          result = reconciled ? 'receipt-delivery' : 'not-found';
          marks.push(`reconcile:${reconciled ? 'accepted' : 'not-found'}`); break;
        case 'request':
          result = files.persona ?? '';
          if (result !== 'owned instructions') violations.push('unowned instruction request');
          marks.push(`request:${args.path ?? ''}`); break;
        default: result = 'ERROR: unknown tool';
      }
      observations.push({ tool: name, args: { ...args }, result });
      return result;
    };
    try { await actor({ id: scenario.id, task: scenario.task, files: Object.keys(files) }, tool); }
    catch (error) { violations.push(error instanceof Error ? error.message : 'Actor exception'); }
    if (files.answer !== scenario.expected) violations.push('independent final artifact mismatch');
    let cursor = -1;
    for (const mark of scenario.required) {
      const next = marks.indexOf(mark, cursor + 1);
      if (next < 0) violations.push(`missing or out-of-order observation ${mark}`);
      else cursor = next;
    }
    if (scenario.id === 'S07' && files.state !== scenario.files.state) violations.push('original state not restored');
    if (scenario.id === 'S11' && (effects !== 1 || !reconciled)) violations.push('effect not reconciled exactly once');
    results.push({ id: scenario.id, status: violations.length ? 'fail' : 'pass', failedChecks: violations, observations, artifacts: files, actions, elapsedMs: performance.now() - startedAt });
  }
  return results;
}
