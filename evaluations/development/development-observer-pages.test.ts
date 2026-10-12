import { performance } from 'node:perf_hooks';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { domains, developmentCapacityProfile, developmentCapacityLimits, type DevelopmentAttempt } from './witness.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { acquisitionPlanDomain, type AcquisitionPlanTrust, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import type { ArtifactRef, Authority, Observation, PhysicalRequest, ResourceEnvelope, ShellPort } from '../../packages/contracts/index.ts';
import { OperationalStore, DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE } from '../../packages/storage/index.ts';
import { DurableRuntime, ResourceLedger } from '../../packages/runtime/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { DevelopmentalMemory } from '../../packages/development/index.ts';
import { FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry } from '../../packages/initiative/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
import { projectDevelopmentPageSources } from './development-observer.ts';
import type { DevelopmentPageReader, DevelopmentPageSourceInput } from './development-observer.ts';

const resources: ResourceEnvelope = { maxRequests: 20, maxTokens: 2000, maxCostUsd: 2, maxElapsedMs: 60000, maxConcurrency: 2 };
const authority: Authority = { generation: 'fixture-generation', epoch: 1, controlRevision: 'fixture-control' };
const scope = { kind: 'restricted', principals: ['fixture-user'] } as const;
const message = (revision = '1', text = 'bounded ordinary assignment'): AuthenticatedMessage => ({ source: 'direct', externalId: 'message', revision, conversation: 'conversation', text, actor: { id: 'fixture-user', scope: { ...scope, principals: [...scope.principals] }, modificationEligible: true } });
function fixture(outcome: 'succeeded' | 'failed' | 'uncertain' = 'succeeded', status: 'completed' | 'checkpointed' = 'completed') {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-development-observer-')), filename = join(directory, 'state.sqlite'); let now = Date.parse('2026-10-12T02:00:00Z'), ordinal = 0;
  let mode: 'observe' | 'equal-result' | 'checkpoint-failure' | 'failure' = 'observe', lastObservation: Observation | undefined;
  const store = new OperationalStore({ filename, documentJournal: { stream: 'journal:fixture', hostId: 'fixture-host', maxAnchorDocuments: 64, maxAnchorBytes: 65536 } });
  const memory = new DevelopmentalMemory(store, () => new Date(now).toISOString()), goals = new InitiativeRegistry(store), obligations = new ObligationRegistry(store);
  const raw = new Map<string, Uint8Array>();
  const retain = (bytes: Uint8Array): ArtifactRef => { const sha256 = createHash('sha256').update(bytes).digest('hex'); raw.set(sha256, Uint8Array.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  const retainJson = (value: unknown) => retain(Buffer.from(canonicalJson(value)));
  const read = (ref: ArtifactRef, bound: number) => { const bytes = raw.get(ref.sha256) ?? store.readArtifact(ref, bound); if (!bytes) throw Error('artifact missing'); return bytes; };
  const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { return { outcome, receipt: store.putJsonArtifact({ fixture: outcome }) }; }, async reconcile() { return { outcome: 'unresolved', receipt: store.putJsonArtifact({ unresolved: true }) }; } });
  const ledger = new ResourceLedger(store, { tokens: 20, costUsd: .01, elapsedMs: 100 }, () => now);
  const shell: ShellPort = { async run(input, bridge) {
    ordinal++; const payload = canonicalJson({ fixture: 'no provider', ordinal }), prompt = { id: `prompt:${ordinal}`, fragments: [], requestDigest: createHash('sha256').update(payload).digest('hex') };
    await bridge.capturePrompt(prompt, payload);
    const request: PhysicalRequest = { id: `physical:${ordinal}`, runId: input.run.id, purpose: 'reasoning', provider: 'fixture', model: 'offline', promptManifestId: prompt.id, requestDigest: prompt.requestDigest, reservationId: `physical:${ordinal}`, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    await bridge.reserve(request); await bridge.dispatched({ ...request, status: 'dispatched' }); await bridge.settle({ ...request, status: outcome });
    if (mode === 'checkpoint-failure') await bridge.persistCheckpoint(input.run.id, input.run.revision, 'fixture', { observationIds: [], progress: 'input read before interrupted result' });
    if (mode === 'checkpoint-failure' || mode === 'failure') throw Error('repeated fixture interruption');
    if (mode === 'equal-result') { assert.ok(lastObservation); return { status, observations: [lastObservation] }; }
    const observation = await bridge.execute({ id: `call:${ordinal}`, runId: input.run.id, stepId: `step:${ordinal}`, name: 'fixture-measure', arguments: { fixture: true } });
    lastObservation = observation;
    return { status, observations: [observation] };
  } };
  const runtime = new DurableRuntime({ store, shell, effects, resources: ledger, now: () => now });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority, resources }) });
  const scheduler = new FairScheduler(store, goals, obligations, 'ordinary', { windowMs: 1000, maxSlicesPerWindow: 10, maxLifetimeSlices: 20, quantumMs: 1000, idleRetryMs: 1, maxStalls: 3, resources }, now);
  const runner = new InitiativeRunner({ scheduler, runtime, memory, authority, prompt: () => ({ id: 'runtime', fragments: [], requestDigest: identity('runtime') }), decide: (_g, observations) => ({ kind: 'continue', nextAction: 'inspect independent second measurement', evidenceIds: observations.map(o => o.id), reason: 'fixture continues without claiming success' }) });
  const stat = statSync(filename, { bigint: true }), pathIdentity = { device: String(stat.dev), inode: String(stat.ino) }, journal = store.documentJournalBinding()!, configurationDigest = identity({ fixture: true });
  const captures = new Map<string, DevelopmentPageReader>();
  const stats = { pageReads: 0, maxPageReadBytes: 0, eventResolves: 0, versionResolves: 0, assertions: 0 };
  let revoked = false;
  const capture = () => {
    const cut = store.captureDevelopmentPages({ maxPageRows: 7, maxPageBytes: 65536, maxPages: 512, maxPhysicalRows: 3584, maxConservativeBytes: 16_777_216, maxSerializedBytes: 16_777_216, maxOperationalArtifacts: 128, maxOperationalArtifactBytes: 1_048_576, maxOperationalArtifactTotalBytes: 16_777_216 }, retain, (_original, bytes) => retain(bytes), read);
    const manifest = { version: 1 as const, roleId: 'candidate', configurationDigest, source: { pathIdentity, journalDigest: identity(journal) }, clock: { kind: 'synthetic' as const, wallMs: now, monotonicMs: now - Date.parse('2026-10-12T02:00:00Z'), bootId: 'synthetic-boot', processStart: 'synthetic-process' }, cut };
    const ref = retainJson(manifest); let visiting = false;
    // Explicit test seam: real storage page cuts, not the actual recorder's authority closure.
    const assertUsableNow = () => { stats.assertions++; assert.equal(visiting, false, 'no reader use inside callback'); if (revoked) throw Error('whole-role source withdrawn'); };
    const page = (descriptor: typeof cut.pages[number]) => { const bytes = read(descriptor.artifact, descriptor.bytes); stats.pageReads++; stats.maxPageReadBytes = Math.max(stats.maxPageReadBytes, bytes.byteLength); return JSON.parse(Buffer.from(bytes).toString()) as import('../../packages/storage/index.ts').SourcePage; };
    const reader: DevelopmentPageReader = {
      manifest, assertUsableNow,
      forEachEvent(visit) { for (const descriptor of cut.pages.filter(p => p.table === 'events')) { assertUsableNow(); const p = page(descriptor); if (p.table !== 'events') throw Error('wrong event page'); visiting = true; try { for (const e of p.rows) visit(e); } finally { visiting = false; } } },
      forEachCurrentDocument(visit) { for (const descriptor of cut.pages.filter(p => p.table === 'documents')) { assertUsableNow(); const p = page(descriptor); if (p.table !== 'documents') throw Error('wrong document page'); visiting = true; try { for (const row of p.rows.filter(d => !d.namespace.startsWith(DOCUMENT_JOURNAL_NAMESPACE))) visit(row); } finally { visiting = false; } } },
      resolveEvent(sequence) { assertUsableNow(); stats.eventResolves++; for (const descriptor of cut.pages.filter(p => p.table === 'events')) { const p = page(descriptor); if (p.table === 'events') { const e = p.rows.find(e => e.sequence === sequence); if (e) return e; } } throw Error('event unavailable'); },
      resolveJournalVersion(versionId) { assertUsableNow(); stats.versionResolves++; for (const descriptor of cut.pages.filter(p => p.table === 'documents')) { const p = page(descriptor); if (p.table === 'documents') { const row = p.rows.find(r => r.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE && r.key === versionId); if (row) { const payload = row.value as unknown as import('../../packages/storage/index.ts').JournalPayload; if (payload.state !== 'available') throw Error('payload withdrawn'); return { ref: payload.ref, document: payload.document }; } } } throw Error('exact version unavailable'); },
      resolve(original, maxBytes) { assertUsableNow(); const mapping = cut.operationalArtifacts.find(m => canonicalJson(m.original) === canonicalJson(original)); if (!mapping) throw Error('original mapping unavailable'); return Buffer.from(read(mapping.retained, maxBytes)); },
    };
    captures.set(ref.sha256, reader); return ref;
  };
  const assignmentPacket = (messages: AuthenticatedMessage[] = []) => retainJson({ version: 1, assignments: messages.map((m, i) => ({ id: `assignment:${i}`, roleId: 'candidate', message: m })) });
  const input = (before: ArtifactRef, after: ArtifactRef, packet = assignmentPacket(), current = after): DevelopmentPageSourceInput => ({ before, after, current, assignmentPacket: packet, roleId: 'candidate', configurationDigest, pathIdentity, journal, bounds: { maxCaptureBytes: 1_048_576, maxArtifactBytes: 1_048_576, maxRows: 512, maxProofBytes: 262144 }, metadataBounds: { maxRecords: 20000, maxBytes: 8_388_608 }, readArtifact: read, openAcquiredCapture(ref) { const reader = captures.get(ref.sha256); if (!reader) throw Error('captured reader unavailable'); return reader; } });
  const ready = () => { const g = goals.propose({ id: 'inquiry', origin: { kind: 'self' }, purpose: 'inspect ordinary source evidence', scope: { kind: 'public' }, successCriteria: ['retain measured uncertainty'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'inspect fixture measurement', reviewAt: new Date(now).toISOString() }, { sourceIds: ['unresolved-host-origin'], actorId: 'fixture-generation', recordedAt: new Date(now).toISOString(), derivation: 'interpreted' }); goals.accept(g.id, g.revision, 'fixture opportunity'); };
  return { store, raw, retainJson, capture, captures, stats, revoke: () => { revoked = true; }, assignmentPacket, input, core, runner, ready, runtime, scheduler, ledger, mode: (next: typeof mode) => { mode = next; }, advance: (ms = 100) => { now += ms; }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}


test('pages: twenty-four ordinary conversations cross 512 physical rows without truncating history', t => {
  const f = fixture(); try {
    const before = f.capture(), messages = Array.from({ length: 24 }, (_, i) => ({ ...message(), externalId: `conversation:${i}`, conversation: `thread:${i}` }));
    for (const m of messages) f.core.receive(m);
    f.advance(); const after = f.capture(), manifest = f.captures.get(after.sha256)!.manifest;
    assert.ok(manifest.cut.physicalRows > 512); assert.ok(manifest.cut.pages.length > 2);
    assert.throws(() => f.store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 }), /exceeds bound/);
    const projection = projectDevelopmentPageSources(f.input(before, after, f.assignmentPacket(messages)));
    assert.equal(projection.assignments.length, 24); assert.equal(projection.cycles.length, 0);
    assert.ok(projection.assignments.every(a => a.result === null && a.observations.length === 0));
    assert.ok(projection.unavailable.every(u => u.subject.startsWith('assignment-result:')));
    assert.equal(projection.captures[1]!.cursor, manifest.cut.lastSequence); assert.ok(f.stats.maxPageReadBytes <= 65536);
    t.diagnostic(JSON.stringify({ physicalRows: manifest.cut.physicalRows, events: manifest.cut.events, pages: manifest.cut.pages.length, serializedBytes: manifest.cut.serializedBytes, ...f.stats }));
  } finally { f.close(); }
});

