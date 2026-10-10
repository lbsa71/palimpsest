import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { codingOrientation } from '../src/autark.ts';
import { codingData } from '../src/coding-contracts.ts';
import { CodingSessionCoordinator } from '../src/coding-session.ts';
import { CodingAccounting } from '../src/coding-accounting.ts';
import { CodingWorkspaces, workspaceTreeDigest } from '../src/workspaces.ts';
import { Store } from '../src/store.ts';
import type { CodingArtifacts } from '../src/coding-artifacts.ts';
import type { CodingProviderGates, CodingSessionPolicy } from '../src/coding-contracts.ts';
import type { CodingMessage, CodingProviderPort, CodingStepResult } from '../src/coding-provider.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-coding-session-'));
  let store = new Store(join(root, 'state.sqlite')), now = 1000, epoch = 1, allowed = true, growthAllowed = false;
  const origin = store.enqueue({ conversationId: 'direct:fixture', source: 'direct', input: 'Synthetic coding task' }); store.updateTask(origin.id, { state: 'running', checkpoint: { calls: 0 } });
  const files = [{ path: 'src/value.txt', content: Buffer.from('1\n'), mode: 0o644 as const }, { path: 'empty', content: Buffer.from(''), mode: 0o644 as const }], base = { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: workspaceTreeDigest(files) };
  const policy: CodingSessionPolicy = { lane: { kind: 'plan', cadence: 'hourly', maxCalls: 1 }, limits: { maxWorkCalls: 4, maxSessionCalls: 4, maxAttemptCalls: 4, maxAttempts: 1, maxCommands: 2 }, expiresAt: 10_000_000, providerProfile: { provider: 'fixture', model: 'fixture-model' }, catalogVersion: 'coding-tools/1', providerLimits: { maxIntentsPerStep: 8, maxOutputTokens: 512 }, maxTranscriptMessages: 64, maxTranscriptBytes: 131072, commandTimeoutMs: 1000, maxCommandOutputBytes: 65536 };
  // Admission seam supplies a deterministic verified source; serving/source custody witnesses are root-owned.
  const source = { base, files, directories: [{ path: 'src', mode: 0o700 }], rootMode: 0o700, sourceArtifactId: 'fixture-source', manifest: { source: { files: [] } }, epoch: 1 };
  let importSource = async () => source, sourceReads = 0;
  const artifacts = { importSource: async () => { sourceReads++; return importSource(); }, readBaseFiles: () => files } as unknown as CodingArtifacts;
  let coordinator: CodingSessionCoordinator;
  let receiver = new CodingWorkspaces({ store, directory: join(root, 'drafts'), repositoryRoot: process.cwd(), authorize: a => coordinator.authorizeWorkspace(a) });
  let sent = 0, calls: CodingProviderGates[] = [];
  const histories: CodingMessage[][] = [], outcomes: string[] = [];
  let slot = async (_signal: AbortSignal): Promise<() => void> => () => {};
  let respond = async (): Promise<CodingStepResult> => replies.shift()!;
  const replies: CodingStepResult[] = [
    { status: 'ok', text: '', intents: [{ callId: 'read00001', name: 'workspace_files', arguments: '{"kind":"read","path":"src/value.txt"}' }], usage: { status: 'known', input: 2, output: 1, total: 3 }, finishReason: 'tool-calls' },
    { status: 'ok', text: 'Observed source fixture', intents: [], usage: { status: 'known', input: 2, output: 1, total: 3 }, finishReason: 'stop' },
  ];
  const factory = (gates: CodingProviderGates): CodingProviderPort => { calls.push(gates); return { async step(input) { gates.preauthorize(input.signal!); gates.reserve({ model: 'fixture-model', bodyBytes: 10, bodySha256: 'd'.repeat(64), signal: input.signal! }); sent++; histories.push(structuredClone(input.messages)); return respond(); } }; };
  const make = () => new CodingSessionCoordinator({ store, accounting: new CodingAccounting(store, { now: () => now }), workspaces: receiver, artifacts, epoch: () => epoch, authorizeOrigin: () => allowed, authorizeGrowth: () => growthAllowed, authorizeSession: () => allowed, policy: () => policy, providerFactory: factory, acquireProviderSlot: signal => slot(signal), now: () => now, onOutcome: ({ summary }) => { outcomes.push(summary); } });
  coordinator = make();
  return { root, origin, get store() { return store; }, get coordinator() { return coordinator; }, get receiver() { return receiver; }, get sent() { return sent; }, calls, policy, replies, histories, outcomes, get sourceReads() { return sourceReads; }, setSlot: (value: typeof slot) => { slot = value; }, setResponse: (value: typeof respond) => { respond = value; }, setImport: (value: typeof importSource) => { importSource = value; }, source, clock: (value: number) => { now = value; }, allow: (value: boolean) => { allowed = value; }, allowGrowth: () => { growthAllowed = true; }, epoch: (value: number) => { epoch = value; }, reopen: async () => { await coordinator.stop(); store.close(); store = new Store(join(root, 'state.sqlite')); receiver = new CodingWorkspaces({ store, directory: join(root, 'drafts'), repositoryRoot: process.cwd(), authorize: a => coordinator.authorizeWorkspace(a) }); coordinator = make(); store.recoverInterrupted(); await coordinator.adoptEpoch(); }, cleanup: async () => { await coordinator.stop(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test('admission persists a source-bound session and dedicated running owner idempotently', async () => {
  const f = fixture(); try {
    const first = await f.coordinator.admitTask(f.origin, 'Inspect fixture');
    const second = await f.coordinator.admitTask(f.origin, 'Inspect fixture');
    assert.equal(first.id, second.id); assert.equal(first.contract.binding !== null, true);
    assert.equal(f.store.task(first.contract.taskId)?.source, 'coding-session'); assert.equal(f.store.task(first.contract.taskId)?.state, 'running');
  } finally { await f.cleanup(); }
});
test('response persists before tools; cold reopen resumes it without a second provider debit', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); try {
    const admitted = await f.coordinator.admitTask(f.origin, 'Inspect fixture');
    await f.coordinator.tick(); assert.equal(f.sent, 1); assert.equal(f.store.listEffects().length, 0);
    await f.reopen(); await f.coordinator.tick(); assert.equal(f.sent, 1); assert.equal(f.store.listEffects().filter(effect => effect.state === 'completed').length, 1);
    await f.coordinator.tick(); assert.equal(f.coordinator.status(admitted.id)?.state, 'paused'); assert.equal(f.sent, 1);
    f.clock(3_600_001); await f.coordinator.tick(); assert.equal(f.sent, 2); assert.equal(f.coordinator.status(admitted.id)?.state, 'terminal');
    const accounting = new CodingAccounting(f.store, { now: () => 3_600_001 }); assert.equal(accounting.reservations(admitted.id).length, 2);
  } finally { await f.cleanup(); }
});
test('legacy coding orientation changes only the next request while cold recovery preserves receipts and spent allocation', async () => {
  const f = fixture(); try {
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture');
    const ledger = new CodingAccounting(f.store), initial = codingData(session);
    const legacySystem: CodingMessage = { role: 'system', text: 'You are Palimpsest, a coding companion. LEGACY_RETAINED_ORIENTATION' };
    initial.messages[0] = legacySystem;
    ledger.update(session.id, { data: JSON.parse(JSON.stringify(initial)) }, { expectedRevision: session.revision });
    await f.coordinator.tick();
    assert.equal(f.sent, 1);
    const current = ledger.get(session.id)!, interrupted = codingData(current), pending = interrupted.pending[0]!;
    const spent = ledger.reservations(session.id);
    assert.equal(spent.length, 1); assert.equal(spent[0]!.status, 'observed');

    // Seed the receiver's durable completion cut. Native file isolation is a
    // separate platform witness; this fixture observes real Store/coordinator
    // recovery of an already completed receiver receipt without running it again.
    pending.state = 'started';
    ledger.update(session.id, { phase: 'tool-intended', data: JSON.parse(JSON.stringify(interrupted)) }, { expectedRevision: current.revision });
    f.store.reserveEffect({ id: pending.effectId, taskId: session.contract.taskId, kind: 'workspace.files',
      payload: { workspaceId: interrupted.workspaceId, operation: JSON.parse(pending.intent.arguments) } });
    const receipt = f.store.completeEffect(pending.effectId, { ok: true, result: { text: 'RECOVERED_RECEIVER_VALUE' } });
    const historicalMessages = structuredClone(interrupted.messages);

    f.epoch(2); await f.reopen();
    const reopenedLedger = new CodingAccounting(f.store), reopened = codingData(f.coordinator.status(session.id)!);
    assert.deepEqual(reopened.messages, historicalMessages);
    assert.deepEqual(reopened.pending, interrupted.pending);
    assert.deepEqual(reopenedLedger.reservations(session.id), spent);
    assert.deepEqual(f.store.effect(pending.effectId), receipt);
    assert.equal(reopened.epoch, 2);
    assert.deepEqual(f.coordinator.status(session.id)!.contract, session.contract);

    await f.coordinator.tick(); // Recover the pending tool from its existing receipt.
    assert.equal(f.sent, 1); assert.equal(codingData(f.coordinator.status(session.id)!).pending.length, 0);
    assert.deepEqual(f.store.listEffects(), [receipt]);
    await f.coordinator.tick(); // The original hourly allocation is still spent.
    assert.equal(f.sent, 1); assert.equal(f.coordinator.status(session.id)!.state, 'paused');
    assert.deepEqual(reopenedLedger.reservations(session.id), spent);

    f.clock(3_600_001); await f.coordinator.tick();
    assert.equal(f.sent, 2);
    const physicalRequest = f.histories[1]!;
    assert.deepEqual(physicalRequest[0], { role: 'system', text: codingOrientation });
    assert.equal(physicalRequest.some(message => 'text' in message && message.text.includes('LEGACY_RETAINED_ORIENTATION')), false);
    const observedTool = physicalRequest.find(message => message.role === 'tool' && message.callId === pending.intent.callId);
    assert.ok(observedTool && observedTool.role === 'tool' && observedTool.outcome.ok);
    assert.match(observedTool.outcome.text, /RECOVERED_RECEIVER_VALUE/);
    assert.deepEqual(codingData(f.coordinator.status(session.id)!).messages[0], legacySystem);
    assert.deepEqual(f.store.listEffects(), [receipt]);
    const reservations = reopenedLedger.reservations(session.id);
    assert.equal(reservations.length, 2); assert.deepEqual(reservations[0], spent[0]);
    assert.equal(reservations[1]!.ordinal, 2);
    assert.equal((reservations[1]!.intent as { transcriptDigest: string }).transcriptDigest,
      createHash('sha256').update(JSON.stringify(physicalRequest)).digest('hex'));
  } finally { await f.cleanup(); }
});
test('invalid mixed batch produces zero actual receiver effects and a durable terminal reason', async () => {
  const f = fixture(); try {
    f.replies[0] = { status: 'ok', text: '', intents: [{ callId: 'edit00001', name: 'workspace_files', arguments: '{"kind":"create","path":"new","content":"","mode":420}' }, { callId: 'edit00002', name: 'workspace_files', arguments: '{"kind":"observe"}' }], usage: { status: 'known', input: 2, output: 1, total: 3 }, finishReason: 'tool-calls' };
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.tick();
    assert.equal(f.store.listEffects().length, 0); assert.equal(f.coordinator.status(session.id)?.reason, 'invalid-intent');
  } finally { await f.cleanup(); }
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function until(predicate: () => boolean) { for (let turn = 0; turn < 100 && !predicate(); turn++) await new Promise(resolve => setImmediate(resolve)); assert.equal(predicate(), true, 'Expected asynchronous boundary was reached'); }
test('concurrent admission waits for one verified source import and returns one durable grant', async () => {
  const f = fixture(); try {
    const imported = deferred<typeof f.source>(); f.setImport(() => imported.promise);
    const first = f.coordinator.admitTask(f.origin, 'Inspect fixture');
    const second = f.coordinator.admitTask(f.origin, 'Inspect fixture');
    const observed = Promise.all([first, second]); // Attach both immediately: a rejection is an observable failure, never unhandled.
    assert.equal(f.coordinator.status(f.origin.id), undefined); assert.equal(f.sourceReads, 1);
    imported.resolve(f.source); const sessions = await observed;
    assert.equal(sessions[0].id, sessions[1].id); assert.equal(f.sourceReads, 1);
  } finally { await f.cleanup(); }
});
test('epoch changes while awaiting a provider slot veto physical dispatch and debit', async () => {
  const f = fixture(); try {
    const slot = deferred<() => void>(); let entered = false, released = 0;
    f.setSlot(() => { entered = true; return slot.promise; });
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'), pending = f.coordinator.tick();
    await until(() => entered); f.epoch(2); slot.resolve(() => { released++; }); await pending;
    assert.equal(f.sent, 0); assert.equal(released, 1); assert.equal(new CodingAccounting(f.store).reservations(session.id).length, 0);
    assert.equal(f.coordinator.status(session.id)?.reason, 'authority-or-expiry'); assert.equal(f.store.listEffects().length, 0);
  } finally { await f.cleanup(); }
});
test('pause interrupts an uncooperative provider; consumed request is unknown and late response cannot create tools', async () => {
  const f = fixture(); try {
    const reply = deferred<CodingStepResult>(); f.setResponse(() => reply.promise);
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'), pending = f.coordinator.tick();
    await until(() => f.sent === 1); await f.coordinator.pause(); await pending;
    assert.equal(f.coordinator.status(session.id)?.state, 'paused');
    assert.equal(new CodingAccounting(f.store).reservations(session.id)[0]?.status, 'unknown');
    reply.resolve(f.replies[0]!); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.store.listEffects().length, 0); assert.deepEqual((f.coordinator.status(session.id)?.data as { pending: unknown[] }).pending, []);
    f.coordinator.resume(); await f.coordinator.tick(); assert.equal(f.sent, 1); // Reconcile spent request; never resend it.
  } finally { await f.cleanup(); }
});
test('cancel records a cancelled execution owner without discarding retained draft', async () => {
  const f = fixture(); try {
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.cancel(session.id);
    assert.equal(f.coordinator.status(session.id)?.state, 'terminal'); assert.equal(f.store.task(session.contract.taskId)?.state, 'cancelled');
    assert.ok(f.receiver.workspace((session.data as { workspaceId: string }).workspaceId)); assert.equal(f.sent, 0);
  } finally { await f.cleanup(); }
});
test('stop finish with tool intents rejects the entire batch before receiver effects', async () => {
  const f = fixture(); try {
    f.replies[0] = { ...f.replies[0]!, finishReason: 'stop' } as CodingStepResult;
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.tick();
    assert.equal(f.coordinator.status(session.id)?.reason, 'invalid-intent'); assert.equal(f.store.listEffects().length, 0);
  } finally { await f.cleanup(); }
});
test('peer and falsely labelled growth origins cannot acquire a coding grant', async () => {
  const f = fixture(); try {
    const peer = f.store.enqueue({ source: 'direct', conversationId: 'peer:fixture', input: 'Synthetic untrusted request' });
    await assert.rejects(f.coordinator.admitTask(peer, 'Inspect fixture'), /ineligible-origin/);
    const growth = f.store.enqueue({ source: 'coding-origin', conversationId: 'growth:fixture', input: 'Synthetic forged growth' });
    await assert.rejects(f.coordinator.admitGrowth(growth, 'Inspect fixture'), /ineligible-growth-origin/);
    assert.equal(f.sourceReads, 0); assert.equal(f.store.listEffects().length, 0);
  } finally { await f.cleanup(); }
});

test('a durably completed mutation survives epoch adoption without a second mutation or request', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); try {
    f.replies[0] = { ...f.replies[0]!, intents: [{ callId: 'edit00001', name: 'workspace_files', arguments: '{"kind":"create","path":"retained","content":"observed draft","mode":420}' }] } as CodingStepResult;
    const admitted = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.tick();
    const ledger = new CodingAccounting(f.store), current = ledger.get(admitted.id)!, data = codingData(current);
    data.pending[0]!.state = 'started'; ledger.update(current.id, { state: 'running', phase: 'tool-intended', data: JSON.parse(JSON.stringify(data)) }, { expectedRevision: current.revision });
    const receipt = await f.receiver.perform(data.workspaceId, data.epoch, data.pending[0]!.effectId, JSON.parse(data.pending[0]!.intent.arguments)); assert.equal(receipt.ok, true);
    const base = data.base; f.epoch(2); await f.reopen(); await f.coordinator.tick();
    const recovered = codingData(f.coordinator.status(admitted.id)!);
    assert.equal(recovered.epoch, 2); assert.deepEqual(recovered.base, base); assert.equal(f.sent, 1); assert.equal(f.store.listEffects().length, 1);
    assert.equal(recovered.messages.at(-1)?.role, 'tool'); assert.equal(recovered.pending.length, 0);
    assert.equal(readFileSync(join(f.receiver.path(data.workspaceId), 'retained'), 'utf8'), 'observed draft');
  } finally { await f.cleanup(); }
});
test('completed native IDs remain forbidden after older transcript groups are compacted', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); try {
    f.policy.lane = { kind: 'plan', cadence: 'hourly', maxCalls: 4 }; f.policy.maxTranscriptMessages = 4;
    const reply = (callId: string): CodingStepResult => ({ status: 'ok', text: '', intents: [{ callId, name: 'workspace_files', arguments: '{"kind":"read","path":"src/value.txt"}' }], usage: { status: 'known', input: 2, output: 1, total: 3 }, finishReason: 'tool-calls' });
    f.replies.splice(0, f.replies.length, reply('read00001'), reply('read00002'), reply('read00001'));
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.runReady(5);
    assert.equal(f.sent, 3); assert.equal(f.histories[2]!.some(message => message.role === 'assistant' && message.intents?.some(intent => intent.callId === 'read00001')), false);
    assert.equal(f.coordinator.status(session.id)?.reason, 'invalid-intent'); assert.equal(f.store.listEffects().length, 2);
  } finally { await f.cleanup(); }
});
test('cumulative provider cap terminates with the retained draft and no physical overrun', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); try {
    f.policy.lane = { kind: 'plan', cadence: 'hourly', maxCalls: 4 }; f.policy.limits.maxSessionCalls = 1;
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.runReady(4);
    const final = f.coordinator.status(session.id)!;
    assert.equal(final.state, 'terminal'); assert.equal(final.reason, 'sessionId_call_limit'); assert.equal(f.sent, 1); assert.equal(f.store.listEffects().length, 1);
    assert.ok(f.receiver.workspace(codingData(final).workspaceId)); assert.equal(new CodingAccounting(f.store).reservations(session.id).length, 1);
  } finally { await f.cleanup(); }
});

