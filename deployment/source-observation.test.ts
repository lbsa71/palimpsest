import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, identity, validateCapturedPrompt, type ArtifactRef, type JsonValue, type Observation, type PromptFragment, type ShellBridge, type ShellCheckpoint, type ShellInput } from '../packages/contracts/index.ts';
import { createAgentShell, SHELL_REVISION, type ShellOptions } from '../packages/agent-shell/index.ts';
import { digest, emptyUsage } from '../packages/agent-shell/mistral.ts';
import type { ToolResultMessage } from '../packages/agent-shell/vendor/pi/ai/types.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { createBrokerShell } from './broker-shell.ts';
import { projectSourceObservation } from './source-observation.ts';

const files = Array.from({ length: 826 }, (_, index) => ({ path: `packages/agent-shell/vendor/pi/fixture/source-inventory-entry-with-realistic-path-length-${index}.ts`, sha256: digest(`file-${index}`), bytes: 1024 + index }));
const inventory = { files, bytes: files.reduce((sum, file) => sum + file.bytes, 0), source: 'accepted application snapshot', copiedAt: '2026-10-12T12:00:00.000Z' };
const receipt = { exitCode: 0, signal: null, stdout: JSON.stringify(inventory), stderr: '', elapsedMs: 12 };
const toolMessage: ToolResultMessage & { aeonStepId: string } = { role: 'toolResult', toolCallId: 'checkout1', toolName: 'source_checkout', content: [{ type: 'text', text: canonicalJson(receipt) }], isError: false, timestamp: 0, aeonStepId: 'old-step' };
const tools = [{ name: 'source_checkout', description: 'Snapshot the accepted source', parameters: { type: 'object', properties: {}, additionalProperties: false } }];

/** In-memory Store port: exercise the real ledger without operational DB or filesystem IO. */
function memoryStore(): OperationalStore {
  const rows = new Map<string, Map<string, { revision: number; value: unknown }>>();
  return {
    transaction<T>(operation: () => T) { return operation(); },
    get(namespace: string, key: string) { const row = rows.get(namespace)?.get(key); return row && structuredClone(row); },
    put(namespace: string, key: string, value: unknown, expected: number | null) {
      const group = rows.get(namespace) ?? new Map(); rows.set(namespace, group);
      const old = group.get(key); assert.equal(old?.revision ?? null, expected);
      group.set(key, { revision: (old?.revision ?? -1) + 1, value: structuredClone(value) });
    },
    list(namespace: string) { return [...(rows.get(namespace)?.entries() ?? [])].map(([key, row]) => ({ key, ...structuredClone(row) })); },
  } as unknown as OperationalStore;
}

