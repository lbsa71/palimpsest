import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadConfig, prepareState, resolveExternalPath } from './config.ts';
import { DirectCommunications, createLocalServer } from './communications.ts';
import { MistralProvider, CodexProvider, ProviderError } from './providers.ts';
import type { Provider } from './providers.ts';
import { Store } from './store.ts';
import { AgentRuntime } from './runtime.ts';
import { CoordinatorLock } from './ownership.ts';
import { GrowthCoordinator } from './growth.ts';

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'help') {
    console.log('Palimpsest: doctor | ask <message> | serve [port] | tasks | memory [scope] | growth [tick]');
    return;
  }
  const config = loadConfig();
  if (command === 'doctor') {
    console.log(JSON.stringify({ ...config.describe(), node: process.version, liveIntegrationChecked: false }, null, 2));
    return;
  }
  const paths = prepareState(config);
  const lock = new CoordinatorLock(resolveExternalPath(config.repositoryRoot, join(config.dataDir, 'coordinator.sqlite')));
  const store = new Store(paths.dbPath);
  let runtime: AgentRuntime | undefined;
  try {
    // The exclusive lock proves no earlier coordinator can still own execution.
    store.recoverInterrupted(); store.recoverGrowthInterrupted();
    if (command === 'tasks') { console.log(JSON.stringify(store.listTasks(), null, 2)); return; }
    if (command === 'memory') { console.log(JSON.stringify(store.listMemories(args[0] ?? 'local'), null, 2)); return; }
    const provider: Provider = {
      name: config.provider,
      async complete(request) {
        if (!config.model) throw new ProviderError('unavailable', `${config.provider} model is not configured.`);
        const actual = config.provider === 'mistral'
          ? new MistralProvider({ apiKey: config.mistralApiKey ?? '', model: config.model, timeoutMs: config.timeoutMs })
          : new CodexProvider({ model: config.model, timeoutMs: config.timeoutMs });
        return actual.complete(request);
      },
    };
    const direct = new DirectCommunications();
    runtime = new AgentRuntime({ store, provider, communications: [direct], maxCallsPerTask: config.maxCallsPerTask });
    if (command === 'ask') {
      const input = args.join(' ').trim();
      if (!input) throw new Error('ask requires a message');
      const task = await runtime.submit({ id: randomUUID(), conversationId: 'local', source: 'direct', text: input });
      await runtime.runUntilIdle();
      console.log(JSON.stringify(runtime.status(task.id), null, 2));
      if (runtime.status(task.id)?.state !== 'succeeded') process.exitCode = 1;
      return;
    }
    const growth = new GrowthCoordinator({ store, provider, hasUserWork: () => runtime!.hasUserWork(), context: () => {
      return ['src/agent/brain.ts', 'GROWTH.md'].map(path => `Source ${path}:\n${readFileSync(join(config.repositoryRoot, path), 'utf8')}`).join('\n\n');
    } });
    if (command === 'growth') {
      growth.seedAgenda();
      console.log(JSON.stringify(args[0] === 'tick' ? await growth.tick() : store.listGrowth(), null, 2));
      return;
    }
    if (command !== 'serve') throw new Error(`Unknown command: ${command}`);
    const server = await createLocalServer({
      submit: async input => { const task = await runtime!.submit(input); void runtime!.runUntilIdle().catch(() => console.error('runtime_drain_failed')); return task; },
      status: id => runtime!.status(id), cancel: id => runtime!.cancel(id), events: after => runtime!.events(after),
    }, { token: paths.apiToken, port: args[0] === undefined ? 0 : Number(args[0]) });
    console.log(JSON.stringify({ url: server.url, tokenFile: paths.tokenPath, dataDir: config.dataDir,
      provider: config.provider, model: config.model ?? null }));
    await runtime.runUntilIdle();
    await new Promise<void>(resolve => {
      const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    });
    await runtime.stop(); await server.close();
  } finally { await runtime?.stop(); store.close(); lock.close(); }
}

main().catch(error => {
  console.error(error instanceof ProviderError ? error.message : error instanceof Error ? error.message : 'Palimpsest failed');
  process.exitCode = 1;
});
