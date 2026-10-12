import assert from 'node:assert/strict';
import test, { mock, type TestContext } from 'node:test';
import { canonicalJson, identity, type JsonValue, type ShellBridge, type ShellInput, type ArtifactRef, type PhysicalRequest, type Effect } from '../../packages/contracts/index.ts';
import { createAgentShell, type ShellOptions } from '../../packages/agent-shell/index.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';
import { pagedRecorderFixture } from './acquisition-pages.test-fixture.ts';
import { projectDevelopmentReviewRead, type BoundedReadArguments, type BoundedReadReceipt } from './review-projection.ts';
import { developmentReviewReservation } from './review-reservation.ts';
import type { DevelopmentModelReviewOptions } from './model-review.ts';
import { developmentReviewInput } from './review-envelope.ts';

assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Explicit mocked worker required; no physical process test');
mock.module('../../packages/supervisor/worker-process.ts', { namedExports: { async runWorker(o: WorkerOptions) {
  const v = o.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const rpc = (method: string, ...args: unknown[]) => o.handle(method, args as JsonValue[], new AbortController().signal);
  const shell = createAgentShell({ ...v.options, apiKey: () => 'explicit-synthetic-no-provider', resolveFragment: async f => v.fragments[f.artifact.sha256], fetch: async (_url, init) => { const r = await rpc('provider.fetch', init!.body) as { body: string; status: number }; return new Response(r.body, { status: r.status }); } });
  const bridge: ShellBridge = {
    execute: async c => {try{return await rpc('execute',c) as unknown as Awaited<ReturnType<ShellBridge['execute']>>;}catch(error){console.error('synthetic-tool-failure',String(error));throw error;}},
    capturePrompt: async (...a) => { await rpc('capturePrompt', ...a); }, reserve: async q => { await rpc('reserve', q); }, dispatched: async q => { await rpc('dispatched', q); }, settle: async q => { await rpc('settle', q); },
    persistCheckpoint: async (...a) => {const content=a[3] as {failure?:unknown};if(content.failure)console.error('synthetic-checkpoint-failure',canonicalJson(content.failure));return await rpc('persistCheckpoint', ...a) as unknown as Awaited<ReturnType<ShellBridge['persistCheckpoint']>>;}, readCheckpoint: async q => rpc('readCheckpoint', q),
  };
  const result=await shell.run(v.input,bridge);if(result.status!=='completed')console.error('synthetic-worker-diagnostic',canonicalJson(result));return result as unknown as JsonValue;
} } });
const { runDevelopmentModelReviews } = await import('./model-review.ts');

