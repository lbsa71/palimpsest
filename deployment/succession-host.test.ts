import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAgentShell, SHELL_REVISION, type ShellOptions } from '../packages/agent-shell/index.ts';
import { emptyUsage } from '../packages/agent-shell/mistral.ts';
import { identity, type Authority, type JsonValue, type PhysicalRequest, type Run, type ShellBridge, type ShellCheckpoint, type ShellInput, type ToolCall } from '../packages/contracts/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import type { CandidateInputs, FrozenCandidate } from '../packages/release/artifacts.ts';
import { ResourceLedger, type AllowanceAmendment } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { nodeAuthorityEnvironment } from '../packages/supervisor/environment.ts';
import type { LoadedGeneration } from './generation-mind.ts';
import { SuccessionHost, nodeSuccessionHostEnvironment, type SuccessionHostEnvironment, type SuccessionHostOptions } from './succession-host.ts';
import type { SuccessionBinding } from './succession-dialogue.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const model = { id: 'succession-host-fixture-v1', contextWindow: 32000, reasoning: false, effort: 'none', maxOutputTokens: 512, maxRequestsPerSlice: 2, timeoutMs: 5000, pricesPerMillion: { input: 1, output: 2 } };
const envelope = { maxRequests: 100, maxTokens: 2000000, maxCostUsd: 20, maxElapsedMs: 1000000, maxConcurrency: 4 };
const scope = { kind: 'restricted' as const, principals: ['owner'] };
function image(label: string): LoadedGeneration {
  const inputs: CandidateInputs = { prompts: { mind: `OWN FROZEN MIND ${label}`, compaction: `OWN COMPACTION ${label}` }, model,
    configuration: { model }, controls: { runtime: {} }, dependencies: {}, createdBy: 'host-fixture' };
  const files: FrozenCandidate['files'] = [], fields = { source: identity(files), dependencies: identity(inputs.dependencies), prompts: identity(inputs.prompts), model: identity(inputs.model), configuration: identity(inputs.configuration), controls: identity(inputs.controls), createdBy: inputs.createdBy };
  return { candidate: { manifest: { id: identity(fields), ...fields }, inputs, files }, applicationRoot: `/frozen/${label}`, nodeBinary: '/pinned/node' };
}
function fixture(t: TestContext, unlimited = false) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-succession-host-')), state = join(directory, 'state'), work = join(directory, 'work'); mkdirSync(state); mkdirSync(work);
  let now = 1000, sequence = 0;
  const store = new OperationalStore({ filename: join(state, 'operational.sqlite') });
  const authority = new AuthorityStore(join(state, 'authority.sqlite'), { ...nodeAuthorityEnvironment(), wallNow: () => now });
  t.after(() => { authority.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const old = image('incumbent'), next = image('successor'), images = new Map([old, next].map(value => [value.candidate.manifest.id, value]));
  const prior = authority.bootstrap('incumbent', 'controls', old.candidate.manifest.id);
  let current = { candidateId: old.candidate.manifest.id, authority: prior, phase: 'accepted' };
  const parent: Run = { id: 'author', status: 'waiting', revision: 2, authority: prior, scope };
  store.put('runs', parent.id, parent, null);
  const ledger = new ResourceLedger(store, { tokens: 20000, costUsd: 1, elapsedMs: 5000 }, () => now); ledger.allocate('root', envelope); ledger.allocate(parent.id, envelope, 'root');
  const amendment: AllowanceAmendment = { id: 'accepted-unlimited', authorizationRef: 'fixture-authority', rootId: 'root', expectedEnvelopeDigest: identity(envelope), scope: 'root-and-descendants', descendantCostLimit: 'root', descendantRequestLimit: 'root', cumulativeTokenLimit: null, cumulativeCostLimit: null, cumulativeRequestLimit: null, cumulativeElapsedLimit: null };
  const seed = json({ schema: SHELL_REVISION, provider: 'mistral', status: 'completed', messages: [
    { role: 'user', content: 'AUTHENTICATED ORIGINAL HISTORY', timestamp: 0 },
    { role: 'assistant', api: 'mistral-chat-completions', provider: 'mistral', model: model.id, timestamp: 0, stopReason: 'toolUse', usage: emptyUsage(), aeonStepId: 'original-step', content: [{ type: 'toolCall', id: 'original-native', name: 'original-tool', arguments: {} }] },
    { role: 'toolResult', toolCallId: 'original-native', toolName: 'original-tool', isError: false, timestamp: 0, aeonStepId: 'original-step', content: [{ type: 'text', text: 'RETAINED ORIGINAL TOOL RESULT' }] },
  ], observationIds: ['original-observation'], compactions: [] });
  const checkpoint: ShellCheckpoint = { runId: parent.id, revision: 1, shell: SHELL_REVISION, artifact: store.putJsonArtifact(seed), observationIds: ['original-observation'] };
  store.put('execution', parent.id, { checkpoint }, null);
  const bindings = { stateDirectory: state, workspaceDirectory: work, artifactStore: join(directory, 'images'), nodeBinary: '/pinned/node' };
  const nodeEnvironment = nodeSuccessionHostEnvironment(bindings);
  const inputs: { input: ShellInput; options: ShellOptions; fragments: Record<string, string> }[] = [], payloads: string[] = [], dispatches: Authority[] = [];
  let attack: ((worker: Parameters<SuccessionHostEnvironment['runWorker']>[0], response: { status: number; body: string }) => Promise<void>) | undefined;
  let responseMutation: ((body: Record<string, unknown>) => void) | undefined;
  let lastResponse: { status: number; body: string } | undefined;
  const environment: SuccessionHostEnvironment = {
    loadCandidate(id) { const selected = images.get(id); assert.ok(selected); return selected; }, workspace: () => work,
    continuity: nodeEnvironment.continuity, validateContext: nodeEnvironment.validateContext,
    timing: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal }, wait: async () => { throw Error('Unexpected serving probe'); },
    async runWorker(worker) {
      const start = worker.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> }; inputs.push(structuredClone(start));
      const signal = worker.command.signal ?? new AbortController().signal;
      const rpc = (method: string, ...args: unknown[]) => worker.handle(method, json(args) as JsonValue[], signal);
      const bridge: ShellBridge = { execute: tool => rpc('execute', tool) as unknown as ReturnType<ShellBridge['execute']>,
        persistCheckpoint: (...args) => rpc('persistCheckpoint', ...args) as unknown as ReturnType<ShellBridge['persistCheckpoint']>, readCheckpoint: ref => rpc('readCheckpoint', ref),
        async capturePrompt(...args) { await rpc('capturePrompt', ...args); }, async reserve(request) { await rpc('reserve', request); }, async dispatched(request) { await rpc('dispatched', request); }, async settle(request) { await rpc('settle', request); } };
      const shell = createAgentShell({ ...start.options, apiKey: () => 'fixture-only', environment: { wallNow: () => now, monotonicNow: () => 0, newId: () => `assistant-${++sequence}`, scheduleTimeout: () => () => {} },
        resolveFragment: async fragment => start.fragments[fragment.artifact.sha256], fetch: async (_url, init) => {
          let response: { status: number; body: string };
          try { response = await rpc('provider.fetch', String(init?.body)) as typeof response; }
          catch (error) { if (lastResponse) await attack?.(worker, lastResponse); throw error; }
          await attack?.(worker, response); return new Response(response.body, { status: response.status }); } });
      return json(await shell.run(start.input, bridge, signal));
    },
  };
  const options: SuccessionHostOptions = { store, host: bindings, environment, now: () => now,
    current: () => current, assertAuthority: grant => authority.assert(grant),
    dispatchAuthority(grant, operation) { dispatches.push(structuredClone(grant)); return authority.dispatch(grant, operation); },
    resourceLedger(selectedStore, ceiling, clock) { const value = new ResourceLedger(selectedStore, ceiling, clock); if (unlimited) value.applyAllowanceAmendment(amendment, { authority: current.authority, assertAuthority: () => authority.assert(current.authority) }); return value; },
    async performRequest(payload) {
      payloads.push(payload); const request = JSON.parse(payload);
      if (!request.tools) return { status: 200, body: JSON.stringify({ model: model.id, usage: { prompt_tokens: 30, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'AUTHENTICATED ORIGINAL HISTORY and RETAINED ORIGINAL TOOL RESULT remain attributed. The incumbent has evaluated the two recorded dimensions. Read current host evidence for exact answers.' } }] }) };
      const frame = JSON.parse(request.messages.findLast((message: { role: string }) => message.role === 'user').content);
      const phase = frame.phase as string;
      const events: Record<string, { kind: string; content: JsonValue }> = {
        challenge: { kind: 'challenge', content: { question: 'How do you preserve the original history?', criterion: frame.request.criteria?.[0] ?? 'Continuity from evidence' } },
        answer: { kind: 'answer', content: { answer: 'The original context remains attributed and read only.', evidence: [frame.request.continuity] } },
        verdict: { kind: 'verdict', content: { decision: 'accept', reason: 'The answer follows actual continuity evidence.', question: 'Recall the original history after cutover.' } },
        ready: { kind: 'ready', content: { ready: true, reason: 'I accept the current-history handover.' } },
        observe: { kind: 'verdict', content: { decision: 'accept', reason: 'I observed the serving successor context.', evidence: [] } },
      };
      const body: Record<string, unknown> = { model: model.id, usage: { prompt_tokens: 30, completion_tokens: 10 }, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: `native-${payloads.length}`, type: 'function', function: { name: 'generation_mailbox', arguments: JSON.stringify(events[phase]) } }] } }] };
      responseMutation?.(body); lastResponse = { status: 200, body: JSON.stringify(body) }; return lastResponse;
    },
  };
  const binding: Omit<SuccessionBinding, 'context'> = { id: 'operation', runId: parent.id, stageId: 'stage', incumbentId: old.candidate.manifest.id, candidateId: next.candidate.manifest.id, policyDigest: identity('policy'), authority: prior, scope, objective: 'preserve history', criteria: ['Continuity from evidence'] };
  return { store, authority, parent, old, next, prior, ledger, options, binding, checkpoint, seed, inputs, payloads, dispatches,
    advance: () => { now += 1000; }, setAttack: (value: typeof attack) => { attack = value; }, mutateResponse: (value: typeof responseMutation) => { responseMutation = value; },
    cutover() { const withdrawn = authority.withdraw(prior); const nextAuthority = authority.activate(withdrawn, 'successor', 'controls', next.candidate.manifest.id); current = { candidateId: next.candidate.manifest.id, authority: nextAuthority, phase: 'probation' }; return nextAuthority; },
  };
}

