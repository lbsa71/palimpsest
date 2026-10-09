import type { Memory, Task } from './store.ts';
import { Store } from './store.ts';

/** Resolve current scoped source edges to authenticated exchange records.
 * Anonymous, stale, cyclic or cross-scope derivations confer no authority. */
export function conversationMemoryTasks(store: Store, memory: Memory, seen = new Set<string>()): Task[] | undefined {
  if (seen.has(memory.id) || store.memory(memory.id, memory.scope)?.version !== memory.version) return;
  const path = new Set(seen); path.add(memory.id);
  const tasks: Task[] = [];
  if (memory.kind === 'episodic' && memory.source.startsWith('task:')) {
    const task = store.task(memory.source.slice(5));
    if (task?.conversationId !== memory.scope || !store.taskSourceCurrent(task.id)) return;
    tasks.push(task);
  }
  const refs = store.memorySourceRefs(memory.id, memory.scope); if (!refs.length) return tasks.length ? tasks : undefined;
  for (const ref of refs) {
    const source = store.memory(ref.id, memory.scope);
    if (!source || source.version !== ref.version) return;
    const origins = conversationMemoryTasks(store, source, path); if (!origins) return;
    tasks.push(...origins);
  }
  return [...new Map(tasks.map(task => [task.id, task])).values()];
}
