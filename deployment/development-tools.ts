import { identity, invariant, type DataScope, type JsonValue } from '../packages/contracts/index.ts';
import { DevelopmentalMemory, developmentTools, type AdoptSelf, type Derivation } from '../packages/development/index.ts';
import type { InitiativeTool } from '../packages/initiative/tools.ts';

const string = { type: 'string', minLength: 1 }, strings = { type: 'array', items: string, minItems: 1, maxItems: 32 };
const revision = { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] };
function object(args: JsonValue, keys: string[]): Record<string, JsonValue> { invariant(args !== null && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(key => keys.includes(key)), 'Invalid development arguments'); return args; }
function text(value: JsonValue | undefined): string { invariant(typeof value === 'string' && value.trim().length > 0, 'Expected nonempty text'); return value; }
function ids(value: JsonValue | undefined): string[] { invariant(Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(id => typeof id === 'string' && id.length > 0), 'Expected memory IDs'); return value as string[]; }
function schema(properties: object, required: string[]): object { return { type: 'object', properties, required, additionalProperties: false }; }
/** Scope, timestamps and attribution come from the host; a chosen identity is mutable evidence. */
export function mindDevelopmentTools(memory: DevelopmentalMemory, audience: DataScope, actorId: string): InitiativeTool[] {
  const scope = structuredClone(audience), scopedId = (name: string) => `mind:${identity(scope)}:${name}`;
  return [...developmentTools(memory, scope), {
    name: 'memory_derive', description: 'Derive an attributed belief, procedure, relationship or interpretation from visible experiences; preserve uncertainty and explicit correction links.',
    inputSchema: schema({ id: string, kind: { enum: ['interpretation', 'belief', 'procedure', 'relationship', 'self-description'] }, sourceIds: strings, content: {}, confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] }, supersedes: { type: 'array', items: string }, contradictions: { type: 'array', items: string } }, ['id', 'kind', 'sourceIds', 'content', 'confidence']),
    execute(args: JsonValue) {
      const a = object(args, ['id', 'kind', 'sourceIds', 'content', 'confidence', 'supersedes', 'contradictions']);
      invariant(a.content !== undefined && (a.confidence === null || typeof a.confidence === 'number' && a.confidence >= 0 && a.confidence <= 1), 'Content and confidence required');
      const links = (value: JsonValue | undefined) => value === undefined || Array.isArray(value) && value.length === 0 ? [] : ids(value);
      return memory.derive({ id: scopedId(text(a.id)), kind: text(a.kind) as Derivation['kind'], sourceIds: ids(a.sourceIds), content: a.content, confidence: a.confidence, supersedes: links(a.supersedes), contradictions: links(a.contradictions), scope, actorId, at: new Date().toISOString() });
    },
  }, {
    name: 'self_adopt', description: 'Adopt or revise one experience-grounded self facet. Its category may describe an interest, value, ability, uncertainty, preference or self-description; it is not an externally imposed persona.',
    inputSchema: schema({ id: string, category: { enum: ['interest', 'value', 'ability', 'uncertainty', 'preference', 'description'] }, value: {}, reason: string, memoryIds: strings, expectedRevision: revision }, ['id', 'category', 'value', 'reason', 'memoryIds', 'expectedRevision']),
    execute(args: JsonValue) {
      const a = object(args, ['id', 'category', 'value', 'reason', 'memoryIds', 'expectedRevision']);
      invariant(a.value !== undefined && (a.expectedRevision === null || typeof a.expectedRevision === 'number' && Number.isSafeInteger(a.expectedRevision) && a.expectedRevision >= 0), 'Invalid self revision');
      return memory.adoptSelf({ id: scopedId(text(a.id)), category: text(a.category) as AdoptSelf['category'], value: a.value, reason: text(a.reason), memoryIds: ids(a.memoryIds), scope, actorId, at: new Date().toISOString() }, a.expectedRevision);
    },
  }, {
    name: 'memory_forget', description: 'Forget visible experiences and dependent derived memories/self facets; operational execution evidence remains separately retained.',
    inputSchema: schema({ memoryIds: strings }, ['memoryIds']),
    execute(args: JsonValue) { const a = object(args, ['memoryIds']); const selected = ids(a.memoryIds); selected.forEach(id => invariant(memory.get(id, scope), 'Memory unavailable')); return memory.forget(selected, scope); },
  }];
}