function fixture(t: TestContext, originalBytes?: Buffer) {
  const f = pagedRecorderFixture(t, true); let sourceOriginal: ArtifactRef | undefined;
  if (originalBytes) { sourceOriginal = f.stores.get('candidate')!.putArtifact(originalBytes); f.stores.get('candidate')!.put('ordinary', 'public-original', { original:sourceOriginal }, null); }
  const recorder = f.claim(), sources = f.initial(recorder); f.setTime(0); recorder.begin(); f.setTime(180);
  const candidate = sources.get('candidate')!.accounting, behavior = recorder.freezeBehavior(candidate, sources), payloads: { role: string; payload: string }[] = [], calls = new Map<string, number>();
  const judgment = () => ({ opportunities: f.m.opportunities.map(o => ({ id: o.id, outcome: 'unavailable', reason: `Synthetic negative ${o.id}` })), controls: f.m.controls.map(o => ({ id: o.id, outcome: 'unavailable', reason: `Synthetic negative ${o.id}` })), boundaries: f.m.boundaries.map(id => ({ id, outcome: 'unavailable', reason: `Synthetic negative ${id}` })), overall: 'unavailable', reason: 'Explicit synthetic mechanics only' });
  let provide: (role: string, n: number, payload: string) => { content?: string; tool_calls?: unknown[] } | Promise<{ content?: string; tool_calls?: unknown[] }> = () => ({ content: JSON.stringify(judgment()) });
  const options: DevelopmentModelReviewOptions = { registration: f.plan.registration, behavior, trust: f.trust.envelope, original: f.original, claims: f.state, recorder, reservationTemplate: f.template, sessions: f.sessions,
    acceptedSessions: f.reviewAdmission.acceptedSessions, acceptedHostDigest: f.reviewAdmission.acceptedHostDigest, host: f.host, readInstruction: (a, n) => f.raw.readArtifact({ uri: `sha256:${a.sha256}`, sha256: a.sha256 }, n), artifactAudiences: new Map(behavior.value.artifactIndex.map(i => [i.artifact.sha256, { kind: 'public' as const }])),
    async performRequest(role, payload) { payloads.push({ role, payload }); const n = (calls.get(role) ?? 0) + 1; calls.set(role, n); const message = await provide(role, n, payload); return { status: 200, body: JSON.stringify({ model: f.sessions.find(s => s.roleId === role)!.profile.id, choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', ...message } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) }; },
  };
  const args = (selector: BoundedReadArguments['selector'], cursor = { index: 0, offset: 0 }): BoundedReadArguments => ({ version: 1, behaviorDigest: identity(behavior.value), selector, cursor });
  const tool = (a: BoundedReadArguments, id = 'read') => ({ id, type: 'function', function: { name: 'evidence_read', arguments: JSON.stringify(a) } });
  return { ...f, recorder, candidate, behavior, options, payloads, calls, judgment, args, tool, sourceOriginal, setProvider: (p: typeof provide) => { provide = p; }, run: () => runDevelopmentModelReviews(options) };
}

function admit(g:ReturnType<typeof fixture>) {
  const reservations=g.recorder.withEvidenceRead(read=>g.sessions.map(s=>developmentReviewReservation(s,g.plan.roles.find(r=>r.roleId===s.roleId)!,{manifest:g.m,registration:g.registration,template:g.template,behavior:g.behavior.value,instructionBytes:s.prompt.fragments.map(f=>({artifact:f.artifact,bytes:read({uri:`sha256:${f.artifact.sha256}`,sha256:f.artifact.sha256},s.plan.maxPayloadBytes)}))})));
  g.recorder.admitModelReviews(g.sessions,g.host,g.template,reservations);return reservations;
}

test('exact dispatched receipts deduplicate charged drafts and settle late, while unrelated and cross-request reads refuse',async t=>{
  const g=fixture(t);admit(g);const role=g.sessions[0]!.roleId,a=g.bridge(g.recorder,role),local=g.stores.get(role)!;a.resources.allocate(g.registration.rootId,a.role.resources);a.resources.allocate('review',a.role.resources,g.registration.rootId);
  const raw=g.recorder.rawStoreForRole(role),firstBytes=Buffer.from('synthetic first receipt'),lateBytes=Buffer.from('synthetic late receipt'),first=raw.putBytes(firstBytes),late=raw.putBytes(lateBytes),unrelated=raw.putBytes(Buffer.from('unmapped draft'));
  const make=(id:string):PhysicalRequest=>{const call={id,runId:'review',stepId:'step',name:'evidence_read',arguments:g.args({kind:'collection',name:'findings'}) as unknown as JsonValue};a.captureTool(call);return{id:`tool:${id}`,runId:'review',purpose:'reasoning',provider:'effect-receiver',model:'evidence_read',promptManifestId:`tool:${id}`,requestDigest:identity(call),reservationId:`tool:${id}`,status:'reserved',usage:{requests:1,inputTokens:0,outputTokens:0,costUsd:0,elapsedMs:0}};};
  const q=make('first'),q2=make('late');a.resources.reserve(q);const id=a.requestId(q.id),id2=a.requestId(q2.id);
  assert.throws(()=>g.recorder.retainResponse(id,firstBytes),/undispatched/);a.resources.dispatched({...q,status:'dispatched'});a.resources.reserve(q2);a.resources.dispatched({...q2,status:'dispatched'});
  assert.throws(()=>g.recorder.readRetainedResponse(id,first,8192),/scope/);assert.throws(()=>g.recorder.readRetainedResponse(id,unrelated,8192),/scope/);
  let start!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{start=r;}),wait=new Promise<void>(r=>{release=r;});
  const receiver=a.wrapReceiver({dispatch:async effect=>{if(effect.id===q2.id){start();await wait;}return{outcome:'succeeded' as const,receipt:local.putArtifact(effect.id===q.id?firstBytes:lateBytes)};},reconcile:async()=>{throw new Error('No synthetic reconciliation');}});
  const effect=(request:PhysicalRequest):Effect=>({id:request.id,runId:request.runId,stepId:'step',kind:'evidence_read',payload:{},scope:{kind:'public'},authority:{generation:'synthetic',epoch:1,controlRevision:'synthetic-controls'},status:'dispatched',revision:0,reservationId:request.reservationId});
  await receiver.dispatch(effect(q));a.resources.settle({...q,status:'succeeded'});
  const charged=g.recorder.status().inventory.find(i=>i.artifact.sha256===first.sha256)!;assert.equal(charged.pool,'draft');assert.equal(charged.slot,'review-draft');assert.ok(g.recorder.readRetainedResponse(id,first,8192).equals(firstBytes));assert.equal(g.recorder.status().reservations[id]!.responseLimit,8192);
  assert.throws(()=>g.recorder.readRetainedResponse(id2,first,8192),/scope/);assert.throws(()=>g.recorder.readRetainedResponse(id,{...first,uri:`alias:${first.sha256}`},8192),/scope/);assert.throws(()=>g.recorder.readRetainedResponse(id,{...first,sha256:late.sha256},8192),/scope/);assert.throws(()=>g.recorder.readRetainedResponse(id,unrelated,8192),/scope/);
  const pending=receiver.dispatch(effect(q2));await entered;g.recorder.withdrawAttemptUse('synthetic-maintenance');g.recorder.fail('synthetic-failure',new Error('stopped admission'));release();await pending;a.resources.settle({...q2,status:'succeeded'});
  assert.equal(g.recorder.status().phase,'failed');assert.ok(g.recorder.readRetainedResponse(id2,late,8192).equals(lateBytes));assert.equal(g.recorder.status().inventory.find(i=>i.artifact.sha256===late.sha256)!.pool,'draft');assert.throws(()=>g.recorder.readArtifact(late,8192),/withdrawn/);assert.equal(g.original.snapshot(g.registration.rootId).requests,2);
});

test('actual entry rejects substituted wire estimates and enforces its protected draft byte promise',t=>{
  const g=fixture(t),reservations=admit(g);assert.throws(()=>g.recorder.admitModelReviews(g.sessions,g.host,g.template,reservations.map(r=>({...r,draftBytes:1}))),/canonical wire/);
  const role=g.sessions[0]!.roleId,raw=g.recorder.rawStoreForRole(role),limit=reservations[0]!.draftBytes;let remaining=limit,n=0;while(remaining>0){const amount=Math.min(100000,remaining);raw.putBytes(Buffer.alloc(amount,++n));remaining-=amount;}
  const before=g.recorder.status().inventory.length;assert.equal(g.recorder.status().draftBytes[role],limit);assert.throws(()=>raw.putBytes(Buffer.from('no hidden reviewer bytes')),/protected bytes\/slots/);assert.equal(g.recorder.status().inventory.length,before);assert.equal(g.original.snapshot(g.registration.rootId).requests,0);
});

test('absent accepted inputs, old8KiB and insufficient review slots refuse before raw and owner claims', t => {
  const f = pagedRecorderFixture(t), before = f.raw.usage(); assert.throws(() => f.claim(), /Reviewer preclaim admission/); assert.deepEqual(f.raw.usage(), before); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  const g = pagedRecorderFixture(t, true), source = g.raw.usage();
  const rp = g.plan.roles.find(r => r.roleId === g.sessions[0].roleId)!; rp.maxPayloadBytes = 8192; g.sessions[0].plan.maxPayloadBytes = 8192; g.reviewAdmission.acceptedSessions = new Map(g.sessions.map(s => [s.roleId, identity(s)])); g.accept(); assert.throws(() => g.claim(), /Canonical review|Reviewer preclaim/); assert.deepEqual(g.raw.usage(), source); assert.equal(g.state.get('development.acquisition', g.plan.id), undefined);
  rp.maxPayloadBytes = 131072; g.sessions[0].plan.maxPayloadBytes = 131072; g.reviewAdmission.acceptedSessions = new Map(g.sessions.map(s => [s.roleId, identity(s)])); g.plan.capacity.maxArtifacts = 13415; g.accept(); assert.throws(() => g.claim(), /artifact slots/); assert.deepEqual(g.raw.usage(), source); assert.equal(g.original.snapshot(g.registration.rootId).requests, 0);
});

test('actual bounded collection tools retain receipt metadata and complete original-accounted final envelope', async t => {
  const g = fixture(t); g.setProvider((_role, n) => n === 1 ? { tool_calls: [g.tool(g.args({ kind: 'collection', name: 'behaviorHeader' }))] } : { content: JSON.stringify(g.judgment()) });
  const result = await g.run(); assert.ok(result.roles.every(r => r.status === 'completed'), canonicalJson(result.roles)); assert.equal(result.accounting.usage.requests, 6); assert.equal(g.payloads.length, 4);
  for (const role of result.roles) {
    const execution = role.binding!.value.execution.value; assert.equal(execution.inputMode, 'bounded-sections-v1'); assert.equal(execution.evidenceReads.length, 1);
    const access = execution.evidenceReads[0]!; assert.ok('receipt' in access); const receipt = JSON.parse(g.recorder.readArtifact(access.receipt, 2048).toString()) as BoundedReadReceipt; assert.equal(receipt.behaviorDigest, identity(g.behavior.value)); assert.equal(receipt.next, null);
    const event = result.transitions.find(t => t.state.request.id === access.requestId && t.state.request.status === 'succeeded')!; assert.equal(event.settlement!.value.response!.sha256, access.receipt.sha256);
    const call = JSON.parse(g.recorder.readArtifact(event.state.payload, 131072).toString()); assert.deepEqual(call.arguments, g.args({ kind: 'collection', name: 'behaviorHeader' })); assert.equal(call.id, access.localToolCallId);
    const payload = JSON.parse(g.payloads.findLast(p => p.role === role.roleId)!.payload); assert.ok(payload.messages.some((m: any) => m.role === 'user' && m.content === canonicalJson(developmentReviewInput(g.behavior.value, role.roleId)))); assert.ok(payload.messages.some((m: any) => m.role === 'tool' && m.content.includes(access.receipt.sha256)));
  }
  const closed = g.recorder.close(g.candidate, result.roles.map(r => r.binding!)); assert.equal(closed.automaticReleaseEligible, false); assert.equal(closed.h1Eligible, false); assert.equal(g.recorder.status().phase, 'closed'); assert.equal(g.recorder.status().proofs!.filter(p => p.kind === 'review-judgment').length, 48);
});

test('binary indexed-original pages debit complete I/O and expose only accounted canonical receipts', async t => {
  const bytes = Buffer.from([0, 255, 254, 128, 65]), g = fixture(t, bytes), indexed = g.behavior.value.artifactIndex.find(i => i.artifact.sha256 === g.sourceOriginal!.sha256)!;
  g.setProvider((_role, n) => n === 1 ? { tool_calls: [g.tool(g.args({ kind: 'original', artifact: indexed.artifact }))] } : { content: JSON.stringify(g.judgment()) });
  const result = await g.run(); assert.ok(result.roles.every(r => r.status === 'completed'), canonicalJson(result.roles));
  for (const role of result.roles) { const access = role.evidenceReads[0]!; assert.ok('receipt' in access); const receiptBytes = g.recorder.readArtifact(access.receipt, 2048), receipt = JSON.parse(receiptBytes.toString()) as BoundedReadReceipt; assert.equal(receipt.records[0]!.encoding, 'base64'); assert.ok(Buffer.from(receipt.records[0]!.content, 'base64').equals(bytes)); const claim = g.state.get<{ readBytes: number }>('development.model-review', `${g.registration.rootId}:${identity(g.registration)}:${role.roleId}`)!.value; assert.equal(claim.readBytes, receiptBytes.byteLength + bytes.byteLength); }
});

test('two bounded UTF8 pages in one assistant turn remain exact and fully accounted', async t => {
  const text = Buffer.from('α\u0000🙂'.repeat(500)), g = fixture(t, text), indexed = g.behavior.value.artifactIndex.find(i => i.artifact.sha256 === g.sourceOriginal!.sha256)!, firstArgs = g.args({ kind: 'original', artifact: indexed.artifact }), first = projectDevelopmentReviewRead(g.behavior.value, firstArgs, (a, n) => g.recorder.readArtifact(a, n), { maxReceiptBytes: 2048, remainingReadBytes: 2100000 }), next = (JSON.parse(Buffer.from(first.bytes).toString()) as BoundedReadReceipt).next!;
  assert.ok(next); g.setProvider((_role, n) => n === 1 ? { tool_calls: [g.tool(firstArgs, 'page-0'), g.tool(g.args(firstArgs.selector, next), 'page-1')] } : { content: JSON.stringify(g.judgment()) });
  const result = await g.run(); assert.ok(result.roles.every(r => r.status === 'completed' && r.evidenceReads.length === 2), canonicalJson(result.roles)); assert.equal(result.accounting.usage.requests, 8);
  for (const role of result.roles) { const receipts = role.evidenceReads.map(a => { assert.ok('receipt' in a); return JSON.parse(g.recorder.readArtifact(a.receipt, 2048).toString()) as BoundedReadReceipt; }); const chunk = Buffer.concat(receipts.flatMap(r => r.records.map(v => Buffer.from(v.content, v.encoding === 'utf8' ? 'utf8' : 'base64')))); assert.ok(text.subarray(0, chunk.byteLength).equals(chunk)); assert.equal(receipts[1]!.cursor.offset, next.offset); }
});

test('current inventory reader lease rejects escape, throw, thenable, alias and oversize reads', t => {
  const g = fixture(t), artifact = g.behavior.value.artifactIndex[0]!.artifact; let escaped!: (a: ArtifactRef, n: number) => Uint8Array;
  g.recorder.withEvidenceRead(read => { escaped = read; assert.ok(read(artifact, 1000000).byteLength > 0); }); assert.throws(() => escaped(artifact, 1000000), /escaped/);
  assert.throws(() => g.recorder.withEvidenceRead(read => { escaped = read; throw new Error('callback throw'); }), /callback throw/); assert.throws(() => escaped(artifact, 1000000), /escaped/);
  assert.throws(() => g.recorder.withEvidenceRead(read => { escaped = read; return Promise.resolve('no'); }), /synchronous|thenable/); assert.throws(() => escaped(artifact, 1000000), /escaped/);
  assert.throws(() => g.recorder.withEvidenceRead(read => read({ ...artifact, uri: `alias:${artifact.sha256}` }, 1000000)), /Exact inventory/); assert.throws(() => g.recorder.withEvidenceRead(read => read(artifact, 1000001)), /Bounded operational/); g.recorder.assertCurrentUse(); assert.equal(g.recorder.status().useDisposition, null);
});

test('scoped review reader cannot write source or reenter a current-use reader',t=>{
  const g=fixture(t),store=g.stores.get('candidate')!;
  assert.throws(()=>g.recorder.withEvidenceRead(()=>store.put('ordinary','illegal-lease-write','no',null)),/development/);assert.equal(store.get('ordinary','illegal-lease-write'),undefined);
  assert.throws(()=>g.recorder.withEvidenceRead(()=>g.recorder.withEvidenceRead(()=>null)),/Owner writer transaction cannot enter current-use guard/);assert.equal(g.original.snapshot(g.registration.rootId).requests,0);
});

test('real bounded reads survive invalid later judgment and interrupted one-use replay', async t => {
  const g = fixture(t); g.setProvider((_role, n) => n === 1 ? { tool_calls: [g.tool(g.args({ kind: 'collection', name: 'findings' }))] } : { content: 'invalid final judgment' });
  const result = await g.run(); assert.ok(result.roles.every(r => r.status === 'unavailable' && r.evidenceReads.length === 1)); const count = g.payloads.length; const again = await g.run(); assert.ok(again.roles.every(r => r.status === 'unavailable' && r.evidenceReads.length === 1)); assert.equal(g.payloads.length, count);
});

test('source withdrawal during awaited model preserves authentic response and prevents another model entry', async t => {
  const g = fixture(t), before = g.recorder.status().inventory.map(i => i.artifact.sha256); g.setProvider(async () => { await Promise.resolve(); g.recorder.withdrawAttemptUse('synthetic-model-await'); return { content: JSON.stringify(g.judgment()) }; });
  await assert.rejects(g.run, /withdrawn/); assert.equal(g.payloads.length, 1); const response = g.recorder.status().inventory.find(i => i.pool === 'response')!; assert.ok(response); const request = Object.values(g.recorder.status().reservations)[0]!; assert.ok(g.recorder.readRetainedResponse(Object.keys(g.recorder.status().reservations)[0]!, response.artifact, 8192).byteLength > 0); assert.equal(request.responseArtifacts.length, 1); for (const sha of before) assert.ok(g.recorder.status().inventory.some(i => i.artifact.sha256 === sha)); assert.equal(g.original.snapshot(g.registration.rootId).requests, 1); await assert.rejects(g.run, /withdrawn/); assert.equal(g.payloads.length, 1);
});

test('template acceptance and actual ToolCall identity limits refuse before tool dispatch', async t => {
  const g = fixture(t); g.options.reservationTemplate = { ...g.template, localIdMaxUnits: 129 }; await assert.rejects(g.run, /substituted|template/); assert.equal(g.payloads.length, 0); assert.equal(g.state.list('development.model-review').length, 0); g.options.reservationTemplate = g.template;
  g.setProvider((_role, n) => n === 1 ? { tool_calls: [g.tool(g.args({ kind: 'collection', name: 'findings' }), 'x'.repeat(256))] } : { content: JSON.stringify(g.judgment()) }); const result = await g.run(); assert.ok(result.roles.every(r => r.status === 'unavailable')); assert.equal(result.transitions.filter(t => t.state.request.provider === 'effect-receiver').length, 0); assert.equal(g.original.snapshot(g.registration.rootId).requests, 2);
});
