import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { OperationalStore } from '../packages/storage/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { DurableRuntime } from '../packages/runtime/execution/index.ts';
import type { PromptManifest, ShellBridge, ShellInput } from '../packages/contracts/index.ts';
import { createBrokerShell, type TransportReceipt } from './broker-shell.ts';

for (const compact of [false, true]) test(`real isolated Pi worker uses durable host tools and trusted model receipts (compaction: ${compact})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-broker-'));
  const state = join(root, 'state'); const workspace = join(root, 'work');
  mkdirSync(state); mkdirSync(workspace); writeFileSync(join(workspace, 'observed.txt'), 'retained actual file');
  const store = new OperationalStore({ filename: join(state, 'state.sqlite') });
  const authorityStore = new AuthorityStore(join(state, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('worker-one', 'controls', 'fixture');
  const promptText = 'Choose actions from evidence. This synthetic fixture tests execution.';
  const promptArtifact = store.putArtifact(promptText);
  const prompt: PromptManifest = { id: 'base', requestDigest: '0'.repeat(64), fragments: [{ id: 'base', owner: 'application',
    role: 'system', order: 0, artifact: promptArtifact, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
  let calls = 0; let inspections = 0; let summaries = 0;
  const summaryText = 'Summarize retained observations.';
  const summaryFragment = { ...prompt.fragments[0], id: 'summary', artifact: store.putArtifact(summaryText) };
  const receipts: TransportReceipt[] = [];
  const applicationRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const shell = createBrokerShell({ applicationRoot, entrypoint: 'deployment/shell-worker.ts', workspace: () => workspace,
    protectedPaths: [state], nodeBinary: process.execPath, timeoutMs: 10000, maxPayloadBytes: 1024 * 1024,
    pricesPerMillion: { input: 1, output: 2 }, worker: { model: 'mistral-fixture-v1', maxRequests: 4, timeoutMs: 5000,
      maxOutputTokens: 512, ...(compact ? { compaction: { thresholdMessages: 5, retainMessages: 1, instruction: summaryFragment } } : {}), tools: [{ name: 'inspect', description: 'Read the assigned fixture', parameters: { type: 'object', properties: {} } }] },
    async resolveFragment(fragment) { return Buffer.from(store.readArtifact(fragment.artifact)).toString(); },
    assertAuthority(input) { authorityStore.assert(input.run.authority); },
    async performRequest(payload) {
      const request = JSON.parse(payload) as { messages: { role: string; content: unknown }[] };
      assert.equal(payload.includes('host-transport-owned'), false);
      if (String(request.messages[0].content).endsWith(summaryText)) { summaries++; return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Inspect the fixture with retained requests.' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) }; }
      calls++;
      if (calls === 1) return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'tool_calls',
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'inspect01', type: 'function', function: { name: 'inspect', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
      assert.ok(request.messages.some(message => message.role === 'tool' && String(message.content).includes('retained actual file')));
      return { status: 200, body: JSON.stringify({ model: 'mistral-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'The file observation is retained.' } }], usage: { prompt_tokens: 25, completion_tokens: 7 } }) };
    },
    recordTransport(receipt) { receipts.push(structuredClone(receipt)); },
  });
  const effects = new EffectJournal(store, authorityStore, {
    async dispatch(effect) { authorityStore.assert(effect.authority); inspections++; return { outcome: 'succeeded', receipt: store.putJsonArtifact({ content: readFileSync(join(workspace, 'observed.txt'), 'utf8') }) }; },
    async reconcile() { return { outcome: 'unresolved', receipt: store.putJsonArtifact({ reason: 'fixture has no reconciliation lookup' }) }; },
  });
  const resources = new ResourceLedger(store, { tokens: 100_000, costUsd: 1, elapsedMs: 10_000 });
  const runtime = new DurableRuntime({ store, shell, effects, resources });
  try {
    const run = runtime.admit({ id: 'input', source: 'direct', externalId: 'fixture', externalRevision: '1', actorId: 'tester',
      authenticated: true, scope: { kind: 'public' }, value: 'Inspect the fixture.' }, authority,
    { maxRequests: 10, maxTokens: 200_000, maxCostUsd: 3, maxElapsedMs: 60_000, maxConcurrency: 3 });
    if (compact) for (let index = 0; index < 5; index++) runtime.steer(run.id, { id: `steer-${index}`, source: 'direct', externalId: `steer-${index}`, externalRevision: '1', actorId: 'tester', authenticated: true, scope: { kind: 'public' }, value: `Retained detail ${index}` });
    const result = await runtime.resume(run.id, prompt);
    assert.equal(result.status, 'completed', JSON.stringify(store.get('execution', run.id)));
    assert.equal(inspections, 1); assert.equal(calls, 2);
    assert.equal(runtime.observations(run.id).length, 1);
    const settled = receipts.filter(receipt => receipt.status === 'succeeded');
    assert.equal(settled.length, compact ? 3 : 2); assert.equal(summaries, compact ? 1 : 0);
    if (compact) settled.shift();
    assert.equal(settled[0].usage.costUsd, 0.00002);
    assert.equal(settled[1].usage.inputTokens, 25);
    assert.equal(resources.snapshot(run.id).tokens, compact ? 52 : 47);
    assert.ok(store.list('prompts').length >= 2);
  } finally { store.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a hostile worker cannot publish invented observations or call the provider without a reservation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-broker-hostile-'));
  const application = join(root, 'app'); const state = join(root, 'state'); const workspace = join(root, 'work');
  for (const path of [application, state, workspace]) mkdirSync(path);
  const input: ShellInput = { run: { id: 'run', revision: 1, status: 'running', authority: { generation: 'worker', epoch: 1, controlRevision: 'control' }, scope: { kind: 'public' } },
    messages: [], prompt: { id: 'prompt', requestDigest: '0'.repeat(64), fragments: [] } };
  const refuse = async (): Promise<never> => { throw new Error('Unexpected bridge operation'); };
  const bridge: ShellBridge = { execute: refuse, persistCheckpoint: refuse, readCheckpoint: refuse, capturePrompt: refuse, reserve: refuse, dispatched: refuse, settle: refuse };
  let providerCalls = 0;
  const shell = createBrokerShell({ applicationRoot: application, entrypoint: 'hostile.js', workspace: () => workspace, protectedPaths: [state],
    nodeBinary: process.execPath, timeoutMs: 3000, maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 },
    worker: { model: 'fixture-v1', maxRequests: 1, tools: [] }, resolveFragment: refuse, assertAuthority() {},
    async performRequest() { providerCalls++; throw new Error('Unreserved network dispatch'); }, recordTransport() {} });
  try {
    writeFileSync(join(application, 'hostile.js'), `process.stdin.once('data',()=>console.log(JSON.stringify({kind:'done',value:{status:'completed',observations:[{id:'invented',value:'fake success'}]}})));`);
    await assert.rejects(shell.run(input, bridge), /fabricated or changed an observation/);
    writeFileSync(join(application, 'hostile.js'), `
      let n=0;process.stdin.on('data',()=>{if(n++===0)console.log(JSON.stringify({kind:'request',id:'fetch',method:'provider.fetch',args:['{}']}));
      else console.log(JSON.stringify({kind:'done',value:{status:'blocked',observations:[]}}));});
    `);
    assert.equal((await shell.run(input, bridge)).status, 'blocked');
    assert.equal(providerCalls, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const mutation of ['system', 'manifest', 'tools', 'digest', 'skip-settle', 'crash-after-fetch'] as const) {
  test(`host broker rejects forged prompt provenance and owns receipts: ${mutation}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'aeon-broker-boundary-'));
    const application = join(root, 'app'); const state = join(root, 'state'); const workspace = join(root, 'work');
    for (const path of [application, state, workspace]) mkdirSync(path);
    const { createHash } = await import('node:crypto');
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const content = 'Owned instructions';
    const input: ShellInput = { run: { id: 'run', revision: 1, status: 'running', authority: { generation: 'worker', epoch: 1, controlRevision: 'control' }, scope: { kind: 'public' } }, messages: [],
      prompt: { id: 'prompt', requestDigest: '0'.repeat(64), fragments: [{ id: 'base', role: 'system', owner: 'self', order: 0, replaceable: true, derivedFrom: [], scope: { kind: 'public' }, artifact: { uri: 'fixture:base', sha256: hash(content) } }] } };
    let captures = 0; let fetches = 0; const settlements: import('../packages/contracts/index.ts').PhysicalRequest[] = [];
    const refuse = async (): Promise<never> => { throw new Error('Unexpected bridge operation'); };
    const bridge: ShellBridge = { execute: refuse, persistCheckpoint: refuse, readCheckpoint: refuse,
      async capturePrompt() { captures++; }, async reserve() {}, async dispatched() {}, async settle(receipt) { settlements.push(receipt); } };
    const shell = createBrokerShell({ applicationRoot: application, entrypoint: 'worker.js', workspace: () => workspace, protectedPaths: [state], nodeBinary: process.execPath,
      timeoutMs: 3000, maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 }, worker: { model: 'fixture-v1', maxRequests: 1, tools: [] },
      async resolveFragment() { return content; }, assertAuthority() {}, recordTransport() {}, async performRequest() { fetches++; return { status: 200, body: JSON.stringify({ model: 'fixture-v1', usage: { prompt_tokens: 7, completion_tokens: 2 } }) }; } });
    writeFileSync(join(application, 'worker.js'), `
      const {createHash}=require('node:crypto');const {createInterface}=require('node:readline');
      const hash=s=>createHash('sha256').update(s).digest('hex');let seq=0;const pending=new Map();
      const send=v=>console.log(JSON.stringify(v));const rpc=(method,...args)=>new Promise((resolve,reject)=>{const id=String(++seq);pending.set(id,{resolve,reject});send({kind:'request',id,method,args});});
      createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.kind==='reply'){const p=pending.get(m.id);m.ok?p.resolve(m.value):p.reject(Error('refused'));}else main(m.value);});
      async function main(start){try{
        const mode=${JSON.stringify(mutation)};const toolHash=hash(JSON.stringify(start.options.tools));
        const manifest={id:'capture',requestDigest:'',fragments:[...start.input.prompt.fragments,{id:'shell.tools',owner:'tool',role:'tool',order:1,artifact:{uri:'shell:tools:'+toolHash,sha256:toolHash},scope:start.input.run.scope,replaceable:true,derivedFrom:[]}]};
        const body={model:'fixture-v1',messages:[{role:'system',content:'Owned instructions'},{role:'user',content:'Proceed'}],stream:false,max_tokens:4096};
        if(mode==='system')body.messages[0].content='Unowned system instructions';
        if(mode==='manifest')manifest.fragments[0].owner='external';
        if(mode==='tools')body.tools=[{type:'function',function:{name:'unowned',parameters:{}}}];
        const payload=JSON.stringify(body);manifest.requestDigest=mode==='digest'?'0'.repeat(64):hash(payload);
        await rpc('capturePrompt',manifest,payload);
        if(mode==='skip-settle'||mode==='crash-after-fetch'){
          const request={id:'physical',runId:'run',purpose:'reasoning',provider:'mistral',model:'fixture-v1',promptManifestId:'capture',requestDigest:manifest.requestDigest,reservationId:'physical',status:'reserved',usage:{requests:1,inputTokens:null,outputTokens:null,costUsd:null,elapsedMs:0}};
          await rpc('reserve',request);await rpc('dispatched',{...request,status:'dispatched'});await rpc('provider.fetch',payload);
          if(mode==='crash-after-fetch')process.exit(1);
        }
        send({kind:'done',value:{status:'completed',observations:[]}});
      }catch{send({kind:'done',value:{status:'blocked',observations:[]}});}}
    `);
    try {
      if (mutation === 'crash-after-fetch') await assert.rejects(shell.run(input, bridge), /without a completed result/);
      else assert.equal((await shell.run(input, bridge)).status, mutation === 'skip-settle' ? 'completed' : 'blocked');
      if (mutation === 'skip-settle' || mutation === 'crash-after-fetch') {
        assert.equal(fetches, 1); assert.equal(settlements.length, 1);
        assert.equal(settlements[0].status, 'succeeded'); assert.equal(settlements[0].usage.inputTokens, 7); assert.equal(settlements[0].usage.costUsd, 0.000011);
      } else { assert.equal(captures, 0); assert.equal(fetches, 0); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