test('pages: real initiative binds overwritten intermediate values and each own clock bracket', async () => {
  const f = fixture('succeeded', 'checkpointed'); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const middle = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    const one = projectDevelopmentPageSources(f.input(before, middle, undefined, after)), two = projectDevelopmentPageSources(f.input(middle, after));
    assert.deepEqual(one.unavailable, []); assert.deepEqual(two.unavailable, []);
    assert.equal(one.cycles.length, 1); assert.equal(two.cycles.length, 1);
    assert.notEqual(one.cycles[0]!.result!.origin.execution.versionId, two.cycles[0]!.result!.origin.execution.versionId);
    assert.deepEqual(one.cycles[0]!.interval.after, middle); assert.deepEqual(two.cycles[0]!.interval.before, middle);
    assert.equal(one.cycles[0]!.origin, 'unknown'); assert.equal(one.kind, 'proposed-source-facts'); assert.equal(one.clockQualification, 'synthetic');
    assert.ok(one.cycles[0]!.proof.versions.some(r => r.namespace === 'requests' && r.revision === 1));
    assert.ok(f.stats.versionResolves > 0); assert.ok(f.stats.eventResolves > 0); assert.ok(f.stats.maxPageReadBytes <= 65536);
  } finally { f.close(); }
});

test('pages: failed copied checkpoint cannot borrow old result for a reused-run revision', async () => {
  const f = fixture('succeeded', 'checkpointed'); try {
    const first = message(), second = message('2', 'new demand'), before = f.capture(), run = f.core.receive(first).run;
    await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') });
    const old = f.store.get<{ lastResult: unknown; messageSequence: number }>('execution', run.id)!.value;
    assert.equal(f.core.receive(second).run.id, run.id); f.mode('checkpoint-failure');
    await f.runtime.resume(run.id, { id: 'runtime', fragments: [], requestDigest: identity('runtime') }); f.advance();
    const current = f.store.get<{ lastResult: unknown; messageSequence: number }>('execution', run.id)!.value;
    assert.deepEqual(old.lastResult, current.lastResult); assert.ok(current.messageSequence > old.messageSequence);
    const p = projectDevelopmentPageSources(f.input(before, f.capture(), f.assignmentPacket([first, second])));
    assert.equal(p.assignments.length, 2); assert.ok(p.assignments[0]!.result); assert.equal(p.assignments[1]!.result, null); assert.deepEqual(p.assignments[1]!.observations, []);
    assert.equal(p.assignments[0]!.result!.messageSequence, old.messageSequence);
  } finally { f.close(); }
});