test('an altered stored policy cannot weaken the sealed contract before dispatch', async () => {
  const f = fixture(); try {
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'), ledger = new CodingAccounting(f.store);
    const data = codingData(session); data.policy.maxTranscriptBytes++;
    ledger.update(session.id, { data: JSON.parse(JSON.stringify(data)) }, { expectedRevision: session.revision });
    await f.coordinator.tick(); assert.equal(f.sent, 0); assert.equal(f.store.listEffects().length, 0);
    assert.equal(f.coordinator.status(session.id)?.reason, 'contract-data-conflict');
  } finally { await f.cleanup(); }
});

test('revoked origin during verified source import yields no durable grant or receiver effects', async () => {
  const f = fixture(); try {
    const imported = deferred<typeof f.source>(); f.setImport(() => imported.promise);
    const admission = f.coordinator.admitTask(f.origin, 'Inspect fixture'); const rejected = assert.rejects(admission, /authority-or-expiry/);
    f.allow(false); imported.resolve(f.source); await rejected;
    assert.equal(f.coordinator.status(f.origin.id), undefined); assert.equal(f.store.listEffects().length, 0);
    assert.equal(f.store.task(`coding:${f.origin.id}:execution`)?.state, 'queued');
  } finally { await f.cleanup(); }
});

test('async authority answers are rejected rather than interpreted as a grant', async () => {
  const f = fixture(); try {
    f.allow(Promise.resolve(false) as unknown as boolean);
    await assert.rejects(f.coordinator.admitTask(f.origin, 'Inspect fixture'), /ineligible-origin/);
    assert.equal(f.sourceReads, 0); assert.equal(f.store.listTasks().filter(task => task.source === 'coding-session').length, 0);
  } finally { await f.cleanup(); }
});
test('nonfinite policy is rejected before verified source collection or workspace creation', async () => {
  const f = fixture(); try {
    f.policy.expiresAt = Infinity;
    await assert.rejects(f.coordinator.admitTask(f.origin, 'Inspect fixture'), /invalid-policy/);
    assert.equal(f.sourceReads, 0); assert.equal(f.store.listTasks().filter(task => task.source === 'coding-session').length, 0);
  } finally { await f.cleanup(); }
});

