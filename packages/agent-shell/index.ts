import { captureShellEnvironment, nodeShellFetch, throwShellFailures } from './environment.ts';
import { canonicalJson, identity, invariant, scopeAllows, validateCheckpoint, validateObservation, validatePromptManifest, validateRun } from '../contracts/index.ts';
import type { ArtifactRef, JsonValue, Observation, PhysicalRequest, PromptFragment, PromptManifest, ResourceUsage, ShellBridge, ShellCheckpoint, ShellInput, ShellPort } from '../contracts/index.ts';
import { runAgentLoopContinue } from './vendor/pi/agent/agent-loop.ts';
import type { AgentEvent, AgentTool } from './vendor/pi/agent/types.ts';
import { normalizeContext, validateToolArguments } from './vendor/pi/ai/index.ts';
import type { AssistantMessage, Message, Tool, ToolResultMessage } from './vendor/pi/ai/types.ts';
import { asJson, createMistralTransport, digest, mistralCompactionBoundary, mistralModel } from './mistral.ts';
import type { Attempt, AttemptOutcome, MistralTransportOptions } from './mistral.ts';
export { DEFAULT_MISTRAL_MODEL, createMistralTransport, mistralModel, mistralPayload } from './mistral.ts';
export type { Attempt, AttemptOutcome } from './mistral.ts';

import { completedOpenAIOutput, createOpenAITransport, openaiModel } from './openai.ts';
export { createOpenAITransport, openaiModel, openaiPayload } from './openai.ts';
export type ShellProvider = 'mistral' | 'openai';

export const SHELL_REVISION = 'pi-89e5c2c/aeon-bridge-v1';
export interface PhysicalRequestSliceContinuation {
  kind: 'physical-request-slice';
  physicalRequests: number;
  maxRequests: number;
  nextPurpose: Attempt['purpose'];
}
/** Recognizes a durable scheduling boundary, not permission to renew an allowance. */
export function physicalRequestSliceContinuation(content: JsonValue): PhysicalRequestSliceContinuation | undefined {
  if (!content || typeof content !== 'object' || Array.isArray(content) || content.schema !== SHELL_REVISION || content.status !== 'checkpointed' || content.failure !== undefined) return undefined;
  const value = content.continuation;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'kind,maxRequests,nextPurpose,physicalRequests'
    || value.kind !== 'physical-request-slice' || !Number.isSafeInteger(value.maxRequests) || Number(value.maxRequests) < 1
    || value.physicalRequests !== value.maxRequests || !['reasoning', 'compaction'].includes(String(value.nextPurpose))) return undefined;
  return { kind: 'physical-request-slice', physicalRequests: Number(value.physicalRequests), maxRequests: Number(value.maxRequests), nextPurpose: value.nextPurpose as Attempt['purpose'] };
}
class PhysicalRequestSliceExhausted extends Error {
  readonly continuation: PhysicalRequestSliceContinuation;
  constructor(physicalRequests: number, maxRequests: number, nextPurpose: Attempt['purpose']) {
    super('Physical request slice completed before the next dispatch');
    this.continuation = { kind: 'physical-request-slice', physicalRequests, maxRequests, nextPurpose };
  }
}
export interface ShellOptions extends Omit<MistralTransportOptions, 'reserve' | 'dispatched' | 'settle'> {
  provider?: ShellProvider;
  resolveFragment(fragment: PromptFragment): Promise<string>;
  tools: Tool[];
  /** Exact serialized tool sources retained by the trusted host before execution. */
  toolInstructions: { tools: ArtifactRef; compaction?: ArtifactRef };
  steering?: () => Promise<Message[]>;
  /** Trusted composition may yield after a successful tool hands work elsewhere.
   * The complete assistant tool batch is retained before returning. */
  finishAfterSuccessfulTools?: string[];
  /** Explicit conservative host ceiling; unknown defaults require a runtime per-request ceiling. */
  reservationEstimate?: (attempt: Attempt) => ResourceUsage;
  /** Host-owned model rendering; never replaces durable observations or history. */
  projectToolResult?: (message: ToolResultMessage) => ToolResultMessage;
  compaction?: { thresholdMessages: number; thresholdBytes?: number; retainMessages: number; instruction: PromptFragment };
}
interface Snapshot { provider?: ShellProvider; schema: typeof SHELL_REVISION; messages: Message[]; observationIds: string[]; status: 'running' | 'completed' | 'blocked' | 'cancelled' | 'checkpointed'; failure?: { stage: string; reason: string }; continuation?: PhysicalRequestSliceContinuation; compactions: { sourceDigest: string; summary: AssistantMessage }[]; rejectedCompactions?: { sourceDigest: string; summary: AssistantMessage }[] }
function json(value: unknown): JsonValue { return asJson(value) as JsonValue; }
function message(value: JsonValue): Message {
  invariant(typeof value === 'object' && value !== null && !Array.isArray(value), 'Invalid shell message');
  const item = value as Record<string, JsonValue>;
  invariant(['system', 'user', 'assistant', 'toolResult'].includes(String(item.role)), 'Invalid shell message role');
  invariant(typeof item.timestamp === 'number' && Number.isFinite(item.timestamp), 'Invalid shell message timestamp');
  if (item.role === 'user' || item.role === 'system') invariant(typeof item.content === 'string' || Array.isArray(item.content), 'Invalid shell message content');
  else invariant(Array.isArray(item.content), 'Invalid shell message content');
  return value as unknown as Message;
}
function toolResult(call: { id: string; name: string }, observation: Observation, aeonStepId: string, wallNow: () => number): ToolResultMessage & { aeonStepId: string } {
  return { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: canonicalJson(observation.value) }], isError: observation.kind === 'error', timestamp: wallNow(), aeonStepId };
}

