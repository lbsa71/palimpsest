import { createHash } from 'node:crypto';
import { identity, invariant, type JsonValue, type PhysicalRequest, type ShellPort } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { DEFAULT_CODEX_CODING_MODEL, CODEX_CODING_REASONING_EFFORT, type CodingProvider, type CodingResult } from '../packages/coding/index.ts';
import type { CodingSession, CodingTurn } from './coding-limb.ts';

export function codexCodingShell(options: { provider: CodingProvider; store: OperationalStore; session(): CodingSession; turn(runId: string): CodingTurn;
  executionBudget(runId: string): { timeoutMs: number; reservationElapsedMs: number; maxTokens: number }; timeoutMs: number; model?: string; onProcessStopped?(requestId: string): void }): ShellPort {
  return { async run(input, bridge, signal) {
    const session = options.session(), turn = options.turn(input.run.id);
    const budget = options.executionBudget(input.run.id);
    invariant(Number.isSafeInteger(budget.timeoutMs) && budget.timeoutMs > 0 && budget.timeoutMs <= options.timeoutMs,
      'Coding execution requires a positive remaining time budget within its configured timeout');
    invariant(Number.isSafeInteger(budget.maxTokens) && budget.maxTokens > 0, 'Coding execution requires a positive remaining token budget');
    invariant(Number.isSafeInteger(budget.reservationElapsedMs) && budget.reservationElapsedMs >= budget.timeoutMs,
      'Coding execution requires an elapsed reservation covering its deadline and process cleanup');
    const request = { message: turn.message, workspace: session.workspace, timeoutMs: budget.timeoutMs,
      ...(session.nativeSessionId ? { sessionId: session.nativeSessionId } : {}), ...(session.cumulativeUsage ? { previousUsage: session.cumulativeUsage } : {}) };
    const payload = JSON.stringify({ provider: 'codex-cli', invocation: request, model: options.model ?? DEFAULT_CODEX_CODING_MODEL, reasoningEffort: CODEX_CODING_REASONING_EFFORT, singleAgent: true });
    const manifest = { ...input.prompt, id: `coding:${identity(turn.id)}`, requestDigest: identity(JSON.parse(payload)) };
    manifest.requestDigest = createHash('sha256').update(payload).digest('hex');
    await bridge.capturePrompt(manifest, payload);
    const physical: PhysicalRequest = { id: `coding-invocation:${turn.id}`, runId: input.run.id, purpose: 'delegation', provider: 'codex-cli', model: options.model ?? DEFAULT_CODEX_CODING_MODEL,
      promptManifestId: manifest.id, requestDigest: manifest.requestDigest, reservationId: `coding-invocation:${turn.id}`, status: 'reserved',
      usage: { requests: 1, inputTokens: budget.maxTokens, outputTokens: 0, costUsd: null, elapsedMs: budget.reservationElapsedMs } };
    await bridge.reserve(physical, signal);
    await bridge.dispatched({ ...physical, status: 'dispatched' }, signal);
    let result: CodingResult;
    try { result = await options.provider.run(request, signal); }
    catch (error) { result = { provider: 'codex', status: 'uncertain', summary: error instanceof Error ? error.message : String(error), events: [], stdout: '', stderr: '', exitCode: null, elapsedMs: 0,
      usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null, physicalRequests: null } }; }
    const artifact = options.store.putJsonArtifact(JSON.parse(JSON.stringify(result)) as JsonValue);
    options.store.put('host.coding-results', turn.id, { artifact }, null);
    try {
      await bridge.settle({ ...physical, status: result.status === 'completed' ? 'succeeded' : result.status === 'failed' ? 'failed' : 'uncertain',
        usage: { requests: 1, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: null, elapsedMs: result.elapsedMs } });
    } finally { if (result.processStopped) options.onProcessStopped?.(physical.id); }
    if (signal?.aborted) return { status: 'cancelled', observations: [] };
    const checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, 'coding-cli/1', JSON.parse(JSON.stringify({ result: artifact, turnId: turn.id, sessionId: result.sessionId ?? null, observationIds: [] })) as JsonValue);
    return { status: 'checkpointed', checkpoint, observations: [] };
  } };
}
