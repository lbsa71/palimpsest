import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, prepareState, resolveExternalPath } from './config.ts';
import type { RuntimeConfig } from './config.ts';
import { DirectCommunications, SlackCommunications, createLocalServer } from './communications.ts';
import type { InboundMessage, LocalServer } from './communications.ts';
import { createSlackServer } from './slack-service.ts';
import type { SlackServer } from './slack-service.ts';
import { SlackSocketClient } from './slack-socket.ts';
import { MistralProvider, CodexProvider, ProviderError } from './providers.ts';
import type { Provider } from './providers.ts';
import { Store } from './store.ts';
import { CoordinatorLock } from './ownership.ts';
import { GrowthCoordinator } from './growth.ts';
import { GrowthScheduler } from './scheduler.ts';
import { GenerationHost } from './generations.ts';
import { EvolutionCoordinator } from './evolution.ts';
import { EvolutionScheduler } from './evolution-scheduler.ts';
import { evaluateCandidate, freezeBaseline, readManifest } from './candidates.ts';
import { ConversationActions } from './conversation-actions.ts';
import { GitPublisher } from './git-publication.ts';
import { ReleasePublication } from './release-publication.ts';
import { createDevelopmentHost } from './development-host.ts';
import type { DevelopmentExecutor } from './development-executor.ts';
import { observeSourceIdentity } from './source-identity.ts';
import { EVOLUTION_CHECKS } from './evolution.ts';
import { conversationSchedulingFacts } from './conversation-host-facts.ts';

/** The single trusted process serializes all provider calls, including growth. */
function configuredProvider(config: RuntimeConfig): Provider {
  let previous = Promise.resolve();
  return {
    name: config.provider,
    async complete(request) {
      const predecessor = previous;
      let release!: () => void;
      previous = new Promise<void>(resolve => { release = resolve; });
      try {
        await predecessor;
        if (request.signal?.aborted) throw new ProviderError('cancelled', 'Inference was cancelled.');
        if (!config.model) throw new ProviderError('unavailable', `${config.provider} model is not configured.`);
        const actual = config.provider === 'mistral'
          ? new MistralProvider({ apiKey: config.mistralApiKey ?? '', model: config.model, timeoutMs: config.timeoutMs })
          : new CodexProvider({ model: config.model, timeoutMs: config.timeoutMs });
        return await actual.complete(request);
      } finally { release(); }
    },
  };
}

