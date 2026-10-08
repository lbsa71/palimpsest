import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { resolveExternalPath } from './config.ts';
import { CoordinatorLock } from './ownership.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Release { digest: string; artifactPath: string; governanceDigest: string; dataSchemaVersion: number }
export interface ProcessRef { pid: number; instanceId: string }
declare const actorBrand: unique symbol;
/** Nonserializable authority: only handles present in the custodian's private WeakMap authenticate. */
export type Actor = { readonly [actorBrand]: true };
export interface Checkpoint { sequence: number; snapshot: Json; policyVersion: string; unresolvedEffects: string[]; quiesced: boolean }
export interface InterviewSnapshot { sequence: number; snapshot: Json; policyVersion: string; digest: string }
export interface Binding { candidateDigest: string; evidenceDigest: string; snapshotDigest: string; policyVersion: string }
export interface GateEvidence {
  candidateDigest: string;
  evidenceDigest: string;
  checks: { id: string; status: 'pass' | 'fail' | 'inconclusive'; evidenceDigest: string }[];
  review: { candidateDigest: string; evidenceDigest: string; status: 'pass' | 'fail' | 'inconclusive'; contextDigest: string };
}
export interface CustodianHooks {
  verifyArtifact(release: Release, purpose: 'admission' | 'recovery'): Promise<boolean>;
  checkpoint(options: { quiesce: boolean }): Promise<Checkpoint>;
  launch(release: Release, mode: 'staging' | 'production', context: { launchId: string; epoch: number }): Promise<ProcessRef>;
  stop(process: ProcessRef): Promise<void>;
  probe(process: ProcessRef): Promise<{ runtime: 'healthy' | 'failed' | 'hung'; providerAvailable: boolean }>;
  catchUp(process: ProcessRef, checkpoint: Checkpoint): Promise<void>;
  activate(process: ProcessRef, actor: Actor, checkpoint: Checkpoint): Promise<void>;
  /** Resolve an interrupted launch by its durable ID; undefined means verified absent. */
  reconcileLaunch?(intent: { launchId: string; release: Release; mode: 'staging' | 'production'; epoch: number }): Promise<ProcessRef | undefined>;
}
export interface CustodianOptions {
  storeDir: string;
  hooks: CustodianHooks;
  requiredChecks: string[];
  maxInterviewRounds?: number;
  probationChecks?: number;
  maxRecoveryAttempts?: number;
  hookTimeoutMs?: number;
}
export interface Question { id: string; question: string; answer?: string; challenge?: string }
export interface Succession {
  id: string;
  candidate: Release;
  predecessorRelease: Release;
  predecessor: ProcessRef;
  successor?: ProcessRef;
  state: 'evaluation' | 'transfer' | 'probation' | 'rejected' | 'retired' | 'rolled_back';
  snapshot: InterviewSnapshot;
  evidence?: GateEvidence;
  verdict?: Binding & { decision: 'accept' | 'reject' | 'request_evidence'; reason: string };
  readiness?: Binding;
  questions: Question[];
  followup?: string;
  healthyChecks: number;
}
export interface CustodianState {
  phase: 'empty' | 'normal' | 'evaluation' | 'transfer' | 'probation' | 'recovering' | 'recovery_required';
  epoch: number;
  active?: { release: Release; process: ProcessRef };
  knownGood?: Release;
  successionId?: string;
  successions: Succession[];
  artifacts: Release[];
  quarantine: string[];
  recoveryAttempts: number;
  recoveryIncident?: string;
  pendingLaunch?: { launchId: string; release: Release; mode: 'staging' | 'production'; epoch: number };
  pendingStops: ProcessRef[];
  reason?: string;
}
export interface CustodianEvent { sequence: number; type: string; payload: Json; at: string }

