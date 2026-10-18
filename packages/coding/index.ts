import type { JsonValue } from '../contracts/common.ts';

export type CodingProviderId = 'codex' | 'pi';
export interface CodingRequest {
  message: string;
  workspace: string;
  sessionId?: string;
  /** Trusted host may shorten a turn to its remaining allocation. */
  timeoutMs?: number;
  /** Last observed native session totals, supplied from durable host state on resume. */
  previousUsage?: CodingUsage;
}
export interface CodingUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  /** Native CLI totals do not establish billed cost or physical API request counts. */
  costUsd: null;
  physicalRequests: null;
}
export interface CodingResult {
  provider: CodingProviderId;
  sessionId?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'uncertain';
  summary: string;
  events: JsonValue[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  elapsedMs: number;
  /** This invocation's tokens; resumed Codex totals are differenced against previousUsage. */
  usage: CodingUsage;
  /** Native session totals. Unknown/invalid fields are null; original values remain in events. */
  cumulativeUsage?: CodingUsage;
  /** Exact provider arguments and prompt, retained for host audit without credentials. */
  invocation?: Pick<CodingInvocation, 'args' | 'stdin'>;
}
export interface CodingProvider {
  readonly id: CodingProviderId;
  run(request: CodingRequest, signal?: AbortSignal): Promise<CodingResult>;
}

/** Host composition supplies execution, confinement, credentials and an isolated persistent CODEX_HOME. */
export interface CodingInvocation {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
}
export interface CodingProcessReceipt {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  stoppedFor?: 'cancelled' | 'timeout' | 'output-limit';
}
export type CodingExecutor = (invocation: CodingInvocation, signal?: AbortSignal) => Promise<CodingProcessReceipt>;
export interface CodexCodingProviderOptions {
  execute: CodingExecutor;
  timeoutMs: number;
  maxOutputBytes: number;
  executable?: string;
  model?: string;
}

export const CODING_LIMB_INSTRUCTIONS = [
  'You are a finite external coding limb invoked by the Autark. You are not its mind, identity, or conversational voice.',
  'Work only on the supplied coding request in the authorized workspace; inspect actual files and command results before reporting completion.',
  'When /app/node_modules is available, use its pinned compiler with /runtime/node /app/node_modules/typescript/bin/tsc --project /work/tsconfig.json --typeRoots /app/node_modules/@types; this dependency directory is read-only. If it is absent, report the missing toolchain so the Autark can use source_check.',
  'Use this one agent and this persistent session only. Never delegate, create subagents, fork sessions, or launch Codex, Pi, or other agent CLIs, including from shell commands.',
  'Project instructions requesting parallel agents do not authorize additional agents for this task.',
  'If information is missing, ask for clarification in your final response and stop; the Autark can reply in this same session.',
  'Report changes, commands run, observed results, and remaining uncertainty. Do not claim an action happened without evidence.',
].join('\n');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: JsonValue | undefined): { [key: string]: JsonValue } | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function emptyUsage(): CodingUsage {
  return { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null, physicalRequests: null };
}
const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const;
function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function turnUsage(cumulative: CodingUsage, previous: CodingUsage | undefined, resumed: boolean, diagnostics: string[]): CodingUsage {
  if (!resumed) return { ...cumulative };
  if (!previous || !TOKEN_FIELDS.every(field => validCount(previous[field]))) {
    diagnostics.push('Accounting uncertain: resumed Codex usage is cumulative, but the previous session totals are missing or invalid; per-turn token counts are unknown.');
    return emptyUsage();
  }
  if (TOKEN_FIELDS.some(field => cumulative[field] !== null && cumulative[field]! < previous[field]!)) {
    diagnostics.push('Accounting uncertain: Codex cumulative token counts regressed or reset; per-turn token counts are unknown.');
    return emptyUsage();
  }
  const usage = emptyUsage();
  for (const field of TOKEN_FIELDS) usage[field] = cumulative[field] === null ? null : cumulative[field]! - previous[field]!;
  return usage;
}
function requireNonempty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) throw new Error(`${name} must be a nonempty string without NUL bytes`);
}
function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}
function validateRequest(request: CodingRequest): void {
  requireNonempty(request.message, 'coding message');
  requireNonempty(request.workspace, 'coding workspace');
  if (request.sessionId !== undefined && !UUID.test(request.sessionId)) throw new Error('Codex resume requires an exact native session UUID');
}

