import { readFileSync, realpathSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { invariant, validateScope, type DataScope, type ResourceEnvelope } from '../packages/contracts/index.ts';
import type { SchedulerPolicy } from '../packages/initiative/index.ts';
import { validateModelProfile, type ModelProfile } from './model-grants.ts';
import { validateDevelopmentControl, type DevelopmentControlConfig } from './development-controls.ts';
import type { ResourceLimits } from '../packages/supervisor/resource-limits.ts';
import { validateSlackDirectGrant, type SlackChannelGrant } from '../packages/communications/slack/ingress/index.ts';
import { validateAllowanceAmendment, type AllowanceAmendment } from '../packages/runtime/resources/index.ts';
import { DEFAULT_CODEX_CODING_MODEL } from '../packages/coding/index.ts';

export interface CodingConfig { provider?: 'codex' | 'pi'; model?: string; timeoutMs?: number; maxOutputBytes?: number }
export interface ApplicationConfig {
  /** Coding is an external limb, independent of the mind model. Defaults to Codex CLI. */
  coding?: CodingConfig;
  /** Explicit host grant for conversations sharing the one retained engineering context. */
  developmentAudiences?: DataScope[];
  developmentControl?: DevelopmentControlConfig;
  stateDirectory: string;
  workspaceDirectory: string;
  applicationRoot: string;
  nodeBinary: string;
  workerEntrypoint: string;
  artifactId: string;
  controlRevision: string;
  promptFile: string;
  compactionPromptFile: string;
  model: ModelProfile;
  resources: ResourceEnvelope;
  resourceLimits?: ResourceLimits;
  conversationResources: ResourceEnvelope;
  /** Explicit operator policy; original grants and charges remain immutable. */
  allowanceAmendment?: AllowanceAmendment;
  /** Conversation work may span several provider calls, independently of initiative quantum. */
  conversationTimeoutMs?: number;
  scheduler: SchedulerPolicy;
  /** Default true: one accounted first-development opportunity per lived-state store. */
  bootstrapInitiative?: boolean;
  maxConcurrentRuns: number;
  pollMs: number;
  commands: string[];
  researchHosts: string[];
  direct: { host: '127.0.0.1' | '::1'; port: number; actorId: string; scope: DataScope; modificationEligible: boolean };
  slack?: { teamId: string; botUserId: string; channels: SlackChannelGrant[]; eligibleHumanIds: string[]; coverageStart: string; lookbackSeconds: number; allowSpeech: boolean };
}
export interface ApplicationSecrets { mistralApiKey?: string; openaiApiKey?: string; directToken: string; slackBotToken?: string; slackAppToken?: string }
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
  validateModelProfile(config.model);
  if (config.coding !== undefined) {
    invariant(config.coding && Object.keys(config.coding).every(key => ['provider', 'model', 'timeoutMs', 'maxOutputBytes'].includes(key)), 'Invalid coding configuration');
    invariant(config.coding.provider === undefined || ['codex', 'pi'].includes(config.coding.provider), 'Unsupported coding provider');
    invariant(config.coding.model === undefined || typeof config.coding.model === 'string' && /^[a-zA-Z0-9_.-]+$/.test(config.coding.model), 'Invalid coding model');
    invariant(config.coding.provider !== 'pi' || config.coding.model === undefined, 'Pi coding uses the configured mind model profile');
    invariant(config.coding.provider === 'pi' || config.coding.model === undefined || config.coding.model === DEFAULT_CODEX_CODING_MODEL, 'Codex coding requires gpt-6.1-sol at high effort');
    for (const [key, maximum] of [['timeoutMs', 1800000], ['maxOutputBytes', 8000000]] as const) invariant(config.coding[key] === undefined || Number.isSafeInteger(config.coding[key]) && config.coding[key]! > 0 && config.coding[key]! <= maximum, 'Coding limits must be finite and bounded');
    invariant(!config.developmentControl, 'External coding is not qualified for matched development evaluation');
  }
  if (config.developmentAudiences !== undefined) {
    invariant(!config.developmentControl && Array.isArray(config.developmentAudiences) && config.developmentAudiences.length > 0 && config.developmentAudiences.length <= 32, 'Bounded explicit development audiences required');
    for (const scope of config.developmentAudiences) { validateScope(scope); invariant(scope.kind === 'restricted', 'Shared development requires restricted audiences'); }
  }
  if (config.developmentControl !== undefined) validateDevelopmentControl(config.developmentControl);
  invariant(config.bootstrapInitiative === undefined || typeof config.bootstrapInitiative === 'boolean', 'Invalid bootstrap initiative setting');
  validateEnvelope(config.resources); validateEnvelope(config.conversationResources); validateEnvelope(config.scheduler.resources);
  if (config.allowanceAmendment !== undefined) {
    validateAllowanceAmendment(config.allowanceAmendment);
    invariant(!config.developmentControl && config.allowanceAmendment.rootId === 'operating-envelope:v1', 'Operator allowance policy is unavailable to matched evaluation');
  }
  if (config.conversationTimeoutMs !== undefined) invariant(!config.developmentControl && Number.isSafeInteger(config.conversationTimeoutMs) && config.conversationTimeoutMs > 0 && config.conversationTimeoutMs <= config.conversationResources.maxElapsedMs, 'Invalid conversation worker deadline');
  if (config.resourceLimits) {
    invariant(isAbsolute(config.resourceLimits.cgroupRoot) && resolve(config.resourceLimits.cgroupRoot) === config.resourceLimits.cgroupRoot, 'Canonical host resource delegation required');
    invariant(Object.keys(config.resourceLimits).sort().join(',') === 'cgroupRoot,cpuPeriodMicros,cpuQuotaMicros,maxFileBytes,maxOpenFiles,memoryBytes,pids,workspaceBytes,workspaceInodes', 'Exact kernel resource profile required');
    for (const [key, value] of Object.entries(config.resourceLimits)) if (key !== 'cgroupRoot') invariant(Number.isSafeInteger(value) && Number(value) > 0, 'Finite positive kernel resource ceiling required');
  }
  for (const envelope of [config.conversationResources, config.scheduler.resources]) for (const key of Object.keys(config.resources) as (keyof ResourceEnvelope)[]) invariant(envelope[key] <= config.resources[key], 'Child allowance exceeds operating envelope');
  invariant(Number.isSafeInteger(config.maxConcurrentRuns) && config.maxConcurrentRuns > 0 && config.maxConcurrentRuns <= config.resources.maxConcurrency, 'Invalid run concurrency');
  invariant(Number.isSafeInteger(config.pollMs) && config.pollMs >= 100, 'Invalid polling interval');
  invariant(['127.0.0.1', '::1'].includes(config.direct.host) && Number.isSafeInteger(config.direct.port) && config.direct.port >= 0 && config.direct.port < 65536, 'Direct API must bind explicit loopback port');
  invariant(config.direct.actorId.trim().length > 0, 'Direct principal required'); validateScope(config.direct.scope);
  invariant(Array.isArray(config.commands) && config.commands.every(command => isAbsolute(command)), 'Explicit command paths required');
  invariant(Array.isArray(config.researchHosts) && config.researchHosts.every(host => /^[a-z0-9.-]+$/.test(host)), 'Explicit research hostnames required');
  if (config.slack) { invariant(config.slack.teamId.length > 0 && config.slack.botUserId.length > 0 && config.slack.channels.length > 0, 'Explicit Slack installation and channel scopes required'); for (const channel of config.slack.channels) { invariant(channel.channel.length > 0, 'Slack channel required'); validateScope(channel.scope); validateSlackDirectGrant(channel, config.slack.teamId, config.slack.botUserId); } }
  const detached = structuredClone(config);
  if (detached.developmentControl) { const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }; freeze(detached); }
  return detached;
}
export function readConfiguration(path: string): ApplicationConfig { return validateConfiguration(JSON.parse(readFileSync(path, 'utf8')) as ApplicationConfig); }
export function environmentSecrets(environment: NodeJS.ProcessEnv): ApplicationSecrets {
  invariant(environment.AUTARK_DIRECT_TOKEN, 'AUTARK_DIRECT_TOKEN must be configured');
  return { ...(environment.MISTRAL_API_KEY ? { mistralApiKey: environment.MISTRAL_API_KEY } : {}), ...(environment.OPENAI_API_KEY ? { openaiApiKey: environment.OPENAI_API_KEY } : {}), directToken: environment.AUTARK_DIRECT_TOKEN, ...(environment.SLACK_BOT_TOKEN ? { slackBotToken: environment.SLACK_BOT_TOKEN } : {}), ...(environment.SLACK_APP_TOKEN ? { slackAppToken: environment.SLACK_APP_TOKEN } : {}) };
}

/** Select only the qualified provider; unrelated configured credentials confer no worker authority. */
export function selectedProviderKey(model: ApplicationConfig['model'], secrets: ApplicationSecrets): string {
  const key = (model.provider ?? 'mistral') === 'openai' ? secrets.openaiApiKey : secrets.mistralApiKey;
  invariant(typeof key === 'string' && key.length > 0, 'Selected provider credential unavailable');
  return key;
}
