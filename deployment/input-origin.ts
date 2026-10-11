import type { InboundInput } from '../packages/contracts/index.ts';

/** Slack authenticates and namespaces each workspace before admission. Keep the
 * actual transport identity when distinguishing human direction from initiative. */
export function isHumanInput(input: Pick<InboundInput, 'source'>): boolean {
  return input.source === 'direct' || input.source === 'slack' || input.source.startsWith('slack:');
}
