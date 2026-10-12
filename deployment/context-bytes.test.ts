import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, identity, validateCapturedPrompt, type JsonValue, type PhysicalRequest, type PromptFragment, type ShellBridge, type ShellInput } from '../packages/contracts/index.ts';
import { createTestShell } from '../packages/agent-shell/tool-instructions.test-fixture.ts';
import { SHELL_REVISION } from '../packages/agent-shell/index.ts';
import { digest, emptyUsage } from '../packages/agent-shell/mistral.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { projectSourceObservation } from './source-observation.ts';

const envelope = { maxRequests: 256, maxTokens: 1000000, maxCostUsd: 5, maxElapsedMs: 604800000, maxConcurrency: 8 };
const conversation = { ...envelope, maxRequests: 64, maxTokens: 250000, maxCostUsd: 1.25, maxConcurrency: 4 };
function memoryStore(): OperationalStore {
  const rows = new Map<string, Map<string, { revision: number; value: unknown }>>();
  return { transaction<T>(operation: () => T) { return operation(); }, get(namespace: string, key: string) { const row = rows.get(namespace)?.get(key); return row && structuredClone(row); },
    put(namespace: string, key: string, value: unknown, expected: number | null) { const group = rows.get(namespace) ?? new Map(); rows.set(namespace, group); const old = group.get(key); assert.equal(old?.revision ?? null, expected); group.set(key, { revision: (old?.revision ?? -1) + 1, value: structuredClone(value) }); },
    list(namespace: string) { return [...(rows.get(namespace)?.entries() ?? [])].map(([key, row]) => ({ key, ...structuredClone(row) })); },
  } as unknown as OperationalStore;
}
function chargedToRun(store: OperationalStore): number { return store.list<{ request: { runId: string }; charged: { tokens: number } }>('requests').filter(row => row.value.request.runId === 'run').reduce((sum, row) => sum + row.value.charged.tokens, 0); }
function fixture(thresholdBytes?: number, failedSummary = false, onlySource = false) {
  const store = memoryStore(), ledger = new ResourceLedger(store, { tokens: 250000, costUsd: 1, elapsedMs: 180000 }, () => 0);
  ledger.allocate('operating', envelope); ledger.allocate('run', conversation, 'operating');
  function prior(id: string, runId: string, tokens: number) {
    const request: PhysicalRequest = { id, runId, provider: 'fixture', model: 'prior-model', purpose: 'reasoning', promptManifestId: id, requestDigest: '0'.repeat(64), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: tokens, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
    ledger.reserve(request); ledger.dispatched({ ...request, status: 'dispatched' }); ledger.settle({ ...request, status: 'succeeded' });
  }
  prior('other-history', 'operating', 682716); prior('conversation-history', 'run', 101497);
  const priorRows = [store.get('requests', 'other-history')!.value, store.get('requests', 'conversation-history')!.value];
  const files = Array.from({ length: 826 }, (_, index) => ({ path: `packages/fixture/accepted-source-with-realistic-long-path-${index}.ts`, sha256: digest(String(index)), bytes: 10 }));
  const sourceReceipt = { exitCode: 0, signal: null, stdout: JSON.stringify({ files, bytes: 8260, source: 'accepted application snapshot', copiedAt: '2026-10-12T00:00:00Z' }), stderr: '', elapsedMs: 1 };
  const assistant = (step: string, name: string) => ({ role: 'assistant', content: [{ type: 'toolCall', id: `call-${step}`, name, arguments: {} }], aeonStepId: step, stopReason: 'toolUse', api: 'mistral-chat-completions', provider: 'mistral', model: 'fixture', usage: emptyUsage(), timestamp: 0 });
  const result = (step: string, name: string, value: unknown, isError = false) => ({ role: 'toolResult', toolCallId: `call-${step}`, toolName: name, content: [{ type: 'text', text: canonicalJson(value) }], aeonStepId: step, isError, timestamp: 0 });
  const user = (content: string) => ({ role: 'user', content, timestamp: 0 });
  const prefix = [user(onlySource ? 'Initial source request.' : 'p'.repeat(90000)), assistant('source', 'source_checkout'), result('source', 'source_checkout', sourceReceipt), ...Array.from({ length: onlySource ? 7 : 13 }, (_, index) => user(`Recorded input ${index}`))];
  const workspaceFiles = Array.from({ length: 826 }, (_, index) => `packages/source/fixture-long-file-name-${index}.ts`);
  const tail = onlySource ? [] : [assistant('discover', 'workspace_discover'), result('discover', 'workspace_discover', { files: workspaceFiles }), assistant('command', 'command_run'), result('command', 'command_run', { error: 'Executable not granted' }, true), user(JSON.stringify({ hostContext: { previousMemory: 'h'.repeat(24533) } })), { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Prior admission refused', aeonStepId: 'refused', api: 'mistral-chat-completions', provider: 'mistral', model: 'fixture', usage: emptyUsage(), timestamp: 0 }, user(JSON.stringify({ hostContext: { boundedMemory: 'h'.repeat(8192) } }))];
  const history = [...prefix, ...tail];
  const summaryText = 'Summarize the observed state and uncertainty.';
  const instruction: PromptFragment = { id: 'summary', owner: 'application', role: 'system', order: 0, scope: { kind: 'public' }, artifact: { uri: 'fixture:summary', sha256: digest(summaryText) }, replaceable: true, derivedFrom: [] };
  const artifacts = new Map<string, JsonValue>(), captured: { purpose: string; payload: string }[] = [], reservations: PhysicalRequest[] = []; let providerCalls = 0, toolCalls = 0, id = 0;
  const bridge: ShellBridge = { async execute() { toolCalls++; throw Error('Settled tool must not replay'); }, async readCheckpoint(checkpoint) { return structuredClone(artifacts.get(checkpoint.artifact.sha256)!); },
    async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); artifacts.set(sha256, structuredClone(content)); return { runId, revision, shell, artifact: { uri: `aeon:artifact:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds }; },
    async capturePrompt(manifest, payload) { validateCapturedPrompt(manifest, payload); captured.push({ purpose: manifest.fragments.some(fragment => fragment.id === 'summary') ? 'compaction' : 'reasoning', payload }); },
    async reserve(request) { reservations.push(structuredClone(request)); ledger.reserve(request); }, async dispatched(request) { ledger.dispatched(request); }, async settle(request) { ledger.settle(request); },
  };
  const shell = createTestShell({ model: 'fixture', modelProfile: { contextWindow: 1000000, reasoning: true }, reasoningEffort: 'high', apiKey: () => 'fixture', maxRequests: 4, maxRetries: 0, maxOutputTokens: 8192, timeoutMs: 180000,
    environment: { newId: () => `fixture-${++id}`, wallNow: () => 0, monotonicNow: () => 0, scheduleTimeout: () => () => {} },
    tools: ['source_checkout', 'workspace_discover', 'command_run'].map((name, index) => ({ name, description: index === 0 ? 'Fixture tool declaration. '.repeat(1100) : 'Fixture tool', parameters: { type: 'object', properties: {}, additionalProperties: false } })),
    resolveFragment: async () => summaryText, projectToolResult: projectSourceObservation,
    compaction: { thresholdMessages: 60, retainMessages: 7, instruction, ...(thresholdBytes !== undefined ? { thresholdBytes } : {}) },
    reservationEstimate(attempt) { const inputTokens = Buffer.byteLength(attempt.payload) + 1024, outputTokens = 8192; return { requests: 1, inputTokens, outputTokens, costUsd: (inputTokens * 2 + outputTokens * 6) / 1000000, elapsedMs: 180000 }; },
    async fetch(_url, init) { providerCalls++; const summary = JSON.parse(String(init!.body)).messages[0].content.includes(summaryText); return Response.json({ model: 'fixture', choices: [{ finish_reason: summary && failedSummary ? 'length' : 'stop', message: { role: 'assistant', content: summary ? 's'.repeat(1000) : 'The recorded work can continue.' } }], usage: { prompt_tokens: summary ? 30000 : 1000, completion_tokens: summary ? 500 : 10 } }); },
  });
  const input: ShellInput = { run: { id: 'run', revision: 1, status: 'running', authority: { generation: 'fixture', epoch: 1, controlRevision: 'c1' }, scope: { kind: 'public' } }, messages: [], prompt: { id: 'owned', requestDigest: '0'.repeat(64), fragments: [] } };
  const initial = JSON.parse(JSON.stringify({ schema: SHELL_REVISION, provider: 'mistral', messages: history, observationIds: ['source-observation', ...(!onlySource ? ['discovery-observation', 'denied-command-observation'] : [])], status: 'blocked', compactions: [] })) as JsonValue;
  return { store, ledger, shell, bridge, input, artifacts, captured, reservations, initial, priorRows, prefix, tail, get providerCalls() { return providerCalls; }, get toolCalls() { return toolCalls; },
    async run() { const checkpoint = await bridge.persistCheckpoint('run', 1, SHELL_REVISION, initial); return { checkpoint, outcome: await shell.run({ ...input, checkpoint }, bridge) }; } };
}

test('byte-triggered accounted compaction fits the same spent conversation/root grants and keeps a complete tool boundary', async () => {
  const old = fixture(); assert.equal(chargedToRun(old.store), 101497); assert.equal(old.ledger.snapshot('operating').tokens, 784213);
  const refused = await old.run(); assert.equal(refused.outcome.status, 'blocked'); assert.equal(old.providerCalls, 0); assert.equal(old.toolCalls, 0);
  assert.ok(old.reservations[0]!.usage.inputTokens! + old.reservations[0]!.usage.outputTokens! + 101497 > 250000);
  const f = fixture(60000), initial = structuredClone(f.initial), { checkpoint, outcome } = await f.run();
  assert.equal(outcome.status, 'completed'); assert.deepEqual(f.captured.map(item => item.purpose), ['compaction', 'reasoning']); assert.equal(f.providerCalls, 2); assert.equal(f.toolCalls, 0);
  assert.ok(f.reservations[0]!.usage.inputTokens! + f.reservations[0]!.usage.outputTokens! <= 148503);
  assert.ok(Buffer.byteLength(f.captured[1]!.payload) < Buffer.byteLength(old.captured[0]!.payload));
  assert.equal(chargedToRun(f.store), 133007); assert.equal(f.ledger.snapshot('operating').tokens, 815723);
  assert.deepEqual(f.store.get('requests', 'other-history')!.value, f.priorRows[0]); assert.deepEqual(f.store.get('requests', 'conversation-history')!.value, f.priorRows[1]);
  assert.deepEqual(f.store.get<{ envelope: unknown }>('allocations', 'run')!.value.envelope, conversation); assert.deepEqual(f.store.get<{ envelope: unknown }>('allocations', 'operating')!.value.envelope, envelope);
  assert.deepEqual(f.artifacts.get(checkpoint.artifact.sha256), initial);
  const snapshot = f.artifacts.get(outcome.checkpoint!.artifact.sha256) as unknown as { messages: JsonValue[]; compactions: { sourceDigest: string }[] };
  assert.equal(snapshot.compactions[0]!.sourceDigest, identity(f.prefix));
  assert.deepEqual(snapshot.messages.slice(1, 1 + f.tail.length), f.tail, 'retain7 keeps complete assistant/tool pairs and the bounded fresh host frame');
});

test('failed byte compaction retains all original context and charged work, and performs no automatic reasoning retry', async () => {
  const f = fixture(60000, true), { checkpoint, outcome } = await f.run();
  assert.equal(outcome.status, 'blocked'); assert.equal(f.providerCalls, 1); assert.equal(f.toolCalls, 0); assert.deepEqual(f.captured.map(item => item.purpose), ['compaction']);
  const saved = f.artifacts.get(outcome.checkpoint!.artifact.sha256) as unknown as { messages: JsonValue[]; compactions: unknown[]; rejectedCompactions: { sourceDigest: string; summary: { stopReason: string } }[]; failure: { reason: string } };
  assert.deepEqual(saved.messages, (f.initial as { messages: JsonValue[] }).messages); assert.deepEqual(saved.compactions, []); assert.match(saved.failure.reason, /Compaction failed/);
  assert.deepEqual(f.artifacts.get(checkpoint.artifact.sha256), f.initial); assert.equal(chargedToRun(f.store), 131997);
  assert.equal(saved.rejectedCompactions[0]!.sourceDigest, identity(f.prefix)); assert.equal(saved.rejectedCompactions[0]!.summary.stopReason, 'length');
});

test('byte trigger measures the projected model context, not the retained full source inventory', async () => {
  const f = fixture(60000, false, true), { outcome } = await f.run();
  assert.ok(Buffer.byteLength(canonicalJson(f.initial)) > 80000);
  assert.equal(outcome.status, 'completed'); assert.equal(f.providerCalls, 1); assert.equal(f.toolCalls, 0); assert.deepEqual(f.captured.map(item => item.purpose), ['reasoning']);
  assert.ok(Buffer.byteLength(f.captured[0]!.payload) < 40000); assert.ok(f.captured[0]!.payload.includes('source_checkout_inventory'));
});

test('non-finite or non-positive byte thresholds are rejected before any physical request', () => {
  for (const threshold of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => fixture(threshold), /context byte budget/);
});
