import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { DurableRuntime } from '../packages/runtime/execution/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import type { JsonValue, PromptManifest } from '../packages/contracts/index.ts';
import { createBrokerShell, type TransportReceipt } from './broker-shell.ts';
import { environmentSecrets, selectedProviderKey, type ApplicationConfig } from './config.ts';
import { providerGateway } from './provider-gateway.ts';

for (const provider of ['mistral', 'openai'] as const) test(`${provider}: isolated worker reasoning, repair, uncertain effect reconciliation, disk restart, compaction and audited usage`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-portability-')); const state = join(root, 'state'); const workspace = join(root, 'work'); mkdirSync(state); mkdirSync(workspace);
  let store = new OperationalStore({ filename: join(state, 'state.sqlite') });
  const authorityStore = new AuthorityStore(join(state, 'authority.sqlite')); const authority = authorityStore.bootstrap('fixture', 'controls', 'fixture');
  const instructions = 'Choose and verify actions from observations.'; const summary = 'Summarize task facts and uncertainty.';
  const prompt: PromptManifest = { id: 'owned', requestDigest: '0'.repeat(64), fragments: [{ id: 'base', owner: 'self', role: 'system', order: 0, artifact: store.putArtifact(instructions), scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
  const summaryFragment = { ...prompt.fragments[0], id: 'summary', artifact: store.putArtifact(summary) };
  const native = (turn: number, tool: boolean) => [
    { type: 'reasoning', id: `rs_${turn}`, summary: [], encrypted_content: `opaque_cipher_${turn}`, opaque: { preserve: true } },
    { type: 'message', id: `msg_${turn}`, role: 'assistant', status: 'completed', phase: tool ? 'commentary' : 'final_answer', content: [{ type: 'output_text', text: tool ? 'Inspect and repair.' : 'Verified.', annotations: [] }] },
    ...(tool ? [{ type: 'function_call', id: `fc_${turn}`, call_id: `call_${turn}`, name: 'inspect', arguments: '{}', status: 'completed' }] : []),
  ];
  const mistralNative = { type: 'thinking', thinking: [{ type: 'text', text: 'Inspect then revise.' }], opaque: 'preserved' };
  const body = (turn: number, tool: boolean, known = true) => provider === 'openai' ? { id: `resp_${turn}`, model: 'fixture-v1', status: 'completed', output: native(turn, tool), ...(known ? { usage: { input_tokens: 10, output_tokens: 5 } } : {}) } : { id: `resp_${turn}`, model: 'fixture-v1', choices: [{ finish_reason: tool ? 'tool_calls' : 'stop', message: { content: [mistralNative, { type: 'text', text: tool ? 'Inspect and repair.' : 'Verified.' }], ...(tool ? { tool_calls: [{ id: `call_${turn}`, type: 'function', function: { name: 'inspect', arguments: '{}' } }] } : {}) } }], ...(known ? { usage: { prompt_tokens: 10, completion_tokens: 5 } } : {}) };
  let requests = 0; let effectsCount = 0; let compactions = 0; const receipts: TransportReceipt[] = []; const payloads: string[] = [];
  function shell() { return createBrokerShell({ applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), entrypoint: 'deployment/shell-worker.ts', workspace: () => workspace, protectedPaths: [state], nodeBinary: process.execPath, timeoutMs: 10000, maxPayloadBytes: 1_000_000, pricesPerMillion: { input: 1, output: 2 },
    worker: { provider, model: 'fixture-v1', modelProfile: { contextWindow: 128000, reasoning: true }, reasoningEffort: 'high', maxRequests: 5, maxOutputTokens: 512, timeoutMs: 5000, tools: [{ name: 'inspect', description: 'Inspect fixture state', parameters: { type: 'object', properties: {} } }], compaction: { thresholdMessages: 7, retainMessages: 1, instruction: summaryFragment } },
    retainToolInstructions: source => store.putArtifact(source),
    async resolveFragment(fragment) { return Buffer.from(store.readArtifact(fragment.artifact)).toString(); }, assertAuthority(input) { authorityStore.assert(input.run.authority); }, recordTransport(receipt) { receipts.push(structuredClone(receipt)); },
    async performRequest(payload) {
      payloads.push(payload); const decoded = JSON.parse(payload); const system = provider === 'openai' ? decoded.instructions : decoded.messages[0].content;
      assert.ok(!payload.includes('host-transport-owned')); assert.equal(provider === 'openai' ? decoded.reasoning.effort : decoded.reasoning_effort, 'high');
      if (system.endsWith(summary)) { compactions++; return { status: 200, body: JSON.stringify(body(90 + compactions, false)) }; }
      assert.equal(system, instructions); requests++;
      const history = provider === 'openai' ? decoded.input : decoded.messages;
      if (requests === 2) assert.match(JSON.stringify(history), /test failed/);
      if (requests === 3) {
        assert.match(JSON.stringify(history), /reconciled verification/);
        if (provider === 'openai') {
          for (const turn of [1, 2]) for (const item of native(turn, true)) assert.deepEqual(history.find((candidate: { id?: string }) => candidate.id === item.id), item);
          assert.deepEqual(history.filter((item: { type?: string }) => item.type === 'function_call_output').map((item: { call_id: string }) => item.call_id), ['call_1', 'call_2']);
        }
      }
      return { status: 200, body: JSON.stringify(body(requests, requests < 3, requests !== 2)) };
    } }); }
  function runtime() {
    const effects = new EffectJournal(store, authorityStore, { async dispatch() { effectsCount++; return effectsCount === 1 ? { outcome: 'failed', receipt: store.putJsonArtifact({ detail: 'test failed: revise repair' }) } : { outcome: 'uncertain' }; }, async reconcile() { return { outcome: 'succeeded', receipt: store.putJsonArtifact({ detail: 'reconciled verification' }) }; } });
    return { effects, runtime: new DurableRuntime({ store, shell: shell(), effects, resources: new ResourceLedger(store, { tokens: 100000, costUsd: 1, elapsedMs: 10000 }) }) };
  }
  try {
    let instance = runtime(); const run = instance.runtime.admit({ id: 'input', source: 'direct', externalId: 'fixture', externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: 'Inspect, repair and verify.' }, authority, { maxRequests: 8, maxTokens: 200000, maxCostUsd: 2, maxElapsedMs: 60000, maxConcurrency: 2 });
    assert.equal((await instance.runtime.resume(run.id, prompt)).status, 'blocked'); assert.equal(requests, 2); assert.equal(effectsCount, 2);
    store.close(); store = new OperationalStore({ filename: join(state, 'state.sqlite') }); instance = runtime(); instance.runtime.recover();
    await instance.effects.reconcile(instance.effects.unresolved(run.id)[0].id, authority);
    for (let index = 0; index < 7; index++) instance.runtime.steer(run.id, { id: `steer${index}`, source: 'direct', externalId: `steer${index}`, externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: `Retained fact ${index}` });
    assert.equal((await instance.runtime.resume(run.id, prompt)).status, 'completed', JSON.stringify(store.get('execution', run.id))); assert.equal(requests, 3); assert.equal(effectsCount, 2); assert.equal(compactions, 1);
    const settled = receipts.filter(receipt => receipt.status === 'succeeded'); assert.equal(settled.length, 4); assert.equal(settled[1].usage.inputTokens, null); assert.equal(settled[1].usage.outputTokens, null); assert.equal(settled[0].usage.costUsd, 0.00002);
    const physical = store.list<{ request: { provider: string; purpose: string; status: string } }>('requests').filter(row => row.value.request.provider !== 'effect-receiver'); assert.equal(physical.length, 4); assert.ok(physical.every(row => row.value.request.provider === provider)); assert.equal(store.list('prompts').length, payloads.length);
  } finally { store.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});

test('host secrets select only the explicit provider and never require an unused provider key', async () => {
  const secrets = environmentSecrets({ AUTARK_DIRECT_TOKEN: 'direct', OPENAI_API_KEY: 'openai-fixture' });
  const model = { provider: 'openai' } as ApplicationConfig['model']; assert.equal(selectedProviderKey(model, secrets), 'openai-fixture');
  assert.throws(() => selectedProviderKey({ ...model, provider: 'mistral' }, secrets), /Selected provider credential/);
  for (const provider of ['mistral', 'openai'] as const) {
    const gateway = providerGateway({ provider, apiKey: () => 'fixture-key', maxResponseBytes: 16, async fetch(url, options) { assert.equal(url, provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.mistral.ai/v1/chat/completions'); assert.equal(options?.redirect, 'error'); return new Response('{}'); } });
    await gateway('{}', new AbortController().signal);
  }
});
