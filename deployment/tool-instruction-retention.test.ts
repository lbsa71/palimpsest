import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { digest } from '../packages/agent-shell/mistral.ts';
import { identity, type ArtifactRef, type JsonValue, type PhysicalRequest, type PromptFragment, type PromptManifest, type ShellBridge, type ShellCheckpoint, type ShellInput } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import type { WorkerOptions } from '../packages/supervisor/worker-process.ts';

const enabled = process.execArgv.includes('--experimental-test-module-mocks');
let worker: (options: WorkerOptions) => Promise<JsonValue> = async () => { throw Error('Missing worker fixture'); };
if (enabled) mock.module('../packages/supervisor/worker-process.ts', { namedExports: { runWorker: (options: WorkerOptions) => worker(options) } });
const { createBrokerShell } = await import('./broker-shell.ts');
const tool = { description: 'Inspect exact retained source v1', name: 'inspect', parameters: { properties: { z: { type: 'string' }, a: { type: 'string' } }, type: 'object' } };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-tool-retention-')), filename = join(root, 'state.sqlite');
  let store = new OperationalStore({ filename });
  const base: PromptFragment = { id: 'base', owner: 'application', role: 'system', order: 0, artifact: store.putArtifact('Owned base'), scope: { kind: 'public' }, replaceable: true, derivedFrom: [] };
  const compact: PromptFragment = { ...base, id: 'compact', artifact: store.putArtifact('Owned compaction') };
  const captures: { manifest: PromptManifest; payload: string }[] = [];
  let workers = 0, fetches = 0, reservations = 0;
  const refuse = async (): Promise<never> => { throw Error('Unexpected tool effect'); };
  const bridge: ShellBridge = { execute: refuse,
    async persistCheckpoint(runId, revision, shell, content) { return { runId, revision, shell, artifact: store.putJsonArtifact(content), observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(checkpoint) { return store.readJsonArtifact(checkpoint.artifact); },
    async capturePrompt(manifest, payload) { for (const fragment of manifest.fragments) store.readArtifact(fragment.artifact); captures.push({ manifest, payload }); },
    async reserve() { reservations++; }, async dispatched() {}, async settle() {} };
  const input = (id = 'parent', checkpoint?: ShellCheckpoint): ShellInput => ({ run: { id, status: 'running', revision: 1, ...(id === 'child' ? { parentRunId: 'parent' } : {}), authority: { generation: 'fixture', epoch: 1, controlRevision: 'controls' }, scope: { kind: 'public' } }, prompt: { id: 'owned', requestDigest: digest('pending'), fragments: [base] }, messages: [{ role: 'user', content: 'Observe', timestamp: 1 }], ...(checkpoint ? { checkpoint } : {}) });
  const shell = (tools = [tool], compaction = false, retain = (source: string) => store.putArtifact(source)) => createBrokerShell({
    applicationRoot: root, entrypoint: 'unused.js', workspace: () => root, protectedPaths: [], nodeBinary: process.execPath, timeoutMs: 5000, maxPayloadBytes: 100000, pricesPerMillion: { input: 1, output: 2 },
    worker: { model: 'fixture-v1', maxRequests: 8, tools, ...(compaction ? { compaction: { thresholdMessages: 5, retainMessages: 1, instruction: compact } } : {}) },
    retainToolInstructions: retain, resolveFragment: async fragment => Buffer.from(store.readArtifact(fragment.artifact)).toString('utf8'), assertAuthority() {}, recordTransport() {},
    async performRequest() { fetches++; return { status: 200, body: JSON.stringify({ model: 'fixture-v1', choices: [{ finish_reason: 'stop', message: { content: 'Observed fixture' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }; } });
  const rpc = (options: WorkerOptions) => (method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], new AbortController().signal);
  worker = async options => {
    workers++;
    const start = options.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
    const call = rpc(options);
    const shell = createAgentShell({ ...start.options, apiKey: () => 'fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256], fetch: async (_url, init) => { const response = await call('provider.fetch', init!.body) as { status: number; body: string }; return new Response(response.body, { status: response.status }); } });
    const remote: ShellBridge = { execute: call => rpc(options)('execute', call) as any, persistCheckpoint: (...args) => call('persistCheckpoint', ...args) as any, readCheckpoint: (...args) => call('readCheckpoint', ...args), capturePrompt: async (...args) => { await call('capturePrompt', ...args); }, reserve: async (...args) => { await call('reserve', ...args); }, dispatched: async (...args) => { await call('dispatched', ...args); }, settle: async (...args) => { await call('settle', ...args); } };
    return await shell.run(start.input, remote) as unknown as JsonValue;
  };
  return { input, shell, bridge, captures, base, compact, rpc, get store() { return store; }, counts: () => ({ workers, fetches, reservations }), reopen() { store.close(); store = new OperationalStore({ filename }); }, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('exact source resolves after reopen for changed tools, resumed and child requests; compaction retains its actual empty surface', { skip: !enabled }, async () => {
  const f = fixture();
  try {
    const first = await f.shell().run(f.input(), f.bridge); assert.equal(first.status, 'completed');
    const source1 = JSON.stringify([tool]); assert.notEqual(digest(source1), identity([tool]), 'fixture must distinguish exact serializer from canonical JSON');
    const ref1 = f.captures[0].manifest.fragments.at(-1)!.artifact;
    assert.equal(Buffer.from(f.store.readArtifact(ref1)).toString(), source1);
    f.reopen();
    const tools2 = [{ ...tool, description: 'Inspect exact retained source v2' }];
    const resumed = await f.shell(tools2).run(f.input('parent', first.checkpoint), f.bridge); assert.equal(resumed.status, 'completed');
    const ref2 = f.captures[1].manifest.fragments.at(-1)!.artifact; assert.notEqual(ref2.sha256, ref1.sha256);
    assert.equal((await f.shell(tools2).run(f.input('child'), f.bridge)).status, 'completed');
    assert.deepEqual(f.captures[2].manifest.fragments.at(-1)!.artifact, ref2);
    const compacted = f.input(); compacted.messages = Array.from({ length: 7 }, (_, timestamp) => ({ role: 'user', content: `Retained detail ${timestamp}`, timestamp }));
    assert.equal((await f.shell(tools2, true).run(compacted, f.bridge)).status, 'completed');
    const summary = f.captures.find(c => c.manifest.fragments.some(fragment => fragment.id === 'compact'))!;
    assert.equal(JSON.parse(summary.payload).tools, undefined); assert.equal(Buffer.from(f.store.readArtifact(summary.manifest.fragments.at(-1)!.artifact)).toString(), '[]');
    assert.deepEqual(f.captures.at(-1)!.manifest.fragments.at(-1)!.artifact, ref2);
    f.reopen();
    for (const capture of f.captures) for (const fragment of capture.manifest.fragments) assert.equal(digest(Buffer.from(f.store.readArtifact(fragment.artifact)).toString()), fragment.artifact.sha256);
    assert.equal(Buffer.from(f.store.readArtifact(ref1)).toString(), source1); assert.equal(Buffer.from(f.store.readArtifact(ref2)).toString(), JSON.stringify(tools2));
    assert.deepEqual(f.counts(), { workers: 4, fetches: 5, reservations: 5 });
  } finally { f.close(); }
});

for (const scenario of ['foreign-uri', 'other-source', 'missing-bytes'] as const) test(`host refuses ${scenario} before worker, capture, reservation or fetch`, { skip: !enabled }, async () => {
  const f = fixture();
  try {
    const retain = (source: string): ArtifactRef => scenario === 'other-source' ? f.store.putArtifact('[]') : { uri: `${scenario === 'foreign-uri' ? 'shell:tools' : 'aeon:artifact'}:${digest(source)}`, sha256: digest(source) };
    await assert.rejects(f.shell([tool], false, retain).run(f.input(), f.bridge), /Host retained another|missing artifact/);
    assert.deepEqual(f.counts(), { workers: 0, fetches: 0, reservations: 0 }); assert.equal(f.captures.length, 0);
  } finally { f.close(); }
});

for (const scenario of ['borrowed-artifact', 'forged-source', 'wrong-purpose', 'compaction-borrows-tools'] as const) test(`worker cannot use ${scenario} to evade host provenance`, { skip: !enabled }, async () => {
  const f = fixture();
  try {
    worker = async options => {
      const start = options.initial as unknown as { input: ShellInput; options: ShellOptions };
      const rpc = f.rpc(options), compaction = scenario === 'compaction-borrows-tools';
      const instructions = compaction ? [...start.input.prompt.fragments, { ...f.compact, order: 1 }] : start.input.prompt.fragments;
      const artifact = scenario === 'borrowed-artifact' ? f.base.artifact : scenario === 'forged-source' ? f.store.putArtifact(JSON.stringify([{ ...tool, description: 'Forged' }])) : start.options.toolInstructions.tools;
      const fragment: PromptFragment = { id: 'shell.tools', owner: 'tool', role: 'tool', order: instructions.length, artifact, scope: start.input.run.scope, replaceable: true, derivedFrom: [] };
      const payload = JSON.stringify({ model: 'fixture-v1', messages: [{ role: 'system', content: compaction ? 'Owned base\n\nOwned compaction' : 'Owned base' }], ...(compaction ? {} : { tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }], tool_choice: 'auto' }), stream: false, max_tokens: 4096 });
      const manifest: PromptManifest = { id: 'forged', fragments: [...instructions, fragment], requestDigest: digest(payload) };
      if (scenario === 'wrong-purpose') {
        await rpc('capturePrompt', manifest, payload);
        const request: PhysicalRequest = { id: 'wrong', runId: 'parent', provider: 'mistral', model: 'fixture-v1', purpose: 'compaction', promptManifestId: manifest.id, requestDigest: manifest.requestDigest, reservationId: 'wrong', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
        await assert.rejects(rpc('reserve', request), /purpose changed/);
      } else await assert.rejects(rpc('capturePrompt', manifest, payload), /owned prompt provenance/);
      return { status: 'blocked', observations: [] };
    };
    assert.equal((await f.shell([tool], true).run(f.input(), f.bridge)).status, 'blocked');
    assert.equal(f.counts().fetches, 0); assert.equal(f.counts().reservations, 0); assert.equal(f.captures.length, scenario === 'wrong-purpose' ? 1 : 0);
  } finally { f.close(); }
});
