import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { digest } from '../packages/agent-shell/mistral.ts';
import { canonicalJson, identity, type JsonValue, type PhysicalRequest, type PromptFragment, type PromptManifest, type ShellBridge, type ShellCheckpoint, type ShellInput } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import type { WorkerOptions } from '../packages/supervisor/worker-process.ts';
import type { BrokerShellOptions } from './broker-shell.ts';

const enabled = process.execArgv.includes('--experimental-test-module-mocks');
let run: (options: WorkerOptions) => Promise<JsonValue> = async () => { throw Error('Review worker not configured'); };
if (enabled) mock.module('../packages/supervisor/worker-process.ts', { namedExports: { runWorker: (options: WorkerOptions) => run(options) } });
const { createBrokerShell } = await import('./broker-shell.ts');
const sourceTools = () => [{ description: 'Read café\nsource exactly', parameters: { properties: { z: { type: 'string' }, a: { type: 'string' } }, type: 'object' }, name: 'inspect' }];
type Start = { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
const rpc = (options: WorkerOptions) => (method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], new AbortController().signal);

function fixture(provider: 'mistral' | 'openai' = 'mistral') {
  const evidence = process.env.AEON_TOOL_REVIEW_EVIDENCE;
  const root = mkdtempSync(join(evidence ?? tmpdir(), 'tool-review-')), filename = join(root, 'state.sqlite');
  let store = new OperationalStore({ filename });
  const base: PromptFragment = { id: 'base', owner: 'application', role: 'system', order: 0, artifact: store.putArtifact('Owned base'), scope: { kind: 'public' }, replaceable: true, derivedFrom: [] };
  const summary: PromptFragment = { ...base, id: 'summary', artifact: store.putArtifact('Owned summary') };
  const input: ShellInput = { run: { id: 'review', revision: 1, status: 'running', authority: { generation: 'fixture', epoch: 1, controlRevision: 'controls' }, scope: { kind: 'public' } }, prompt: { id: 'base', requestDigest: digest('pending'), fragments: [base] }, messages: [{ role: 'user', timestamp: 0, content: 'Proceed' }] };
  const captures: { manifest: PromptManifest; payload: string }[] = [], requests: PhysicalRequest[] = [];
  const counts = { workers: 0, retain: 0, reserve: 0, dispatch: 0, fetch: 0 };
  const refuse = async (): Promise<never> => { throw Error('Unexpected effect'); };
  const bridge: ShellBridge = { execute: refuse,
    async persistCheckpoint(runId, revision, shell, content) { return { runId, revision, shell, artifact: store.putJsonArtifact(content), observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(checkpoint) { return store.readJsonArtifact(checkpoint.artifact); },
    async capturePrompt(manifest, payload) { captures.push({ manifest, payload }); store.put('review-prompts', manifest.id, { manifest, payload }, null); },
    async reserve(request) { counts.reserve++; requests.push(request); }, async dispatched() { counts.dispatch++; }, async settle() {} };
  const options: BrokerShellOptions = { applicationRoot: root, entrypoint: 'unused.js', workspace: () => root, protectedPaths: [], nodeBinary: process.execPath, timeoutMs: 5000, maxPayloadBytes: 100000, pricesPerMillion: { input: 1, output: 2 },
    worker: { provider, model: 'review-v1', maxRequests: 4, tools: sourceTools(), compaction: { thresholdMessages: 5, retainMessages: 1, instruction: summary } },
    retainToolInstructions(source) { counts.retain++; return store.putArtifact(source); },
    async resolveFragment(fragment) { return Buffer.from(store.readArtifact(fragment.artifact)).toString('utf8'); }, assertAuthority() {}, recordTransport() {},
    async performRequest() { counts.fetch++; return { status: 200, body: JSON.stringify(provider === 'mistral' ? { model: 'review-v1', choices: [{ finish_reason: 'stop', message: { content: 'Retained' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } } : { id: 'response', status: 'completed', model: 'review-v1', output: [{ type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Retained', annotations: [] }] }], usage: { input_tokens: 2, output_tokens: 1 } }) }; } };
  async function actualWorker(options: WorkerOptions): Promise<JsonValue> {
    counts.workers++;
    const start = options.initial as unknown as Start, call = rpc(options);
    // The worker is entered only after both original artifacts are readable.
    for (const artifact of Object.values(start.options.toolInstructions)) store.readArtifact(artifact);
    const shell = createAgentShell({ ...start.options, apiKey: () => 'fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256], fetch: async (_url, init) => { const response = await call('provider.fetch', init!.body) as { status: number; body: string }; return new Response(response.body, { status: response.status }); } });
    const remote: ShellBridge = { execute: refuse, async persistCheckpoint(...args) { return await call('persistCheckpoint', ...args) as unknown as ShellCheckpoint; }, async readCheckpoint(...args) { return call('readCheckpoint', ...args); },
      async capturePrompt(...args) { await call('capturePrompt', ...args); }, async reserve(...args) { await call('reserve', ...args); }, async dispatched(...args) { await call('dispatched', ...args); }, async settle(...args) { await call('settle', ...args); } };
    return await shell.run(start.input, remote) as unknown as JsonValue;
  }
  run = actualWorker;
  return { options, input, summary, bridge, counts, captures, requests, get store() { return store; }, reopen() { store.close(); store = new OperationalStore({ filename }); }, close() { store.close(); if (!evidence) rmSync(root, { recursive: true, force: true }); } };
}

for (const provider of ['mistral', 'openai'] as const) test(`${provider}: host snapshot survives asynchronous nested configuration mutation and original bytes reopen`, { skip: !enabled }, async () => {
  const f = fixture(provider), original = JSON.stringify(f.options.worker.tools);
  try {
    assert.notEqual(digest(original), identity(f.options.worker.tools));
    const resolve = f.options.resolveFragment;
    f.options.resolveFragment = async fragment => {
      await Promise.resolve();
      f.options.worker.tools[0].description = 'Later mutation';
      (f.options.worker.tools[0].parameters as ReturnType<typeof sourceTools>[number]['parameters']).properties.z.type = 'boolean';
      f.options.worker.compaction!.instruction.artifact = f.store.putArtifact('Later summary');
      return resolve(fragment);
    };
    f.input.messages = Array.from({ length: 7 }, (_, timestamp) => ({ role: 'user', content: `Detail ${timestamp}`, timestamp }));
    assert.equal((await createBrokerShell(f.options).run(f.input, f.bridge)).status, 'completed');
    assert.deepEqual(f.counts, { workers: 1, retain: 2, reserve: 2, dispatch: 2, fetch: 2 });
    assert.deepEqual(f.requests.map(request => request.purpose), ['compaction', 'reasoning']);
    f.reopen();
    for (const [index, capture] of f.captures.entries()) {
      const fragment = capture.manifest.fragments.at(-1)!, expected = index === 0 ? '[]' : original;
      assert.equal(Buffer.from(f.store.readArtifact(fragment.artifact)).toString('utf8'), expected);
      assert.equal(fragment.artifact.sha256, digest(expected)); assert.equal(fragment.artifact.uri, `aeon:artifact:${digest(expected)}`);
      assert.deepEqual(fragment.scope, { kind: 'public' });
      const payload = JSON.parse(capture.payload);
      const tools = JSON.parse(expected) as ReturnType<typeof sourceTools>;
      const projection = tools.map(tool => provider === 'mistral' ? { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } } : { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false });
      assert.deepEqual(payload.tools ?? [], projection);
      assert.match(provider === 'mistral' ? payload.messages[0].content : payload.instructions, index === 0 ? /Owned summary$/ : /^Owned base$/);
    }
    assert.throws(() => f.store.readArtifact({ uri: `shell:tools:${digest(original)}`, sha256: digest(original) }), /foreign artifact URI/);
  } finally { f.close(); }
});

for (const scenario of ['canonical-resolver', 'throwing-retainer', 'restricted-base'] as const) test(`host fails before worker for ${scenario}`, { skip: !enabled }, async () => {
  const f = fixture();
  try {
    if (scenario === 'throwing-retainer') f.options.retainToolInstructions = () => { throw Error('Retention unavailable'); };
    if (scenario === 'canonical-resolver') { const resolve = f.options.resolveFragment; f.options.resolveFragment = async fragment => fragment.id === 'shell.tools' ? canonicalJson(sourceTools()) : resolve(fragment); }
    if (scenario === 'restricted-base') f.input.prompt.fragments[0].scope = { kind: 'restricted', principals: ['alice'] };
    await assert.rejects(createBrokerShell(f.options).run(f.input, f.bridge), /artifact is unavailable or changed|Retention unavailable|audience mismatch/);
    assert.equal(f.counts.workers, 0); assert.equal(f.counts.reserve, 0); assert.equal(f.counts.dispatch, 0); assert.equal(f.counts.fetch, 0); assert.equal(f.captures.length, 0);
  } finally { f.close(); }
});

for (const scenario of ['scope', 'derivation', 'uri', 'payload-description', 'reverse-purpose'] as const) test(`host rejects worker ${scenario} mutation before reservation`, { skip: !enabled }, async () => {
  const f = fixture();
  try {
    f.input.run.scope = { kind: 'restricted', principals: ['alice'] };
    run = async options => {
      f.counts.workers++;
      const start = options.initial as unknown as Start, call = rpc(options), compact = scenario === 'reverse-purpose';
      const instructions = compact ? [...start.input.prompt.fragments, { ...f.summary, order: 1 }] : start.input.prompt.fragments;
      const fragment: PromptFragment = { id: 'shell.tools', owner: 'tool', role: 'tool', order: instructions.length, artifact: compact ? start.options.toolInstructions.compaction! : start.options.toolInstructions.tools, scope: start.input.run.scope, replaceable: true, derivedFrom: [] };
      if (scenario === 'scope') fragment.scope = { kind: 'public' };
      if (scenario === 'derivation') fragment.derivedFrom = [f.summary.artifact.sha256];
      if (scenario === 'uri') fragment.artifact = { ...fragment.artifact, uri: `shell:tools:${fragment.artifact.sha256}` };
      const payload = JSON.stringify({ model: 'review-v1', messages: [{ role: 'system', content: compact ? 'Owned base\n\nOwned summary' : 'Owned base' }], ...(compact ? {} : { tools: sourceTools().map(tool => ({ type: 'function', function: { ...tool, ...(scenario === 'payload-description' ? { description: 'Unowned instruction' } : {}) } })), tool_choice: 'auto' }), stream: false, max_tokens: 4096 });
      const manifest: PromptManifest = { id: 'review-capture', fragments: [...instructions, fragment], requestDigest: digest(payload) };
      if (compact) {
        await call('capturePrompt', manifest, payload);
        const request: PhysicalRequest = { id: 'wrong-purpose', runId: start.input.run.id, provider: 'mistral', model: 'review-v1', purpose: 'reasoning', promptManifestId: manifest.id, requestDigest: digest(payload), reservationId: 'wrong-purpose', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
        await assert.rejects(call('reserve', request), /purpose changed instruction surface/);
      } else await assert.rejects(call('capturePrompt', manifest, payload), /owned prompt provenance|changed owned tools/);
      return { status: 'blocked', observations: [] };
    };
    assert.equal((await createBrokerShell(f.options).run(f.input, f.bridge)).status, 'blocked');
    assert.equal(f.counts.workers, 1); assert.equal(f.counts.reserve, 0); assert.equal(f.counts.dispatch, 0); assert.equal(f.counts.fetch, 0);
    assert.equal(f.captures.length, scenario === 'reverse-purpose' ? 1 : 0);
  } finally { f.close(); }
});

for (const scenario of ['omitted-tools', 'omitted-compaction', 'canonical-bytes', 'foreign-uri'] as const) test(`direct shell has no retention fallback for ${scenario}`, { skip: !enabled }, async () => {
  const f = fixture();
  try {
    const toolInstructions: ShellOptions['toolInstructions'] = { tools: f.store.putArtifact(JSON.stringify(f.options.worker.tools)), compaction: f.store.putArtifact('[]') };
    if (scenario === 'omitted-compaction') { delete toolInstructions.compaction; f.input.messages = Array.from({ length: 7 }, (_, timestamp) => ({ role: 'user', timestamp, content: 'Compact this' })); }
    if (scenario === 'foreign-uri') toolInstructions.tools.uri = `shell:tools:${toolInstructions.tools.sha256}`;
    const shell = createAgentShell({ ...f.options.worker, toolInstructions: scenario === 'omitted-tools' ? undefined as unknown as ShellOptions['toolInstructions'] : toolInstructions, apiKey: () => 'fixture',
      async resolveFragment(fragment) { return scenario === 'canonical-bytes' && fragment.id === 'shell.tools' ? canonicalJson(f.options.worker.tools) : f.options.resolveFragment(fragment); },
      async fetch() { f.counts.fetch++; throw Error('Unexpected dispatch'); } });
    assert.equal((await shell.run(f.input, f.bridge)).status, 'blocked');
    assert.equal(f.captures.length, 0); assert.equal(f.counts.reserve, 0); assert.equal(f.counts.dispatch, 0); assert.equal(f.counts.fetch, 0);
  } finally { f.close(); }
});