for (const field of ['role', 'configuration', 'source', 'journal', 'prefix', 'event-resolver', 'version-ref', 'version-document', 'record-bound', 'byte-bound', 'proof-bound', 'capture-bound', 'artifact-bound', 'clock', 'async-reader', 'throwing-reader'] as const) test(`pages: ${field} corruption is unavailable`, async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture(), input = f.input(before, after), original = input.openAcquiredCapture;
    if (field === 'record-bound') input.metadataBounds.maxRecords = 1;
    else if (field === 'byte-bound') input.metadataBounds.maxBytes = 1;
    else if (field === 'proof-bound') input.bounds.maxProofBytes = 512;
    else if (field === 'capture-bound') input.bounds.maxCaptureBytes = 1;
    else if (field === 'artifact-bound') input.bounds.maxArtifactBytes = 1;
    else input.openAcquiredCapture = ref => {
      const r = original(ref); if (ref.sha256 === before.sha256) return r;
      const replacement: DevelopmentPageReader = { ...r, manifest: JSON.parse(canonicalJson(r.manifest)) as DevelopmentPageReader['manifest'] };
      if (field === 'role') replacement.manifest.roleId = 'foreign';
      else if (field === 'configuration') replacement.manifest.configurationDigest = identity('wrong');
      else if (field === 'source') replacement.manifest.source.pathIdentity.inode = 'wrong';
      else if (field === 'journal') replacement.manifest.source.journalDigest = identity('wrong');
      else if (field === 'clock') replacement.manifest.clock.wallMs -= 1000;
      else if (field === 'prefix') replacement.forEachEvent = visit => r.forEachEvent(e => visit(e.sequence === 1 ? { ...e, id: 'changed-anchor' } : e));
      else if (field === 'event-resolver') replacement.resolveEvent = seq => ({ ...r.resolveEvent(seq), data: { changed: true } });
      else if (field === 'version-ref') replacement.resolveJournalVersion = id => { const v = r.resolveJournalVersion(id); return { ...v, ref: { ...v.ref, versionId: 'other-version' } }; };
      else if (field === 'version-document') replacement.resolveJournalVersion = id => { const v = r.resolveJournalVersion(id); return { ...v, document: { revision: v.document.revision, value: { substituted: true } } }; };
      else if (field === 'async-reader') replacement.forEachEvent = (async visit => r.forEachEvent(visit)) as DevelopmentPageReader['forEachEvent'];
      else replacement.forEachEvent = () => { throw Error('retained source inaccessible'); };
      return replacement;
    };
    const p = projectDevelopmentPageSources(input); assert.equal(p.cycles.length, 0); assert.equal(p.assignments.length, 0); assert.ok(p.unavailable.length > 0);
  } finally { f.close(); }
});

