import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { canonicalJson, identity, type DataScope, type JsonValue } from '../packages/contracts/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { nodeMemoryEnvironment, nodeMemoryWallClock, type MemoryEnvironment } from '../packages/development/environment.ts';
import { OperationalStore, type HistoricalSourceUse } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';
import { mindDevelopmentTools } from './development-tools.ts';

const at = '2040-01-02T03:04:05.000Z', deadline = '2040-01-02T03:04:06.000Z';
const scope = { kind: 'public' as const };
const request = { audience: scope, query: '', maxRecords: 20, maxBytes: 32768 };
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const limits = { maxRows: 512, maxBytes: 1_000_000 };
function fixture(t: TestContext, ports?: MemoryEnvironment) {
  const root = mkdtempSync(join(tmpdir(), 'di04-heldout-')), filename = join(root, 'state.sqlite');
  const stores: OperationalStore[] = [];
  let wall = at, withdrawal = 0;
  const environment = ports ?? { monotonicNow: () => 7, compareIds: lexical, withdrawalId: () => `review:${++withdrawal}` };
  t.after(() => { for (const store of stores) store.close(); rmSync(root, { recursive: true, force: true }); });
  const open = () => { const store = new OperationalStore({ filename, documentJournal: { stream: 'review', hostId: 'synthetic', maxAnchorDocuments: 128, maxAnchorBytes: 200000 } }); stores.push(store); return store; };
  const store = open(), memory = new DevelopmentalMemory(store, () => wall, environment);
  return { store, memory, environment, open, setWall(value: string) { wall = value; }, snapshot: () => store.captureDevelopmentSnapshot(limits) };
}
function ingest(memory: DevelopmentalMemory, id: string, expiry: string | null = null, audience: DataScope = scope) {
  return memory.ingest({ id, runId: 'synthetic-run', sourceId: `input:${id}`, actorId: 'reviewer', at, channel: 'speech', scope: audience, content: `retained:${id}` }, expiry);
}
function populate(memory: DevelopmentalMemory, expiry: string | null = deadline) {
  ingest(memory, 'root', expiry);
  memory.derive({ id: 'child', sourceIds: ['root'], actorId: 'reviewer', at, kind: 'belief', scope, content: 'sensitive-derived', confidence: 0.3 });
  memory.adoptSelf({ id: 'facet', memoryIds: ['child'], actorId: 'reviewer', at, scope, category: 'preference', value: 'sensitive-self', reason: 'evidence' }, null);
  memory.scheduleConsolidation('job', ['child'], scope, at);
}

test('review: accessor-backed ports are captured once and every supplied callback is receiver-free', t => {
  const reads = { monotonic: 0, compare: 0, withdrawal: 0 }; let tick = 20;
  const ports: MemoryEnvironment = {
    get monotonicNow() { reads.monotonic++; return function (this: unknown) { assert.equal(this, undefined); return tick++; }; },
    get compareIds() { reads.compare++; return function (this: unknown, a: string, b: string) { assert.equal(this, undefined); return lexical(b, a); }; },
    get withdrawalId() { reads.withdrawal++; return function (this: unknown) { assert.equal(this, undefined); return 'captured-accessor'; }; },
  };
  const f = fixture(t, ports);
  const memory = new DevelopmentalMemory(f.store, function (this: unknown) { assert.equal(this, undefined); return at; }, ports);
  assert.deepEqual(reads, { monotonic: 2, compare: 2, withdrawal: 2 });
  for (const name of ['monotonicNow', 'compareIds', 'withdrawalId']) Object.defineProperty(ports, name, { get() { throw Error('late getter'); } });
  ingest(memory, 'a', deadline); ingest(memory, 'b', deadline);
  assert.deepEqual(memory.context({ ...request, maxRecords: 1 }).memories.map(m => m.id), ['b']);
  assert.equal(memory.context(request).selection.elapsedMs, 1);
  memory.forget(['a']); assert.ok(f.store.events().some(e => e.id === 'captured-accessor'));
});