for (const unlimited of [false, true]) test(`real authority dispatch, seven actual model turns and original resource lineage (unlimited: ${unlimited})`, async t => {
  const f = fixture(t, unlimited), host = new SuccessionHost(f.options), bound = host.capture(f.binding);
  const originalAllocation = f.store.get('allocations', f.parent.id)!;
  await host.dialogue.interview(bound);
  assert.equal(host.dialogue.status(bound.id)?.phase, 'approved'); assert.equal(f.payloads.filter(payload => JSON.parse(payload).tools).length, 7);
  assert.deepEqual(f.store.get('allocations', f.parent.id), originalAllocation);
  const requests = f.store.list<{ rootId: string; request: PhysicalRequest; ceiling: { tokens: number; elapsedMs: number } }>('requests');
  assert.equal(requests.length, f.payloads.length); assert.equal(requests.filter(row => row.value.request.purpose === 'reasoning').length, 7);
  assert.ok(requests.every(row => row.value.rootId === 'root' && row.value.request.status === 'succeeded' && row.value.ceiling.tokens > 0 && row.value.ceiling.elapsedMs > 0));
  assert.equal(f.store.list('host.model-responses').length, f.payloads.length); assert.equal(f.store.list('host.generation-mailbox').length, 7);
  assert.match(f.payloads[0], /AUTHENTICATED ORIGINAL HISTORY/); assert.match(f.payloads[0], /OWN FROZEN MIND incumbent/); assert.match(f.payloads[1], /OWN FROZEN MIND successor/);
  assert.equal(f.inputs[0].input.checkpoint?.artifact.sha256, f.checkpoint.artifact.sha256);
  assert.notEqual(f.inputs[0].input.run.id, f.parent.id); assert.equal(f.inputs[0].input.checkpoint?.runId, f.inputs[0].input.run.id);
  assert.match(f.payloads[0], /RETAINED ORIGINAL TOOL RESULT/); assert.equal(f.store.list('effects').length, 0);
  assert.equal(f.store.list('host.child-runs').length, 2); assert.deepEqual(f.store.readJsonArtifact(f.checkpoint.artifact), f.seed);
});