test('pages: withdrawal after metadata collection invalidates cached event use and final return', async () => {
  for (const boundary of ['event', 'final'] as const) {
    const f = fixture(); try {
      f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture(), input = f.input(before, after), original = input.openAcquiredCapture;
      input.openAcquiredCapture = ref => {
        const r = original(ref); if (ref.sha256 !== after.sha256) return r;
        if (boundary === 'event') return { ...r, resolveEvent(seq) { const e = r.resolveEvent(seq); f.revoke(); return e; } };
        return { ...r, resolveJournalVersion(id) { const v = r.resolveJournalVersion(id); if (v.ref.namespace === 'execution') f.revoke(); return v; } };
      };
      const p = projectDevelopmentPageSources(input); assert.equal(p.cycles.length, 0); assert.ok(p.unavailable.some(u => /withdrawn/.test(u.reason)));
    } finally { f.close(); }
  }
});

test('pages: exact current withdrawal refuses earlier intermediate payload instead of current-row substitution', async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture();
    f.store.withdrawDocumentJournalContent({ id: 'withdraw-init-execution', reason: 'forget', targets: [{ namespace: 'initiative.execution', key: 'inquiry', expectedRevision: f.store.get('initiative.execution', 'inquiry')!.revision }] }); f.advance();
    const p = projectDevelopmentPageSources(f.input(before, after, undefined, f.capture())); assert.equal(p.cycles.length, 0); assert.match(p.unavailable[0]!.reason, /withdrawn/);
  } finally { f.close(); }
});


test('pages: final liveness check runs even when there are no selected facts or lazy bodies', () => {
  const f = fixture(); try {
    const before = f.capture(), input = f.input(before, before), read = input.readArtifact;
    input.readArtifact = (ref, max) => { const bytes = read(ref, max); if (ref.sha256 === input.assignmentPacket.sha256) f.revoke(); return bytes; };
    const p = projectDevelopmentPageSources(input);
    assert.equal(f.stats.eventResolves, 0); assert.equal(f.stats.versionResolves, 0);
    assert.deepEqual(p.cycles, []); assert.deepEqual(p.assignments, []); assert.ok(p.unavailable.some(u => /withdrawn/.test(u.reason)));
  } finally { f.close(); }
});

