import { randomUUID } from 'node:crypto';
import { canonicalJson, identity, invariant, scopeAllows, validateCheckpoint, validateObservation, validatePromptManifest, validateRun } from '../contracts/index.ts';
import type { JsonValue, Observation, PhysicalRequest, PromptFragment, PromptManifest, ResourceUsage, ShellBridge, ShellCheckpoint, ShellInput, ShellPort } from '../contracts/index.ts';
import { runAgentLoopContinue } from './vendor/pi/agent/agent-loop.ts';
import type { AgentEvent, AgentTool } from './vendor/pi/agent/types.ts';
import { normalizeContext, validateToolArguments } from './vendor/pi/ai/index.ts';
import type { Message, Tool, ToolResultMessage } from './vendor/pi/ai/types.ts';
import { asJson, createMistralTransport, digest, mistralModel } from './mistral.ts';
import type { Attempt, AttemptOutcome, MistralTransportOptions } from './mistral.ts';
export { DEFAULT_MISTRAL_MODEL, createMistralTransport, mistralModel, mistralPayload } from './mistral.ts';
export type { Attempt, AttemptOutcome } from './mistral.ts';

export const SHELL_REVISION = 'pi-89e5c2c/aeon-bridge-v1';
export interface ShellOptions extends Omit<MistralTransportOptions, 'reserve' | 'dispatched' | 'settle'> {
  resolveFragment(fragment: PromptFragment): Promise<string>;
  tools: Tool[];
  steering?: () => Promise<Message[]>;
  /** Explicit conservative host ceiling; unknown defaults require a runtime per-request ceiling. */
  reservationEstimate?: (attempt: Attempt) => ResourceUsage;
  compaction?: { thresholdMessages: number; retainMessages: number; instruction: PromptFragment };
}
interface Snapshot { schema: typeof SHELL_REVISION; messages: Message[]; observationIds: string[]; status: 'running' | 'completed' | 'blocked' | 'cancelled' }
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
function toolResult(call: { id: string; name: string }, observation: Observation): ToolResultMessage {
  return { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: canonicalJson(observation.value) }], isError: observation.kind === 'error', timestamp: Date.now() };
}