function fixture(projection = true, compact = false) {
  const store = memoryStore(), ledger = new ResourceLedger(store, { tokens: 100000, costUsd: 1, elapsedMs: 180000 }, () => 0);
  const envelope = { maxRequests: 64, maxTokens: 250000, maxCostUsd: 1.25, maxElapsedMs: 604800000, maxConcurrency: 4 };
  ledger.allocate('run', envelope);
  const artifacts = new Map<string, JsonValue>(), sourceArtifacts = new Map<string, string>();
  const captured: string[] = [], observed: Observation[] = []; let toolCalls = 0, providerCalls = 0, sequence = 0;
  const reference = (content: string): ArtifactRef => { const sha256 = digest(content); sourceArtifacts.set(sha256, content); return { uri: `aeon:artifact:${sha256}`, sha256 }; };
  const summaryFragment: PromptFragment = { id: 'summary', owner: 'application', role: 'system', order: 0, artifact: reference('Summarize recorded inventory.'), scope: { kind: 'public' }, replaceable: true, derivedFrom: [] };
  const bridge: ShellBridge = {
    async execute(call) {
      toolCalls++;
      const observation: Observation = { id: `observed:${call.id}`, runId: call.runId, stepId: call.stepId, sourceId: call.id, kind: 'result', value: structuredClone(receipt), provenance: { sourceIds: [call.id], actorId: 'fixture', recordedAt: inventory.copiedAt, derivation: 'observed' } };
      observed.push(structuredClone(observation)); return observation;
    },
    async persistCheckpoint(runId, revision, shell, content) {
      const sha256 = identity(content); artifacts.set(sha256, structuredClone(content));
      return { runId, revision, shell, artifact: { uri: `aeon:artifact:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds };
    },
    async readCheckpoint(checkpoint) { return structuredClone(artifacts.get(checkpoint.artifact.sha256)!); },
    async capturePrompt(manifest, payload) { validateCapturedPrompt(manifest, payload); captured.push(payload); },
    async reserve(request) { ledger.reserve(request); }, async dispatched(request) { ledger.dispatched(request); }, async settle(request) { ledger.settle(request); },
  };
  const model = 'source-projection-fixture-v1';
  const shell = createBrokerShell({ applicationRoot: '/fixture/source', entrypoint: 'deployment/shell-worker.ts', workspace: () => '/fixture/work', protectedPaths: [], nodeBinary: '/fixture/node', timeoutMs: 180000, maxPayloadBytes: 2000000,
    pricesPerMillion: { input: 2, output: 6 }, brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal },
    worker: { model, tools, maxRequests: 4, maxRetries: 0, maxOutputTokens: 8192, timeoutMs: 180000, ...(compact ? { compaction: { thresholdMessages: 5, retainMessages: 1, instruction: summaryFragment } } : {}) },
    retainToolInstructions: reference, async resolveFragment(fragment) { const source = sourceArtifacts.get(fragment.artifact.sha256); assert.notEqual(source, undefined); return source!; }, assertAuthority() {}, recordTransport() {},
    async performRequest(payload) {
      providerCalls++;
      const request = JSON.parse(payload);
      const summary = String(request.messages[0].content).includes('Summarize recorded inventory.');
      const call = !summary && !request.messages.some((message: { role: string }) => message.role === 'tool') && !compact;
      return { status: 200, body: JSON.stringify({ model, choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: { role: 'assistant', content: call ? null : summary ? 'Retained source inventory summary.' : 'I can continue from the recorded checkout.', ...(call ? { tool_calls: [{ id: 'checkout1', type: 'function', function: { name: 'source_checkout', arguments: '{}' } }] } : {}) } }], usage: { prompt_tokens: 64, completion_tokens: 4 } }) };
    },
    // The actual Pi shell and host broker run through their ordinary RPC boundary,
    // with only worker/process/network/clock ports replaced by in-process fixtures.
    async runWorker({ initial, handle }) {
      const start = initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
      const signal = new AbortController().signal;
      const rpc = async <T>(method: string, ...args: unknown[]) => await handle(method, JSON.parse(JSON.stringify(args)) as JsonValue[], signal) as T;
      const workerBridge: ShellBridge = { execute: call => rpc('execute', call), persistCheckpoint: (...args) => rpc('persistCheckpoint', ...args), readCheckpoint: checkpoint => rpc('readCheckpoint', checkpoint), capturePrompt: (...args) => rpc('capturePrompt', ...args), reserve: request => rpc('reserve', request), dispatched: request => rpc('dispatched', request), settle: request => rpc('settle', request) };
      return JSON.parse(JSON.stringify(await createAgentShell({ ...start.options, ...(projection ? { projectToolResult: projectSourceObservation } : {}), apiKey: () => 'fixture',
        environment: { newId: () => `fixture-id-${++sequence}`, wallNow: () => 0, monotonicNow: () => 0, scheduleTimeout: () => () => {} },
        async resolveFragment(fragment) { return start.fragments[fragment.artifact.sha256]!; },
        async fetch(_url, init) { const result = await rpc<{ status: number; body: string }>('provider.fetch', init!.body); return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } }); },
      }).run(start.input, workerBridge)));
    },
  });
  const input: ShellInput = { run: { id: 'run', revision: 1, status: 'running', authority: { generation: 'fixture', epoch: 1, controlRevision: 'c1' }, scope: { kind: 'public' } }, messages: [{ role: 'user', content: 'Continue the recorded work.', timestamp: 0 }], prompt: { id: 'owned', requestDigest: '0'.repeat(64), fragments: [] } };
  async function restored(): Promise<ShellCheckpoint> {
    const assistant = { role: 'assistant', content: [{ type: 'toolCall', id: 'checkout1', name: 'source_checkout', arguments: {} }], api: 'mistral-chat-completions', provider: 'mistral', model, usage: emptyUsage(), stopReason: 'toolUse', timestamp: 0, aeonStepId: 'old-step' };
    const messages = [{ role: 'user', content: compact ? 'Initial source request.' : 'Retained context. '.repeat(6000), timestamp: 0 }, assistant, toolMessage,
      ...(compact ? Array.from({ length: 6 }, (_, index) => ({ role: 'user', content: `Follow-up ${index}`, timestamp: index })) : [])];
    return bridge.persistCheckpoint('run', 1, SHELL_REVISION, JSON.parse(JSON.stringify({ schema: SHELL_REVISION, provider: 'mistral', messages, observationIds: ['prior-checkout'], status: 'blocked', compactions: [] })));
  }
  return { shell, bridge, input, restored, artifacts, captured, observed, ledger, envelope, store, get toolCalls() { return toolCalls; }, get providerCalls() { return providerCalls; } };
}

test('recognized successful source inventory projects bounded counts and digest while leaving original data untouched', () => {
  assert.ok(receipt.stdout.length > 147000);
  const original = structuredClone(toolMessage), projected = projectSourceObservation(toolMessage);
  assert.deepEqual(toolMessage, original); assert.equal(projected.toolCallId, toolMessage.toolCallId);
  const text = projected.content[0]; assert.equal(text.type, 'text'); if (text.type !== 'text') return;
  assert.ok(text.text.length < 1024); const summary = JSON.parse(JSON.parse(text.text).stdout);
  assert.equal(summary.fileCount, 826); assert.equal(summary.bytes, inventory.bytes); assert.equal(summary.source, inventory.source); assert.equal(summary.copiedAt, inventory.copiedAt);
  assert.equal(summary.originalStdoutSha256, digest(receipt.stdout)); assert.equal(summary.toolCallId, 'checkout1'); assert.equal(JSON.stringify(summary).includes('aeon:artifact:'), false);
});

test('other tools, errors and malformed or unsuccessful inventories retain their complete model result', () => {
  for (const message of [{ ...toolMessage, toolName: 'source_check' }, { ...toolMessage, isError: true }, { ...toolMessage, content: [{ type: 'text' as const, text: canonicalJson({ ...receipt, exitCode: 1 }) }] }, { ...toolMessage, content: [{ type: 'text' as const, text: 'ordinary observation' }] }]) assert.deepEqual(projectSourceObservation(message), message);
});

test('restored oversized source result fits the original grant and preserves full checkpoint with zero settled tool replay', async () => {
  const before = fixture(false), oldCheckpoint = await before.restored();
  assert.equal((await before.shell.run({ ...before.input, messages: [], checkpoint: oldCheckpoint }, before.bridge)).status, 'blocked');
  assert.ok(Buffer.byteLength(before.captured[0]!) + 1024 + 8192 > 250000); assert.equal(before.providerCalls, 0); assert.equal(before.toolCalls, 0);
  const f = fixture(), checkpoint = await f.restored(), original = structuredClone(f.artifacts.get(checkpoint.artifact.sha256));
  const result = await f.shell.run({ ...f.input, messages: [], checkpoint }, f.bridge);
  assert.equal(result.status, 'completed'); assert.equal(f.providerCalls, 1); assert.equal(f.toolCalls, 0);
  assert.ok(Buffer.byteLength(f.captured[0]!) < 120000); assert.ok(f.captured[0]!.includes('source_checkout_inventory')); assert.ok(!f.captured[0]!.includes(files[0]!.path));
  assert.deepEqual(f.artifacts.get(checkpoint.artifact.sha256), original);
  const latest = f.artifacts.get(result.checkpoint!.artifact.sha256) as unknown as { messages: ToolResultMessage[] };
  assert.deepEqual(latest.messages.find(message => message.role === 'toolResult')!.content, toolMessage.content);
  assert.deepEqual(f.store.get<{ envelope: unknown; startedAt: number }>('allocations', 'run')!.value.envelope, f.envelope); assert.equal(f.store.get<{ startedAt: number }>('allocations', 'run')!.value.startedAt, 0);
});

test('fresh Pi tool output is projected for the next model request and retained in full observations and checkpoint', async () => {
  const f = fixture(), result = await f.shell.run(f.input, f.bridge);
  assert.equal(result.status, 'completed'); assert.equal(f.toolCalls, 1); assert.equal(f.providerCalls, 2);
  assert.ok(f.captured[1]!.includes('source_checkout_inventory')); assert.ok(Buffer.byteLength(f.captured[1]!) < 5000);
  assert.deepEqual(f.observed[0]!.value, receipt); assert.deepEqual(result.observations[0]!.value, receipt);
  const snapshot = f.artifacts.get(result.checkpoint!.artifact.sha256) as unknown as { messages: ToolResultMessage[] };
  assert.deepEqual(snapshot.messages.find(message => message.role === 'toolResult')!.content, toolMessage.content);
});

test('compaction renders the bounded inventory while retaining its complete original checkpoint artifact', async () => {
  const f = fixture(true, true), checkpoint = await f.restored(), original = structuredClone(f.artifacts.get(checkpoint.artifact.sha256));
  const result = await f.shell.run({ ...f.input, messages: [], checkpoint }, f.bridge);
  assert.equal(result.status, 'completed'); assert.equal(f.providerCalls, 2); assert.equal(f.toolCalls, 0);
  assert.ok(f.captured[0]!.includes('source_checkout_inventory')); assert.ok(!f.captured[0]!.includes(files[0]!.path)); assert.ok(Buffer.byteLength(f.captured[0]!) < 6000);
  assert.deepEqual(f.artifacts.get(checkpoint.artifact.sha256), original);
});