test('review: default Node collation matches host localeCompare including equivalent Unicode', t => {
  const env = nodeMemoryEnvironment();
  const ids = ['z', 'Z', 'é', 'e\u0301', 'a', 'A', 'ä', '2', '10', 'Ω', '中'];
  for (const a of ids) for (const b of ids) assert.equal(Math.sign(env.compareIds(a, b)), Math.sign(a.localeCompare(b)));
  const f = fixture(t, env); for (const id of ids) ingest(f.memory, id);
  const storeOrder = f.store.list('development.memories').map(row => row.key);
  assert.deepEqual(f.memory.context(request).memories.map(m => m.id), storeOrder.sort((a, b) => a.localeCompare(b)));
  assert.match(nodeMemoryWallClock()(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('review: injected equal comparisons use stable Store order for memories, self and jobs', t => {
  const f = fixture(t, { monotonicNow: () => 0, compareIds: () => 0, withdrawalId: () => 'unused' });
  for (const id of ['z', 'a', 'm']) { ingest(f.memory, id); f.memory.adoptSelf({ id, memoryIds: [id], actorId: 'reviewer', at, scope, category: 'interest', value: id, reason: 'evidence' }, null); f.memory.scheduleConsolidation(id, [id], scope, at); }
  assert.deepEqual(f.memory.context(request).self.map(x => x.id), ['a', 'm', 'z']);
  assert.deepEqual(f.memory.context({ ...request, includeSelf: false }).memories.map(x => x.id), ['a', 'm', 'z']);
  assert.equal(f.memory.claimConsolidation('worker', 100)?.job.id, 'a');
});

test('review: instance-local wall, withdrawal and elapsed state do not cross-contaminate', t => {
  let firstId = 0, secondId = 0, firstTick = 100, secondTick = 0;
  const a = fixture(t, { monotonicNow: () => firstTick += 0.25, withdrawalId: () => `a:${++firstId}`, compareIds: lexical });
  const b = fixture(t, { monotonicNow: () => secondTick += 8, withdrawalId: () => `b:${++secondId}`, compareIds: lexical });
  ingest(a.memory, 'same', deadline); ingest(b.memory, 'same', deadline); a.setWall(deadline);
  a.memory.expire(); assert.ok(b.memory.get('same', scope)); assert.equal(secondId, 0);
  assert.equal(b.memory.context(request).selection.elapsedMs, 8); assert.equal(a.memory.context(request).selection.elapsedMs, 0.25);
  assert.ok(a.store.events().some(e => e.id === 'a:1')); assert.equal(b.store.events().some(e => e.id === 'a:1'), false);
});

for (const bad of ['2040-01-02', '2040-01-02T03:04:05', 'January 2, 2040 03:04:05 GMT']) test(`review: wall callback refuses non-ISO or timezone-free value ${bad}`, t => {
  const f = fixture(t); populate(f.memory); const before = f.snapshot(); f.setWall(bad);
  assert.throws(() => f.memory.get('root', scope), /timestamp|clock/i);
  assert.deepEqual(f.snapshot(), before);
});

test('review: ISO wall offsets preserve the same instant and exact expiry boundary', t => {
  const f = fixture(t); populate(f.memory);
  f.setWall('2040-01-02T04:04:05+01:00'); assert.ok(f.memory.get('child', scope));
  f.setWall('2040-01-02T04:04:06+01:00'); assert.equal(f.memory.get('child', scope), undefined);
  assert.deepEqual(new Set(f.memory.expire()), new Set(['root', 'child']));
});

for (const mode of ['throw', 'invalid'] as const) test(`review: consolidation source wall ${mode} propagates and leaves queued job unchanged`, t => {
  const f = fixture(t); populate(f.memory); const before = f.snapshot(); const fault = Error('source wall supplier failed');
  let reads = 0;
  const memory = new DevelopmentalMemory(f.store, () => { if (++reads === 1) return at; if (mode === 'throw') throw fault; return 'invalid'; }, f.environment);
  let caught: unknown;
  try { memory.claimConsolidation('worker', 100); } catch (error) { caught = error; }
  assert.deepEqual(f.snapshot(), before, 'clock failure must not be recorded as source cancellation');
  if (mode === 'throw') assert.equal(caught, fault); else assert.match(String(caught), /timestamp/);
});

test('review: genuinely expired consolidation source is still cancelled under a healthy supplied clock', t => {
  const f = fixture(t); populate(f.memory); f.setWall(deadline);
  assert.equal(f.memory.claimConsolidation('worker', 100), undefined);
  assert.equal(f.memory.jobs(scope)[0]!.state, 'cancelled');
  assert.equal(f.memory.jobs(scope)[0]!.error, 'source unavailable or revised');
});

for (const readings of [[0, 0], [0, Number.MAX_VALUE], [Number.MAX_VALUE, Number.MAX_VALUE]] as const) test(`review: finite duration readings ${readings.join(',')} remain finite and leave state unchanged`, t => {
  let index = 0; const f = fixture(t, { monotonicNow: () => readings[index++]!, compareIds: lexical, withdrawalId: () => 'unused' }); populate(f.memory);
  const before = f.snapshot(), result = f.memory.context(request);
  assert.equal(result.selection.elapsedMs, readings[1] - readings[0]); assert.equal(Number.isFinite(result.selection.elapsedMs), true); assert.deepEqual(f.snapshot(), before);
});

test('review: exact source expiry withdraws descendants, self and jobs across reopen and rejects old current-use refs', t => {
  const f = fixture(t); populate(f.memory);
  const prior = f.snapshot();
  const pages = { maxPageRows: 16, maxPageBytes: 200000, maxPages: 128, maxPhysicalRows: 2048, maxConservativeBytes: 8_000_000, maxSerializedBytes: 4_000_000, maxOperationalArtifacts: 32, maxOperationalArtifactBytes: 100000, maxOperationalArtifactTotalBytes: 1000000 };
  const retained = new Map<string, Uint8Array>();
  const retain = (bytes: Uint8Array) => { const sha256 = createHash('sha256').update(bytes).digest('hex'); retained.set(sha256, Uint8Array.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  const cut = f.store.captureDevelopmentPages(pages, retain, (_ref, bytes) => retain(bytes));
  const use: HistoricalSourceUse = { journalDigest: identity(cut.journalBinding), prefix: { lastSequence: cut.lastSequence, eventsDigest: cut.eventsDigest }, requiredVersions: prior.journalPayloads.map(p => p.ref).sort((a, b) => lexical(a.versionId, b.versionId)), maxPageRows: 16, maxPageBytes: 200000, maxPrefixBytes: 8_000_000, maxVersions: 128, maxVersionBytes: 1000000, maxWithdrawalMarkerBytes: 200000 };
  assert.equal(f.store.withDevelopmentVersionsAvailable(use, o => o.checkedVersions), prior.journalPayloads.length);
  const claim = f.memory.claimConsolidation('worker', 500)!; assert.equal(f.memory.consolidationSources(claim)[0]!.id, 'child');
  f.setWall('2040-01-02T03:04:05.500Z'); const beforeLeaseCheck = f.snapshot();
  assert.throws(() => f.memory.consolidationSources(claim), /lease expired/); assert.deepEqual(f.snapshot(), beforeLeaseCheck);
  f.setWall(deadline); assert.equal(f.memory.get('child', scope), undefined); assert.deepEqual(f.memory.selfHistory('facet', scope), []);
  assert.deepEqual(new Set(f.memory.expire()), new Set(['root', 'child']));
  const reopened = f.open(), memory = new DevelopmentalMemory(reopened, () => deadline, f.environment);
  assert.deepEqual(memory.context(request).memories, []); assert.equal(memory.jobs(scope)[0]!.state, 'cancelled');
  assert.equal(canonicalJson(reopened.captureDevelopmentSnapshot(limits)).includes('sensitive-'), false);
  let used = false; assert.throws(() => reopened.withDevelopmentVersionsAvailable(use, () => { used = true; }), /document-history-withdrawn/); assert.equal(used, false);
});

for (const failure of ['supplier', 'prior-withdrawal'] as const) test(`review: expiry ${failure} failure rolls back full state and retry completes`, t => {
  let id = 'first-marker', fail = false;
  const f = fixture(t, { monotonicNow: () => 0, compareIds: lexical, withdrawalId: () => { if (fail && failure === 'supplier') throw Error('withdrawal unavailable'); return id; } });
  ingest(f.memory, 'unrelated'); f.memory.forget(['unrelated']); populate(f.memory); f.setWall(deadline); fail = true;
  const before = f.snapshot(); assert.throws(() => f.memory.expire(), /withdrawal unavailable|conflicting withdrawal identity/); assert.deepEqual(f.snapshot(), before);
  id = 'retry-marker'; fail = false; assert.deepEqual(new Set(f.memory.expire()), new Set(['root', 'child']));
  assert.equal(f.memory.jobs(scope)[0]!.state, 'cancelled'); assert.equal(f.store.events().filter(e => e.type === 'document-journal-withdrawal').length, 2);
});

function application(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'di04-application-')); const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'Synthetic review instructions.'); writeFileSync(compactionPromptFile, 'Preserve evidence.');
  const resources = { maxRequests: 20, maxTokens: 100000, maxCostUsd: 2, maxElapsedMs: 300000, maxConcurrency: 2 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'di04-review', controlRevision: 'review-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 256, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 2, maxLifetimeSlices: 4, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'alice', scope: { kind: 'restricted', principals: ['alice'] }, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(root, 'authority.sqlite')), authority = authorityStore.bootstrap('review-instance', config.controlRevision, config.artifactId); const apps: AutarkApplication[] = [];
  t.after(async () => { for (const app of apps) await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  const open = () => { const app = new AutarkApplication({ config, authorityStore, authority, secrets: { directToken: 'synthetic-token' }, brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal }, runWorker: async () => { throw Error('worker forbidden'); }, performRequest: async () => { throw Error('transport forbidden'); }, documentJournal: { stream: 'app-review', hostId: 'synthetic', maxAnchorDocuments: 128, maxAnchorBytes: 500000 } }); apps.push(app); return app; };
  return { open, audience: config.direct.scope };
}

test('review application: actual memory composition preserves scoped tool forget and journal withdrawal across reopen', async t => {
  const f = application(t), app = f.open();
  ingest(app.memory, 'alice', null, f.audience); ingest(app.memory, 'foreign', null, { kind: 'restricted', principals: ['bob'] });
  const tools = mindDevelopmentTools(app.memory, f.audience, 'alice');
  const execute = (name: string, args: JsonValue) => tools.find(tool => tool.name === name)!.execute(args);
  assert.throws(() => execute('memory_forget', { memoryIds: ['foreign'] }), /unavailable/);
  const retrieved = execute('memory_retrieve', { query: '' }) as ReturnType<DevelopmentalMemory['context']>;
  assert.deepEqual(retrieved.memories.map(m => m.id), ['alice']); assert.equal(Number.isFinite(retrieved.selection.elapsedMs), true);
  assert.deepEqual(execute('memory_forget', { memoryIds: ['alice'] }), ['alice']);
  await app.close(); const reopened = f.open(); assert.equal(reopened.memory.get('alice', f.audience), undefined);
  assert.ok(reopened.memory.get('foreign', { kind: 'restricted', principals: ['bob'] })); assert.equal(reopened.store.list('requests').length, 0); assert.equal(reopened.directApi.listening, false);
  assert.equal(canonicalJson(reopened.store.captureDevelopmentSnapshot(limits)).includes('retained:alice'), false);
});

test('review application tools: injected memory controls expiry while captured authenticated audience resists caller changes', t => {
  const f = fixture(t); const audience: DataScope = { kind: 'restricted', principals: ['alice'] };
  ingest(f.memory, 'alice', deadline, audience); ingest(f.memory, 'bob', deadline, { kind: 'restricted', principals: ['bob'] });
  const tools = mindDevelopmentTools(f.memory, audience, 'alice'); audience.principals[0] = 'bob';
  const retrieve = tools.find(tool => tool.name === 'memory_retrieve')!, forget = tools.find(tool => tool.name === 'memory_forget')!;
  assert.deepEqual((retrieve.execute({ query: '' }) as ReturnType<DevelopmentalMemory['context']>).memories.map(m => m.id), ['alice']);
  assert.throws(() => forget.execute({ memoryIds: ['bob'] }), /unavailable/);
  f.setWall(deadline); const before = f.snapshot(); assert.throws(() => forget.execute({ memoryIds: ['alice'] }), /unavailable/); assert.deepEqual(f.snapshot(), before);
});
