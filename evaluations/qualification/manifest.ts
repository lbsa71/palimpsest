import { createHmac, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson, digest, identity, invariant, validateCandidate, type CandidateManifest, type ResourceEnvelope } from '../../packages/contracts/index.ts';
import { validateEnvelope } from '../../deployment/config.ts';

export interface Signed<T> { value: T; signer: string; signature: string }
/** Reject executable JS properties before authentication, then detach the exact inert value. */
export function inertSnapshot<T>(value: T): T {
  const seen = new Set<object>();
  const visit = (input: unknown, depth: number): unknown => {
    invariant(depth <= 64, 'Signed JSON exceeds depth limit');
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') { invariant(Number.isFinite(input), 'Signed JSON must be finite'); return input; }
    invariant(typeof input === 'object' && !types.isProxy(input) && !seen.has(input), 'Signed JSON must be inert and acyclic');
    seen.add(input);
    try {
      invariant(Object.getPrototypeOf(input) === (Array.isArray(input) ? Array.prototype : Object.prototype) || Object.getPrototypeOf(input) === null, 'Signed JSON must be plain');
      const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
      invariant(keys.every(key => typeof key === 'string'), 'Signed JSON cannot have symbol properties');
      const array = Array.isArray(input), output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
      if (array) invariant(keys.length === input.length + 1 && keys.includes('length'), 'Signed arrays must be dense');
      for (const key of keys as string[]) {
        if (array && key === 'length') continue;
        const descriptor = descriptors[key]!;
        invariant('value' in descriptor && descriptor.enumerable, 'Signed JSON cannot have accessors or hidden properties');
        if (array) invariant(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < input.length, 'Signed arrays cannot have extra properties');
        Object.defineProperty(output, key, { value: visit(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return output;
    } finally { seen.delete(input); }
  };
  return visit(value, 0) as T;
}
export interface Experiment {
  version: 1; id: string; grantId: string; kind: 'integration' | 'live-product';
  candidate: CandidateManifest; configurationDigest: string; protocolDigest: string; calibrationPlanDigest: string;
  privatePacketDigest: string; observerArtifactDigest: string; evaluatorId: string; priorPolicyDigest: string;
  resources: ResourceEnvelope; issuedAt: string; expiresAt: string;
  maxEvidenceBytes: number; maxArtifactBytes: number;
}
/** The issuer/key map is accepted host configuration, never supplied by a case or candidate. */
export function signDocument<T>(domain: string, value: T, signer: string, key: Uint8Array): Signed<T> {
  invariant(key.byteLength >= 32, 'Host signing key must have at least 32 bytes');
  invariant(typeof domain === 'string' && typeof signer === 'string', 'Explicit signature domain and issuer required');
  const snapshot = inertSnapshot(value);
  return { value: snapshot, signer, signature: createHmac('sha256', key).update(canonicalJson({ domain, signer, value: snapshot })).digest('hex') };
}
export function authenticate<T>(domain: string, document: Signed<T>, keys: ReadonlyMap<string, Uint8Array>): T {
  document = inertSnapshot(document);
  invariant(document && Object.keys(document).sort().join(',') === 'signature,signer,value', 'Exact signed document required');
  const key = keys.get(document.signer); invariant(key, 'Untrusted document issuer');
  const expected = signDocument(domain, document.value, document.signer, key).signature;
  digest(document.signature, 'signature');
  invariant(timingSafeEqual(Buffer.from(document.signature, 'hex'), Buffer.from(expected, 'hex')), 'Invalid host document signature');
  return structuredClone(document.value);
}
export function verifyExperiment(document: Signed<Experiment>, keys: ReadonlyMap<string, Uint8Array>, now = Date.now()): Experiment {
  const e = authenticate('aeon.qualification.experiment.v1', document, keys);
  invariant(Object.keys(e).sort().join(',') === 'calibrationPlanDigest,candidate,configurationDigest,evaluatorId,expiresAt,grantId,id,issuedAt,kind,maxArtifactBytes,maxEvidenceBytes,observerArtifactDigest,priorPolicyDigest,privatePacketDigest,protocolDigest,resources,version', 'Exact experiment fields required');
  invariant(e.version === 1 && ['integration', 'live-product'].includes(e.kind), 'Unknown experiment kind');
  for (const field of ['id', 'grantId', 'evaluatorId'] as const) invariant(typeof e[field] === 'string' && e[field].length > 0 && e[field].length <= 256, 'Bounded experiment identity required');
  validateCandidate(e.candidate); validateEnvelope(e.resources);
  for (const field of ['configurationDigest', 'protocolDigest', 'calibrationPlanDigest', 'privatePacketDigest', 'observerArtifactDigest', 'priorPolicyDigest'] as const) digest(e[field], field);
  invariant(Number.isFinite(Date.parse(e.issuedAt)) && Date.parse(e.issuedAt) <= now && Number.isFinite(Date.parse(e.expiresAt)) && Date.parse(e.expiresAt) > now, 'Experiment outside signed time window');
  invariant(e.resources.maxElapsedMs <= 900000 && Date.parse(e.expiresAt) - Date.parse(e.issuedAt) <= e.resources.maxElapsedMs, 'Original experiment has a finite fifteen-minute maximum');
  for (const [value, limit] of [[e.maxEvidenceBytes, 8 * 1024 * 1024], [e.maxArtifactBytes, 1_000_000]]) invariant(Number.isSafeInteger(value) && value > 0 && value <= limit, 'Bounded evidence limits required');
  invariant(e.maxArtifactBytes <= e.maxEvidenceBytes, 'Artifact limit exceeds experiment evidence allowance');
  return e;
}
export type ObjectiveCheck = { id: string; kind: 'file-equals'; path: string; expected: string } | { id: string; kind: 'file-json'; path: string; expected: unknown } | { id: string; kind: 'node-command'; path: string; args: string[]; expected: { stdout: string; exitCode: number }; timeoutMs: number };
export interface PrivatePacket { task: { id: string; prompt: string }; claim: 'objective-artifact'; checks: ObjectiveCheck[] }
export function verifyPacket(bytes: Uint8Array, experiment: Experiment): PrivatePacket {
  invariant(bytes.byteLength <= experiment.maxEvidenceBytes, 'Private packet exceeds allowance');
  const packet = JSON.parse(Buffer.from(bytes).toString('utf8')) as PrivatePacket;
  invariant(Buffer.from(bytes).equals(Buffer.from(canonicalJson(packet))), 'Private packet must use exact canonical JSON bytes');
  invariant(identity(packet) === experiment.privatePacketDigest, 'Private packet digest mismatch');
  invariant(Object.keys(packet).sort().join(',') === 'checks,claim,task' && packet.claim === 'objective-artifact', 'Subjective, parity and development claims require separate qualified witnesses');
  invariant(Object.keys(packet.task).sort().join(',') === 'id,prompt' && typeof packet.task.id === 'string' && packet.task.id.length > 0 && typeof packet.task.prompt === 'string' && packet.task.prompt.length > 0, 'Exact public task projection required');
  invariant(Array.isArray(packet.checks) && packet.checks.length > 0 && packet.checks.length <= 32 && new Set(packet.checks.map(c => c.id)).size === packet.checks.length, 'Bounded unique private checks required');
  for (const check of packet.checks) {
    invariant(Object.keys(check).sort().join(',') === (check.kind === 'node-command' ? 'args,expected,id,kind,path,timeoutMs' : 'expected,id,kind,path') && typeof check.id === 'string' && check.id.length > 0 && ['file-equals', 'file-json', 'node-command'].includes(check.kind), 'Unsupported objective check');
    invariant(typeof check.path === 'string' && check.path.length <= 512 && check.path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..') && !check.path.includes('\\'), 'Relative artifact path required');
    if (check.kind === 'file-equals') invariant(typeof check.expected === 'string', 'Expected exact file bytes required');
    if (check.kind === 'node-command') {
      invariant(!check.path.startsWith('-') && Number.isSafeInteger(check.timeoutMs) && check.timeoutMs > 0 && check.timeoutMs <= 2000 && Array.isArray(check.args) && check.args.length <= 16 && check.args.every(arg => typeof arg === 'string' && arg.length <= 4096), 'Finite private command check required');
      invariant(Object.keys(check.expected).sort().join(',') === 'exitCode,stdout' && Number.isSafeInteger(check.expected.exitCode) && check.expected.exitCode >= 0 && check.expected.exitCode <= 255 && typeof check.expected.stdout === 'string', 'Exact command outcome required');
    }
    canonicalJson(check.expected);
  }
  invariant(packet.checks.filter(check => check.kind === 'node-command').length <= 8, 'At most eight bounded private command checks');
  return packet;
}
