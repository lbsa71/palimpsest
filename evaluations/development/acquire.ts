import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalJson, identity, invariant, type ArtifactRef } from '../../packages/contracts/index.ts';
import { OperationalStore, DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, type SourcePage, type SourceCut, type DevelopmentSnapshot, type JournalRef, type HistoricalSourceUse, type StoredEvent, type PhysicalDocumentRow, type Document } from '../../packages/storage/index.ts';
import { DurableRuntime, type ResourceLedger } from '../../packages/runtime/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import type { AutarkApplication } from '../../deployment/application.ts';
import { DevelopmentAccounting, type DevelopmentCapacityRequest } from '../../deployment/development-accounting.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import { QualificationStore } from '../qualification/store.ts';
import { authenticate, inertSnapshot, signDocument, type Signed } from '../qualification/manifest.ts';
import { collectDevelopmentAccountingTail, collectDevelopmentBehavior, developmentRequestIdentity, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains, type DevelopmentBehavior, type DevelopmentClosure, type DevelopmentReviewBinding, type DevelopmentReviewEnvelope } from './review-envelope.ts';
import { DevelopmentArtifactUnavailable, developmentCapacityProfile, developmentOperationalArtifactBytes, domains, type DevelopmentObservation, type Finding } from './witness.ts';
import { attemptUseDomain, evidenceCustodianDomain, type EvidenceCustodianDisposition, type AttemptUseDisposition, acquisitionMetadataUsage, acquisitionTerminalRecord, verifyAcquisitionPlan, validateAssignmentPacket, type AcquisitionAssignmentPacket, type AcquisitionCapacity, type AcquisitionPlanTrust, type AcquisitionRequestMetadata, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
export type { AcquisitionAssignmentPacket } from './acquisition-plan.ts';

export interface AcquisitionClock { kind: 'host' | 'synthetic'; wallMs: number; monotonicMs: number; bootId: string; processStart: string }
export function hostAcquisitionClock(): AcquisitionClock {
  const stat = readFileSync('/proc/self/stat', 'utf8');
  return { kind: 'host', wallMs: Date.now(), monotonicMs: performance.now(), bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), processStart: `${process.pid}:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}` };
}
export type AcquisitionSourceSnapshot = DevelopmentSnapshot;
interface SourceCapture { roleId: string; source: { pathIdentity: { device: string; inode: string }; journalDigest: string }; artifact: ArtifactRef; cursor: number; snapshotDigest: string; clock: AcquisitionClock; layout?: 'complete-pages-global-originals-v1' }
export interface AcquiredCaptureManifest {version:1; roleId:string; source:SourceCapture['source']; configurationDigest:string; clock:AcquisitionClock; cut:SourceCut}
export interface AcquiredCaptureReader {readonly manifest:AcquiredCaptureManifest; assertUsable():void; pages():IterableIterator<SourcePage>; resolve(original:ArtifactRef,maxBytes:number):Buffer;resolveEvent(sequence:number):StoredEvent;assertUsableNow():void;forEachEvent(visit:(event:StoredEvent)=>void):void;forEachCurrentDocument(visit:(row:PhysicalDocumentRow)=>void):void;resolveJournalVersion(versionId:string):{ref:JournalRef;document:Document}}
export const acquisitionProofCounts={ 'task-output':36,feedback:36,checker:36,'script-receipt':18,cycle:3,learning:3,experience:9,boundary:6,control:5,'reviewer-output':2,'review-judgment':48 } as const;
export type AcquisitionProofKind=keyof typeof acquisitionProofCounts|'adaptation';
interface Reservation { roleId: string; identity: string; responseLimit: number; responseBytes: number; responseArtifacts: string[]; metadata: AcquisitionRequestMetadata }
type ArtifactSlot = 'source' | 'draft' | 'response' | 'snapshot' | 'observation' | 'capture' | 'metadata' | 'failure' | 'page' | 'original' | 'proof';
interface RecorderState {
  planDigest: string; phase: 'claimed' | 'acquiring' | 'freezing' | 'reviewing' | 'closed' | 'failed';
  inventory: { artifact: ArtifactRef; bytes: number; pool: 'draft' | 'response' | 'capture' | 'metadata' | 'failure'; roleId: string | null; slot: ArtifactSlot }[];
  draftBytes: Record<string, number>; reservations: Record<string, Reservation>; snapshots: SourceCapture[];
  observations: Signed<DevelopmentObservation>[]; deliveries: { roleId: string; id: string; runId: string | null }[]; finalCaptures: string[];
  pending: { artifact: ArtifactRef; bytes: number; pool: string; original?:ArtifactRef } | null;
  originals?: {original:ArtifactRef;retained:ArtifactRef;bytes:number}[];
  proofs?:{kind:AcquisitionProofKind;ordinal:number;artifact:ArtifactRef;bytes:number}[]; findings: Finding[];
  behavior: Signed<DevelopmentBehavior> | null; frozen: { frozenAt: string; stateDigest: string; rootCancelled: boolean } | null;
  useDisposition: Signed<AttemptUseDisposition> | null;
  failure: ArtifactRef | null; lastClock: AcquisitionClock; startedAt: string | null;
}
export class AcquisitionUnavailable extends Error { override name = 'AcquisitionUnavailable'; }
export class AcquisitionUseWithdrawn extends AcquisitionUnavailable { override name = 'AcquisitionUseWithdrawn'; }
export interface AcquisitionRecorderOptions {
  custodian?: {store: OperationalStore; key: string};
  state: OperationalStore; raw: QualificationStore; original: ResourceLedger;
  document: Signed<DevelopmentAcquisitionPlan>; trust: AcquisitionPlanTrust;
  /** Injected clock is synthetic only; host clock is sampled internally otherwise. */
  syntheticClock?: () => Omit<AcquisitionClock, 'kind'>;
}
const namespace = 'development.acquisition';
function unavailable(ok: unknown, message: string): asserts ok { if (!ok) throw new AcquisitionUnavailable(message); }
const sourceIdentity = (file: string) => { const s = statSync(file, { bigint: true }); return { device: String(s.dev), inode: String(s.ino) }; };
const refs = (v: unknown, visit: (ref: ArtifactRef) => void): void => { if (!v || typeof v !== 'object') return; if ('uri' in v && 'sha256' in v) { visit(v as ArtifactRef); return; } Object.values(v).forEach(v => refs(v, visit)); };