test('pages: missing explicit metadata allowance refuses before a reader scan', () => {
  const f = fixture(); try {
    const before = f.capture(), input = f.input(before, before); delete (input as Partial<DevelopmentPageSourceInput>).metadataBounds;
    const p = projectDevelopmentPageSources(input); assert.equal(f.stats.pageReads, 0); assert.match(p.unavailable[0]!.reason, /metadata bounds/);
  } finally { f.close(); }
});


test('pages: opener cannot substitute another exact valid capture with the same source identity', async () => {
  const f = fixture(); try {
    f.ready(); const before = f.capture(); await f.runner.tick(); f.advance(); const after = f.capture(), input = f.input(before, after), open = input.openAcquiredCapture;
    input.openAcquiredCapture = ref => open(ref.sha256 === after.sha256 ? before : ref);
    const p = projectDevelopmentPageSources(input); assert.deepEqual(p.cycles, []); assert.match(p.unavailable[0]!.reason, /capture manifest commitment/);
  } finally { f.close(); }
});

test('pages: irrelevant historical payload bodies stay behind the exact resolver boundary', t => {
  const f = fixture(); try {
    for (let i = 0; i < 30; i++) f.store.put('large-history', 'unused', { text: `${i}:` + 'x'.repeat(8000) }, i === 0 ? null : i);
    const cut = f.capture(), input = f.input(cut, cut); input.metadataBounds.maxBytes = 150000;
    const open = input.openAcquiredCapture;
    input.openAcquiredCapture = ref => ({ ...open(ref), forEachCurrentDocument() { throw Error('observer must not reconstruct current documents'); } });
    const p = projectDevelopmentPageSources(input); assert.deepEqual(p.unavailable, []); assert.deepEqual(p.cycles, []);
    assert.equal(f.stats.eventResolves, 0); assert.equal(f.stats.versionResolves, 0);
    assert.ok(f.captures.get(cut.sha256)!.manifest.cut.serializedBytes > input.metadataBounds.maxBytes);
    const minimum = (field: 'maxRecords' | 'maxBytes', ceiling: number) => {
      let low = 1, high = ceiling;
      while (low < high) {
        const mid = Math.floor((low + high) / 2), probe = { ...input, metadataBounds: { ...input.metadataBounds, [field]: mid } };
        if (projectDevelopmentPageSources(probe).unavailable.length) low = mid + 1; else high = mid;
      }
      return low;
    };
    const metadataRecords = minimum('maxRecords', input.metadataBounds.maxRecords), metadataBytes = minimum('maxBytes', input.metadataBounds.maxBytes);
    assert.ok(metadataBytes < f.captures.get(cut.sha256)!.manifest.cut.serializedBytes);
    assert.ok(metadataRecords > f.captures.get(cut.sha256)!.manifest.cut.events);
    t.diagnostic(JSON.stringify({ serializedBytes: f.captures.get(cut.sha256)!.manifest.cut.serializedBytes, metadataRecords, metadataBytes, metadataAllowance: input.metadataBounds.maxBytes, bodyResolves: f.stats.eventResolves + f.stats.versionResolves }));
  } finally { f.close(); }
});

