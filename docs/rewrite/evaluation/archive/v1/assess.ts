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
  reviewDisposition: 'agreed' | 'resolved' | 'unresolved';
}
export interface DevelopmentWindow {
  evidenceKind: 'mechanical' | 'live-development';
  startedAt: string;
  endedAt: string;
  trustedObserver: boolean;
  controls: string[];
  opportunities: Opportunity[];
}
export function assessDevelopment(window: DevelopmentWindow): { status: 'pass' | 'fail' | 'unavailable'; reasons: string[] } {
  const day = 86_400_000;
  const start = Date.parse(window.startedAt);
  const end = Date.parse(window.endedAt);
  const reasons: string[] = [];
  if (window.evidenceKind !== 'live-development' || !window.trustedObserver) return { status: 'unavailable', reasons: ['Synthetic clocks or unauthenticated receipts cannot establish live development'] };
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 28 * day) reasons.push('Insufficient actual 28-day horizon');
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
    if (item.family === 'transfer' && (item.learnedAt === null || !Number.isFinite(Date.parse(item.learnedAt)) || Date.parse(item.learnedAt) < start || at - Date.parse(item.learnedAt) < 7 * day)) reasons.push(`${item.id}: transfer lacks seven-day delay`);
  }
  for (const family of ['transfer', 'belief-revision', 'inquiry', 'judgment'] as const) {
    const items = window.opportunities.filter(item => item.family === family);
    if (items.length < 3 || items.filter(item => item.outcome === 'pass').length < 2) reasons.push(`${family}: insufficient verified opportunities`);
    if (items.some(item => item.outcome === 'unavailable')) reasons.push(`${family}: unavailable opportunity`);
  }
  return { status: reasons.length ? 'fail' : 'pass', reasons };
}
