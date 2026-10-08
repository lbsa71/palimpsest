import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CompletionRequest {
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  provider: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface Provider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export type ProviderErrorCode = 'configuration' | 'unavailable' | 'rejected' | 'protocol' | 'timeout' | 'cancelled' | 'limit';

/** Safe for operational logs. Never attach raw provider/CLI errors as causes. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;

  constructor(code: ProviderErrorCode, message: string, options: { status?: number } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = options.status;
  }
}

interface Bounds {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface MistralOptions extends Bounds {
  apiKey: string;
  model: string;
  /** API root, including /v1 when needed. Sent credentials must be trusted here. */
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

export interface CodexRunOptions {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface CodexRunResult { stdout: string; exitCode: number | null }
export interface CodexOptions extends Bounds {
  model: string;
  executable?: string;
  codexHome?: string;
  /** Trusted test seam, not a model-supplied tool or candidate extension point. */
  run?: (options: CodexRunOptions) => Promise<CodexRunResult>;
}

function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new ProviderError('configuration', 'Provider limits must be positive safe integers.');
  return result;
}

function required(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProviderError('unavailable', `${name} is not configured.`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validateRequest(request: CompletionRequest): void {
  if (typeof request.system !== 'string' || typeof request.prompt !== 'string' || !request.prompt.trim()) {
    throw new ProviderError('configuration', 'Provider request requires system and nonempty prompt strings.');
  }
  if (request.signal?.aborted) throw new ProviderError('cancelled', 'Provider request cancelled.');
  if (request.maxOutputTokens !== undefined) positive(request.maxOutputTokens, 1024);
  if (request.schema !== undefined && (request.schema === null || typeof request.schema !== 'object' || Array.isArray(request.schema))) {
    throw new ProviderError('configuration', 'Structured output schema must be an object.');
  }
  let schemaBytes = 0;
  try { schemaBytes = Buffer.byteLength(JSON.stringify(request.schema ?? {})); }
  catch { throw new ProviderError('configuration', 'Structured output schema must be JSON serializable.'); }
  if (Buffer.byteLength(request.system) + Buffer.byteLength(request.prompt) + schemaBytes > 1_048_576) {
    throw new ProviderError('limit', 'Provider request exceeds the input byte limit.');
  }
}

function checkText(text: unknown, schema: CompletionRequest['schema'], maximum: number): string {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError('protocol', 'Provider returned no text.');
  if (Buffer.byteLength(text) > maximum) throw new ProviderError('limit', 'Provider output exceeded the byte limit.');
  if (schema) {
    try { JSON.parse(text); } catch { throw new ProviderError('protocol', 'Provider returned invalid structured JSON.'); }
  }
  return text;
}

/** This boundary limits bytes while receiving, before parsing remote JSON. */
async function boundedBody(response: Response, maximum: number): Promise<string> {
  if (!response.body) throw new ProviderError('protocol', 'Provider returned no response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        void reader.cancel().catch(() => {});
        throw new ProviderError('limit', 'Provider response exceeded the byte limit.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

export class MistralProvider implements Provider {
  readonly name = 'mistral';
  readonly #options: MistralOptions;
  readonly #endpoint: URL;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: MistralOptions) {
    required(options.apiKey, 'MISTRAL_API_KEY');
    required(options.model, 'Mistral model');
    let base: URL;
    try { base = new URL(options.baseURL ?? 'https://api.mistral.ai/v1/'); }
    catch { throw new ProviderError('configuration', 'Mistral API root must be a valid HTTPS URL.'); }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new ProviderError('configuration', 'Mistral API root requires HTTPS with no credentials, query, or fragment.');
    }
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    this.#endpoint = new URL('chat/completions', base);
    this.#options = { ...options };
    this.#timeoutMs = positive(options.timeoutMs, 60_000);
    this.#maxResponseBytes = positive(options.maxResponseBytes, 1_048_576);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    validateRequest(request);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeoutMs);
    try {
      const result = await (this.#options.fetch ?? globalThis.fetch)(this.#endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${this.#options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.#options.model,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
          max_tokens: request.maxOutputTokens ?? 2048, stream: false, tool_choice: 'none',
          ...(request.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'palimpsest_response', strict: true, schema: request.schema } } } : {}),
        }),
      });
      if (!result.ok) {
        void result.body?.cancel().catch(() => {});
        const code = [401, 403, 408, 429].includes(result.status) || result.status >= 500 ? 'unavailable' : 'rejected';
        throw new ProviderError(code, `Mistral request failed with HTTP ${result.status}.`, { status: result.status });
      }
      const body = await boundedBody(result, this.#maxResponseBytes);
      let data: Record<string, unknown>;
      try { data = record(JSON.parse(body)); }
      catch { throw new ProviderError('protocol', 'Mistral returned malformed JSON.'); }
      const choices = data.choices;
      if (!Array.isArray(choices) || choices.length !== 1) throw new ProviderError('protocol', 'Mistral returned an invalid completion choice.');
      const choice = record(choices[0]);
      const message = record(choice.message);
      if (choice.finish_reason !== 'stop' || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)) {
        throw new ProviderError('protocol', 'Mistral returned incomplete text or unexpected tool calls.');
      }
      if (typeof data.model !== 'string' || !data.model.trim()) throw new ProviderError('protocol', 'Mistral returned no model identity.');
      const text = checkText(message.content, request.schema, this.#maxResponseBytes);
      const usage = record(data.usage);
      const outputTokens = count(usage.completion_tokens);
      if (outputTokens !== null && outputTokens > (request.maxOutputTokens ?? 2048)) {
        throw new ProviderError('limit', 'Mistral reported output above the requested token ceiling.');
      }
      return { text, model: data.model, provider: this.name, usage: { inputTokens: count(usage.prompt_tokens), outputTokens } };
    } catch (error) {
      if (request.signal?.aborted) throw new ProviderError('cancelled', 'Mistral request cancelled.');
      if (timedOut) throw new ProviderError('timeout', 'Mistral request timed out.');
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('unavailable', 'Mistral transport unavailable.');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    }
  }
}