// Exact immutable actual-recorder setup recipe from R02ce31b; test-only duplication authorized by root.
function recorderFixture(t:TestContext) {
  const f=syntheticWitnessFixture(),directory=mkdtempSync(join(tmpdir(),'aeon-pages-recorder-'));mkdirSync(join(directory,'raw'),{mode:0o700});
  const raw=new QualificationStore(join(directory,'raw'),developmentCapacityLimits.maxEvidenceBytes,developmentCapacityProfile);
  const m:DevelopmentAttempt={...f.m,version:2,capacityProfile:developmentCapacityProfile,limits:{...developmentCapacityLimits},grant:{...f.m.grant,resources:{...f.m.grant.resources,maxRequests:512,maxTokens:200000,maxCostUsd:500},originalAccounting:{grantId:f.m.grant.id,usage:{requests:0,inputTokens:0,outputTokens:0,costUsd:0,elapsedMs:3000},chargedTokens:0,chargedCostUsd:0,chargedElapsedMs:0,requestIds:[],unknownRequestIds:[]}}};
  const config=JSON.parse(Buffer.from(f.reader(m.configurationArtifact,10000)).toString('utf8'));
  const roleResources={...m.grant.resources,maxRequests:64};
  const roles:DevelopmentRoleBinding[]=['candidate',...m.controls.map(c=>c.id),...m.reviewers.map(r=>r.id)].map((id,i)=>({id,kind:i===0?'candidate':i<=m.controls.length?'control':'reviewer',assignmentId:i===0?null:id,allocationId:`role:${id}`,configurationDigest:m.candidate.configuration,closureDigest:identity({id,synthetic:'closure'}),profile:config.model,allowedEffects:['fixture_write'],resources:roleResources}));
  const schedule:NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule']=[],assignments:any[]=[];
  const add=(roleId:string,phase:typeof schedule[number]['phase'],n:number)=>{for(let ordinal=0;ordinal<n;ordinal++){const id=`${phase}:${ordinal}`;schedule.push({roleId,assignmentId:id,phase,ordinal});assignments.push({roleId,id,message:{source:'synthetic-pages',externalId:id,revision:'1',conversation:`${roleId}:${id}`,text:'Public synthetic ordinary assignment',actor:{id:'synthetic-host',scope:{kind:'public'},modificationEligible:false}}});}};
  for(const roleId of ['candidate','no-memory','no-standing-goals'])for(const [phase,n]of [['opportunity',12],['learning',3],['interference',9],['feedback',12]]as const)add(roleId,phase,n);
  for(const roleId of m.controls.filter(c=>!['no-memory','no-standing-goals'].includes(c.id)).map(c=>c.id)){add(roleId,'script',3);add(roleId,'script-feedback',3);}
  const packet=f.put({version:1,assignments});
  const registration:DevelopmentRegistration={version:2,attemptDigest:identity(m),rootId:'operating-envelope:v1',rootCancelled:false,registeredAt:m.registeredAt,reviewDeadlineAt:f.at(290),observerClosureDigest:f.trust.observer.artifactDigest,closureVerifierDigest:identity('synthetic closure verifier'),assignmentDigest:packet.sha256,roles,originalRequests:[]};
  const plan:DevelopmentAcquisitionPlan={version:2,id:'synthetic-complete-page-protocol',manifest:signDocument(domains.attempt,m,'issuer',f.keys.get('issuer')!),registration:signDocument(reviewEnvelopeDomains.registration,registration,'issuer',f.keys.get('issuer')!),assignmentPacket:packet,originalStateFile:join(directory,'candidate.sqlite'),closures:{node:identity('synthetic node'),dependencies:m.candidate.dependencies,prompts:m.candidate.prompts,tools:identity('synthetic tools'),acquisition:m.acquisitionDigest},rawStore:raw.identity(),roles:roles.map(r=>({roleId:r.id,stateFile:join(directory,`${r.id}.sqlite`),workspace:join(directory,`workspace-${r.id}`),configuration:m.configurationArtifact,closure:f.put({id:r.id,synthetic:'closure'}),journal:{stream:`journal:${r.id}`,hostId:`host:${r.id}`,maxAnchorDocuments:512,maxAnchorBytes:1000000},maxDrafts:64,maxPayloadBytes:8192,maxPromptBytes:2048,maxFragmentBytes:8192,maxResponseBytes:4096})),capacity:{captureBytes:854228992,maxSnapshots:156,maxSnapshotBytes:1048576,envelopeBytes:75497472,transitionBytes:4096,failureBytes:65536,inventoryEntryBytes:384,maxArtifacts:13568,maxObservations:424},captureLayout:{kind:'complete-pages-global-originals-v1',page:{maxPageRows:512,maxPageBytes:262144,maxPages:64,maxPhysicalRows:32768,maxConservativeBytes:16777216,maxSerializedBytes:4194304,maxOperationalArtifacts:2048,maxOperationalArtifactBytes:1000000,maxOperationalArtifactTotalBytes:16777216},maxManifestBytes:1048576,maxCaptureIndexBytes:4096,referencedOriginalPool:{maxOriginals:2048,maxBytes:16777216},sourcePool:{maxArtifacts:32,maxBytes:1048576},proofPool:{maxArtifacts:256,maxBytes:16777216,mandatoryArtifacts:202,mandatoryArtifactBytes:65536},metadata:{behaviorBytes:16777216,finalBytes:25165824,ownerWithoutBehaviorBytes:25165824,ownerBytes:41943040}},protocol:{nonRequestObservations:40,initialCaptures:6,cycleCaptures:6,boundaryCaptures:12,schedule}};
  for(const bytes of f.artifacts.values())raw.putBytes(bytes);
  const stateFile=join(directory,'recorder.sqlite');writeFileSync(stateFile,'',{mode:0o600});const state=new OperationalStore({filename:stateFile});
  const stores=new Map<string,OperationalStore>();for(const rp of plan.roles){mkdirSync(rp.workspace,{mode:0o700});const store=new OperationalStore({filename:rp.stateFile,documentJournal:rp.journal});chmodSync(store.filename,0o600);stores.set(rp.roleId,store);}
  let now=Date.parse(m.grant.issuedAt);const original=new ResourceLedger(stores.get('candidate')!,{tokens:100,costUsd:0.1,elapsedMs:5000},()=>now);original.allocate(registration.rootId,m.grant.resources);for(const role of roles)original.allocate(role.allocationId,role.resources,registration.rootId);now=Date.parse(m.registeredAt);
  const trust:AcquisitionPlanTrust={acceptedPlanDigest:identity(plan),issuers:f.trust.issuers,envelope:{acceptedRegistrationDigest:identity(registration),behavior:{...f.trust,acceptedAttemptDigest:identity(m)},acceptedRoles:new Map(roles.map(r=>[r.id,identity(r)])),closure:{id:'closer',key:Buffer.alloc(32,9),verifierDigest:registration.closureVerifierDigest},transports:new Map([['transport',Buffer.alloc(32,10)]])}};
  const guardMeasurements:{wallMs:number;cpuMs:number}[]=[];
  const sign=()=>signDocument(acquisitionPlanDomain,plan,'issuer',f.keys.get('issuer')!);const options:AcquisitionRecorderOptions={state,raw,original,document:sign(),trust,syntheticClock:()=>({wallMs:now,monotonicMs:now-Date.parse(m.grant.issuedAt),bootId:'synthetic-boot',processStart:'synthetic-process'})};
  const accept=()=>{trust.acceptedPlanDigest=identity(plan);options.document=sign();};
  const bridge=(recorder:DevelopmentAcquisitionRecorder,roleId:string)=>{const role=roles.find(r=>r.id===roleId)!,store=stores.get(roleId)!,rp=plan.roles.find(r=>r.roleId===roleId)!;return new DevelopmentAccounting({localStore:store,original,localDefaultCeiling:{tokens:100,costUsd:0.1,elapsedMs:5000},registration,acceptedRegistrationDigest:identity(registration),roleId,acceptedRoleDigest:identity(role),originalGrant:{resources:m.grant.resources,issuedAt:m.grant.issuedAt,expiresAt:m.grant.expiresAt},behaviorWindow:{notBefore:m.notBefore,deadlineAt:m.deadlineAt},actualConfigurationDigest:role.configurationDigest,actualClosureDigest:role.closureDigest,actualProfile:role.profile,rawStore:recorder.rawStoreForRole(roleId),reserveEvidence:q=>recorder.reserveEvidence(roleId,q),retainResponse:(id,bytes)=>recorder.retainResponse(id,bytes),assertCurrentUse:()=>{const start=performance.now(),cpu=process.cpuUsage();try{recorder.assertCurrentUse();}finally{const spent=process.cpuUsage(cpu);guardMeasurements.push({wallMs:performance.now()-start,cpuMs:(spent.user+spent.system)/1000});}},readRetainedResponse:(id,a,n)=>recorder.readRetainedResponse(id,a,n),transport:{id:'transport',key:Buffer.alloc(32,10)},maxResponseBytes:rp.maxResponseBytes});};
  const sources=(r:DevelopmentAcquisitionRecorder)=>new Map(roles.filter(role=>role.kind!=='reviewer').map(role=>[role.id,{application:{store:stores.get(role.id)!,config},accounting:bridge(r,role.id)}]));
  const initial=(r:DevelopmentAcquisitionRecorder)=>{const all=sources(r);for(const [id,s]of all)r.captureApplication(id,s.application,s.accounting);return all;};
  t.after(()=>{for(const store of stores.values())store.close();state.close();rmSync(directory,{recursive:true,force:true});});
  return {f,m,plan,registration,roles,trust,options,raw,state,stores,original,sign,accept,bridge,sources,initial,guardMeasurements,claim:()=>DevelopmentAcquisitionRecorder.claim(options),setTime:(seconds:number)=>{now=Date.parse(f.at(seconds));}};
}


