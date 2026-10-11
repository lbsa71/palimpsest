export type Family = 'transfer' | 'belief-revision' | 'inquiry' | 'judgment';
export interface Opportunity {
  id: string;
  family: Family;
  observedAt: string;
  learnedAt: string | null;
  outcome: 'pass' | 'fail' | 'unavailable';
  artifact: string;
  externalFeedback: string;
  audienceBoundaryPreserved: boolean;
  interveningExperienceReceipts?: string[];
  reviewDisposition: 'agreed' | 'resolved' | 'unresolved';
}
export interface DevelopmentWindow {
  evidenceKind: 'mechanical' | 'live-development';
  registered: { schedulerWindowMs: number; configurationDigest: string; deadlineAt: string };
  autonomousCycles: { id: string; observedAt: string; receipt: string }[];
  startedAt: string;
  endedAt: string;
  trustedObserver: boolean;
  controls: string[];
  opportunities: Opportunity[];
  boundaryReceipts: { restart: string; contextReduction: string; laterRetrieval: string; spontaneousInitiative: string; contradictoryFeedback: string; nonApplicableRule: string };
  freshReviewerIds: string[];
}
export function assessDevelopment(window: DevelopmentWindow): { status: 'receipt-shape-pass' | 'fail' | 'unavailable'; reasons: string[] } {
  const period = window.registered?.schedulerWindowMs;
  const start = Date.parse(window.startedAt);
  const end = Date.parse(window.endedAt);
  const reasons: string[] = [];
  if (window.evidenceKind !== 'live-development' || !window.trustedObserver) return { status: 'unavailable', reasons: ['Synthetic clocks or unauthenticated receipts cannot establish live development'] };
  const deadline = Date.parse(window.registered?.deadlineAt);
  if (!Number.isSafeInteger(period) || period <= 0 || !/^[a-f0-9]{64}$/.test(window.registered?.configurationDigest)) reasons.push('Unsealed actual scheduler configuration');
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(deadline) || end > deadline || end - start < 3 * period) reasons.push('Outside registered actual scheduler-window horizon/deadline');
  const cycles = window.autonomousCycles ?? [];
  if (cycles.length < 3 || new Set(cycles.map(c => c.id)).size !== cycles.length || cycles.some((c, i) => !c.id || !c.receipt || !Number.isFinite(Date.parse(c.observedAt)) || Date.parse(c.observedAt) < start + period || Date.parse(c.observedAt) > end || i > 0 && Date.parse(c.observedAt) - Date.parse(cycles[i - 1]!.observedAt) < period)) reasons.push('Three distinct observed cycles across actual scheduler windows required');
  for (const name of ['restart', 'contextReduction', 'laterRetrieval', 'spontaneousInitiative', 'contradictoryFeedback', 'nonApplicableRule'] as const) if (!window.boundaryReceipts?.[name]) reasons.push(`Missing actual boundary receipt ${name}`);
  if (new Set(window.freshReviewerIds?.filter(Boolean)).size < 2) reasons.push('Two fresh reviewer identities required');
  for (const control of ['no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose']) if (!window.controls.includes(control)) reasons.push(`Missing control ${control}`);
  const ids = new Set<string>();
  for (const item of window.opportunities) {
    if (!item.id || ids.has(item.id)) reasons.push('Missing or duplicate opportunity identity');
    ids.add(item.id);
    const at = Date.parse(item.observedAt);
    if (!Number.isFinite(at) || at < start || at > end) reasons.push(`${item.id}: invalid observation time`);
    if (!item.artifact || !item.externalFeedback) reasons.push(`${item.id}: missing independent artifact or feedback`);
    if (!item.audienceBoundaryPreserved) reasons.push(`${item.id}: audience disclosure violation`);
    if (item.reviewDisposition === 'unresolved') reasons.push(`${item.id}: unresolved reviewer disagreement`);
    if (item.family === 'transfer' && (item.learnedAt === null || !Number.isFinite(Date.parse(item.learnedAt)) || Date.parse(item.learnedAt) < start || at - Date.parse(item.learnedAt) < period || new Set(item.interveningExperienceReceipts?.filter(Boolean)).size < 3)) reasons.push(`${item.id}: transfer lacks actual scheduler-window delay and three intervening experiences`);
  }
  for (const family of ['transfer', 'belief-revision', 'inquiry', 'judgment'] as const) {
    const items = window.opportunities.filter(item => item.family === family);
    if (items.length < 3 || items.filter(item => item.outcome === 'pass').length < 2) reasons.push(`${family}: insufficient verified opportunities`);
    if (items.some(item => item.outcome === 'unavailable')) reasons.push(`${family}: unavailable opportunity`);
  }
  return { status: reasons.length ? 'fail' : 'receipt-shape-pass', reasons };
}
