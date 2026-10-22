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
  const phase = role === 'observer' ? 'observe' : role === 'successor' ? 'ready' : turnId === 'verdict' ? 'verdict' : 'challenge';
  return { sessionId: 'succession', turnId, role, phase, candidateId: image.candidate.manifest.id, input: {
    run: { id: role === 'successor' ? 'successor-run' : 'incumbent-run', revision: 1, status: 'running', authority: { generation: 'physical-host', epoch: 1, controlRevision: 'accepted' }, scope: { kind: 'restricted', principals: ['owner'] } },
    messages: [{ role: 'user', content: `AUTHORIZED CONTINUITY ${turnId}`, timestamp: 0 }], ...(checkpoint ? { checkpoint } : {}),
  } };
}
const evidenceRef = { uri: `aeon:artifact:${'e'.repeat(64)}`, sha256: 'e'.repeat(64) };
function modelEvent(context: GenerationCall): GenerationEvent {
  const message = `MODEL ${context.role} ${context.turnId}`;
  switch (context.phase) {
    case 'challenge': return { kind: 'challenge', content: { question: message, criterion: 'Declared continuity criterion' } };
    case 'answer': return { kind: 'answer', content: { answer: message, evidence: [evidenceRef] } };
    case 'counter-answer': return { kind: 'answer', content: { answer: message } };
    case 'verdict': return { kind: 'verdict', content: { decision: 'accept', reason: message, question: 'What does the serving successor actually preserve?' } };
    case 'ready': return { kind: 'ready', content: { ready: true, reason: message } };
    case 'observe': return { kind: 'verdict', content: { decision: 'accept', reason: message, evidence: [evidenceRef] } };
  }
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
      return { status: 200, body: JSON.stringify({ model: profile.id, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: `native-${payloads.length}`, type: 'function', function: { name: 'generation_mailbox', arguments: JSON.stringify(modelEvent(context)) } }] } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }) };
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
  for (const { call: selected, payload: source } of f.payloads) {
    const payload = JSON.parse(source);
    assert.deepEqual(payload.tool_choice, { type: 'function', function: { name: 'generation_mailbox' } });
    const expected = { challenge: ['challenge'], ready: ['ready'], verdict: ['verdict'], observe: ['verdict', 'regression'] };
    assert.deepEqual(payload.tools[0].function.parameters.properties.kind.enum, expected[selected.phase as keyof typeof expected]);
  }
  const startup = f.starts[1].initial as unknown as { options: ShellOptions; fragments: Record<string, string> };
  assert.equal(startup.options.model, profile.id); assert.equal(startup.fragments[startup.options.compaction!.instruction.artifact.sha256], 'OWN COMPACTION successor');
  assert.deepEqual(startup.options.tools.map(tool => tool.name), ['generation_mailbox']);
  assert.equal(f.requests.filter(request => request.status === 'succeeded').length, 4);
});

test('successor answer request requires the mailbox and complete artifact citation objects', async t => {
  const f = fixture(t), image = candidate('successor'); f.images.set(image.candidate.manifest.id, image);
  const selected: GenerationCall = { ...call(image, 'successor'), phase: 'answer' };
  await createGenerationMind(f.options, f.ports)(selected);
  const payload = JSON.parse(f.payloads[0].payload);
  assert.deepEqual(payload.tool_choice, { type: 'function', function: { name: 'generation_mailbox' } });
  assert.deepEqual(payload.tools.map((tool: { function: { name: string } }) => tool.function.name), ['generation_mailbox']);
  const evidenceSchemas: Record<string, any>[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && 'properties' in value) {
      const properties = (value as { properties?: Record<string, any> }).properties;
      if (properties?.evidence) evidenceSchemas.push(properties.evidence);
    }
    Object.values(value).forEach(visit);
  };
  visit(payload.tools[0].function.parameters);
  assert.ok(evidenceSchemas.length > 0, 'Answer schema must expose its evidence contract');
  for (const evidence of evidenceSchemas) {
    assert.equal(evidence.type, 'array'); assert.equal(evidence.items.type, 'object');
    assert.deepEqual([...evidence.items.required].sort(), ['sha256', 'uri']);
    assert.equal(evidence.items.additionalProperties, false);
    assert.equal(evidence.items.properties.uri.type, 'string');
    assert.equal(evidence.items.properties.sha256.type, 'string');
  }
});