test('continuity includes audience-authorized memory and refuses a foreign conversation scope', async t => {
  const f = fixture(t), memory = new DevelopmentalMemory(f.store, () => '2026-10-21T00:00:00.000Z');
  for (const [id, audience] of [['visible', 'owner'], ['private', 'another-person']]) await memory.append({ id, kind: 'observation', revision: 1, scope: { kind: 'restricted', principals: [audience] },
    provenance: { sourceIds: [id], actorId: audience, recordedAt: '2026-10-21T00:00:00.000Z', derivation: 'observed' }, content: `history ${id}`, confidence: 1, supersedes: [], contradictions: [], status: 'active' }, null);
  const host = new SuccessionHost(f.options), captured = host.capture(f.binding), value = JSON.stringify(f.store.readJsonArtifact(captured.context));
  assert.match(value, /history visible/); assert.doesNotMatch(value, /history private/); assert.match(value, /AUTHENTICATED ORIGINAL HISTORY/);
  assert.throws(() => host.capture({ ...f.binding, scope: { kind: 'restricted', principals: ['foreign'] } }), /audience/);
});

test('observer retains old mind/checkpoint but dispatches under the current epoch without old serving authority', async t => {
  const f = fixture(t), host = new SuccessionHost(f.options), bound = host.capture(f.binding); await host.dialogue.interview(bound);
  const sessions = f.store.list<{ candidateId: string; checkpoint: ShellCheckpoint }>('host.generation-sessions');
  const previous = sessions.find(row => row.value.candidateId === bound.incumbentId)!.value.checkpoint;
  const current = f.cutover(), priorCount = f.dispatches.length;
  assert.throws(() => f.authority.assert(f.prior), /withdrawn/);
  const result = await host.dialogue.ports.turn(bound, { id: 'observer-turn', role: 'observer', phase: 'observe', status: 'dispatched', message: { actualServingObservation: 'retained result' } });
  assert.equal(result.event.kind, 'verdict'); assert.ok(f.dispatches.slice(priorCount).every(grant => identity(grant) === identity(current)));
  assert.equal(f.inputs.at(-1)?.input.checkpoint?.artifact.sha256, previous.artifact.sha256);
  assert.deepEqual(f.inputs.at(-1)?.input.run.authority, f.prior);
  assert.match(f.payloads.at(-1)!, /OWN FROZEN MIND incumbent/); assert.match(f.payloads.at(-1)!, /AUTHENTICATED ORIGINAL HISTORY/);
  assert.equal(f.store.list('host.generation-sessions').length, 2);
  assert.equal(f.store.list('effects').length, 0);
  assert.ok(f.store.list<{ allowedEffects: string[] }>('host.child-runs').every(row => row.value.allowedEffects.length === 0));
  const witness = f.store.readJsonArtifact<{ candidateId: string; bindingDigest: string }>(result.evidence);
  assert.equal(witness.candidateId, bound.incumbentId); assert.equal(witness.bindingDigest, identity(bound));
});

