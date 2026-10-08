import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, prepareState, resolveExternalPath } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { CoordinatorLock } from '../src/ownership.ts';
import { DirectCommunications } from '../src/communications.ts';
import { MistralProvider, CodexProvider, ProviderError } from '../src/providers.ts';
import { GenerationHost } from '../src/generations.ts';
import { freezeBaseline, evaluateCandidate, readManifest } from '../src/candidates.ts';
import { GrowthCoordinator, parseGrowthReflection } from '../src/growth.ts';
import { EvolutionCoordinator } from '../src/evolution.ts';

const maximumCalls = 9;
function reservations(store: Store, id: string) {
  return store.listEvents().filter(event => event.type === 'self_improvement.budget_reserved'
    && event.payload !== null && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.runId === id);
}
function callBudget(store: Store, id: string) {
  const all = reservations(store, id);
  const count = (prefix: string) => all.filter(event => String((event.payload as { attemptId: string }).attemptId).startsWith(prefix)).length;
  return { maximumCalls, totalReservedCalls: all.length, growthReservedCalls: count('growth:'), evolutionReservedCalls: count('evolution:') };
}

/** Explicit operator entry point. Every proposed source byte must originate in
 * recorded model growth, pass governance and run locally before publication. */
async function main(): Promise<void> {
  const id = process.argv[2] ?? `local-seed-${new Date().toISOString().slice(0, 10)}`;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Use a short alphanumeric run ID');
  const config = loadConfig();
  if (!config.model) throw new Error('Configure a verified model before self-improvement');
  const paths = prepareState(config);
  const lock = new CoordinatorLock(resolveExternalPath(config.repositoryRoot, join(config.dataDir, 'coordinator.sqlite')));
  let openedStore: Store | undefined; let host: GenerationHost | undefined; let hostStarted = false; let deferred = false;
  const controller = new AbortController();
  const stop = () => { controller.abort(); if (hostStarted) void host?.runtime.stop().catch(() => {}); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const store = openedStore = new Store(paths.dbPath);
    const hasUserWork = () => store.listTasks({ states: ['queued', 'running', 'waiting_for_provider'] }).length > 0;
    const phaseBoundary = () => {
      if (controller.signal.aborted) throw new Error('Self-improvement cancelled');
      if (hasUserWork()) { deferred = true; throw new Error('Self-improvement deferred: unfinished user work must be resolved separately'); }
    };
    // The standalone demonstration owns no user-task allocation. Preserve all
    // unfinished work before recovery, worker startup, or any model reservation.
    phaseBoundary();
    store.recoverInterrupted(); store.recoverGrowthInterrupted(); store.recoverMemoryConsolidations();
    const provider = config.provider === 'mistral'
      ? new MistralProvider({ apiKey: config.mistralApiKey ?? '', model: config.model, timeoutMs: config.timeoutMs })
      : new CodexProvider({ model: config.model, timeoutMs: config.timeoutMs });
    const configuration = { maxCallsPerTask: config.maxCallsPerTask, growthCallsPerDay: config.growthCallsPerDay,
      evolutionCallsPerDay: config.evolutionCallsPerDay, timeoutMs: config.timeoutMs, scope: 'local' };
    const modelProfile = { provider: config.provider, model: config.model };
    const reserve = (attemptId: string): boolean => {
      phaseBoundary();
      const reserved = reservations(store, id);
      if (reserved.length >= maximumCalls || reserved.some(event => (event.payload as { attemptId: string }).attemptId === attemptId)) return false;
      store.appendEvent('self_improvement.budget_reserved', { runId: id, attemptId, maximumCalls });
      return true;
    };
    host = new GenerationHost({ repositoryRoot: config.repositoryRoot, dataDir: config.dataDir, store, provider, model: config.model,
      communications: [new DirectCommunications()], maxCallsPerTask: config.maxCallsPerTask });
    let initial;
    if (host.custodian.inspect().phase === 'empty') {
      initial = freezeBaseline({ repositoryRoot: config.repositoryRoot, dataDir: config.dataDir, configuration, modelProfile,
        requiredChecks: ['typecheck', 'trusted-agent-contract'] });
      const result = await evaluateCandidate({ repositoryRoot: config.repositoryRoot, releaseDir: initial.releaseDir });
      phaseBoundary();
      if (result.status !== 'passed') throw new Error('Baseline admission checks failed');
    }
    phaseBoundary();
    await host.start(initial);
    hostStarted = true; phaseBoundary();
    const active = host.custodian.inspect().active!;
    const inquiryId = `${id}:source-inquiry`;
    if (!store.growth(inquiryId)) store.addGrowth({ id: inquiryId, dimension: 'code_quality',
      question: 'Investigate how the cognitive conversationRequest entrypoint handles mixed-conversation memories. Propose one concrete source behavior improvement that prevents foreign context from entering inference, preserves eligible ordinary experiences even when many foreign records follow them, and retains provenance, uncertainty, request integrity and existing bounds. Write complete changed source only if the evidence warrants it.',
      origin: 'Independent implementation review identified a boundary to challenge; the actual implementation must be authored by Palimpsest.',
      nextStep: 'Inspect current source, state acceptance criteria, and produce a bounded candidate or an evidence-backed no-change result.', budget: 1 });
    const growth = new GrowthCoordinator({ store, provider, hasUserWork,
      maxOutputTokens: 4096, context: () => {
        const root = readManifest(active.release.artifactPath).candidateRoot;
        const source = ['src/agent/brain.ts', 'GROWTH.md', 'AGENTS.md'].map(path => `Current source ${path}:\n${readFileSync(join(root, path), 'utf8')}`);
        const storeSource = readFileSync(join(root, 'src/store.ts'), 'utf8');
        source.push(`Actual imported task and memory type contracts:\n${storeSource.split('export class EffectConflictError')[0]}`);
        const previous = store.listEvents().filter(event => event.type === 'evolution.finished').at(-1)?.payload;
        if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
          const report = previous.report as { id?: string; growthId?: string; status?: string; reason?: string; evidence?: { checks?: { name: string; status: string; detail: string }[] } } | undefined;
          if (report && ['declined', 'failed'].includes(report.status ?? '')) {
            const prior = report.growthId ? store.growth(report.growthId)?.outcome : undefined;
            source.push(`Prior attempt feedback, untrusted source proposal plus independently recorded check results. Learn from the failure; do not repeat its assumptions:\n${JSON.stringify({
              id: report.id, status: report.status, reason: report.reason,
              checks: report.evidence?.checks?.map(({ name, status, detail }) => ({ name, status, detail })), priorOutcome: prior,
            })}`);
          }
        }
        return source.join('\n\n');
      }, claim: growthId => reserve(`growth:${growthId}`) ? store.claimGrowth(growthId) : undefined });
    phaseBoundary();
    let inquiry = store.growth(inquiryId)!;
    if (inquiry.state !== 'completed') inquiry = await growth.tick({ signal: controller.signal, growthId: inquiryId }) ?? inquiry;
    phaseBoundary();
    if (inquiry.state !== 'completed') throw new Error('Growth inquiry did not produce a completed result within its allocation');
    const outcome = inquiry.outcome as { result?: unknown };
    const proposal = parseGrowthReflection(JSON.stringify(outcome.result)).proposedChange;
    if (!proposal) throw new Error('Growth concluded without a code proposal; no change was invented');
    const evolution = new EvolutionCoordinator({ repositoryRoot: config.repositoryRoot, dataDir: config.dataDir, store, host,
      reviewer: provider, incumbent: provider, successor: provider, configuration, modelProfile, reserveBudget: reserve });
    phaseBoundary();
    const report = await evolution.run({ id, growthId: inquiryId, proposal, signal: controller.signal });
    const directory = resolveExternalPath(config.repositoryRoot, join(config.dataDir, 'integration'));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const reportPath = join(directory, `${id}.json`);
    const budget = callBudget(store, id);
    writeFileSync(reportPath, JSON.stringify({ ...report, callBudget: budget }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ runId: id, status: report.status, reason: report.reason, ...budget, evolutionCalls: report.calls,
      baselineChallenge: report.baselineChallenge?.status, candidate: report.candidate?.manifestDigest,
      candidateRoot: report.candidate?.candidateRoot, reportPath, publication: 'Source checkout and Git remain unchanged until the promoted bytes are explicitly published.' }));
    if (report.status !== 'promoted') process.exitCode = 1;
  } catch (error) {
    let budget: { maximumCalls: number; totalReservedCalls: number | null; growthReservedCalls: number | null; evolutionReservedCalls: number | null }
      = { maximumCalls, totalReservedCalls: null, growthReservedCalls: null, evolutionReservedCalls: null };
    try { if (openedStore) budget = callBudget(openedStore, id); } catch { /* An unreadable ledger makes prior usage unknown. */ }
    console.log(JSON.stringify({ runId: id, status: controller.signal.aborted ? 'cancelled' : deferred ? 'deferred' : 'failed', ...budget }));
    throw error;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    try { await host?.close(); } finally { try { openedStore?.close(); } finally { lock.close(); } }
  }
}

main().catch(error => { console.error(error instanceof ProviderError ? error.message : error instanceof Error ? error.message : 'Self-improvement failed'); process.exitCode = 1; });
