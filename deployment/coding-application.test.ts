import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutarkApplication } from './application.ts';
import { validateConfiguration, type ApplicationConfig } from './config.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { CodingInvocation, CodingResult } from '../packages/coding/index.ts';
import type { CodingTurn } from './coding-limb.ts';
import type { Observation, PhysicalRequest } from '../packages/contracts/index.ts';

const nativeSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function fixture(provider?: 'pi') {
  const root = mkdtempSync(join(tmpdir(), 'aeon-coding-application-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspaces'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt');
  writeFileSync(promptFile, 'Fixture continuing mind: use explicit coding and speech actions.'); writeFileSync(compactionPromptFile, 'Retain observations.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath,
    workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'coding-application-fixture', controlRevision: 'coding-fixture-controls', promptFile, compactionPromptFile,
    coding: { ...(provider ? { provider } : {}), timeoutMs: 10000 }, model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none',
      maxOutputTokens: 1024, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources },
    maxConcurrentRuns: 3, pollMs: 100, commands: ['/runtime/node'], researchHosts: [],
    direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'restricted', principals: ['operator'] }, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('coding-application', config.controlRevision, config.artifactId);
  return { root, config, authorityStore, authority };
}
function response(text: string) { return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) }; }

test('Codex configuration accepts only Sol 6.1 while retaining explicit Pi selection', () => {
  const f = fixture();
  try {
    assert.equal(validateConfiguration({ ...f.config, coding: { model: 'gpt-6.1-sol' } }).coding?.model, 'gpt-6.1-sol');
    assert.throws(() => validateConfiguration({ ...f.config, coding: { model: 'different-model' } }), /requires gpt-6.1-sol/);
    assert.equal(validateConfiguration({ ...f.config, coding: { provider: 'pi' } }).coding?.provider, 'pi');
  } finally { f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('exclusive application recovery releases old execution slots while preserving uncertain accounting', async () => {
  const f = fixture(); let app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' } });
  try {
    const root = 'operating-envelope:v1';
    const request: PhysicalRequest = { id: 'old-unknown', runId: root, purpose: 'reasoning', provider: 'mistral', model: f.config.model.id,
      promptManifestId: 'old-prompt', requestDigest: 'a'.repeat(64), reservationId: 'old-unknown', status: 'reserved',
      usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 10 } };
    app.resources.reserve(request); app.resources.dispatched({ ...request, status: 'dispatched' }); app.resources.settle({ ...request, status: 'uncertain' });
    const original = app.store.get('requests', request.id), usage = app.resources.snapshot(root);
    assert.equal(usage.concurrent, 1); await app.close();
    app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' } });
    assert.deepEqual(app.store.get('requests', request.id), original);
    assert.equal(app.resources.snapshot(root).concurrent, 0);
    assert.equal(app.resources.snapshot(root).costUsd, usage.costUsd);
    assert.equal(app.resources.snapshot(root).tokens, usage.tokens);
    assert.equal(app.resources.snapshot(root).requests, usage.requests);
    assert.equal(app.resources.request(request.id)?.status, 'uncertain');
  } finally { await app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});
function tool(id: number, name: string, args: unknown) { return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
  tool_calls: [{ id: String(id).padStart(9, '0'), type: 'function', function: { name, arguments: JSON.stringify(name === 'code' ? { mode: 'edit', target: 'workspace', ...args as object } : args) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) }; }
interface Request { messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }
function context(request: Request): { target?: { channel?: string } } {
  for (const message of request.messages) if (message.role === 'user') { try { const parsed = JSON.parse(message.content); if (parsed.hostContext) return parsed.hostContext; } catch {} }
  return {};
}
function input(app: AutarkApplication, conversation: string, text: string) {
  return app.communications.receive({ source: 'direct', externalId: conversation, revision: '1', conversation, text,
    actor: { id: 'operator', scope: app.config.direct.scope, modificationEligible: true } }).run;
}
async function until(app: AutarkApplication, predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${description}; runs=${JSON.stringify(app.store.list('runs'))}; turns=${JSON.stringify(app.store.list('host.coding-turns'))}; execution=${JSON.stringify(app.store.list('execution'))}`);
    await app.tick(); await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
}
function codexOutput(turn: number): string {
  return [{ type: 'thread.started', thread_id: nativeSessionId }, { type: 'item.completed', item: { id: 'edit', type: 'file_change', changes: [{ path: 'fixture.js', kind: 'update' }] } },
    { type: 'item.completed', item: { id: 'test', type: 'command_execution', command: 'node fixture.js', aggregated_output: String(turn), exit_code: 0, status: 'completed' } },
    { type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: turn === 1 ? 'Implemented it. Which edge case should I cover?' : 'Covered the requested edge case.' } },
    { type: 'turn.completed', usage: { input_tokens: turn === 1 ? 58339 : 89241, cached_input_tokens: turn === 1 ? 1000 : 1500, output_tokens: turn === 1 ? 490 : 894 } }].map(event => JSON.stringify(event)).join('\n');
}

test('ordinary mind delegates to default Codex, remains responsive, and follows up in the same native session', { timeout: 30000 }, async () => {
  const f = fixture(); const invocations: CodingInvocation[] = []; let mindCalls = 0, otherCalls = 0;
  let releaseFirst!: () => void; const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
  let app!: AutarkApplication;
  app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'fixture-no-network', directToken: 'fixture' },
    codingExecutor: async (invocation, signal) => {
      invocations.push(invocation); assert.equal(signal?.aborted, false);
      if (invocations.length === 1) await firstRelease;
      writeFileSync(join(invocation.cwd, 'fixture.js'), `console.log(${invocations.length});\n`);
      return { stdout: codexOutput(invocations.length), stderr: '', elapsedMs: 3, exitCode: 0, signal: null };
    },
    performRequest: async payload => {
      const request = JSON.parse(payload) as Request;
      assert.ok(request.messages.some(message => message.role === 'system' && message.content.includes('Fixture continuing mind')));
      const names = request.tools?.map(item => item.function.name) ?? [];
      assert.ok(names.includes('code')); assert.ok(names.includes('code_status'));
      if (context(request).target?.channel === 'other') { otherCalls++; return response('The mind is responsive while coding is external.'); }
      mindCalls++;
      if (mindCalls === 1) return tool(1, 'code', { message: 'Implement the fixture and ask which edge case to cover.' });
      if (mindCalls === 2 || mindCalls === 5) return response('Awaiting external coding evidence.');
      if (mindCalls === 3 || mindCalls === 6) return tool(mindCalls, 'code_status', {});
      if (mindCalls === 4) {
        assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('command_execution')));
        return tool(4, 'code', { message: 'Cover the zero edge case.', sessionId: app.coding.session()!.id });
      }
      assert.equal(mindCalls, 7); return response('Inspected the second result.');
    } });
  try {
    const run = input(app, 'main', 'Implement a bounded fixture.'); await app.resume(run.id);
    await until(app, () => invocations.length === 1, 'first coding dispatch');
    assert.equal(app.runtime.getRun(run.id)?.status, 'waiting'); assert.equal(mindCalls, 2);
    const other = input(app, 'other', 'Are you available?'); await app.resume(other.id);
    assert.equal(app.runtime.getRun(other.id)?.status, 'completed'); assert.equal(otherCalls, 1);
    assert.equal(invocations.length, 1);
    releaseFirst();
    await until(app, () => app.runtime.getRun(run.id)?.status === 'completed', 'both coding turns and parent completion');
    assert.equal(invocations.length, 2); assert.equal(mindCalls, 7);
    assert.equal(invocations[0]!.args.includes('resume'), false);
    assert.ok(invocations[1]!.args.includes('resume')); assert.ok(invocations[1]!.args.includes(nativeSessionId));
    assert.equal(invocations[1]!.stdin, 'Cover the zero edge case.'); assert.equal(invocations[0]!.cwd, invocations[1]!.cwd);
    assert.equal(readFileSync(join(invocations[1]!.cwd, 'fixture.js'), 'utf8'), 'console.log(2);\n');
    assert.equal(app.store.list('host.coding-sessions').length, 1); assert.equal(app.store.list('host.coding-runs').length, 2, 'one native session has distinct turn accounting units');
    const turns = app.store.list<CodingTurn>('host.coding-turns'); assert.equal(turns.length, 2);
    assert.ok(turns.every(turn => turn.value.status === 'completed' && turn.value.notified));
    // Shell-generated durable call IDs are namespaced; inspect semantic receipts.
    const statuses = app.runtime.observations(run.id).filter(item => item.value && typeof item.value === 'object' && !Array.isArray(item.value) && 'history' in item.value);
    assert.equal(statuses.length, 2); assert.match(JSON.stringify(statuses), /file_change/); assert.match(JSON.stringify(statuses), /command_execution/);
    assert.equal(app.store.list<{ request: { provider: string } }>('requests').filter(row => row.value.request.provider === 'codex-cli').length, 2);
  } finally { releaseFirst(); await app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('explicit Pi coding uses the existing broker and retains its transcript on follow-up', { timeout: 30000 }, async () => {
  const f = fixture('pi'); let app!: AutarkApplication, mindCalls = 0, codingCalls = 0, cliCalls = 0;
  const childPayloads: Request[] = [];
  app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'fixture-no-network', directToken: 'fixture' },
    codingExecutor: async () => { cliCalls++; throw new Error('Pi selection cannot invoke Codex'); },
    performRequest: async payload => {
      const request = JSON.parse(payload) as Request;
      if (request.messages.some(message => message.role === 'system' && message.content.includes('external coding limb'))) {
        childPayloads.push(request); codingCalls++;
        const tools = request.tools?.map(item => item.function.name) ?? [];
        for (const denied of ['code', 'delegation_start', 'speech_send', 'release_submit']) assert.equal(tools.includes(denied), false);
        if (codingCalls === 1) return tool(101, 'workspace_write', { path: 'pi-fixture.js', content: 'console.log(42);\n', expectedSha256: null });
        if (codingCalls === 2) return tool(102, 'command_run', { executable: '/runtime/node', args: ['pi-fixture.js'] });
        if (codingCalls === 3) return response('I wrote pi-fixture.js and observed 42. Which check next?');
        assert.equal(codingCalls, 4);
        assert.ok(request.messages.some(message => message.role === 'assistant' && typeof message.content === 'string' && message.content.includes('Which check next?')));
        assert.ok(request.messages.some(message => message.role === 'user' && message.content.includes('Confirm the existing output')));
        return response('The retained command evidence reports 42.');
      }
      mindCalls++;
      if (mindCalls === 1) return tool(1, 'code', { message: 'Write and run the bounded Pi fixture.' });
      if (mindCalls === 2 || mindCalls === 5) return response('Awaiting coding evidence.');
      if (mindCalls === 3 || mindCalls === 6) return tool(mindCalls, 'code_status', {});
      if (mindCalls === 4) return tool(4, 'code', { message: 'Confirm the existing output.', sessionId: app.coding.session()!.id });
      assert.equal(mindCalls, 7); return response('Observed the retained Pi result.');
    } });
  try {
    const run = input(app, 'pi-main', 'Use the configured coding provider.'); await app.resume(run.id);
    await until(app, () => app.runtime.getRun(run.id)?.status === 'completed', 'Pi follow-up completion');
    assert.equal(cliCalls, 0); assert.equal(codingCalls, 4); assert.equal(mindCalls, 7);
    const session = app.coding.session()!; assert.equal(session.provider, 'pi'); assert.equal(session.nativeSessionId, session.childRunId);
    assert.equal(app.store.list('host.coding-runs').length, 2);
    assert.equal(readFileSync(join(session.workspace, 'pi-fixture.js'), 'utf8'), 'console.log(42);\n');
    const childObservations: Observation[] = app.runtime.observations(session.childRunId!);
    assert.equal(childObservations.length, 2); assert.match(JSON.stringify(childObservations), /42/);
    assert.ok(childPayloads.at(-1)!.messages.length > childPayloads[0]!.messages.length);
    const statuses = app.runtime.observations(run.id).filter(item => item.value && typeof item.value === 'object' && !Array.isArray(item.value) && 'history' in item.value);
    assert.equal(statuses.length, 2); assert.match(JSON.stringify(statuses), /pi-fixture.js/);
  } finally { await app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('a later message in the same conversation reads the retained workspace and resumes the same coding agent', { timeout: 30000 }, async () => {
  const f = fixture(); let app!: AutarkApplication, mindCalls = 0; const invocations: CodingInvocation[] = [];
  const options: ConstructorParameters<typeof AutarkApplication>[0] = { ...f, secrets: { mistralApiKey: 'fixture-no-network', directToken: 'fixture' },
    codingExecutor: async invocation => {
      invocations.push(invocation);
      writeFileSync(join(invocation.cwd, 'fixture.js'), `console.log(${invocations.length});\n`);
      return { exitCode: 0, signal: null, elapsedMs: 3, stderr: '', stdout: codexOutput(invocations.length) };
    },
    performRequest: async payload => {
      mindCalls++; const request = JSON.parse(payload) as Request;
      if (mindCalls === 1) return tool(201, 'code', { message: 'Write the initial fixture.' });
      if (mindCalls === 2 || mindCalls === 3 || mindCalls === 6) return response('The current coding request has been observed.');
      if (mindCalls === 4) return tool(204, 'code_status', {});
      if (mindCalls === 5) {
        assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('Implemented it')), 'new parent must inspect the retained coding evidence');
        return tool(205, 'code', { message: 'Adjust the existing fixture.', sessionId: app.coding.session()!.id });
      }
      if (mindCalls === 7) return tool(207, 'code_status', {});
      assert.equal(mindCalls, 8); return response('Inspected the later coding result.');
    } };
  app = new AutarkApplication(options);
  try {
    const first = input(app, 'persistent-conversation', 'Write the initial fixture.'); await app.resume(first.id);
    await until(app, () => app.runtime.getRun(first.id)?.status === 'completed', 'first parent completion');
    const original = app.coding.session()!; assert.equal(invocations.length, 1);
    assert.equal(original.cumulativeUsage?.inputTokens, 58339);
    await app.close(); app = new AutarkApplication(options);
    assert.deepEqual(app.coding.session()?.cumulativeUsage, original.cumulativeUsage, 'session accounting survives application restart');
    const second = app.communications.receive({ source: 'direct', externalId: 'persistent-conversation-followup', revision: '1', conversation: 'persistent-conversation', text: 'Adjust that existing fixture.',
      actor: { id: 'operator', scope: app.config.direct.scope, modificationEligible: true } }).run;
    assert.notEqual(second.id, first.id); await app.resume(second.id);
    await until(app, () => app.runtime.getRun(second.id)?.status === 'completed', 'later parent completion');
    assert.equal(mindCalls, 8); assert.equal(invocations.length, 2);
    assert.equal(invocations[0]!.cwd, invocations[1]!.cwd); assert.equal(invocations[1]!.cwd, original.workspace);
    assert.ok(invocations[1]!.args.includes('resume')); assert.ok(invocations[1]!.args.includes(nativeSessionId));
    assert.equal(app.coding.session()!.childRunId, original.childRunId); assert.equal(app.store.list('host.coding-sessions').length, 1);
    const requests = app.store.list<{ request: PhysicalRequest }>('requests').map(row => row.value.request).filter(request => request.provider === 'codex-cli');
    assert.equal(requests.length, 2);
    assert.equal(requests.reduce((total, request) => total + request.usage.inputTokens! + request.usage.outputTokens!, 0), 90135, 'each native session token is charged once');
    const lastTurn = app.store.list<CodingTurn>('host.coding-turns').map(row => row.value).sort((a, b) => a.sequence - b.sequence).at(-1)!;
    const lastResult = app.store.readJsonArtifact<CodingResult>(lastTurn.result!);
    assert.equal(lastResult.usage.inputTokens, 30902); assert.equal(lastResult.usage.outputTokens, 404); assert.equal(lastResult.usage.cachedInputTokens, 500);
    assert.equal(lastResult.cumulativeUsage?.inputTokens, 89241); assert.deepEqual(app.coding.session()?.cumulativeUsage, lastResult.cumulativeUsage);
    const read = app.runtime.observations(second.id).find(item => JSON.stringify(item.value).includes('Implemented it'));
    assert.equal(read?.kind, 'result');
    assert.equal(app.runtime.getRun(first.id)?.status, 'completed');
  } finally { await app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});