test('worker cannot downgrade the required mailbox selector to automatic before provider dispatch', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const execute = f.ports.runWorker;
  const attempted: unknown[] = [], rejected: string[] = [];
  f.ports.runWorker = worker => {
    const start = worker.initial as unknown as { options: ShellOptions };
    delete start.options.requiredTool;
    return execute({ ...worker, async handle(method, args, signal) {
      if (method === 'capturePrompt') attempted.push(JSON.parse(String(args[1])).tool_choice);
      try { return await worker.handle(method, args, signal); }
      catch (error) { if (method === 'capturePrompt') rejected.push(String(error)); throw error; }
    } });
  };
  const result = await createGenerationMind(f.options, f.ports)(call(image));
  assert.equal(result.shell.status, 'blocked');
  assert.ok(result.shell.checkpoint);
  assert.deepEqual(attempted, ['auto']); assert.equal(rejected.length, 1); assert.match(rejected[0], /owned tools|tool selection/);
  assert.equal(f.payloads.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.mailbox.length, 0);
});

test('actual worker rejects a bare URI answer without appending any mailbox event', async t => {
  const f = fixture(t), image = candidate('successor'); f.images.set(image.candidate.manifest.id, image);
  const perform = f.ports.performRequest;
  f.ports.performRequest = async (...args) => {
    const result = await perform(...args), body = JSON.parse(result.body);
    const tool = body.choices[0].message.tool_calls[0];
    const event = JSON.parse(tool.function.arguments); event.content.evidence = [evidenceRef.uri];
    tool.function.arguments = JSON.stringify(event);
    return { ...result, body: JSON.stringify(body) };
  };
  const selected: GenerationCall = { ...call(image, 'successor'), phase: 'answer' };
  const result = await createGenerationMind(f.options, f.ports)(selected);
  assert.equal(f.mailbox.length, 0); assert.ok(f.payloads.length > 0);
  assert.ok(f.sources.every(source => (source.arguments as { content: { evidence: unknown[] } }).content.evidence[0] === evidenceRef.uri));
  const checkpoints = [...f.checkpoints.values()] as { messages?: { role: string; isError?: boolean; content: unknown }[] }[];
  assert.ok(checkpoints.some(checkpoint => checkpoint.messages?.some(message => message.role === 'toolResult' && message.isError && /evidence|object/.test(JSON.stringify(message.content)))), 'Rejected citation must remain in the actual native checkpoint');
  assert.equal(result.mailbox.length, 0);
});

test('required mailbox leaves incumbent rejection, successor refusal and observer uncertainty to the actual mind', async t => {
  const f = fixture(t), image = candidate(); f.images.set(image.candidate.manifest.id, image);
  const perform = f.ports.performRequest;
  let judgment: { decision?: string; ready?: boolean } = {};
  f.ports.performRequest = async (...args) => {
    const result = await perform(...args), body = JSON.parse(result.body), tool = body.choices[0].message.tool_calls[0];
    const event = JSON.parse(tool.function.arguments); Object.assign(event.content, judgment);
    tool.function.arguments = JSON.stringify(event); return { ...result, body: JSON.stringify(body) };
  };
  const invoke = createGenerationMind(f.options, f.ports);
  for (const decision of ['reject', 'more']) {
    judgment = { decision };
    const result = await invoke(call(image, 'incumbent', 'verdict'));
    assert.equal(result.shell.status, 'completed'); assert.equal((result.mailbox[0].content as { decision: string }).decision, decision);
  }
  judgment = { ready: false };
  const readiness = await invoke(call(image, 'successor'));
  assert.equal(readiness.shell.status, 'completed'); assert.equal((readiness.mailbox[0].content as { ready: boolean }).ready, false);
  for (const decision of ['regression', 'inconclusive']) {
    judgment = { decision };
    const result = await invoke(call(image, 'observer'));
    assert.equal(result.shell.status, 'completed'); assert.equal((result.mailbox[0].content as { decision: string }).decision, decision);
  }
  assert.equal(f.mailbox.length, 5); assert.equal(f.payloads.length, 5);
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
    const base: ToolCall = { id: 'fake-native', runId: 'incumbent-run', stepId: 'step', name: 'generation_mailbox', arguments: { kind: 'challenge', content: { question: 'invented question', criterion: 'Declared continuity criterion' } } };
    const signal = new AbortController().signal;
    for (const [tool, reason] of [
      [base, /real model source/], [{ ...base, name: 'speech_send' }, /own mailbox/], [{ ...base, runId: 'foreign' }, /Foreign worker/],
      [{ ...base, arguments: { kind: 'ready', content: true } }, /not permitted/],
      [{ ...base, arguments: { kind: 'verdict', content: true, role: 'successor' } }, /not permitted/],
      [{ ...base, arguments: { kind: 'challenge', content: { question: 'x'.repeat(9000), criterion: 'Declared continuity criterion' } } }, /exceeds/],
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
