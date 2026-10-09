import { CommunicationsError } from './communications.ts';
import type { InboundMessage } from './communications.ts';

/** Apply before enqueue at every trusted ingress, including programmatic host
 * calls during startup/quiescence. Text cannot grant a role or reserved scope. */
export function assertConversationRole(input: InboundMessage): void {
  const reserved = input.conversationId.startsWith('peer:');
  const validPeer = reserved && input.conversationId.slice(5).trim().length > 0;
  if (input.source === 'peer' ? !validPeer || input.slackAuthor !== undefined : reserved) {
    throw new CommunicationsError('invalid_peer_scope');
  }
}