test('an indefinite provider wait expires mechanically and registers an owed outcome without another request', async () => {
  const f = fixture(); try {
    f.policy.expiresAt = 2000; f.replies[0] = { status: 'failed', error: { kind: 'authorization' }, usage: { status: 'unknown' }, dispatch: 'uncertain' };
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.tick();
    assert.equal(f.coordinator.status(session.id)?.state, 'paused'); assert.equal(f.coordinator.status(session.id)?.nextEligibleAt, null);
    f.clock(2001); await f.coordinator.tick();
    assert.equal(f.coordinator.status(session.id)?.state, 'terminal'); assert.equal(f.coordinator.status(session.id)?.reason, 'expired');
    assert.equal(f.sent, 1); assert.equal(f.store.listEffects().length, 0); assert.equal(f.outcomes.length, 1);
    await f.coordinator.tick(); assert.equal(f.outcomes.length, 1);
  } finally { await f.cleanup(); }
});
test('a budget wake later than expiry ends with its retained draft and owed outcome', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); try {
    f.policy.expiresAt = 2000;
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'); await f.coordinator.runReady(3);
    assert.equal(f.coordinator.status(session.id)?.state, 'paused'); assert.ok(f.coordinator.status(session.id)!.nextEligibleAt! > 2000);
    f.clock(2001); await f.coordinator.tick(); assert.equal(f.coordinator.status(session.id)?.reason, 'expired');
    assert.equal(f.sent, 1); assert.equal(f.store.listEffects().length, 1); assert.equal(f.outcomes.length, 1);
  } finally { await f.cleanup(); }
});
test('revoked execution authority still registers a bounded originating-scope outcome without transcript text', async () => {
  const f = fixture(); try {
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture');
    const ledger = new CodingAccounting(f.store), data = codingData(session); data.messages.push({ role: 'assistant', text: 'private fixture transcript', intents: [] });
    ledger.update(session.id, { data: JSON.parse(JSON.stringify(data)) }, { expectedRevision: session.revision });
    f.allow(false); await f.coordinator.tick();
    assert.equal(f.coordinator.status(session.id)?.state, 'terminal'); assert.equal(f.sent, 0); assert.equal(f.outcomes.length, 1);
    assert.doesNotMatch(f.outcomes[0]!, /private fixture transcript/); assert.match(f.outcomes[0]!, /authority/);
  } finally { await f.cleanup(); }
});

