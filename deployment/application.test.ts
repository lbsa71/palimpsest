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
    bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100,
    commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'restricted', principals: ['operator'] }, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  return { root, config, authorityStore, authority };
}
function tool(name: string, args: unknown) { return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: name.replaceAll('_', '').slice(0, 9), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) }; }

test('close during application startup cannot leave a listener or background work alive', { timeout: 5000 }, async () => {
  const f = fixture(); let calls = 0;
  const app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' }, performRequest: async () => { calls++; throw new Error('Unexpected model request'); } });
  try {
    const starting = app.start(); const rejected = assert.rejects(starting, /stopped during startup/);
    await app.close(); await rejected;
    assert.equal(app.directApi.listening, false); assert.equal(calls, 0);
  } finally { await app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('authenticated health remains alive while cancelled allowance or withdrawn authority holds execution without probing a provider', async () => {
  const f = fixture(); let calls = 0;
  const app = new AutarkApplication({ ...f, secrets: { mistralApiKey: 'private-provider-key', directToken: 'health-token' }, performRequest: async () => { calls++; throw new Error('Health must not spend'); } });
  try {
    await app.start(); const url = `http://127.0.0.1:${(app.directApi.address() as AddressInfo).port}/health`;
    assert.equal((await fetch(url)).status, 401);
    const read = async () => { const response = await fetch(url, { headers: { authorization: 'Bearer health-token' } }); assert.equal(response.status, 200); return await response.json() as any; };
    const available = await read(); assert.equal(available.alive, true); assert.equal(available.execution.admission, 'available');
    app.resources.cancel('operating-envelope:v1');
    const held = await read(); assert.equal(held.alive, true); assert.equal(held.execution.admission, 'held'); assert.ok(held.execution.reasons.includes('allowance-cancelled'));
    f.authorityStore.withdraw(f.authority);
    const fenced = await read(); assert.equal(fenced.alive, true); assert.ok(fenced.execution.reasons.includes('authority-unavailable'));
    for (const hidden of ['private-provider-key', f.config.stateDirectory, f.authority.generation]) assert.equal(JSON.stringify(fenced).includes(hidden), false);
    assert.equal(calls, 0);
  } finally { await app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});
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

function parsed(payload: string): any { return JSON.parse(payload); }
function context(request: any): any { return request.messages.filter((m: any) => m.role === 'user').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } }).findLast((m: any) => m.hostContext)?.hostContext; }
function receipt(request: any): any { return JSON.parse(request.messages.findLast((m: any) => m.role === 'tool').content); }
function receive(app: AutarkApplication, f: ReturnType<typeof fixture>, id: string, text = id, revision = '1', conversation = id) { return app.communications.receive({ source: 'direct', externalId: id, revision, conversation, text, actor: { id: f.config.direct.actorId, scope: f.config.direct.scope, modificationEligible: true } }).run; }
const secrets = { mistralApiKey: 'private-fixture-key', directToken: 'direct-test' };

test('ordinary delegation runs a real bounded child, inspects actual artifacts and accounts every request', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let parentCalls = 0, childCalls = 0; let packet: any, childResult: any, inspection: any;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async payload => {
      const request = parsed(payload), frame = context(request);
      if (!frame.target) {
        childCalls++; assert.equal(request.tools.some((t: any) => t.function.name === 'speech_send' || t.function.name === 'memory_derive'), false);
        if (childCalls === 1) return tool('workspace_write', { path: 'child.txt', content: 'Observed child evidence', expectedSha256: null });
        return stop('Child finished its finite task.');
      }
      parentCalls++;
      if (parentCalls === 1) return tool('delegation_prepare', {});
      if (parentCalls === 2) {
        const prepared = receipt(request); packet = { id: 'actual-child', parentRunId: frame.runId, parentGoalId: 'finite-fixture', objective: 'Write actual evidence to child.txt.', acceptanceCriteria: ['Actual child.txt write succeeded'], inputs: [], writablePaths: [prepared.workspace], allowedEffects: ['workspace_write'], resources: prepared.grant.resources, modelPolicy: prepared.grant.modelProfiles[0], scope: prepared.grant.scope, provenance: { sourceIds: ['authenticated-fixture'], actorId: f.authority.generation, recordedAt: new Date().toISOString(), derivation: 'interpreted' }, outputLocation: 'child.txt', cancellationConditions: ['parent cancellation'], maxDepth: 1 };
        return tool('delegation_start', packet);
      }
      if (parentCalls === 3) { childResult = receipt(request); assert.equal(childResult.status, 'completed'); return tool('delegation_inspect', { id: packet.id }); }
      if (parentCalls === 4) { inspection = receipt(request); assert.match(inspection.artifacts[0].content, /Observed child evidence/); return tool('delegation_judge', { id: packet.id, inspection: inspection.receipt, checks: [{ criterion: packet.acceptanceCriteria[0], passed: true, evidence: childResult.result.artifacts[0] }] }); }
      assert.equal(receipt(request).status, 'accepted'); return stop('Private parent judgment.');
    } });
    await app.start(); const run = receive(app, f, 'delegation', 'Delegate a finite coding task.');
    await eventually(() => app!.runtime.getRun(run.id), value => value?.status === 'completed' || value?.status === 'blocked' || value?.status === 'waiting');
    assert.equal(app.runtime.getRun(run.id)?.status, 'completed', JSON.stringify(app.store.get('execution', run.id)));
    assert.equal(app.delegation.get('actual-child')?.status, 'accepted'); assert.equal(parentCalls, 5); assert.equal(childCalls, 2);
    assert.equal(readFileSync(join(packet.writablePaths[0], 'child.txt'), 'utf8'), 'Observed child evidence');
    assert.equal(app.output(run.id).length, 0);
    const requests = app.store.list<any>('requests').map(row => row.value.request); assert.equal(requests.filter(r => r.provider === 'mistral').length, 7); assert.equal(requests.filter(r => r.provider === 'effect-receiver').length, 5);
    assert.equal(app.resources.snapshot(run.id).requests, 12);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('queued consolidation executes under the shared ledger with one scoped completion capability and survives restart', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let conversationCalls = 0, consolidationCalls = 0; let sourceId = '';
  const performRequest = async (payload: string) => {
    const request = parsed(payload), frame = context(request); assert.equal(payload.includes('foreign-private-memory'), false);
    if (request.tools.some((t: any) => t.function.name === 'memory_consolidation_complete')) {
      consolidationCalls++; assert.deepEqual(request.tools.map((t: any) => t.function.name), ['memory_consolidation_complete']);
      if (consolidationCalls === 1) return tool('memory_consolidation_complete', { outputs: [{ kind: 'belief', content: 'The operator supplied a continuity question; its answer remains uncertain.', confidence: 0.4 }] });
      assert.equal(receipt(request).state, 'completed'); return stop('Internal consolidation text.');
    }
    conversationCalls++; sourceId = frame.memory.memories[0].id;
    if (conversationCalls === 1) return tool('memory_schedule_consolidation', { id: 'continuity', sourceIds: [sourceId], dueAt: new Date().toISOString() });
    return stop('Schedule recorded.');
  };
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest });
    app.memory.ingest({ id: 'foreign', runId: 'foreign-run', sourceId: 'foreign-source', actorId: 'other', channel: 'speech', scope: { kind: 'restricted', principals: ['other'] }, at: new Date().toISOString(), content: 'foreign-private-memory' });
    await app.start(); const run = receive(app, f, 'continuity', 'Consider continuity from an attributed question.');
    const jobs = await eventually(() => app!.memory.jobs(f.config.direct.scope), value => value.some(job => job.state === 'completed'));
    await eventually(() => app!.store.list<any>('runs').map(row => row.value.status), statuses => statuses.every(status => status === 'completed'));
    assert.equal(jobs.length, 1); assert.equal(jobs[0]!.attempts, 1); assert.equal(consolidationCalls, 2); assert.equal(conversationCalls, 2);
    const belief = app.memory.get(jobs[0]!.outputIds[0]!, f.config.direct.scope)!; assert.equal(belief.provenance.derivation, 'summarized'); assert.deepEqual(belief.provenance.sourceIds, [sourceId]);
    assert.equal(app.memory.get(belief.id, { kind: 'restricted', principals: ['other'] }), undefined); assert.equal(app.output(run.id).length, 0);
    const used = app.resources.snapshot(run.id); assert.equal(used.requests, 6);
    await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest });
    assert.equal(app.memory.jobs(f.config.direct.scope)[0]!.state, 'completed'); assert.equal(app.resources.snapshot(run.id).requests, used.requests); assert.equal(consolidationCalls, 2);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('immediate tool memory permits same-run derivation; forgetting does not resurrect on restart', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let calls = 0; let rememberedId = '';
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async payload => {
      calls++; const request = parsed(payload);
      if (calls === 1) return tool('workspace_write', { path: 'fact.txt', content: 'actual fact', expectedSha256: null });
      if (calls === 2) return tool('memory_retrieve', { query: 'actual fact', maxRecords: 20 });
      if (calls === 3) { rememberedId = receipt(request).memories.find((m: any) => m.kind === 'observation').id; return tool('memory_derive', { id: 'observed-write', kind: 'belief', sourceIds: [rememberedId], content: 'The write was observed.', confidence: 0.8 }); }
      assert.equal(receipt(request).provenance.derivation, 'interpreted'); return stop('Private final text.');
    } });
    await app.start(); const run = receive(app, f, 'immediate', 'Observe a real write and derive from it.');
    await eventually(() => app!.runtime.getRun(run.id), value => value?.status === 'completed' || value?.status === 'waiting'); assert.equal(app.runtime.getRun(run.id)?.status, 'completed'); assert.equal(calls, 4);
    app.memory.forget([rememberedId]); await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest: async () => stop('unused') });
    assert.equal(app.memory.get(rememberedId, f.config.direct.scope), undefined); assert.equal(app.store.get('host.ingested', rememberedId)?.value, true); assert.equal(app.output(run.id).length, 0);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('shared application slots admit inquiry under queued conversations and keep direct status responsive', async () => {
  const f = fixture(); f.config.maxConcurrentRuns = 1; let app: AutarkApplication | undefined; let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); const order: string[] = []; let inquiryCalls = 0;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async payload => {
      const request = parsed(payload), frame = context(request), input = request.messages.findLast((m: any) => m.role === 'user' && !m.content.includes('hostContext'))?.content ?? '';
      if (frame.target && input.includes('hold-first')) { order.push('first'); entered(); await held; return stop('First done.'); }
      if (!frame.target && input.includes('\"goal\"')) {
        inquiryCalls++;
        if (inquiryCalls === 1) { order.push('inquiry'); return tool('workspace_write', { path: 'inquiry.txt', content: 'new observation', expectedSha256: null }); }
        if (inquiryCalls === 2) return tool('memory_retrieve', { query: 'new observation', maxRecords: 32 });
        if (inquiryCalls === 3) { const observed = receipt(request).memories.find((memory: any) => memory.id.startsWith('initiative-observation:')); return tool('memory_forget', { memoryIds: [observed.id] }); }
        if (inquiryCalls === 4) { const goal = app!.goals.goal('inquiry')!; return tool('initiative_goal_progress', { id: goal.id, expectedRevision: goal.revision, decision: { kind: 'complete', reason: 'Actual operational write observed; selected developmental memory intentionally forgotten.', evidenceIds: app!.runtime.observations(frame.runId).map(o => o.id) } }); }
        return stop('Inquiry complete.');
      }
      order.push('second'); return stop('Second done.');
    } });
    await app.start(); const first = receive(app, f, 'first', 'hold-first'); await ready; const second = receive(app, f, 'second', 'queued-second');
    const goal = app.goals.propose({ id: 'inquiry', origin: { kind: 'self' }, purpose: 'Gather a finite curious observation.', scope: f.config.direct.scope, successCriteria: ['Actual write'], evidenceIds: [], dependencyIds: [], resources: f.config.scheduler.resources, priority: 1, nextAction: 'Write inquiry.txt', reviewAt: new Date(Date.now() + 60000).toISOString() }, { sourceIds: ['fixture-observation'], actorId: f.authority.generation, recordedAt: new Date().toISOString(), derivation: 'interpreted' }); app.goals.accept(goal.id, goal.revision, 'Self-chosen finite inquiry.');
    const port = (app.directApi.address() as AddressInfo).port; const before = Date.now(); const status = await fetch(`http://127.0.0.1:${port}/runs/${encodeURIComponent(first.id)}`, { headers: { authorization: 'Bearer direct-test' } }); assert.equal(status.status, 200); assert(Date.now() - before < 1000); assert.equal(app.runtime.getRun(second.id)?.status, 'ready');
    release(); await eventually(() => app!.runtime.getRun(second.id), run => run?.status === 'completed'); assert.equal(app.goals.goal('inquiry')?.status, 'completed', JSON.stringify({ order, goal: app.goals.goal('inquiry'), execution: app.store.list('execution'), observations: app.store.list('observations') })); assert.deepEqual(order, ['first', 'inquiry', 'second']); assert(app.store.list<any>('development.memories').some(row => row.key.startsWith('initiative-observation:') && row.value.record.status === 'forgotten'));
  } finally { release?.(); await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('steering an active conversation reschedules its durable correction without automatic speech', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async (payload, signal) => {
      calls++; if (calls === 1) { entered(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
      assert.match(payload, /corrected objective/); return stop('Internal corrected outcome.');
    } }); await app.start(); const run = receive(app, f, 'steered', 'original objective'); await ready;
    receive(app, f, 'steered', 'corrected objective', '2');
    await eventually(() => app!.runtime.getRun(run.id), value => value?.status === 'completed'); assert.equal(calls, 2); assert.equal(app.output(run.id).length, 0);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('graceful close persists unfinished work before abort and restart resumes it', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  const performRequest = async (payload: string, signal: AbortSignal) => {
    calls++; if (calls === 1) { entered(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    assert.match(payload, /unfinished objective/); return stop('Internal restarted outcome.');
  };
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest }); await app.start(); const run = receive(app, f, 'restart', 'unfinished objective'); await ready;
    await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest }); assert.ok(app.store.get('host.pending-runs', run.id)); assert.equal(app.runtime.getRun(run.id)?.status, 'waiting');
    await app.start(); await eventually(() => app!.runtime.getRun(run.id), value => value?.status === 'completed'); assert.equal(calls, 2); assert.equal(app.output(run.id).length, 0);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('ordinary promise keeps progress owed and wakes an accounted report run with a confirmed receipt', async () => {
  const f = fixture(); f.config.maxConcurrentRuns = 1; let app: AutarkApplication | undefined; let conversationCalls = 0, reportCalls = 0; let owed: any;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async payload => {
      const request = parsed(payload), frame = context(request); const input = request.messages.findLast((m: any) => m.role === 'user' && !m.content.includes('hostContext'))?.content ?? '';
      if (input.includes('"obligation":')) {
        reportCalls++; assert.equal(frame.target.channel, 'promise'); assert.equal(frame.obligations[0].id, owed.id);
        if (reportCalls === 1) return tool('speech_send', { channel: frame.target.channel, text: 'The verified outcome report.', kind: 'report', obligationId: owed.id, obligationRevision: owed.revision });
        assert.equal(app!.obligations.obligation(owed.id)?.status, 'delivered'); return stop('Private report reasoning.');
      }
      conversationCalls++;
      if (conversationCalls === 1) return tool('obligation_owe', { id: 'result', promisedOutcome: 'A verified outcome report.', dueAt: null });
      if (conversationCalls === 2) { owed = receipt(request); return tool('speech_send', { channel: frame.target.channel, text: 'Work has started.', kind: 'progress' }); }
      assert.equal(app!.obligations.obligation(owed.id)?.status, 'owed'); return stop('Internal planning completed.');
    } }); await app.start(); const run = receive(app, f, 'promise', 'Please report the eventual result.');
    await eventually(() => app!.obligations.all(), values => values.some(value => value.status === 'delivered'));
    await eventually(() => app!.store.list<any>('runs').map(row => row.value.status), statuses => statuses.every(status => status === 'completed'));
    assert.equal(conversationCalls, 3); assert.equal(reportCalls, 2); assert.equal(app.output(run.id).length, 1); assert.equal((app.output(run.id)[0] as any).kind, 'progress');
    const delivery = app.store.get<{ runId: string }>('host.delivery-runs', owed.id)!.value; assert.equal(app.output(delivery.runId).length, 1); assert.match(JSON.stringify(app.output(delivery.runId)), /verified outcome report/); assert.equal(app.resources.snapshot(run.id).requests, 8);
    await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest: async () => { throw new Error('No terminal report replay'); } }); assert.equal(app.obligations.obligation(owed.id)?.status, 'delivered');
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('ordinary Slack report with a lost receipt remains delivering until reconciliation and never resends', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let calls = 0, posts = 0; let clientId = '', owed: any;
  f.config.slack = { teamId: 'T1', botUserId: 'BOT', channels: [{ channel: 'C1', scope: f.config.direct.scope }], eligibleHumanIds: ['U1'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true };
  const slackBotApi = { async call<T>(method: string, args: Record<string, string>): Promise<T> {
    if (method === 'chat.postMessage') { posts++; clientId = args.client_msg_id!; throw new Error('Receipt lost after remote commit'); }
    return { messages: [{ ts: '12', thread_ts: '10', user: 'BOT', text: 'Verified Slack report.', client_msg_id: clientId }] } as T;
  } };
  try {
    app = new AutarkApplication({ ...f, secrets, slackBotApi, slackAppApi: { async call<T>() { return {} as T; } }, performRequest: async payload => {
      calls++; const request = parsed(payload), frame = context(request);
      if (calls === 1) return tool('obligation_owe', { id: 'lost-result', promisedOutcome: 'Verified Slack report.', dueAt: new Date(Date.now() + 60000).toISOString() });
      owed = receipt(request); return tool('speech_send', { channel: frame.target.channel, threadTs: frame.target.threadTs, text: 'Verified Slack report.', kind: 'report', obligationId: owed.id, obligationRevision: owed.revision });
    } });
    const run = app.slackIngress!.acceptHistory('C1', { ts: '10', user: 'U1', text: '<@BOT> report the result' })!.run;
    await eventually(() => app!.runtime.getRun(run.id), value => value?.status === 'blocked'); assert.equal(posts, 1); assert.equal(app.obligations.obligation(owed.id)?.status, 'delivering');
    const effect = app.effects.unresolved(run.id)[0]!; assert.equal(effect.status, 'uncertain'); assert.equal((await app.effects.reconcile(effect.id, f.authority)).status, 'succeeded');
    await app.tick(); assert.equal(app.obligations.obligation(owed.id)?.status, 'delivered'); assert.equal(posts, 1); assert.equal(calls, 2);
    await app.close(); app = new AutarkApplication({ ...f, secrets, slackBotApi, slackAppApi: { async call<T>() { return {} as T; } }, performRequest: async () => { throw new Error('No uncertain report replay'); } }); assert.equal(app.obligations.obligation(owed.id)?.status, 'delivered'); assert.equal(posts, 1);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('an accounted consolidation cannot complete after its durable claim revision is replaced', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let entered!: () => void, release!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async payload => {
      calls++; const request = parsed(payload);
      if (calls === 1) { entered(); await held; return tool('memory_consolidation_complete', { outputs: [{ kind: 'belief', content: 'Stale output must not be adopted.', confidence: 0.5 }] }); }
      assert.match(JSON.stringify(receipt(request)), /stale consolidation lease/); return stop('Old claim rejected.');
    } });
    app.memory.ingest({ id: 'claim-source', runId: 'fixture-source', sourceId: 'attributed-source', actorId: 'operator', channel: 'speech', scope: f.config.direct.scope, at: new Date().toISOString(), content: 'A source requiring cautious interpretation.' });
    const job = app.memory.scheduleConsolidation('claim-job', ['claim-source'], f.config.direct.scope, new Date().toISOString()); await app.start(); await ready;
    const replacement = app.memory.claimConsolidation('replacement-worker', 60000, new Date(Date.now() + 62000).toISOString())!; assert(replacement.job.revision > job.revision); release();
    await eventually(() => app!.store.list<any>('runs').map(row => row.value.status), statuses => statuses.every(status => status === 'completed'));
    const current = app.memory.jobs(f.config.direct.scope)[0]!; assert.equal(current.revision, replacement.job.revision); assert.equal(current.lease!.owner, 'replacement-worker'); assert.equal(current.outputIds.length, 0);
    assert.equal(app.memory.context({ audience: f.config.direct.scope, query: 'Stale output must not be adopted', maxRecords: 32, maxBytes: 65536 }).memories.some(m => m.kind === 'belief'), false); assert.equal(calls, 2);
  } finally { release?.(); await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('restart discovers committed steering even if the scheduling callback was lost', async () => {
  const f = fixture();
  let app: AutarkApplication | undefined; let calls = 0; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const performRequest = async (payload: string, signal: AbortSignal) => {
    calls++;
    if (calls === 1) { entered(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    assert.match(payload, /new committed steering/);
    return stop('Steering handled after restart.');
  };
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest });
    app.communications.options.onReady = undefined;
    const run = receive(app, f, 'callback-first', 'first objective', '1', 'callback-conversation');
    const controller = new AbortController(), active = app.resume(run.id, controller.signal);
    await ready; controller.abort(); await active;
    assert.equal(app.runtime.getRun(run.id)?.status, 'waiting');
    receive(app, f, 'callback-second', 'new committed steering', '1', 'callback-conversation');
    await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest });
    await app.start();
    await eventually(() => calls, value => value === 2);
    await eventually(() => app!.runtime.getRun(run.id), run => run?.status === 'completed');
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('report admission rolls back if durable destination registration fails', async () => {
  const f = fixture(); let app: AutarkApplication | undefined;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async () => stop('No dispatch expected') });
    app.obligations.owe({ id: 'atomic-report', inputId: 'input', audience: f.config.direct.scope, promisedOutcome: 'Report outcome', dueAt: null });
    app.store.put('host.obligation-targets', 'atomic-report', { channel: 'report-channel', transport: 'direct', scope: f.config.direct.scope }, null);
    const original = app.store.put.bind(app.store);
    app.store.put = ((namespace: string, ...args: any[]) => { if (namespace === 'host.delivery-runs') throw new Error('injected destination commit failure'); return (original as any)(namespace, ...args); }) as typeof app.store.put;
    await assert.rejects((app as any).deliverObligation('atomic-report', new AbortController().signal), /injected destination/);
    assert.equal(app.store.list('runs').length, 0, 'No orphan runtime without a durable delivery owner');
    assert.equal(app.store.list('host.run-grants').length, 0, 'No orphan destination grant');
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('a completed extension mutation with an unserializable receipt remains uncertain', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let calls = 0;
  try {
    app = new AutarkApplication({ ...f, secrets,
      additionalTools: ({ store }) => [{ name: 'extension_mutate', description: 'Fixture mutation', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { await Promise.resolve(); store.put('fixture.extension', 'mutation', true, null); const result: any = {}; result.circular = result; return result; } }],
      performRequest: async () => { calls++; return calls === 1 ? tool('extension_mutate', {}) : stop('Must not reach another request while outcome is unknown'); },
    });
    const run = receive(app, f, 'extension-mutation');
    await eventually(() => app!.runtime.getRun(run.id), run => ['blocked', 'completed', 'waiting'].includes(run?.status ?? ''));
    assert.equal(app.store.get('fixture.extension', 'mutation')?.value, true);
    assert.equal(app.runtime.getRun(run.id)?.status, 'blocked');
    assert.equal(app.effects.unresolved(run.id).length, 1); assert.equal(calls, 1);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('fresh boot makes one accounted developmental start and a model-chosen follow-on goal without human input', async () => {
  const f = fixture(); delete f.config.bootstrapInitiative; let app: AutarkApplication | undefined; let bootstrapCalls = 0, inquiryCalls = 0;
  let chosenGoal: any;
  const performRequest = async (payload: string) => {
    const request = parsed(payload), frame = context(request);
    const bootstrap = request.messages.some((message: any) => message.role === 'system' && typeof message.content === 'string' && message.content.includes('application.development-bootstrap'));
    assert.equal(frame.target, null);
    if (bootstrap) {
      bootstrapCalls++;
      assert.equal(frame.memory.self.length, 0);
      assert.ok(frame.memory.memories.some((memory: any) => memory.id === 'host:development-bootstrap:v1' && memory.provenance.derivation === 'observed'));
      if (bootstrapCalls === 1) return tool('initiative_goal_propose', { id: 'chosen-first-inquiry', purpose: 'Explore whether a measured local observation warrants a procedure.', successCriteria: ['Inspect an actual workspace result'], sourceIds: ['host:development-bootstrap:v1'], resources: f.config.scheduler.resources, priority: 1, nextAction: 'Discover the local workspace', reviewAt: new Date(Date.now() + 60000).toISOString() });
      if (bootstrapCalls === 2) { chosenGoal = receipt(request); return tool('initiative_goal_accept', { id: chosenGoal.id, expectedRevision: chosenGoal.revision, reason: 'I choose this bounded question from the current operating opportunity.' }); }
      return stop('First initiative chosen; no identity claim.');
    }
    inquiryCalls++;
    if (inquiryCalls === 1) return tool('workspace_discover', {});
    if (inquiryCalls === 2) { const goal = app!.goals.goal('chosen-first-inquiry')!; return tool('initiative_goal_progress', { id: goal.id, expectedRevision: goal.revision, decision: { kind: 'complete', reason: 'Actual bounded workspace discovery inspected.', evidenceIds: app!.runtime.observations(frame.runId).map(o => o.id) } }); }
    return stop('Finite first inquiry complete.');
  };
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest });
    assert.equal(app.store.list('communications.inputs').length, 0);
    await app.start();
    await eventually(() => app!.goals.goal('chosen-first-inquiry'), goal => goal?.status === 'completed');
    await eventually(() => app!.store.list<any>('runs'), rows => rows.every(row => row.value.status === 'completed'));
    assert.equal(bootstrapCalls, 3); assert.equal(inquiryCalls, 3);
    const marker = app.store.get<{ runId: string }>('host.bootstrap', 'development:v1')!;
    const used = app.resources.snapshot('operating-envelope:v1'); assert.equal(used.requests, 10); assert.equal(used.tokens, 720);
    assert.equal(app.store.list('development.self').length, 0);
    await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest: async () => { throw new Error('Bootstrap must not repeat'); } });
    await app.start(); await app.tick();
    assert.deepEqual(app.store.get('host.bootstrap', 'development:v1'), marker);
    assert.equal(app.resources.snapshot('operating-envelope:v1').requests, used.requests);
    assert.equal(app.store.list('communications.inputs').length, 0);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('an extension that writes then throws an untyped error holds the physical outcome', async () => {
  const f = fixture(); let app: AutarkApplication | undefined; let calls = 0;
  try {
    app = new AutarkApplication({ ...f, secrets,
      additionalTools: ({ store }) => [{ name: 'extension_partial', description: 'Fixture partial mutation', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { store.put('fixture.extension', 'partial', true, null); throw new Error('untyped failure after mutation'); } }],
      performRequest: async () => { calls++; return calls === 1 ? tool('extension_partial', {}) : stop('Must not retry unknown mutation'); },
    });
    const run = receive(app, f, 'extension-partial');
    await eventually(() => app!.runtime.getRun(run.id), run => ['blocked', 'completed', 'waiting'].includes(run?.status ?? ''));
    assert.equal(app.store.get('fixture.extension', 'partial')?.value, true);
    assert.equal(app.runtime.getRun(run.id)?.status, 'blocked'); assert.equal(calls, 1);
    assert.equal((await app.effects.reconcile(app.effects.unresolved(run.id)[0]!.id, f.authority)).status, 'uncertain');
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('fresh development admission preserves an exhausted allowance without provider calls or repeated runs', async () => {
  const f = fixture(); delete f.config.bootstrapInitiative;
  f.config.resources.maxRequests = 0; let app: AutarkApplication | undefined;
  try {
    const performRequest = async () => { throw new Error('Exhausted host must not dispatch a model'); };
    app = new AutarkApplication({ ...f, secrets, performRequest });
    await app.start(); const marker = app.store.get<{ runId: string }>('host.bootstrap', 'development:v1')!;
    await eventually(() => app!.runtime.getRun(marker.value.runId), run => run?.status === 'blocked');
    await app.tick(); assert.equal(app.store.list('runs').length, 1); assert.equal(app.resources.snapshot('operating-envelope:v1').requests, 0);
    await app.close(); app = new AutarkApplication({ ...f, secrets, performRequest }); await app.start(); await app.tick();
    assert.equal(app.store.list('runs').length, 1); assert.equal(app.runtime.getRun(marker.value.runId)?.status, 'blocked');
    assert.ok(app.memory.get('host:development-bootstrap:v1', { kind: 'public' }));
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('child admission cannot leave an ordinary run when child authority registration fails', async () => {
  const f = fixture(); let app: AutarkApplication | undefined;
  try {
    app = new AutarkApplication({ ...f, secrets, performRequest: async () => stop('No dispatch expected') });
    app.communications.options.onReady = undefined;
    const parent = receive(app, f, 'atomic-parent');
    const prepared = (app as any).mindTools(parent.id).find((tool: any) => tool.name === 'delegation_prepare').execute({});
    const task = { id: 'atomic-child', parentRunId: parent.id, parentGoalId: 'finite-fixture', objective: 'Read bounded workspace evidence', acceptanceCriteria: ['Actual read result'], inputs: [], writablePaths: [prepared.workspace], allowedEffects: ['workspace_read'], resources: prepared.grant.resources, modelPolicy: prepared.grant.modelProfiles[0], scope: prepared.grant.scope, provenance: { sourceIds: ['authenticated-fixture'], actorId: f.authority.generation, recordedAt: new Date().toISOString(), derivation: 'interpreted' as const }, outputLocation: 'result.txt', cancellationConditions: ['parent cancellation'], maxDepth: 1 };
    app.delegation.create(task);
    const original = app.store.put.bind(app.store);
    app.store.put = ((namespace: string, ...args: any[]) => { if (namespace === 'host.child-runs') throw new Error('injected child grant failure'); return (original as any)(namespace, ...args); }) as typeof app.store.put;
    await assert.rejects(app.delegation.options.executeChild(task, new AbortController().signal), /injected child grant/);
    assert.deepEqual(app.store.list('runs').map(row => row.key), [parent.id]);
    assert.deepEqual(app.store.list('host.run-grants').map(row => row.key), [parent.id]);
  } finally { await app?.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true }); }
});
