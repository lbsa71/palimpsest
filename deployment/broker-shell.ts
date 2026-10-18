import { createHash } from 'node:crypto';
import { identity, invariant, scopeAllows, validateCapturedPrompt, validatePhysicalRequest, type JsonValue, type PhysicalRequest,
  type ArtifactRef, type PromptFragment, type PromptManifest, type ShellInput, type ShellPort, type ShellResult } from '../packages/contracts/index.ts';
import { completedOpenAIOutput, openaiOutput } from '../packages/agent-shell/openai.ts';
import type { ShellOptions } from '../packages/agent-shell/index.ts';
import { runWorker } from '../packages/supervisor/worker-process.ts';
import type { ResourceLimits } from '../packages/supervisor/resource-limits.ts';

export interface TransportReceipt {
  requestId: string;
  dispatched: boolean;
  status: PhysicalRequest['status'];
  httpStatus: number | null;
  usage: PhysicalRequest['usage'];
  responseModel: string | null;
  responseDigest: string | null;
  /** Mistral's explicit served value, including malformed values. Absence is
   * request-default inference, never an observation of the served tier. */
  responseServiceTier?: JsonValue;
}
type WorkerConfig = Omit<ShellOptions, 'apiKey' | 'fetch' | 'resolveFragment' | 'steering' | 'reservationEstimate' | 'projectToolResult' | 'endpoint' | 'toolInstructions'>;
/** Host callbacks, invoked without a receiver; never worker/model configuration. */
export interface BrokerTiming {
  monotonicNow(): number;
  timeoutSignal(milliseconds: number): AbortSignal;
}
export function captureBrokerTiming(timing?: BrokerTiming): Readonly<BrokerTiming> {
  const monotonicNow = timing?.monotonicNow ?? performance.now.bind(performance);
  const timeoutSignal = timing?.timeoutSignal ?? AbortSignal.timeout.bind(AbortSignal);
  invariant(typeof monotonicNow === 'function' && typeof timeoutSignal === 'function', 'Host timing callbacks required');
  return Object.freeze({ monotonicNow, timeoutSignal });
}
export interface BrokerShellOptions {
  brokerTiming?: BrokerTiming;
  runWorker?: typeof runWorker;
  applicationRoot: string;
  entrypoint: string;
  workspace(input: ShellInput): string;
  protectedPaths: string[];
  nodeBinary: string;
  resourceLimits?: ResourceLimits;
  worker: WorkerConfig;
  timeoutMs: number;
  maxPayloadBytes: number;
  maxResponseBytes?: number;
  pricesPerMillion: { input: number; output: number };
  resolveFragment(fragment: PromptFragment): Promise<string>;
  retainToolInstructions(source: string): ArtifactRef;
  assertAuthority(input: ShellInput): void;
  performRequest(payload: string, signal: AbortSignal): Promise<{ status: number; body: string }>;
  recordTransport(receipt: TransportReceipt): void;
  /** Host raw retention before interpreting usage or replying to the worker. */
  recordResponse?(requestId: string, response: { status: number; body: string }): void;
  /** Trusted host operation completion, including unknown provider outcomes.
   * Initial/advisory receipt status alone never proves a transport has ended. */
  onTransportFinished?(requestId: string): void;
  beforeRequest?(requestId: string): void;
}

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Model iteration is confined; credentials, reservations, receipts and tools remain in the host. */
export function createBrokerShell(options: BrokerShellOptions): ShellPort {
  const { monotonicNow, timeoutSignal } = captureBrokerTiming(options.brokerTiming);
  const executeWorker = options.runWorker ?? runWorker;
  invariant(typeof executeWorker === 'function', 'Host worker runner required');
  const readTime = (): number => {
    const value = monotonicNow();
    invariant(Number.isFinite(value) && value >= 0, 'Invalid host monotonic time');
    return value;
  };
  const provider = options.worker.provider ?? 'mistral';
  invariant(provider === 'mistral' || provider === 'openai', 'Unsupported broker provider');
  invariant(options.worker.model && !options.worker.model.includes('latest'), 'Broker needs an explicitly pinned model');
  invariant(/^[a-zA-Z0-9_./-]+\.(ts|js)$/.test(options.entrypoint) && !options.entrypoint.split('/').includes('..'), 'Invalid worker entrypoint');
  invariant(options.pricesPerMillion && Object.keys(options.pricesPerMillion).sort().join(',') === 'input,output', 'Explicit input and output token prices required');
  for (const price of Object.values(options.pricesPerMillion)) invariant(Number.isFinite(price) && price >= 0, 'Invalid configured token price');
  return {
    async run(input, bridge, signal) {
      options.assertAuthority(input);
      const worker = structuredClone(options.worker);
      const fragments: Record<string, string> = {};
      for (const fragment of [...input.prompt.fragments, ...(worker.compaction ? [worker.compaction.instruction] : [])]) {
        invariant(scopeAllows(fragment.scope, input.run.scope), 'Worker prompt audience mismatch');
        const value = await options.resolveFragment(fragment);
        invariant(hash(value) === fragment.artifact.sha256, 'Worker prompt artifact changed');
        fragments[fragment.artifact.sha256] = value;
      }
      const baseFragments = [...input.prompt.fragments].sort((a, b) => a.order - b.order);
      invariant(baseFragments.every(fragment => fragment.role === 'system' || fragment.role === 'developer'), 'Unsupported broker instruction role');
      async function retainTools(source: string): Promise<ArtifactRef> {
        const artifact = options.retainToolInstructions(source);
        invariant(artifact.sha256 === hash(source) && artifact.uri === `aeon:artifact:${artifact.sha256}`, 'Host retained another tool instruction artifact');
        const fragment: PromptFragment = { id: 'shell.tools', owner: 'tool', role: 'tool', order: 0, artifact, scope: input.run.scope, replaceable: true, derivedFrom: [] };
        invariant(await options.resolveFragment(fragment) === source, 'Host tool instruction artifact is unavailable or changed');
        fragments[artifact.sha256] = source;
        return artifact;
      }
      const toolInstructions = { tools: await retainTools(JSON.stringify(worker.tools)), ...(worker.compaction ? { compaction: await retainTools('[]') } : {}) };
      function expectedFragments(compaction: boolean): PromptFragment[] {
        const instructions = compaction ? [...baseFragments, { ...worker.compaction!.instruction, order: Math.max(-1, ...baseFragments.map(fragment => fragment.order)) + 1 }] : baseFragments;
        return [...instructions, { id: 'shell.tools', owner: 'tool', role: 'tool', order: Math.max(-1, ...instructions.map(fragment => fragment.order)) + 1,
          artifact: compaction ? toolInstructions.compaction! : toolInstructions.tools, scope: input.run.scope, replaceable: true, derivedFrom: [] }];
      }
      const captured = new Map<string, { manifest: PromptManifest; payload: string; purpose: 'reasoning' | 'compaction' }>();
      const observed = new Map<string, JsonValue>();
      let lastCheckpoint = input.checkpoint;
      type RequestRecord = { request: PhysicalRequest; payload: string; fetched: boolean; receipt?: TransportReceipt; settled: boolean };
      const records = new Map<string, RequestRecord>();
      let physicalRequests = 0;
      const inFlight = new Set<Promise<unknown>>();
      async function settleRecord(record: RequestRecord): Promise<void> {
        if (record.settled) return;
        const receipt = record.receipt;
        const status = receipt?.status ?? (record.request.status === 'reserved' ? 'failed' : 'uncertain');
        await bridge.settle({ ...record.request, status, usage: receipt?.usage ?? { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } });
        record.settled = true;
      }
      let output: JsonValue;
      try {
      output = await executeWorker({
        command: { workspace: options.workspace(input), protectedPaths: options.protectedPaths, applicationRoot: options.applicationRoot,
          nodeBinary: options.nodeBinary, executable: '/runtime/node', args: [`/app/${options.entrypoint}`],
          timeoutMs: options.timeoutMs, maxOutputBytes: options.maxPayloadBytes * 64, resourceLimits: options.resourceLimits, signal },
        initial: json({ input, options: { ...worker, toolInstructions }, fragments }), maxMessageBytes: options.maxPayloadBytes,
        maxRequests: Math.max(64, worker.maxRequests * 16),
        async handle(method, args, workerSignal) {
          if (method !== 'settle') { options.assertAuthority(input); workerSignal.throwIfAborted(); }
          switch (method) {
            case 'execute': {
              const call = args[0] as unknown as Parameters<typeof bridge.execute>[0];
              invariant(call?.runId === input.run.id, 'Foreign worker tool call');
              const observation = await bridge.execute(call, workerSignal);
              observed.set(observation.id, json(observation));
              return json(observation);
            }
            case 'capturePrompt': {
              const manifest = args[0] as unknown as PromptManifest; const payload = args[1];
              invariant(typeof payload === 'string' && Buffer.byteLength(payload) <= options.maxPayloadBytes, 'Provider payload too large');
              validateCapturedPrompt(manifest, payload);
              const normal = identity(manifest.fragments) === identity(expectedFragments(false));
              const compaction = !!worker.compaction && identity(manifest.fragments) === identity(expectedFragments(true));
              invariant(normal || compaction, 'Worker changed owned prompt provenance');
              const decoded = JSON.parse(payload) as Record<string, unknown>;
              const expectedSystem = baseFragments.map(fragment => fragments[fragment.artifact.sha256]).join('\n\n') + (compaction ? `\n\n${fragments[worker.compaction!.instruction.artifact.sha256]}` : '');
              let expectedTools: unknown[];
              if (provider === 'openai') {
                invariant(Object.keys(decoded).every(key => ['model', 'instructions', 'input', 'tools', 'tool_choice', 'reasoning', 'store', 'include', 'stream', 'max_output_tokens'].includes(key)), 'Unqualified provider option');
                invariant(decoded.instructions === expectedSystem && Array.isArray(decoded.input), 'Worker changed owned system instructions');
                for (const raw of decoded.input) {
                  invariant(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid Responses input');
                  const item = raw as Record<string, unknown>;
                  if (item.role === 'user') invariant(Object.keys(item).every(key => ['role', 'content'].includes(key)) && typeof item.content === 'string', 'Unowned Responses user instructions');
                  else if (item.type === 'function_call_output') invariant(Object.keys(item).every(key => ['type', 'call_id', 'output'].includes(key)) && typeof item.call_id === 'string' && typeof item.output === 'string', 'Invalid Responses tool output');
                  else openaiOutput([item]);
                }
                expectedTools = compaction ? [] : worker.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }));
                invariant(decoded.store === false && identity(decoded.include) === identity(['reasoning.encrypted_content']), 'Unqualified Responses state profile');
                invariant(identity(decoded.reasoning ?? null) === identity(worker.reasoningEffort ? { effort: worker.reasoningEffort } : null), 'Unqualified reasoning effort');
                invariant(decoded.max_output_tokens === (worker.maxOutputTokens ?? 4096), 'Unqualified output allowance');
              } else {
                invariant(Object.keys(decoded).every(key => ['model', 'messages', 'tools', 'tool_choice', 'reasoning_effort', 'stream', 'max_tokens'].includes(key)), 'Unqualified provider option');
                const messages = decoded.messages as { role: string; content: unknown }[];
                invariant(Array.isArray(messages) && messages[0]?.role === 'system' && messages[0].content === expectedSystem && messages.slice(1).every(message => ['user', 'assistant', 'tool'].includes(message.role)), 'Worker changed owned system instructions');
                expectedTools = compaction ? [] : worker.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
                invariant(decoded.max_tokens === (worker.maxOutputTokens ?? 4096), 'Unqualified output allowance');
                invariant(decoded.reasoning_effort === worker.reasoningEffort, 'Unqualified reasoning effort');
              }
              invariant(identity(decoded.tools ?? []) === identity(expectedTools) && decoded.tool_choice === (expectedTools.length ? 'auto' : undefined), 'Worker changed owned tools');
              invariant(decoded.model === worker.model && decoded.stream === false, 'Unqualified provider profile');
              await bridge.capturePrompt(manifest, payload);
              captured.set(manifest.id, { manifest, payload, purpose: compaction ? 'compaction' : 'reasoning' });
              return null;
            }
            case 'reserve': {
              const request = args[0] as unknown as PhysicalRequest;
              validatePhysicalRequest(request);
              invariant(request.runId === input.run.id && request.provider === provider && request.model === worker.model, 'Foreign worker request');
              invariant(!records.has(request.id), 'Duplicate worker request identity');
              const capture = captured.get(request.promptManifestId);
              invariant(capture?.manifest.requestDigest === request.requestDigest, 'Uncaptured worker request');
              invariant(request.purpose === capture.purpose, 'Worker request purpose changed instruction surface');
              // A conservative byte bound includes framing; actual trusted provider usage settles later.
              const inputTokens = Buffer.byteLength(capture.payload) + 1024;
              const outputTokens = worker.maxOutputTokens ?? 4096;
              const costUsd = (inputTokens * options.pricesPerMillion.input + outputTokens * options.pricesPerMillion.output) / 1_000_000;
              const reserved = { ...request, usage: { requests: 1, inputTokens, outputTokens, costUsd, elapsedMs: worker.timeoutMs ?? 60_000 } };
              await bridge.reserve(reserved, workerSignal);
              records.set(request.id, { request: reserved, payload: capture.payload, fetched: false, settled: false });
              return null;
            }
            case 'dispatched': {
              const request = args[0] as unknown as PhysicalRequest;
              const record = records.get(request.id);
              invariant(record && record.request.runId === request.runId && record.request.status === 'reserved', 'Unreserved worker dispatch');
              const { status: _a, usage: _b, ...original } = record.request;
              const { status: _c, usage: _d, ...supplied } = request;
              invariant(identity(original) === identity(supplied), 'Worker request changed');
              await bridge.dispatched({ ...record.request, status: 'dispatched' }, workerSignal);
              record.request.status = 'dispatched';
              return null;
            }
            case 'provider.fetch': {
              const payload = args[0]; invariant(typeof payload === 'string', 'Provider payload required');
              const record = [...records.values()].find(item => !item.fetched && !item.settled && item.request.status === 'dispatched' && item.payload === payload);
              invariant(record, 'Fetch lacks an unused dispatched reservation');
              invariant(physicalRequests < worker.maxRequests, 'Host physical request ceiling exhausted');
              // Consumption precedes network I/O. A second fetch can never reuse this reservation.
              record.fetched = true; physicalRequests++;
              const receipt: TransportReceipt = { requestId: record.request.id, dispatched: true, status: 'uncertain', httpStatus: null,
                usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: record.request.usage.elapsedMs }, responseModel: null, responseDigest: null };
              let started: number | undefined;
              record.receipt = receipt;
              options.recordTransport(receipt);
              const operation = (async () => { try {
                started = readTime();
                const bounded = AbortSignal.any([workerSignal, timeoutSignal(worker.timeoutMs ?? 60_000)]);
                bounded.throwIfAborted();
                options.beforeRequest?.(record.request.id);
                const response = await options.performRequest(payload, bounded);
                invariant(Buffer.byteLength(response.body) <= (options.maxResponseBytes ?? options.maxPayloadBytes), 'Provider response too large');
                options.recordResponse?.(record.request.id, response);
                receipt.httpStatus = response.status; receipt.responseDigest = hash(response.body);
                if (response.status >= 200 && response.status < 300) {
                  const body = JSON.parse(response.body) as { usage?: Record<string, unknown>; model?: string; id?: string; status?: string; output?: unknown };
                  receipt.responseModel = typeof body.model === 'string' ? body.model : null;
                  const usage = body.usage;
                  if (provider === 'mistral') {
                    if (usage && Object.hasOwn(usage, 'service_tier')) receipt.responseServiceTier = json(usage.service_tier);
                    // Requests cannot select service_tier; Mistral documents its
                    // omitted default as standard_only. Unknown profiles remain
                    // uncertain with null usage, retaining the original charge.
                    invariant(body.model === worker.model, 'Mistral response model differs from qualified host profile');
                    invariant(receipt.responseServiceTier === undefined || receipt.responseServiceTier === 'standard', 'Unsupported Mistral served tier');
                  }
                  const inputTokens = usage?.[provider === 'openai' ? 'input_tokens' : 'prompt_tokens'];
                  const outputTokens = usage?.[provider === 'openai' ? 'output_tokens' : 'completion_tokens'];
                  if (Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens) && Number(inputTokens) >= 0 && Number(outputTokens) >= 0) {
                    receipt.usage.inputTokens = Number(inputTokens); receipt.usage.outputTokens = Number(outputTokens);
                    receipt.usage.costUsd = (Number(inputTokens) * options.pricesPerMillion.input + Number(outputTokens) * options.pricesPerMillion.output) / 1_000_000;
                  }
                  receipt.status = 'succeeded';
                  if (provider === 'openai') {
                    try {
                      invariant(body.status === 'completed' && typeof body.id === 'string' && body.id.length > 0 && typeof body.model === 'string' && body.model.length > 0, 'Invalid Responses completion');
                      completedOpenAIOutput(body.output);
                      invariant(usage === undefined || usage === null || receipt.usage.inputTokens !== null, 'Invalid Responses usage');
                    } catch { receipt.status = 'failed'; }
                  }
                } else if (response.status >= 400 && response.status < 500) receipt.status = 'failed';
                return json(response);
              } finally {
                let timingFailure: Error | undefined;
                if (started !== undefined) {
                  try {
                    const ended = readTime();
                    invariant(ended >= started, 'Host monotonic time regressed');
                    receipt.usage.elapsedMs = ended - started;
                  } catch (cause) {
                    // Raw response retention precedes timing. Unknown timing cannot
                    // refund any part of a dispatched reservation, even with usage.
                    receipt.status = 'uncertain';
                    receipt.usage = { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: record.request.usage.elapsedMs };
                    timingFailure = new Error('Host monotonic timing unavailable', { cause });
                  }
                }
                try {
                  options.recordTransport(receipt);
                  // Trusted host evidence is durable before replying, even if the worker dies
                  // or omits its advisory settlement RPC.
                  await settleRecord(record);
                } finally { options.onTransportFinished?.(record.request.id); }
                if (timingFailure) throw timingFailure;
              } })();
              inFlight.add(operation);
              try { return await operation; } finally { inFlight.delete(operation); }
            }
            case 'settle': {
              const supplied = args[0] as unknown as PhysicalRequest;
              const record = records.get(supplied.id);
              invariant(record && supplied.runId === input.run.id, 'Foreign worker settlement');
              invariant(!record.fetched || record.settled, 'Provider request still in flight');
              await settleRecord(record);
              return null;
            }
            case 'persistCheckpoint': {
              invariant(args[0] === input.run.id, 'Foreign worker checkpoint');
              lastCheckpoint = await bridge.persistCheckpoint(args[0], args[1] as number, args[2] as string, args[3]);
              return json(lastCheckpoint);
            }
            case 'readCheckpoint':
              return json(await bridge.readCheckpoint(args[0] as unknown as Parameters<typeof bridge.readCheckpoint>[0]));
            default: throw new Error('Unknown worker operation');
          }
        },
      });
      } finally {
        await Promise.allSettled([...inFlight]);
        for (const record of records.values()) await settleRecord(record);
      }
      invariant(typeof output === 'object' && output !== null && !Array.isArray(output), 'Invalid worker result');
      const result = output as unknown as ShellResult;
      invariant(['completed', 'checkpointed', 'cancelled', 'blocked'].includes(result.status), 'Invalid worker completion status');
      invariant(Array.isArray(result.observations), 'Invalid worker observations');
      for (const observation of result.observations) {
        const actual = observed.get(observation.id);
        invariant(actual && identity(actual) === identity(observation), 'Worker fabricated or changed an observation');
      }
      if (result.checkpoint) invariant(lastCheckpoint && identity(result.checkpoint) === identity(lastCheckpoint), 'Worker fabricated a checkpoint receipt');
      return result;
    },
  };
}
