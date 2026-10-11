import { createHash } from 'node:crypto';
import { identity, invariant, scopeAllows, validatePhysicalRequest, type JsonValue, type PhysicalRequest,
  type PromptFragment, type PromptManifest, type ShellInput, type ShellPort, type ShellResult } from '../packages/contracts/index.ts';
import type { ShellOptions } from '../packages/agent-shell/index.ts';
import { runWorker } from '../packages/supervisor/worker-process.ts';

export interface TransportReceipt {
  requestId: string;
  dispatched: boolean;
  status: PhysicalRequest['status'];
  httpStatus: number | null;
  usage: PhysicalRequest['usage'];
  responseModel: string | null;
  responseDigest: string | null;
}
type WorkerConfig = Omit<ShellOptions, 'apiKey' | 'fetch' | 'resolveFragment' | 'steering' | 'reservationEstimate' | 'endpoint'>;
export interface BrokerShellOptions {
  applicationRoot: string;
  entrypoint: string;
  workspace(input: ShellInput): string;
  protectedPaths: string[];
  nodeBinary: string;
  worker: WorkerConfig;
  timeoutMs: number;
  maxPayloadBytes: number;
  pricesPerMillion: { input: number; output: number };
  resolveFragment(fragment: PromptFragment): Promise<string>;
  assertAuthority(input: ShellInput): void;
  performRequest(payload: string, signal: AbortSignal): Promise<{ status: number; body: string }>;
  recordTransport(receipt: TransportReceipt): void;
}

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Model iteration is confined; credentials, reservations, receipts and tools remain in the host. */
export function createBrokerShell(options: BrokerShellOptions): ShellPort {
  invariant(options.worker.model && !options.worker.model.includes('latest'), 'Broker needs an explicitly pinned model');
  invariant(/^[a-zA-Z0-9_./-]+\.(ts|js)$/.test(options.entrypoint) && !options.entrypoint.split('/').includes('..'), 'Invalid worker entrypoint');
  for (const price of Object.values(options.pricesPerMillion)) invariant(Number.isFinite(price) && price >= 0, 'Invalid configured token price');
  return {
    async run(input, bridge, signal) {
      options.assertAuthority(input);
      const fragments: Record<string, string> = {};
      for (const fragment of [...input.prompt.fragments, ...(options.worker.compaction ? [options.worker.compaction.instruction] : [])]) {
        invariant(scopeAllows(fragment.scope, input.run.scope), 'Worker prompt audience mismatch');
        const value = await options.resolveFragment(fragment);
        invariant(hash(value) === fragment.artifact.sha256, 'Worker prompt artifact changed');
        fragments[fragment.artifact.sha256] = value;
      }
      const captured = new Map<string, { manifest: PromptManifest; payload: string }>();
      const observed = new Map<string, JsonValue>();
      let lastCheckpoint = input.checkpoint;
      const records = new Map<string, { request: PhysicalRequest; payload: string; fetched: boolean; receipt?: TransportReceipt; settled: boolean }>();
      let physicalRequests = 0;
      const output = await runWorker({
        command: { workspace: options.workspace(input), protectedPaths: options.protectedPaths, applicationRoot: options.applicationRoot,
          nodeBinary: options.nodeBinary, executable: '/runtime/node', args: [`/app/${options.entrypoint}`],
          timeoutMs: options.timeoutMs, maxOutputBytes: options.maxPayloadBytes * 64, signal },
        initial: json({ input, options: options.worker, fragments }), maxMessageBytes: options.maxPayloadBytes,
        maxRequests: Math.max(64, options.worker.maxRequests * 16),
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
              const decoded = JSON.parse(payload) as Record<string, unknown>;
              invariant(decoded.model === options.worker.model && decoded.stream === false, 'Unqualified provider profile');
              invariant(decoded.max_tokens === (options.worker.maxOutputTokens ?? 4096), 'Unqualified output allowance');
              invariant(decoded.reasoning_effort === options.worker.reasoningEffort, 'Unqualified reasoning effort');
              await bridge.capturePrompt(manifest, payload);
              captured.set(manifest.id, { manifest, payload });
              return null;
            }
            case 'reserve': {
              const request = args[0] as unknown as PhysicalRequest;
              validatePhysicalRequest(request);
              invariant(request.runId === input.run.id && request.provider === 'mistral' && request.model === options.worker.model, 'Foreign worker request');
              invariant(!records.has(request.id), 'Duplicate worker request identity');
              const capture = captured.get(request.promptManifestId);
              invariant(capture?.manifest.requestDigest === request.requestDigest, 'Uncaptured worker request');
              // A conservative byte bound includes framing; actual trusted provider usage settles later.
              const inputTokens = Buffer.byteLength(capture.payload) + 1024;
              const outputTokens = options.worker.maxOutputTokens ?? 4096;
              const costUsd = (inputTokens * options.pricesPerMillion.input + outputTokens * options.pricesPerMillion.output) / 1_000_000;
              const reserved = { ...request, usage: { requests: 1, inputTokens, outputTokens, costUsd, elapsedMs: options.worker.timeoutMs ?? 60_000 } };
              await bridge.reserve(reserved);
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
              await bridge.dispatched({ ...record.request, status: 'dispatched' });
              record.request.status = 'dispatched';
              return null;
            }
            case 'provider.fetch': {
              const payload = args[0]; invariant(typeof payload === 'string', 'Provider payload required');
              const record = [...records.values()].find(item => !item.fetched && !item.settled && item.request.status === 'dispatched' && item.payload === payload);
              invariant(record, 'Fetch lacks an unused dispatched reservation');
              invariant(physicalRequests < options.worker.maxRequests, 'Host physical request ceiling exhausted');
              // Consumption precedes network I/O. A second fetch can never reuse this reservation.
              record.fetched = true; physicalRequests++;
              const receipt: TransportReceipt = { requestId: record.request.id, dispatched: true, status: 'uncertain', httpStatus: null,
                usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 }, responseModel: null, responseDigest: null };
              const started = performance.now();
              record.receipt = receipt;
              options.recordTransport(receipt);
              try {
                const bounded = AbortSignal.any([workerSignal, AbortSignal.timeout(options.worker.timeoutMs ?? 60_000)]);
                const response = await options.performRequest(payload, bounded);
                invariant(Buffer.byteLength(response.body) <= options.maxPayloadBytes, 'Provider response too large');
                receipt.httpStatus = response.status; receipt.responseDigest = hash(response.body);
                if (response.status >= 200 && response.status < 300) {
                  const body = JSON.parse(response.body) as { usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
                  receipt.responseModel = typeof body.model === 'string' ? body.model : null;
                  const usage = body.usage;
                  if (Number.isSafeInteger(usage?.prompt_tokens) && Number.isSafeInteger(usage?.completion_tokens) && usage!.prompt_tokens! >= 0 && usage!.completion_tokens! >= 0) {
                    receipt.usage.inputTokens = usage!.prompt_tokens!; receipt.usage.outputTokens = usage!.completion_tokens!;
                    receipt.usage.costUsd = (usage!.prompt_tokens! * options.pricesPerMillion.input + usage!.completion_tokens! * options.pricesPerMillion.output) / 1_000_000;
                  }
                  receipt.status = 'succeeded';
                } else if (response.status === 429) receipt.status = 'failed';
                return json(response);
              } finally { receipt.usage.elapsedMs = performance.now() - started; options.recordTransport(receipt); }
            }
            case 'settle': {
              const supplied = args[0] as unknown as PhysicalRequest;
              const record = records.get(supplied.id);
              invariant(record && !record.settled && supplied.runId === input.run.id, 'Foreign or repeated worker settlement');
              const receipt = record.receipt;
              const status = receipt?.status ?? (record.request.status === 'reserved' ? 'failed' : 'uncertain');
              await bridge.settle({ ...record.request, status, usage: receipt?.usage ?? { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } });
              record.settled = true;
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
