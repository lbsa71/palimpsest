import { canonicalJson, digest, identity, invariant, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { developmentCapacityProfile, developmentOperationalArtifactBytes, type BoundedArtifactReader } from './witness.ts';
import type { DevelopmentBehavior } from './review-envelope.ts';

export const developmentReviewReceiptBytes = 2048;
export const developmentReviewReadProtocol = 'development-review-sections-v1' as const;
export const developmentReviewCollections = ['behaviorHeader', 'manifest', 'observations', 'requests', 'transitions', 'evidenceHeader', 'evidenceManifest', 'evidenceObservations', 'evidenceArtifacts', 'findings', 'artifactIndex', 'cases'] as const;
export type CollectionName = typeof developmentReviewCollections[number];
export type ReviewCaseKind = 'opportunity' | 'control' | 'boundary';
export type ReviewSelector = { kind: 'collection'; name: CollectionName } | { kind: 'case'; caseKind: ReviewCaseKind; id: string } | { kind: 'observation'; id: string } | { kind: 'request'; id: string } | { kind: 'original'; artifact: ArtifactRef };
export interface ReviewCursor { index: number; offset: number }
export interface BoundedReadArguments { version: 1; behaviorDigest: string; selector: ReviewSelector; cursor: ReviewCursor }
export interface BoundedReadReceipt extends BoundedReadArguments {
  records: { index: number; bytes: number; offset: number; encoding: 'utf8' | 'base64'; content: string }[];
  next: ReviewCursor | null;
}
export interface BoundedDevelopmentReviewInput {
  version: 2; capacityProfile: typeof developmentCapacityProfile; readProtocol: typeof developmentReviewReadProtocol;
  registrationDigest: string; behaviorDigest: string; roleId: string;
  collections: { name: CollectionName; records: number }[];
  cases: { kind: ReviewCaseKind; records: number }[];
}
export interface BoundedDevelopmentEvidenceRead {
  requestId: string; selector: ReviewSelector; cursor: ReviewCursor; receipt: ArtifactRef;
  localToolCallId: string; localRunId: string; stepId: string;
}
function exact(v: unknown, keys: string): asserts v is Record<string, unknown> {
  invariant(v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.split(',').sort().join(','), `Exact projection fields required: ${keys}`);
}
function safe(v: unknown): asserts v is number { invariant(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0, 'Nonnegative safe projection integer required'); }
function id(v: unknown): asserts v is string { invariant(typeof v === 'string' && v.length > 0 && v.length <= 256, 'Bounded projection identity required'); }
function profile(b: DevelopmentBehavior): void {
  invariant(b.manifest.value.version === 2 && b.manifest.value.capacityProfile === developmentCapacityProfile, 'Bounded projection requires named attempt profile');
  exact(b, 'version,registrationDigest,frozenAt,manifest,observations,requests,transitions,rootCancelled,evidence,artifactIndex');
  exact(b.evidence, 'version,kind,evidenceKind,manifest,observations,artifacts,findings,trustProvenance,originalAccounting,finalAccounting');
  const m = b.manifest.value;
  for (const a of [b.observations, b.requests, b.transitions, b.evidence.observations, b.evidence.artifacts, b.evidence.findings, b.artifactIndex, m.opportunities, m.controls, m.boundaries]) invariant(Array.isArray(a) && a.length <= m.limits.maxRecords, 'Bounded projection records required');
  for (const e of b.artifactIndex) {
    exact(e, 'artifact,bytes'); exact(e.artifact, 'uri,sha256'); digest(e.artifact.sha256); safe(e.bytes);
    invariant(e.artifact.uri === `sha256:${e.artifact.sha256}` && e.bytes <= Math.min(m.limits.maxArtifactBytes, developmentOperationalArtifactBytes), 'Unreadable indexed operational singleton');
  }
}
function counts(b: DevelopmentBehavior): number[] {
  const m = b.manifest.value;
  return [1, 1, b.observations.length, b.requests.length, b.transitions.length, 1, 1, b.evidence.observations.length, b.evidence.artifacts.length, b.evidence.findings.length, b.artifactIndex.length, m.opportunities.length + m.controls.length + m.boundaries.length];
}
export function boundedDevelopmentReviewInput(b: DevelopmentBehavior, roleId: string): BoundedDevelopmentReviewInput {
  profile(b); id(roleId); const sizes = counts(b), m = b.manifest.value;
  return { version: 2, capacityProfile: developmentCapacityProfile, readProtocol: developmentReviewReadProtocol, registrationDigest: b.registrationDigest, behaviorDigest: identity(b), roleId,
    collections: developmentReviewCollections.map((name, i) => ({ name, records: sizes[i]! })), cases: [{ kind: 'opportunity', records: m.opportunities.length }, { kind: 'control', records: m.controls.length }, { kind: 'boundary', records: m.boundaries.length }] };
}
function selector(s: ReviewSelector): void {
  invariant(s !== null && typeof s === 'object', 'Projection selector required');
  switch (s.kind) {
    case 'collection': exact(s, 'kind,name'); invariant(developmentReviewCollections.includes(s.name), 'Unknown projection collection'); break;
    case 'case': exact(s, 'kind,caseKind,id'); invariant(['opportunity', 'control', 'boundary'].includes(s.caseKind), 'Unknown projection case kind'); id(s.id); break;
    case 'observation': case 'request': exact(s, 'kind,id'); id(s.id); break;
    case 'original': exact(s, 'kind,artifact'); exact(s.artifact, 'uri,sha256'); digest(s.artifact.sha256); invariant(typeof s.artifact.uri === 'string', 'Original URI required'); break;
    default: invariant(false, 'Unknown projection selector');
  }
}
type RecordValue = { source: string; value: unknown };
function* collection(b: DevelopmentBehavior, name: CollectionName): Generator<RecordValue> {
  const e = b.evidence, m = b.manifest.value;
  switch (name) {
    case 'behaviorHeader': yield { source: name, value: { version: b.version, registrationDigest: b.registrationDigest, frozenAt: b.frozenAt, rootCancelled: b.rootCancelled } }; return;
    case 'manifest': yield { source: name, value: b.manifest }; return;
    case 'evidenceHeader': yield { source: name, value: { version: e.version, kind: e.kind, evidenceKind: e.evidenceKind, trustProvenance: e.trustProvenance, originalAccounting: e.originalAccounting, finalAccounting: e.finalAccounting } }; return;
    case 'evidenceManifest': yield { source: 'evidence/manifest', value: e.manifest }; return;
    case 'cases':
      for (const [i, value] of m.opportunities.entries()) yield { source: `manifest/value/opportunities/${i}`, value };
      for (const [i, value] of m.controls.entries()) yield { source: `manifest/value/controls/${i}`, value };
      for (const [i, value] of m.boundaries.entries()) yield { source: `manifest/value/boundaries/${i}`, value };
      return;
    default: {
      const [values, source] = name === 'evidenceObservations' ? [e.observations, 'evidence/observations'] : name === 'evidenceArtifacts' ? [e.artifacts, 'evidence/artifacts'] : name === 'findings' ? [e.findings, 'evidence/findings'] : [b[name], name];
      for (const [i, value] of values.entries()) yield { source: `${source}/${i}`, value };
    }
  }
}
function* selected(b: DevelopmentBehavior, s: Exclude<ReviewSelector, { kind: 'original' }>): Generator<RecordValue> {
  if (s.kind === 'collection') { yield* collection(b, s.name); return; }
  const m = b.manifest.value;
  if (s.kind === 'observation') {
    const matches = b.observations.filter(v => v.value.id === s.id); invariant(matches.length === 1, 'Missing/duplicate exact observation');
    const i = b.observations.indexOf(matches[0]!); yield { source: `observations/${i}`, value: matches[0] }; return;
  }
  if (s.kind === 'request') {
    const matches = b.requests.filter(v => v.request.id === s.id); invariant(matches.length === 1, 'Missing/duplicate exact request');
    yield { source: `requests/${b.requests.indexOf(matches[0]!)}`, value: matches[0] };
    for (const [i, value] of b.transitions.entries()) if (value.state.request.id === s.id) yield { source: `transitions/${i}`, value };
    return;
  }
  const assignments = s.caseKind === 'opportunity' ? m.opportunities : s.caseKind === 'control' ? m.controls : m.boundaries;
  const matches = assignments.filter(v => (typeof v === 'string' ? v : v.id) === s.id); invariant(matches.length === 1, 'Missing/duplicate exact case');
  const value = matches[0]!, i = assignments.indexOf(value as never);
  yield { source: `manifest/value/${s.caseKind === 'opportunity' ? 'opportunities' : s.caseKind === 'control' ? 'controls' : 'boundaries'}/${i}`, value };
  const interference = s.caseKind === 'opportunity' ? m.opportunities[i]!.interferenceIds : [];
  for (const [j, observation] of b.observations.entries()) {
    const d = observation.value.data;
    const belongs = s.caseKind === 'opportunity' ? d.kind === 'opportunity' && d.assignmentId === s.id || d.kind === 'learning' && d.opportunityId === s.id || d.kind === 'experience' && interference.includes(d.assignmentId) : s.caseKind === 'control' ? d.kind === 'control' && d.assignmentId === s.id : d.kind === 'boundary' && d.boundary === s.id;
    if (belongs) yield { source: `observations/${j}`, value: observation };
  }
}
function utf8(data: Uint8Array): boolean { try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); return true; } catch { return false; } }
function boundary(data: Uint8Array, offset: number): boolean { return offset === data.length || (data[offset]! & 0xc0) !== 0x80; }

