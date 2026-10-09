import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Custodian } from './custodian.ts';
import type { Actor, Checkpoint, ProcessRef, Release } from './custodian.ts';
import { readManifest, verifyFrozenCandidate, evaluateCandidate, digestJson } from './candidates.ts';
import type { CandidateManifest } from './candidates.ts';
import { AgentWorker } from './workers.ts';
import { AgentRuntime } from './runtime.ts';
import type { Communications, InboundMessage } from './communications.ts';
import { ProviderError } from './providers.ts';
import type { Provider } from './providers.ts';
import type { Json, Store, Task } from './store.ts';
import type { ConversationActions } from './conversation-actions.ts';
import { readGenerationContinuity } from './continuity.ts';

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
}

/** Actual local worker supervision. All production effects stay in this trusted process. */
export class GenerationHost {
  readonly custodian: Custodian;
  readonly requiredChecks: readonly string[];
  readonly #options: GenerationOptions;
  readonly #workers = new Map<string, AgentWorker>();
  #actor?: Actor;
  #worker?: AgentWorker;
  #runtime?: AgentRuntime;
  #providerAvailable = true;
  #closed = false;

  constructor(options: GenerationOptions) {
    this.#options = options;
    this.requiredChecks = Object.freeze(options.requiredChecks ?? ['typecheck', 'trusted-agent-contract', 'cross-scope-memory']);
    this.custodian = new Custodian({ storeDir: join(options.dataDir, 'custodian'),
      requiredChecks: [...this.requiredChecks], probationChecks: options.probationChecks ?? 3,
      hooks: {
        verifyArtifact: async (release, purpose) => {
          try {
            const manifest = verifyFrozenCandidate({ repositoryRoot: options.repositoryRoot, releaseDir: release.artifactPath, requireCurrentBase: purpose === 'admission' });
            return manifest.manifestDigest === release.digest && manifest.governanceDigest === release.governanceDigest && manifest.dataSchemaVersion === release.dataSchemaVersion
              && manifest.modelProfile.provider === options.provider.name && manifest.modelProfile.model === options.model;
          } catch { return false; }
        },
        checkpoint: request => this.#checkpoint(request.quiesce),
        launch: async (release, _mode, context) => {
          const manifest = readManifest(release.artifactPath);
          const worker = await AgentWorker.start({ candidateRoot: manifest.candidateRoot, instanceId: context.launchId,
            rpcTimeoutMs: options.rpcTimeoutMs, lifetimeMs: options.lifetimeMs, scope: options.scope ?? 'local' });
          this.#workers.set(worker.peer.instanceId, worker);
          return { ...worker.peer };
        },
        stop: peer => this.#stopPeer(peer),
        probe: async peer => ({ runtime: await this.worker(peer).probe(), providerAvailable: this.#providerAvailable }),
        catchUp: async (peer, checkpoint) => this.worker(peer).catchUp(checkpoint),
        activate: async (peer, actor, checkpoint) => {
          const worker = this.worker(peer);
          if (this.#worker === worker && this.#runtime) { this.#actor = actor; void this.#runtime.resume().catch(() => {}); return; }
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
            hostFacts: () => ({ ...options.hostFacts?.(),
              activeRelease: this.custodian.inspect().active?.release.digest ?? null,
              phase: this.custodian.inspect().phase,
              sourceEvolutionScope: 'Only direct src/agent/*.ts, through candidate checks, review and succession; replaces cognitive workers, not the outer service.',
              applicationGitPublication: options.hostFacts?.().applicationGitPublication ?? false }),
            authorize,
            requestFactory: async (task, memories) => {
              if (task.conversationId === (options.scope ?? 'local')) return worker.request(task, memories);
              // A separate fresh process prevents candidate module globals or a
              // local continuity snapshot from crossing conversation scopes.
              const manifest = readManifest(releaseOfWorker(this.custodian, peer).artifactPath);
              const scoped = await AgentWorker.start({ candidateRoot: manifest.candidateRoot, scope: task.conversationId,
                rpcTimeoutMs: options.rpcTimeoutMs, lifetimeMs: options.lifetimeMs });
              try { return await scoped.request(task, memories); } finally { await scoped.stop(); }
            },
          });
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
  worker(peer: ProcessRef): AgentWorker {
    const worker = this.#workers.get(peer.instanceId);
    if (!worker || worker.peer.pid !== peer.pid) throw new Error('Unknown worker instance');
    return worker;
  }
  async start(initial?: CandidateManifest): Promise<void> {
    if (this.custodian.inspect().phase === 'empty') {
      if (!initial) throw new Error('Bootstrap requires an evaluated baseline');
      await this.custodian.bootstrap(releaseOf(initial));
    } else await this.custodian.recover();
    if (this.custodian.inspect().phase === 'recovery_required') throw new Error('Mechanical recovery requires operator reconciliation');
  }

  async installHostBaseline(manifest: CandidateManifest, expectedIncumbent: string): Promise<void> {
    const previous = this.custodian.inspect().knownGood;
    if (!previous || previous.digest !== expectedIncumbent) throw new Error('Operator baseline incumbent changed');
    const old = verifyFrozenCandidate({repositoryRoot:this.#options.repositoryRoot,releaseDir:previous.artifactPath,requireCurrentBase:false});
    const frozen = verifyFrozenCandidate({repositoryRoot:this.#options.repositoryRoot,releaseDir:manifest.releaseDir});
    if (frozen.id !== manifest.id || frozen.sourceDigest !== old.sourceDigest || frozen.dataSchemaVersion !== old.dataSchemaVersion)
      throw new Error('Host installation must preserve exact admitted cognitive source and schema');
    if(digestJson(frozen.configuration)!==digestJson(old.configuration))throw new Error('Host installation must preserve configured release policy');
    if(old.requiredChecks.some(name=>!frozen.requiredChecks.includes(name)))throw new Error('Host installation requires all protected checks, including previously admitted checks');
    const checked = await evaluateCandidate({repositoryRoot:this.#options.repositoryRoot,releaseDir:frozen.releaseDir});
    if (checked.status !== 'passed' || this.requiredChecks.some(name=>!checked.checks.some(check=>check.name===name && check.status==='passed')))
      throw new Error('Host installation requires all protected checks');
    await this.custodian.installHostBaseline(releaseOf(frozen),expectedIncumbent,checked.evidenceDigest);
  }

  async submit(message: InboundMessage): Promise<Task> {
    if (this.#closed || !this.#options.communications.some(adapter => adapter.name === message.source)) throw new Error('Communication source unavailable');
    const task = this.#options.store.enqueue({ conversationId: message.conversationId, input: message.text, source: message.source, eventId: message.id,
      ...(message.slackAuthor ? { slackAuthor: { ...message.slackAuthor } } : {}) });
    if (task.state === 'queued' && task.checkpoint === null) this.#options.store.updateTask(task.id, { checkpoint: { calls: 0, replyTo: message.replyTo ?? null } });
    if (this.#runtime && ['normal', 'evaluation', 'probation'].includes(this.custodian.inspect().phase)) void this.#runtime.submit(message).catch(() => {});
    return this.#options.store.task(task.id)!;
  }
  async drain(): Promise<void> { await this.runtime.runUntilIdle(); }
  async tick(): Promise<void> { await this.custodian.tick(); if (this.custodian.inspect().active) await this.drain(); }

  async #checkpoint(quiesce: boolean): Promise<Checkpoint> {
    const store = this.#options.store;
    if (quiesce) {
      await this.#options.quiesceBackground?.();
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
    this.#closed = true; await this.#runtime?.stop().catch(() => {});
    await Promise.all([...this.#workers.values()].map(worker => worker.stop()));
    this.custodian.close();
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