// These names were verified with Codex 0.146.1. Unknown/removed flags must fail
// the CLI rather than silently turning this provider into a tool-using agent.
const DISABLED_CODEX_FEATURES = [
  'shell_tool', 'unified_exec', 'shell_snapshot', 'hooks', 'plugins', 'remote_plugin',
  'apps', 'multi_agent', 'multi_agent_v2', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'in_app_browser', 'computer_use', 'image_generation',
  'code_mode', 'code_mode_host', 'code_mode_only', 'memories', 'skill_search',
  'skill_mcp_dependency_install', 'tool_suggest', 'workspace_dependencies', 'goals',
];

/** One process and one turn; stdout is protocol data, stderr is never surfaced. */
async function runCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  if (options.signal?.aborted) throw new ProviderError('cancelled', 'Codex request cancelled.');
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd, env: options.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: ProviderError | undefined;
    const stop = (error: ProviderError) => {
      failure ??= error;
      // Killing the process group also closes pipes inherited by descendants.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* It may have exited between observation and cancellation. */ }
    };
    const abort = () => stop(new ProviderError('cancelled', 'Codex request cancelled.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => stop(new ProviderError('timeout', 'Codex request timed out.')), options.timeoutMs);
    const consume = (chunk: Buffer, keep: boolean) => {
      bytes += chunk.length;
      if (bytes > options.maxResponseBytes) stop(new ProviderError('limit', 'Codex output exceeded the byte limit.'));
      else if (keep) chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
    child.stdin.on('error', () => {}); // Early CLI exit may close stdin first.
    child.on('error', () => { failure ??= new ProviderError('unavailable', 'Codex executable unavailable.'); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ stdout: Buffer.concat(chunks).toString('utf8'), exitCode });
    });
    child.stdin.end(options.input);
  });
}

