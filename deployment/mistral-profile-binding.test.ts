import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { JsonValue, PhysicalRequest, ShellBridge, ShellInput } from '../packages/contracts/index.ts';
import type { WorkerOptions } from '../packages/supervisor/worker-process.ts';
import type { TransportReceipt } from './broker-shell.ts';

// Pure host tests use Node's built-in module mock; physical fixtures require an
// explicit serialized window. Neither path uses provider credentials/network.
const physical = process.env.AEON_MISTRAL_BINDING_PHYSICAL === '1';
const pure = process.execArgv.includes('--experimental-test-module-mocks');
const enabled = physical || pure;
let mockedWorkers = 0;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const MODEL = 'mistral-fixture-v1';
const content = 'Owned fixture instructions';
const payload = JSON.stringify({ model: MODEL, messages: [{ role: 'system', content }, { role: 'user', content: 'Proceed' }], stream: false, max_tokens: 512 });
const input: ShellInput = { run: { id: 'run', revision: 1, status: 'running', authority: { generation: 'fixture', epoch: 1, controlRevision: 'controls' }, scope: { kind: 'public' } }, messages: [],
  prompt: { id: 'base', requestDigest: '0'.repeat(64), fragments: [{ id: 'base', role: 'system', owner: 'application', order: 0, replaceable: true, derivedFrom: [], scope: { kind: 'public' }, artifact: { uri: 'fixture:base', sha256: hash(content) } }] } };
const manifest = { id: 'captured', requestDigest: hash(payload), fragments: [...input.prompt.fragments, { id: 'shell.tools', owner: 'tool', role: 'tool', order: 1, artifact: { uri: 'aeon:artifact:' + hash('[]'), sha256: hash('[]') }, scope: input.run.scope, replaceable: true, derivedFrom: [] }] };
const request: PhysicalRequest = { id: 'physical', runId: 'run', purpose: 'reasoning', provider: 'mistral', model: MODEL, promptManifestId: manifest.id, requestDigest: manifest.requestDigest, reservationId: 'physical', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };

async function protocol(rpc: (method: string, ...args: JsonValue[]) => Promise<JsonValue>): Promise<JsonValue> {
  await rpc('capturePrompt', manifest as JsonValue, payload);
  await rpc('reserve', request as unknown as JsonValue);
  await rpc('dispatched', { ...request, status: 'dispatched' } as unknown as JsonValue);
  let delivered = false;
  try { await rpc('provider.fetch', payload); delivered = true; } catch { /* Host refusal is the only worker-visible failure. */ }
  let replayDelivered = false;
  try { await rpc('provider.fetch', payload); replayDelivered = true; } catch { /* Same reservation cannot replay. */ }
  return { status: delivered ? 'completed' : 'blocked', observations: [], delivered, replayDelivered };
}
if (pure && !physical) mock.module('../packages/supervisor/worker-process.ts', { namedExports: {
  runWorker: async (options: WorkerOptions): Promise<JsonValue> => { mockedWorkers++; return protocol((method, ...args) => options.handle(method, args, new AbortController().signal)); },
} });
const { createBrokerShell } = await import('./broker-shell.ts');

