import { identity, invariant, scopeAllows, type ArtifactRef, type Authority, type CandidateManifest, type DataScope, type JsonValue } from '../contracts/index.ts';
import type { OperationalStore } from '../storage/index.ts';

export type ChangeProvenance = { kind: 'human'; inputId: string; actorId: string } | { kind: 'self'; inputId: string; goalId: string; actorId: string };
export interface ChangeRecord {
  id: string; runId: string; scope: DataScope; authority: Authority;
  provenance: ChangeProvenance; justification: string; goal: { objective: string; successCriteria: string[] };
  experience: ArtifactRef; state: 'proposed' | 'frozen' | 'evaluation-dispatched' | 'evaluated' | 'submission-dispatched' | 'submitted';
  candidate?: CandidateManifest; judgingPolicyDigest?: string; evaluation?: ArtifactRef; submission?: ArtifactRef;
}
/** The operational database and artifacts are host-private, outside author workspaces. */
export class ChangeProposals {
  readonly store: OperationalStore; readonly runId: string; readonly scope: DataScope;
  constructor(store: OperationalStore, runId: string, scope: DataScope) { this.store = store; this.runId = runId; this.scope = scope; }
  key(id: string): string { return identity({ runId: this.runId, id }); }
  get(id: string): ChangeRecord {
    const record = this.store.get<ChangeRecord>('release.changes', this.key(id))?.value;
    invariant(record && record.runId === this.runId && scopeAllows(record.scope, this.scope), 'Change unavailable for this run/audience');
    return record;
  }
  create(record: ChangeRecord): ChangeRecord {
    invariant(record.runId === this.runId && identity(record.scope) === identity(this.scope), 'Proposal binding mismatch');
    const previous = this.store.get<ChangeRecord>('release.changes', this.key(record.id));
    if (previous) {
      const { candidate, judgingPolicyDigest, evaluation, submission, state, ...immutable } = previous.value;
      invariant(identity({ ...immutable, state: 'proposed' }) === identity(record), 'Changed proposal identity; use a new change ID'); return previous.value;
    }
    this.store.put('release.changes', this.key(record.id), record, null); return record;
  }
  transition(id: string, from: ChangeRecord['state'], state: ChangeRecord['state'], patch: Partial<Pick<ChangeRecord, 'candidate' | 'judgingPolicyDigest' | 'evaluation' | 'submission'>> = {}): ChangeRecord {
    return this.store.transaction(() => {
      const row = this.store.get<ChangeRecord>('release.changes', this.key(id)); invariant(row, 'Missing proposal');
      invariant(this.get(id).state === from, 'Proposal state changed or operation already dispatched');
      const next = { ...row.value, ...patch, state };
      this.store.put('release.changes', this.key(id), next, row.revision);
      this.store.append({ id: `change:${this.key(id)}:${state}`, stream: this.runId, type: 'release-change', data: next }); return next;
    });
  }
  artifact(value: unknown): ArtifactRef { return this.store.putJsonArtifact(JSON.parse(JSON.stringify(value)) as JsonValue); }
}
