import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Custodian } from './custodian.ts';
import type { Actor, Checkpoint, ProcessRef, Release } from './custodian.ts';
import { readManifest, digestJson, candidateExecutionReadDenials } from './candidates.ts';
import type { CandidateManifest } from './candidates.ts';
import { CandidateJobs } from './candidate-jobs.ts';
import type { CandidateJobOperation, CandidateJobValue } from './candidate-jobs.ts';
import { AgentWorker } from './workers.ts';
import { AgentRuntime } from './runtime.ts';
import type { RuntimeCoding } from './runtime.ts';
import type { Communications, InboundMessage } from './communications.ts';
import { ProviderError } from './providers.ts';
import type { Provider } from './providers.ts';
import type { Json, Store, Task } from './store.ts';
import type { ConversationActions } from './conversation-actions.ts';
import { readGenerationContinuity } from './continuity.ts';
import { assertConversationRole } from './conversation-role.ts';
import type { ConversationContinuity } from './conversation-continuity.ts';

export function releaseOf(manifest: CandidateManifest): Release {
  return { digest: manifest.manifestDigest, artifactPath: manifest.releaseDir,
    governanceDigest: manifest.governanceDigest, dataSchemaVersion: manifest.dataSchemaVersion };
}
export interface GenerationOptions {
  repositoryRoot: string; dataDir: string; store: Store; provider: Provider; model: string | null;
  communications: Communications[]; scope?: string; maxCallsPerTask?: number;
  probationChecks?: number; rpcTimeoutMs?: number; lifetimeMs?: number;
  requiredChecks?: string[];
  quiesceBackground?: () => Promise<void>;
  selfModificationUserIds?: readonly string[];
  hostFacts?: () => Record<string, Json>;
  conversationActions?: ConversationActions;
  conversationContinuity?: ConversationContinuity;
  coding?: RuntimeCoding;
}

/** Actual local worker supervision. All production effects stay in this trusted process. */
export class GenerationHost {
  readonly custodian: Custodian;
  readonly candidateJobs: CandidateJobs;
  readonly requiredChecks: readonly string[];
  readonly #options: GenerationOptions;
  readonly #workers = new Map<string, AgentWorker>();
  #actor?: Actor;
  #worker?: AgentWorker;
  #runtime?: AgentRuntime;
  #providerAvailable = true;
  #closed = false;
  #custodyTail: Promise<void> = Promise.resolve();
  #custodyContext = new AsyncLocalStorage<{ active: boolean; epoch: number; validateCurrent?: () => void; signal?: AbortSignal }>();
  #closing?: Promise<void>;
  #collectionStop = new AbortController();
  #collections = new Map<Promise<unknown>, AbortController>();

