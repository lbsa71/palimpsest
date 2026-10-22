import { identity, invariant, type ArtifactRef, type Authority, type DataScope, type Effect, type JsonValue, type PhysicalRequest, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { DurableRuntime } from '../packages/runtime/index.ts';
import type { ApplicationTool } from './application.ts';

export interface SuccessionProbeRequest {
  id: string; bindingDigest: string; operationId: string; parentRunId: string; candidateId: string; authority: Authority; scope: DataScope; question: string;
}
interface ProbeRecord { request: SuccessionProbeRequest; status: 'pending' | 'running' | 'answered' | 'uncertain'; runId?: string; reply?: { effectId: string; response: string }; }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const ns = 'host.succession-probes', runs = 'host.succession-probe-runs';
export function enqueueSuccessionProbe(store: OperationalStore, request: SuccessionProbeRequest): void {
  invariant(request.question.length > 0 && request.question.length <= 8192, 'Bounded incumbent probation challenge required');
  store.transaction(() => {
    const previous = store.get<ProbeRecord>(ns, request.id);
    if (previous) { invariant(identity(previous.value.request) === identity(request), 'Probe identity reused'); return; }
    store.put(ns, request.id, { request, status: 'pending' } satisfies ProbeRecord, null);
  });
}
/** A mailbox probe runs THROUGH the serving AutarkApplication and its real frozen shell,
 * not through the isolated interview worker. Its tool surface has no production effects. */
export class SuccessionProbes {
  readonly options: { store: OperationalStore; runtime: DurableRuntime; candidateId: string; authority: Authority; resources: ResourceEnvelope; assertAuthority(): void };
  constructor(options: SuccessionProbes['options']) { this.options = Object.freeze({ ...options }); }
  isProbe(runId: string): boolean { return !!this.options.store.get(runs, runId); }
  prepare(): string[] {
    const { store, runtime, candidateId, authority } = this.options; const prepared: string[] = [];
    this.options.assertAuthority();
    for (const row of store.list<ProbeRecord>(ns)) {
      if (row.value.status !== 'pending' || row.value.request.candidateId !== candidateId) continue;
      try { store.transaction(() => {
        this.options.assertAuthority(); const request = row.value.request;
        invariant(identity(request.authority) === identity(authority), 'Probe targets another serving generation');
        const parent = runtime.getRun(request.parentRunId);
        invariant(parent && parent.status !== 'cancelled' && identity(parent.scope) === identity(request.scope), 'Probe parent unavailable or outside audience');
        const dialogue = store.get<{ phase: string; binding: { id: string } }>('host.succession-dialogues', request.operationId)?.value;
        invariant(dialogue?.phase === 'observing' && identity(dialogue.binding) === request.bindingDigest, 'Probe lacks actual observer probation');
        const run = runtime.admit({ id: request.id, source: 'host.succession-probe', externalId: request.id, externalRevision: '1', authenticated: true,
          actorId: `supervisor:${authority.generation}`, scope: request.scope, value: { question: request.question, candidateId, operationId: request.operationId,
            instruction: 'You are the real serving successor during supervised probation. Answer the incumbent challenge from actual current context. Only succession_probe_reply is available for this internal observation; no external speech or other effects. Do not claim checks you did not perform.' } }, authority, this.options.resources, request.parentRunId);
        invariant(!store.get(runs, run.id), 'Probe run already assigned');
        store.put(runs, run.id, { id: request.id }, null); store.put(ns, request.id, { ...row.value, status: 'running', runId: run.id }, row.revision);
        prepared.push(run.id);
      }); } catch {
        // A stale queued probe must not stall unrelated conversations on every tick.
        // Never redispatch it or reinterpret it as a demonstrated regression.
        const current = store.get<ProbeRecord>(ns, row.key);
        if (current?.value.status === 'pending') store.put(ns, row.key, { ...current.value, status: 'uncertain' }, current.revision);
      }
    }
    return prepared;
  }
  tools(runId: string, effectId?: string): ApplicationTool[] {
    const bound = this.options.store.get<{ id: string }>(runs, runId)?.value;
    if (!bound) return [];
    return [{ name: 'succession_probe_reply', description: 'Return your actual answer to the incumbent probation challenge. This is an internal supervised observation, not outward speech.',
      inputSchema: { type: 'object', properties: { response: { type: 'string', minLength: 1, maxLength: 8192 } }, required: ['response'], additionalProperties: false },
      execute: (args: JsonValue) => {
        this.options.assertAuthority(); invariant(effectId && args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).join(',') === 'response' && typeof args.response === 'string' && args.response.trim().length > 0 && args.response.length <= 8192, 'Exact bounded probe answer required');
        return this.options.store.transaction(() => {
          const row = this.options.store.get<ProbeRecord>(ns, bound.id)!;
          invariant(row.value.status === 'running' && row.value.runId === runId && row.value.request.candidateId === this.options.candidateId && identity(row.value.request.authority) === identity(this.options.authority), 'Wrong serving probe context');
          this.options.store.put(ns, bound.id, { ...row.value, status: 'answered', reply: { effectId, response: args.response as string } }, row.revision);
          return { recorded: true, probeId: bound.id };
        });
      } }];
  }
}
/** A reply is not a completed observation until its exact receiver and calling model
 * turn have settled. Lost replies remain unknown; reads never launch another model. */
