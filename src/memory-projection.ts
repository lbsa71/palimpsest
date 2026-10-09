import { isDeepStrictEqual } from 'node:util';
import type { CompletionRequest } from './providers.ts';
import { ProviderError } from './providers.ts';
import type { Memory, Task } from './store.ts';

export interface MemoryDescriptor {
  id: string; kind: Memory['kind']; content: string; source: string; confidence: number;
  version?: number; evidence?: string[]; updatedAt?: string;
}
const fields = ['id','kind','content','source','confidence','version','evidence','updatedAt'];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function reject(): never { throw new ProviderError('protocol', 'Candidate memory projection failed current host validation.'); }
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function minimalDescriptor(memory: Memory): MemoryDescriptor {
  const units = (memory.content.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  return { id: memory.id, kind: memory.kind, content: memory.content.slice(0, units), source: memory.source,
    confidence: memory.confidence, version: memory.version, evidence: memory.evidence, updatedAt: memory.updatedAt };
}

/** Validate, never repair, the worker's projection. The caller supplies the same
 * twelve-record pool originally authorized and independently rereads current
 * records/policy after worker execution. Checks come from the active manifest,
 * never candidate claims. This bound applies only to the memory array. */
export function validateMemoryProjection(options: {
  request: CompletionRequest; task: Task; supplied: readonly Memory[];
  authorizedCurrent: readonly Memory[]; checks: readonly string[];
  /** Interactive preparation replaces the root; reject unknown data there
   * rather than silently dropping it. Ordinary roots remain untrusted data. */
  interactive?: boolean;
}): MemoryDescriptor[] {
  const { request, task, supplied, authorizedCurrent, checks } = options;
  if (typeof request.system !== 'string' || typeof request.prompt !== 'string'
    || Buffer.byteLength(request.system) + Buffer.byteLength(request.prompt) > 65_536
    || supplied.length > 12 || authorizedCurrent.length > 12) reject();
  let prompt: unknown;
  try { prompt = JSON.parse(request.prompt); } catch { reject(); }
  if (!object(prompt) || (options.interactive && Object.keys(prompt).some(key => !['request','memories'].includes(key)))
    || prompt.request !== task.input || !Array.isArray(prompt.memories) || prompt.memories.length > 12) reject();
  const lineage = checks.includes('memory-provenance'); const bounded = checks.includes('memory-context-budget');
  if (bounded && !lineage) reject();
  const seen = new Set<string>();
  for (const value of prompt.memories) {
    if (!object(value) || Object.keys(value).some(key => !fields.includes(key)) || typeof value.id !== 'string' || seen.has(value.id)) reject();
    const current = authorizedCurrent.find(memory => memory.id === value.id && memory.scope === task.conversationId);
    const original = supplied.find(memory => memory.id === value.id && memory.scope === task.conversationId);
    if (!current || !original || !isDeepStrictEqual(current, original)) reject();
    seen.add(value.id);
    if (typeof value.content !== 'string' || !value.content.length || value.content.length > 4000 || !current.content.startsWith(value.content)) reject();
    for (const field of ['kind','source','confidence'] as const) if (!isDeepStrictEqual(value[field], current[field])) reject();
    for (const field of ['version','evidence','updatedAt'] as const)
      if ((lineage || Object.hasOwn(value, field)) && !isDeepStrictEqual(value[field], current[field])) reject();
    if (bounded && /[\uD800-\uDBFF]$/.test(value.content)) reject();
  }
  const descriptors = prompt.memories as unknown as MemoryDescriptor[];
  if (bounded) {
    if (bytes(descriptors) > 32768) reject();
    const ordered = authorizedCurrent.map((memory, position) => ({memory, position, time: Date.parse(memory.updatedAt)}));
    if (ordered.some(item => !Number.isFinite(item.time))) reject();
    ordered.sort((a,b) => b.time - a.time || b.position - a.position);
    let offset = 0;
    for (const {memory} of ordered) {
      if (offset >= 12) break;
      const minimal = minimalDescriptor(memory);
      if (!minimal.content || bytes([...descriptors.slice(0, offset), minimal]) > 32768) continue;
      if (descriptors[offset]?.id !== memory.id) reject();
      offset++;
    }
    if (offset !== descriptors.length) reject();
  }
  return descriptors;
}
