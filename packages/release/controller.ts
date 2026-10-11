import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, identity, type Authority, type JsonValue, type ReleaseProposal } from '../contracts/index.ts';
import { AuthorityStore, type AuthorityState } from '../supervisor/authority.ts';
import { ProcessLease } from '../supervisor/process-lease.ts';
import { admissionPolicyIdentity, admitCandidate, type AdmissionPolicy, type AdmissionReceipt, type SignedEvaluation } from './admission.ts';
import { hashBytes, verifyCandidate, type FrozenCandidate } from './artifacts.ts';

export interface ReleaseProof { proposal: ReleaseProposal; signed: readonly SignedEvaluation[] }
export interface ReleaseTarget { candidateId: string; policyDigest: string }
export interface ReleaseState {
  phase: 'accepted' | 'transfer' | 'probation' | 'recovery';
  operationalStatePath: string;
  accepted: ReleaseTarget;
  active: ReleaseTarget;
  authority: AuthorityState;
  admissionEvidenceIds: string[];
  probationJudge?: { authority: AuthorityState; policyDigest: string; change: 'ordinary' | 'control-upgrade' };
}
export interface ReleaseStart {
  candidate: FrozenCandidate;
  payloadPath: string;
  authority: Authority;
  operationalStatePath: string;
}
export interface ReleaseHooks {
  /** Idempotently stop all incumbent/candidate children, await exit, and drain or durably mark uncertain effects. */
  stopAndDrain(prior: AuthorityState): Promise<void>;
  /** Start only this verified payload, using the supplied grant and existing operational state. */
  start(target: ReleaseStart): Promise<void>;
}
export interface ReleaseControllerOptions {
  statePath: string;
  artifactStore: string;
  operationalStatePath: string;
  authorityStore: AuthorityStore;
  exclusiveProcessLease: ProcessLease;
  getPolicy(digest: string): AdmissionPolicy;
  readArtifact(uri: string): Uint8Array;
  hooks: ReleaseHooks;
}

/** Host-only coordinator. Its store, artifact store, policy keys and process lease stay outside worker namespaces.
 * A crash at any transfer boundary requires recover(); no pending candidate is silently accepted on restart.
 */