/** Pi is a projection over the durable receiver: this adapter never directly executes a tool. */
export function createAgentShell(options: ShellOptions): ShellPort {
  const environment = captureShellEnvironment(options.environment);
  options = { ...options, environment, fetch: options.fetch ?? nodeShellFetch(), modelProfile: options.modelProfile && { ...options.modelProfile } };
  const provider = options.provider ?? 'mistral';
  invariant(provider === 'mistral' || provider === 'openai', 'Unsupported shell provider');
  invariant(provider !== 'openai' || !!options.model, 'OpenAI requires an explicit model');
  invariant(new Set(options.tools.map(tool => tool.name)).size === options.tools.length, 'Duplicate shell tools');
  const handoffTools = new Set(options.finishAfterSuccessfulTools ?? []);
  invariant(handoffTools.size === (options.finishAfterSuccessfulTools?.length ?? 0) && [...handoffTools].every(name => options.tools.some(tool => tool.name === name)), 'Invalid shell handoff tools');
  if (options.compaction) invariant(Number.isSafeInteger(options.compaction.thresholdMessages) && Number.isSafeInteger(options.compaction.retainMessages) && options.compaction.retainMessages >= 1 && options.compaction.thresholdMessages > options.compaction.retainMessages + 2, 'Invalid context budget');
  if (options.compaction?.thresholdBytes !== undefined) invariant(Number.isSafeInteger(options.compaction.thresholdBytes) && options.compaction.thresholdBytes > 0, 'Invalid context byte budget');
  return {
    async run(input: ShellInput, bridge: ShellBridge, signal?: AbortSignal) {
      validateRun(input.run); validatePromptManifest(input.prompt);
      const fragments = [...input.prompt.fragments].sort((a, b) => a.order - b.order);
      async function resolve(fragment: PromptFragment): Promise<string> {
        invariant(scopeAllows(fragment.scope, input.run.scope), 'Prompt fragment audience exceeds source scope');
        const content = await options.resolveFragment(fragment);
        invariant(digest(content) === fragment.artifact.sha256, 'Prompt fragment content digest changed');
        return content;
      }
      invariant(fragments.every(fragment => fragment.role === 'system' || fragment.role === 'developer'), 'Base prompt accepts only explicit owned instruction fragments');
      const basePrompt = (await Promise.all(fragments.map(resolve))).join('\n\n');
      const tools = options.tools.map(tool => ({ ...tool, parameters: structuredClone(tool.parameters) }));
      let transcript: Message[] = [];
      const observations: Observation[] = [];
      let observationIds: string[] = [];
      let checkpoint: ShellCheckpoint | undefined;
      let halted = false;
      let handedOff = false;
      let status: Snapshot['status'] = 'running';
      let failure: Snapshot['failure'];
      let continuation: PhysicalRequestSliceContinuation | undefined;
      let stage = 'recovery';
      let compactions: Snapshot['compactions'] = [];
      let rejectedCompactions: NonNullable<Snapshot['rejectedCompactions']> = [];
      function projectedToolResult(item: ToolResultMessage): ToolResultMessage {
        if (!options.projectToolResult) return item;
        const projected = options.projectToolResult(structuredClone(item));
        invariant(projected.role === 'toolResult' && projected.toolCallId === item.toolCallId && projected.toolName === item.toolName && projected.isError === item.isError && projected.timestamp === item.timestamp, 'Model projection changed tool identity');
        return projected;
      }
      const modelMessages = (messages: Message[]): Message[] => messages.map(item => item.role === 'toolResult' ? projectedToolResult(item) : item);
      if (input.checkpoint) {
        validateCheckpoint(input.checkpoint, input.run);
        invariant(input.checkpoint.shell === SHELL_REVISION, 'Unsupported shell checkpoint revision');
        const content = await bridge.readCheckpoint(input.checkpoint);
        invariant(identity(content) === input.checkpoint.artifact.sha256, 'Checkpoint artifact digest mismatch');
        invariant(typeof content === 'object' && content !== null && !Array.isArray(content), 'Invalid checkpoint content');
        const snapshot = content as unknown as Snapshot;
        invariant(snapshot.schema === SHELL_REVISION && Array.isArray(snapshot.messages) && Array.isArray(snapshot.observationIds), 'Invalid checkpoint schema');
        invariant((snapshot.provider ?? 'mistral') === provider, 'Checkpoint provider switch requires explicit context reconstruction');
        transcript = snapshot.messages.map(value => message(json(value)));
        invariant(snapshot.observationIds.every(id => typeof id === 'string') && identity(snapshot.observationIds) === identity(input.checkpoint.observationIds), 'Checkpoint observation index mismatch');
        observationIds = [...snapshot.observationIds];
        status = snapshot.status;
        compactions = structuredClone(snapshot.compactions ?? []);
        rejectedCompactions = structuredClone(snapshot.rejectedCompactions ?? []);
      }
      transcript.push(...input.messages.map(message));
      // Replace every historical application system layer; reintroduce only the current manifest.
      transcript = transcript.filter(item => item.role !== 'system');
      // Failed model turns remain in durable audit history, but are not valid Pi/provider
      // continuation messages. Their synthetic truncated-call results are excluded too.
      function continuationMessages(): Message[] {
        const incomplete = new Set(transcript.filter(item => item.role === 'assistant' && ['error', 'aborted', 'length'].includes(item.stopReason)).map(item => (item as Message & { aeonStepId?: string }).aeonStepId));
        return transcript.filter(item => {
          if (item.role === 'assistant' && ['error', 'aborted', 'length'].includes(item.stopReason)) return false;
          return item.role !== 'toolResult' || !incomplete.has((item as Message & { aeonStepId?: string }).aeonStepId);
        });
      }
      async function save(): Promise<void> {
        const content = json({ schema: SHELL_REVISION, provider, messages: transcript, observationIds, status, compactions, ...(rejectedCompactions.length ? { rejectedCompactions } : {}), ...(failure ? { failure } : {}), ...(continuation ? { continuation } : {}) });
        checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, SHELL_REVISION, content);
        validateCheckpoint(checkpoint, input.run);
        invariant(checkpoint.shell === SHELL_REVISION && checkpoint.artifact.sha256 === identity(content), 'Checkpoint receiver returned another artifact');
        invariant(identity(checkpoint.observationIds) === identity(observationIds), 'Checkpoint receiver omitted observation IDs');
      }
      const stepIds = new Set(transcript.filter(item => item.role === 'assistant').map(item => (item as Message & { aeonStepId?: string }).aeonStepId).filter((id): id is string => typeof id === 'string'));
      const records = new Map<string, PhysicalRequest>();
      const started = new Map<string, number>();
      let currentFragments = fragments;
      const transport = (provider === 'openai' ? createOpenAITransport : createMistralTransport)({ ...options,
        async reserve(attempt: Attempt) {
          const begun = environment.monotonicNow();
          const source = attempt.purpose === 'compaction' ? '[]' : JSON.stringify(tools);
          const artifact = attempt.purpose === 'compaction' ? options.toolInstructions.compaction : options.toolInstructions.tools;
          invariant(artifact && artifact.sha256 === digest(source) && artifact.uri === `aeon:artifact:${artifact.sha256}`, 'Tool instruction artifact does not match effective tools');
          const toolFragment: PromptFragment = { id: 'shell.tools', owner: 'tool', role: 'tool', order: Math.max(-1, ...currentFragments.map(fragment => fragment.order)) + 1, artifact, scope: input.run.scope, replaceable: true, derivedFrom: [] };
          invariant(await resolve(toolFragment) === source, 'Retained tool instruction bytes changed');
          const manifest: PromptManifest = { id: `${input.prompt.id}:${attempt.id}`, fragments: [...currentFragments, toolFragment], requestDigest: attempt.digest };
          validatePromptManifest(manifest);
          await bridge.capturePrompt(manifest, attempt.payload);
          const request: PhysicalRequest = { id: attempt.id, runId: input.run.id, purpose: attempt.purpose, provider, model: attempt.model, promptManifestId: manifest.id, requestDigest: attempt.digest, reservationId: `request:${attempt.id}`, status: 'reserved', usage: options.reservationEstimate?.(attempt) ?? { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
          await bridge.reserve(request); records.set(attempt.id, request); started.set(attempt.id, begun);
        },
        async dispatched(attempt: Attempt) { await bridge.dispatched({ ...records.get(attempt.id)!, status: 'dispatched' }); },
        async settle(attempt: Attempt, outcome: AttemptOutcome) {
          const request = records.get(attempt.id)!;
          const failures: unknown[] = [];
          let elapsedMs = request.usage.elapsedMs;
          try { elapsedMs = environment.monotonicNow() - started.get(attempt.id)!; }
          catch (error) { failures.push(error); }
          const uncertain = failures.length > 0 || outcome.status === 'uncertain';
          try { await bridge.settle({ ...request, status: uncertain ? 'uncertain' : outcome.status === 'completed' ? 'succeeded' : 'failed', usage: { requests: 1, inputTokens: uncertain ? null : outcome.usage?.inputTokens ?? null, outputTokens: uncertain ? null : outcome.usage?.outputTokens ?? null, costUsd: null, elapsedMs } }); }
          catch (error) { failures.push(error); }
          throwShellFailures(failures);
        },
      });
      function requireRequestSlice(nextPurpose: Attempt['purpose']): void {
        signal?.throwIfAborted();
        // This runs outside the transport/Pi assistant stream: no request was
        // reserved and no failed assistant reply is invented at a slice boundary.
        if (transport.attempts() >= options.maxRequests) throw new PhysicalRequestSliceExhausted(transport.attempts(), options.maxRequests, nextPurpose);
      }
      async function execute(call: { id: string; name: string; arguments: unknown }, assistantIndex: number): Promise<Observation> {
        invariant(!halted, 'Shell halted pending reconciliation');
        signal?.throwIfAborted();
        const assistant = transcript[assistantIndex] as Message & { aeonStepId?: string };
        invariant(typeof assistant?.aeonStepId === 'string', 'Assistant lacks durable step identity');
        const stepId = `${input.run.id}:assistant:${assistant.aeonStepId}`;
        const observation = await bridge.execute({ id: `${stepId}:${call.id}`, runId: input.run.id, stepId, name: call.name, arguments: json(call.arguments) }, signal);
        validateObservation(observation);
        invariant(observation.runId === input.run.id && observation.stepId === stepId && observation.sourceId === `${stepId}:${call.id}`, 'Tool observation does not match dispatched call');
        if (observation.kind === 'uncertain') { halted = true; status = 'blocked'; failure = { stage: 'tool', reason: 'Tool outcome is uncertain; durable reconciliation required.' }; }
        else { observations.push(observation); if (!observationIds.includes(observation.id)) observationIds.push(observation.id); }
        return observation;
      }
      const wrapped: AgentTool[] = tools.map(tool => ({ ...tool, label: tool.name, executionMode: 'sequential', async execute(id, args) {
        try {
          const assistantIndex = transcript.findLastIndex(item => item.role === 'assistant');
          const observation = await execute({ id, name: tool.name, arguments: args }, assistantIndex);
          if (halted) return { content: [{ type: 'text', text: 'Tool outcome is uncertain; reconciliation required.' }], details: null, isError: true, terminate: true };
          if (observation.kind === 'result' && handoffTools.has(tool.name)) handedOff = true;
          return { content: [{ type: 'text', text: canonicalJson(observation.value) }], details: null, isError: observation.kind === 'error' };
        } catch (error) { halted = true; status = signal?.aborted ? 'cancelled' : 'blocked'; failure = { stage: 'tool', reason: signal?.aborted ? 'Tool execution cancelled; reconcile dispatched effects.' : 'Tool receiver failed; inspect durable effect records before continuation.' }; throw error; }
      } }));
      const system = () => ({ role: 'system' as const, content: basePrompt, toolsAdded: tools, timestamp: 0 });
      async function emit(event: AgentEvent): Promise<void> {
        if (event.type !== 'message_end' || event.message.role === 'system') return;
        if (event.message.role === 'toolResult' && halted) return;
        const completed = structuredClone(event.message) as Message & { aeonStepId?: string };
        if (completed.role === 'assistant') {
          const id = environment.newId(); invariant(!stepIds.has(id), 'Duplicate assistant step identity');
          stepIds.add(id); completed.aeonStepId = id;
        }
        if (completed.role === 'toolResult') completed.aeonStepId = (transcript.findLast(item => item.role === 'assistant') as Message & { aeonStepId?: string })?.aeonStepId;
        transcript.push(completed);
        await save(); // completed assistant/tool observations become durable before subsequent dispatch
      }
      try {
        // Recovery must validate the native response before any pending tool effect,
        // including checkpoints produced by an incompatible or corrupt projection.
        if (provider === 'openai') for (const item of continuationMessages()) {
          if (item.role !== 'assistant') continue;
          invariant(item.provider === 'openai' && item.openaiOutput, 'Invalid OpenAI assistant history');
          const parsed = completedOpenAIOutput(item.openaiOutput);
          invariant(identity(parsed.content) === identity(item.content), 'Invalid OpenAI assistant projection');
          invariant(item.stopReason === (parsed.content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop'), 'Invalid OpenAI assistant stop reason');
        }
        if (status === 'completed' && input.messages.length === 0) return { status: 'completed', checkpoint: input.checkpoint, observations };
        const last = transcript.at(-1);
        if (status !== 'checkpointed' && input.checkpoint && input.messages.length === 0 && last?.role === 'assistant' && last.stopReason === 'stop') {
          status = 'completed'; await save(); return { status, checkpoint, observations };
        }
        status = 'running';
        // Reconstruct pending tools after a crash. The receiver deduplicates/reconciles stable call IDs.
        const resultKey = (item: Message & { aeonStepId?: string }, id: string) => `${item.aeonStepId}:${id}`;
        const results = new Set(transcript.filter(item => item.role === 'toolResult').map(item => resultKey(item, item.toolCallId)));
        for (let index = 0; index < transcript.length; index++) {
          const item = transcript[index]; if (item.role !== 'assistant' || ['error', 'aborted', 'length'].includes(item.stopReason)) continue;
          for (const call of item.content.filter(block => block.type === 'toolCall')) {
            if (results.has(resultKey(item, call.id))) continue;
            const declaration = tools.find(tool => tool.name === call.name);
            invariant(declaration, 'Pending tool is unavailable in successor');
            invariant(item.stopReason === 'toolUse', 'Truncated or incomplete tools cannot replay');
            const args = validateToolArguments(declaration, call);
            const observation = await execute({ ...call, arguments: args }, index);
            if (halted) { await save(); return { status: 'blocked', checkpoint, observations }; }
            transcript.push(toolResult(call, observation, (item as Message & { aeonStepId: string }).aeonStepId, environment.wallNow)); results.add(resultKey(item, call.id)); await save();
          }
        }
        const model = provider === 'openai' ? openaiModel(options.model!, options.modelProfile) : mistralModel(options.model, options.modelProfile);
        stage = 'model';
        await runAgentLoopContinue({ messages: [system(), ...continuationMessages()], tools: wrapped }, {
          model, clock: environment, convertToLlm: messages => modelMessages(messages), toolExecution: 'sequential',
          getSteeringMessages: options.steering ? async () => (await options.steering!()).filter(item => item.role !== 'system') : undefined,
          finishTurn: ({ message }) => {
            // Called only after the entire current assistant batch. Recovery of
            // an older enqueue is not a fresh handoff and must consume new input.
            if (handedOff && !halted) signal?.throwIfAborted();
            return halted || handedOff || message.stopReason === 'length' ? { action: 'end' } : undefined;
          },
          async prepareRequest() {
            signal?.throwIfAborted();
            if (options.compaction && (transcript.length > options.compaction.thresholdMessages || options.compaction.thresholdBytes !== undefined && Buffer.byteLength(canonicalJson(json(modelMessages([system(), ...continuationMessages()])))) > options.compaction.thresholdBytes)) {
              let boundary = Math.max(0, transcript.length - options.compaction.retainMessages);
              if (provider === 'mistral') boundary = mistralCompactionBoundary(transcript, boundary, continuationMessages());
              else while (boundary > 0 && transcript[boundary].role === 'toolResult') boundary--;
              const prefix = transcript.slice(0, boundary); const suffix = transcript.slice(boundary);
              // Stateless OpenAI native reasoning/calls cannot be discarded by a prose summary.
              // Compact only when user-history reduction actually removes entries.
              const retainedNative = provider === 'openai' ? prefix.filter(item => item.role === 'assistant' || item.role === 'toolResult') : [];
              if (prefix.length - retainedNative.length > (provider === 'openai' ? 1 : 0)) {
                requireRequestSlice('compaction');
                stage = 'compaction';
                const fragment = options.compaction.instruction; const instruction = await resolve(fragment);
                currentFragments = [...fragments, { ...fragment, order: Math.max(-1, ...fragments.map(item => item.order)) + 1 }];
                transport.setPurpose('compaction');
                const summary = await (await transport.stream(model, normalizeContext({ messages: [{ role: 'system', content: `${basePrompt}\n\n${instruction}`, timestamp: 0 }, { role: 'user', content: canonicalJson(json(modelMessages(prefix))), timestamp: environment.wallNow() }] }), { signal })).result();
                currentFragments = fragments; transport.setPurpose('reasoning');
                if (summary.stopReason !== 'stop' || summary.content.some(block => block.type === 'toolCall')) {
                  rejectedCompactions.push({ sourceDigest: identity(json(prefix)), summary: structuredClone(summary) });
                  throw new Error('Compaction failed; original context retained');
                }
                compactions.push({ sourceDigest: identity(json(prefix)), summary: structuredClone(summary) });
                transcript = [{ role: 'user', content: summary.content.filter(block => block.type === 'text'), timestamp: environment.wallNow() }, ...retainedNative, ...suffix];
                await save();
                stage = 'model';
              }
            }
            requireRequestSlice('reasoning');
            return { context: { messages: [system(), ...continuationMessages()], tools: wrapped } };
          },
        }, emit, signal, transport.stream);
        const final = transcript.findLast(item => item.role === 'assistant');
        status = halted ? status : final?.role === 'assistant' && final.stopReason === 'aborted' ? 'cancelled' : final?.role === 'assistant' && (final.stopReason === 'error' || final.stopReason === 'length') ? 'blocked' : 'completed';
        if (!halted && final?.role === 'assistant' && status !== 'completed') failure = { stage: 'model', reason: final.errorMessage ?? 'Model output reached its limit; truncated calls were not executed.' };
      } catch (error) {
        if (error instanceof PhysicalRequestSliceExhausted && !signal?.aborted && !halted) {
          status = 'checkpointed'; continuation = error.continuation;
        } else {
          status = signal?.aborted ? 'cancelled' : 'blocked';
          const safeReasons = ['Compaction failed; original context retained', 'Pending tool is unavailable in successor', 'Truncated or incomplete tools cannot replay', 'Assistant lacks durable step identity', 'Tool observation does not match dispatched call'];
          failure ??= { stage, reason: error instanceof Error && safeReasons.includes(error.message) ? error.message : signal?.aborted ? 'Shell cancelled; inspect durable dispatched records.' : 'Shell boundary failed; inspect durable request, checkpoint and effect records.' };
        }
      }
      await save();
      return { status: status === 'running' ? 'checkpointed' : status, checkpoint, observations };
    },
  };
}
