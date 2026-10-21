import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluationFeedback } from './evaluation-feedback.ts';
import type { EvaluationReceipt } from './evolution-tools.ts';
const usage = { requests: 1, inputTokens: 2, outputTokens: 3, costUsd: 0, elapsedMs: 4 };
const ref = { uri: 'sha256:' + 'a'.repeat(64), sha256: 'a'.repeat(64) };
const evaluation = { requestId: 'r', candidateId: 'c', policyDigest: 'p', evidence: [{ caseResults: [{ id: 'independent-source-review', status: 'unavailable', observations: ref, usage }] }] } as EvaluationReceipt;
const observation = { requestId: 'r', candidateId: 'c', policyDigest: 'p', verdict: { verdict: 'refuse', reason: 'Fix evidence', findings: ['Missing tests'] }, prompt: 'SECRET', response: 'SECRET', source: 'SECRET', key: 'SECRET' };
test('exact refs, allowlist and text bounds', () => {
  const result = JSON.stringify(evaluationFeedback(evaluation, (actual, max) => { assert.deepEqual(actual, ref); assert.equal(max, 262144); return observation; }));
  assert.match(result, /Missing tests/); assert.doesNotMatch(result, /SECRET|prompt|response/);
  const large = JSON.stringify(evaluationFeedback(evaluation, () => ({ ...observation, verdict: { verdict: 'fail', reason: 'x'.repeat(50000), findings: Array(40).fill('y'.repeat(9000)) } })));
  assert.ok(large.length < 9000); assert.match(large, /"truncated":true/);
});
test('unavailable diagnostics', () => {
  for (const read of [() => { throw Error('SECRET'); }, () => null, () => ({ ...observation, candidateId: 'other' }), () => ({ ...observation, verdict: {} })]) {
    const result = JSON.stringify(evaluationFeedback(evaluation, read)); assert.match(result, /"available":false/); assert.doesNotMatch(result, /SECRET/);
  }
});
test('compiler result allowlist', () => {
  const input = structuredClone(evaluation); input.evidence[0]!.caseResults[0]!.id = 'engineering-build';
  const result = JSON.stringify(evaluationFeedback(input, () => ({ ...observation, execution: 'SECRET', command: { exitCode: 1, signal: null, stdout: 'type error', stderr: 'diagnostic', env: 'SECRET' } })));
  assert.match(result, /type error/); assert.match(result, /"exitCode":1/); assert.doesNotMatch(result, /SECRET|execution/);
});