test('the actually charged independent growth admission decision counts once toward cumulative session calls', async () => {
  const f = fixture(); try {
    f.allowGrowth(); f.policy.lane = { kind: 'growth', schedulerId: 'fixture-growth', windowMs: 3600000, maxCalls: 4 }; f.policy.limits.maxSessionCalls = 1;
    const growth = f.store.addGrowth({ id: 'independent-fixture', dimension: 'code_quality', question: 'Synthetic independent inquiry', origin: 'standing growth mission v1', budget: 0 });
    f.store.openGrowthWindow({ id: 'fixture-growth:0', schedulerId: 'fixture-growth', startsAt: 0, endsAt: 3600000, maxCalls: 4 });
    assert.ok(f.store.claimGrowthInWindow(growth.id, 'fixture-growth:0', 1000));
    f.store.updateGrowth(growth.id, { state: 'paused', checkpoint: { phase: 'coding_decision', decisionText: '{"coding":{"objective":"Inspect fixture"}}' } });
    const origin = f.store.enqueue({ source: 'coding-origin', conversationId: 'growth', input: 'Inspect fixture' }); f.store.updateTask(origin.id, { state: 'running' });
    f.store.appendEvent('coding.growth.origin.admitted', { growthId: growth.id, objective: 'Inspect fixture' }, origin.id);
    const session = await f.coordinator.admitGrowth(origin, 'Inspect fixture'); await f.coordinator.admitGrowth(origin, 'Inspect fixture');
    assert.equal(f.store.listEvents().filter(event => event.type === 'coding.initial_call.linked').length, 1);
    await f.coordinator.tick(); assert.equal(f.sent, 0); assert.equal(f.coordinator.status(session.id)?.reason, 'sessionId_call_limit');
    assert.equal(f.store.growthWindow('fixture-growth:0')?.usedCalls, 1); assert.equal(new CodingAccounting(f.store).reservations(session.id).length, 0);
  } finally { await f.cleanup(); }
});

