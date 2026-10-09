import { digestJson } from './candidates.ts';
import type { Growth, Json, Store } from './store.ts';

const MAX_ENTRIES = 64;
const MAX_BYTES = 65_536;
export interface GrowthDescriptor {
  id: string; idDigest: string; dimension: Growth['dimension']; state: Growth['state'];
  question: string; nextStep: string; origin: string; updatedAt: string;
  budget: number; remainingBudget: number;
  recordReference: string; recordDigest: string; outcomeDigest: string; checkpointDigest: string;
  lesson?: string; lessonAssessment?: 'unverified_reflection';
  sourceTaskId?: string; sourceScope?: string;
  truncatedFields: string[];
}
function object(value: Json): Record<string, Json> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function excerpt(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  let size = 0; let result = '';
  for (const character of text) {
    const next = Buffer.byteLength(character);
    if (size + next > bytes) break;
    result += character; size += next;
  }
  return result;
}

/** Projection never rewrites history. Full records remain external evidence;
 * truncated identifiers have an exact digest for unambiguous audit matching. */
function describe(growth: Growth, source?: { taskId: string; scope: string }): GrowthDescriptor {
  const truncatedFields: string[] = [];
  const text = (field: string, value: string, bytes: number) => {
    const result = excerpt(value, bytes);
    if (result !== value) truncatedFields.push(field);
    return result;
  };
  const descriptor: GrowthDescriptor = {
    id: text('id', growth.id, 256), idDigest: digestJson(growth.id), dimension: growth.dimension, state: growth.state,
    question: text('question', growth.question, 1024), nextStep: text('nextStep', growth.nextStep, 1024),
    origin: text('origin', growth.origin, 256), updatedAt: text('updatedAt', growth.updatedAt, 64),
    budget: growth.budget, remainingBudget: growth.remainingBudget,
    recordReference: text('recordReference', `growth:${growth.id}`, 264), recordDigest: digestJson(growth),
    outcomeDigest: digestJson(growth.outcome), checkpointDigest: digestJson(growth.checkpoint), truncatedFields,
  };
  const result = object(object(growth.outcome).result ?? null);
  if (typeof result.lesson === 'string') {
    descriptor.lesson = text('lesson', result.lesson, 1536);
    descriptor.lessonAssessment = 'unverified_reflection';
  }
  if (source) {
    descriptor.sourceTaskId = text('sourceTaskId', source.taskId, 256);
    descriptor.sourceScope = text('sourceScope', source.scope, 256);
  }
  return descriptor;
}

/** Human provenance follows explicit task ownership and linked growth origins.
 * Unknown/cyclic provenance is excluded rather than reclassified as autonomous. */
function provenance(growth: Growth, records: Map<string, Growth>, store: Store): { taskId: string; scope: string } | null | undefined {
  const visited = new Set<string>(); let item: Growth | undefined = growth;
  while (item) {
    if (visited.has(item.id)) return null;
    visited.add(item.id);
    if (item.sourceTaskId) {
      const task = store.task(item.sourceTaskId);
      return task ? { taskId: task.id, scope: task.conversationId } : null;
    }
    if (item.origin.startsWith('conversation:') || item.id.startsWith('conversation:')) return null;
    if (!item.origin.startsWith('growth:')) return undefined;
    item = records.get(item.origin.slice('growth:'.length));
  }
  return null;
}

/** Only growth context is bounded here. Complete scoped memories and tasks keep
 * their existing continuity contract and can still exceed custody's total cap. */
export function readGenerationContinuity(store: Store, scope: string) {
  const snapshot = store.readContinuitySnapshot(scope, store.listGrowth().map(item => item.id));
  const records = new Map(snapshot.growth.map(item => [item.id, item]));
  const priority = { running: 0, paused: 1, queued: 2, completed: 3 };
  const ordered = [...snapshot.growth].sort((a, b) => priority[a.state] - priority[b.state]
    || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const growth: GrowthDescriptor[] = []; let excludedByScope = 0; let omittedEntries = 0;
  for (const item of ordered) {
    const source = provenance(item, records, store);
    if (source === null || (source && source.scope !== scope)) { excludedByScope++; continue; }
    if (growth.length >= MAX_ENTRIES) { omittedEntries++; continue; }
    const descriptor = describe(item, source);
    if (Buffer.byteLength(JSON.stringify([...growth, descriptor])) > MAX_BYTES) {
      omittedEntries++; continue;
    }
    growth.push(descriptor);
  }
  return { ...snapshot, growth, growthProjection: {
    version: 1, maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES,
    bytes: Buffer.byteLength(JSON.stringify(growth)), omittedEntries, excludedByScope,
    completeRecordsRetained: true,
  } };
}
