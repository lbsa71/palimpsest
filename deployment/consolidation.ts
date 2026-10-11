import { identity, invariant, type Authority, type JsonValue } from '../packages/contracts/index.ts';
import { DevelopmentalMemory, type ClaimedJob, type Derivation } from '../packages/development/index.ts';
import { DurableRuntime } from '../packages/runtime/index.ts';
import type { ApplicationTool } from './application.ts';

/** A durable claim is bound to one accounted runtime identity and one completion capability. */
export class AccountedConsolidation {
  readonly memory: DevelopmentalMemory; readonly runtime: DurableRuntime; readonly authority: Authority;
  constructor(memory: DevelopmentalMemory, runtime: DurableRuntime, authority: Authority) { this.memory = memory; this.runtime = runtime; this.authority = authority; }
  claim(runId: string): ClaimedJob | undefined { return this.runtime.store.get<ClaimedJob>('host.consolidation-runs', runId)?.value; }
  start(leaseMs: number): string | undefined {
    return this.runtime.store.transaction(() => {
    const claim = this.memory.claimConsolidation(this.authority.generation, leaseMs);
    if (!claim) return undefined;
    const sources = this.memory.consolidationSources(claim);
    const envelope = this.runtime.store.get<{ envelope: import('../packages/contracts/index.ts').ResourceEnvelope }>('allocations', 'initiative:ordinary')!.value.envelope;
    const run = this.runtime.admit({ id: `consolidation:${claim.job.id}:${claim.job.revision}`, source: 'consolidation', externalId: claim.job.id, externalRevision: String(claim.job.revision), actorId: this.authority.generation, authenticated: true, scope: claim.job.scope,
      value: JSON.parse(JSON.stringify({ consolidation: { jobId: claim.job.id, sourceIds: claim.job.sourceIds, sources, requirement: 'Interpret these attributed sources, preserve uncertainty and correction links, and complete through memory_consolidation_complete.' } })) }, this.authority, envelope, 'initiative:ordinary');
    this.runtime.store.put('host.consolidation-runs', run.id, claim, null);
    return run.id;
    });
  }
  tools(runId: string): ApplicationTool[] {
    const claim = this.claim(runId); if (!claim) return [];
    return [{ name: 'memory_consolidation_complete', description: 'Complete this claimed consolidation using only its assigned sources and audience. Attribution, source IDs, timestamps and output IDs come from the host.',
      inputSchema: { type: 'object', properties: { outputs: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', properties: { kind: { enum: ['interpretation', 'belief', 'procedure', 'relationship', 'self-description'] }, content: {}, confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] }, supersedes: { type: 'array', items: { type: 'string' } }, contradictions: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'content', 'confidence'], additionalProperties: false } } }, required: ['outputs'], additionalProperties: false },
      execute: (args: JsonValue) => {
        invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 1 && Array.isArray(args.outputs) && args.outputs.length > 0 && args.outputs.length <= 16, 'Invalid consolidation output');
        const output = args.outputs.map((value, index) => {
          invariant(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => ['kind', 'content', 'confidence', 'supersedes', 'contradictions'].includes(key)), 'Invalid consolidation record');
          invariant(typeof value.kind === 'string' && value.content !== undefined && (value.confidence === null || typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1), 'Invalid consolidation content');
          const links = (field: JsonValue | undefined): string[] => { invariant(field === undefined || Array.isArray(field) && field.every(id => typeof id === 'string' && claim.job.sourceIds.includes(id)), 'Invalid consolidation correction'); return field as string[] ?? []; };
          return { id: `consolidated:${identity({ id: claim.job.id, revision: claim.job.revision, index })}`, kind: value.kind as Derivation['kind'], content: value.content, confidence: value.confidence,
            sourceIds: claim.job.sourceIds, scope: claim.job.scope, actorId: this.authority.generation, at: new Date().toISOString(), supersedes: links(value.supersedes), contradictions: links(value.contradictions) };
        });
        return this.memory.completeConsolidation(claim, output);
      } }];
  }
  finish(runId: string): void {
    const claim = this.claim(runId); if (!claim) return;
    const current = this.memory.jobs(claim.job.scope).find(job => job.id === claim.job.id);
    if (current?.revision === claim.job.revision && current.state === 'running' && Date.parse(current.lease!.until) > Date.now()) this.memory.failConsolidation(claim);
  }
}