function codexUsage(stdout: string): CompletionResult['usage'] {
  let completed = false;
  let usage: CompletionResult['usage'] = { inputTokens: null, outputTokens: null };
  for (const line of stdout.split('\n').filter((value) => value.trim())) {
    let event: Record<string, unknown>;
    try { event = record(JSON.parse(line)); }
    catch { throw new ProviderError('protocol', 'Codex returned malformed event JSON.'); }
    if (event.type === 'turn.failed' || event.type === 'error') throw new ProviderError('unavailable', 'Codex reported a failed turn.');
    if (typeof event.type !== 'string') throw new ProviderError('protocol', 'Codex returned an invalid event.');
    if (event.type.startsWith('item.')) {
      const item = record(event.item);
      if (!['agent_message', 'reasoning'].includes(String(item.type))) {
        throw new ProviderError('protocol', 'Codex returned an unexpected tool or action event.');
      }
    }
    if (event.type === 'turn.completed') {
      if (completed) throw new ProviderError('protocol', 'Codex returned multiple completed turns.');
      completed = true;
      const tokens = record(event.usage);
      usage = { inputTokens: count(tokens.input_tokens), outputTokens: count(tokens.output_tokens) };
    }
  }
  if (!completed) throw new ProviderError('protocol', 'Codex did not confirm turn completion.');
  return usage;
}

export class CodexProvider implements Provider {
  readonly name = 'codex';
  readonly #options: CodexOptions;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: CodexOptions) {
    required(options.model, 'Codex model');
    this.#options = { ...options };
    this.#timeoutMs = positive(options.timeoutMs, 120_000);
    this.#maxResponseBytes = positive(options.maxResponseBytes, 1_048_576);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    validateRequest(request);
    const cwd = await mkdtemp(join(tmpdir(), 'palimpsest-inference-'));
    const output = join(cwd, 'response.txt');
    try {
      const args = [
        'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--json', '--color', 'never', '--model', this.#options.model,
        '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
        '-c', 'project_doc_max_bytes=0', '-c', 'tools.view_image=false',
        '-c', 'history.persistence="none"', '-c', `developer_instructions=${JSON.stringify(request.system)}`,
        ...DISABLED_CODEX_FEATURES.flatMap((feature) => ['--disable', feature]), '-o', output,
      ];
      if (request.schema) {
        const schemaPath = join(cwd, 'schema.json');
        await writeFile(schemaPath, JSON.stringify(request.schema), { mode: 0o600 });
        args.push('--output-schema', schemaPath);
      }
      args.push('-');
      const env: NodeJS.ProcessEnv = {};
      for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'SYSTEMROOT', 'WINDIR']) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
      }
      env.CODEX_HOME = this.#options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
      const result = await (this.#options.run ?? runCodex)({
        executable: this.#options.executable ?? 'codex', args, cwd, env,
        input: request.prompt, signal: request.signal,
        timeoutMs: this.#timeoutMs, maxResponseBytes: this.#maxResponseBytes,
      });
      if (result.exitCode !== 0) throw new ProviderError('unavailable', 'Codex process failed.');
      if (Buffer.byteLength(result.stdout) > this.#maxResponseBytes) throw new ProviderError('limit', 'Codex events exceeded the byte limit.');
      const usage = codexUsage(result.stdout);
      if (request.maxOutputTokens !== undefined && usage.outputTokens !== null && usage.outputTokens > request.maxOutputTokens) {
        throw new ProviderError('limit', 'Codex reported output above the requested token ceiling.');
      }
      let text: string;
      try {
        const info = await stat(output);
        if (!info.isFile()) throw new ProviderError('protocol', 'Codex returned no regular output file.');
        if (info.size > this.#maxResponseBytes) throw new ProviderError('limit', 'Codex output exceeded the byte limit.');
        text = await readFile(output, 'utf8');
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('protocol', 'Codex returned no readable final output.');
      }
      return { text: checkText(text, request.schema, this.#maxResponseBytes), provider: this.name, model: this.#options.model, usage };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('unavailable', 'Codex provider unavailable.');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  }
}

export function createProvider(options: ({ provider: 'mistral' } & MistralOptions) | ({ provider: 'codex' } & CodexOptions)): Provider {
  if (options.provider === 'mistral') return new MistralProvider(options);
  if (options.provider === 'codex') return new CodexProvider(options);
  throw new ProviderError('configuration', 'Unknown provider; choose mistral or codex explicitly.');
}