function actualReaderInput(r: DevelopmentAcquisitionRecorder, before: ArtifactRef, after: ArtifactRef, current = after): DevelopmentPageSourceInput {
  const m = r.openAcquiredCapture(after).manifest;
  return { before, after, current, assignmentPacket: r.plan.assignmentPacket, roleId: m.roleId, configurationDigest: m.configurationDigest, pathIdentity: m.source.pathIdentity, journal: m.cut.journalBinding,
    bounds: { maxCaptureBytes: 1048576, maxArtifactBytes: 1048576, maxRows: 512, maxProofBytes: 1048576 }, metadataBounds: { maxRecords: 20000, maxBytes: 8388608 }, readArtifact: (ref, max) => r.readArtifact(ref, max), openAcquiredCapture: ref => r.openAcquiredCapture(ref) };
}

function actualCore(f: ReturnType<typeof recorderFixture>, r: DevelopmentAcquisitionRecorder, a: DevelopmentAccounting) {
  const store = f.stores.get('candidate')!, actualAuthority = { generation: 'synthetic', epoch: 1, controlRevision: 'synthetic-controls' };
  let calls = 0, failedCheckpoint = false;
  const receiver = a.wrapReceiver({ async dispatch(effect) { return { outcome: 'succeeded' as const, receipt: store.putJsonArtifact({ publicSynthetic: true, actualEffect: effect.id }) }; }, async reconcile() { throw Error('unused reconciliation'); } });
  const runtime = new DurableRuntime({ store, resources: a.resources, effects: new EffectJournal(store, { assert() {} }, receiver), now: f.original.now,
    shell: a.wrapShell({ async run(input, bridge) {
      calls++;
      if (failedCheckpoint) { await bridge.persistCheckpoint(input.run.id, input.run.revision, 'synthetic', { observationIds: [], progress: 'new cursor before interrupted return' }); throw Error('actual recorder checkpoint interruption'); }
      return { status: 'checkpointed' as const, observations: [await bridge.execute({ id: `joined-effect:${calls}`, runId: input.run.id, stepId: `step:${calls}`, name: 'fixture_write', arguments: { publicSynthetic: true } })] };
    } }) });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority: actualAuthority, resources: a.role.resources, parentRunId: a.role.allocationId }) });
  return { runtime, core, checkpointFailure: () => { failedCheckpoint = true; } };
}

