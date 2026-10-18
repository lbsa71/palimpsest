import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutarkApplication, type ApplicationOptions } from './application.ts';
import type { ApplicationConfig } from './config.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { identity, type JsonValue } from '../packages/contracts/index.ts';
import type { CodingInvocation } from '../packages/coding/index.ts';

const nativeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'coding-routing-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind'), compactionPromptFile = join(root, 'compact'); writeFileSync(promptFile, 'Continuing mind; delegate code questions.'); writeFileSync(compactionPromptFile, 'Retain facts.');
  const resources = { maxRequests: 100, maxTokens: 10000000, maxCostUsd: 100, maxElapsedMs: 300000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath,
    workerEntrypoint: 'deployment/shell-worker.ts', artifactId: identity('routing-source'), controlRevision: 'routing-controls', promptFile, compactionPromptFile,
    coding: { timeoutMs: 10000 }, model: { id: 'routing-model', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 2, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } },
    resources, conversationResources: resources, bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 4, maxLifetimeSlices: 8, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources },
    maxConcurrentRuns: 3, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'restricted', principals: ['operator'] }, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('routing', config.controlRevision, config.artifactId);
  let snapshots = 0;
  const options: ApplicationOptions = { config, authority, authorityStore, secrets: { mistralApiKey: 'offline', directToken: 'fixture' }, codingSnapshot: async (workspace, path) => {
    snapshots++; mkdirSync(join(workspace, path), { recursive: true }); writeFileSync(join(workspace, path, 'sample.mjs'), 'export const observed = 42;\n');
    return { exitCode: 0, stdout: JSON.stringify({ files: [{ path: 'sample.mjs', sha256: identity('sample') }] }), stderr: '' };
  } };
  return { root, config, options, get snapshots() { return snapshots; }, close() { authorityStore.close(); rmSync(root, { recursive: true, force: true }); } };
}
function answer(text = 'Done.', name?: string, args?: object) { return { status: 200, body: JSON.stringify({ model: 'routing-model', choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: { role: 'assistant', content: name ? null : text,
  ...(name ? { tool_calls: [{ id: '000000001', type: 'function', function: { name, arguments: JSON.stringify(args ?? {}) } }] } : {}) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }) }; }
function native(turn: number) { return [{ type: 'thread.started', thread_id: nativeId }, { type: 'item.completed', item: { type: 'agent_message', text: `Observed sample.mjs:1, constant is 42 (turn ${turn}).` } },
  { type: 'turn.completed', usage: { input_tokens: 100 * turn, cached_input_tokens: 0, output_tokens: 10 * turn } }].map(item => JSON.stringify(item)).join('\n'); }
function input(app: AutarkApplication, id: string) { return app.communications.receive({ source: 'direct', externalId: id, revision: '1', conversation: id, text: 'Explain the code.', actor: { id: 'operator', scope: app.config.direct.scope, modificationEligible: true } }).run; }
async function until(app: AutarkApplication, done: () => boolean) { const deadline = Date.now() + 15000; while (!done()) { assert.ok(Date.now() < deadline, JSON.stringify(app.store.list('runs'))); await app.tick(); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('code questions default to inspect/source, prepare once, and expose no direct repository capabilities', { timeout: 30000 }, async () => {
  const f = fixture(); let calls = 0; const invocations: CodingInvocation[] = [];
  const app = new AutarkApplication({ ...f.options,
    additionalTools: () => [{ name: 'source_checkout', description: 'forbidden direct source access', inputSchema: {}, execute() { throw Error('Must never enter'); } }],
    codingExecutor: async invocation => { invocations.push(invocation); assert.equal(invocation.mode, 'inspect'); assert.match(invocation.stdin, /sample\.mjs|accepted source|Accepted source/i); return { exitCode: 0, signal: null, elapsedMs: 1, stderr: '', stdout: native(1) }; },
    performRequest: async payload => {
      const request = JSON.parse(payload), names = request.tools.map((tool: any) => tool.function.name);
      for (const name of names) assert.ok(!name.startsWith('workspace_') && !name.startsWith('source_') && name !== 'command_run', name);
      assert.ok(names.includes('memory_retrieve')); assert.ok(names.includes('code')); assert.ok(names.includes('speech_send'));
      calls++; if (calls === 1) return answer('', 'code', { message: 'Explain sample.mjs with line references.' });
      if (calls === 2) { assert.equal(invocations.length, 1, 'native work must begin before another mind inference'); return answer('', 'code_status'); }
      assert.ok(payload.includes('sample.mjs:1')); return answer('The inspected constant is 42.');
    } });
  try {
    const run = input(app, 'question'); await app.resume(run.id); assert.equal(calls, 1, 'code enqueue must hand off without another paid mind request'); await until(app, () => app.runtime.getRun(run.id)?.status === 'completed');
    assert.equal(f.snapshots, 1); assert.equal(invocations.length, 1); assert.ok(invocations[0]!.args.includes('read-only'));
    const session = app.coding.session()!, source = join(session.workspace, 'repositories', f.config.artifactId, 'sample.mjs');
    assert.equal(readFileSync(source, 'utf8'), 'export const observed = 42;\n');
    for (const kind of ['workspace_read', 'workspace.read', 'command_run', 'command.run', 'source_checkout', 'source_check']) {
      const id = `forged:${kind}`; app.effects.create({ id, runId: run.id, stepId: id, kind, payload: { path: 'sample.mjs' }, scope: run.scope, authority: run.authority, status: 'pending', revision: 0 });
      app.effects.authorize(id, id, run.authority); const effect = await app.effects.dispatch(id, run.authority);
      assert.equal(effect.status, 'failed', `stale or forged ${kind} must be denied by the receiver`);
    }
  } finally { await app.close(); f.close(); }
});

test('new restricted threads reuse one native agent with current per-turn grants and retain cancelled old allocations', { timeout: 30000 }, async () => {
  const f = fixture(), invocations: CodingInvocation[] = []; const phases = new Map<string, number>();
  const app = new AutarkApplication({ ...f.options, codingExecutor: async invocation => { invocations.push(invocation); return { exitCode: 0, signal: null, elapsedMs: 1, stderr: '', stdout: native(invocations.length) }; },
    performRequest: async payload => {
      const request = JSON.parse(payload), frame = request.messages.find((item: any) => item.role === 'user' && typeof item.content === 'string' && item.content.includes('hostContext'));
      const id = JSON.parse(frame.content).hostContext.runId, phase = (phases.get(id) ?? 0) + 1; phases.set(id, phase);
      return phase === 1 ? answer('', 'code', { message: 'Explain sample.mjs.' }) : answer('Observed the code result.');
    } });
  try {
    const first = input(app, 'first-thread'); await app.resume(first.id); await until(app, () => app.runtime.getRun(first.id)?.status === 'completed');
    const session = structuredClone(app.coding.session()!); app.resources.cancel(first.id);
    const oldAllocation = app.store.get('allocations', first.id)!, oldChild = app.store.get('allocations', session.childRunId!)!;
    const second = input(app, 'second-thread'); await app.resume(second.id); await until(app, () => app.runtime.getRun(second.id)?.status === 'completed');
    assert.equal(invocations.length, 2); assert.ok(invocations[1]!.args.includes(nativeId)); assert.ok(invocations[1]!.args.includes('resume'));
    assert.equal(invocations[0]!.cwd, invocations[1]!.cwd); assert.equal(f.snapshots, 1); assert.equal(app.store.list('host.coding-sessions').length, 1);
    assert.equal(app.coding.session()!.id, session.id); assert.equal(app.coding.session()!.childRunId, session.childRunId);
    assert.deepEqual(app.store.get('allocations', first.id), oldAllocation); assert.deepEqual(app.store.get('allocations', session.childRunId!), oldChild);
    const requests = app.store.list<{ request: { provider: string; runId: string } }>('requests').map(row => row.value.request).filter(item => item.provider === 'codex-cli');
    assert.equal(requests.length, 2); assert.notEqual(requests[0]!.runId, requests[1]!.runId);
    assert.equal(app.store.get<{ parentRunId: string }>('allocations', requests[1]!.runId)!.value.parentRunId, second.id);
  } finally { await app.close(); f.close(); }
});

test('a successful model slice automatically continues without repeating tools or renewing its allocation', { timeout: 30000 }, async () => {
  const f = fixture(); let calls = 0;
  const app = new AutarkApplication({ ...f.options, performRequest: async () => { calls++; return calls <= 2 ? answer('', 'initiative_agenda') : answer('Finished after a known slice boundary.'); } });
  try {
    const run = input(app, 'slice'), before = app.store.get<any>('allocations', run.id)!.value;
    await app.resume(run.id); await until(app, () => app.runtime.getRun(run.id)?.status === 'completed');
    assert.equal(calls, 3); assert.equal(app.runtime.observations(run.id).length, 2);
    const after = app.store.get<any>('allocations', run.id)!.value; assert.equal(after.startedAt, before.startedAt); assert.deepEqual(after.envelope, before.envelope);
    assert.equal(app.store.list<{ request: { provider: string; status: string } }>('requests').filter(row => row.value.request.provider === 'mistral').every(row => row.value.request.status === 'succeeded'), true);
  } finally { await app.close(); f.close(); }
});

test('coding turns queue across restricted threads and never start a second native agent in parallel', { timeout: 30000 }, async () => {
  const f = fixture(), invocations: CodingInvocation[] = [], phases = new Map<string, number>();
  let release!: () => void, active = 0, maximum = 0;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const app = new AutarkApplication({ ...f.options, codingExecutor: async invocation => {
    invocations.push(invocation); const sequence = invocations.length; active++; maximum = Math.max(maximum, active);
    if (sequence === 1) await barrier;
    active--; return { exitCode: 0, signal: null, elapsedMs: 1, stderr: '', stdout: native(sequence) };
  }, performRequest: async payload => {
    const request = JSON.parse(payload), frame = request.messages.find((item: any) => item.role === 'user' && typeof item.content === 'string' && item.content.includes('hostContext'));
    const id = JSON.parse(frame.content).hostContext.runId, phase = (phases.get(id) ?? 0) + 1; phases.set(id, phase);
    return phase === 1 ? answer('', 'code', { message: 'Explain sample.mjs.' }) : answer('Observed the code result.');
  } });
  try {
    const first = input(app, 'queued-one'); await app.resume(first.id); await until(app, () => invocations.length === 1);
    const second = input(app, 'queued-two'); await app.resume(second.id);
    assert.equal(invocations.length, 1); assert.equal(app.store.list<any>('host.coding-turns').filter(row => row.value.status === 'queued').length, 1);
    release(); await until(app, () => app.runtime.getRun(first.id)?.status === 'completed' && app.runtime.getRun(second.id)?.status === 'completed');
    assert.equal(invocations.length, 2); assert.equal(maximum, 1); assert.equal(f.snapshots, 1);
    assert.equal(invocations.filter(invocation => !invocation.args.includes('resume')).length, 1);
    assert.ok(invocations[1]!.args.includes(nativeId)); assert.equal(app.store.list('host.coding-sessions').length, 1);
  } finally { release(); await app.close(); f.close(); }
});

test('Slack status and cancel controls deliver once without model inference, including after cancellation', async () => {
  const f = fixture(); f.config.slack = { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope: f.config.direct.scope }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true };
  let posts = 0, inference = 0; const texts: string[] = [];
  const api = { async call<T>(method: string, args: Record<string, string>): Promise<T> { if (method === 'chat.postMessage') { posts++; texts.push(args.text!); assert.equal(args.thread_ts, '10.001'); return { channel: 'C1', ts: `${20 + posts}.001` } as T; } return {} as T; } };
  const app = new AutarkApplication({ ...f.options, secrets: { directToken: 'fixture' }, slackBotApi: api, slackAppApi: api, performRequest: async () => { inference++; throw Error('Status cannot invoke a model'); } });
  try {
    const first = app.slackIngress!.acceptHistory('C1', { ts: '10.001', user: 'U1', text: '<@BOT> hello' })!; await new Promise(resolve => setImmediate(resolve));
    const status = { ts: '11.001', thread_ts: '10.001', user: 'U1', text: 'status' };
    app.slackIngress!.acceptHistory('C1', status); await app.tick(); assert.equal(posts, 1); assert.match(texts[0]!, /queued/);
    app.slackIngress!.acceptHistory('C1', status); await app.tick(); assert.equal(posts, 1);
    app.slackIngress!.acceptHistory('C1', { ts: '12.001', thread_ts: '10.001', user: 'U1', text: 'cancel' }); await app.tick(); assert.equal(posts, 2); assert.match(texts[1]!, /cancelled/);
    app.slackIngress!.acceptHistory('C1', { ts: '13.001', thread_ts: '10.001', user: 'U1', text: 'status' }); await app.tick(); assert.equal(posts, 3); assert.match(texts[2]!, /cancelled/);
    assert.equal(app.runtime.getRun(first.run.id)?.status, 'cancelled'); assert.equal(inference, 0);
    assert.ok(app.store.list<{ request: { runId: string } }>('requests').filter(row => row.key.startsWith('host:slack-control:')).every(row => row.value.request.runId === 'operating-envelope:v1'));
  } finally { await app.close(); f.close(); }
});
