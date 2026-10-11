import { invariant, nonempty, scopeAllows, validateProvenance } from '../../contracts/index.ts';
import type { DataScope, Drive, Goal, JsonValue, Provenance } from '../../contracts/index.ts';
import type { DevelopmentalMemory } from '../../development/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { InitiativeRegistry } from '../goals/index.ts';
export const growthDimensions = ['judgment', 'curiosity', 'code-quality', 'capability'] as const;
export type GrowthDimension = typeof growthDimensions[number];
export interface AdoptedDrive extends Drive { scope: DataScope; reason: string; weight: number }
export interface InquiryOpportunity { id: string; driveId: string; scope: DataScope; sourceIds: string[]; question: string; observationAction: string; successCriteria: string[]; reason: string; priority: number; status: 'available' | 'selected' | 'retired'; goalId: string | null }
/** The four dimensions orient choice; no interests, preferences or inquiry questions are seeded. */
export class DriveRegistry {
  readonly store: OperationalStore; readonly memory: DevelopmentalMemory;
  constructor(store: OperationalStore, memory: DevelopmentalMemory) { this.store = store; this.memory = memory; }
  adopt(input: Omit<AdoptedDrive, 'revision'>, expected: number | null): AdoptedDrive {
    return this.store.transaction(() => {
    invariant(growthDimensions.includes(input.dimension as GrowthDimension), 'standing drive must use growth dimension');
    nonempty(input.purpose, 'drive purpose'); nonempty(input.reason, 'drive reason'); validateProvenance(input.provenance);
    invariant(Number.isFinite(input.weight) && input.weight > 0 && input.weight <= 100, 'invalid drive weight');
    input.provenance.sourceIds.forEach(id => invariant(this.memory.get(id, input.scope), 'drive needs available experience evidence'));
    const old = this.store.get<AdoptedDrive>('initiative.drives', input.id)?.value;
    if (old) invariant(old.dimension === input.dimension && scopeAllows(old.scope, input.scope) && scopeAllows(input.scope, old.scope), 'drive dimension/audience immutable');
    const drive = { ...input, revision: (expected ?? 0) + 1 }; this.store.put('initiative.drives', input.id, drive, expected);
    this.store.put('initiative.drive-history', `${input.id}:${drive.revision}`, drive, null); return drive;
    });
  }
  adopted(audience: DataScope): AdoptedDrive[] { return this.store.list<AdoptedDrive>('initiative.drives').map(row => row.value).filter(drive => drive.active && scopeAllows(drive.scope, audience) && drive.provenance.sourceIds.every(id => this.memory.get(id, audience))); }
  coverage(audience: DataScope): { adopted: GrowthDimension[]; missing: GrowthDimension[] } { const adopted = growthDimensions.filter(dimension => this.adopted(audience).some(drive => drive.dimension === dimension)); return { adopted, missing: growthDimensions.filter(dimension => !adopted.includes(dimension)) }; }
  offer(input: Omit<InquiryOpportunity, 'status' | 'goalId'>): InquiryOpportunity {
    const drive = this.adopted(input.scope).find(drive => drive.id === input.driveId); invariant(drive, 'inquiry requires adopted drive');
    nonempty(input.question, 'concrete inquiry'); nonempty(input.observationAction, 'observation action'); nonempty(input.reason, 'experience-derived reason');
    invariant(input.sourceIds.length > 0 && new Set(input.sourceIds).size === input.sourceIds.length, 'inquiry needs unique sources'); input.sourceIds.forEach(id => invariant(this.memory.get(id, input.scope), 'inquiry source unavailable'));
    invariant(input.successCriteria.length > 0 && input.successCriteria.every(s => typeof s === 'string' && s.trim()), 'inquiry needs criteria'); invariant(Number.isFinite(input.priority), 'invalid inquiry priority');
    const opportunity: InquiryOpportunity = { ...input, status: 'available', goalId: null }; this.store.put('initiative.opportunities', input.id, opportunity, null); return opportunity;
  }
  opportunities(audience: DataScope): InquiryOpportunity[] {
    const drives = new Map(this.adopted(audience).map(drive => [drive.id, drive]));
    return this.store.list<InquiryOpportunity>('initiative.opportunities').map(row => row.value).filter(o => o.status === 'available' && scopeAllows(o.scope, audience) && drives.has(o.driveId) && o.sourceIds.every(id => this.memory.get(id, audience)))
      .sort((a, b) => (b.priority * drives.get(b.driveId)!.weight) - (a.priority * drives.get(a.driveId)!.weight) || a.id.localeCompare(b.id));
  }
  select(id: string, registry: InitiativeRegistry, goal: Omit<Goal, 'revision' | 'status' | 'origin' | 'purpose' | 'scope' | 'successCriteria' | 'evidenceIds' | 'nextAction'>, actorId: string, at: string): Goal {
    return this.store.transaction(() => {
      const row = this.store.get<InquiryOpportunity>('initiative.opportunities', id); invariant(row && this.opportunities(row.value.scope).some(o => o.id === id), 'opportunity unavailable'); const o = row.value;
      const result = registry.propose({ ...goal, origin: { kind: 'self' }, purpose: o.question, scope: o.scope, successCriteria: o.successCriteria, evidenceIds: o.sourceIds, nextAction: o.observationAction }, { sourceIds: o.sourceIds, actorId, recordedAt: at, derivation: 'interpreted' });
      this.store.put('initiative.opportunities', id, { ...o, status: 'selected', goalId: result.id }, row.revision); return result;
    });
  }
}