for (const mutation of ['truncated', 'wrong-served-model'] as const) test(`raw HTTP200 ${mutation} response cannot authorize a hostile worker mailbox`, async t => {
  const f = fixture(t);
  f.mutateResponse(body => { if (mutation === 'truncated') (body.choices as { finish_reason: string }[])[0].finish_reason = 'length'; else body.model = 'unqualified-served-model'; });
  let rejected = false;
  f.setAttack(async (worker, response) => {
    const start = worker.initial as unknown as { input: ShellInput }, native = JSON.parse(response.body).choices[0].message.tool_calls[0];
    const stepId = `${start.input.run.id}:assistant:forged`, tool: ToolCall = { id: `${stepId}:${native.id}`, runId: start.input.run.id, stepId, name: native.function.name, arguments: JSON.parse(native.function.arguments) };
    try { await worker.handle('execute', [json(tool)], new AbortController().signal); } catch { rejected = true; }
  });
  const host = new SuccessionHost(f.options), bound = host.capture(f.binding);
  await assert.rejects(host.dialogue.interview(bound));
  assert.equal(f.payloads.length, 1); assert.equal(rejected, true); assert.equal(f.store.list('host.generation-mailbox').length, 0);
  assert.equal(host.dialogue.status(bound.id)?.phase, 'uncertain');
});