const cases: [string, Record<string, unknown>, boolean][] = [
  ['observed standard', { model: MODEL, usage: { prompt_tokens: 7, completion_tokens: 2, service_tier: 'standard' } }, true],
  ['omitted tier request-default inference', { model: MODEL, usage: { prompt_tokens: 7, completion_tokens: 2 } }, true],
  ['different model', { model: 'different-v1', usage: { prompt_tokens: 7, completion_tokens: 2, service_tier: 'standard' } }, false],
  ['missing model', { usage: { prompt_tokens: 7, completion_tokens: 2 } }, false],
  ['nonstring model', { model: 17, usage: { prompt_tokens: 7, completion_tokens: 2 } }, false],
  ...['priority', 'auto', 'standard_only', '', null, 1, {}, ['standard']].map(tier => [`unsupported tier ${JSON.stringify(tier)}`, { model: MODEL, usage: { prompt_tokens: 7, completion_tokens: 2, service_tier: tier } }, false] as [string, Record<string, unknown>, boolean]),
];
for (const [label, response, admitted] of cases) test(`Mistral host profile binding: ${label}`, { skip: !enabled }, async () => {
  const evidence = process.env.AEON_MISTRAL_BINDING_EVIDENCE;
  const root = mkdtempSync(join(evidence ?? tmpdir(), 'mistral-binding-'));
  const application = join(root, 'app'); const state = join(root, 'state'); const workspace = join(root, 'work');
  for (const path of [application, state, workspace]) mkdirSync(path);
  let store = new OperationalStore({ filename: join(state, 'state.sqlite') });
  let ledger = new ResourceLedger(store, { tokens: 100_000, costUsd: 1, elapsedMs: 5000 }, () => 1000);
  ledger.allocate('run', { maxRequests: 1, maxTokens: 100_000, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 1 });
  const receipts: TransportReceipt[] = []; let calls = 0; let reserved: PhysicalRequest | undefined;
  const refuse = async (): Promise<never> => { throw new Error('Unexpected bridge operation'); };
  const bridge: ShellBridge = { execute: refuse, persistCheckpoint: refuse, readCheckpoint: refuse, async capturePrompt() {},
    async reserve(r) { reserved = structuredClone(r); ledger.reserve(r); }, async dispatched(r) { ledger.dispatched(r); }, async settle(r) { ledger.settle(r); } };
  const raw = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Unqualified response must not cross boundary' } }], ...response });
  store.putArtifact(raw);
  const shell = createBrokerShell({ applicationRoot: application, entrypoint: 'worker.js', workspace: () => workspace, protectedPaths: [state], nodeBinary: process.execPath,
    timeoutMs: 5000, maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 }, worker: { model: MODEL, maxRequests: 1, maxOutputTokens: 512, timeoutMs: 5000, tools: [] },
    retainToolInstructions: source => store.putArtifact(source),
    async resolveFragment(fragment) { return fragment.id === 'shell.tools' ? Buffer.from(store.readArtifact(fragment.artifact)).toString() : content; }, assertAuthority() {}, async performRequest(sent) { assert.equal(sent, payload); assert.equal(JSON.parse(sent).service_tier, undefined); calls++; return { status: 200, body: raw }; },
    recordTransport(r) { const value = structuredClone(r); receipts.push(value); store.put('transport-receipts', r.requestId, value, store.get('transport-receipts', r.requestId)?.revision ?? null); } });
  // Same request sequence as the pure mock, through the actual isolated pipe.
  writeFileSync(join(application, 'worker.js'), `const {createInterface}=require('node:readline');let seq=0;const pending=new Map();const send=x=>console.log(JSON.stringify(x));const rpc=(method,...args)=>new Promise((resolve,reject)=>{const id=String(++seq);pending.set(id,{resolve,reject});send({kind:'request',id,method,args});});createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.kind==='reply'){const p=pending.get(m.id);m.ok?p.resolve(m.value):p.reject(Error('Host refusal'));}else main();});async function main(){try{const rpcProtocol=${protocol.toString()};const manifest=${JSON.stringify(manifest)},payload=${JSON.stringify(payload)},request=${JSON.stringify(request)};send({kind:'done',value:await rpcProtocol(rpc)});}catch{send({kind:'done',value:{status:'blocked',observations:[],unexpectedProtocolFailure:true}});}}`);
  try {
    const previousMockedWorkers = mockedWorkers;
    const result = await shell.run(input, bridge) as unknown as { status: string; delivered: boolean; replayDelivered: boolean; unexpectedProtocolFailure?: boolean };
    if (!physical) assert.equal(mockedWorkers, previousMockedWorkers + 1, 'pure test must never launch a confined worker');
    const receipt = receipts.at(-1)!; const snapshot = ledger.snapshot('run');
    writeFileSync(join(root, 'summary.json'), JSON.stringify({ label, admitted, result, calls, reserved, receipts, snapshot }, null, 2));
    assert.equal(result.unexpectedProtocolFailure, undefined);
    assert.equal(result.delivered, admitted, 'unsupported response reached worker as a successful provider reply');
    assert.equal(result.status, admitted ? 'completed' : 'blocked'); assert.equal(result.replayDelivered, false); assert.equal(calls, 1);
    assert.equal(receipt.responseDigest, hash(raw)); assert.equal(receipt.responseModel, typeof response.model === 'string' ? response.model : null);
    const responseUsage = response.usage as Record<string, JsonValue>;
    assert.equal(Object.hasOwn(receipt, 'responseServiceTier'), Object.hasOwn(responseUsage, 'service_tier'));
    if (Object.hasOwn(responseUsage, 'service_tier')) assert.deepEqual(receipt.responseServiceTier, responseUsage.service_tier);
    assert.equal(receipt.status, admitted ? 'succeeded' : 'uncertain');
    assert.deepEqual({ input: receipt.usage.inputTokens, output: receipt.usage.outputTokens, cost: receipt.usage.costUsd }, admitted ? { input: 7, output: 2, cost: 0.000011 } : { input: null, output: null, cost: null });
    assert.equal(snapshot.tokens, admitted ? 9 : reserved!.usage.inputTokens! + reserved!.usage.outputTokens!);
    assert.equal(snapshot.costUsd, admitted ? 0.000011 : reserved!.usage.costUsd);
    store.close(); store = new OperationalStore({ filename: join(state, 'state.sqlite') }); ledger = new ResourceLedger(store, { tokens: 100_000, costUsd: 1, elapsedMs: 5000 }, () => 1000); ledger.recoverDispatched();
    assert.deepEqual(ledger.snapshot('run'), snapshot); assert.equal(ledger.request(request.id)!.status, receipt.status);
    if (!admitted) { ledger.settle({ ...ledger.request(request.id)!, status: 'uncertain' }); assert.deepEqual(ledger.snapshot('run'), snapshot); }
    assert.throws(() => ledger.reserve(request), /identity already used/);
    assert.throws(() => ledger.reserve({ ...request, id: 'new-attempt', reservationId: 'new-attempt' }), /budget|allocation/);
    ledger.cancel('run'); assert.deepEqual(ledger.snapshot('run'), { ...snapshot, cancelled: true });
    assert.equal(calls, 1); // Restart/reconciliation never invokes the transport.
  } finally { store.close(); if (!evidence) rmSync(root, { recursive: true, force: true }); }
});
