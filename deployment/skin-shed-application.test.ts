import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { identity, type ArtifactRef, type JsonValue, type PhysicalRequest, type Run, type ShellBridge, type ShellInput } from '../packages/contracts/index.ts';
import { ChangeProposals } from '../packages/release/proposals.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication, type ApplicationOptions } from './application.ts';
import type { ApplicationConfig } from './config.ts';
import { ordinaryServiceTools } from './evolution-mailbox.ts';
import { controlActivationAcknowledgmentPending, controlActivationId } from './control-tools.ts';
import type { ControlContinuationRecord } from './control-continuation.ts';
import { enqueueSuccessionProbe, readSuccessionProbe, type SuccessionProbeRequest } from './succession-probe.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
function response(name?: string, args: object = {}) { return { status: 200, body: JSON.stringify({ model: 'actual-configured-fixture', choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: { role: 'assistant', content: name ? null : 'Controlled private reasoning completed.', ...(name ? { tool_calls: [{ id: 'actual-call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : {}) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }) }; }
interface Payload { model: string; messages: { role: string; content: string }[]; tools: { function: { name: string } }[] }
function frame(payload: Payload): { runId: string; target?: { channel: string; threadTs?: string } } {
  return payload.messages.filter(message => message.role === 'user').map(message => { try { return JSON.parse(message.content); } catch { return {}; } }).findLast(value => value.hostContext)?.hostContext;
}
function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-shed-app-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind'), compactionPromptFile = join(root, 'compaction'); writeFileSync(promptFile, 'Configured serving reasoning fixture: inspect actual host context.'); writeFileSync(compactionPromptFile, 'Preserve attributed history.');
  const resources = { maxRequests: 200, maxTokens: 10000000, maxCostUsd: 100, maxElapsedMs: 300000, maxConcurrency: 8 };
  const scope = { kind: 'restricted' as const, principals: ['owner'] };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: identity('accepted-fixture'), controlRevision: identity('accepted-controls'), promptFile, compactionPromptFile,
    model: { id: 'actual-configured-fixture', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 4, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 3, pollMs: 100, commands: ['/runtime/node'], researchHosts: [],
    direct: { host: '127.0.0.1', port: 0, actorId: 'owner', scope, modificationEligible: true },
    slack: { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('incumbent', config.controlRevision, config.artifactId);
  const apps: AutarkApplication[] = [], starts: { input: ShellInput; options: ShellOptions }[] = [], posts: Record<string, string>[] = [];
  let sequence = 0;
  const runWorker: NonNullable<ApplicationOptions['runWorker']> = async worker => {
    const start = worker.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> }; starts.push(structuredClone(start));
    const signal = worker.command.signal ?? new AbortController().signal;
    const rpc = (method: string, ...args: unknown[]) => worker.handle(method, json(args) as JsonValue[], signal);
    const bridge: ShellBridge = { execute: call => rpc('execute', call) as unknown as ReturnType<ShellBridge['execute']>, persistCheckpoint: (...args) => rpc('persistCheckpoint', ...args) as unknown as ReturnType<ShellBridge['persistCheckpoint']>, readCheckpoint: checkpoint => rpc('readCheckpoint', checkpoint),
      async capturePrompt(...args) { await rpc('capturePrompt', ...args); }, async reserve(value) { await rpc('reserve', value); }, async dispatched(value) { await rpc('dispatched', value); }, async settle(value) { await rpc('settle', value); } };
    const shell = createAgentShell({ ...start.options, apiKey: () => 'controlled-fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256], environment: { wallNow: () => 1000, monotonicNow: () => 0, newId: () => `model-${++sequence}`, scheduleTimeout: () => () => {} },
      fetch: async (_url, init) => { const value = await rpc('provider.fetch', String(init?.body)) as unknown as { status: number; body: string }; return new Response(value.body, { status: value.status }); } });
    return json(await shell.run(start.input, bridge, signal));
  };
  const api = { async call<T>(method: string, args: Record<string, string>): Promise<T> { if (method === 'chat.postMessage') { posts.push(args); return { channel: args.channel, ts: `${100 + posts.length}.001` } as T; } return {} as T; } };
  const options: ApplicationOptions = { config, authority, authorityStore, runWorker, slackBotApi: api, slackAppApi: api, secrets: { mistralApiKey: 'controlled-fixture', directToken: 'controlled-fixture' } };
  const create = (extra: Partial<ApplicationOptions> = {}) => { const app = new AutarkApplication({ ...options, ...extra }); apps.push(app); return app; };
  t.after(async () => { for (const app of apps.toReversed()) await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, authorityStore, authority, scope, starts, posts, create };
}
async function until(app: AutarkApplication, done: () => boolean) { const deadline = Date.now() + 5000; while (!done()) { assert.ok(Date.now() < deadline, JSON.stringify(app.store.list('runs'))); await app.tick(); await new Promise(resolve => setTimeout(resolve, 5)); } }
function direct(app: AutarkApplication, id: string, text = id, revision = '1') { return app.communications.receive({ source: 'direct', externalId: id, revision, conversation: 'parent', text, actor: { id: 'owner', scope: app.config.direct.scope, modificationEligible: true } }).run; }
function probe(app: AutarkApplication, f: ReturnType<typeof fixture>): SuccessionProbeRequest {
  const parent = app.runtime.admit({ id: 'parent-context', source: 'fixture', externalId: 'parent-context', externalRevision: '1', authenticated: true, actorId: 'owner', scope: f.scope, value: 'Original parent context' }, f.authority, f.config.conversationResources, 'operating-envelope:v1');
  const parentRow = app.store.get<Run>('runs', parent.id)!; app.store.put('runs', parent.id, { ...parentRow.value, status: 'waiting' }, parentRow.revision);
  const binding = { id: 'actual-observer-operation', runId: parent.id, candidateId: f.config.artifactId, incumbentId: identity('prior'), stageId: 'stage', policyDigest: identity('original-policy'), authority: f.authority, scope: f.scope, context: app.store.putArtifact('Actual controlled continuity context'), objective: 'Preserve continuity', criteria: ['Concrete serving response'] };
  app.store.put('host.succession-dialogues', binding.id, { binding, phase: 'observing', turns: [] }, null);
  const request: SuccessionProbeRequest = { id: 'actual-successor-probe', bindingDigest: identity(binding), operationId: binding.id, parentRunId: parent.id, candidateId: f.config.artifactId, authority: f.authority, scope: f.scope, question: 'What configured mind is now serving?' };
  enqueueSuccessionProbe(app.store, request); return request;
}

test('application successor probe uses its actual configured shell and only the internal reply capability with settled model evidence', async t => {
  const f = fixture(t), payloads: Payload[] = [];
  const app = f.create({ additionalTools: () => [{ name: 'forbidden_extension', description: 'Must not reach probe', inputSchema: {}, execute() { throw Error('Forbidden extension'); } }], performRequest: async source => { const payload = JSON.parse(source) as Payload; payloads.push(payload); assert.equal(payload.model, f.config.model.id); assert.deepEqual(payload.tools.map(tool => tool.function.name), ['succession_probe_reply']); return response('succession_probe_reply', { response: 'The configured serving mind is actual-configured-fixture.' }); } });
  const request = probe(app, f), originalParent = app.store.get<Record<string, JsonValue>>('allocations', request.parentRunId)!.value;
  await app.tick(); await until(app, () => app.store.get<{ status: string }>('host.succession-probes', request.id)?.value.status === 'answered' && app.store.list<Run>('runs').some(row => app.successionProbes.isProbe(row.key) && row.value.status === 'completed'));
  const result = readSuccessionProbe(app.store, request)!; assert.ok(result);
  const receipt = app.store.readJsonArtifact<{ response: string; runId: string; effectId: string; physicalRequestId: string; modelResponse: ArtifactRef }>(result);
  assert.match(receipt.response, /actual-configured-fixture/); assert.equal(payloads.length, 1); assert.equal(app.output(receipt.runId).length, 0);
  const model = app.store.get<{ request: PhysicalRequest }>('requests', receipt.physicalRequestId)!.value.request;
  assert.equal(model.status, 'succeeded'); assert.equal(model.provider, 'mistral'); assert.equal(model.model, f.config.model.id); assert.equal(model.purpose, 'reasoning'); assert.equal(model.runId, receipt.runId);
  assert.match(JSON.stringify(app.store.readJsonArtifact(receipt.modelResponse)), /succession_probe_reply/);
  assert.equal(app.effects.get(receipt.effectId)!.status, 'succeeded');
  const allocation = app.store.get<{ parentRunId: string }>('allocations', receipt.runId)!.value; assert.equal(allocation.parentRunId, request.parentRunId);
  const retainedParent = app.store.get<Record<string, JsonValue>>('allocations', request.parentRunId)!.value;
  const { elapsedFloorMs: oldFloor, ...originalGrant } = originalParent, { elapsedFloorMs: newFloor, ...retainedGrant } = retainedParent;
  assert.deepEqual(retainedGrant, originalGrant); assert.ok(Number(newFloor) >= Number(oldFloor));
  assert.deepEqual(f.starts.filter(start => start.input.run.id === receipt.runId)[0]!.options.tools.map(tool => tool.name), ['succession_probe_reply']);
  await app.tick(); assert.equal(payloads.length, 1); assert.equal(f.posts.length, 0);
  const actualResponse = app.store.get('host.model-responses', receipt.physicalRequestId)!; app.store.delete('host.model-responses', receipt.physicalRequestId, actualResponse.revision);
  assert.throws(() => readSuccessionProbe(app.store, request), /actual serving model answer/); assert.equal(payloads.length, 1);
});
test('a configured provider attempt to use a production effect cannot qualify the internal successor probe', async t => {
  const f = fixture(t); let calls = 0;
  const app = f.create({ performRequest: async () => { calls++; return calls === 1 ? response('workspace_write', { path: 'forbidden.txt', content: 'No authority', expectedSha256: null }) : response(); } });
  const request = probe(app, f); await app.tick(); await until(app, () => app.store.list<Run>('runs').some(row => app.successionProbes.isProbe(row.key) && ['completed', 'blocked'].includes(row.value.status)));
  assert.equal(readSuccessionProbe(app.store, request), undefined); assert.equal(app.store.list<{ kind: string }>('effects').some(row => row.value.kind === 'workspace_write'), false); assert.equal(f.posts.length, 0);
  assert.equal(calls, 2, 'Actual shell observes the unavailable tool rejection and completes without a probe witness');
});
test('ordinary service exposes one skin_shed entry with or without policy metadata and no manual lifecycle bypasses', t => {
  const f = fixture(t), app = f.create({ performRequest: async () => { throw Error('Tool projection cannot invoke a model'); } });
  const context = { runId: 'read-only-projection', scope: f.scope, authority: f.authority, workspace: f.config.workspaceDirectory, store: app.store };
  const binding = { config: f.config, artifactStore: join(f.config.stateDirectory, 'fixture-artifacts'), assertAuthority: (grant: typeof f.authority) => f.authorityStore.assert(grant) };
  const originalRequests = app.store.list('requests');
  for (const evolution of [undefined, { policyDigest: identity('original-policy') }]) {
    const tools = ordinaryServiceTools(context, { ...binding, evolution }), names = tools.map(tool => tool.name);
    assert.equal(names.filter(name => name === 'skin_shed').length, 1);
    if (!evolution) assert.match(tools.find(tool => tool.name === 'skin_shed')!.description, /unavailable/);
    for (const name of ['candidate_freeze', 'candidate_evaluate', 'release_submit', 'control_activate']) assert.equal(names.includes(name), false, `Ordinary service must omit ${name}`);
    assert.ok(names.includes('change_propose')); assert.ok(names.includes('change_status'));
  }
  assert.deepEqual(app.store.list('requests'), originalRequests);
});
test('real skin_shed handoff holds its parent despite steering while unrelated Slack proceeds, then wakes once under adopted authority', async t => {
  const f = fixture(t), policyDigest = identity('original-policy'), calls = new Map<string, number>();
  let parentId = '', observedTerminal = false, capabilityCallbacks = 0;
  const performRequest: NonNullable<ApplicationOptions['performRequest']> = async source => {
    const payload = JSON.parse(source) as Payload, host = frame(payload), count = (calls.get(host.runId) ?? 0) + 1; calls.set(host.runId, count);
    assert.equal(payload.tools.filter(tool => tool.function.name === 'skin_shed').length, 1);
    for (const name of ['candidate_freeze', 'candidate_evaluate', 'release_submit', 'control_activate']) assert.equal(payload.tools.some(tool => tool.function.name === name), false);
    if (host.runId === parentId) {
      if (count === 1) return response('skin_shed', { changeId: 'actual-change' });
      assert.match(source, /control-outcome/); assert.match(source, /retained steering while shedding/); observedTerminal = true; return response();
    }
    return count === 1 ? response('speech_send', { channel: host.target!.channel, text: 'Unrelated Slack thread remains processable.', kind: 'message' }) : response();
  };
  const tools: NonNullable<ApplicationOptions['additionalTools']> = context => {
    capabilityCallbacks++;
    return ordinaryServiceTools(context, { config: f.config, artifactStore: join(f.config.stateDirectory, 'fixture-artifacts'), evolution: { policyDigest }, assertAuthority: grant => f.authorityStore.assert(grant) });
  };
  const app = f.create({ additionalTools: tools, performRequest });
  const parent = direct(app, 'original', 'Request exact source succession.'); parentId = parent.id;
  new ChangeProposals(app.store, parent.id, f.scope).create({ id: 'actual-change', runId: parent.id, scope: f.scope, authority: f.authority, provenance: { kind: 'human', inputId: 'original', actorId: 'owner' }, state: 'proposed', justification: 'Controlled integration proposal', goal: { objective: 'Retain history', successCriteria: ['Observed exact handoff'] }, experience: app.store.putArtifact('Controlled fixture evidence') });
  await app.resume(parent.id); await until(app, () => app.runtime.getRun(parent.id)?.status === 'waiting');
  const operation = app.store.get<ControlContinuationRecord>('host.control-continuations', controlActivationId(parent.id, 'actual-change'))!;
  assert.equal(operation.value.status, 'pending'); assert.equal(controlActivationAcknowledgmentPending(app.store, operation.value.request), false); assert.equal(calls.get(parent.id), 1); assert.ok(capabilityCallbacks > 0);
  assert.equal(operation.value.request.proposalId, 'actual-change'); assert.ok(operation.value.request.skinShed);
  direct(app, 'steering', 'retained steering while shedding'); await app.tick(); await app.resume(parent.id);
  assert.equal(calls.get(parent.id), 1); assert.equal(app.controls.eligibleRun(parent.id, true), false);
  const unrelated = app.slackIngress!.acceptHistory('C1', { ts: '10.001', user: 'U1', text: '<@BOT> Independent thread question.' })!.run;
  await until(app, () => app.runtime.getRun(unrelated.id)?.status === 'completed');
  assert.equal(calls.get(parent.id), 1); assert.equal(f.posts.length, 1); assert.equal(f.posts[0]!.thread_ts, '10.001');
  // Controlled known rejection before staging. This fixture neither fabricates
  // acceptance evidence nor claims an actual release/interview cycle.
  const operationId = operation.value.request.id, row = app.store.get<ControlContinuationRecord>('host.control-continuations', operationId)!;
  app.store.put('host.control-continuations', operationId, { ...row.value, status: 'rejected', diagnosis: 'Controlled host rejection before staging' }, row.revision);
  const allocations = app.store.list('allocations'), requests = app.store.list('requests'); await app.close();
  const withdrawn = f.authorityStore.withdraw(f.authority), authority = f.authorityStore.activate(withdrawn, 'successor', f.config.controlRevision, f.config.artifactId);
  const next = f.create({ authority, additionalTools: tools, performRequest });
  assert.deepEqual(next.runtime.getRun(parent.id)!.authority, authority); assert.deepEqual(next.store.list('allocations'), allocations); assert.deepEqual(next.store.list('requests'), requests);
  await next.tick(); await until(next, () => next.runtime.getRun(parent.id)?.status === 'completed');
  assert.equal(observedTerminal, true); assert.equal(calls.get(parent.id), 2);
  const watch = next.store.get<{ status: string }>('host.control-author-watches', operationId); assert.equal(watch?.value.status, 'notified');
  assert.deepEqual(next.store.get<ControlContinuationRecord>('host.control-continuations', operationId)!.value.request, operation.value.request);
  await next.tick(); assert.equal(calls.get(parent.id), 2); assert.equal(f.posts.length, 1);
});
test('activation drain lets existing inference finish, queues new Slack work and still executes the actual internal successor probe', async t => {
  const f = fixture(t), normalCalls = new Map<string, number>();
  let heldRunId = '', probeCalls = 0, entered!: () => void, release!: () => void;
  const enteredModel = new Promise<void>(resolve => { entered = resolve; }), heldModel = new Promise<void>(resolve => { release = resolve; });
  const app = f.create({ performRequest: async (source, signal) => {
    const payload = JSON.parse(source) as Payload;
    if (payload.tools.some(tool => tool.function.name === 'succession_probe_reply')) {
      probeCalls++; assert.deepEqual(payload.tools.map(tool => tool.function.name), ['succession_probe_reply']);
      return response('succession_probe_reply', { response: 'The actual serving successor can answer during its cutover drain.' });
    }
    const host = frame(payload), count = (normalCalls.get(host.runId) ?? 0) + 1; normalCalls.set(host.runId, count);
    if (host.runId === heldRunId) {
      entered(); signal.addEventListener('abort', release, { once: true });
      try { await heldModel; } finally { signal.removeEventListener('abort', release); }
    }
    return response();
  } });
  const existing = direct(app, 'existing-inference'); heldRunId = existing.id;
  const inFlight = app.resume(existing.id); await enteredModel;
  assert.equal(app.runtime.getRun(existing.id)!.status, 'running'); assert.equal(normalCalls.get(existing.id), 1);
  const request = probe(app, f), operationId = controlActivationId(request.parentRunId, 'drain');
  const operation: ControlContinuationRecord = { request: { id: operationId, runId: request.parentRunId, proposalId: 'drain', scope: f.scope, authority: f.authority,
    skinShed: { effectId: 'tool:controlled-drain', workspace: f.config.workspaceDirectory, incumbentCandidateId: identity('prior'), policyDigest: identity('original-policy') } }, status: 'activating' };
  // Controlled trusted phase transition; physical cutover is covered by supervisor fixtures.
  app.store.put('host.control-continuations', operationId, operation, null); assert.equal(app.controls.draining(), true);
  const queued = app.slackIngress!.acceptHistory('C1', { ts: '20.001', user: 'U1', text: '<@BOT> Retain this new thread during cutover.' })!.run;
  await app.tick(); await app.resume(queued.id);
  assert.equal(normalCalls.has(queued.id), false); assert.equal(app.controls.eligibleRun(queued.id, false), false);
  assert.ok(app.store.get('host.pending-runs', queued.id)); assert.equal(f.posts.length, 0);
  release(); assert.equal((await inFlight).status, 'completed', 'Existing inference settles through the actual configured shell without forced interruption');
  await until(app, () => app.store.list<Run>('runs').some(row => app.successionProbes.isProbe(row.key) && row.value.status === 'completed'));
  assert.ok(readSuccessionProbe(app.store, request)); assert.equal(probeCalls, 1); assert.equal(normalCalls.has(queued.id), false);
  const retainedRequests = app.store.list<{ request: PhysicalRequest }>('requests').filter(row => row.value.request.runId === existing.id);
  assert.equal(retainedRequests.length, 1); assert.equal(retainedRequests[0]!.value.request.status, 'succeeded');
  const row = app.store.get<ControlContinuationRecord>('host.control-continuations', operationId)!;
  app.store.put('host.control-continuations', operationId, { ...row.value, status: 'rejected', diagnosis: 'Controlled explicit host decision ends admission drain' }, row.revision);
  await app.tick(); await until(app, () => app.runtime.getRun(queued.id)?.status === 'completed');
  assert.equal(app.controls.draining(), false); assert.equal(normalCalls.get(queued.id), 1); assert.equal(probeCalls, 1);
  assert.deepEqual(app.store.list<{ request: PhysicalRequest }>('requests').filter(value => value.value.request.runId === existing.id), retainedRequests);
  await app.tick(); assert.equal(normalCalls.get(queued.id), 1); assert.equal(normalCalls.get(existing.id), 1);
});

test('idle application excludes terminal unmanaged history before expensive control eligibility', async t => {
  const f = fixture(t); let modelCalls = 0;
  const app = f.create({ performRequest: async () => { modelCalls++; return response(); } });
  const completed = direct(app, 'completed-history');
  await app.resume(completed.id); assert.equal(app.runtime.getRun(completed.id)!.status, 'completed');
  await new Promise<void>(resolve => setImmediate(resolve));
  const terminal = new Set([completed.id]);
  for (let index = 0; index < 32; index++) {
    const id = `cancelled-history-${index}`, run = app.runtime.admit({ id, source: 'fixture', externalId: id, externalRevision: '1', authenticated: true,
      actorId: 'owner', scope: f.scope, value: 'Retained terminal history' }, f.authority, f.config.conversationResources, 'operating-envelope:v1');
    app.runtime.cancel(run.id, 'owner', 'Controlled completed historical cancellation'); terminal.add(run.id);
  }
  const retainedRuns = app.store.list('runs'), retainedRequests = app.store.list('requests'), checked: string[] = [];
  // Observe the actual instance boundary; do not replace JSON, timers or ledger behavior.
  const eligible = app.controls.eligibleRun.bind(app.controls);
  app.controls.eligibleRun = (runId, steering) => { checked.push(runId); return eligible(runId, steering); };
  await app.tick();
  assert.deepEqual(checked.filter(id => terminal.has(id)), [], 'Terminal history must not trigger repeated control-record decoding');
  assert.deepEqual(app.store.list('runs'), retainedRuns); assert.deepEqual(app.store.list('requests'), retainedRequests);
  assert.equal(modelCalls, 1); assert.equal(f.posts.length, 0);
});