/** Host-owned finite recorder. It grants no model, process, effect or release authority. */
export class DevelopmentAcquisitionRecorder {
  readonly plan: DevelopmentAcquisitionPlan;
  readonly capacity: AcquisitionCapacity;
  private readonly options: AcquisitionRecorderOptions;
  private readonly sourceHandles = new Map<string, OperationalStore>();
  private denied = false;
  private readonly scopes = new Map<string,{inventoryDigest:string; input:HistoricalSourceUse}>();
  private constructor(o: AcquisitionRecorderOptions, verified: ReturnType<typeof verifyAcquisitionPlan>) { this.options = {...o, trust: structuredClone(o.trust), ...(o.custodian ? {custodian:{...o.custodian}} : {})}; const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}};freeze(verified.plan);freeze(verified.capacity);this.plan = verified.plan; this.capacity = verified.capacity; }
  private clock(): AcquisitionClock {
    const clock = this.options.syntheticClock ? { kind: 'synthetic' as const, ...this.options.syntheticClock() } : hostAcquisitionClock();
    invariant(Number.isFinite(clock.wallMs) && Number.isFinite(clock.monotonicMs) && clock.bootId.length > 0 && Buffer.byteLength(JSON.stringify(clock.bootId)) <= 128 && clock.processStart.length > 0 && Buffer.byteLength(JSON.stringify(clock.processStart)) <= 128, 'Bounded serialized actual clock anchor required');
    unavailable(this.plan.manifest.value.evidenceKind === 'synthetic' || clock.kind === 'host', 'Synthetic clock cannot establish live development'); return clock;
  }
  private static verify(o: AcquisitionRecorderOptions, reopen: boolean) {
    const now = o.syntheticClock ? o.syntheticClock().wallMs : Date.now();
    // Reopen validates the immutable preregistration at its original registration clock, never extends it.
    const verified = verifyAcquisitionPlan(o.document, o.trust, (a, n) => o.raw.readArtifact(a, n), reopen ? Date.parse(o.document.value.manifest.value.registeredAt) : now);
    invariant(verified.plan.version !== 2 || o.raw.profile === developmentCapacityProfile, 'Raw store must explicitly opt into signed capacity profile');
    invariant(identity(o.raw.identity()) === identity(verified.plan.rawStore) && o.original.store.filename === verified.plan.originalStateFile, 'Actual raw/original store differs');
    const s = statSync(o.state.filename), directory = statSync(dirname(o.state.filename));
    invariant(s.uid === process.getuid?.() && (s.mode & 0o077) === 0 && directory.uid === s.uid && (directory.mode & 0o077) === 0 && !verified.plan.roles.some(r=>r.stateFile===o.state.filename), 'Recorder state must be separate owner-only host state');
    const root = o.original.store.get<{ rootId: string; envelope: unknown; startedAt: number }>('allocations', verified.plan.registration.value.rootId)?.value;
    invariant(root && root.rootId === verified.plan.registration.value.rootId && identity(root.envelope) === identity(verified.plan.manifest.value.grant.resources) && root.startedAt === Date.parse(verified.plan.manifest.value.grant.issuedAt), 'Actual original grant changed');
    for (const role of verified.plan.registration.value.roles) {
      const allocation = o.original.store.get<{ rootId: string; parentRunId: string; envelope: unknown }>('allocations', role.allocationId)?.value;
      invariant(allocation && allocation.rootId === root.rootId && allocation.parentRunId === root.rootId && identity(allocation.envelope) === identity(role.resources), 'Actual role allocation changed');
    }
    if (!reopen) {
      invariant(!o.original.snapshot(root.rootId).cancelled, 'Actual original allowance cancelled');
      const actual = o.original.store.list<{ rootId: string; request: unknown; ceiling: unknown; charged: unknown }>('requests').filter(row => row.value.rootId === root.rootId);
      invariant(actual.length === verified.plan.registration.value.originalRequests.length && actual.every(row => { const anchor = verified.plan.registration.value.originalRequests.find(a => a.request.id === row.key); return anchor && !['reserved', 'dispatched', 'uncertain'].includes(anchor.request.status) && identity({ request: row.value.request, ceiling: row.value.ceiling, charged: row.value.charged }) === identity({ request: anchor.request, ceiling: anchor.ceiling, charged: anchor.charged }); }), 'Original quiescent request anchor changed before claim');
    }
    const custodian = this.verifyCustodian(o, verified.plan);
    invariant(reopen || !custodian || custodian.status === 'active', 'Current custodian refuses acquisition before claim');
    return verified;
  }
  static claim(o: AcquisitionRecorderOptions): DevelopmentAcquisitionRecorder {
    const r = new DevelopmentAcquisitionRecorder(o, this.verify(o, false)), clock = r.clock();
    unavailable(!o.state.get(namespace, r.plan.id), 'Acquisition already claimed');
    const claimBytes = 2 * Buffer.byteLength(canonicalJson({ manifest: o.document, claimedAt: new Date(clock.wallMs).toISOString() }));
    unavailable(o.raw.usedBytes + r.capacity.totalBytes + claimBytes <= o.raw.capacityBytes, 'Private store cannot retain claim and full reserved attempt');
    o.raw.claim(r.plan.id, r.plan.manifest.value.grant.id, o.document);
    const state: RecorderState = { planDigest: identity(r.plan), phase: 'claimed', inventory: [], draftBytes: {}, reservations: {}, snapshots: [], ...(r.plan.version===2?{originals:[],proofs:[]}:{}), observations: [], deliveries: [], finalCaptures: [], pending: null, findings: [], behavior: null, frozen: null, failure: null, useDisposition: null, lastClock: clock, startedAt: null };
    o.state.put(namespace, r.plan.id, state, null);
    // Charge preregistered exact source bytes too; they do not become free merely by pre-existing.
    try { refs(r.plan, ref => { const bytes = o.raw.readArtifact(ref, r.plan.manifest.value.limits.maxArtifactBytes); r.writeRaw(bytes, 'capture', null, undefined, 'source'); }); }
    catch (e) { r.fail('claim-source', e); throw e; }
    return r;
  }
  static reopen(o: AcquisitionRecorderOptions): DevelopmentAcquisitionRecorder {
    const r = new DevelopmentAcquisitionRecorder(o, this.verify(o, true)), s = r.state();
    unavailable(s.planDigest === identity(r.plan) && !s.pending, 'Interrupted raw write or changed acquisition binding');
    for (const i of s.inventory) unavailable(o.raw.readArtifact(i.artifact, i.bytes).byteLength === i.bytes, 'Recorded raw inventory changed');
    if (s.phase === 'freezing') { r.fail('interrupted-freeze', new Error('Freeze was interrupted; no behavioral replay')); throw new AcquisitionUnavailable('Interrupted freeze remains fenced'); }
    r.checkClock(); return r;
  }
  private state(): RecorderState { const row = this.options.state.get<RecorderState>(namespace, this.plan.id); invariant(row, 'No durable acquisition claim'); return row.value; }
  private static verifyCustodian(o: AcquisitionRecorderOptions, p: DevelopmentAcquisitionPlan): EvidenceCustodianDisposition | null {
    if (!p.retention) return null;
    invariant(o.custodian && o.trust.retention, 'Actual independently accepted custodian required');
    invariant(!p.roles.some(r => r.stateFile === o.custodian!.store.filename), 'Custodian state must be separate from operational sources');
    const store = o.custodian.store, st = statSync(store.filename), directory = statSync(dirname(store.filename));
    invariant(st.uid === process.getuid?.() && (st.mode & 0o077) === 0 && directory.uid === st.uid && (directory.mode & 0o077) === 0, 'Custodian state must be owner-only');
    const row = store.get<Signed<EvidenceCustodianDisposition>>('development.evidence-custodian', o.custodian.key);
    invariant(row, 'Current custodian disposition unavailable');
    const t = o.trust.retention, d = authenticate(evidenceCustodianDomain, row.value, new Map([[t.custodianSigner, t.custodianKey]]));
    invariant(Object.keys(d).sort().join(',') === 'attemptDigest,custodianId,grantDigest,status,version' && d.version === 1 && d.grantDigest === t.acceptedGrantDigest && d.attemptDigest === identity(p.manifest.value) && d.custodianId === p.retention.value.custodianId && ['active', 'withdrawn', 'destruction-pending'].includes(d.status), 'Changed current custodian disposition');
    return d;
  }
  private sourceDisposition(roleId: string, snapshot: DevelopmentSnapshot, ids: string[], artifact: ArtifactRef | null): AttemptUseDisposition['source'] {
    return {roleId, journalDigest: identity(snapshot.journalBinding), cursor: snapshot.events.at(-1)?.sequence ?? 0, withdrawalIdsDigest: identity(ids), withdrawalCount: ids.length, artifact, retentionStatus: artifact ? 'retained' : 'capacity-unavailable'};
  }
  private markUse(status: AttemptUseDisposition['status'], reasonCode: string, source: AttemptUseDisposition['source'] = null): Signed<AttemptUseDisposition> {
    const s = this.state(); if (s.useDisposition) return inertSnapshot(s.useDisposition);
    const value: AttemptUseDisposition = {version: 1, planDigest: identity(this.plan), attemptDigest: identity(this.plan.manifest.value), grantDigest: this.plan.retention ? identity(this.plan.retention.value) : null, custodianId: this.plan.retention?.value.custodianId ?? this.plan.manifest.value.observerId, status, reasonCode: reasonCode.slice(0,128), behaviorDigest: s.behavior ? identity(s.behavior.value) : null, inventoryDigest: identity(s.inventory), source};
    const observer = this.options.trust.envelope.behavior.observer, signed = signDocument(attemptUseDomain, value, observer.id, observer.key);
    invariant(Buffer.byteLength(canonicalJson(signed)) <= this.capacity.dispositionOwnerBytes, 'Reserved attempt disposition exceeds measured owner capacity');
    this.mutate(s => { s.useDisposition = signed; }); return inertSnapshot(signed);
  }
  /** Trusted host withdrawal; preserves phase, B/T, original charges and every raw byte. */
  withdrawAttemptUse(reasonCode: string, destructionRequested = false): Signed<AttemptUseDisposition> {
    invariant(typeof reasonCode === 'string' && reasonCode.length > 0 && reasonCode.length <= 128 && typeof destructionRequested === 'boolean', 'Bounded trusted withdrawal reason required');
    return this.markUse(destructionRequested ? 'destruction-pending' : 'withdrawn', reasonCode);
  }
  private assertAuthorityOnly(): void {
    unavailable(!this.denied,'Source use remains conservatively refused after marker failure');
    const s = this.state(), marker = s.useDisposition;
    if (marker) { const observer = this.options.trust.envelope.behavior.observer, d = authenticate(attemptUseDomain, marker, new Map([[observer.id, observer.key]])); invariant(d.planDigest === identity(this.plan) && d.attemptDigest === identity(this.plan.manifest.value), 'Changed terminal attempt disposition'); throw new AcquisitionUseWithdrawn(d.status); }
    const disposition = DevelopmentAcquisitionRecorder.verifyCustodian(this.options, this.plan);
    if (disposition && disposition.status !== 'active') { this.markUse(disposition.status, 'custodian-current-disposition'); throw new AcquisitionUseWithdrawn(disposition.status); }
  }
  assertCurrentUse(): void { this.withCurrentUse(() => {}); }
  /** Only trusted synchronous, source/ledger/state-read-only initiation; never an awaited fence. */
  withCurrentUse<T>(use: () => T): T { return this.currentUse(use, true); }
  private currentUse<T>(use: () => T, requireInitial: boolean): T {
    if(this.plan.captureLayout) return this.pagedCurrentUse(use,requireInitial);
    this.assertAuthorityOnly();
    const s = this.state();
    if (requireInitial && this.plan.manifest.value.evidenceKind === 'live-development') unavailable(this.plan.registration.value.roles.filter(r => r.kind !== 'reviewer').every(r => s.snapshots.some(c => c.roleId === r.id)), 'Complete initial behavioral source captures required before live use');
    const captures = [...new Map(s.snapshots.map(c => [c.roleId, c])).values()];
    for (const c of captures) unavailable(this.sourceHandles.has(c.roleId), 'Actual source handle must be attached after reopen');
    let failedSource: {roleId: string; snapshot: DevelopmentSnapshot; ids: string[]} | undefined, corruptRole: string | undefined;
    const visit = (i: number): T => {
      if (i < captures.length) { const c = captures[i]!, store = this.sourceHandles.get(c.roleId)!; return store.transaction(() => visit(i+1)); }
      // Full current graph validation precedes required old-ref availability. Suffix writes
      // are allowed, forged withdrawal membership or a restored payload are not.
      this.assertAuthorityOnly();
      for (const c of captures) {
        const store = this.sourceHandles.get(c.roleId)!;
        try {
          unavailable(identity(sourceIdentity(store.filename)) === identity(c.source.pathIdentity), 'Operational source path replaced');
          const current = store.captureDevelopmentSnapshot({maxRows: this.plan.manifest.value.limits.maxRecords, maxBytes: this.plan.capacity.maxSnapshotBytes});
          const old = JSON.parse(this.loadRaw(c.artifact, this.plan.capacity.maxSnapshotBytes).toString('utf8')).snapshot as DevelopmentSnapshot;
          unavailable(identity(current.journalBinding) === identity(old.journalBinding) && identity(current.events.slice(0,c.cursor)) === identity(old.events), 'Retained operational event prefix replaced/omitted');
          const payloads = new Map(current.journalPayloads.map(p => [p.ref.versionId,p])); const ids: string[] = [];
          for (const p of old.journalPayloads) { const actual = payloads.get(p.ref.versionId); unavailable(actual && identity(actual.ref) === identity(p.ref), 'document-history-corrupt-or-missing'); if (actual.state === 'withdrawn') ids.push(actual.withdrawalId); }
          if (ids.length) { failedSource = {roleId:c.roleId, snapshot:current, ids:[...new Set(ids)].sort()}; throw new AcquisitionUseWithdrawn('document-history-withdrawn'); }
        } catch (error) { if (!failedSource && !/snapshot exceeds bound/.test(String(error))) corruptRole = c.roleId; throw error; }
      }
      const result = use(); invariant(!(result && (typeof result === 'object' || typeof result === 'function') && 'then' in result), 'Current-use callback must be synchronous'); return result;
    };
    try {
      const stores = [...new Set([this.options.state, ...(this.options.custodian ? [this.options.custodian.store] : [])])];
      const outer = (i:number): T => i < stores.length ? stores[i]!.transaction(() => outer(i+1)) : visit(0);
      return outer(0);
    } catch (error) {
      if (failedSource) {
        // A caller may own an outer source transaction. Its observation can
        // refuse use, but cannot establish committed source provenance.
        this.markUse('document-history-withdrawn','source-transaction-current-use-refused');
      } else if (corruptRole) { this.markUse('document-history-corrupt-or-missing','document-history-corrupt-or-missing'); throw new AcquisitionUnavailable(`Current documents disagree with complete source journal: document-history-corrupt-or-missing: ${String(error)}`, {cause:error}); }
      throw error;
    }
  }
  /** Maintenance only: no withdrawn attempt evidence can be read via this request-scoped path. */
  readRetainedResponse(requestId: string, artifact: ArtifactRef, maxBytes: number): Buffer {
    invariant(Number.isSafeInteger(maxBytes) && maxBytes >= 0, 'Bounded retained response read required');
    const s = this.state(), r = s.reservations[requestId], actual = this.options.original.request(requestId), entry = s.inventory.find(i => i.artifact.sha256 === artifact.sha256 && i.pool === 'response');
    invariant(r && actual && actual.status !== 'reserved' && developmentRequestIdentity(actual) === r.identity && r.responseArtifacts.includes(artifact.sha256) && entry && artifact.uri === `sha256:${artifact.sha256}` && entry.bytes <= r.responseLimit && entry.bytes <= maxBytes, 'Response read lacks exact dispatched reservation/inventory scope');
    return this.loadRaw(artifact, Math.min(maxBytes,r.responseLimit));
  }
  private ownerHeadroom(s: RecorderState): number { return (s.failure ? 0 : this.capacity.terminalOwnerBytes) + (s.useDisposition ? 0 : this.capacity.dispositionOwnerBytes) + Math.max(0, this.capacity.maxRequests - s.inventory.filter(i => i.slot === 'response').length) * 1024; }
  private mutate(fn: (s: RecorderState) => void): void {
    this.options.state.transaction(() => { const row = this.options.state.get<RecorderState>(namespace, this.plan.id)!; fn(row.value); this.checkMetadataPromise(row.value); unavailable(Buffer.byteLength(canonicalJson(row.value)) + this.poolUsed(row.value, 'metadata') <= this.capacity.metadataBytes - this.ownerHeadroom(row.value), 'Recorder metadata and terminal/response headroom exhausted'); if(this.plan.captureLayout){const bytes=Buffer.byteLength(canonicalJson(row.value)),inline=row.value.behavior?Buffer.byteLength(canonicalJson(row.value.behavior)):0;unavailable(bytes<=this.plan.captureLayout.metadata.ownerBytes&&bytes-inline<=this.plan.captureLayout.metadata.ownerWithoutBehaviorBytes,'Explicit owner serialized copy bound exhausted');}this.options.state.put(namespace, this.plan.id, row.value, row.revision); });
  }
  private checkClock(): AcquisitionClock {
    const clock = this.clock(), prior = this.state().lastClock;
    unavailable(clock.bootId === prior.bootId && clock.processStart === prior.processStart && clock.wallMs >= prior.wallMs && clock.monotonicMs >= prior.monotonicMs && Math.abs((clock.wallMs - prior.wallMs) - (clock.monotonicMs - prior.monotonicMs)) <= 1000, 'Unexplained clock/process change requires qualified restart evidence');
    this.mutate(s => { s.lastClock = clock; }); return clock;
  }
  private poolUsed(s: RecorderState, pool: RecorderState['inventory'][number]['pool']): number { return s.inventory.filter(i => i.pool === pool).reduce((n, i) => n + i.bytes, 0); }
  begin(): void {
    this.assertCurrentUse();
    const s = this.state(); unavailable(['claimed', 'acquiring'].includes(s.phase), 'Behavioral acquisition stopped'); if (s.startedAt) return;
    const clock = this.checkClock(); unavailable(clock.wallMs >= Date.parse(this.plan.manifest.value.notBefore) && clock.wallMs <= Date.parse(this.plan.manifest.value.deadlineAt), 'Actual acquisition start outside original behavioral window');
    const at = new Date(clock.wallMs).toISOString(); this.observe('acquisition-start', at, { kind: 'start' }); this.mutate(s => { s.startedAt = at; s.phase = 'acquiring'; });
  }
  private remainingSlots(s: RecorderState): Map<ArtifactSlot, number> {
    const limits = new Map<ArtifactSlot, number>([['source', this.plan.captureLayout?.sourcePool.maxArtifacts ?? this.capacity.sourceArtifacts], ['snapshot', this.plan.capacity.maxSnapshots], ['observation', this.capacity.mandatoryObservations], ['response', this.capacity.maxRequests], ['metadata', 2], ['failure', 1]]);
    if(this.plan.captureLayout){ const l=this.plan.captureLayout; limits.set('page',this.plan.capacity.maxSnapshots*l.page.maxPages);limits.set('original',l.referencedOriginalPool.maxOriginals);limits.set('proof',l.proofPool.maxArtifacts); }
    for (const entry of s.inventory) if (limits.has(entry.slot)) limits.set(entry.slot, Math.max(0, limits.get(entry.slot)! - 1));
    return limits;
  }
  private checkMetadataPromise(s: RecorderState, extraEntry?: RecorderState['inventory'][number]): void {
    const projected = extraEntry ? { ...s, inventory: [...s.inventory, extraEntry] } : s;
    const records = projected.inventory.length + [...this.remainingSlots(projected).values()].reduce((n, v) => n + v, 0);
    const usage = acquisitionMetadataUsage(this.plan, this.capacity, records, Object.values(projected.reservations).map(r => r.metadata));
    unavailable(usage.behaviorBytes <= Math.min(this.plan.captureLayout?.metadata.behaviorBytes ?? this.plan.capacity.envelopeBytes, this.plan.manifest.value.limits.maxArtifactBytes) && usage.finalBytes <= Math.min(this.plan.captureLayout?.metadata.finalBytes ?? this.plan.manifest.value.limits.maxArtifactBytes,this.plan.manifest.value.limits.maxArtifactBytes) && (!this.plan.captureLayout || (usage.ownerBytes<=this.plan.captureLayout.metadata.ownerWithoutBehaviorBytes && usage.ownerBytes+usage.behaviorBytes<=this.plan.captureLayout.metadata.ownerBytes)) && usage.totalBytes <= this.capacity.metadataBytes, 'Protected serialized B/final/owner metadata capacity exhausted');
  }
  private mandatoryCaptureReserve(s: RecorderState, slot: ArtifactSlot, bytes: number): number {
    if(this.plan.captureLayout){
      const l=this.plan.captureLayout, used=(k:ArtifactSlot)=>s.inventory.filter(i=>i.slot===k).reduce((n,i)=>n+i.bytes,0), subtract=(k:ArtifactSlot)=>slot===k?bytes:0;
      return Math.max(0,l.sourcePool.maxBytes-used('source')-subtract('source')) + Math.max(0,this.plan.capacity.maxSnapshots*l.page.maxSerializedBytes-used('page')-subtract('page')) + Math.max(0,this.plan.capacity.maxSnapshots*l.maxManifestBytes-used('snapshot')-subtract('snapshot')) + Math.max(0,l.referencedOriginalPool.maxBytes-used('original')-subtract('original')) + Math.max(0,l.proofPool.maxBytes-used('proof')-subtract('proof')) + Math.max(0,this.capacity.mandatoryObservations*this.capacity.observationBytes-used('observation')-subtract('observation'));
    }
    const remaining = this.remainingSlots(s), sourceUsed = s.inventory.filter(i => i.slot === 'source').reduce((n, i) => n + i.bytes, 0);
    return Math.max(0, this.capacity.sourceBytes - sourceUsed - (slot === 'source' ? bytes : 0))
      + Math.max(0, remaining.get('snapshot')! - (slot === 'snapshot' ? 1 : 0)) * this.plan.capacity.maxSnapshotBytes
      + Math.max(0, remaining.get('observation')! - (slot === 'observation' ? 1 : 0)) * this.capacity.observationBytes;
  }
  private writeRaw(value: Uint8Array, pool: RecorderState['inventory'][number]['pool'], roleId: string | null, requestId?: string, slot: ArtifactSlot = pool, diagnostic = false, original?:ArtifactRef): ArtifactRef {
    const bytes = Buffer.from(value), artifact = { uri: `sha256:${hashBytes(bytes)}`, sha256: hashBytes(bytes) }, s = this.state();
    unavailable(!s.pending, 'Incomplete prior raw retention');
    unavailable(bytes.byteLength <= this.plan.manifest.value.limits.maxArtifactBytes, 'Raw artifact exceeds unchanged bound');
    if (pool !== 'failure') unavailable((diagnostic && pool === 'capture' && slot === 'snapshot' && s.useDisposition?.value.status === 'document-history-withdrawn') || (s.phase !== 'closed' && (s.phase !== 'failed' || pool === 'response')), 'Attempt cannot retain new work after stop');
    if (pool === 'response') { const r = s.reservations[requestId!]; invariant(r && (!r.responseArtifacts.length || r.responseArtifacts.includes(artifact.sha256)), 'Changed immutable physical response stream'); }
    const existing = s.inventory.find(i => i.artifact.sha256 === artifact.sha256);
    if (existing) {
      this.options.raw.readArtifact(artifact, bytes.byteLength);
      if(original) this.commitOriginal(original,artifact,bytes.byteLength);
      if (pool === 'response') this.mutate(s => { const r = s.reservations[requestId!]; invariant(r && r.roleId === roleId && bytes.byteLength <= r.responseLimit, 'Response lacks bounded durable reservation'); if (!r.responseArtifacts.includes(artifact.sha256)) r.responseArtifacts.push(artifact.sha256); });
      return artifact;
    }
    const protectedSlots = this.remainingSlots(s); if (protectedSlots.has(slot)) protectedSlots.set(slot, Math.max(0, protectedSlots.get(slot)! - 1));
    unavailable(s.inventory.length + 1 + [...protectedSlots.values()].reduce((n, v) => n + v, 0) <= this.plan.capacity.maxArtifacts, 'Protected raw artifact inventory slots exhausted');
    this.checkMetadataPromise(s, { artifact, bytes: bytes.byteLength, pool, roleId, slot });
    const limit = pool === 'draft' ? this.capacity.draftBytes : pool === 'response' ? this.capacity.responseBytes : pool === 'capture' ? this.capacity.captureBytes : pool === 'failure' ? this.capacity.failureBytes : this.capacity.metadataBytes;
    unavailable(this.poolUsed(s, pool) + bytes.byteLength <= limit, `Protected ${pool} evidence pool exhausted`);
    if (pool === 'capture') {
      unavailable(this.poolUsed(s, pool) + bytes.byteLength + this.mandatoryCaptureReserve(s, slot, bytes.byteLength) <= limit, 'Protected mandatory capture byte headroom exhausted');
    }
    if (pool === 'metadata') unavailable(this.poolUsed(s, pool) + bytes.byteLength + Buffer.byteLength(canonicalJson(s)) + this.plan.capacity.inventoryEntryBytes + this.ownerHeadroom(s) <= this.capacity.metadataBytes, 'Metadata artifact would consume owner state/terminal/response capacity');
    if (pool === 'draft') {
      const role = this.plan.roles.find(r => r.roleId === roleId); invariant(role, 'Registered draft role required');
      unavailable((s.draftBytes[role.roleId] ?? 0) + bytes.byteLength <= role.maxDrafts * (role.maxPayloadBytes + role.maxPromptBytes + role.maxFragmentBytes), 'Role draft byte allowance exhausted');
    }
    if (pool === 'response') { const reservation = requestId ? s.reservations[requestId] : undefined; invariant(reservation && reservation.roleId === roleId, 'Response lacks durable original capacity reservation'); unavailable(reservation.responseBytes + bytes.byteLength <= reservation.responseLimit, 'Reserved response bytes exhausted'); }
    this.mutate(s => { s.pending = { artifact, bytes: bytes.byteLength, pool, ...(original?{original}: {}) }; });
    const retained = this.options.raw.putBytes(bytes); invariant(retained.sha256 === artifact.sha256, 'Raw retention changed bytes');
    this.mutate(s => { s.inventory.push({ artifact, bytes: bytes.byteLength, pool, roleId, slot }); if(original)s.originals!.push({original,retained:artifact,bytes:bytes.byteLength}); s.pending = null; if (pool === 'draft') s.draftBytes[roleId!] = (s.draftBytes[roleId!] ?? 0) + bytes.byteLength; if (pool === 'response') { const r = s.reservations[requestId!]!; r.responseBytes += bytes.byteLength; r.responseArtifacts.push(artifact.sha256); } });
    return artifact;
  }
  rawStoreForRole(roleId: string): Pick<QualificationStore, 'putBytes' | 'readArtifact'> {
    invariant(this.plan.roles.some(r => r.roleId === roleId), 'Unregistered raw writer role');
    return { putBytes: bytes => { this.assertCurrentUse(); const role = this.plan.registration.value.roles.find(r => r.id === roleId)!, phase = this.state().phase; unavailable(role.kind === 'reviewer' ? phase === 'reviewing' : ['claimed', 'acquiring'].includes(phase), 'Raw draft role cannot write outside registered phase'); return this.writeRaw(bytes, 'draft', roleId); }, readArtifact: (a, n = this.plan.manifest.value.limits.maxArtifactBytes) => this.readArtifact(a, n) };
  }
  readArtifact(artifact: ArtifactRef, maxBytes: number): Buffer { this.assertCurrentUse(); return this.loadRaw(artifact, maxBytes); }
  private loadRaw(artifact: ArtifactRef, maxBytes: number): Buffer {
    if (!this.state().inventory.some(i => i.artifact.sha256 === artifact.sha256)) throw new DevelopmentArtifactUnavailable('Artifact absent from durable acquisition inventory');
    try { return this.options.raw.readArtifact({ uri: `sha256:${artifact.sha256}`, sha256: artifact.sha256 }, Math.min(maxBytes, this.plan.manifest.value.limits.maxArtifactBytes)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DevelopmentArtifactUnavailable('Recorded raw bytes unavailable'); throw error; }
  }
  retainResponse(requestId: string, bytes: Uint8Array): ArtifactRef {
    const r = this.state().reservations[requestId], actual = this.options.original.request(requestId); invariant(r && actual && actual.status !== 'reserved' && developmentRequestIdentity(actual) === r.identity, 'Unregistered or undispatched response request'); return this.writeRaw(bytes, 'response', r.roleId, requestId);
  }
  reserveEvidence(roleId: string, request: DevelopmentCapacityRequest): void {
    this.assertCurrentUse();
    const rp = this.plan.roles.find(r => r.roleId === roleId), role = this.plan.registration.value.roles.find(r => r.id === roleId), s = this.state(); invariant(rp && role, 'Unregistered capacity role');
    unavailable(!s.pending && (role.kind === 'reviewer' ? s.phase === 'reviewing' : ['claimed', 'acquiring'].includes(s.phase)), 'Durable acquisition phase refuses dispatch');
    if (role.kind !== 'reviewer' && role.kind !== 'observer') this.begin(); else this.checkClock();
    unavailable(!s.reservations[request.request.id] && Object.values(s.reservations).filter(r => r.roleId === roleId).length < rp.maxDrafts, 'Request identity/finite role slots exhausted');
    invariant(request.maxTransitions === 5 && request.maxResponseBytes <= rp.maxResponseBytes && request.payloadBytes <= rp.maxPayloadBytes, 'Capacity request exceeds fixed payload/response/transition bounds');
    const payload = this.readArtifact(request.payload, rp.maxPayloadBytes); invariant(payload.byteLength === request.payloadBytes && payload.byteLength <= rp.maxPayloadBytes && request.payload.sha256 === request.request.requestDigest, 'Exact payload inventory mismatch');
    const fragmentBytes = request.fragments.reduce((n, f) => { const data = this.readArtifact(f.artifact, rp.maxFragmentBytes); invariant(data.byteLength === f.bytes, 'Fragment inventory mismatch'); return n + data.byteLength; }, 0);
    const promptBytes = request.prompt ? this.readArtifact(request.prompt, rp.maxPromptBytes).byteLength : 0;
    invariant(fragmentBytes <= rp.maxFragmentBytes && promptBytes <= rp.maxPromptBytes && promptBytes + fragmentBytes === request.promptBytes, 'Prompt/fragment aggregate exceeds fixed bounds');
    invariant(request.request.provider === 'effect-receiver' ? role.allowedEffects.includes(request.request.model) : role.profile && request.request.model === role.profile.id && request.request.provider === (role.profile.provider ?? 'mistral'), 'Capacity request changed role profile/effect');
    let allocationId: string | undefined = request.request.runId; const ancestors: string[] = [];
    while (allocationId) { invariant(!ancestors.includes(allocationId) && ancestors.length < 32, 'Capacity request has invalid lineage'); ancestors.push(allocationId); const a: { parentRunId?: string; rootId: string } | undefined = this.options.original.store.get<{ parentRunId?: string; rootId: string }>('allocations', allocationId)?.value; invariant(a && a.rootId === this.plan.registration.value.rootId, 'Capacity request has foreign original root'); allocationId = a.parentRunId; }
    invariant(ancestors.includes(role.allocationId), 'Capacity request has foreign role lineage');
    const longestSigner = [...this.options.trust.envelope.transports.keys()].sort((a, b) => Buffer.byteLength(canonicalJson(b)) - Buffer.byteLength(canonicalJson(a)))[0] ?? '';
    const worstState = { rootId: this.plan.registration.value.rootId, roleId, configurationDigest: role.configurationDigest, closureDigest: role.closureDigest, allocationPath: [...ancestors].reverse(), observedAt: '9999-12-31T23:59:59.999Z', request: { ...request.request, usage: { requests: 1, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER, costUsd: Number.MAX_VALUE, elapsedMs: Number.MAX_SAFE_INTEGER } }, ceiling: { tokens: Number.MAX_SAFE_INTEGER, costUsd: Number.MAX_VALUE, elapsedMs: Number.MAX_SAFE_INTEGER }, charged: { tokens: Number.MAX_SAFE_INTEGER, costUsd: Number.MAX_VALUE, elapsedMs: Number.MAX_SAFE_INTEGER }, payload: request.payload, prompt: request.prompt };
    const worstTransition = { beforeDigest: '0'.repeat(64), state: worstState, settlement: { value: { version: 2, registrationDigest: identity(this.plan.registration.value), requestIdentityDigest: developmentRequestIdentity(request.request), observedAt: worstState.observedAt, dispatched: true, status: 'uncertain', usage: worstState.request.usage, response: { uri: `sha256:${'0'.repeat(64)}`, sha256: '0'.repeat(64) } }, signer: longestSigner, signature: '0'.repeat(64) } };
    unavailable(Buffer.byteLength(canonicalJson(worstTransition)) <= this.plan.capacity.transitionBytes, 'Transition/signature headroom insufficient before original reservation');
    invariant(request.request.id.length <= 248 && request.request.runId.length <= 256 && request.request.reservationId.length <= 256, 'Physical IDs exceed bounded v2 observation contract');
    const size = (v: unknown) => Buffer.byteLength(canonicalJson(v)), idBytes = size(request.request.id);
    const record = { value: { version: 1, id: `request:${request.request.id}`, attemptDigest: identity(this.plan.manifest.value), configurationDigest: role.configurationDigest, candidateId: this.plan.manifest.value.candidate.id, observedAt: worstState.observedAt, artifact: worstTransition.settlement.value.response, data: { kind: 'request', request: worstState.request, ceiling: worstState.ceiling, charged: worstState.charged, payload: request.payload, prompt: request.prompt } }, signer: this.plan.manifest.value.observerId, signature: '0'.repeat(64) };
    const physical = request.maxTransitions * size(worstTransition) + size(worstState) + (request.fragments.length + 3) * this.plan.capacity.inventoryEntryBytes + 512;
    const owner = size({ roleId, identity: '0'.repeat(64), responseLimit: request.maxResponseBytes, responseBytes: request.maxResponseBytes, responseArtifacts: ['0'.repeat(64)], metadata: { behaviorBytes: Number.MAX_SAFE_INTEGER, finalBytes: Number.MAX_SAFE_INTEGER, ownerBytes: Number.MAX_SAFE_INTEGER } }) + idBytes;
    const metadata: AcquisitionRequestMetadata = role.kind === 'reviewer' ? { behaviorBytes: 0, finalBytes: physical + 3 * idBytes, ownerBytes: owner } : { behaviorBytes: physical + size(record) * 2 + 6 * idBytes, finalBytes: 3 * idBytes, ownerBytes: owner + size(record) + 2 * idBytes };
    this.mutate(s => { s.reservations[request.request.id] = { roleId, identity: developmentRequestIdentity(request.request), responseLimit: request.maxResponseBytes, responseBytes: 0, responseArtifacts: [], metadata }; if (s.phase === 'claimed') s.phase = 'acquiring'; });
  }
  private roleApplication(roleId: string, app: Pick<AutarkApplication, 'store' | 'config'>): void {
    const role = this.plan.registration.value.roles.find(r => r.id === roleId), rp = this.plan.roles.find(r => r.roleId === roleId);
    invariant(role && rp && app.store.filename === rp.stateFile && identity(app.config) === role.configurationDigest, 'Actual application source/configuration changed');
  }
  private assertBridge(roleId: string, store: OperationalStore, bridge: DevelopmentAccounting): void {
    const role = this.plan.registration.value.roles.find(r => r.id === roleId);
    invariant(bridge instanceof DevelopmentAccounting && bridge.originalResources === this.options.original && bridge.registrationDigest === identity(this.plan.registration.value) && bridge.role.id === roleId && bridge.resources.store === store && identity(bridge.role) === identity(role), 'Source requires its actual accepted bridge/store/original association');
    const pinned = this.sourceHandles.get(roleId); unavailable(!pinned || pinned === store, 'Actual operational store handle changed');
  }
  private assignmentPacket(): AcquisitionAssignmentPacket { return validateAssignmentPacket(JSON.parse(this.loadRaw(this.plan.assignmentPacket, this.plan.manifest.value.limits.maxArtifactBytes).toString('utf8')), this.plan.registration.value); }
  private remainingAssignmentCaptures(s: RecorderState): number { return this.assignmentPacket().assignments.filter(a => !s.deliveries.some(d => d.roleId === a.roleId && d.id === a.id)).length; }
  attachApplication(roleId: string, app: Pick<AutarkApplication, 'store' | 'config'>, bridge?: DevelopmentAccounting): void {
    this.roleApplication(roleId, app);
    if (roleId === this.plan.registration.value.roles.find(r => r.kind === 'candidate')!.id) invariant(app.store === this.options.original.store, 'Candidate source is not actual original ledger store');
    else invariant(bridge, 'Control source requires its actual accepted bridge/store association');
    if (bridge) this.assertBridge(roleId, app.store, bridge);
    const pinned = this.sourceHandles.get(roleId); unavailable(!pinned || pinned === app.store, 'Actual operational store handle changed'); this.sourceHandles.set(roleId, app.store);
  }
  captureApplication(roleId: string, app: Pick<AutarkApplication, 'store' | 'config'>, bridge?: DevelopmentAccounting): ArtifactRef {
    if(this.plan.captureLayout)return this.capturePagedApplication(roleId,app,bridge);
    unavailable(!app.store.transactionActive, 'Full source capture requires depth-zero source transaction');
    this.attachApplication(roleId, app, bridge); this.assertAuthorityOnly(); const clock = this.checkClock(), s = this.state();
    const role = this.plan.registration.value.roles.find(r => r.id === roleId)!;
    if (role.kind === 'candidate') invariant(app.store === this.options.original.store, 'Candidate source is not actual original ledger store');
    else invariant(bridge, 'Control source requires its actual accepted bridge/store association');
    if (bridge) this.assertBridge(roleId, app.store, bridge);
    const pinned = this.sourceHandles.get(roleId); unavailable(!pinned || pinned === app.store, 'Actual operational store handle changed'); this.sourceHandles.set(roleId, app.store);
    const final = s.phase === 'freezing', behaviorRoles = this.plan.registration.value.roles.filter(r => r.kind !== 'reviewer');
    const futureSnapshots = (final ? behaviorRoles.length - s.finalCaptures.length - 1 : behaviorRoles.length + this.remainingAssignmentCaptures(s)) + (s.useDisposition ? 0 : 1);
    unavailable(s.snapshots.length + 1 + futureSnapshots <= this.plan.capacity.maxSnapshots && (!final || !s.finalCaptures.includes(roleId)), 'Protected final/assignment source snapshot count exhausted');
    const pathIdentity = sourceIdentity(app.store.filename), previous = s.snapshots.filter(c => c.roleId === roleId).at(-1);
    unavailable(!previous || identity(previous.source.pathIdentity) === identity(pathIdentity), 'Operational source path replaced');
    let snapshot: DevelopmentSnapshot;
    try { snapshot = app.store.captureDevelopmentSnapshot({ maxRows: this.plan.manifest.value.limits.maxRecords, maxBytes: this.plan.capacity.maxSnapshotBytes }); }
    catch (error) { if (/snapshot exceeds bound/.test(String(error))) throw error; this.markUse('document-history-corrupt-or-missing', 'document-history-corrupt-or-missing'); throw new AcquisitionUnavailable('Current documents disagree with complete source journal: document-history-corrupt-or-missing', {cause:error}); }
    unavailable(identity(sourceIdentity(app.store.filename)) === identity(pathIdentity), 'Operational source path changed during capture');
    const source = { pathIdentity, journalDigest: identity(snapshot.journalBinding) };
    let withdrawals: string[];
    try { withdrawals = this.validateSnapshot(roleId, snapshot, previous); }
    catch (error) { this.markUse('document-history-corrupt-or-missing','document-history-corrupt-or-missing'); throw error; }
    const bytes = Buffer.from(canonicalJson({ roleId, source, configurationDigest: identity(app.config), clock, snapshot }));
    unavailable(bytes.byteLength <= this.plan.capacity.maxSnapshotBytes, 'Actual source capture exceeds fixed bound');
    // Retain every referenced actual artifact through the source's bounded descriptor/query reader.
    const seen = new Set<string>(); refs(snapshot, ref => { if (seen.has(ref.sha256) || ref.uri.startsWith('sha256:')) return; seen.add(ref.sha256); const bytes = app.store.readArtifact(ref, Math.min(this.plan.manifest.value.limits.maxArtifactBytes,developmentOperationalArtifactBytes)); invariant(hashBytes(bytes) === ref.sha256, 'Operational artifact changed'); this.writeRaw(bytes, 'capture', roleId); });
    const artifact = this.writeRaw(bytes, 'capture', roleId, undefined, 'snapshot');
    this.mutate(s => { s.snapshots.push({ roleId, source, artifact, cursor: snapshot.events.at(-1)?.sequence ?? 0, snapshotDigest: identity(snapshot), clock }); if (final) s.finalCaptures.push(roleId); });
    if (withdrawals.length) { this.markUse('document-history-withdrawn', 'document-history-withdrawn', this.sourceDisposition(roleId, snapshot, withdrawals, artifact)); throw new AcquisitionUseWithdrawn('document-history-withdrawn'); }
    return this.currentUse(() => artifact, false);
  }
  /** Host diagnostic only; never admits a new acquisition or qualifies stopped evidence. */
  captureWithdrawalDiagnostic(roleId: string, app: Pick<AutarkApplication, 'store' | 'config'>, bridge?: DevelopmentAccounting): ArtifactRef {
    unavailable(!this.plan.captureLayout,'Committed withdrawal diagnostic for complete pages is unavailable in this profile; terminal denial retains no source provenance');
    unavailable(!app.store.transactionActive, 'Full diagnostic capture requires depth-zero source transaction');
    unavailable(this.state().useDisposition?.value.status === 'document-history-withdrawn', 'Diagnostic requires terminal source withdrawal');
    this.attachApplication(roleId, app, bridge);
    const pathIdentity = sourceIdentity(app.store.filename), previous = this.state().snapshots.filter(c=>c.roleId===roleId).at(-1);
    unavailable(previous && identity(pathIdentity) === identity(previous.source.pathIdentity), 'Diagnostic requires exact previously captured source');
    const snapshot = app.store.captureDevelopmentSnapshot({maxRows:this.plan.manifest.value.limits.maxRecords,maxBytes:this.plan.capacity.maxSnapshotBytes});
    const ids = this.validateSnapshot(roleId,snapshot,previous); unavailable(ids.length && identity(pathIdentity) === identity(sourceIdentity(app.store.filename)), 'Committed withdrawal diagnostic missing or source changed');
    const bytes = Buffer.from(canonicalJson({purpose:'withdrawal-diagnostic',roleId,source:{pathIdentity,journalDigest:identity(snapshot.journalBinding)},snapshot}));
    unavailable(bytes.byteLength <= this.plan.capacity.maxSnapshotBytes, 'Diagnostic source snapshot exceeds fixed bound');
    return this.writeRaw(bytes,'capture',roleId,undefined,'snapshot',true);
  }
  private validateSnapshot(roleId: string, snapshot: AcquisitionSourceSnapshot, previous?: SourceCapture): string[] {
    const events = snapshot.events; unavailable(events.every((e, i) => e.sequence === i + 1) && new Set(events.map(e => e.id)).size === events.length, 'Omitted, duplicated or reordered actual event sequence');
    const docKey = (namespace: string, key: string) => canonicalJson([namespace, key]);
    const docs = new Map(snapshot.documents.map(d => [docKey(d.namespace, d.key), d])); unavailable(docs.size === snapshot.documents.length, 'Duplicate document source');
    if (previous) {
      const raw = JSON.parse(this.loadRaw(previous.artifact, this.plan.capacity.maxSnapshotBytes).toString('utf8')) as { snapshot: AcquisitionSourceSnapshot };
      unavailable(identity(events.slice(0, previous.cursor)) === identity(raw.snapshot.events), 'Retained operational event prefix replaced/omitted');
      unavailable(identity(snapshot.journalBinding) === identity(raw.snapshot.journalBinding), 'Document journal binding changed after capture');
    }
    const expected = this.plan.roles.find(r => r.roleId === roleId)!.journal, binding = snapshot.journalBinding;
    if (!expected) { unavailable(!binding, 'Unregistered journal cannot establish accepted source history'); this.mutate(s => { if (!s.findings.some(f => f.code === 'document-history-unavailable')) s.findings.push({ status: 'unavailable', code: 'document-history-unavailable', detail: 'Current snapshots do not supply complete document mutation history' }); }); return []; }
    unavailable(binding && identity({ stream: binding.stream, hostId: binding.hostId, maxAnchorDocuments: binding.maxAnchorDocuments, maxAnchorBytes: binding.maxAnchorBytes }) === identity(expected), 'Actual accepted journal construction differs');
    unavailable(binding.schema === 'aeon.document-journal.v2', 'Unsupported source document journal');
    const anchor = events[binding.anchorSequence - 1], data = anchor?.data as unknown as { schema: string; hostId: string; maxAnchorDocuments: number; maxAnchorBytes: number; documents: JournalRef[] };
    unavailable(anchor && anchor.id === binding.anchorId && anchor.stream === binding.stream && anchor.type === 'document-journal-anchor' && data.schema === binding.schema && data.hostId === binding.hostId && data.maxAnchorDocuments === binding.maxAnchorDocuments && data.maxAnchorBytes === binding.maxAnchorBytes, 'Accepted source anchor missing/foreign');
    unavailable(events.filter(e => e.type === 'document-journal-anchor').length === 1, 'Duplicate source journal anchor');
    const payloads = new Map(snapshot.journalPayloads.map(p => [p.ref.versionId, p]));
    unavailable(payloads.size === snapshot.journalPayloads.length, 'Duplicate source journal payload');
    const introduced = new Set<string>(), withdrawn: string[] = [];
    const resolveRef = (ref: JournalRef) => {
      const payload = payloads.get(ref.versionId); unavailable(payload && identity(payload.ref) === identity(ref), 'document-history-corrupt-or-missing');
      unavailable(!introduced.has(ref.versionId), 'Reused source document version'); introduced.add(ref.versionId);
      if (payload.state === 'withdrawn') { withdrawn.push(payload.withdrawalId); return null; }
      unavailable(payload.document.revision === ref.revision && identity(payload.document) === ref.sha256, 'Source document payload digest/revision differs');
      return {namespace: ref.namespace, key: ref.key, ...payload.document};
    };
    const heads = new Map<string, JournalRef>(), reconstructed = new Map<string, DevelopmentSnapshot['documents'][number]>();
    for (const ref of data.documents) { const key = docKey(ref.namespace, ref.key); unavailable(!heads.has(key), 'Duplicate anchored source document'); heads.set(key, ref); const doc = resolveRef(ref); if (doc) reconstructed.set(key, doc); }
    for (const event of events.slice(binding.anchorSequence)) {
      if (event.type !== 'document-mutation') continue;
      const d = event.data as unknown as {schema: string; hostId: string; namespace: string; key: string; before: JournalRef | null; after: JournalRef | null};
      unavailable(event.stream === binding.stream && d.schema === binding.schema && d.hostId === binding.hostId && !d.namespace.startsWith(DOCUMENT_JOURNAL_NAMESPACE), 'Foreign source document mutation');
      const key = docKey(d.namespace, d.key); unavailable(identity(heads.get(key) ?? null) === identity(d.before), 'Lost/reordered source document revision');
      if (d.after) { unavailable(d.after.namespace === d.namespace && d.after.key === d.key && d.after.revision === (d.before?.revision ?? 0) + 1, 'Source document revision gap'); heads.set(key, d.after); const doc = resolveRef(d.after); if (doc) reconstructed.set(key, doc); else reconstructed.delete(key); }
      else { unavailable(d.before, 'Deletion without prior source document'); heads.delete(key); reconstructed.delete(key); }
    }
    unavailable(introduced.size === payloads.size, 'Unintroduced source journal payload');
    // Store capture has validated complete withdrawal membership/heads. Missing values
    // cannot be reconstructed from current rows or an independently retained old copy.
    if (withdrawn.length) return [...new Set(withdrawn)].sort();
    const reserved = docs.get(docKey(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY)); unavailable(reserved?.revision === 1 && identity(reserved.value) === identity(binding), 'Durable source binding changed');
    reconstructed.set(docKey(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY), reserved!);
    const order = (a: DevelopmentSnapshot['documents'][number], b: DevelopmentSnapshot['documents'][number]) => Buffer.compare(Buffer.from(a.namespace), Buffer.from(b.namespace)) || Buffer.compare(Buffer.from(a.key), Buffer.from(b.key));
    unavailable(identity([...reconstructed.values()].sort(order)) === identity([...docs.values()].sort(order)), 'Current documents disagree with complete source journal'); return [];
  }
  deliverAssignment(roleId: string, assignmentId: string, app: Pick<AutarkApplication, 'store' | 'config' | 'communications'>, bridge: DevelopmentAccounting): string {
    this.assertCurrentUse(); this.roleApplication(roleId, app); this.assertBridge(roleId, app.store, bridge);
    if (bridge.role.kind === 'candidate') invariant(app.store === this.options.original.store, 'Candidate source is not actual original ledger store');
    const communications = app.communications, runtime = communications?.options?.runtime, actual = app as Partial<AutarkApplication>;
    invariant(communications instanceof CommunicationsCore && communications.options.store === app.store && runtime instanceof DurableRuntime && runtime.store === app.store && runtime.resources === bridge.resources && (!actual.runtime || actual.runtime === runtime) && (!actual.resources || actual.resources === bridge.resources), 'Actual communications/runtime/store/resources association differs');
    const s = this.state(); unavailable(['claimed', 'acquiring'].includes(s.phase) && !s.deliveries.some(d => d.roleId === roleId && d.id === assignmentId), 'Assignment already attempted or behavioral phase stopped');
    const clock = this.checkClock(); unavailable(clock.wallMs >= Date.parse(this.plan.manifest.value.notBefore) && clock.wallMs <= Date.parse(this.plan.manifest.value.deadlineAt) && !this.options.original.snapshot(this.plan.registration.value.rootId).cancelled && !this.options.original.snapshot(bridge.role.allocationId).cancelled, 'Assignment outside original behavioral window or allowance cancelled');
    const packet = this.assignmentPacket();
    const assignment = packet.assignments.find(a => a.id === assignmentId && a.roleId === roleId); invariant(assignment && Object.keys(assignment).sort().join(',') === 'id,message,roleId', 'Unregistered assignment');
    unavailable(s.snapshots.length + this.remainingAssignmentCaptures(s) + this.plan.registration.value.roles.filter(r => r.kind !== 'reviewer').length <= this.plan.capacity.maxSnapshots, 'Assignment/final capture capacity exhausted before ingress');
    this.begin(); this.mutate(s => { s.deliveries.push({ roleId, id: assignmentId, runId: null }); });
    try { const admitted = communications.receive(inertSnapshot(assignment.message)); this.mutate(s => { s.deliveries.find(d => d.roleId === roleId && d.id === assignmentId)!.runId = admitted.run.id; }); this.captureApplication(roleId, app, bridge); return admitted.run.id; }
    catch (e) { this.fail('assignment-acquisition', e); throw e; }
  }
  private observe(id: string, observedAt: string, data: DevelopmentObservation['data'], configurationDigest = this.plan.manifest.value.candidate.configuration): void {
    const m = this.plan.manifest.value, s = this.state(); unavailable(s.observations.length < this.plan.capacity.maxObservations && !s.observations.some(o => o.value.id === id), 'Observation allowance/identity exhausted');
    const bytes = Buffer.from(canonicalJson({ source: 'host-acquisition', planDigest: identity(this.plan), id, observedAt, data })); unavailable(bytes.byteLength <= this.capacity.observationBytes, 'Mandatory raw observation exceeds protected bound');
    const artifact = this.writeRaw(bytes, 'capture', null, undefined, 'observation');
    const record = signDocument(domains.observation, { version: 1, id, attemptDigest: identity(m), configurationDigest, candidateId: m.candidate.id, observedAt, artifact, data } satisfies DevelopmentObservation, m.observerId, this.options.trust.envelope.behavior.observer.key);
    this.mutate(s => { s.observations.push(record); });
  }
  freezeBehavior(bridge: DevelopmentAccounting, applications: ReadonlyMap<string, { application: Pick<AutarkApplication, 'store' | 'config'>; accounting: DevelopmentAccounting }> = new Map()): Signed<DevelopmentBehavior> {
    this.assertCurrentUse();
    invariant(bridge instanceof DevelopmentAccounting && bridge.originalResources === this.options.original && bridge.registrationDigest === identity(this.plan.registration.value), 'Actual original-grant bridge required');
    unavailable(this.state().phase === 'acquiring' && this.state().startedAt, 'Actual acquisition start missing or behavior already frozen/stopped'); this.checkClock();
    for (const role of this.plan.registration.value.roles.filter(r => r.kind !== 'reviewer')) {
      const source = applications.get(role.id); unavailable(source && source.accounting instanceof DevelopmentAccounting && source.accounting.role.id === role.id && source.accounting.registrationDigest === bridge.registrationDigest && source.accounting.resources.store === source.application.store, 'Actual candidate/control application source missing at freeze'); this.roleApplication(role.id, source.application);
      this.assertBridge(role.id, source.application.store, source.accounting);
    }
    this.mutate(s => { s.phase = 'freezing'; });
    try {
      const frozen = bridge.freezeBehavior(); this.mutate(s => { s.frozen = frozen; });
      for (const role of this.plan.registration.value.roles.filter(r => r.kind !== 'reviewer')) { const source = applications.get(role.id)!; this.captureApplication(role.id, source.application, source.accounting); }
      const requests = bridge.states(), transitions = bridge.transitions();
      for (const request of requests) unavailable(this.state().reservations[request.request.id]?.identity === developmentRequestIdentity(request.request), 'Original request lacks durable recorder reservation');
      for (const state of requests) this.observe(`request:${state.request.id}`, state.observedAt, { kind: 'request', request: state.request, ceiling: state.ceiling, charged: state.charged, payload: state.payload, prompt: state.prompt }, state.configurationDigest);
      this.observe('acquisition-end', frozen.frozenAt, { kind: 'end', accounting: bridge.accounting(this.plan.manifest.value.grant.id) });
      // Actual boundaries require separately qualified host/process/context/feedback adapters.
      this.mutate(s => { for (const boundary of this.plan.manifest.value.boundaries) s.findings.push({ status: 'unavailable', code: `boundary-${boundary}`, detail: 'No qualified actual boundary acquisition adapter supplied' }); });
      const behavior = collectDevelopmentBehavior(this.plan.registration, this.plan.manifest, this.state().observations, requests, transitions, frozen.frozenAt, this.options.trust.envelope, (a, n) => this.readArtifact(a, n), this.clock().wallMs, this.state().inventory.map(i => i.artifact));
      unavailable(behavior.rootCancelled === frozen.rootCancelled, 'Actual root cancellation has no authenticated behavioral transition; B unavailable');
      const signed = signDocument(reviewEnvelopeDomains.behavior, behavior, this.plan.manifest.value.observerId, this.options.trust.envelope.behavior.observer.key);
      unavailable(Buffer.byteLength(canonicalJson(signed)) <= (this.plan.captureLayout?.metadata.behaviorBytes ?? this.plan.capacity.envelopeBytes), 'Frozen behavioral signature metadata exceeds reserve');
      const publish=()=>{this.writeRaw(Buffer.from(canonicalJson(signed)), 'metadata', null);this.mutate(s=>{s.behavior=signed;s.phase='reviewing';});return inertSnapshot(signed);};
      if(this.plan.captureLayout)return this.withFinalCuts(publish);
      publish(); return this.withCurrentUse(()=>inertSnapshot(signed));
    } catch (e) { this.fail('behavior-freeze', e); throw e; }
  }
  close(bridge: DevelopmentAccounting, reviews: Signed<DevelopmentReviewBinding>[]) {
    this.assertCurrentUse();
    const s = this.state(); unavailable(s.phase === 'reviewing' && s.behavior && s.frozen, 'No immutable B for final closure');
    invariant(bridge instanceof DevelopmentAccounting && bridge.originalResources === this.options.original && bridge.registrationDigest === identity(this.plan.registration.value), 'Actual original bridge required');
    const behavior = s.behavior, registrationDigest = identity(this.plan.registration.value), behaviorDigest = identity(behavior.value), transitions = bridge.transitions();
    unavailable(identity(transitions.slice(0, behavior.value.transitions.length)) === identity(behavior.value.transitions), 'Frozen physical history changed');
    const tail = collectDevelopmentAccountingTail(registrationDigest, behavior.value, transitions.slice(behavior.value.transitions.length), reviews, s.inventory.map(i => i.artifact), (a, n) => this.readArtifact(a, n), this.plan.manifest.value.limits);
    const accountingTail = signDocument(reviewEnvelopeDomains.tail, tail, this.plan.manifest.value.observerId, this.options.trust.envelope.behavior.observer.key);
    let closure: Signed<DevelopmentClosure> | null = null;
    // The v2 tail cannot encode a manual root cancellation without a triggering overrun transition.
    if (!bridge.rootCancelled || transitions.some(t => t.state.charged.tokens > t.state.ceiling.tokens || t.state.charged.costUsd > t.state.ceiling.costUsd || t.state.charged.elapsedMs > t.state.ceiling.elapsedMs)) {
      const value: DevelopmentClosure = { version: 2, registrationDigest, behaviorDigest, tailDigest: identity(tail), reviewDigests: reviews.map(r => identity(r.value)).sort(), closedAt: new Date(this.checkClock().wallMs).toISOString(), rootCancelled: bridge.rootCancelled, requestStates: [...this.plan.registration.value.originalRequests, ...bridge.states()].map(s => ({ id: s.request.id, stateDigest: identity(s) })).sort((a, b) => a.id.localeCompare(b.id)), accounting: bridge.accounting(this.plan.manifest.value.grant.id) };
      closure = signDocument(reviewEnvelopeDomains.closure, value, this.options.trust.envelope.closure.id, this.options.trust.envelope.closure.key);
    }
    const envelope: DevelopmentReviewEnvelope = { version: 2, registration: this.plan.registration, behavior, reviews: inertSnapshot(reviews), accountingTail, closure };
    unavailable(Buffer.byteLength(canonicalJson(envelope)) <= Math.min(this.capacity.metadataBytes,this.plan.captureLayout?.metadata.finalBytes ?? this.plan.manifest.value.limits.maxArtifactBytes), 'Final envelope metadata exceeds reserved capacity');
    const result = prepareDevelopmentReviewEnvelope(envelope, this.options.trust.envelope, (a, n) => this.readArtifact(a, n), this.clock().wallMs);
    this.writeRaw(Buffer.from(canonicalJson(envelope)), 'metadata', null); this.mutate(s => { s.phase = 'closed'; });
    this.assertCurrentUse();
    return { ...result, findings: [...result.findings, ...s.findings], status: result.status === 'failed' ? 'failed' as const : s.findings.length ? 'unavailable' as const : result.status };
  }
  fail(code: string, error: unknown): ArtifactRef {
    const s = this.state(); if (s.failure) return s.failure;
    // Terminal record must remain writable after an interrupted ordinary raw intent.
    const detail = String(error).slice(0, 512), bytes = Buffer.from(canonicalJson(acquisitionTerminalRecord(identity(this.plan), s.phase, s.pending, code, detail)));
    invariant(bytes.byteLength <= this.capacity.terminalRawBytes && bytes.byteLength <= this.capacity.failureBytes, 'Reserved terminal failure record exceeds capacity');
    const artifact = this.options.raw.putBytes(bytes);
    this.mutate(s => { s.failure = artifact; s.phase = 'failed'; s.findings.push({ status: 'unavailable', code: code.slice(0, 128), detail }); if (!s.inventory.some(i => i.artifact.sha256 === artifact.sha256)) s.inventory.push({ artifact, bytes: bytes.byteLength, pool: 'failure', roleId: null, slot: 'failure' }); }); return artifact;
  }
  private commitOriginal(original:ArtifactRef,retained:ArtifactRef,bytes:number):void {
    this.mutate(s=>{const old=s.originals!.find(i=>canonicalJson(i.original)===canonicalJson(original));invariant(!old||identity(old)===identity({original,retained,bytes}),'Global original mapping changed');if(!old)s.originals!.push({original,retained,bytes});});
  }
  private retainOriginal(roleId:string,original:ArtifactRef,bytes:Uint8Array):ArtifactRef {
    const l=this.plan.captureLayout!,s=this.state(),old=s.originals!.find(i=>canonicalJson(i.original)===canonicalJson(original));
    invariant(bytes.byteLength<=l.page.maxOperationalArtifactBytes && hashBytes(bytes)===original.sha256,'Exact bounded original bytes required');
    if(old){invariant(old.bytes===bytes.byteLength&&old.retained.sha256===hashBytes(bytes),'Original pair bytes changed');this.loadRaw(old.retained,old.bytes);return old.retained;}
    unavailable(s.originals!.length<l.referencedOriginalPool.maxOriginals && s.originals!.reduce((n,i)=>n+i.bytes,0)+bytes.byteLength<=l.referencedOriginalPool.maxBytes,'Global original count/bytes exhausted');
    return this.writeRaw(bytes,'capture',roleId,undefined,'original',false,inertSnapshot(original));
  }
  /** Extra provenance only, never a source-derived observation or model judgment. */
  retainProtocolArtifact(kind:AcquisitionProofKind,ordinal:number,bytes:Uint8Array):ArtifactRef {
    this.assertCurrentUse();const l=this.plan.captureLayout;invariant(l,'Explicit proof pool required');const pool=l.proofPool,s=this.state(),mandatory=kind!=='adaptation',count=mandatory?acquisitionProofCounts[kind]:pool.maxArtifacts-pool.mandatoryArtifacts;
    invariant(Number.isSafeInteger(ordinal)&&ordinal>=0&&ordinal<count&&bytes instanceof Uint8Array&&bytes.byteLength<=(mandatory?pool.mandatoryArtifactBytes:developmentOperationalArtifactBytes),'Bounded named proof identity/bytes required');
    const old=s.proofs!.find(p=>p.kind===kind&&p.ordinal===ordinal);if(old){invariant(old.artifact.sha256===hashBytes(bytes)&&old.bytes===bytes.byteLength,'Immutable proof identity changed');this.loadRaw(old.artifact,old.bytes);return old.artifact;}
    const mandatoryRemaining=pool.mandatoryArtifacts-s.proofs!.filter(p=>p.kind!=='adaptation').length-(mandatory?1:0),total=s.proofs!.reduce((n,p)=>n+p.bytes,0)+bytes.byteLength;
    unavailable(s.proofs!.length+1+mandatoryRemaining<=pool.maxArtifacts && total+mandatoryRemaining*pool.mandatoryArtifactBytes<=pool.maxBytes,'Protected mandatory proof slots/bytes exhausted');
    const artifact=this.writeRaw(bytes,'capture',null,undefined,'proof');this.mutate(s=>{s.proofs!.push({kind,ordinal,artifact,bytes:bytes.byteLength});});return artifact;
  }
  private capturePagedApplication(roleId:string,app:Pick<AutarkApplication,'store'|'config'>,bridge?:DevelopmentAccounting):ArtifactRef {
    const l=this.plan.captureLayout!; unavailable(!app.store.transactionActive,'Complete source capture requires depth-zero source transaction');
    this.attachApplication(roleId,app,bridge);this.assertAuthorityOnly(); const clock=this.checkClock(),s=this.state(),behaviorRoles=this.plan.registration.value.roles.filter(r=>r.kind!=='reviewer'),final=s.phase==='freezing';
    unavailable(behaviorRoles.some(r=>r.id===roleId),'Reviewer is not a behavioral source');
    const future=final?behaviorRoles.length-s.finalCaptures.length-1:behaviorRoles.length+this.remainingAssignmentCaptures(s);
    unavailable(s.snapshots.length+1+future<=this.plan.capacity.maxSnapshots && (!final||!s.finalCaptures.includes(roleId)),'Protected final/assignment page capture count exhausted');
    const pathIdentity=sourceIdentity(app.store.filename),previous=s.snapshots.filter(c=>c.roleId===roleId).at(-1);unavailable(!previous||identity(previous.source.pathIdentity)===identity(pathIdentity),'Operational source path replaced');
    let cut:SourceCut;
    try {cut=app.store.captureDevelopmentPages(l.page,bytes=>this.writeRaw(bytes,'capture',roleId,undefined,'page'),(original,bytes)=>this.retainOriginal(roleId,original,bytes),(ref,max)=>this.loadRaw(ref,Math.min(max,developmentOperationalArtifactBytes)));}
    catch(error){if(/document-history-withdrawn/.test(String(error)))this.denySource('document-history-withdrawn');throw error;}
    const rp=this.plan.roles.find(r=>r.roleId===roleId)!;invariant(rp.journal && canonicalJson({stream:cut.journalBinding.stream,hostId:cut.journalBinding.hostId,maxAnchorDocuments:cut.journalBinding.maxAnchorDocuments,maxAnchorBytes:cut.journalBinding.maxAnchorBytes})===canonicalJson(rp.journal),'Captured journal binding differs signed source');
    unavailable(identity(pathIdentity)===identity(sourceIdentity(app.store.filename)),'Operational path changed during complete capture');
    const source={pathIdentity,journalDigest:identity(cut.journalBinding)},manifest:AcquiredCaptureManifest={version:1,roleId,source,configurationDigest:identity(app.config),clock,cut};
    const bytes=Buffer.from(canonicalJson(manifest));unavailable(bytes.byteLength<=Math.min(l.maxManifestBytes,developmentOperationalArtifactBytes),'Complete page manifest exceeds bound');
    const artifact=this.writeRaw(bytes,'capture',roleId,undefined,'snapshot'),capture:SourceCapture={roleId,source,artifact,cursor:cut.lastSequence,snapshotDigest:identity(cut),clock,layout:l.kind};
    unavailable(Buffer.byteLength(canonicalJson(capture))<=l.maxCaptureIndexBytes,'Complete capture owner index exceeds reserve');
    this.validatePagedManifest(capture,manifest);if(previous){const old=this.pagedScope(roleId,s.snapshots.filter(c=>c.roleId===roleId));app.store.withDevelopmentVersionsAvailable(old,()=>{});}
    this.mutate(s=>{s.snapshots.push(capture);if(final)s.finalCaptures.push(roleId);});this.scopes.delete(roleId);return this.currentUse(()=>inertSnapshot(artifact),false);
  }
  private decodeManifest(c:SourceCapture):AcquiredCaptureManifest {
    const bytes=this.loadRaw(c.artifact,this.plan.captureLayout!.maxManifestBytes),value=JSON.parse(bytes.toString('utf8')) as AcquiredCaptureManifest;
    invariant(canonicalJson(value)===bytes.toString('utf8')&&value.version===1&&value.roleId===c.roleId&&identity(value.source)===identity(c.source)&&value.cut.lastSequence===c.cursor&&identity(value.cut)===c.snapshotDigest,'Acquired manifest differs accepted cut');return value;
  }
  private *decodedPages(manifest:AcquiredCaptureManifest):IterableIterator<SourcePage> {
    const l=this.plan.captureLayout!,cut=manifest.cut;invariant(cut.pages.length<=l.page.maxPages,'Acquired page count exceeds bound');
    for(const d of cut.pages){const bytes=this.loadRaw(d.artifact,Math.min(d.bytes,l.page.maxPageBytes));invariant(bytes.byteLength===d.bytes,'Acquired page length differs');const page=JSON.parse(bytes.toString('utf8')) as SourcePage;invariant(canonicalJson(page)===bytes.toString('utf8')&&page.schema==='aeon.development.source-page.v1'&&page.table===d.table&&page.rows.length===d.rows&&d.rows<=l.page.maxPageRows,'Acquired page descriptor differs');yield page;}
  }
  private validatePagedManifest(c:SourceCapture,m:AcquiredCaptureManifest):JournalRef[] {
    const l=this.plan.captureLayout!,cut=m.cut,versions:JournalRef[]=[],initial=(table:string)=>hashBytes(Buffer.from(`aeon.development.rows.v1:${table}`));let documents=0,events=0,serialized=0,conservative=0,docDigest=initial('documents'),eventDigest=initial('events'),eventPhase=false;let lastDoc:PhysicalDocumentRow|undefined;const keys=new Set<string>();
    for(const page of this.decodedPages(m)){serialized+=Buffer.byteLength(canonicalJson(page));for(const row of page.rows){if(page.table==='documents'){invariant(!eventPhase,'Document page after event page');const d=row as import('../../packages/storage/index.ts').PhysicalDocumentRow;const key=canonicalJson([d.namespace,d.key]);invariant(!keys.has(key),'Duplicate acquired document');keys.add(key);invariant(!lastDoc||(Buffer.compare(Buffer.from(lastDoc.namespace),Buffer.from(d.namespace))||Buffer.compare(Buffer.from(lastDoc.key),Buffer.from(d.key)))<0,'Acquired documents reordered');lastDoc=d;docDigest=hashBytes(Buffer.from(canonicalJson([docDigest,d])));documents++;if(d.namespace===DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE){const payload=d.value as unknown as import('../../packages/storage/index.ts').JournalPayload;invariant(payload.state==='available','document-history-withdrawn');versions.push(payload.ref);}}else{eventPhase=true;const e=row as import('../../packages/storage/index.ts').StoredEvent;events++;invariant(e.sequence===events,'Acquired event sequence omitted/reordered');eventDigest=hashBytes(Buffer.from(canonicalJson([eventDigest,e])));}}}
    for(const d of cut.pages)conservative+=d.conservativeBytes;
    invariant(documents===cut.documents&&events===cut.events&&events===cut.lastSequence&&documents+events===cut.physicalRows&&cut.physicalRows<=l.page.maxPhysicalRows&&serialized===cut.serializedBytes&&serialized<=l.page.maxSerializedBytes&&conservative===cut.conservativeBytes&&conservative<=l.page.maxConservativeBytes&&docDigest===cut.documentsDigest&&eventDigest===cut.eventsDigest&&identity(cut.journalBinding)===c.source.journalDigest,'Acquired complete page cut differs');
    const mappings=new Set<string>();let originalBytes=0;for(const a of cut.operationalArtifacts){const key=canonicalJson(a.original);invariant(!mappings.has(key)&&a.bytes<=l.page.maxOperationalArtifactBytes&&a.retained.sha256===a.original.sha256,'Acquired original mapping differs');mappings.add(key);originalBytes+=a.bytes;const actual=this.state().originals!.find(i=>canonicalJson(i.original)===key);invariant(actual&&identity(actual)===identity(a),'Original absent global inventory');}invariant(mappings.size<=l.page.maxOperationalArtifacts&&originalBytes<=l.page.maxOperationalArtifactTotalBytes,'Acquired original aggregate differs');
    return versions;
  }
  private pagedScope(roleId:string,captures:SourceCapture[]):HistoricalSourceUse {
    const digest=identity(captures),cached=this.scopes.get(roleId);if(cached?.inventoryDigest===digest)return cached.input;
    const l=this.plan.captureLayout!,versions=new Map<string,JournalRef>();let latest:AcquiredCaptureManifest|undefined;
    for(const c of captures){const m=this.decodeManifest(c);for(const ref of this.validatePagedManifest(c,m)){const old=versions.get(ref.versionId);invariant(!old||identity(old)===identity(ref),'Captured version identity changed');versions.set(ref.versionId,ref);}latest=m;}
    invariant(latest&&versions.size<=l.page.maxPhysicalRows,'Complete captured version scope exceeds bound');
    const input:HistoricalSourceUse={journalDigest:identity(latest.cut.journalBinding),prefix:{lastSequence:latest.cut.lastSequence,eventsDigest:latest.cut.eventsDigest},requiredVersions:[...versions.values()].sort((a,b)=>a.versionId<b.versionId?-1:1),maxPageRows:l.page.maxPageRows,maxPageBytes:l.page.maxPageBytes,maxPrefixBytes:l.page.maxConservativeBytes,maxVersions:l.page.maxPhysicalRows,maxVersionBytes:l.page.maxConservativeBytes,maxWithdrawalMarkerBytes:l.page.maxPageBytes};this.scopes.set(roleId,{inventoryDigest:digest,input});return input;
  }
  private denySource(status:AttemptUseDisposition['status']):never {
    try{this.markUse(status,'source-use-denied');}catch(error){this.denied=true;throw new AcquisitionUseWithdrawn('Source use denied; terminal marker persistence failed',{cause:error});}throw new AcquisitionUseWithdrawn(status);
  }
  private pagedCurrentUse<T>(use:()=>T,requireInitial:boolean):T {
    unavailable(!this.options.state.transactionActive,'Owner writer transaction cannot enter current-use guard');this.assertAuthorityOnly();const s=this.state(),roles=this.plan.registration.value.roles.filter(r=>r.kind!=='reviewer');
    if(requireInitial)unavailable(roles.every(r=>s.snapshots.some(c=>c.roleId===r.id)),'Complete initial behavioral source captures required');
    const scoped=roles.map(r=>({role:r,captures:s.snapshots.filter(c=>c.roleId===r.id)})).filter(r=>r.captures.length);let sourceFailure=false,callbackFailed=false,callbackError:unknown;
    const authority=():T=>{const stores=[...new Set([...(this.options.custodian?[this.options.custodian.store]:[]),this.options.state])];const enter=(i:number):T=>i<stores.length?stores[i]!.transaction(()=>enter(i+1)):(()=>{this.assertAuthorityOnly();try{const value=use();invariant(!(value&&(typeof value==='object'||typeof value==='function')&&'then'in value),'Current-use callback must be synchronous');return value;}catch(error){callbackFailed=true;callbackError=error;throw error;}})();return enter(0);};
    const visit=(i:number):T=>{if(i===scoped.length)return authority();const item=scoped[i]!,store=this.sourceHandles.get(item.role.id);unavailable(store,'Actual source handle must be attached after reopen');const latest=item.captures.at(-1)!;unavailable(identity(sourceIdentity(store.filename))===identity(latest.source.pathIdentity),'Operational source path replaced');try{return store.withDevelopmentVersionsAvailable(this.pagedScope(item.role.id,item.captures),()=>visit(i+1));}catch(error){if(/document-history/.test(String(error)))sourceFailure=true;throw error;}};
    try{return visit(0);}catch(error){if(callbackFailed)throw callbackError;if(sourceFailure)this.denySource(/document-history-withdrawn/.test(String(error))?'document-history-withdrawn':'document-history-corrupt-or-missing');throw error;}
  }
  private withFinalCuts<T>(use:()=>T):T {
    const roles=this.plan.registration.value.roles.filter(r=>r.kind!=='reviewer'),s=this.state();const enter=(i:number):T=>{if(i===roles.length){const stores=[...new Set([...(this.options.custodian?[this.options.custodian.store]:[]),this.options.state])];const authority=(j:number):T=>j<stores.length?stores[j]!.transaction(()=>authority(j+1)):(()=>{this.assertAuthorityOnly();return use();})();return authority(0);}const role=roles[i]!,capture=s.snapshots.filter(c=>c.roleId===role.id).at(-1)!,store=this.sourceHandles.get(role.id)!;unavailable(!store.transactionActive&&s.finalCaptures.includes(role.id),'B requires committed final role cut');return store.withDevelopmentSourceCut({journalDigest:capture.source.journalDigest,lastSequence:capture.cursor},()=>enter(i+1));};return enter(0);
  }
  openAcquiredCapture(artifact:ArtifactRef):AcquiredCaptureReader {
    this.assertCurrentUse();const c=this.state().snapshots.find(c=>identity(c.artifact)===identity(artifact));invariant(c?.layout,'Accepted page capture required');const manifest=this.decodeManifest(c);this.validatePagedManifest(c,manifest);const recorder=this;
    const load=(d:SourceCut['pages'][number]):SourcePage=>recorder.decodedPages({...manifest,cut:{...manifest.cut,pages:[d]}}).next().value!;
    const locations=new Map<string,{page:number;row:number;ref:JournalRef}>(),eventRanges:{first:number;last:number;page:number}[]=[];let events=0;for(let page=0;page<manifest.cut.pages.length;page++){const d=manifest.cut.pages[page]!;if(d.table==='events'){eventRanges.push({first:events+1,last:events+d.rows,page});events+=d.rows;}}
    for(let page=0;page<manifest.cut.pages.length;page++){const value=load(manifest.cut.pages[page]!);if(value.table==='documents')for(let row=0;row<value.rows.length;row++){const d=value.rows[row]!;if(d.namespace===DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE){const payload=d.value as unknown as import('../../packages/storage/index.ts').JournalPayload;invariant(!locations.has(payload.ref.versionId),'Duplicate captured version');locations.set(payload.ref.versionId,{page,row,ref:payload.ref});}}}
    const visit=(table:'documents'|'events',callback:(row:PhysicalDocumentRow|StoredEvent)=>void):void=>{for(const d of manifest.cut.pages.filter(d=>d.table===table))recorder.withCurrentUse(()=>{const p=load(d);for(const row of p.rows){if(p.table==='documents' && ((row as PhysicalDocumentRow).namespace===DOCUMENT_JOURNAL_NAMESPACE||(row as PhysicalDocumentRow).namespace.startsWith(`${DOCUMENT_JOURNAL_NAMESPACE}.`)))continue;const result:unknown=callback(inertSnapshot(row));invariant(!(result&&(typeof result==='object'||typeof result==='function')&&'then'in result),'Acquired capture visitor must be synchronous');}});};
    return {get manifest(){return recorder.withCurrentUse(()=>inertSnapshot(manifest));},assertUsable:()=>recorder.assertCurrentUse(),assertUsableNow:()=>recorder.assertCurrentUse(),*pages(){for(const d of manifest.cut.pages)yield recorder.withCurrentUse(()=>inertSnapshot(load(d)));},
      forEachEvent(callback){visit('events',row=>callback(row as StoredEvent));},forEachCurrentDocument(callback){visit('documents',row=>callback(row as PhysicalDocumentRow));},
      resolve(original,maxBytes){return recorder.withCurrentUse(()=>{invariant(Number.isSafeInteger(maxBytes)&&maxBytes>=0,'Bounded original resolver required');const a=manifest.cut.operationalArtifacts.find(a=>identity(a.original)===identity(original));invariant(a&&a.bytes<=maxBytes&&a.bytes<=developmentOperationalArtifactBytes,'Original absent capture mapping or exceeds resolver bound');return recorder.loadRaw(a.retained,a.bytes);});},
      resolveEvent(sequence){return recorder.withCurrentUse(()=>{invariant(Number.isSafeInteger(sequence)&&sequence>0,'Exact captured event sequence required');const position=eventRanges.find(r=>r.first<=sequence&&sequence<=r.last);invariant(position,'Event absent acquired cut');const page=load(manifest.cut.pages[position.page]!);invariant(page.table==='events','Captured event page differs');const event=page.rows[sequence-position.first]!;invariant(event.sequence===sequence,'Captured event position differs');return inertSnapshot(event);});},
      resolveJournalVersion(versionId){return recorder.withCurrentUse(()=>{const location=locations.get(versionId);invariant(location,'Version absent exact acquired capture');const page=load(manifest.cut.pages[location.page]!);invariant(page.table==='documents','Captured version page differs');const row=page.rows[location.row]!,payload=row.value as unknown as import('../../packages/storage/index.ts').JournalPayload;invariant(row.key===versionId&&payload.state==='available'&&identity(payload.ref)===identity(location.ref)&&identity(payload.document)===location.ref.sha256,'Captured available version commitment differs');return inertSnapshot({ref:location.ref,document:payload.document});});}
    };
  }
  status(): Readonly<RecorderState> { return inertSnapshot(this.state()); }
}