  constructor(options: GenerationOptions) {
    this.#options = options;
    options.conversationContinuity?.bindCodingWork(options.coding);
    this.candidateJobs = new CandidateJobs({ repositoryRoot: options.repositoryRoot, dataDir: options.dataDir });
    this.requiredChecks = Object.freeze(options.requiredChecks ?? ['typecheck', 'trusted-agent-contract', 'cross-scope-memory']);
    this.custodian = new Custodian({ storeDir: join(options.dataDir, 'custodian'),
      requiredChecks: [...this.requiredChecks], probationChecks: options.probationChecks ?? 3,
      hooks: {
        verifyArtifact: async (release, purpose) => {
          try {
            const recovering = purpose === 'recovery' && this.custodian.inspect().phase === 'recovering';
            if (recovering) await this.#interruptCollections();
            // New legacy-shaped candidates cannot nominate their own exception.
            // Recovery gets identity from the independently retained custody row.
            const retained = purpose === 'recovery' && this.custodian.inspect().artifacts.some(item => digestJson(item) === digestJson(release));
            const manifest = await this.#collectCandidate({ kind: 'verify', options: { repositoryRoot: options.repositoryRoot,
              releaseDir: release.artifactPath, requireCurrentBase: purpose === 'admission',
              ...(retained ? { expectedLegacyManifestDigest: release.digest } : {}) } }, { deadlineMs: 9000 }, recovering ? 'recovery' : 'custody-integrity');
            // Admission still belongs to its current origin after an async
            // verifier returns. Recovery/cleanup must remain mechanical.
            this.#validateCustodyConsequence();
            return manifest.manifestDigest === release.digest && manifest.governanceDigest === release.governanceDigest && manifest.dataSchemaVersion === release.dataSchemaVersion
              && manifest.modelProfile.provider === options.provider.name && manifest.modelProfile.model === options.model;
          } catch { return false; }
        },
        checkpoint: request => this.#checkpoint(request.quiesce),
        launch: async (release, _mode, context) => {
          const manifest = readManifest(release.artifactPath);
          const worker = await AgentWorker.start({ candidateRoot: manifest.candidateRoot, instanceId: context.launchId,
            denyReadPaths: candidateExecutionReadDenials(manifest),
            rpcTimeoutMs: options.rpcTimeoutMs, lifetimeMs: options.lifetimeMs, scope: options.scope ?? 'local' });
          this.#workers.set(worker.peer.instanceId, worker);
          return { ...worker.peer };
        },
        stop: peer => this.#stopPeer(peer),
        probe: async peer => ({ runtime: await this.worker(peer).probe(), providerAvailable: this.#providerAvailable }),
        catchUp: async (peer, checkpoint) => this.worker(peer).catchUp(checkpoint),
        activate: async (peer, actor, checkpoint) => {
          const worker = this.worker(peer);
          if (this.#worker === worker && this.#runtime) {
            this.#actor = actor;
            await this.#runtime.resume({ drain: false });
            // Custody awaits adoption, while ordinary inference stays detached.
            void this.#runtime.runUntilIdle().catch(() => {}); return;
          }
          await options.coding?.pause?.();
          await this.#runtime?.stop().catch(() => {});
          this.#actor = actor; this.#worker = worker;
          const authorize = (boundary: 'tool' | 'store' | 'memory' | 'message') => {
            if (worker.closed) throw new Error('Bound worker is no longer available');
            this.custodian.assertAuthority(actor, boundary, peer);
          };
          const provider: Provider = { name: options.provider.name, complete: async request => {
            authorize('tool');
            try { const result = await options.provider.complete(request); this.#providerAvailable = true; return result; }
            catch (error) { if (error instanceof ProviderError && ['unavailable', 'timeout'].includes(error.code)) this.#providerAvailable = false; throw error; }
          } };
          this.#runtime = new AgentRuntime({ store: options.store, provider, communications: options.communications,
            maxCallsPerTask: options.maxCallsPerTask,
            selfModificationUserIds: options.selfModificationUserIds,
            conversationActions: options.conversationActions,
            conversationContinuity: options.conversationContinuity,
            coding: options.coding, initiallyPaused: true,
            memoryProjectionChecks: () => readManifest(releaseOfWorker(this.custodian, peer).artifactPath).requiredChecks,
            hostFacts: () => ({ ...options.hostFacts?.(),
              activeRelease: this.custodian.inspect().active?.release.digest ?? null,
              phase: this.custodian.inspect().phase,
              sourceEvolutionScope: options.coding
                ? 'Eligible configured coding sessions may draft the full admitted source. Cognitive changes use existing checks/review/succession; broader drafts await supported admission.'
                : 'Only direct src/agent/*.ts, through candidate checks, review and succession; replaces cognitive workers, not the outer service.',
              applicationGitPublication: options.hostFacts?.().applicationGitPublication ?? false }),
            authorize,
            requestFactory: async (task, memories) => {
              if (task.conversationId === (options.scope ?? 'local')) return worker.request(task, memories);
              // A separate fresh process prevents candidate module globals or a
              // local continuity snapshot from crossing conversation scopes.
              const manifest = readManifest(releaseOfWorker(this.custodian, peer).artifactPath);
              const scoped = await AgentWorker.start({ candidateRoot: manifest.candidateRoot, scope: task.conversationId,
                denyReadPaths: candidateExecutionReadDenials(manifest),
                rpcTimeoutMs: options.rpcTimeoutMs, lifetimeMs: options.lifetimeMs });
              try { return await scoped.request(task, memories); } finally { await scoped.stop(); }
            },
          });
          await this.#runtime.resume({ drain: false });
          if (worker.sequence !== checkpoint.sequence) throw new Error('Worker activation lacks current checkpoint');
        },
        reconcileLaunch: async intent => {
          const known = this.#workers.get(intent.launchId);
          if (known && !known.closed) return { ...known.peer };
          const matches = processListing().filter(entry => matchesLaunch(entry.command, intent.launchId));
          if (matches.length > 1) throw new Error('Ambiguous worker launch identity');
          return matches[0] ? { pid: matches[0].pid, instanceId: intent.launchId } : undefined;
        },
      },
    });
  }

  get actor(): Actor { if (!this.#actor) throw new Error('No active generation'); return this.#actor; }
  get runtime(): AgentRuntime { if (!this.#runtime) throw new Error('No active runtime'); return this.#runtime; }
  /** Trusted collector entry point. No production capability crosses into the
   * helper, and an await cannot carry a result into another custody generation. */
  async collectCandidate<T extends CandidateJobOperation>(operation: T, control: {
    jobId?: string; signal?: AbortSignal; deadlineMs?: number; validateBinding?: () => void | Promise<void>;
  } = {}): Promise<CandidateJobValue<T>> {
    return this.#collectCandidate(operation, control);
  }
  async #collectCandidate<T extends CandidateJobOperation>(operation: T, control: {
    jobId?: string; signal?: AbortSignal; deadlineMs?: number; validateBinding?: () => void | Promise<void>;
  }, authority: 'serving' | 'custody-integrity' | 'recovery' = 'serving'): Promise<CandidateJobValue<T>> {
    if (this.#closed) throw new Error('Generation host is closed');
    if (authority !== 'serving' && operation.kind !== 'verify') throw new Error('Custody integrity collection is read-only verification');
    if (authority !== 'recovery' && ['recovering', 'recovery_required'].includes(this.custodian.inspect().phase))
      throw new Error('Mechanical recovery owns candidate collection');
    const fence = () => {
      const state = this.custodian.inspect();
      return { phase: state.phase, epoch: state.epoch, active: state.active ?? null, knownGood: state.knownGood ?? null };
    };
    const binding = fence(); const expected = digestJson(binding);
    const assertFence = () => {
      if (this.#closed || digestJson(fence()) !== expected) throw new Error('Candidate collector custody binding changed');
      // Custody's read-only integrity hook must survive a stopped predecessor.
      // It still binds exact custody/artifact identity; an Evolution origin's
      // post-verifier validator separately enforces current serving authority.
      if (authority === 'serving' && binding.active) {
        if (this.worker(binding.active.process).closed) throw new Error('Candidate collector bound worker is unavailable');
        this.custodian.assertAuthority(this.actor, 'tool', binding.active.process);
      }
    };
    assertFence();
    const validate = control.validateBinding;
    const stop = new AbortController();
    const context = this.#custodyContext.getStore();
    // Admission's operation signal owns only pre-fence work. A fenced transfer
    // or mechanical rescue must finish under custody, even after caller stop.
    const custodySignal = authority === 'custody-integrity' && context?.active
      && context.epoch === this.custodian.inspect().epoch ? context.signal : undefined;
    const signal = AbortSignal.any([this.#collectionStop.signal, stop.signal,
      ...(control.signal ? [control.signal] : []), ...(custodySignal ? [custodySignal] : [])]);
    signal.throwIfAborted();
    const pending = this.candidateJobs.run(operation, { jobId: control.jobId, deadlineMs: control.deadlineMs, signal,
      binding: JSON.parse(JSON.stringify({ ...binding, authority })) as Json,
      validateBinding: async () => { assertFence(); await validate?.(); assertFence(); } });
    this.#collections.set(pending, stop);
    try { const result = await pending; signal.throwIfAborted(); return result; }
    finally { this.#collections.delete(pending); }
  }
  async #interruptCollections(): Promise<void> {
    const pending = [...this.#collections];
    for (const [, stop] of pending) stop.abort();
    // Settlement alone is not drain. CandidateJobs retains any unresolved
    // ownership and refuses the following recovery verifier in that case.
    await Promise.allSettled(pending.map(([result]) => result));
  }
  worker(peer: ProcessRef): AgentWorker {
    const worker = this.#workers.get(peer.instanceId);
    if (!worker || worker.peer.pid !== peer.pid) throw new Error('Unknown worker instance');
    return worker;
  }
  /** Trusted host callers only. Serialize receiver operations; independent
   * model, collector and task waits stay outside. Receiver hooks run in-place.
   * Callers copy payloads before enqueueing and revalidate their
   * actual authority inside the callback; this queue grants no receiver rights.
   * Hooks already run inside an operation and must not acquire it recursively. */
  async custodyOperation<T>(operation: () => T | Promise<T>, validateCurrent?: () => void, signal?: AbortSignal): Promise<T> {
    if (this.#custodyContext.getStore()?.active) throw new Error('Recursive custody operation is forbidden');
    if (this.#closed) throw new Error('Generation host is closed');
    const pending = this.#custodyTail.then(async () => {
      const context = { active: true, epoch: this.custodian.inspect().epoch, validateCurrent, signal };
      try { return await this.#custodyContext.run(context, () => {
        this.#validateCustodyConsequence(true);
        return operation();
      }); }
      finally { context.active = false; }
    });
    // One rejected receiver operation does not poison subsequent maintenance.
    this.#custodyTail = pending.then(() => {}, () => {});
    return pending;
  }
  #validateCustodyConsequence(entry = false): void {
    const context = this.#custodyContext.getStore();
    // Every supplied entry validator must veto before invoking its callback.
    // After transfer/during rescue, internal hooks must finish mechanically;
    // explicit mechanical operations supply no origin validator.
    if (!context?.active || (!entry && !['normal', 'evaluation'].includes(this.custodian.inspect().phase))) return;
    const result: unknown = context.validateCurrent?.();
    if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new Error('Custody current validation must be synchronous');
    }
  }
  async checkHealth(): Promise<void> {
    await this.custodyOperation(() => this.custodian.tick());
  }
  async start(initial?: CandidateManifest): Promise<void> {
    const release = initial ? releaseOf(structuredClone(initial)) : undefined;
    await this.custodyOperation(async () => {
      if (this.custodian.inspect().phase === 'empty') {
        if (!release) throw new Error('Bootstrap requires an evaluated baseline');
        await this.custodian.bootstrap(release);
      } else await this.custodian.recover();
      if (this.custodian.inspect().phase === 'recovery_required') throw new Error('Mechanical recovery requires operator reconciliation');
    });
  }

  async installHostBaseline(manifest: CandidateManifest, expectedIncumbent: string, signal?: AbortSignal): Promise<void> {
    manifest = structuredClone(manifest);
    signal?.throwIfAborted();
    const state = this.custodian.inspect(); const previous = state.knownGood;
    const actor = this.actor;
    const expectedState = digestJson({ epoch: state.epoch, active: state.active, knownGood: state.knownGood });
    if (!previous || previous.digest !== expectedIncumbent) throw new Error('Operator baseline incumbent changed');
    const old = await this.collectCandidate({ kind: 'verify', options: {repositoryRoot:this.#options.repositoryRoot,releaseDir:previous.artifactPath,requireCurrentBase:false,expectedLegacyManifestDigest:previous.digest} }, { signal });
    const frozen = await this.collectCandidate({ kind: 'verify', options: {repositoryRoot:this.#options.repositoryRoot,releaseDir:manifest.releaseDir} }, { signal });
    if (frozen.id !== manifest.id || frozen.sourceDigest !== old.sourceDigest || frozen.dataSchemaVersion !== old.dataSchemaVersion)
      throw new Error('Host installation must preserve exact admitted cognitive source and schema');
    if(digestJson(frozen.configuration)!==digestJson(old.configuration))throw new Error('Host installation must preserve configured release policy');
    if(old.requiredChecks.some(name=>!frozen.requiredChecks.includes(name)))throw new Error('Host installation requires all protected checks, including previously admitted checks');
    const checked = await this.collectCandidate({ kind: 'evaluate', options: {repositoryRoot:this.#options.repositoryRoot,releaseDir:frozen.releaseDir} }, { signal });
    if (checked.status !== 'passed' || this.requiredChecks.some(name=>!checked.checks.some(check=>check.name===name && check.status==='passed')))
      throw new Error('Host installation requires all protected checks');
    const release = releaseOf(frozen);
    const validateCurrent = () => {
      signal?.throwIfAborted();
      const current = this.custodian.inspect();
      if (digestJson({ epoch: current.epoch, active: current.active, knownGood: current.knownGood }) !== expectedState || !current.active || this.worker(current.active.process).closed)
        throw new Error('Operator baseline incumbent changed');
      this.custodian.assertAuthority(actor, 'tool', current.active.process);
    };
    await this.custodyOperation(() => this.custodian.installHostBaseline(release, expectedIncumbent, checked.evidenceDigest), validateCurrent, signal);
  }

  async submit(message: InboundMessage): Promise<Task> {
    if (this.#closed || !this.#options.communications.some(adapter => adapter.name === message.source)) throw new Error('Communication source unavailable');
    assertConversationRole(message);
    const task = this.#options.store.enqueue({ conversationId: message.conversationId, input: message.text, source: message.source, eventId: message.id,
      ...(message.slackAuthor ? { slackAuthor: { ...message.slackAuthor } } : {}) });
    if (task.state === 'queued' && task.checkpoint === null) this.#options.store.updateTask(task.id, { checkpoint: { calls: 0, replyTo: message.replyTo ?? null } });
    if (this.#runtime && ['normal', 'evaluation', 'probation'].includes(this.custodian.inspect().phase)) void this.#runtime.submit(message).catch(() => {});
    return this.#options.store.task(task.id)!;
  }
  async drain(): Promise<void> { await this.runtime.runUntilIdle(); }
  async tick(): Promise<void> { await this.checkHealth(); if (this.custodian.inspect().active) { await this.drain(); await this.tickCoding(); } }
  async tickCoding(): Promise<boolean> {
    if (this.#closed || !this.#runtime || this.#runtime.hasUserWork() || !['normal', 'probation'].includes(this.custodian.inspect().phase)) return false;
    return await this.#options.coding?.tick?.() ?? false;
  }

  async #checkpoint(quiesce: boolean): Promise<Checkpoint> {
    const store = this.#options.store;
    if (quiesce) {
      await this.#options.quiesceBackground?.();
      await this.#options.coding?.pause?.();
      await this.#runtime?.quiesce().catch(() => {});
      // No active task loop remains, and all effects must still reconcile below.
      store.recoverInterrupted();
    }
    const scope = this.#options.scope ?? 'local';
    const events = store.listEvents(); const tasks = store.listTasks();
    const policyVersion = digestJson({ scope, changes: events.filter(event => ['memory.corrected', 'memory.forgotten', 'access.changed'].includes(event.type)).map(event => event.seq) });
    return { sequence: events.at(-1)?.seq ?? 0, policyVersion, quiesced: quiesce,
      snapshot: readGenerationContinuity(store, scope) as unknown as Json,
      unresolvedEffects: tasks.flatMap(task => store.listEffects(task.id).filter(effect => effect.state !== 'completed').map(effect => effect.id)),
    };
  }

  async #stopPeer(peer: ProcessRef): Promise<void> {
    const worker = this.#workers.get(peer.instanceId);
    if (worker) { if (worker.peer.pid !== peer.pid) throw new Error('Process identity mismatch'); await worker.stop(); return; }
    const observed = processListing().find(entry => entry.pid === peer.pid);
    if (!observed) return;
    if (!matchesLaunch(observed.command, peer.instanceId)) throw new Error('Cannot verify retained process identity');
    process.kill(peer.pid, 'SIGKILL');
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!processListing().some(entry => entry.pid === peer.pid)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Retained process did not terminate');
  }

  async close(): Promise<void> {
    if (this.#custodyContext.getStore()?.active) throw new Error('Recursive custody close is forbidden');
    if (this.#closing) return this.#closing;
    this.#closed = true; this.#collectionStop.abort();
    this.#closing = (async () => {
      await this.#custodyTail;
      await Promise.allSettled([...this.#collections.keys()]);
      await this.#runtime?.stop().catch(() => {});
      await Promise.all([...this.#workers.values()].map(worker => worker.stop()));
      this.custodian.close();
    })();
    return this.#closing;
  }
}

function releaseOfWorker(custodian: Custodian, peer: ProcessRef): Release {
  const active = custodian.inspect().active;
  if (!active || active.process.pid !== peer.pid || active.process.instanceId !== peer.instanceId) throw new Error('Stale worker release');
  return active.release;
}

function processListing(): Array<{ pid: number; command: string }> {
  return execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 4_194_304, stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n').flatMap(line => { const match = /^\s*(\d+)\s+(.+)$/.exec(line); return match ? [{ pid: Number(match[1]), command: match[2]! }] : []; });
}
function matchesLaunch(command: string, instanceId: string): boolean {
  if (!/^[a-f0-9-]{36}$/.test(instanceId)) return false;
  const harness = fileURLToPath(new URL('../trusted/agent-worker.mjs', import.meta.url));
  return command.startsWith(process.execPath + ' ') && command.includes(harness) && command.split(/\s+/).includes(`--palimpsest-launch-id=${instanceId}`);
}