export class CustodianError extends Error {
  constructor(code: string) { super(code); this.name = 'CustodianError'; }
}
function fail(code: string): never { throw new CustodianError(code); }
function text(value: unknown, limit = 16_384): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= limit; }
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function normalized(value: unknown, depth = 0): unknown {
  if (depth > 32) fail('invalid_json');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalized(item, depth + 1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item, depth + 1)]));
  return fail('invalid_json');
}
function canonical(value: unknown): string { return JSON.stringify(normalized(value)); }
export function digestCustodianValue(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function release(value: Release): Release {
  if (!value || !digest(value.digest) || !digest(value.governanceDigest) || !text(value.artifactPath, 4096) || !Number.isSafeInteger(value.dataSchemaVersion) || value.dataSchemaVersion < 1) fail('invalid_release');
  return structuredClone(value);
}
function sameProcess(a: ProcessRef, b: ProcessRef): boolean { return a.pid === b.pid && a.instanceId === b.instanceId; }
function processRef(value: ProcessRef): ProcessRef {
  if (!value || !Number.isSafeInteger(value.pid) || value.pid < 1 || !text(value.instanceId, 256)) fail('invalid_process_identity');
  return { pid: value.pid, instanceId: value.instanceId };
}
function positive(value: number | undefined, fallback: number): number {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < 1 || number > 300_000) fail('invalid_limit');
  return number;
}

/** Mechanical admission/authority journal. Host hooks are trusted; model text has no administrative authority. */
export class Custodian {
  readonly #db: DatabaseSync;
  readonly #lock: CoordinatorLock;
  readonly #hooks: CustodianHooks;
  readonly #required: string[];
  readonly #maxRounds: number;
  readonly #probationChecks: number;
  readonly #maxRecovery: number;
  readonly #hookTimeout: number;
  readonly #actors = new WeakMap<Actor, { process: ProcessRef; release: Release; epoch: number }>();
  readonly #handles = new Map<string, Actor>();
  #state: CustodianState;
  #busy = false;
  #closed = false;

