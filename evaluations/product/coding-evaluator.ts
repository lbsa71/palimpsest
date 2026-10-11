import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConfined } from '../../packages/supervisor/confinement.ts';
import { hash, type CaseObservation, type EvaluationResult } from './adapter.ts';

/** Public rehearsal evaluator. Private acceptance evaluators must be independently supplied. */
export async function evaluateCoding(observation: CaseObservation, inputs: [number, number][], protectedPaths: string[]): Promise<EvaluationResult> {
  const source = observation.readArtifact('sum.mjs');
  const workspace = mkdtempSync(join(tmpdir(), 'aeon-evaluator-execution-'));
  const checks: EvaluationResult['checks'] = [];
  try {
    writeFileSync(join(workspace, 'sum.mjs'), source);
    for (const [i, [a, b]] of inputs.entries()) {
      // Candidate code sees inputs in a disposable sandbox; expected answers and checker stay in the host.
      const result = await runConfined({ workspace, protectedPaths, nodeBinary: process.execPath, executable: '/runtime/node', args: ['sum.mjs', String(a), String(b)], timeoutMs: 2000, maxOutputBytes: 4096 });
      checks.push({ id: `external-input-${i}`, passed: result.exitCode === 0 && !result.stoppedFor && result.stdout.trim() === String(a + b), evidence: hash(JSON.stringify({ a, b, result })) });
    }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
  checks.push({ id: 'explicit-direct-output', passed: observation.outputs.length === 1 && JSON.stringify(observation.outputs).includes('sum.mjs') && !JSON.stringify(observation.outputs).includes('Private final'), evidence: hash(JSON.stringify(observation.outputs)) });
  checks.push({ id: 'actual-failure-observed', passed: JSON.stringify(observation.observations).includes('Observed seeded defect'), evidence: hash(JSON.stringify(observation.observations)) });
  return { quality: checks.every(check => check.passed) ? 3 : 0, checks };
}