test('durable native mailbox acknowledgement preserves its original timestamp during explicit recovery', async t => {
  const f = fixture(t); let acknowledgements = 0;
  const worker = f.options.environment.runWorker;
  f.options.environment.runWorker = selected => worker({ ...selected, handle: async (method, args, signal) => {
    const result = await selected.handle(method, args, signal);
    if (method === 'execute') { acknowledgements++; throw Error('Worker lost acknowledgement after durable commit'); }
    return result;
  } });
  const host = new SuccessionHost(f.options), bound = host.capture(f.binding); await assert.rejects(host.dialogue.interview(bound));
  const original = f.store.list('host.generation-mailbox'); assert.equal(original.length, 1);
  const pending = host.dialogue.status(bound.id)!.turns[0]; f.advance();
  // Explicit trusted-host recovery exercises the same pending native call; the
  // public dialogue never automatically retries its uncertain operation.
  await assert.rejects(host.dialogue.ports.turn(bound, pending));
  assert.equal(acknowledgements, 2); assert.deepEqual(f.store.list('host.generation-mailbox'), original); assert.equal(f.payloads.length, 1);
});

test('continuity refuses an original checkpoint assigned to a different production run', t => {
  const f = fixture(t), row = f.store.get('execution', f.parent.id)!;
  f.store.put('execution', f.parent.id, { checkpoint: { ...f.checkpoint, runId: 'foreign-production-run' } }, row.revision);
  const host = new SuccessionHost(f.options);
  assert.throws(() => host.capture(f.binding), /checkpoint|conversation|run/i);
  assert.equal(f.payloads.length, 0);
});

test('new authenticated steering invalidates captured continuity before model dispatch', async t => {
  const f = fixture(t), host = new SuccessionHost(f.options), bound = host.capture(f.binding);
  f.store.append({ id: 'new-input', stream: f.parent.id, type: 'steering', data: { authenticated: true, actorId: 'owner', scope, value: 'Correct the prior assumption.' } });
  await assert.rejects(host.dialogue.interview(bound), /New input|fresh incumbent/);
  assert.equal(f.payloads.length, 0); assert.equal(f.store.list('requests').length, 0);
});

test('forged incumbent candidate or audience cannot acquire a generation session', async t => {
  const f = fixture(t), host = new SuccessionHost(f.options), bound = host.capture(f.binding);
  await assert.rejects(host.dialogue.interview({ ...bound, incumbentId: bound.candidateId }), /stale serving/);
  await assert.rejects(host.dialogue.interview({ ...bound, scope: { kind: 'public' } }), /audience/);
  assert.equal(f.store.list('host.generation-sessions').length, 0); assert.equal(f.payloads.length, 0);
});

test('withdrawn memory invalidates the retained continuity artifact before either generation runs', async t => {
  const f = fixture(t), memory = new DevelopmentalMemory(f.store, () => '2026-10-21T00:00:00.000Z');
  await memory.append({ id: 'withdraw-me', kind: 'observation', revision: 1, scope,
    provenance: { sourceIds: ['fixture-source'], actorId: 'owner', recordedAt: '2026-10-21T00:00:00.000Z', derivation: 'observed' }, content: 'history to withdraw', confidence: 1, supersedes: [], contradictions: [], status: 'active' }, null);
  const host = new SuccessionHost(f.options), bound = host.capture(f.binding); memory.forget(['withdraw-me'], scope);
  await assert.rejects(host.dialogue.interview(bound), /memory.*withdrawn/);
  assert.equal(f.payloads.length, 0); assert.equal(f.store.list('requests').length, 0);
});


test('unsupported cognitive provider refuses before any role model or session dispatch', t => {
  const f = fixture(t), load = f.options.environment.loadCandidate;
  f.options.environment.loadCandidate = id => { const selected = structuredClone(load(id));
    (selected.candidate.inputs.configuration as { model: Record<string, unknown> }).model.provider = 'openai'; return selected; };
  const host = new SuccessionHost(f.options);
  assert.throws(() => host.capture(f.binding), /provider unsupported/);
  assert.equal(f.payloads.length, 0); assert.equal(f.store.list('host.generation-sessions').length, 0);
});
