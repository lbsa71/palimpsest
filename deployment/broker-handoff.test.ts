import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { digest } from '../packages/agent-shell/mistral.ts';
import { identity, type JsonValue, type Observation, type PhysicalRequest, type ShellBridge, type ShellInput, type ToolCall } from '../packages/contracts/index.ts';
import { createBrokerShell, type BrokerShellOptions, type TransportReceipt } from './broker-shell.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const input: ShellInput = { run: { id: 'handoff', revision: 1, status: 'running', authority: { generation: 'fixture', epoch: 1, controlRevision: 'controls' }, scope: { kind: 'public' } }, messages: [{ role: 'user', content: 'Delegate then inspect', timestamp: 0 }], prompt: { id: 'base', fragments: [], requestDigest: identity('base') } };
const tools = ['code', 'inspect'].map(name => ({ name, description: name, parameters: { type: 'object', properties: {}, additionalProperties: false } }));

function fixture(t: TestContext, options: { isolated?: boolean; omitSibling?: boolean; changeObservation?: boolean; changeSibling?: boolean; ignoreHandoff?: boolean; foreign?: boolean; unknown?: boolean; crashAfterCode?: boolean; handoff?: string[] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-broker-handoff-')); const workspace = join(directory, 'work'); const state = join(directory, 'state'); mkdirSync(workspace); mkdirSync(state);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = new Map<string, JsonValue>(), instructions = new Map<string, string>(), cache = new Map<string, Observation>(), requests = new Map<string, PhysicalRequest>();
  const calls: ToolCall[] = [], payloads: string[] = [], receipts: TransportReceipt[] = [];
  let sequence = 0, effects = 0, crashed = false;
  const bridge: ShellBridge = {
    async execute(call) {
      calls.push(call);
      let observation = cache.get(call.id);
      if (!observation) { effects++; observation = { id: `observation:${call.id}`, runId: options.foreign ? 'foreign' : call.runId, stepId: call.stepId, sourceId: call.id, kind: 'result', value: call.name === 'code' ? 'queued coding turn' : 'retained sibling inspection', provenance: { sourceIds: [call.id], actorId: 'fixture', recordedAt: '1970-01-01T00:00:00.000Z', derivation: 'observed' } }; cache.set(call.id, observation); }
      if (options.crashAfterCode && call.name === 'code' && !crashed) { crashed = true; throw Error('Lost reply after committed enqueue'); }
      return observation;
    },
    async capturePrompt() {}, async reserve(request) { requests.set(request.id, request); }, async dispatched(request) { requests.set(request.id, request); }, async settle(request) { requests.set(request.id, request); },
    async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); artifacts.set(sha256, structuredClone(content)); return { runId, revision, shell, artifact: { uri: `fixture:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; },
  };
  const runWorker: BrokerShellOptions['runWorker'] = async worker => {
    const start = worker.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
    const signal = worker.command.signal ?? new AbortController().signal;
    const rpc = (method: string, ...args: unknown[]) => worker.handle(method, json(args) as JsonValue[], signal);
    const workerBridge: ShellBridge = {
      execute: call => rpc('execute', call) as unknown as ReturnType<ShellBridge['execute']>,
      async persistCheckpoint(runId, revision, shell, content) {
        const altered = structuredClone(content) as { status: string; messages: { role: string; toolName?: string; content: unknown }[] };
        if (altered.status === 'completed') {
          if (options.omitSibling) altered.messages = altered.messages.filter(m => m.role !== 'toolResult' || m.toolName !== 'inspect');
          if (options.changeObservation || options.changeSibling) altered.messages.find(m => m.role === 'toolResult' && m.toolName === (options.changeSibling ? 'inspect' : 'code'))!.content = [{ type: 'text', text: 'invented success' }];
        }
        return rpc('persistCheckpoint', runId, revision, shell, json(altered)) as unknown as ReturnType<ShellBridge['persistCheckpoint']>;
      },
      readCheckpoint: checkpoint => rpc('readCheckpoint', checkpoint),
      async capturePrompt(manifest, payload) { await rpc('capturePrompt', manifest, payload); }, async reserve(request) { await rpc('reserve', request); }, async dispatched(request) { await rpc('dispatched', request); }, async settle(request) { await rpc('settle', request); },
    };
    const shell = createAgentShell({ ...start.options, ...(options.ignoreHandoff ? { finishAfterSuccessfulTools: [] } : {}), apiKey: () => 'fixture',
      environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `worker-${++sequence}`, scheduleTimeout: () => () => {} }, resolveFragment: async fragment => start.fragments[fragment.artifact.sha256],
      fetch: async (_url, init) => { const response = await rpc('provider.fetch', String(init?.body)) as { status: number; body: string }; return new Response(response.body, { status: response.status }); },
    });
    const result = await shell.run(start.input, workerBridge, signal);
    if (result.status === 'completed' && payloads.length === 1 && !options.omitSibling && !options.changeObservation && !options.changeSibling) await assert.rejects(rpc('execute', { id: 'extra', runId: input.run.id, stepId: 'extra', name: 'inspect', arguments: {} }), /continued after its checkpointed slice/);
    return json(result);
  };
  const shell = createBrokerShell({ applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), entrypoint: 'deployment/shell-worker.ts', workspace: () => workspace, protectedPaths: [state], nodeBinary: process.execPath,
    ...(options.isolated ? {} : { runWorker }), timeoutMs: 10000, maxPayloadBytes: 1024 * 1024, pricesPerMillion: { input: 1, output: 2 },
    worker: { model: 'fixture-v1', maxRequests: 12, maxOutputTokens: 64, timeoutMs: 5000, tools, finishAfterSuccessfulTools: options.handoff ?? ['code'] },
    brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal },
    retainToolInstructions(source) { const sha256 = digest(source); instructions.set(sha256, source); return { uri: `aeon:artifact:${sha256}`, sha256 }; }, resolveFragment: async fragment => instructions.get(fragment.artifact.sha256)!, assertAuthority() {},
    async performRequest(payload) {
      payloads.push(payload); if (options.unknown) throw Error('Lost provider response after dispatch');
      const first = payloads.length === 1;
      return { status: 200, body: JSON.stringify({ model: 'fixture-v1', usage: { prompt_tokens: 7, completion_tokens: 2 }, choices: [{ finish_reason: first ? 'tool_calls' : 'stop', message: first
        ? { content: null, tool_calls: tools.map(tool => ({ id: `call-${tool.name}`, type: 'function', function: { name: tool.name, arguments: '{}' } })) }
        : { content: 'The new coding result and old sibling observation were inspected.' } }] }) };
    }, recordTransport(receipt) { receipts.push(structuredClone(receipt)); },
  });
  return { shell, bridge, calls, payloads, requests, receipts, artifacts, effects: () => effects };
}

for (const isolated of [false, true]) test(`handoff persists a full batch then consumes new input in the same checkpoint without replay (isolated worker: ${isolated})`, async t => {
  const f = fixture(t, { isolated });
  const first = await f.shell.run(input, f.bridge); assert.equal(first.status, 'completed'); assert.equal(f.payloads.length, 1); assert.equal(f.effects(), 2);
  const prior = structuredClone([...f.requests.values()]);
  const next = await f.shell.run({ ...input, checkpoint: first.checkpoint, messages: [{ role: 'user', content: 'coding result ready: inspect it', timestamp: 1 }] }, f.bridge);
  assert.equal(next.status, 'completed'); assert.equal(f.payloads.length, 2); assert.equal(f.effects(), 2); assert.equal(f.calls.length, 2);
  assert.match(f.payloads[1], /coding result ready/); assert.match(f.payloads[1], /queued coding turn/); assert.match(f.payloads[1], /retained sibling inspection/);
  assert.deepEqual([...f.requests.values()].slice(0, 1), prior); assert.equal([...f.requests.values()].filter(r => r.status === 'succeeded').length, 2);
});

for (const mutation of ['omitSibling', 'changeObservation', 'changeSibling'] as const) test(`host rejects a forged completed handoff before durable publication: ${mutation}`, async t => {
  const f = fixture(t, { [mutation]: true });
  await assert.rejects(f.shell.run(input, f.bridge), /Tool handoff (omitted part|changed or omitted)/);
  assert.equal(f.payloads.length, 1); assert.equal(f.effects(), 2);
  assert.ok([...f.artifacts.values()].every(value => (value as { status?: string }).status !== 'completed'));
});

test('host prevents a worker ignoring configured handoff from another model request', async t => {
  const f = fixture(t, { ignoreHandoff: true }); const result = await f.shell.run(input, f.bridge);
  assert.equal(result.status, 'blocked'); assert.equal(f.payloads.length, 1); assert.equal(f.requests.size, 1); assert.equal(f.effects(), 2);
});

test('host rejects foreign observation identity and retains unknown transport as blocked', async t => {
  const foreign = fixture(t, { foreign: true }); assert.equal((await foreign.shell.run(input, foreign.bridge)).status, 'blocked'); assert.equal(foreign.calls.length, 1); assert.equal(foreign.payloads.length, 1);
  const unknown = fixture(t, { unknown: true }); assert.equal((await unknown.shell.run(input, unknown.bridge)).status, 'blocked'); assert.equal(unknown.calls.length, 0); assert.equal(unknown.payloads.length, 1); assert.equal([...unknown.requests.values()][0].status, 'uncertain');
});

test('broker recovery of an old committed enqueue does not hide new steering behind a handoff', async t => {
  const f = fixture(t, { crashAfterCode: true }); const first = await f.shell.run(input, f.bridge); assert.equal(first.status, 'blocked'); assert.equal(f.effects(), 1);
  const next = await f.shell.run({ ...input, checkpoint: first.checkpoint, messages: [{ role: 'user', content: 'new result after interrupted enqueue', timestamp: 1 }] }, f.bridge);
  assert.equal(next.status, 'completed'); assert.equal(f.payloads.length, 2); assert.equal(f.effects(), 2); assert.equal(f.calls.length, 3); assert.equal(f.calls[0].id, f.calls[1].id); assert.match(f.payloads[1], /new result after interrupted enqueue/);
});

test('only declared host-configured tools may be handoff targets', async t => {
  const f = fixture(t, { handoff: ['undeclared'] }); await assert.rejects(f.shell.run(input, f.bridge), /Invalid broker handoff tools/); assert.equal(f.payloads.length, 0); assert.equal(f.calls.length, 0);
});
