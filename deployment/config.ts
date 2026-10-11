import { readFileSync, realpathSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { invariant, validateScope, type DataScope, type ResourceEnvelope } from '../packages/contracts/index.ts';
import type { SchedulerPolicy } from '../packages/initiative/index.ts';

export interface ApplicationConfig {
  stateDirectory: string;
  workspaceDirectory: string;
  applicationRoot: string;
  nodeBinary: string;
  workerEntrypoint: string;
  artifactId: string;
  controlRevision: string;
  promptFile: string;
  compactionPromptFile: string;
  model: { id: string; contextWindow: number; reasoning: boolean; effort: 'none' | 'high'; maxOutputTokens: number; maxRequestsPerSlice: number; timeoutMs: number; pricesPerMillion: { input: number; output: number } };
  resources: ResourceEnvelope;
  conversationResources: ResourceEnvelope;
  scheduler: SchedulerPolicy;
  maxConcurrentRuns: number;
  pollMs: number;
  commands: string[];
  researchHosts: string[];
  direct: { host: '127.0.0.1' | '::1'; port: number; actorId: string; scope: DataScope; modificationEligible: boolean };
  slack?: { teamId: string; botUserId: string; channels: { channel: string; scope: DataScope }[]; eligibleHumanIds: string[]; coverageStart: string; lookbackSeconds: number; allowSpeech: boolean };
}
export interface ApplicationSecrets { mistralApiKey: string; directToken: string; slackBotToken?: string; slackAppToken?: string }
export function beneath(parent: string, child: string): boolean { const path = relative(parent, child); return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`); }
export function validateEnvelope(envelope: ResourceEnvelope): void {
  invariant(envelope && Object.keys(envelope).sort().join(',') === 'maxConcurrency,maxCostUsd,maxElapsedMs,maxRequests,maxTokens', 'Invalid resource envelope');
  for (const value of Object.values(envelope)) invariant(Number.isFinite(value) && value >= 0, 'Non-finite resource envelope');
  for (const key of ['maxRequests', 'maxTokens', 'maxConcurrency'] as const) invariant(Number.isSafeInteger(envelope[key]), 'Resource counts must be integers');
  invariant(envelope.maxConcurrency > 0 && envelope.maxElapsedMs > 0, 'Positive resource concurrency and time required');
}
/** Explicit host configuration is authority. Model text never enters this loader. */
export function validateConfiguration(config: ApplicationConfig): ApplicationConfig {
  for (const path of [config.stateDirectory, config.workspaceDirectory, config.applicationRoot, config.nodeBinary, config.promptFile, config.compactionPromptFile]) invariant(typeof path === 'string' && isAbsolute(path) && resolve(path) === path, 'Canonical absolute configuration paths required');
  for (const path of [config.stateDirectory, config.workspaceDirectory]) mkdirSync(path, { recursive: true, mode: 0o700 });
  for (const path of [config.stateDirectory, config.workspaceDirectory, config.applicationRoot, config.nodeBinary, config.promptFile, config.compactionPromptFile]) invariant(realpathSync(path) === path, 'Configuration paths must not traverse symlinks');
  for (const [a, b] of [[config.stateDirectory, config.workspaceDirectory], [config.stateDirectory, config.applicationRoot], [config.workspaceDirectory, config.applicationRoot]]) invariant(!beneath(a!, b!) && !beneath(b!, a!), 'Source, private state and workspaces must be disjoint');
  invariant(statSync(config.nodeBinary).isFile() && statSync(config.applicationRoot).isDirectory(), 'Missing application/runtime');
  invariant(config.artifactId.length > 0 && config.controlRevision.length > 0, 'Qualified release identities required');
  invariant(config.model.id.length > 0 && !config.model.id.includes('latest'), 'Pinned model required');
  for (const key of ['contextWindow', 'maxOutputTokens', 'maxRequestsPerSlice', 'timeoutMs'] as const) invariant(Number.isSafeInteger(config.model[key]) && config.model[key] > 0, `Invalid model ${key}`);
  invariant(config.model.effort === 'none' || config.model.effort === 'high' && config.model.reasoning, 'Unsupported reasoning profile');
  for (const value of Object.values(config.model.pricesPerMillion)) invariant(Number.isFinite(value) && value >= 0, 'Finite model price required');
  validateEnvelope(config.resources); validateEnvelope(config.conversationResources); validateEnvelope(config.scheduler.resources);
  for (const envelope of [config.conversationResources, config.scheduler.resources]) for (const key of Object.keys(config.resources) as (keyof ResourceEnvelope)[]) invariant(envelope[key] <= config.resources[key], 'Child allowance exceeds operating envelope');
  invariant(Number.isSafeInteger(config.maxConcurrentRuns) && config.maxConcurrentRuns > 0 && config.maxConcurrentRuns <= config.resources.maxConcurrency, 'Invalid run concurrency');
  invariant(Number.isSafeInteger(config.pollMs) && config.pollMs >= 100, 'Invalid polling interval');
  invariant(['127.0.0.1', '::1'].includes(config.direct.host) && Number.isSafeInteger(config.direct.port) && config.direct.port >= 0 && config.direct.port < 65536, 'Direct API must bind explicit loopback port');
  invariant(config.direct.actorId.trim().length > 0, 'Direct principal required'); validateScope(config.direct.scope);
  invariant(Array.isArray(config.commands) && config.commands.every(command => isAbsolute(command)), 'Explicit command paths required');
  invariant(Array.isArray(config.researchHosts) && config.researchHosts.every(host => /^[a-z0-9.-]+$/.test(host)), 'Explicit research hostnames required');
  if (config.slack) { invariant(config.slack.teamId.length > 0 && config.slack.botUserId.length > 0 && config.slack.channels.length > 0, 'Explicit Slack installation and channel scopes required'); for (const channel of config.slack.channels) { invariant(channel.channel.length > 0, 'Slack channel required'); validateScope(channel.scope); } }
  return structuredClone(config);
}
export function readConfiguration(path: string): ApplicationConfig { return validateConfiguration(JSON.parse(readFileSync(path, 'utf8')) as ApplicationConfig); }
export function environmentSecrets(environment: NodeJS.ProcessEnv): ApplicationSecrets {
  invariant(environment.MISTRAL_API_KEY && environment.AUTARK_DIRECT_TOKEN, 'MISTRAL_API_KEY and AUTARK_DIRECT_TOKEN must be configured');
  return { mistralApiKey: environment.MISTRAL_API_KEY, directToken: environment.AUTARK_DIRECT_TOKEN, ...(environment.SLACK_BOT_TOKEN ? { slackBotToken: environment.SLACK_BOT_TOKEN } : {}), ...(environment.SLACK_APP_TOKEN ? { slackAppToken: environment.SLACK_APP_TOKEN } : {}) };
}
