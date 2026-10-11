import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OperationalStore } from '../../storage/index.ts';
import { AuthorityStore } from '../../supervisor/authority.ts';
import { ToolEffectReceiver, toolDefinitions } from '../../tools/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../index.ts';
import { createBrokerShell } from '../../../deployment/broker-shell.ts';
import type { Authority, JsonValue } from '../../contracts/common.ts';

export const original = 'export const sum = (a, b) => a + b;\n';
export const broken = 'export const sum = (a, b) => a - b;\n';
export const input = { id: 'coding', source: 'direct' as const, externalId: 'coding', externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' as const }, value: 'Inspect, edit, test, repair and verify sum.mjs.' };
export const envelope = { maxRequests: 20, maxTokens: 1_000_000, maxCostUsd: 5, maxElapsedMs: 300000, maxConcurrency: 3 };
export function composition(root: string, phase: 'repair' | 'provider' | 'finish') {
  const state = join(root, 'state'), workspace = join(root, 'work');
  const store = new OperationalStore({ filename: join(state, 'state.sqlite') });
  const authorities = new AuthorityStore(join(state, 'authority.sqlite'));
  const current = authorities.current();
  const authority: Authority = current ? { generation: current.generation!, epoch: current.epoch, controlRevision: current.controlRevision } : authorities.bootstrap('first', 'fixture-controls', 'fixture-source');
  const policy = { workspace, protectedPaths: [state], nodeBinary: process.execPath, timeoutMs: 10000, maxBytes: 65536, maxFiles: 20, executables: ['/runtime/node'], maxArgs: 20 };
  const receiver = new ToolEffectReceiver({ store, fence: authorities, grantForRun: () => ({ scope: input.scope, workspace: policy, actions: ['workspace_read', 'workspace_write', 'workspace_patch', 'command_run'] }) });
  const audit = (kind: string, value: unknown) => appendFileSync(join(root, 'audit.jsonl'), JSON.stringify({ phase, kind, value }) + '\n');
  const pause = async (boundary: string): Promise<never> => { writeFileSync(join(root, 'marker'), boundary); await new Promise(() => {}); throw Error('unreachable'); };
  const effects = new EffectJournal(store, authorities, { async dispatch(effect, signal) {
    audit('effect', { id: effect.id, kind: effect.kind, authority: effect.authority });
    const result = await receiver.dispatch(effect, signal);
    if (phase === 'repair' && effect.kind === 'workspace_patch') {
      assert.equal(result.outcome, 'succeeded'); assert.equal(readFileSync(join(workspace, 'sum.mjs'), 'utf8'), original);
      // The real mutation completed; its receipt has not returned to the effect journal.
      return pause('repair-applied-before-receipt');
    }
    return result;
  }, reconcile: effect => receiver.reconcile(effect) });
  let calls = 0, inspectedDigest = '';
  const response = (name?: string, args?: unknown) => ({ status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: { role: 'assistant', content: name ? null : 'Actual repaired test passed.', ...(name ? { tool_calls: [{ id: `call${phase}${calls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) });
  const shell = createBrokerShell({ applicationRoot: dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), entrypoint: 'deployment/shell-worker.ts', workspace: () => workspace, protectedPaths: [state], nodeBinary: process.execPath, timeoutMs: 45000, maxPayloadBytes: 1_000_000, pricesPerMillion: { input: 1, output: 2 },
    worker: { model: 'mistral-fixture-v1', maxRequests: 8, maxOutputTokens: 512, timeoutMs: 30000, tools: toolDefinitions.filter(tool => ['workspace_read', 'workspace_write', 'workspace_patch', 'command_run'].includes(tool.name)) },
    retainToolInstructions: source => store.putArtifact(source),
    async resolveFragment(fragment) { return Buffer.from(store.readArtifact(fragment.artifact)).toString(); }, assertAuthority({ run }) { authorities.assert(run.authority); }, recordTransport(receipt) { audit('transport', receipt); },
    async performRequest(payload) {
      calls++; const request = JSON.parse(payload); audit('model', { payload, calls });
      const last = request.messages.findLast((message: { role: string }) => message.role === 'tool');
      const receipt = last ? JSON.parse(last.content) : undefined;
      if (phase === 'provider') { assert.match(payload, /reconciled actual repaired file/); return pause('provider-dispatched-before-response'); }
      if (phase === 'finish') {
        assert.match(payload, /reconciled actual repaired file/);
        if (calls === 1) return response('command_run', { executable: '/runtime/node', args: ['verify.mjs'] });
        assert.equal(calls, 2); assert.equal(receipt.exitCode, 0); assert.match(receipt.stdout, /verified 5/); return response();
      }
      if (calls === 1) return response('workspace_read', { path: 'sum.mjs' });
      if (calls === 2) { assert.equal(receipt.content, original); inspectedDigest = receipt.sha256; return response('workspace_write', { path: 'sum.mjs', content: broken, expectedSha256: inspectedDigest }); }
      if (calls === 3) { inspectedDigest = receipt.sha256; return response('command_run', { executable: '/runtime/node', args: ['verify.mjs'] }); }
      assert.equal(calls, 4); assert.notEqual(receipt.exitCode, 0); assert.match(receipt.stderr, /Observed seeded defect/);
      return response('workspace_patch', { path: 'sum.mjs', oldText: 'a - b', newText: 'a + b', expectedSha256: inspectedDigest });
    } });
  const resources = new ResourceLedger(store, { tokens: 100000, costUsd: 1, elapsedMs: 30000 });
  const runtime = new DurableRuntime({ store, resources, effects, shell });
  const prompt = { id: 'owned-recovery', requestDigest: '0'.repeat(64), fragments: [{ id: 'base', owner: 'self' as const, role: 'system' as const, order: 0, artifact: store.putArtifact('Inspect actual results, repair the project, and verify it.'), scope: input.scope, replaceable: true, derivedFrom: [] }] };
  const close = () => { store.close(); authorities.close(); };
  return { store, authorities, authority, policy, receiver, effects, resources, runtime, prompt, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, phase] = process.argv.slice(2);
  assert.ok(root && (phase === 'repair' || phase === 'provider'));
  const f = composition(root, phase);
  const run = f.runtime.admit(input, f.authority, envelope);
  const result = await f.runtime.resume(run.id, f.prompt);
  throw Error(`Expected interruption boundary; got ${JSON.stringify(result)} ${JSON.stringify(f.store.get('execution', run.id)?.value as JsonValue)}`);
}