/** Pi is a projection over the durable receiver: this adapter never directly executes a tool. */
export function createAgentShell(options: ShellOptions): ShellPort {
  invariant(new Set(options.tools.map(tool => tool.name)).size === options.tools.length, 'Duplicate shell tools');
  if (options.compaction) invariant(Number.isSafeInteger(options.compaction.thresholdMessages) && Number.isSafeInteger(options.compaction.retainMessages) && options.compaction.retainMessages >= 1 && options.compaction.thresholdMessages > options.compaction.retainMessages + 2, 'Invalid context budget');
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
      let status: Snapshot['status'] = 'running';
      if (input.checkpoint) {
        validateCheckpoint(input.checkpoint, input.run);
        invariant(input.checkpoint.shell === SHELL_REVISION, 'Unsupported shell checkpoint revision');
        const content = await bridge.readCheckpoint(input.checkpoint);
        invariant(identity(content) === input.checkpoint.artifact.sha256, 'Checkpoint artifact digest mismatch');
        invariant(typeof content === 'object' && content !== null && !Array.isArray(content), 'Invalid checkpoint content');
        const snapshot = content as unknown as Snapshot;
        invariant(snapshot.schema === SHELL_REVISION && Array.isArray(snapshot.messages) && Array.isArray(snapshot.observationIds), 'Invalid checkpoint schema');
        transcript = snapshot.messages.map(value => message(json(value)));
        invariant(snapshot.observationIds.every(id => typeof id === 'string') && identity(snapshot.observationIds) === identity(input.checkpoint.observationIds), 'Checkpoint observation index mismatch');
        observationIds = [...snapshot.observationIds];
        status = snapshot.status;
      }
      transcript.push(...input.messages.map(message));
      // Replace every historical application system layer; reintroduce only the current manifest.
      transcript = transcript.filter(item => item.role !== 'system');
      async function save(): Promise<void> {
        const content = json({ schema: SHELL_REVISION, messages: transcript, observationIds, status });
        checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, SHELL_REVISION, content);
        validateCheckpoint(checkpoint, input.run);
        invariant(checkpoint.shell === SHELL_REVISION && checkpoint.artifact.sha256 === identity(content), 'Checkpoint receiver returned another artifact');
        invariant(identity(checkpoint.observationIds) === identity(observationIds), 'Checkpoint receiver omitted observation IDs');
      }
      const records = new Map<string, PhysicalRequest>();
      const started = new Map<string, number>();
      let currentFragments = fragments;
      const transport = createMistralTransport({ ...options,
        async reserve(attempt: Attempt) {
          const toolFragment: PromptFragment = { id: 'shell.tools', owner: 'tool', role: 'tool', order: Math.max(-1, ...currentFragments.map(fragment => fragment.order)) + 1, artifact: { uri: `shell:tools:${digest(JSON.stringify(tools))}`, sha256: digest(JSON.stringify(tools)) }, scope: input.run.scope, replaceable: true, derivedFrom: [] };
          const manifest: PromptManifest = { id: `${input.prompt.id}:${attempt.id}`, fragments: [...currentFragments, toolFragment], requestDigest: attempt.digest };
          validatePromptManifest(manifest);
          await bridge.capturePrompt(manifest, attempt.payload);
          const request: PhysicalRequest = { id: attempt.id, runId: input.run.id, purpose: attempt.purpose, provider: 'mistral', model: attempt.model, promptManifestId: manifest.id, requestDigest: attempt.digest, reservationId: `request:${attempt.id}`, status: 'reserved', usage: options.reservationEstimate?.(attempt) ?? { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
          await bridge.reserve(request); records.set(attempt.id, request); started.set(attempt.id, performance.now());
        },
        async dispatched(attempt: Attempt) { await bridge.dispatched({ ...records.get(attempt.id)!, status: 'dispatched' }); },
        async settle(attempt: Attempt, outcome: AttemptOutcome) {
          const request = records.get(attempt.id)!;
          await bridge.settle({ ...request, status: outcome.status === 'completed' ? 'succeeded' : outcome.status === 'uncertain' ? 'uncertain' : 'failed', usage: { requests: 1, inputTokens: outcome.usage?.inputTokens ?? null, outputTokens: outcome.usage?.outputTokens ?? null, costUsd: null, elapsedMs: performance.now() - started.get(attempt.id)! } });
        },
      });
      async function execute(call: { id: string; name: string; arguments: unknown }, assistantIndex: number): Promise<Observation> {
        invariant(!halted, 'Shell halted pending reconciliation');
        signal?.throwIfAborted();
        const assistant = transcript[assistantIndex] as Message & { aeonStepId?: string };
        invariant(typeof assistant?.aeonStepId === 'string', 'Assistant lacks durable step identity');
        const stepId = `${input.run.id}:assistant:${assistant.aeonStepId}`;
        const observation = await bridge.execute({ id: `${stepId}:${call.id}`, runId: input.run.id, stepId, name: call.name, arguments: json(call.arguments) }, signal);
        validateObservation(observation);
        invariant(observation.runId === input.run.id && observation.stepId === stepId && observation.sourceId === `${stepId}:${call.id}`, 'Tool observation does not match dispatched call');
        if (observation.kind === 'uncertain') { halted = true; status = 'blocked'; }
        else { observations.push(observation); if (!observationIds.includes(observation.id)) observationIds.push(observation.id); }
        return observation;
      }
      const wrapped: AgentTool[] = tools.map(tool => ({ ...tool, label: tool.name, executionMode: 'sequential', async execute(id, args) {
        try {
          const assistantIndex = transcript.findLastIndex(item => item.role === 'assistant');
          const observation = await execute({ id, name: tool.name, arguments: args }, assistantIndex);
          if (halted) return { content: [{ type: 'text', text: 'Tool outcome is uncertain; reconciliation required.' }], details: null, isError: true, terminate: true };
          return { content: [{ type: 'text', text: canonicalJson(observation.value) }], details: null, isError: observation.kind === 'error' };
        } catch (error) { halted = true; status = signal?.aborted ? 'cancelled' : 'blocked'; throw error; }
      } }));
      const system = () => ({ role: 'system' as const, content: basePrompt, toolsAdded: tools, timestamp: 0 });
      async function emit(event: AgentEvent): Promise<void> {
        if (event.type !== 'message_end' || event.message.role === 'system') return;
        if (event.message.role === 'toolResult' && halted) return;
        const completed = structuredClone(event.message) as Message & { aeonStepId?: string };
        if (completed.role === 'assistant') completed.aeonStepId = randomUUID();
        transcript.push(completed);
        await save(); // completed assistant/tool observations become durable before subsequent dispatch
      }
      try {
        if (status === 'completed' && input.messages.length === 0) return { status: 'completed', checkpoint: input.checkpoint, observations };
        status = 'running';
        // Reconstruct pending tools after a crash. The receiver deduplicates/reconciles stable call IDs.
        const results = new Set(transcript.filter(item => item.role === 'toolResult').map(item => item.toolCallId));
        for (let index = 0; index < transcript.length; index++) {
          const item = transcript[index]; if (item.role !== 'assistant') continue;
          for (const call of item.content.filter(block => block.type === 'toolCall')) {
            if (results.has(call.id)) continue;
            const declaration = tools.find(tool => tool.name === call.name);
            invariant(declaration, 'Pending tool is unavailable in successor');
            invariant(item.stopReason === 'toolUse', 'Truncated or incomplete tools cannot replay');
            const args = validateToolArguments(declaration, call);
            const observation = await execute({ ...call, arguments: args }, index);
            if (halted) { await save(); return { status: 'blocked', checkpoint, observations }; }
            transcript.push(toolResult(call, observation)); results.add(call.id); await save();
          }
        }
        const model = mistralModel(options.model);
        await runAgentLoopContinue({ messages: [system(), ...transcript], tools: wrapped }, {
          model, convertToLlm: messages => messages, toolExecution: 'sequential',
          getSteeringMessages: options.steering ? async () => (await options.steering!()).filter(item => item.role !== 'system') : undefined,
          finishTurn: () => halted ? { action: 'end' } : undefined,
          async prepareRequest() {
            signal?.throwIfAborted();
            if (options.compaction && transcript.length > options.compaction.thresholdMessages) {
              let boundary = transcript.length - options.compaction.retainMessages;
              while (boundary > 0 && transcript[boundary].role === 'toolResult') boundary--;
              const prefix = transcript.slice(0, boundary); const suffix = transcript.slice(boundary);
              if (prefix.length > 0) {
                const fragment = options.compaction.instruction; const instruction = await resolve(fragment);
                currentFragments = [...fragments, { ...fragment, order: Math.max(-1, ...fragments.map(item => item.order)) + 1 }];
                transport.setPurpose('compaction');
                const summary = await (await transport.stream(model, normalizeContext({ messages: [{ role: 'system', content: `${basePrompt}\n\n${instruction}`, timestamp: 0 }, { role: 'user', content: canonicalJson(json(prefix)), timestamp: Date.now() }] }), { signal })).result();
                currentFragments = fragments; transport.setPurpose('reasoning');
                invariant(summary.stopReason === 'stop' && summary.content.every(block => block.type === 'text'), 'Compaction failed; original context retained');
                transcript = [{ role: 'user', content: summary.content.filter(block => block.type === 'text'), timestamp: Date.now() }, ...suffix];
                await save();
              }
            }
            return { context: { messages: [system(), ...transcript], tools: wrapped } };
          },
        }, emit, signal, transport.stream);
        const final = transcript.findLast(item => item.role === 'assistant');
        status = halted ? status : final?.role === 'assistant' && final.stopReason === 'aborted' ? 'cancelled' : final?.role === 'assistant' && (final.stopReason === 'error' || final.stopReason === 'length') ? 'blocked' : 'completed';
      } catch { status = signal?.aborted ? 'cancelled' : 'blocked'; }
      await save();
      return { status: status === 'running' ? 'checkpointed' : status, checkpoint, observations };
    },
  };
}