/** Pure receipt derivation. Every original call reauthenticates and debits the complete source. */
export function projectDevelopmentReviewRead(b: DevelopmentBehavior, args: BoundedReadArguments, readOriginal: BoundedArtifactReader, bounds: { maxReceiptBytes: number; remainingReadBytes: number }): { bytes: Uint8Array; artifact: ArtifactRef; debitBytes: number } {
  profile(b); exact(args, 'version,behaviorDigest,selector,cursor'); invariant(args.version === 1 && args.behaviorDigest === identity(b), 'Read changed immutable B'); selector(args.selector);
  exact(args.cursor, 'index,offset'); safe(args.cursor.index); safe(args.cursor.offset); exact(bounds, 'maxReceiptBytes,remainingReadBytes'); safe(bounds.maxReceiptBytes); safe(bounds.remainingReadBytes);
  invariant(bounds.maxReceiptBytes >= developmentReviewReceiptBytes && bounds.maxReceiptBytes <= Math.min(developmentOperationalArtifactBytes, b.manifest.value.limits.maxArtifactBytes), 'Invalid receipt allowance');
  let io = 0, raw: Uint8Array | undefined;
  if (args.selector.kind === 'original') {
    const a = args.selector.artifact, entries = b.artifactIndex.filter(e => e.artifact.uri === a.uri && e.artifact.sha256 === a.sha256);
    invariant(entries.length === 1, 'Original outside exact B membership'); const e = entries[0]!;
    invariant(args.cursor.index === 0 && (e.bytes === 0 ? args.cursor.offset === 0 : args.cursor.offset < e.bytes), 'Invalid original cursor');
    invariant(bounds.remainingReadBytes >= developmentReviewReceiptBytes + e.bytes, 'Insufficient original/read receipt budget');
    const data = readOriginal(a, Math.max(1, e.bytes));
    invariant(data.byteLength === e.bytes && hashBytes(data) === a.sha256, 'Original indexed length/digest mismatch'); raw = data; io = data.byteLength;
  } else invariant(bounds.remainingReadBytes >= developmentReviewReceiptBytes, 'Insufficient projection receipt budget');
  const values: Iterator<RecordValue | Uint8Array> = raw ? [raw].values() : selected(b, args.selector as Exclude<ReviewSelector, { kind: 'original' }>);
  let current = values.next();
  for (let i = 0; i < args.cursor.index; i++) { invariant(!current.done, 'Out-of-range projection cursor'); current = values.next(); }
  const receipt: BoundedReadReceipt = { ...args, records: [], next: null };
  const encode = () => Buffer.from(canonicalJson(receipt));
  if (current.done) {
    invariant(args.cursor.index === 0 && args.cursor.offset === 0, 'Terminal projection cursor');
  } else {
    let index = args.cursor.index, offset = args.cursor.offset;
    while (!current.done) {
      const data = current.value instanceof Uint8Array ? current.value : Buffer.from(canonicalJson(current.value));
      invariant(data.byteLength <= b.manifest.value.limits.maxArtifactBytes, 'Projection record exceeds signed metadata allowance');
      invariant(data.byteLength === 0 ? offset === 0 : offset < data.byteLength, 'Out-of-range record byte cursor');
      const isText = utf8(data); invariant(!isText || boundary(data, offset), 'Cursor splits UTF-8 code point');
      const following = values.next();
      const max = Math.min(developmentReviewReceiptBytes, data.byteLength - offset);
      let accepted = false;
      for (let n = max; n >= 0; n--) {
        if (n === 0 && data.byteLength !== 0 || isText && !boundary(data, offset + n)) continue;
        const complete = offset + n === data.byteLength;
        const next = complete ? following.done ? null : { index: index + 1, offset: 0 } : { index, offset: offset + n };
        const fragment = Buffer.from(data.buffer, data.byteOffset + offset, n);
        receipt.records.push({ index, bytes: data.byteLength, offset, encoding: isText ? 'utf8' : 'base64', content: fragment.toString(isText ? 'utf8' : 'base64') }); receipt.next = next;
        if (encode().byteLength <= developmentReviewReceiptBytes) { accepted = true; if (!complete) return finish(); break; }
        receipt.records.pop();
      }
      if (!accepted) { invariant(receipt.records.length > 0, 'Accepted configuration cannot fit one source unit'); receipt.next = { index, offset }; break; }
      current = following; index++; offset = 0;
    }
  }
  return finish();
  function finish() {
    const bytes = encode(); invariant(bytes.byteLength <= developmentReviewReceiptBytes && bytes.byteLength + io <= bounds.remainingReadBytes, 'Receipt exceeded finite read allowance');
    const sha256 = hashBytes(bytes); return { bytes, artifact: { uri: `sha256:${sha256}`, sha256 }, debitBytes: bytes.byteLength + io };
  }
}
