import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-application-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspaces'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt');
  writeFileSync(promptFile, 'Explicit replaceable fixture instructions: inspect evidence, choose actions, and preserve honest outcomes.');
  writeFileSync(compactionPromptFile, 'Preserve attributed observations, open goals, uncertain effects and provenance.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'engineering-fixture', controlRevision: 'fixture-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 2048, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100,
    commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'restricted', principals: ['operator'] }, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  return { root, config, authorityStore, authority };
}
function tool(name: string, args: unknown) { return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: name.replaceAll('_', '').slice(0, 9), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) }; }
function stop(text: string) { return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) }; }
async function eventually<T>(read: () => T, accept: (value: T) => boolean): Promise<T> { const end = Date.now() + 15000; while (true) { const value = read(); if (accept(value)) return value; if (Date.now() > end) throw new Error(`Condition not reached: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 20)); } }

test('ordinary authenticated conversation uses actual confined tools and explicit output; memory and budgets survive restart', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let calls = 0;
  const performRequest = async (payload: string) => {
    const request = JSON.parse(payload) as { messages: { role: string; content: string }[] };
    assert.equal(payload.includes('private-fixture-key'), false);
    const frame = request.messages.filter(m => m.role === 'user').map(m => { try { return JSON.parse(m.content); } catch { return {}; } }).findLast(m => m.hostContext)?.hostContext;
    assert.ok(frame?.memory.memories.some((memory: { content: { attributedContent: string } }) => memory.content.attributedContent.includes('square')));
    calls++;
    if (calls === 1) return tool('workspace_write', { path: 'square.js', content: 'console.log(6 * 6)', expectedSha256: null });
    if (calls === 2) return tool('command_run', { executable: '/runtime/node', args: ['square.js'] });
    if (calls === 3) {
      assert.ok(request.messages.some(m => m.role === 'tool' && m.content.includes('36')));
      return tool('speech_send', { channel: frame.target.channel, text: 'I ran square.js: 36.', kind: 'message' });
    }
    return stop('Private deliberation is not an automatic conversational output.');
  };
  try {
    app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'private-fixture-key', directToken: 'direct-test' }, performRequest });
    await app.start(); const port = (app.directApi.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/inputs`, { method: 'POST', headers: { authorization: 'Bearer direct-test', 'content-type': 'application/json' }, body: JSON.stringify({ externalId: 'request', revision: '1', conversation: 'coding', text: 'Create square.js and run it.' }) });
    assert.equal(response.status, 202); const admitted = await response.json() as { run: { id: string } };
    await eventually(() => app!.runtime.getRun(admitted.run.id), run => run?.status === 'completed' || run?.status === 'waiting' || run?.status === 'blocked');
    assert.equal(app.runtime.getRun(admitted.run.id)?.status, 'completed', JSON.stringify(app.store.get('execution', admitted.run.id)));
    const output = await fetch(`http://127.0.0.1:${port}/runs/${encodeURIComponent(admitted.run.id)}/output`, { headers: { authorization: 'Bearer direct-test' } });
    assert.equal(output.status, 200); assert.equal((await output.text()).includes('Private deliberation'), false);
    const outputs = app.output(admitted.run.id); assert.equal(outputs.length, 1); assert.match(JSON.stringify(outputs), /I ran square.js: 36/);
    const grants = app.store.get<{ workspace: string }>('host.run-grants', admitted.run.id)!.value;
    assert.equal(readFileSync(join(grants.workspace, 'square.js'), 'utf8'), 'console.log(6 * 6)');
    const used = app.resources.snapshot(admitted.run.id); assert.equal(used.requests, 7); assert.equal(used.tokens, 480);
    const memory = app.memory.context({ audience: f.config.direct.scope, query: 'square', maxRecords: 20, maxBytes: 32768 }); assert.ok(memory.memories.length >= 2);
    await app.close(); app = undefined;
    app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'private-fixture-key', directToken: 'direct-test' }, performRequest });
    assert.equal(app.resources.snapshot(admitted.run.id).requests, used.requests); assert.equal(app.output(admitted.run.id).length, 1);
    assert.ok(app.memory.context({ audience: f.config.direct.scope, query: 'square', maxRecords: 20, maxBytes: 32768 }).memories.length >= 2);
    assert.equal(calls, 4);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});