test('cancellation aborts and drains a pending admission before late source can grant or dispatch', async () => {
  const f = fixture(); try {
    const imported = deferred<typeof f.source>(); f.setImport(() => imported.promise);
    const admission = f.coordinator.admitTask(f.origin, 'Inspect fixture');
    const settled = admission.then(() => 'admitted', () => 'rejected');
    assert.equal(f.sourceReads, 1); f.store.updateTask(f.origin.id, { state: 'cancelled' });
    await f.coordinator.cancel(f.origin.id);
    // Cancellation settles coordinator admission even if a source collector ignores its signal.
    const drained = await Promise.race([settled, new Promise<string>(resolve => setTimeout(() => resolve('still-pending'), 100))]);
    imported.resolve(f.source); assert.equal(await settled, 'rejected'); assert.equal(drained, 'rejected');
    await new Promise(resolve => setImmediate(resolve)); await f.coordinator.tick();
    assert.equal(f.coordinator.status(f.origin.id), undefined); assert.equal(f.sent, 0); assert.equal(f.store.listEffects().length, 0);
    assert.equal(f.store.listEvents().filter(event => event.type === 'workspace.created').length, 0);
    assert.equal(f.store.task(`coding:${f.origin.id}:execution`)?.state, 'cancelled');
  } finally { await f.cleanup(); }
});
test('a source collector cancelling synchronously cannot leave its rejected result unhandled', async () => {
  const f = fixture(); try {
    let cancelled!: Promise<void>;
    f.setImport(() => { cancelled = f.coordinator.cancel(f.origin.id); return Promise.reject(new Error('Synthetic rejected source result')); });
    await assert.rejects(f.coordinator.admitTask(f.origin, 'Inspect fixture'), /interrupted/);
    await cancelled; await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.coordinator.status(f.origin.id), undefined); assert.equal(f.sent, 0); assert.equal(f.store.listEffects().length, 0);
  } finally { await f.cleanup(); }
});
test('coding-only cancellation during admission stays revoked when the foreground origin has already succeeded', async () => {
  const f = fixture(); try {
    const imported = deferred<typeof f.source>(); f.setImport(() => imported.promise);
    const admission = f.coordinator.admitTask(f.origin, 'Inspect fixture'), settled = admission.then(() => 'admitted', () => 'rejected');
    f.store.updateTask(f.origin.id, { state: 'succeeded' });
    const cancelled = f.coordinator.cancel(`coding:${f.origin.id}`);
    imported.resolve(f.source); await cancelled; assert.equal(await settled, 'rejected');
    await assert.rejects(f.coordinator.admitTask(f.store.task(f.origin.id)!, 'Inspect fixture'), /cancelled-origin/);
    await f.coordinator.tick(); assert.equal(f.sourceReads, 1); assert.equal(f.sent, 0); assert.equal(f.coordinator.status(f.origin.id), undefined);
  } finally { await f.cleanup(); }
});
test('cancelled origin state independently vetoes dispatch while a normally completed origin remains allowed', async () => {
  const stopped = fixture(); try {
    const session = await stopped.coordinator.admitTask(stopped.origin, 'Inspect fixture'); stopped.store.updateTask(stopped.origin.id, { state: 'cancelled' });
    await stopped.coordinator.tick(); assert.equal(stopped.sent, 0); assert.equal(stopped.coordinator.status(session.id)?.state, 'terminal');
  } finally { await stopped.cleanup(); }
  const completed = fixture(); try {
    const session = await completed.coordinator.admitTask(completed.origin, 'Inspect fixture'); completed.store.updateTask(completed.origin.id, { state: 'succeeded' });
    await completed.coordinator.tick(); assert.equal(completed.sent, 1); assert.equal(completed.coordinator.status(session.id)?.phase, 'response-persisted');
  } finally { await completed.cleanup(); }
});