function slackMode(config: RuntimeConfig): 'socket' | 'http' | undefined {
  if (!config.slackBotToken && !config.slackAppToken && !config.slackSigningSecret) return;
  if (!config.slackBotToken || (!config.slackAppToken && !config.slackSigningSecret)
    || !config.slackTeamIds.length) {
    throw new Error('Slack configuration requires a bot token, app token or signing secret, and an explicit team allowlist.');
  }
  return config.slackAppToken ? 'socket' : 'http';
}

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'help') {
    console.log('Palimpsest: doctor | init | ask <message> | serve [port] | tasks | memory [scope] | growth [tick] | host-baseline prepare|install <candidate-id> <incumbent-id>|restore <installed-id>');
    return;
  }
  if (!['doctor', 'init', 'ask', 'serve', 'tasks', 'memory', 'growth', 'host-baseline'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if(command==='host-baseline' && !((args[0]==='prepare'&&args.length===1)
    || (args[0]==='install'&&args.length===3&&args.slice(1).every(value=>/^[a-f0-9]{64}$/.test(value)))
    || (args[0]==='restore'&&args.length===2&&/^[a-f0-9]{64}$/.test(args[1]!))))throw new Error('Invalid host-baseline command');
  if (command === 'ask' && !args.join(' ').trim()) throw new Error('ask requires a message');
  if (command === 'growth' && (args.length > 1 || (args[0] !== undefined && args[0] !== 'tick'))) throw new Error('growth accepts only the optional tick action');
  const port = command === 'serve' && args[0] !== undefined ? Number(args[0]) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (command === 'serve' && args.length > 1)) throw new Error('serve requires an optional port from 0 to 65535');
  const config = loadConfig();
  if (command === 'doctor') {
    console.log(JSON.stringify({ ...config.describe(), node: process.version, liveIntegrationChecked: false }, null, 2));
    return;
  }
  const slack = ['init', 'ask', 'serve'].includes(command) ? slackMode(config) : undefined;
  const paths = prepareState(config);
  const lock = new CoordinatorLock(resolveExternalPath(config.repositoryRoot, join(config.dataDir, 'coordinator.sqlite')));
  let store: Store | undefined;
  let host: GenerationHost | undefined;
  let growth: GrowthScheduler | undefined;
  let evolution: EvolutionScheduler | undefined;
  let publicationReconciler:ReleasePublication|undefined;
  let development:DevelopmentExecutor|undefined;
  let developmentHost:ReturnType<typeof createDevelopmentHost>|undefined;
  let localServer: LocalServer | undefined;
  let slackServer: SlackServer | undefined;
  let slackSocket: SlackSocketClient | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let hostTick: Promise<void> | undefined;
  let stopped = false;
  let ready = false;
  let resolveStop!: () => void;
  const stopRequested = new Promise<void>(resolve => { resolveStop = resolve; });
  const requestStop = () => {
    stopped = true; resolveStop();
    // Installed before startup/draining so a slow provider cannot swallow shutdown.
    void growth?.stop().catch(() => {});
    evolution?.interrupt();
    development?.interrupt();
    if (ready) void host?.runtime.stop().catch(() => {});
  };
  process.once('SIGINT', requestStop); process.once('SIGTERM', requestStop);
  try {
    store = new Store(paths.dbPath);
    // The exclusive lock proves earlier coordinator owners have stopped.
    store.recoverInterrupted(); store.recoverGrowthInterrupted(); store.recoverMemoryConsolidations();
    if (command === 'tasks') { console.log(JSON.stringify(store.listTasks(), null, 2)); return; }
    if (command === 'memory') { console.log(JSON.stringify(store.listMemories(args[0] ?? 'local'), null, 2)); return; }
    const provider = configuredProvider(config);
    const context = () => {
      const release = host?.custodian.inspect().active?.release;
      const root = release ? readManifest(release.artifactPath).candidateRoot : config.repositoryRoot;
      return ['src/agent/brain.ts', 'GROWTH.md'].filter(path => existsSync(join(root, path)))
        .map(path => `Source ${path}:\n${readFileSync(join(root, path), 'utf8')}`).join('\n\n');
    };
    const userCommitments = () => store!.listTasks({ states: ['queued', 'running'] }).length > 0
      || store!.listTasks().some(task => store!.listEffects(task.id).some(effect => effect.state !== 'completed'));
    const observeSource=()=>{
      const release=host?.custodian.inspect().active?.release;
      if(!release)throw new Error('No serving source is available');
      return observeSourceIdentity({repositoryRoot:config.repositoryRoot,release});
    };
    const hasUserWork = () => stopped || evolution?.busy === true || development?.busy===true || publicationReconciler?.busy===true
      || publicationReconciler?.pending(evolution?.items()??[])===true
      || (host !== undefined && (!ready || !['normal', 'probation'].includes(host.custodian.inspect().phase))) || userCommitments();
    const newGrowth = () => new GrowthScheduler({ store: store!, provider, hasUserWork,
      ...(host?{observeSource}:{}),
      callsPerWindow: config.growthCallsPerDay, context, onError: code => console.error(code),
      ...(evolution ? { onProposedChange: event => { evolution!.enqueue(event.growth.id, event.proposedChange); } } : {}) });
    const pauseGrowth = async () => { const previous = growth; growth = undefined; await previous?.stop(); };
    const resumeGrowth = () => { if (!stopped && !growth && !evolution?.busy && ready && ['normal', 'probation'].includes(host!.custodian.inspect().phase)) { growth = newGrowth(); growth.start(); } };
    if (command === 'growth') {
      if (args[0] === 'tick') { growth = newGrowth(); console.log(JSON.stringify(await growth.tick(), null, 2)); }
      else { new GrowthCoordinator({ store, provider, hasUserWork, budgetPerExperiment: 0 }).seedAgenda(); console.log(JSON.stringify(store.listGrowth(), null, 2)); }
      return;
    }
    const direct = new DirectCommunications();
    const actions = new ConversationActions({ store,userIds:config.slackSelfModificationUserIds,allowDirectOperator:true,
      observeSource,
      sourceContext:()=>[context(),...['providers.ts','store.ts'].map(path=>`Contract src/${path}:\n${readFileSync(join(dirname(fileURLToPath(import.meta.url)),path),'utf8').slice(0,3000)}`),
        ...(existsSync(join(config.repositoryRoot,'AGENTS.md')) ? [readFileSync(join(config.repositoryRoot,'AGENTS.md'),'utf8')] : [])].join('\n\n'),
      cancelWork:taskId=>evolution?.cancelTask(taskId) ?? false });
    const publisher = config.gitRemote && config.gitBranch && config.gitRemoteUrl ? new GitPublisher({repositoryRoot:config.repositoryRoot,dataDir:config.dataDir,store,
      remote:config.gitRemote,branch:config.gitBranch,remoteUrl:config.gitRemoteUrl}) : undefined;
    if((config.gitRemote || config.gitBranch || config.gitRemoteUrl) && !publisher)throw new Error('Git publication requires explicit remote, branch and remote URL identity');
    publicationReconciler=new ReleasePublication({store,publisher,authorize:growth=>actions.authorize(growth)});
    const communications = slack ? [direct, new SlackCommunications({ token: config.slackBotToken! })] : [direct];
    const configuration = { maxCallsPerTask: config.maxCallsPerTask, growthCallsPerDay: config.growthCallsPerDay,
      evolutionCallsPerDay: config.evolutionCallsPerDay, timeoutMs: config.timeoutMs, scope: 'local' };
    const modelProfile = { provider: config.provider, model: config.model || null };
    host = new GenerationHost({ repositoryRoot: config.repositoryRoot, dataDir: config.dataDir, store, provider,
      model: config.model || null, communications, maxCallsPerTask: config.maxCallsPerTask, quiesceBackground: pauseGrowth,
      selfModificationUserIds: config.slackSelfModificationUserIds,
      conversationActions:actions,
      hostFacts: () => ({ ...conversationSchedulingFacts(config, { serving: command === 'serve', ready, stopping: stopped,
        planScheduled: development !== undefined, growthTimerScheduled: growth !== undefined, userWork: userCommitments(),
        backgroundQuiescing: evolution?.busy === true || development?.busy === true || publicationReconciler?.busy === true }),
        backgroundGrowthScheduled: growth !== undefined, backgroundEvolutionScheduled: evolution !== undefined,
        backgroundGrowthInputs: 'Standing growth uses the mission, admitted source and growth-scope observations. Eligible human conversations have a separate deliberative proposal lane with retained authorship.',
        implementationPlanExecution:development?'Two protected P06 work contracts through checked shedding; broader PLAN work remains unsupported':'Not scheduled in this process',
        planProposalCallsPerDay:config.planProposalCallsPerDay,planEvolutionCallsPerDay:config.planEvolutionCallsPerDay,
        planCadence:config.planCadence,planProposalCallsPerHour:config.planProposalCallsPerHour,planEvolutionCallsPerHour:config.planEvolutionCallsPerHour,
        applicationGitPublication:!!publisher, interactiveEvolutionCallsPerDay:config.interactiveEvolutionCallsPerDay,
        growthCallsPerDay: config.growthCallsPerDay, evolutionCallsPerDay: config.evolutionCallsPerDay }) });
    if(command==='host-baseline') {
      const previous=host.custodian.inspect().knownGood;
      if(!previous)throw new Error('Host baseline installation requires an existing admitted release');
      if(args[0]==='prepare') {
        const baseline=freezeBaseline({repositoryRoot:config.repositoryRoot,dataDir:config.dataDir,configuration,modelProfile,requiredChecks:[...new Set([...EVOLUTION_CHECKS,...readManifest(previous.artifactPath).requiredChecks])]});
        if(baseline.sourceDigest!==readManifest(previous.artifactPath).sourceDigest)throw new Error('Host baseline must preserve admitted cognitive source');
        const evidence=await evaluateCandidate({repositoryRoot:config.repositoryRoot,releaseDir:baseline.releaseDir});
        console.log(JSON.stringify({candidateId:baseline.id,incumbentId:previous.digest,evidenceDigest:evidence.evidenceDigest,status:evidence.status}));
        if(evidence.status!=='passed')process.exitCode=1;
      }else {
        await host.start();ready=true;
        if(args[0]==='install')await host.installHostBaseline(readManifest(join(config.dataDir,'releases',args[1]!)),args[2]!);
        else await host.custodian.restoreHostBaseline(args[1]!);
        console.log(JSON.stringify({hostBaseline:args[0],generation:host.custodian.inspect().active?.release.digest,epoch:host.custodian.inspect().epoch}));
      }
      return;
    }
    let initial;
    if (host.custodian.inspect().phase === 'empty') {
      initial = freezeBaseline({ repositoryRoot: config.repositoryRoot, dataDir: config.dataDir,
        configuration, modelProfile, requiredChecks: ['typecheck', 'trusted-agent-contract'] });
      const evidence = await evaluateCandidate({ repositoryRoot: config.repositoryRoot, releaseDir: initial.releaseDir });
      if (evidence.status !== 'passed') throw new Error(`Baseline checks failed: ${evidence.checks.filter(check => check.status !== 'passed').map(check => check.name).join(', ')}`);
    }
    if (stopped) return;
    await host.start(initial); ready = true;
    if (stopped) return;
    if (command === 'init') {
      console.log(JSON.stringify({ initialized: true, generation: host.custodian.inspect().active!.release.digest, dataDir: config.dataDir })); return;
    }
    if (command === 'ask') {
      const task = await host.submit({ id: randomUUID(), conversationId: 'local', source: 'direct', text: args.join(' ').trim() });
      await host.drain();
      console.log(JSON.stringify(host.runtime.status(task.id), null, 2));
      if (host.runtime.status(task.id)?.state !== 'succeeded') process.exitCode = 1;
      return;
    }
    const drain = () => { void host!.drain().catch(() => { if (!stopped) console.error('runtime_drain_failed'); }); };
    const submit = async (input: InboundMessage) => {
      if (stopped) throw new Error('Service is stopping');
      const task = await host!.submit(input);
      evolution?.interrupt(true);
      development?.interrupt();
      // Cancel idle inference immediately; serialized provider admission keeps
      // the task from overlapping a provider that is still acknowledging abort.
      void growth?.tick().catch(() => {});
      drain(); return task;
    };
    localServer = await createLocalServer({ submit, status: id => {const task=host!.runtime.status(id);return task ? {...task,selfModificationStatus:actions.status(id)} : undefined;},
      cancel: id => {const task=host!.runtime.cancel(id);return task ? {...task,selfModificationStatus:actions.status(id)} : undefined;}, events: after => host!.runtime.events(after) }, { token: paths.apiToken, port });
    if (slack === 'http') slackServer = await createSlackServer({ submit }, { signingSecret: config.slackSigningSecret!,
      hasJoinedThread: id => store!.hasSlackThread(id),
      hasAcceptedEvent: id => store!.hasSlackEvent(id),
      allowedTeamIds: config.slackTeamIds, ...(config.slackChannelIds.length ? { allowedChannelIds: config.slackChannelIds } : {}) });
    if (slack === 'socket') {
      slackSocket = new SlackSocketClient({ submit }, { appToken: config.slackAppToken!, allowedTeamIds: config.slackTeamIds,
        hasJoinedThread: id => store!.hasSlackThread(id),
        hasAcceptedEvent: id => store!.hasSlackEvent(id),
        ...(config.slackChannelIds.length ? { allowedChannelIds: config.slackChannelIds } : {}) });
      await slackSocket.start();
    }
    if (stopped) return;
    const coordinator = new EvolutionCoordinator({ repositoryRoot: config.repositoryRoot, dataDir: config.dataDir,
      store, host, reviewer: provider, incumbent: provider, successor: provider, configuration, modelProfile,
      reserveBudget: id => evolution!.reserveCall(id), authorizeProposal:growth=>actions.authorize(growth),observeSource,
      checksForProposal:growth=>{
        if(developmentHost)return developmentHost.checksForProposal(growth);
        if(growth.id.startsWith('plan:'))throw new Error('Plan executor is unavailable; work cannot bypass its contract');
        return [...EVOLUTION_CHECKS];
      },reviewWorkContract:growth=>developmentHost?.reviewWorkContract(growth)??'' });
    evolution = new EvolutionScheduler({ store, callsPerDay: config.evolutionCallsPerDay,
      minimumCallsPerAttempt:8,
      planCallsPerDay:config.planEvolutionCallsPerDay,
      planCadence:config.planCadence,planCallsPerHour:config.planEvolutionCallsPerHour,
      interactiveCallsPerDay:config.interactiveEvolutionCallsPerDay,authorizeProposal:id=>actions.authorize(store!.growth(id)!),
      hasUserWork: () => stopped || userCommitments() || development?.busy===true || publicationReconciler!.busy || publicationReconciler!.pending(evolution?.items()??[]), phase: () => host!.custodian.inspect().phase,
      beforeRun: async () => { await hostTick; await pauseGrowth(); }, run: request => coordinator.run(request),
      attemptTimeoutMs: Math.min(2_147_483_647, config.timeoutMs * 8 + 120_000), onError: code => console.error(code) });
    // Retained work still needs its trusted contracts when new calls are disabled.
    if(publisher){
      developmentHost=createDevelopmentHost({config,store,host,provider,scheduler:evolution,publication:publicationReconciler,beforeProposal:pauseGrowth,
        hasUserWork:()=>stopped||userCommitments()||evolution!.busy||publicationReconciler!.busy||publicationReconciler!.pending(evolution!.items())||host!.custodian.inspect().phase!=='normal'});
      development=developmentHost.executor;development.recoverInterrupted();
    }
    console.log(JSON.stringify({ url: localServer.url, tokenFile: paths.tokenPath, dataDir: config.dataDir,
      provider: config.provider, model: config.model || null, generation: host.custodian.inspect().active!.release.digest,
      growthCallsPerDay: config.growthCallsPerDay, evolutionCallsPerDay: config.evolutionCallsPerDay,
      planProposalCallsPerDay:config.planProposalCallsPerDay,planEvolutionCallsPerDay:config.planEvolutionCallsPerDay,
      planCadence:config.planCadence,planProposalCallsPerHour:config.planProposalCallsPerHour,planEvolutionCallsPerHour:config.planEvolutionCallsPerHour,
      slackUrl: slackServer?.url ?? null, slackSocket: slackSocket?.status() ?? null }));
    resumeGrowth();
    evolution.start();
    const tick = () => {
      if (hostTick || stopped || evolution?.busy) return;
      hostTick = Promise.resolve().then(async()=>{
        await publicationReconciler!.reconcile(evolution!.items());await actions.reconcileResults(evolution!.items(),undefined,publicationReconciler);
        await host!.tick();
        if(development&&!userCommitments()&&!stopped&&(development.allocation().remaining>0||development.attempts().some(attempt=>['proposed','queued'].includes(attempt.state)))){
          try{await development.tick();}catch{if(!stopped)console.error('development_tick_held');}
        }
      }).then(() => { resumeGrowth(); }).catch(() => { if (!stopped) console.error('generation_tick_failed'); })
        .finally(() => { hostTick = undefined; });
    };
    tickTimer = setInterval(tick, 1000); tick();
    await stopRequested;
  } finally {
    stopped = true;
    process.off('SIGINT', requestStop); process.off('SIGTERM', requestStop);
    if (tickTimer) clearInterval(tickTimer);
    await Promise.allSettled([growth?.stop(), development?.stop(), localServer?.close(), slackServer?.close(), slackSocket?.close(), evolution?.stop()]);
    await (ready ? host?.runtime.stop().catch(() => {}) : undefined);
    await hostTick;
    try { await host?.close(); } finally { try { store?.close(); } finally { lock.close(); } }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Palimpsest failed');
  process.exitCode = 1;
});
