import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCodexBaseline } from './plan.ts';
import { digest } from '../execution/screen.ts';
const input = { executable: '/bin/codex', workspace: '/tmp/eval', model: 'explicit-model', effort: 'high', prompt: 'Task with $(literal text)', grant: { id: 'grant', maxCostUsd: 1, maxPhysicalRequests: 64, wallMs: 900000 }, configurationDigest: digest('frozen'), observerId: 'host' };
test('baseline plan uses argument array and stdin without executing or inheriting ambient config', () => {
  const plan = prepareCodexBaseline(input);
  assert.equal(plan.stdin, input.prompt); assert(plan.args.includes('--ignore-user-config')); assert.equal(plan.execution, 'not-run');
});
test('missing spend/resource cap and unpinned configuration are rejected before any invocation', () => {
  assert.throws(() => prepareCodexBaseline({ ...input, grant: { ...input.grant, maxCostUsd: Number.NaN } }));
  assert.throws(() => prepareCodexBaseline({ ...input, configurationDigest: 'unfrozen' }));
});
