import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identity, invariant, scopeAllows, type Authority, type DataScope, type JsonValue } from '../packages/contracts/index.ts';
import { admitCandidate, type AdmissionPolicy, type AdmissionReceipt } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import type { ReleaseProof } from '../packages/release/controller.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { ApplicationTool } from './application.ts';
import type { EvolutionContext } from './evolution-tools.ts';

export const handoffCases = ['E1', 'E2', 'E3', 'E4', 'E5', 'codex-parity', 'claude-parity', 'H1-continuity', 'H1-plan-execution'] as const;
interface HandoffRecord { candidateId: string; controls: string; scope: DataScope; acceptedAt: string; admission: AdmissionReceipt; proofArtifact: { uri: string; sha256: string } }
/** Host witness entrypoint; model tools cannot call it or supply evaluator keys/policy. */
export function acceptHandoff(options: { store: OperationalStore; artifactStore: string; authority: Authority; candidateId: string; scope: DataScope; policy: AdmissionPolicy; proof: ReleaseProof; readArtifact(uri: string): Uint8Array }): HandoffRecord {
  invariant(options.policy.kind === 'product' && handoffCases.every(id => options.policy.requiredCases.includes(id)), 'H1 requires all declared capability, comparison and continuity cases under product policy');
  invariant(options.proof.proposal.candidate.id === options.candidateId, 'Handoff must bind the currently qualified candidate');
  const receipt = admitCandidate(options.artifactStore, options.proof.proposal, options.authority, options.policy, options.proof.signed, options.readArtifact);
  const record: HandoffRecord = { candidateId: options.candidateId, controls: options.authority.controlRevision, scope: structuredClone(options.scope), acceptedAt: new Date().toISOString(), admission: receipt,
    proofArtifact: options.store.putJsonArtifact(JSON.parse(JSON.stringify(options.proof)) as JsonValue) };
  options.store.transaction(() => { const old = options.store.get<HandoffRecord>('host.handoff', 'H1'); options.store.put('host.handoff', 'H1', record, old?.revision ?? null); });
  return record;
}
interface TaskPack { schema: string; aeon: string; entry: string; status: string; runtimeRouting: string; lanes: { id: string; source: string; sourceSha256: string; slashGoal: string; entryCapabilities: string[]; tasks: { id: string }[] }[] }
/** Reads only accepted source-owned planning content and host-authenticated qualification state. */
export function handoffTools(context: EvolutionContext, options: { applicationRoot: string; artifactId: string }): ApplicationTool[] {
  const qualification = () => {
    const record = context.store.get<HandoffRecord>('host.handoff', 'H1')?.value;
    if (!record || !scopeAllows(record.scope, context.scope)) return { status: 'unaccepted', reason: 'No independently admitted H1 witness is available for this audience.' };
    if (record.candidateId !== options.artifactId || record.controls !== context.authority.controlRevision) return { status: 'unaccepted', reason: 'Prior H1 witness targets a different source or control identity.' };
    invariant(identity(record.admission.priorAuthority) === identity(context.authority) || record.admission.priorAuthority.controlRevision === context.authority.controlRevision, 'Handoff controls changed');
    return { status: 'accepted', witness: record };
  };
  return [{ name: 'handoff_inspect', description: 'Inspect the host-authenticated H1 qualification for this exact release. Implemented tools and engineering fixtures alone do not accept operational Aeon 2.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute(args) {
      invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0, 'No handoff inspection arguments');
      return { candidateId: options.artifactId, controls: context.authority.controlRevision, handoff: qualification(), requiredCases: [...handoffCases] };
    } }, {
    name: 'handoff_plan', description: 'Read the versioned Aeon 2 lane/task pack, with finite slash goals, dependencies, write ownership, delegation roles and acceptance criteria. Preparation is available before H1; this plan grants no effects or resources.',
    inputSchema: { type: 'object', properties: { lane: { enum: ['A2-L01', 'A2-L02', 'A2-L03', 'A2-L04', 'A2-L05'] } }, additionalProperties: false }, execute(args) {
      invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(key => key === 'lane') && (args.lane === undefined || typeof args.lane === 'string' && /^A2-L0[1-5]$/.test(args.lane)), 'Known Aeon 2 lane required');
      const bytes = readFileSync(join(options.applicationRoot, 'deployment/aeon-2-task-pack.json'));
      invariant(bytes.length <= 262144, 'Task pack exceeds bounded tool response');
      const pack = JSON.parse(bytes.toString('utf8')) as TaskPack;
      invariant(pack.schema === 'aeon-task-pack-v1' && pack.lanes.length === 5, 'Unknown task pack');
      const lanes = pack.lanes.filter(lane => args.lane === undefined || args.lane === lane.id);
      for (const lane of lanes) {
        invariant(/^A2-L0[1-5]$/.test(lane.id) && lane.source === `docs/rewrite/lanes/${lane.id}.md` && lane.slashGoal.startsWith('/goal '), 'Invalid lane source or finite goal');
        invariant(hashBytes(readFileSync(join(options.applicationRoot, lane.source))) === lane.sourceSha256, 'Task pack differs from source lane specification');
      }
      return { ...pack, lanes, artifactSha256: hashBytes(bytes), handoff: qualification(), taskState: 'Planning proposals; accepted runtime plans and goals remain in the revisioned initiative registry.' };
    },
  }];
}