export function readSuccessionProbe(store: OperationalStore, request: SuccessionProbeRequest): ArtifactRef | undefined {
  const row = store.get<ProbeRecord>(ns, request.id); invariant(row && identity(row.value.request) === identity(request), 'Probe binding changed');
  const record = row.value;
  if (record.status !== 'answered' || !record.reply || !record.runId) return undefined;
  const run = store.get<Run>('runs', record.runId)?.value;
  if (!run || run.status === 'running' || run.status === 'ready' || run.status === 'waiting') return undefined;
  invariant(run.status === 'completed' && identity(run.scope) === identity(request.scope) && identity(run.authority) === identity(request.authority), 'Probe run was cancelled, fenced or changed audience');
  const effect = store.get<Effect>('effects', record.reply.effectId)?.value;
  const physical = effect?.reservationId ? store.get<{ request: PhysicalRequest }>('requests', effect.reservationId)?.value.request : undefined;
  invariant(effect?.status === 'succeeded' && effect.kind === 'succession_probe_reply' && effect.runId === record.runId && identity(effect.scope) === identity(request.scope) &&
    identity(effect.authority) === identity(request.authority) && identity(effect.payload) === identity({ response: record.reply.response }) && physical?.status === 'succeeded' && physical.id === effect.id && physical.runId === record.runId && physical.reservationId === effect.reservationId &&
    physical.provider === 'effect-receiver' && physical.purpose === 'reasoning' && physical.model === effect.kind && physical.promptManifestId === effect.id &&
    physical.requestDigest === identity({ id: effect.id.slice(5), runId: effect.runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload }), 'Probe reply lacks settled serving execution');
  const responses = store.list<{ runId: string; scope: DataScope; httpStatus: number; response: ArtifactRef; requestId: string }>('host.model-responses').filter(response => response.value.runId === record.runId && identity(response.value.scope) === identity(request.scope) && response.key === response.value.requestId && response.value.httpStatus === 200);
  const witnessed = responses.find(response => {
    const modelRequest = store.get<{ request: PhysicalRequest }>('requests', response.value.requestId)?.value.request;
    if (modelRequest?.status !== 'succeeded' || modelRequest.runId !== record.runId || modelRequest.id !== response.value.requestId || modelRequest.purpose !== 'reasoning' || !['mistral', 'openai'].includes(modelRequest.provider)) return false;
    const body = store.readJsonArtifact<{ choices?: { finish_reason?: string; message?: { tool_calls?: { id: string; function: { name: string; arguments: string | object } }[] } }[] }>(response.value.response);
    return body.choices?.some(choice => choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.some(call => call.function.name === 'succession_probe_reply' && effect.id.endsWith(`:${call.id}`) &&
      identity(typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments) === identity(effect.payload)));
  });
  invariant(witnessed, 'Probe lacks an actual serving model answer');
  return store.putJsonArtifact(json({ bindingDigest: request.bindingDigest, candidateId: request.candidateId, serving: true, authority: request.authority,
    response: record.reply.response, runId: record.runId, effectId: effect.id, modelResponse: witnessed.value.response, physicalRequestId: witnessed.value.requestId }));
}
