import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { digest } from '../packages/agent-shell/mistral.ts';
import { identity, type JsonValue, type Observation, type PhysicalRequest, type ShellBridge, type ShellCheckpoint, type ShellInput, type ToolCall } from '../packages/contracts/index.ts';
import { freezeCandidate, verifyCandidate, type CandidateInputs, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { runWorker } from '../packages/supervisor/worker-process.ts';
import { readVerifiedRuntimeFile, type RuntimeIdentity } from './runtime-bundle.ts';
import { createGenerationMind, type GenerationCall, type GenerationEvent, type GenerationMindOptions, type GenerationMindPorts, type LoadedGeneration } from './generation-mind.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const profile = { id: 'generation-fixture-v1', contextWindow: 32000, reasoning: false, effort: 'none', maxOutputTokens: 512, maxRequestsPerSlice: 3, timeoutMs: 5000, pricesPerMillion: { input: 1, output: 2 } };
function inputs(label: string, runtime: JsonValue = {}): CandidateInputs {
  return { prompts: { mind: `OWN MIND ${label}`, compaction: `OWN COMPACTION ${label}` }, model: profile,
    configuration: { model: profile }, controls: { runtime }, dependencies: {}, createdBy: 'generation-fixture' };
}
function candidate(label = 'incumbent'): LoadedGeneration {
  const value = inputs(label), files: FrozenCandidate['files'] = [];
  const manifest = { source: identity(files), dependencies: identity(value.dependencies), prompts: identity(value.prompts), model: identity(value.model),
    configuration: identity(value.configuration), controls: identity(value.controls), createdBy: value.createdBy };
  return { candidate: { manifest: { id: identity(manifest), ...manifest }, inputs: value, files }, applicationRoot: '/fixture/app', nodeBinary: '/fixture/node' };
}
function call(image: LoadedGeneration, role: GenerationCall['role'] = 'incumbent', turnId = 'first', checkpoint?: ShellCheckpoint): GenerationCall {
  return { sessionId: 'succession', turnId, role, candidateId: image.candidate.manifest.id, input: {
    run: { id: role === 'successor' ? 'successor-run' : 'incumbent-run', revision: 1, status: 'running', authority: { generation: 'physical-host', epoch: 1, controlRevision: 'accepted' }, scope: { kind: 'restricted', principals: ['owner'] } },
    messages: [{ role: 'user', content: `AUTHORIZED CONTINUITY ${turnId}`, timestamp: 0 }], ...(checkpoint ? { checkpoint } : {}),
  } };
}
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-generation-')); const state = join(directory, 'state'), work = join(directory, 'work');
  mkdirSync(state); mkdirSync(work); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = new Map<string, string>(), checkpoints = new Map<string, JsonValue>(), observations = new Map<string, Observation>();
  const images = new Map<string, LoadedGeneration>(), payloads: { call: GenerationCall; payload: string }[] = [], requests: PhysicalRequest[] = [];
  const sources: { runId: string; id: string; arguments: JsonValue }[] = [], mailbox: { call: GenerationCall; event: GenerationEvent }[] = [];
  const starts: Parameters<GenerationMindPorts['runWorker']>[0][] = [];
  const terminals: string[] = [];
  let sequence = 0, permit = true;
  const host: Omit<ShellBridge, 'execute'> = {
    async capturePrompt(manifest, payload) { assert.equal(manifest.requestDigest, digest(payload)); },
    async reserve(request) { requests.push(structuredClone(request)); }, async dispatched(request) { requests.push(structuredClone(request)); }, async settle(request) { requests.push(structuredClone(request)); },
    async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); checkpoints.set(sha256, structuredClone(content)); return { runId, revision, shell, artifact: { uri: `aeon:artifact:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(ref) { assert.ok(checkpoints.has(ref.artifact.sha256)); return structuredClone(checkpoints.get(ref.artifact.sha256)!); },
  };
  const simulated: GenerationMindPorts['runWorker'] = async worker => {
    starts.push(worker);
    const start = worker.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
    const signal = worker.command.signal ?? new AbortController().signal;
    const rpc = (method: string, ...args: unknown[]) => worker.handle(method, json(args) as JsonValue[], signal);
    const bridge: ShellBridge = { execute: tool => rpc('execute', tool) as unknown as ReturnType<ShellBridge['execute']>,
      persistCheckpoint: (...args) => rpc('persistCheckpoint', ...args) as unknown as ReturnType<ShellBridge['persistCheckpoint']>,
      readCheckpoint: ref => rpc('readCheckpoint', ref), async capturePrompt(...args) { await rpc('capturePrompt', ...args); },
      async reserve(request) { await rpc('reserve', request); }, async dispatched(request) { await rpc('dispatched', request); }, async settle(request) { await rpc('settle', request); } };
    const shell = createAgentShell({ ...start.options, apiKey: () => 'never-forwarded',
      environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `assistant-${++sequence}`, scheduleTimeout: () => () => {} },
      resolveFragment: async fragment => start.fragments[fragment.artifact.sha256],
      fetch: async (_url, init) => { const response = await rpc('provider.fetch', String(init?.body)) as { status: number; body: string }; return new Response(response.body, { status: response.status }); } });
    return json(await shell.run(start.input, bridge, signal));
  };
  const ports: GenerationMindPorts = {
    loadCandidate(id) { const image = images.get(id); assert.ok(image); return image; },
    assertCall() { assert.ok(permit, 'role withdrawn'); }, workspace: () => work, bridge: () => host,
    assertMailboxSource(context, tool) { assert.ok(sources.some(source => source.runId === context.input.run.id && tool.id.endsWith(`:${source.id}`) && identity(source.arguments) === identity(tool.arguments)), 'mailbox lacks real model source'); },
    async appendMailbox(context, tool, event) {
      let observation = observations.get(tool.id);
      if (!observation) { mailbox.push({ call: context, event: structuredClone(event) }); observation = { id: `observation:${tool.id}`, runId: tool.runId, stepId: tool.stepId, sourceId: tool.id, kind: 'result', value: { accepted: true, event: json(event) }, provenance: { sourceIds: [tool.id], actorId: 'host-mailbox', recordedAt: '1970-01-01T00:00:00.000Z', derivation: 'observed' } }; observations.set(tool.id, observation); }
      return structuredClone(observation);
    },
    retainArtifact(source) { const sha256 = digest(source); artifacts.set(sha256, source); return { uri: `aeon:artifact:${sha256}`, sha256 }; },
    readArtifact: ref => artifacts.get(ref.sha256)!,
    async performRequest(context, payload) {
      payloads.push({ call: context, payload });
      const kind = context.role === 'incumbent' ? context.turnId === 'verdict' ? 'verdict' : 'challenge' : context.role === 'successor' ? 'ready' : 'observation';
      return { status: 200, body: JSON.stringify({ model: profile.id, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: `native-${payloads.length}`, type: 'function', function: { name: 'generation_mailbox', arguments: JSON.stringify({ kind, content: `MODEL ${context.role} ${context.turnId}` }) } }] } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }) };
    },
    recordTransport() {},
    recordResponse(context, _id, response) { for (const tool of JSON.parse(response.body).choices[0].message.tool_calls ?? []) sources.push({ runId: context.input.run.id, id: tool.id, arguments: JSON.parse(tool.function.arguments) }); },
    onTransportFinished: (_context, id) => { terminals.push(id); }, runWorker: simulated,
    brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal },
  };
  const options: GenerationMindOptions = { protectedPaths: [state], timeoutMs: 10000, maxPayloadBytes: 1000000, maxResponseBytes: 1000000, maxMailboxBytes: 8192, maxMailboxEvents: 4 };
  return { directory, state, work, ports, options, images, payloads, requests, sources, mailbox, starts, terminals, checkpoints, host, revoke: () => { permit = false; } };
}

test('own frozen instructions, mailbox handoff and same incumbent checkpoint survive observer cutover', async t => {
  const f = fixture(t), old = candidate(), next = candidate('successor'); f.images.set(old.candidate.manifest.id, old); f.images.set(next.candidate.manifest.id, next);
  const invoke = createGenerationMind(f.options, f.ports);
  const first = await invoke(call(old)); assert.equal(first.shell.status, 'completed'); assert.equal(f.payloads.length, 1);
  assert.deepEqual(first.mailbox.map(event => event.kind), ['challenge']);
  await invoke(call(next, 'successor'));
  const judgment = await invoke(call(old, 'incumbent', 'verdict', first.shell.checkpoint));
  const observing = call(old, 'observer', 'after-cutover', judgment.shell.checkpoint); observing.input.run.authority.epoch = 2;
  await invoke(observing);
  assert.equal(f.payloads.length, 4); assert.equal(f.mailbox.length, 4); assert.equal(f.terminals.length, 4);
  assert.match(f.payloads[0].payload, /OWN MIND incumbent/); assert.match(f.payloads[1].payload, /OWN MIND successor/);
  assert.doesNotMatch(f.payloads[1].payload, /OWN MIND incumbent/);
  assert.match(f.payloads[3].payload, /MODEL incumbent first/); assert.match(f.payloads[3].payload, /MODEL incumbent verdict/); assert.match(f.payloads[3].payload, /AUTHORIZED CONTINUITY after-cutover/);
  const startup = f.starts[1].initial as unknown as { options: ShellOptions; fragments: Record<string, string> };
  assert.equal(startup.options.model, profile.id); assert.equal(startup.fragments[startup.options.compaction!.instruction.artifact.sha256], 'OWN COMPACTION successor');
  assert.deepEqual(startup.options.tools.map(tool => tool.name), ['generation_mailbox']);
  assert.equal(f.requests.filter(request => request.status === 'succeeded').length, 4);
});

test('candidate metadata changes, wrong frozen runtime and revoked role stop before worker launch', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  image.candidate.inputs.prompts = { mind: 'changed', compaction: 'changed' };
  await assert.rejects(createGenerationMind(f.options, f.ports)(call(image)), /frozen input mismatch/);
  const bundled = candidate(); bundled.candidate.inputs.controls = { runtime: { bundle: { path: '.runtime/node', bytes: 1 }, nodeSha256: 'a'.repeat(64) } };
  bundled.candidate.manifest.controls = identity(bundled.candidate.inputs.controls); const { id: _id, ...fields } = bundled.candidate.manifest; bundled.candidate.manifest.id = identity(fields);
  f.images.set(bundled.candidate.manifest.id, bundled);
  await assert.rejects(createGenerationMind(f.options, f.ports)(call(bundled)), /runtime differs/);
  f.revoke(); await assert.rejects(createGenerationMind(f.options, f.ports)(call(bundled)), /role withdrawn/);
  assert.equal(f.starts.length, 0); assert.equal(f.payloads.length, 0);
});

test('host rejects fabricated model source, forbidden effects, forged roles and unbounded mailbox content', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  f.ports.runWorker = async worker => {
    const base: ToolCall = { id: 'fake-native', runId: 'incumbent-run', stepId: 'step', name: 'generation_mailbox', arguments: { kind: 'verdict', content: 'invented pass' } };
    const signal = new AbortController().signal;
    for (const [tool, reason] of [
      [base, /real model source/], [{ ...base, name: 'speech_send' }, /own mailbox/], [{ ...base, runId: 'foreign' }, /Foreign worker/],
      [{ ...base, arguments: { kind: 'ready', content: true } }, /not permitted/],
      [{ ...base, arguments: { kind: 'verdict', content: true, role: 'successor' } }, /not permitted/],
      [{ ...base, arguments: { kind: 'verdict', content: 'x'.repeat(9000) } }, /exceeds/],
    ] as const) await assert.rejects(worker.handle('execute', [json(tool)], signal), reason);
    return { status: 'blocked', observations: [] };
  };
  assert.equal((await createGenerationMind(f.options, f.ports)(call(image))).shell.status, 'blocked');
  assert.equal(f.mailbox.length, 0); assert.equal(f.payloads.length, 0);
});

test('withdrawal during physical transport retains actual receipt and cleanup without mailbox authority', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const transport = f.ports.performRequest;
  f.ports.performRequest = async (...args) => { const result = await transport(...args); f.revoke(); return result; };
  try { await createGenerationMind(f.options, f.ports)(call(image)); } catch (error) { assert.match(String(error), /role withdrawn/); }
  assert.equal(f.payloads.length, 1); assert.equal(f.mailbox.length, 0); assert.equal(f.terminals.length, 1);
  assert.equal(f.requests.at(-1)?.status, 'succeeded'); assert.equal(f.requests.at(-1)?.usage.inputTokens, 11);
});

test('capabilities and call identity are captured before an injected callback can replace them', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const original = f.ports.loadCandidate;
  f.ports.loadCandidate = id => { f.ports.performRequest = async () => { throw Error('replaced transport'); }; f.options.protectedPaths.length = 0; return original(id); };
  const invoke = createGenerationMind(f.options, f.ports), selected = call(image);
  const pending = invoke(selected); selected.role = 'successor';
  const result = await pending;
  assert.equal(result.role, 'incumbent'); assert.deepEqual(f.starts[0].command.protectedPaths, [f.state]); assert.equal(f.payloads.length, 1);
});

test('authorized continuity remains in the attested prompt when a worker omits its ordinary messages', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const execute = f.ports.runWorker;
  f.ports.runWorker = worker => { (worker.initial as unknown as { input: ShellInput }).input.messages = []; return execute(worker); };
  const selected = call(image);
  const result = await createGenerationMind(f.options, f.ports)(selected);
  assert.equal(result.shell.status, 'completed');
  const payload = JSON.parse(f.payloads[0].payload);
  assert.equal(payload.messages.length, 1);
  assert.match(payload.messages[0].content, /AUTHORIZED CONTINUITY first/);
  assert.ok(payload.messages[0].content.includes(identity(selected.input.messages)));
});

test('lost mailbox acknowledgement recovers the same native call without repeating the committed event', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const append = f.ports.appendMailbox, source = f.ports.assertMailboxSource; let lost = false;
  const verified: string[] = [];
  f.ports.assertMailboxSource = (context, tool) => { verified.push(`${context.turnId}:${tool.id}`); source(context, tool); };
  f.ports.appendMailbox = async (...args) => { const receipt = await append(...args); if (!lost) { lost = true; throw Error('reply lost after commit'); } return receipt; };
  const invoke = createGenerationMind(f.options, f.ports), first = await invoke(call(image));
  assert.equal(first.shell.status, 'blocked'); assert.equal(f.mailbox.length, 1); assert.equal(f.payloads.length, 1);
  const original = structuredClone(f.requests), oldTool = verified[0].slice('first:'.length);
  const resumed = await invoke(call(image, 'incumbent', 'follow-up', first.shell.checkpoint));
  assert.equal(resumed.shell.status, 'completed'); assert.equal(f.mailbox.length, 2); assert.equal(f.payloads.length, 2);
  assert.ok(verified.includes(`follow-up:${oldTool}`)); assert.deepEqual(f.requests.slice(0, original.length), original);
  assert.match(f.payloads[1].payload, /MODEL incumbent first/); assert.match(f.payloads[1].payload, /AUTHORIZED CONTINUITY follow-up/);
});

test('unknown model outcome retains the uncertain request and never retries within the turn', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const perform = f.ports.performRequest;
  f.ports.performRequest = async (...args) => { await perform(...args); throw Error('transport lost after dispatch'); };
  const result = await createGenerationMind(f.options, f.ports)(call(image));
  assert.equal(result.shell.status, 'blocked'); assert.equal(f.payloads.length, 1); assert.equal(f.mailbox.length, 0);
  assert.equal(f.requests.at(-1)?.status, 'uncertain'); assert.equal(f.requests.at(-1)?.usage.inputTokens, null); assert.equal(f.terminals.length, 1);
});

test('actual frozen worker and bundled Node run with isolated state, immutable app and no network', async t => {
  const f = fixture(t), source = join(f.directory, 'source'), store = join(f.directory, 'images');
  const repository = dirname(dirname(fileURLToPath(import.meta.url)));
  mkdirSync(join(source, 'deployment'), { recursive: true }); mkdirSync(join(source, 'packages')); mkdirSync(join(source, '.runtime'));
  for (const name of ['agent-shell', 'contracts', 'narrow-schema']) cpSync(join(repository, 'packages', name), join(source, 'packages', name), { recursive: true });
  copyFileSync(join(repository, 'deployment/source-observation.ts'), join(source, 'deployment/source-observation.ts')); copyFileSync(process.execPath, join(source, '.runtime/node'));
  const runtimeBytes = readFileSync(process.execPath);
  const runtime: RuntimeIdentity = { nodeVersion: process.version, nodeSha256: createHash('sha256').update(runtimeBytes).digest('hex'), platform: process.platform, arch: process.arch, bundle: { path: '.runtime/node', bytes: runtimeBytes.length } };
  const original = readFileSync(join(repository, 'deployment/shell-worker.ts'), 'utf8');
  for (const label of ['incumbent', 'successor']) {
    writeFileSync(join(source, 'deployment/shell-worker.ts'), `import {writeFileSync as proofWrite,existsSync as proofExists} from 'node:fs'; import {networkInterfaces as proofNetworks} from 'node:os';
let immutable=false;try{proofWrite('/app/injected','bad')}catch{immutable=true}
proofWrite('/work/${label}-proof.json',JSON.stringify({label:${JSON.stringify(label)},runtime:process.version,stateVisible:proofExists(${JSON.stringify(f.state)}),immutable,networks:Object.keys(proofNetworks())}));\n${original}`);
    const frozen = freezeCandidate(source, store, ['deployment', 'packages', '.runtime'], inputs(label, json(runtime)));
    const image = { candidate: frozen, applicationRoot: join(store, frozen.manifest.id, 'payload'), nodeBinary: join(store, frozen.manifest.id, 'payload/.runtime/node') };
    f.images.set(frozen.manifest.id, image);
  }
  f.ports.loadCandidate = id => { const image = f.images.get(id)!; verifyCandidate(store, id); readVerifiedRuntimeFile(image.applicationRoot, '.runtime/node', runtime); return image; };
  f.ports.runWorker = async worker => { f.starts.push(worker); return runWorker(worker); };
  const invoke = createGenerationMind(f.options, f.ports), [old, next] = [...f.images.values()];
  const first = await invoke(call(old)); assert.equal(first.shell.status, 'completed');
  const second = await invoke(call(next, 'successor')); assert.equal(second.shell.status, 'completed');
  for (const label of ['incumbent', 'successor']) {
    const proof = JSON.parse(readFileSync(join(f.work, `${label}-proof.json`), 'utf8'));
    assert.deepEqual({ ...proof, networks: [] }, { label, runtime: process.version, stateVisible: false, immutable: true, networks: [] });
    assert.ok(proof.networks.every((name: string) => name === 'lo'));
  }
  assert.match(f.payloads[0].payload, /OWN MIND incumbent/); assert.match(f.payloads[1].payload, /OWN MIND successor/);
  assert.equal(f.payloads.length, 2); assert.equal(f.requests.filter(request => request.status === 'succeeded').length, 2);
  assert.equal(f.mailbox.length, 2); assert.notEqual(f.starts[0].command.applicationRoot, f.starts[1].command.applicationRoot);
});