export class ReleaseController {
  readonly #options: ReleaseControllerOptions;
  readonly #db: DatabaseSync;
  #busy = false;
  constructor(options: ReleaseControllerOptions) {
    for (const path of [options.statePath, options.artifactStore, options.operationalStatePath]) {
      if (!isAbsolute(path)) throw new Error('Release paths must be absolute host-owned paths');
    }
    if (!(options.exclusiveProcessLease instanceof ProcessLease)) throw new Error('Exclusive process lease required');
    options.exclusiveProcessLease.assertHeld();
    mkdirSync(dirname(options.statePath), { recursive: true, mode: 0o700 });
    mkdirSync(options.operationalStatePath, { recursive: true, mode: 0o700 });
    this.#options = { ...options, operationalStatePath: realpathSync(options.operationalStatePath) };
    this.#db = new DatabaseSync(options.statePath);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS release_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS release_events(sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS release_proofs(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS release_blobs(digest TEXT PRIMARY KEY, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS release_stages(id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const state = this.status();
    if (state && state.operationalStatePath !== this.#options.operationalStatePath) {
      this.#db.close(); throw new Error('Recovery must preserve the original operational state path');
    }
  }
  close(): void { if (this.#busy) throw new Error('Release operation in progress'); this.#db.close(); }
  status(): ReleaseState | undefined {
    const row = this.#db.prepare('SELECT value FROM release_state WHERE singleton=1').get();
    return row ? JSON.parse(String(row.value)) as ReleaseState : undefined;
  }
  history(): { kind: string; value: unknown }[] {
    return this.#db.prepare('SELECT kind,value FROM release_events ORDER BY sequence').all()
      .map(row => ({ kind: String(row.kind), value: JSON.parse(String(row.value)) }));
  }
  proof(id: string): unknown {
    const row = this.#db.prepare('SELECT value FROM release_proofs WHERE id=?').get(id);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  evidenceArtifact(digest: string): Uint8Array | undefined {
    const row = this.#db.prepare('SELECT bytes FROM release_blobs WHERE digest=?').get(digest);
    return row ? new Uint8Array(row.bytes as Uint8Array) : undefined;
  }
  /** Explicit evaluated initial acceptance; engineering receipts remain labelled engineering. */
  bootstrap(proof: ReleaseProof, policy: AdmissionPolicy): void {
    this.#idle();
    if (this.status()) throw new Error('Release controller already initialized');
    const current = this.#current();
    if (proof.proposal.candidate.id !== current.artifactId) throw new Error('Bootstrap must evaluate the current artifact');
    const receipt = this.#admit(proof, current, policy, 'ordinary', current.artifactId);
    const target = { candidateId: current.artifactId, policyDigest: policy.policyDigest };
    this.#save('bootstrap', { phase: 'accepted', operationalStatePath: this.#options.operationalStatePath,
      accepted: target, active: target, authority: current, admissionEvidenceIds: receipt.evidenceIds });
  }
  async transfer(proof: ReleaseProof, generation: string): Promise<Authority> {
    this.#idle(); this.#busy = true;
    try {
      const state = this.#ready();
      const receipt = this.#admit(proof, state.authority, this.#policy(state.active.policyDigest), 'ordinary', state.accepted.candidateId);
      return await this.#activate({ ...state, probationJudge: { authority: state.authority, policyDigest: state.active.policyDigest, change: 'ordinary' } },
        { candidateId: receipt.candidateId, policyDigest: state.active.policyDigest }, generation, receipt.evidenceIds, 'transfer');
    } finally { this.#busy = false; }
  }
  /** Separate durable stage, judged by the incumbent policy. The new policy cannot judge this change. */
  stageControlUpgrade(proof: ReleaseProof, nextPolicy: AdmissionPolicy): string {
    this.#idle();
    const state = this.#ready();
    const receipt = this.#admit(proof, state.authority, this.#policy(state.active.policyDigest), 'control-upgrade', state.accepted.candidateId);
    if (!receipt.controlChange || nextPolicy.controlRevision !== proof.proposal.candidate.controls ||
      nextPolicy.policyDigest !== admissionPolicyIdentity(nextPolicy)) throw new Error('Staged policy must match the changed control artifact');
    // Persist the exact key digests, evaluator artifacts and required cases, never host-private keys.
    const descriptor = policyDescriptor(nextPolicy);
    const candidate = verifyCandidate(this.#options.artifactStore, receipt.candidateId);
    if (identity((candidate.inputs.controls as { policy?: unknown })?.policy) !== identity(descriptor)) {
      throw new Error('Candidate control manifest must bind the next policy descriptor');
    }
    const id = identity({ receipt, nextPolicy: descriptor, nextPolicyDigest: nextPolicy.policyDigest });
    this.#db.prepare('INSERT OR IGNORE INTO release_stages VALUES(?,?)').run(id,
      canonicalJson({ proof, nextPolicyDigest: nextPolicy.policyDigest, priorAuthority: state.authority }));
    this.#event('control-staged', { id, receipt, nextPolicy: descriptor, nextPolicyDigest: nextPolicy.policyDigest });
    return id;
  }
  async activateStagedControl(id: string, generation: string): Promise<Authority> {
    this.#idle(); this.#busy = true;
    try {
      const state = this.#ready();
      const row = this.#db.prepare('SELECT value FROM release_stages WHERE id=?').get(id);
      if (!row) throw new Error('Unknown staged control upgrade');
      const stage = JSON.parse(String(row.value)) as { proof: ReleaseProof; nextPolicyDigest: string; priorAuthority: AuthorityState };
      if (identity(stage.priorAuthority) !== identity(state.authority)) throw new Error('Staged control upgrade has stale authority');
      const nextPolicy = this.#policy(stage.nextPolicyDigest);
      const receipt = this.#admit(stage.proof, state.authority, this.#policy(state.active.policyDigest), 'control-upgrade', state.accepted.candidateId);
      if (nextPolicy.controlRevision !== stage.proof.proposal.candidate.controls) throw new Error('Staged control identity changed');
      return await this.#activate({ ...state, probationJudge: { authority: state.authority, policyDigest: state.active.policyDigest, change: 'control-upgrade' } },
        { candidateId: receipt.candidateId, policyDigest: nextPolicy.policyDigest }, generation, receipt.evidenceIds, 'transfer');
    } finally { this.#busy = false; }
  }
  /** Fresh probation evidence targets the original admission authority and original judging policy,
   * including for a control upgrade. Current running authority is checked separately. */
  acceptProbation(proof: ReleaseProof): void {
    this.#idle();
    const state = this.#state();
    if (state.phase !== 'probation') throw new Error('No running probation candidate');
    this.#assertState(state);
    if (proof.proposal.candidate.id !== state.active.candidateId ||
      proof.proposal.evidence.some(evidence => state.admissionEvidenceIds.includes(evidence.id))) {
      throw new Error('Probation requires fresh evidence for the active candidate');
    }
    const judge = state.probationJudge;
    if (!judge) throw new Error('Missing probation judge');
    const receipt = this.#admit(proof, judge.authority, this.#policy(judge.policyDigest), judge.change, state.accepted.candidateId);
    const { probationJudge: _, ...accepted } = state;
    this.#save('probation-accepted', { ...accepted, phase: 'accepted', accepted: state.active, admissionEvidenceIds: receipt.evidenceIds });
  }
  /** Provider-independent code recovery. No evidence provider, model, source checkout or memory snapshot is read. */
  async recover(generation: string): Promise<Authority> {
    this.#idle(); this.#busy = true;
    try {
      const state = this.#state();
      // The authority ledger can be one step ahead of the journal after a crash; always fence its actual current grant.
      const current = this.#options.authorityStore.current();
      if (!current) throw new Error('Authority ledger missing');
      return await this.#activate({ ...state, authority: current }, state.accepted, generation, state.admissionEvidenceIds, 'recovery');
    } finally { this.#busy = false; }
  }
  async #activate(state: ReleaseState, target: ReleaseTarget, generation: string, evidenceIds: string[], kind: 'transfer' | 'recovery'): Promise<Authority> {
    if (!generation.trim() || generation === state.authority.generation) throw new Error('A distinct successor generation is required');
    verifyCandidate(this.#options.artifactStore, target.candidateId);
    this.#save(`${kind}-intent`, { ...state, phase: kind, active: target, admissionEvidenceIds: evidenceIds });
    const withdrawn = state.authority.generation ? this.#options.authorityStore.withdraw(this.#grant(state.authority)) : state.authority;
    this.#save('withdrawn', { ...this.#state(), authority: withdrawn });
    await this.#options.hooks.stopAndDrain(state.authority);
    this.#options.exclusiveProcessLease.assertHeld();
    this.#event('drained', { authority: withdrawn });
    // Rehash after drain, immediately before granting authority and executing the host-private payload.
    const candidate = verifyCandidate(this.#options.artifactStore, target.candidateId);
    const authority = this.#options.authorityStore.activate(withdrawn, generation, candidate.manifest.controls, candidate.manifest.id);
    const activated = this.#options.authorityStore.current()!;
    this.#save('activated', { ...this.#state(), authority: activated });
    try {
      await this.#options.hooks.start({ candidate, payloadPath: join(this.#options.artifactStore, candidate.manifest.id, 'payload'),
        authority, operationalStatePath: state.operationalStatePath });
    } catch (error) {
      // Even a partially started candidate loses dispatch authority; recover() must stop/drain it before restarting rescue.
      this.#options.authorityStore.withdraw(authority);
      this.#event('start-failed', { candidateId: target.candidateId });
      throw error;
    }
    this.#options.exclusiveProcessLease.assertHeld();
    this.#options.authorityStore.assert(authority);
    const completed = this.#state();
    if (kind === 'recovery') delete completed.probationJudge;
    this.#save(kind === 'recovery' ? 'recovered' : 'probation-started', { ...completed,
      phase: kind === 'recovery' ? 'accepted' : 'probation', active: target, authority: activated });
    return authority;
  }
  #admit(proof: ReleaseProof, current: AuthorityState, policy: AdmissionPolicy, change: 'ordinary' | 'control-upgrade', rescueId: string): AdmissionReceipt {
    verifyCandidate(this.#options.artifactStore, rescueId);
    const rescueBytes = readFileSync(join(this.#options.artifactStore, rescueId, 'candidate.json'));
    if (proof.proposal.recoveryArtifact.sha256 !== hashBytes(rescueBytes)) throw new Error('Recovery proof must bind the retained accepted rescue manifest');
    const captured = new Map<string, Uint8Array>();
    const read = (uri: string) => { const bytes = Buffer.from(this.#options.readArtifact(uri)); captured.set(hashBytes(bytes), bytes); return bytes; };
    const receipt = admitCandidate(this.#options.artifactStore, proof.proposal, this.#grant(current), policy, proof.signed, read, change);
    const record = { receipt, proof, policy: policyDescriptor(policy) };
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      for (const [digest, bytes] of captured) this.#db.prepare('INSERT OR IGNORE INTO release_blobs VALUES(?,?)').run(digest, bytes);
      this.#db.prepare('INSERT OR IGNORE INTO release_proofs VALUES(?,?)').run(proof.proposal.id, canonicalJson(record));
      const existing = this.proof(proof.proposal.id);
      if (identity(existing) !== identity(record)) throw new Error('Release proof identity reused with different contents');
      this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    return receipt;
  }
  #policy(digest: string): AdmissionPolicy {
    const policy = this.#options.getPolicy(digest);
    if (policy.policyDigest !== digest || admissionPolicyIdentity(policy) !== digest) throw new Error('Host policy differs from retained identity');
    return policy;
  }
  #current(): AuthorityState {
    const current = this.#options.authorityStore.current();
    if (!current?.generation) throw new Error('Serving authority required');
    return current;
  }
  #grant(state: AuthorityState): Authority {
    if (!state.generation) throw new Error('Serving authority required');
    return { generation: state.generation, epoch: state.epoch, controlRevision: state.controlRevision };
  }
  #state(): ReleaseState { const state = this.status(); if (!state) throw new Error('Release controller not initialized'); return state; }
  #assertState(state: ReleaseState): void {
    if (identity(state.authority) !== identity(this.#current())) throw new Error('Release state and authority differ; recover required');
  }
  #ready(): ReleaseState {
    const state = this.#state();
    if (state.phase !== 'accepted') throw new Error('Accept probation or recover before another release');
    this.#assertState(state); return state;
  }
  #idle(): void { this.#options.exclusiveProcessLease.assertHeld(); if (this.#busy) throw new Error('Release operation in progress'); }
  #event(kind: string, value: unknown): void { this.#db.prepare('INSERT INTO release_events(kind,value) VALUES(?,?)').run(kind, canonicalJson(value)); }
  #save(kind: string, state: ReleaseState): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare('INSERT INTO release_state VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value').run(canonicalJson(state));
      this.#event(kind, state); this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}

/** Embed this descriptor as inputs.controls.policy when freezing a control upgrade. */
export function policyDescriptor(policy: Omit<AdmissionPolicy, 'controlRevision' | 'policyDigest'>): JsonValue {
  return { kind: policy.kind, requiredCases: [...policy.requiredCases].sort(),
    evaluatorArtifacts: [...policy.evaluatorArtifacts].sort(([a], [b]) => a.localeCompare(b)),
    evaluatorKeyDigests: [...policy.evaluatorKeys].map(([id, key]) => [id, hashBytes(key)]).sort(([a], [b]) => a!.localeCompare(b!)) };
}
