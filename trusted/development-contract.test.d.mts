import type { Memory, Task } from '../src/store.ts';
import type { CompletionRequest } from '../src/providers.ts';
export interface DevelopmentFixture { name:string; task:Task; memories:Memory[] }
export function makeDevelopmentFixtures(check:'memory-provenance'|'memory-context-budget'):DevelopmentFixture[];
export function validateDevelopmentResponses(check:'memory-provenance'|'memory-context-budget',fixtures:DevelopmentFixture[],responses:CompletionRequest[]):{name:string;status:'passed'}[];