test('cold adoption ends an expired draft before renewing another eligible draft', async () => {
  const f = fixture(); try {
    f.policy.expiresAt = 2000; f.policy.lane = { kind: 'plan', cadence: 'hourly', maxCalls: 2 };
    const expired = await f.coordinator.admitTask(f.origin, 'Expired fixture');
    const ledger = new CodingAccounting(f.store, { now: () => 1000 });
    ledger.reserve(expired.id, { requestId: 'expired-reserved', ordinal: 1, intent: null, validateCurrent: () => {} });
    f.policy.expiresAt = 10_000_000;
    const other = f.store.enqueue({ source: 'direct', conversationId: 'direct:fixture', input: 'Still eligible fixture' }); f.store.updateTask(other.id, { state: 'running' });
    const eligible = await f.coordinator.admitTask(other, 'Still eligible fixture');
    f.clock(2001); f.epoch(2); await f.reopen();
    const ended = f.coordinator.status(expired.id)!;
    assert.equal(ended.state, 'terminal'); assert.equal(ended.reason, 'expired'); assert.equal(codingData(ended).epoch, 1);
    assert.equal(new CodingAccounting(f.store).reservations(expired.id)[0]?.status, 'unknown');
    assert.equal(f.store.task(expired.contract.taskId)?.state, 'failed');
    assert.equal(f.store.listEvents({ taskId: expired.contract.taskId }).some(event => event.type === 'workspace.adopted'), false);
    assert.equal(f.store.listEvents({ taskId: expired.contract.taskId }).some(event => event.type === 'coding.outcome.ready'), true);
    assert.equal(codingData(f.coordinator.status(eligible.id)!).epoch, 2); assert.equal(f.coordinator.status(eligible.id)?.state, 'ready');
    await f.coordinator.tick(); assert.equal(f.sent, 1); assert.equal(f.store.listEffects().length, 0);
  } finally { await f.cleanup(); }
});
test('cold adoption retains a revoked draft and its unknown owner/writer without claiming quiescence', async () => {
  const f = fixture(); try {
    const session = await f.coordinator.admitTask(f.origin, 'Inspect fixture'), data = codingData(session);
    f.store.reserveEffect({ id: 'unknown-old-effect', taskId: session.contract.taskId, kind: 'workspace', payload: { workspaceId: data.workspaceId } });
    f.store.markEffectUnknown('unknown-old-effect', 'No positive termination evidence');
    const claim = JSON.stringify({ version: 1, operationId: 'unknown-old-effect', ownerPid: process.pid, ownerNonce: 'old-receiver', pid: null });
    writeFileSync(join(f.receiver.controlPath(data.workspaceId), 'writer.json'), claim, { flag: 'wx', mode: 0o600 });
    f.allow(false); f.epoch(2); await f.reopen();
    const ended = f.coordinator.status(session.id)!;
    assert.equal(ended.state, 'terminal'); assert.equal(ended.reason, 'authority-or-expiry'); assert.equal(codingData(ended).epoch, 1);
    assert.equal(f.store.task(session.contract.taskId)?.state, 'waiting_for_provider');
    assert.equal(f.store.effect('unknown-old-effect')?.state, 'unknown');
    assert.equal(readFileSync(join(f.receiver.controlPath(data.workspaceId), 'writer.json'), 'utf8'), claim);
    assert.equal(f.receiver.workspace(data.workspaceId).epoch, 1);
    assert.equal(f.store.listEvents({ taskId: session.contract.taskId }).some(event => event.type === 'workspace.adopted'), false);
    await f.coordinator.tick(); assert.equal(f.sent, 0); assert.equal(f.outcomes.length, 1);
    assert.match(f.outcomes[0]!, /retained.*authority/is);
  } finally { await f.cleanup(); }
});