  constructor(options: CustodianOptions) {
    if (!Array.isArray(options.requiredChecks) || !options.requiredChecks.length || options.requiredChecks.some((item) => !text(item, 256)) || new Set(options.requiredChecks).size !== options.requiredChecks.length) fail('invalid_required_checks');
    this.#hooks = options.hooks;
    this.#required = [...options.requiredChecks];
    this.#maxRounds = positive(options.maxInterviewRounds, 3);
    this.#probationChecks = positive(options.probationChecks, 3);
    this.#maxRecovery = positive(options.maxRecoveryAttempts, 2);
    this.#hookTimeout = positive(options.hookTimeoutMs, 10_000);
    const repository = fileURLToPath(new URL('..', import.meta.url));
    const directory = resolveExternalPath(repository, options.storeDir);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#lock = new CoordinatorLock(resolveExternalPath(repository, join(directory, 'custodian-lock.sqlite')));
    try {
      const path = resolveExternalPath(repository, join(directory, 'custodian.sqlite'));
      this.#db = new DatabaseSync(path);
      chmodSync(path, 0o600);
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS custodian_state(id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS custodian_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,payload TEXT NOT NULL,at TEXT NOT NULL);');
      const row = this.#db.prepare('SELECT record FROM custodian_state WHERE id=1').get() as { record: string } | undefined;
      this.#state = row ? JSON.parse(row.record) as CustodianState : { phase: 'empty', epoch: 0, successions: [], artifacts: [], quarantine: [], pendingStops: [], recoveryAttempts: 0 };
      if (!row) this.#save('initialized', {});
    } catch (error) { this.#lock.close(); throw error; }
  }

  close(): void {
    if (!this.#closed) { this.#closed = true; this.#db.close(); this.#lock.close(); this.#handles.clear(); }
  }
  #open(): void { if (this.#closed) fail('custodian_closed'); }
  #available(): void { this.#open(); if (this.#busy) fail('transition_in_progress'); }
  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.#available(); this.#busy = true;
    try { return await operation(); } finally { this.#busy = false; }
  }
  async #hook<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CustodianError('hook_timeout')), this.#hookTimeout); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  #save(type: string, payload: Json): void {
    this.#open();
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare('INSERT INTO custodian_state(id,record) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(JSON.stringify(this.#state));
      this.#db.prepare('INSERT INTO custodian_events(type,payload,at) VALUES(?,?,?)').run(type, JSON.stringify(payload), new Date().toISOString());
      this.#db.exec('COMMIT');
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  inspect(): CustodianState { this.#open(); return structuredClone(this.#state); }
  journal(): CustodianEvent[] {
    this.#open();
    return this.#db.prepare('SELECT sequence,type,payload,at FROM custodian_events ORDER BY sequence').all().map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as unknown as CustodianEvent);
  }
  #issue(process: ProcessRef, item: Release, epoch = 0): Actor {
    const handle = this.#handles.get(process.instanceId) ?? Object.freeze({}) as Actor;
    this.#actors.set(handle, { process: structuredClone(process), release: structuredClone(item), epoch });
    this.#handles.set(process.instanceId, handle);
    return handle;
  }
  #authenticated(actor: Actor): { process: ProcessRef; release: Release; epoch: number } {
    this.#open();
    const record = actor && typeof actor === 'object' ? this.#actors.get(actor) : undefined;
    if (!record) fail('unauthorized');
    return record;
  }
  assertAuthority(actor: Actor, scope: 'tool' | 'store' | 'memory' | 'message', peer: ProcessRef): { epoch: number; releaseDigest: string } {
    const authenticated = this.#authenticated(actor);
    if (!['tool', 'store', 'memory', 'message'].includes(scope) || !sameProcess(authenticated.process, peer)) fail('unauthorized');
    if (!this.#state.active || authenticated.epoch !== this.#state.epoch || !sameProcess(this.#state.active.process, peer) || this.#state.active.release.digest !== authenticated.release.digest || !['normal', 'evaluation', 'probation'].includes(this.#state.phase)) fail('stale_authority');
    return { epoch: this.#state.epoch, releaseDigest: authenticated.release.digest };
  }
  #succession(id: string): Succession {
    const record = this.#state.successions.find((item) => item.id === id);
    if (!record) fail('unknown_succession');
    return record;
  }
  #participant(actor: Actor, record: Succession, role?: 'incumbent' | 'successor'): void {
    const authenticated = this.#authenticated(actor);
    const incumbent = sameProcess(authenticated.process, record.predecessor);
    const successor = record.successor && sameProcess(authenticated.process, record.successor);
    if (role === 'incumbent' ? !incumbent : role === 'successor' ? !successor : !incumbent && !successor) fail('wrong_actor');
  }
  status(actor: Actor, id: string): Succession { const record = this.#succession(id); this.#participant(actor, record); return structuredClone(record); }
  snapshot(actor: Actor, id: string): InterviewSnapshot { return this.status(actor, id).snapshot; }
  #evaluation(record: Succession): void { if (this.#state.phase !== 'evaluation' || record.state !== 'evaluation' || this.#state.successionId !== record.id) fail('invalid_succession_state'); }
  async #checkpoint(quiesce = true): Promise<Checkpoint> {
    const result = await this.#hook(this.#hooks.checkpoint({ quiesce }));
    if (!result || !Number.isSafeInteger(result.sequence) || result.sequence < 0 || !text(result.policyVersion, 256) || !Array.isArray(result.unresolvedEffects) || result.unresolvedEffects.some((item) => !text(item, 512)) || typeof result.quiesced !== 'boolean') fail('invalid_checkpoint');
    if (Buffer.byteLength(canonical(result.snapshot)) > 1_048_576) fail('snapshot_limit');
    return structuredClone(result);
  }
  #snapshot(checkpoint: Checkpoint): InterviewSnapshot {
    const snapshot = { sequence: checkpoint.sequence, snapshot: checkpoint.snapshot, policyVersion: checkpoint.policyVersion };
    return { ...snapshot, digest: digestCustodianValue(snapshot) };
  }
  async #verify(item: Release, purpose: 'admission' | 'recovery'): Promise<void> {
    if (!await this.#hook(this.#hooks.verifyArtifact(structuredClone(item), purpose))) fail('artifact_integrity');
  }
  async #launch(item: Release, mode: 'staging' | 'production'): Promise<ProcessRef> {
    const intent = { release: item, mode, launchId: randomUUID(), epoch: this.#state.epoch };
    this.#state.pendingLaunch = intent;
    this.#save('launch.intent', { digest: item.digest, launchId: intent.launchId, mode });
    const process = processRef(await this.#hook(this.#hooks.launch(structuredClone(item), mode, { launchId: intent.launchId, epoch: intent.epoch })));
    if (this.#handles.has(process.instanceId) || (this.#state.active && sameProcess(process, this.#state.active.process))) fail('reused_process_identity');
    // Keep the intent until the caller has durably attached the returned process.
    return process;
  }

  async bootstrap(initial: Release): Promise<Actor> {
    return this.#exclusive(async () => {
      if (this.#state.phase !== 'empty') fail('already_bootstrapped');
      const item = release(initial);
      await this.#verify(item, 'recovery');
      this.#state.knownGood = item; this.#state.artifacts.push(item);
      this.#save('bootstrap.registered', { digest: item.digest });
      const actor = await this.#recover('bootstrap');
      if (!actor) fail('bootstrap_failed');
      return actor;
    });
  }

  async propose(incumbent: Actor, candidate: Release): Promise<{ id: string; successor: Actor }> {
    return this.#exclusive(async () => {
      const authenticated = this.#authenticated(incumbent);
      this.assertAuthority(incumbent, 'tool', authenticated.process);
      if (this.#state.phase !== 'normal') fail('invalid_succession_state');
      if (this.#state.pendingLaunch) fail('unresolved_launch');
      await this.#stopPending();
      const item = release(candidate);
      const active = this.#state.active!;
      if (item.governanceDigest !== active.release.governanceDigest) fail('governance_change_disabled');
      if (item.dataSchemaVersion !== active.release.dataSchemaVersion) fail('schema_change_disabled');
      if (item.digest === active.release.digest || this.#state.quarantine.includes(item.digest)) fail('candidate_ineligible');
      await this.#verify(item, 'admission');
      const checkpoint = await this.#checkpoint(false);
      const record: Succession = { id: randomUUID(), candidate: item, predecessorRelease: active.release, predecessor: active.process, state: 'evaluation', snapshot: this.#snapshot(checkpoint), questions: [], healthyChecks: 0 };
      this.#state.successions.push(record); this.#state.successionId = record.id; this.#state.phase = 'evaluation';
      if (!this.#state.artifacts.some((artifact) => artifact.digest === item.digest)) this.#state.artifacts.push(item);
      this.#save('succession.proposed', { id: record.id, digest: item.digest });
      try {
        record.successor = await this.#launch(item, 'staging');
        delete this.#state.pendingLaunch;
        this.#save('successor.staged', { id: record.id });
        return { id: record.id, successor: this.#issue(record.successor, item) };
      } catch (error) {
        record.state = 'rejected'; record.followup = 'Staging failed; inspect the launch intent before retrying.'; this.#state.phase = 'normal';
        this.#save('succession.rejected', { id: record.id, reason: 'staging_failed' });
        throw error;
      }
    });
  }

  recordEvidence(id: string, evidence: GateEvidence): void {
    this.#available(); const record = this.#succession(id); this.#evaluation(record);
    if (!evidence || evidence.candidateDigest !== record.candidate.digest || !digest(evidence.evidenceDigest) || !Array.isArray(evidence.checks)
      || evidence.checks.some((check) => !text(check.id, 256) || !digest(check.evidenceDigest) || !['pass', 'fail', 'inconclusive'].includes(check.status))
      || new Set(evidence.checks.map((check) => check.id)).size !== evidence.checks.length
      || evidence.review?.candidateDigest !== evidence.candidateDigest || evidence.review.evidenceDigest !== evidence.evidenceDigest || !digest(evidence.review.contextDigest) || !['pass', 'fail', 'inconclusive'].includes(evidence.review.status)) fail('evidence_binding');
    if (record.evidence?.evidenceDigest === evidence.evidenceDigest && digestCustodianValue(record.evidence) !== digestCustodianValue(evidence)) fail('evidence_conflict');
    record.evidence = structuredClone(evidence); delete record.verdict; delete record.readiness;
    this.#save('evidence.recorded', { id, evidenceDigest: evidence.evidenceDigest });
  }
  #binding(record: Succession, binding: Binding): void {
    if (!record.evidence || binding.candidateDigest !== record.candidate.digest || binding.evidenceDigest !== record.evidence.evidenceDigest || binding.snapshotDigest !== record.snapshot.digest || binding.policyVersion !== record.snapshot.policyVersion) fail('evidence_binding');
  }
  ask(actor: Actor, id: string, question: string): Question {
    this.#available(); const record = this.#succession(id); this.#participant(actor, record, 'incumbent'); this.#evaluation(record);
    if (!text(question) || record.questions.some((item) => item.answer === undefined)) fail('invalid_question');
    if (record.questions.length >= this.#maxRounds) { this.#reject(record, 'Interview budget exhausted; retain incumbent and investigate unresolved criteria.'); fail('interview_budget'); }
    const entry = { id: randomUUID(), question }; record.questions.push(entry); this.#save('interview.question', { id, questionId: entry.id }); return { ...entry };
  }
  answer(actor: Actor, id: string, questionId: string, answer: string, challenge?: string): void {
    this.#available(); const record = this.#succession(id); this.#participant(actor, record, 'successor'); this.#evaluation(record);
    const question = record.questions.find((item) => item.id === questionId);
    if (!question || question.answer !== undefined || !text(answer) || (challenge !== undefined && !text(challenge))) fail('invalid_answer');
    question.answer = answer; if (challenge !== undefined) question.challenge = challenge;
    this.#save('interview.answer', { id, questionId, challenge: challenge !== undefined });
  }
  #reject(record: Succession, reason: string): void {
    record.state = 'rejected'; record.followup = reason; this.#state.phase = 'normal';
    if (record.successor) this.#state.pendingStops.push(record.successor);
    this.#save('succession.rejected', { id: record.id, reason });
  }
  /** Bounded investigation failure may reject without manufacturing an answer or evidence. */
  abortEvaluation(actor: Actor, id: string, reason: string): void {
    this.#available(); const record = this.#succession(id); this.#participant(actor, record, 'incumbent'); this.#evaluation(record);
    if (!text(reason)) fail('invalid_abort_reason');
    this.#reject(record, reason);
  }
  verdict(actor: Actor, id: string, verdict: Binding & { decision: 'accept' | 'reject' | 'request_evidence'; reason: string }): void {
    this.#available(); const record = this.#succession(id); this.#participant(actor, record, 'incumbent'); this.#evaluation(record); this.#binding(record, verdict);
    if (!['accept', 'reject', 'request_evidence'].includes(verdict.decision) || !text(verdict.reason) || record.questions.some((question) => question.answer === undefined) || (verdict.decision === 'accept' && !record.questions.length)) fail('invalid_verdict');
    record.verdict = structuredClone(verdict); delete record.readiness;
    if (verdict.decision === 'reject' || (verdict.decision === 'request_evidence' && record.questions.length >= this.#maxRounds)) this.#reject(record, verdict.reason);
    else this.#save('interview.verdict', { id, decision: verdict.decision });
  }
  ready(actor: Actor, id: string, binding: Binding): void {
    this.#available(); const record = this.#succession(id); this.#participant(actor, record, 'successor'); this.#evaluation(record); this.#binding(record, binding);
    record.readiness = structuredClone(binding); this.#save('successor.ready', { id });
  }
  #gates(record: Succession): void {
    const evidence = record.evidence;
    if (!evidence || evidence.review.status !== 'pass' || this.#required.some((id) => evidence.checks.find((check) => check.id === id)?.status !== 'pass') || evidence.checks.some((check) => check.status !== 'pass') || record.verdict?.decision !== 'accept' || !record.readiness || !record.successor) fail('gates_failed');
    this.#binding(record, record.verdict); this.#binding(record, record.readiness);
  }

  async requestCutover(actor: Actor, id: string, signal?: AbortSignal): Promise<Actor> {
    return this.#exclusive(async () => {
      const record = this.#succession(id); this.#participant(actor, record, 'incumbent');
      if (record.state === 'probation' && record.successor && this.#state.active && sameProcess(record.successor, this.#state.active.process)) return this.#issue(record.successor, record.candidate, this.#state.epoch);
      this.#evaluation(record); this.#gates(record);
      if (signal?.aborted) fail('cutover_cancelled');
      const checkpoint = await this.#checkpoint();
      try {
        if (!checkpoint.quiesced) fail('checkpoint_not_quiesced');
        if (checkpoint.unresolvedEffects.length) fail('unresolved_effects');
        if (checkpoint.sequence < record.snapshot.sequence) fail('stale_checkpoint');
        if (checkpoint.policyVersion !== record.snapshot.policyVersion) {
          record.snapshot = this.#snapshot(checkpoint); delete record.verdict; delete record.readiness; record.questions = [];
          this.#save('snapshot.invalidated', { id, policyVersion: checkpoint.policyVersion }); fail('snapshot_changed');
        }
        await this.#verify(record.candidate, 'admission'); await this.#verify(record.predecessorRelease, 'recovery');
        // This is the final cancellable boundary. After the epoch is fenced,
        // transfer/recovery must complete mechanically even if the caller aborts.
        if (signal?.aborted) fail('cutover_cancelled');
      } catch (error) {
        if (checkpoint.quiesced) {
          try { await this.#hook(this.#hooks.activate(record.predecessor, actor, checkpoint)); }
          catch { await this.#recover('incumbent_resume_failed'); }
        }
        throw error;
      }
      delete this.#state.active; this.#state.epoch++; this.#state.phase = 'transfer'; record.state = 'transfer';
      this.#save('authority.fenced', { id, epoch: this.#state.epoch });
      try {
        await this.#hook(this.#hooks.catchUp(record.successor!, checkpoint));
        const health = await this.#hook(this.#hooks.probe(record.successor!));
        if (health.runtime !== 'healthy') fail('successor_unhealthy');
        this.#state.active = { release: record.candidate, process: record.successor! }; this.#state.phase = 'probation'; record.state = 'probation';
        const successor = this.#issue(record.successor!, record.candidate, this.#state.epoch);
        this.#save('authority.activated', { id, epoch: this.#state.epoch });
        await this.#hook(this.#hooks.activate(record.successor!, successor, checkpoint));
        return successor;
      } catch {
        const restored = await this.#recover('cutover_failed');
        if (!restored) fail('recovery_required');
        fail('cutover_failed_restored');
      }
    });
  }

  async reportRegression(actor: Actor, id: string, evidence: string[]): Promise<Actor | undefined> {
    return this.#exclusive(async () => {
      const record = this.#succession(id); this.#participant(actor, record, 'incumbent');
      if (record.state !== 'probation' || !Array.isArray(evidence) || !evidence.length || evidence.some((item) => !text(item, 2048))) fail('invalid_regression');
      this.#save('regression.reported', { id, evidence });
      return this.#tick();
    });
  }
  async tick(): Promise<Actor | undefined> { return this.#exclusive(() => this.#tick()); }
  async #stopPending(): Promise<void> {
    while (this.#state.pendingStops.length) {
      const process = this.#state.pendingStops[0]!;
      await this.#hook(this.#hooks.stop(process));
      this.#state.pendingStops.shift();
      this.#save('process.retired', { instanceId: process.instanceId });
    }
  }
  async #tick(): Promise<Actor | undefined> {
    await this.#stopPending();
    if (!this.#state.active || !['normal', 'evaluation', 'probation'].includes(this.#state.phase)) return undefined;
    let health: Awaited<ReturnType<CustodianHooks['probe']>>;
    try { health = await this.#hook(this.#hooks.probe(this.#state.active.process)); }
    catch { this.#save('health.inconclusive', { epoch: this.#state.epoch }); return undefined; }
    if (health.runtime !== 'healthy') return this.#recover(health.runtime === 'hung' ? 'worker_hung' : 'worker_failed');
    if (!health.providerAvailable) { this.#save('provider.unavailable', { epoch: this.#state.epoch }); return undefined; }
    if (this.#state.phase === 'probation') {
      const record = this.#succession(this.#state.successionId!);
      record.healthyChecks++;
      if (record.healthyChecks >= this.#probationChecks) {
        await this.#hook(this.#hooks.stop(record.predecessor));
        record.state = 'retired'; this.#state.phase = 'normal'; this.#state.knownGood = record.candidate;
        this.#save('predecessor.retired', { id: record.id, digest: record.predecessorRelease.digest });
      } else this.#save('probation.healthy', { id: record.id, checks: record.healthyChecks });
    }
    return undefined;
  }
  async recover(reason = 'custodian_restart'): Promise<Actor | undefined> { return this.#exclusive(() => this.#recover(reason)); }
  async #recover(reason: string): Promise<Actor | undefined> {
    if (!this.#state.knownGood) fail('no_recovery_artifact');
    if (this.#state.phase === 'recovery_required') return undefined;
    const previous = this.#state.active;
    const succession = this.#state.successionId ? this.#succession(this.#state.successionId) : undefined;
    if (!this.#state.recoveryIncident) { this.#state.recoveryAttempts = 0; this.#state.recoveryIncident = randomUUID(); }
    if (succession && ['transfer', 'probation'].includes(succession.state) && !this.#state.quarantine.includes(succession.candidate.digest)) this.#state.quarantine.push(succession.candidate.digest);
    const relevant = succession && ['evaluation', 'transfer', 'probation'].includes(succession.state) ? succession : undefined;
    const prior = [previous?.process, relevant?.predecessor, relevant?.successor, ...this.#state.pendingStops].filter((item): item is ProcessRef => item !== undefined);
    this.#state.pendingStops = [...new Map(prior.map((item) => [item.instanceId, item])).values()];
    delete this.#state.active; this.#state.phase = 'recovering'; this.#state.reason = reason;
    this.#save('recovery.started', { reason });
    let interrupted: ProcessRef | undefined;
    if (this.#state.pendingLaunch) {
      if (!this.#hooks.reconcileLaunch) { this.#state.phase = 'recovery_required'; this.#save('recovery.launch_unresolved', { launchId: this.#state.pendingLaunch.launchId }); return undefined; }
      try { interrupted = await this.#hook(this.#hooks.reconcileLaunch(structuredClone(this.#state.pendingLaunch))); }
      catch { this.#state.phase = 'recovery_required'; this.#save('recovery.launch_unresolved', { launchId: this.#state.pendingLaunch.launchId }); return undefined; }
    }
    if (interrupted && !this.#state.pendingStops.some((process) => sameProcess(process, interrupted))) this.#state.pendingStops.push(interrupted);
    this.#save('recovery.stop_intent', {});
    try { await this.#stopPending(); }
    catch {
      this.#state.phase = 'recovery_required'; this.#save('recovery.stop_failed', { instanceId: this.#state.pendingStops[0]?.instanceId ?? 'unknown' }); return undefined;
    }
    delete this.#state.pendingLaunch; this.#state.pendingStops = [];
    this.#save('recovery.prior_processes_stopped', {});
    while (this.#state.recoveryAttempts < this.#maxRecovery) {
      this.#state.recoveryAttempts++; this.#state.epoch++;
      this.#save('recovery.attempt', { attempt: this.#state.recoveryAttempts, epoch: this.#state.epoch });
      let started: ProcessRef | undefined;
      try {
        await this.#verify(this.#state.knownGood, 'recovery');
        const checkpoint = await this.#checkpoint();
        if (!checkpoint.quiesced || checkpoint.unresolvedEffects.length) {
          this.#state.phase = 'recovery_required'; this.#state.reason = 'recovery_reconciliation_required';
          this.#save('recovery.reconciliation_required', { effects: checkpoint.unresolvedEffects }); return undefined;
        }
        started = await this.#launch(this.#state.knownGood, 'production');
        this.#state.active = { release: this.#state.knownGood, process: started };
        this.#save('recovery.process_started', { instanceId: started.instanceId });
        await this.#hook(this.#hooks.catchUp(started, checkpoint));
        if ((await this.#hook(this.#hooks.probe(started))).runtime !== 'healthy') fail('recovery_unhealthy');
        this.#state.phase = 'normal'; delete this.#state.pendingLaunch;
        if (succession && !['retired', 'rejected'].includes(succession.state)) succession.state = 'rolled_back';
        const restored = this.#issue(started, this.#state.knownGood, this.#state.epoch);
        this.#save('recovery.authority_granted', { epoch: this.#state.epoch, digest: this.#state.knownGood.digest });
        await this.#hook(this.#hooks.activate(started, restored, checkpoint));
        delete this.#state.recoveryIncident;
        this.#save('recovery.completed', { epoch: this.#state.epoch });
        return restored;
      } catch {
        delete this.#state.active; this.#state.phase = 'recovering';
        this.#save('recovery.attempt_failed', { attempt: this.#state.recoveryAttempts });
        const pending = this.inspect().pendingLaunch;
        if (started) {
          const failedProcess = started;
          if (!this.#state.pendingStops.some((process) => sameProcess(process, failedProcess))) this.#state.pendingStops.push(started);
          this.#save('recovery.failed_process_stop_intent', { instanceId: started.instanceId });
          try { await this.#hook(this.#hooks.stop(started)); }
          catch { this.#state.phase = 'recovery_required'; this.#save('recovery.stop_failed', { instanceId: started.instanceId }); return undefined; }
          this.#state.pendingStops = this.#state.pendingStops.filter((process) => !sameProcess(process, failedProcess));
          delete this.#state.pendingLaunch;
        } else if (pending) {
          if (!this.#hooks.reconcileLaunch) { this.#state.phase = 'recovery_required'; this.#save('recovery.launch_unresolved', { launchId: pending.launchId }); return undefined; }
          try {
            const unresolved = await this.#hook(this.#hooks.reconcileLaunch(pending));
            if (unresolved) await this.#hook(this.#hooks.stop(unresolved));
            delete this.#state.pendingLaunch;
          } catch { this.#state.phase = 'recovery_required'; this.#save('recovery.launch_unresolved', { launchId: pending.launchId }); return undefined; }
        }
      }
    }
    if (!this.#state.quarantine.includes(this.#state.knownGood.digest)) this.#state.quarantine.push(this.#state.knownGood.digest);
    this.#state.phase = 'recovery_required'; this.#save('recovery.exhausted', { attempts: this.#state.recoveryAttempts }); return undefined;
  }
  async retryRecovery(): Promise<Actor | undefined> {
    return this.#exclusive(async () => {
      if (this.#state.phase !== 'recovery_required') fail('invalid_recovery_state');
      this.#state.phase = 'recovering'; this.#state.recoveryAttempts = 0; this.#state.recoveryIncident = randomUUID();
      this.#save('recovery.operator_retry', {}); return this.#recover('operator_retry');
    });
  }
  replaceCustodian(): never { return fail('custodian_replacement_disabled'); }
}
