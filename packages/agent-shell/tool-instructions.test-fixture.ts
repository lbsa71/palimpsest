import { createAgentShell, type ShellOptions } from './index.ts';
import { digest } from './mistral.ts';

/** Deterministic retained-byte fixture; durable store behavior is tested separately. */
export function createTestShell(options: Omit<ShellOptions, 'toolInstructions'>) {
  const source = JSON.stringify(options.tools);
  const artifact = (bytes: string) => ({ uri: `aeon:artifact:${digest(bytes)}`, sha256: digest(bytes) });
  const toolInstructions = { tools: artifact(source), ...(options.compaction ? { compaction: artifact('[]') } : {}) };
  return createAgentShell({ ...options, toolInstructions,
    resolveFragment: fragment => fragment.id === 'shell.tools'
      ? Promise.resolve(fragment.artifact.sha256 === toolInstructions.tools.sha256 ? source : '[]')
      : options.resolveFragment(fragment) });
}
