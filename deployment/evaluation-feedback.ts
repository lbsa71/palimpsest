import type { ArtifactRef, JsonValue } from '../packages/contracts/index.ts';
import type { EvaluationReceipt } from './evolution-tools.ts';

/** Owned, validated evaluations only; no prompt/response traversal. */
export function evaluationFeedback(evaluation: EvaluationReceipt, read: (ref: ArtifactRef, maxBytes: number) => unknown): JsonValue {
  let remaining = 8192, truncated = false;
  const text = (value: unknown, limit = 1024): string => {
    if (typeof value !== 'string') throw Error();
    const result = value.slice(0, Math.min(limit, remaining)); remaining -= result.length;
    truncated ||= result.length < value.length; return result;
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value as Record<string, unknown>;
  };
  const cases: JsonValue[] = [];
  for (const evidence of evaluation.evidence) for (const item of evidence.caseResults) {
    if (cases.length === 8) { truncated = true; break; }
    let feedback: JsonValue;
    try {
      if (!['engineering-build', 'independent-source-review'].includes(item.id)) throw Error();
      const ref = item.observations;
      if (!/^[a-f0-9]{64}$/.test(ref.sha256) || ![`sha256:${ref.sha256}`, `aeon:artifact:${ref.sha256}`].includes(ref.uri)) throw Error();
      const value = object(read({ ...ref }, 262144));
      for (const key of ['requestId', 'candidateId', 'policyDigest'] as const) if (value[key] !== evaluation[key]) throw Error();
      if (item.id === 'independent-source-review') {
        const verdict = object(value.verdict);
        if (!['pass', 'fail', 'refuse'].includes(String(verdict.verdict)) || !Array.isArray(verdict.findings) || !verdict.findings.every(v => typeof v === 'string')) throw Error();
        truncated ||= verdict.findings.length > 8;
        feedback = { available: true, verdict: verdict.verdict as string, reason: text(verdict.reason, 2048), findings: verdict.findings.slice(0, 8).map(v => text(v, 512)) };
      } else {
        const command = object(value.command);
        if (command.exitCode !== null && !Number.isInteger(command.exitCode) || command.signal !== null && typeof command.signal !== 'string') throw Error();
        feedback = { available: true, compiler: { exitCode: command.exitCode as number | null, signal: command.signal === null ? null : text(command.signal, 32), stdout: text(command.stdout, 2048), stderr: text(command.stderr, 2048) } };
      }
    } catch { feedback = { available: false, reason: 'Diagnostic unavailable or invalid.' }; }
    const { requests, inputTokens, outputTokens, costUsd, elapsedMs } = item.usage;
    cases.push({ id: item.id.slice(0, 128), status: item.status, usage: { requests, inputTokens, outputTokens, costUsd, elapsedMs }, feedback });
  }
  return { cases, truncated };
}