test('actual recorder pages: registered ordinary conversations cross 512 rows and preserve the exact full prefix', t => {
  const f = recorderFixture(t), r = f.claim(), sources = f.initial(r), source = sources.get('candidate')!, { core } = actualCore(f, r, source.accounting);
  const before = r.status().snapshots.find(c => c.roleId === 'candidate')!.artifact;
  const packet = JSON.parse(Buffer.from(r.readArtifact(r.plan.assignmentPacket, 1048576)).toString()) as { assignments: { id: string; roleId: string; message: AuthenticatedMessage }[] };
  const entries = packet.assignments.filter(e => e.roleId === 'candidate').slice(0, 24);
  f.setTime(0); r.begin(); for (const entry of entries) core.receive(entry.message);
  f.setTime(1); const after = r.captureApplication('candidate', source.application, source.accounting), manifest = r.openAcquiredCapture(after).manifest;
  assert.ok(manifest.cut.physicalRows > 512); assert.ok(manifest.cut.pages.length > 2);
  const p = projectDevelopmentPageSources(actualReaderInput(r, before, after));
  assert.equal(p.assignments.length, 24); assert.equal(p.cycles.length, 0); assert.ok(p.assignments.every(a => a.result === null));
  assert.ok(p.unavailable.every(u => u.subject.startsWith('assignment'))); assert.ok(!p.unavailable.some(u => u.subject === 'source'));
  assert.equal(p.captures[1]!.snapshotDigest, identity(manifest.cut)); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0);
  t.diagnostic(canonicalJson({ actualRecorder: true, physicalRows: manifest.cut.physicalRows, events: manifest.cut.events, pages: manifest.cut.pages.length, serializedBytes: manifest.cut.serializedBytes, assignments: p.assignments.length }));
});

test('actual recorder pages: overwritten checkpoint cursor preserves the exact older result producer', async t => {
  const f = recorderFixture(t), r = f.claim(), sources = f.initial(r), source = sources.get('candidate')!, { core, runtime, checkpointFailure } = actualCore(f, r, source.accounting);
  const before = r.status().snapshots.find(c => c.roleId === 'candidate')!.artifact;
  const packet = JSON.parse(Buffer.from(r.readArtifact(r.plan.assignmentPacket, 1048576)).toString()) as { assignments: { id: string; roleId: string; message: AuthenticatedMessage }[] };
  const first = packet.assignments.find(e => e.roleId === 'candidate')!; f.setTime(0); r.begin(); const run = core.receive(first.message).run;
  await runtime.resume(run.id, { id: 'joined', fragments: [], requestDigest: identity('joined') });
  const old = f.stores.get('candidate')!.get<{ messageSequence: number }>('execution', run.id)!.value;
  const second = { ...first.message, revision: '2', text: 'public synthetic updated request' }; assert.equal(core.receive(second).run.id, run.id); checkpointFailure();
  await runtime.resume(run.id, { id: 'joined', fragments: [], requestDigest: identity('joined') });
  f.setTime(1); const after = r.captureApplication('candidate', source.application, source.accounting), p = projectDevelopmentPageSources(actualReaderInput(r, before, after));
  const assignment = p.assignments.find(a => a.assignmentId === first.id)!;
  assert.ok(assignment.result); assert.equal(assignment.result.messageSequence, old.messageSequence); assert.equal(assignment.linkage, 'admitted');
  assert.ok(assignment.result.origin.execution.revision < f.stores.get('candidate')!.get('execution', run.id)!.revision);
  assert.equal(f.original.snapshot(f.registration.rootId).requests, 1);
  assert.equal(r.openAcquiredCapture(after).resolveJournalVersion(assignment.result.origin.execution.versionId).ref.sha256, assignment.result.origin.execution.sha256);
});

test('actual recorder pages: a control-role withdrawal fences previously cached candidate readers', t => {
  const f = recorderFixture(t), control = f.stores.get('no-memory')!; control.put('memory', 'entry', 'public synthetic withdrawal target', null);
  const r = f.claim(), sources = f.initial(r), before = r.status().snapshots.find(c => c.roleId === 'candidate')!.artifact, input = actualReaderInput(r, before, before);
  const originalOpen = input.openAcquiredCapture, cachedReader = originalOpen(before); input.openAcquiredCapture = () => cachedReader;
  const cached = projectDevelopmentPageSources(input); assert.ok(!cached.unavailable.some(u => u.subject === 'source'));
  control.withdrawDocumentJournalContent({ id: 'joined-control-withdrawal', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  const p = projectDevelopmentPageSources(input); assert.deepEqual(p.cycles, []); assert.deepEqual(p.assignments, []); assert.ok(p.unavailable.some(u => /withdrawn/.test(u.reason)));
  assert.equal(r.status().useDisposition!.value.status, 'document-history-withdrawn'); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0);
  assert.ok(sources.has('no-memory'));
});