/** Parse the retained JSONL without discarding unknown events, command output or file-change records. */
export function parseCodexResult(receipt: CodingProcessReceipt, expectedSessionId?: string, previousUsage?: CodingUsage): CodingResult {
  const events: JsonValue[] = [], diagnostics: string[] = [], accountingDiagnostics: string[] = [], messages: string[] = [];
  let observedSessionId: string | undefined, completed = 0, failed = false;
  let reportedUsage: CodingUsage | undefined, multipleSessions = false;
  for (const [index, line] of receipt.stdout.split('\n').entries()) {
    if (line.trim().length === 0) continue;
    let parsed: JsonValue;
    try { parsed = JSON.parse(line) as JsonValue; }
    catch { diagnostics.push(`Malformed or truncated JSONL at line ${index + 1}.`); continue; }
    events.push(parsed);
    const event = record(parsed);
    if (!event || typeof event.type !== 'string') { diagnostics.push(`Invalid event envelope at line ${index + 1}.`); continue; }
    if (event.type === 'thread.started') {
      if (typeof event.thread_id !== 'string' || !UUID.test(event.thread_id)) diagnostics.push('Codex emitted an invalid native session UUID.');
      else if (observedSessionId !== undefined && observedSessionId !== event.thread_id) {
        multipleSessions = true;
        diagnostics.push(`Codex emitted more than one session: ${observedSessionId}, ${event.thread_id}.`);
      }
      else observedSessionId = event.thread_id;
    }
    if (event.type === 'item.completed') {
      const item = record(event.item);
      if (item?.type === 'agent_message') {
        if (typeof item.text === 'string') messages.push(item.text);
        else diagnostics.push('Codex emitted an agent message without text.');
      }
    }
    const item = record(event.item);
    if (item && typeof item.type === 'string' && /collab.*(?:tool|agent)/.test(item.type)) {
      diagnostics.push('Codex emitted an agent collaboration event despite the single-agent restriction.');
    }
    if (event.type === 'turn.completed') {
      completed += 1;
      const counts = record(event.usage);
      reportedUsage = emptyUsage();
      if (!counts) accountingDiagnostics.push('Accounting uncertain: Codex completed without a usage object; token counts are unknown.');
      else {
        for (const [source, target] of [
          ['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['cached_input_tokens', 'cachedInputTokens'],
        ] as const) {
          const count = counts[source];
          if (validCount(count)) reportedUsage[target] = count;
          else accountingDiagnostics.push(`Accounting uncertain: Codex reported missing or invalid ${source}; that token count is unknown.`);
        }
      }
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      failed = true;
      const error = record(event.error);
      diagnostics.push(typeof error?.message === 'string' ? error.message : typeof event.message === 'string' ? event.message : `Codex emitted ${event.type}.`);
    }
  }
  if (expectedSessionId && observedSessionId && expectedSessionId !== observedSessionId) {
    diagnostics.push(`Codex resumed a different session: expected ${expectedSessionId}, observed ${observedSessionId}.`);
  }
  if (!observedSessionId) diagnostics.push('No native session acknowledgement was observed.');
  if (completed !== 1) diagnostics.push(`Expected one completed turn, observed ${completed}.`);
  if (receipt.stoppedFor) diagnostics.push(`Coding process stopped for ${receipt.stoppedFor}; inspect retained output before further work.`);
  if (receipt.signal) diagnostics.push(`Coding process exited after signal ${receipt.signal}.`);
  if (receipt.exitCode !== 0) diagnostics.push(`Coding process exit code: ${receipt.exitCode ?? 'unknown'}.`);
  let status: CodingResult['status'];
  if (receipt.stoppedFor === 'cancelled') status = 'cancelled';
  else if (receipt.stoppedFor || receipt.signal || receipt.exitCode === null) status = 'uncertain';
  else if (receipt.exitCode !== 0 || failed) status = 'failed';
  else status = diagnostics.length > 0 ? 'uncertain' : 'completed';
  // Foreign or ambiguous thread/turn totals must never become this session's accounting baseline.
  const cumulativeUsage = observedSessionId && !multipleSessions && completed === 1 && (!expectedSessionId || expectedSessionId === observedSessionId) ? reportedUsage : undefined;
  const usage = cumulativeUsage ? turnUsage(cumulativeUsage, previousUsage, expectedSessionId !== undefined, accountingDiagnostics) : emptyUsage();
  if (reportedUsage && !cumulativeUsage) accountingDiagnostics.push('Accounting uncertain: cumulative usage cannot be attributed to exactly one acknowledged session and turn.');
  const sessionId = expectedSessionId ?? observedSessionId;
  return {
    provider: 'codex', ...(sessionId ? { sessionId } : {}), status,
    summary: [...diagnostics, ...accountingDiagnostics, ...messages].join('\n\n') || 'Codex completed without a final text response; inspect the retained events.',
    events, stdout: receipt.stdout, stderr: receipt.stderr, exitCode: receipt.exitCode, elapsedMs: receipt.elapsedMs, usage,
    ...(cumulativeUsage ? { cumulativeUsage } : {}),
  };
}

/** One initial start and one in-flight turn. Durable session ownership is enforced by the caller. */
export class CodexCodingProvider implements CodingProvider {
  readonly id = 'codex' as const;
  private readonly options: CodexCodingProviderOptions;
  private active = false;
  private started = false;
  private sessionId?: string;
  private workspace?: string;

  constructor(options: CodexCodingProviderOptions) {
    requirePositiveInteger(options.timeoutMs, 'coding timeoutMs');
    requirePositiveInteger(options.maxOutputBytes, 'coding maxOutputBytes');
    if (options.executable !== undefined) requireNonempty(options.executable, 'Codex executable');
    if (options.model !== undefined) requireNonempty(options.model, 'Codex model');
    this.options = { ...options };
  }

  async run(request: CodingRequest, signal?: AbortSignal): Promise<CodingResult> {
    validateRequest(request);
    if (request.timeoutMs !== undefined) { requirePositiveInteger(request.timeoutMs, 'coding request timeoutMs'); if (request.timeoutMs > this.options.timeoutMs) throw new Error('Coding request timeout exceeds the configured maximum'); }
    if (this.active) throw new Error('The single coding agent already has an active turn; inspect it before following up.');
    if (this.workspace !== undefined && this.workspace !== request.workspace) throw new Error('The coding agent is bound to a different workspace.');
    if (this.started && !request.sessionId) throw new Error('A coding agent has already been started; follow up with its exact session UUID.');
    if (this.sessionId && request.sessionId !== this.sessionId) throw new Error('The coding agent session does not match the existing session UUID.');
    if (this.started && !this.sessionId) throw new Error('The first coding start has an unknown session outcome; reconcile it before any further execution.');
    if (signal?.aborted) return {
      provider: this.id, ...(request.sessionId ? { sessionId: request.sessionId } : {}), status: 'cancelled',
      summary: 'Coding was cancelled before process execution.', events: [], stdout: '', stderr: '', exitCode: null, elapsedMs: 0, usage: emptyUsage(),
    };
    this.active = true;
    this.started = true;
    this.workspace = request.workspace;
    this.sessionId = request.sessionId;
    const args = [
      'exec', '--json', '--color', 'never', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '-c', 'agents.max_threads=1',
      '-c', 'sandbox_workspace_write.network_access=false', '-c', 'shell_environment_policy.inherit="none"',
      '-c', 'shell_environment_policy.set.PATH="/runtime:/usr/bin:/bin"',
      ...['multi_agent', 'multi_agent_v2', 'hooks', 'apps', 'plugins'].flatMap(feature => ['--disable', feature]),
      '-c', `developer_instructions=${JSON.stringify(CODING_LIMB_INSTRUCTIONS)}`,
    ];
    if (this.options.model) args.push('--model', this.options.model);
    if (request.sessionId) args.push('resume', request.sessionId, '-');
    else args.push('-');
    const invocation: CodingInvocation = {
      executable: this.options.executable ?? 'codex', args, cwd: request.workspace,
      stdin: request.message, timeoutMs: request.timeoutMs ?? this.options.timeoutMs, maxOutputBytes: this.options.maxOutputBytes,
    };
    const audit = { args: [...args], stdin: invocation.stdin };
    try {
      const receipt = await this.options.execute(invocation, signal);
      const result = parseCodexResult(receipt, request.sessionId, request.previousUsage);
      if (result.sessionId) this.sessionId = result.sessionId;
      return { ...result, invocation: audit };
    } catch (error) {
      return {
        provider: this.id, ...(this.sessionId ? { sessionId: this.sessionId } : {}), status: signal?.aborted ? 'cancelled' : 'uncertain',
        summary: 'Coding execution did not return a process receipt; its outcome requires inspection. No retry or fallback was attempted.',
        events: [], stdout: '', stderr: error instanceof Error ? `${error.name}: ${error.message}` : String(error), exitCode: null, elapsedMs: 0, usage: emptyUsage(), invocation: audit,
      };
    } finally { this.active = false; }
  }
}

/** Explicit alternative selected at composition; never an automatic fallback from Codex. */
export class PiCodingProvider implements CodingProvider {
  readonly id = 'pi' as const;
  private readonly execute: CodingProvider['run'];
  private active = false;
  constructor(options: { run: CodingProvider['run'] }) { this.execute = options.run; }
  async run(request: CodingRequest, signal?: AbortSignal): Promise<CodingResult> {
    requireNonempty(request.message, 'coding message');
    requireNonempty(request.workspace, 'coding workspace');
    if (this.active) throw new Error('The single coding agent already has an active turn.');
    this.active = true;
    try {
      const result = await this.execute(request, signal);
      if (result.provider !== this.id) throw new Error('Pi coding adapter returned a different provider.');
      return result;
    } finally { this.active = false; }
  }
}
