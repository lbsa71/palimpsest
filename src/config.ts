import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';

export interface RuntimeConfig {
  repositoryRoot: string;
  dataDir: string;
  credentialsPath: string;
  provider: 'mistral' | 'codex';
  model?: string;
  mistralApiKey?: string;
  maxCallsPerTask: number;
  growthCallsPerDay: number;
  evolutionCallsPerDay: number;
  interactiveEvolutionCallsPerDay: number;
  planProposalCallsPerDay: number;
  planEvolutionCallsPerDay: number;
  planCadence: 'daily' | 'hourly';
  planProposalCallsPerHour: number;
  planEvolutionCallsPerHour: number;
  timeoutMs: number;
  slackBotToken?: string;
  slackAppToken?: string;
  slackSigningSecret?: string;
  slackTeamIds: string[];
  slackSelfModificationUserIds: string[];
  slackChannelIds: string[];
  gitRemote?: string;
  gitBranch?: string;
  gitRemoteUrl?: string;
  describe(): Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}

/** Resolve even nonexistent descendants through their nearest real ancestor. */
function canonicalPath(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    // existsSync follows links. A dangling alias must not be treated as a safe
    // new filename: creating its target could leak state into the checkout.
    try {
      if (lstatSync(ancestor).isSymbolicLink()) throw new Error('Dangling symlinks cannot define storage paths');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve path: ${path}`);
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  return join(realpathSync(ancestor), ...suffix);
}

/** Lived experience must never enter the checkout, even through a symlink. */
export function resolveExternalPath(repositoryRoot: string, path: string): string {
  const repo = canonicalPath(repositoryRoot);
  const target = canonicalPath(path);
  const rel = relative(repo, target);
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) {
    throw new Error('Palimpsest state and credentials must be outside the repository');
  }
  return target;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
}

export function loadConfig(options: { repositoryRoot?: string; env?: NodeJS.ProcessEnv } = {}): RuntimeConfig {
  const env = options.env ?? process.env;
  const startingPath = canonicalPath(options.repositoryRoot ?? process.cwd());
  let repositoryRoot = startingPath;
  for (let directory = startingPath; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) { repositoryRoot = directory; break; }
    if (directory === dirname(directory)) break;
  }
  const credentialsPath = resolveExternalPath(repositoryRoot,
    env.PALIMPSEST_CREDENTIALS_FILE ?? join(homedir(), '.config', 'palimpsest', 'credentials.env'));
  let credentials: NodeJS.ProcessEnv = {};
  if (existsSync(credentialsPath)) {
    if ((statSync(credentialsPath).mode & 0o077) !== 0) {
      throw new Error('Credentials file must be private (chmod 600)');
    }
    credentials = parseEnv(readFileSync(credentialsPath, 'utf8'));
  }
  const values = { ...credentials, ...env };
  const provider = values.PALIMPSEST_PROVIDER ?? 'mistral';
  if (provider !== 'mistral' && provider !== 'codex') throw new Error('Unknown provider; choose mistral or codex explicitly');
  const planCadence = values.PALIMPSEST_PLAN_CADENCE ?? 'daily';
  if (planCadence !== 'daily' && planCadence !== 'hourly') throw new Error('Unknown plan cadence; choose daily or hourly');
  const repoId = `${basename(repositoryRoot)}-${createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)}`;
  const dataDir = resolveExternalPath(repositoryRoot,
    values.PALIMPSEST_DATA_DIR ?? join(homedir(), '.local', 'share', 'palimpsest', repoId));
  const config: RuntimeConfig = {
    repositoryRoot, dataDir, credentialsPath, provider,
    model: provider === 'mistral' ? values.MISTRAL_MODEL : values.CODEX_MODEL,
    maxCallsPerTask: positiveInteger(values.PALIMPSEST_MAX_CALLS_PER_TASK, 4, 'max calls'),
    growthCallsPerDay: values.PALIMPSEST_GROWTH_CALLS_PER_DAY === '0' ? 0 : positiveInteger(values.PALIMPSEST_GROWTH_CALLS_PER_DAY, 4, 'daily growth calls'),
    evolutionCallsPerDay: values.PALIMPSEST_EVOLUTION_CALLS_PER_DAY === '0' ? 0 : positiveInteger(values.PALIMPSEST_EVOLUTION_CALLS_PER_DAY, 8, 'daily evolution calls'),
    interactiveEvolutionCallsPerDay: values.PALIMPSEST_INTERACTIVE_EVOLUTION_CALLS_PER_DAY === '0' ? 0 : positiveInteger(values.PALIMPSEST_INTERACTIVE_EVOLUTION_CALLS_PER_DAY, 8, 'daily interactive evolution calls'),
    planProposalCallsPerDay: values.PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_DAY === '0' ? 0 : positiveInteger(values.PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_DAY, 2, 'daily plan proposal calls'),
    planEvolutionCallsPerDay: values.PALIMPSEST_PLAN_EVOLUTION_CALLS_PER_DAY === '0' ? 0 : positiveInteger(values.PALIMPSEST_PLAN_EVOLUTION_CALLS_PER_DAY, 16, 'daily plan evolution calls'),
    planCadence,
    planProposalCallsPerHour: values.PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_HOUR === '0' ? 0 : positiveInteger(values.PALIMPSEST_PLAN_PROPOSAL_CALLS_PER_HOUR, 1, 'hourly plan proposal calls'),
    planEvolutionCallsPerHour: values.PALIMPSEST_PLAN_EVOLUTION_CALLS_PER_HOUR === '0' ? 0 : positiveInteger(values.PALIMPSEST_PLAN_EVOLUTION_CALLS_PER_HOUR, 8, 'hourly plan evolution calls'),
    timeoutMs: positiveInteger(values.PALIMPSEST_TIMEOUT_MS, 120_000, 'timeout'),
    slackTeamIds: (values.SLACK_ALLOWED_TEAM_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    slackSelfModificationUserIds: (values.SLACK_SELF_MODIFICATION_USER_IDS ?? values.SLACK_ALLOWED_USER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    slackChannelIds: (values.SLACK_ALLOWED_CHANNEL_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    gitRemote: values.PALIMPSEST_GIT_REMOTE || undefined,
    gitBranch: values.PALIMPSEST_GIT_BRANCH || undefined,
    describe() {
      return { repositoryRoot, dataDir, credentialsPath, provider, model: this.model ?? null,
        credentialsConfigured: provider === 'mistral' ? Boolean(this.mistralApiKey) : 'CLI login required',
        maxCallsPerTask: this.maxCallsPerTask, growthCallsPerDay: this.growthCallsPerDay, evolutionCallsPerDay: this.evolutionCallsPerDay, interactiveEvolutionCallsPerDay:this.interactiveEvolutionCallsPerDay,
        planProposalCallsPerDay:this.planProposalCallsPerDay,planEvolutionCallsPerDay:this.planEvolutionCallsPerDay,
        planCadence:this.planCadence,planProposalCallsPerHour:this.planProposalCallsPerHour,planEvolutionCallsPerHour:this.planEvolutionCallsPerHour,timeoutMs: this.timeoutMs,
        gitPublicationConfigured:Boolean(this.gitRemote && this.gitBranch && this.gitRemoteUrl), gitRemote:this.gitRemote ?? null,gitBranch:this.gitBranch ?? null,
        slackConfigured: Boolean(this.slackBotToken && (this.slackAppToken || this.slackSigningSecret)),
        slackSocketConfigured: Boolean(this.slackBotToken && this.slackAppToken),
        slackTeamIds: this.slackTeamIds, slackSelfModificationUserIds: this.slackSelfModificationUserIds, slackChannelIds: this.slackChannelIds };
    },
    toJSON() { return this.describe(); },
  };
  Object.defineProperty(config, 'mistralApiKey', { enumerable: false, value: values.MISTRAL_API_KEY || undefined });
  Object.defineProperty(config, 'slackBotToken', { enumerable: false, value: values.SLACK_BOT_TOKEN || undefined });
  Object.defineProperty(config, 'slackAppToken', { enumerable: false, value: values.SLACK_APP_TOKEN || undefined });
  Object.defineProperty(config, 'slackSigningSecret', { enumerable: false, value: values.SLACK_SIGNING_SECRET || undefined });
  Object.defineProperty(config, 'gitRemoteUrl', { enumerable: false, value: values.PALIMPSEST_GIT_REMOTE_URL || undefined });
  return config;
}

function privateApiToken(path: string, label: string): string {
  try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${label} token file must be private (chmod 600)`);
  const token = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error(`Invalid ${label} token file`);
  return token;
}

export function prepareState(config: RuntimeConfig): { dbPath: string; tokenPath: string; apiToken: string; peerTokenPath: string; peerApiToken: string } {
  const dataDir = resolveExternalPath(config.repositoryRoot, config.dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if ((statSync(dataDir).mode & 0o077) !== 0) throw new Error('Data directory must be private (chmod 700)');
  const dbPath = resolveExternalPath(config.repositoryRoot, join(dataDir, 'state.sqlite'));
  const tokenPath = resolveExternalPath(config.repositoryRoot, join(dataDir, 'api-token'));
  const peerTokenPath = resolveExternalPath(config.repositoryRoot, join(dataDir, 'peer-api-token'));
  const apiToken = privateApiToken(tokenPath, 'API');
  const peerApiToken = privateApiToken(peerTokenPath, 'Peer API');
  if (peerApiToken === apiToken) throw new Error('Operator and peer API tokens must differ');
  return { dbPath, tokenPath, apiToken, peerTokenPath, peerApiToken };
}
