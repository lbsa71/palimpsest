import { createHash } from 'node:crypto';

export const CONTRACT_REVISION = 'aeon1.c1.v1' as const;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ArtifactRef { uri: string; sha256: string }
/** A principal denotes an authenticated recipient, never a display name. */
export type DataScope = { kind: 'public' } | { kind: 'restricted'; principals: string[] };
export interface Provenance { sourceIds: string[]; actorId: string; recordedAt: string; derivation: 'observed' | 'interpreted' | 'summarized' | 'imported' }
export interface Authority { generation: string; epoch: number; controlRevision: string }
export interface ResourceUsage { requests: number; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; elapsedMs: number }
export interface ResourceEnvelope { maxRequests: number; maxTokens: number; maxCostUsd: number; maxElapsedMs: number; maxConcurrency: number }

export class ContractError extends Error { override name = 'ContractError'; }
export function invariant(condition: unknown, message: string): asserts condition { if (!condition) throw new ContractError(message); }
export function nonempty(value: unknown, field: string): asserts value is string { invariant(typeof value === 'string' && value.trim().length > 0, `${field} must be nonempty`); }
export function integer(value: unknown, field: string): asserts value is number { invariant(Number.isSafeInteger(value) && (value as number) >= 0, `${field} must be a nonnegative safe integer`); }
export function digest(value: unknown, field = 'digest'): asserts value is string { invariant(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${field} must be SHA256 hex`); }
export function validateArtifact(value: ArtifactRef): void { nonempty(value.uri, 'artifact.uri'); digest(value.sha256); }
export function validateScope(scope: DataScope): void {
  invariant(scope.kind === 'public' || scope.kind === 'restricted', 'invalid scope');
  if (scope.kind === 'restricted') { invariant(Array.isArray(scope.principals) && scope.principals.length > 0, 'restricted scope needs principals'); scope.principals.forEach(p => nonempty(p, 'principal')); invariant(new Set(scope.principals).size === scope.principals.length, 'duplicate principal'); }
}
/** True only if every destination recipient is already allowed by the source. */
export function scopeAllows(source: DataScope, destination: DataScope): boolean {
  validateScope(source); validateScope(destination);
  return source.kind === 'public' || (destination.kind === 'restricted' && destination.principals.every(p => source.principals.includes(p)));
}
export function validateProvenance(value: Provenance): void {
  nonempty(value.actorId, 'actorId'); invariant(Array.isArray(value.sourceIds) && value.sourceIds.length > 0, 'provenance needs sources'); value.sourceIds.forEach(s => nonempty(s, 'sourceId'));
  invariant(Number.isFinite(Date.parse(value.recordedAt)), 'recordedAt must be a timestamp');
  invariant(['observed', 'interpreted', 'summarized', 'imported'].includes(value.derivation), 'invalid derivation');
}
export function validateAuthority(value: Authority): void { nonempty(value.generation, 'generation'); integer(value.epoch, 'epoch'); nonempty(value.controlRevision, 'controlRevision'); }
export function assertAuthority(actual: Authority, current: Authority): void {
  validateAuthority(actual); validateAuthority(current);
  invariant(actual.generation === current.generation && actual.epoch === current.epoch && actual.controlRevision === current.controlRevision, 'stale or foreign authority');
}
export function validateUsage(value: ResourceUsage): void {
  integer(value.requests, 'requests');
  for (const name of ['inputTokens', 'outputTokens'] as const) if (value[name] !== null) integer(value[name], name);
  for (const name of ['costUsd', 'elapsedMs'] as const) if (value[name] !== null) invariant(Number.isFinite(value[name]) && value[name]! >= 0, `invalid ${name}`);
}
/** Canonical JSON intentionally rejects undefined, non-finite numbers and class instances. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown): string {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') { invariant(Number.isFinite(v), 'non-finite JSON number'); return JSON.stringify(v); }
    invariant(typeof v === 'object', 'not a JSON value'); invariant(!seen.has(v), 'cyclic JSON value'); seen.add(v);
    let result: string;
    if (Array.isArray(v)) { invariant(Object.keys(v).length === v.length, 'sparse or extended JSON array'); result = `[${v.map(encode).join(',')}]`; }
    else { invariant(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, 'not a plain JSON object'); const record = v as Record<string, unknown>; result = `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${encode(record[k])}`).join(',')}}`; }
    seen.delete(v); return result;
  }
  return encode(value);
}
export function identity(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
