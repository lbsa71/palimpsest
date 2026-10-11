import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../../packages/contracts/index.ts';
import { assessOffline, parseOfflinePlan, type OfflinePlan } from './index.ts';

export function validatorPlan(runnerDigest: string): OfflinePlan {
  return { version: 2, runnerDigest, cases: [{ id: 'validator-string-length', kind: 'validator-string-length', timeoutMs: 3000, maxOutputBytes: 4096,
    inputs: [
      { schema: { type: 'string', minLength: 1 }, value: '' },
      { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: 'a' },
      { schema: { type: 'string', maxLength: 1 }, value: 'ab' },
      { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: '\ud83d\ude80' },
      { schema: { type: 'string', minLength: 2 }, value: '\ud83d\ude80' },
      { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: '\ud83d' },
      { schema: { type: 'string', minLength: 1, maxLength: 1 }, value: '\ude80' },
      { schema: { type: 'string' }, value: 17 },
      { schema: { type: 'string' }, value: null },
    ], expected: [false, true, false, true, false, true, true, false, false] }] };
}
test('offline private plans reject duplicate keys/cases, excessive bounds and arbitrary executable/schema inputs', () => {
  const plan = validatorPlan('a'.repeat(64));
  assert.deepEqual(parseOfflinePlan(Buffer.from(canonicalJson(plan))), plan);
  assert.throws(() => parseOfflinePlan(Buffer.from(canonicalJson(plan).replace('"version":2', '"version":2,"version":2'))), /Canonical/);
  for (const mutate of [
    (p: any) => p.cases.push(p.cases[0]),
    (p: any) => p.cases[0].timeoutMs = 60000,
    (p: any) => p.cases[0].expected.pop(),
    (p: any) => p.cases[0].inputs[0].schema.$ref = '/private',
    (p: any) => p.executable = '/bin/sh',
  ]) {
    const copy = structuredClone(plan); mutate(copy);
    assert.throws(() => parseOfflinePlan(Buffer.from(canonicalJson(copy))));
  }
});
test('offline verdict requires actual matching bounded command output, not exit zero or self-awarded pass', () => {
  const c = validatorPlan('a'.repeat(64)).cases[0]!;
  const command = { exitCode: 0, signal: null, stdout: JSON.stringify(c.expected), stderr: '', elapsedMs: 1 };
  assert.equal(assessOffline(c, command), true);
  for (const change of [{ exitCode: 1 }, { stoppedFor: 'output-limit' as const }, { stdout: '[true]' }, { stdout: '{"passed":true}' }, { stdout: 'unparseable' }]) assert.equal(assessOffline(c, { ...command, ...change }), false);
});
