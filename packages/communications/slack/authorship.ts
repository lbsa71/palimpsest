import { identity, scopeAllows } from '../../contracts/common.ts';
import type { DataScope } from '../../contracts/common.ts';
import type { OperationalStore } from '../../storage/index.ts';
import type { SlackMessage } from './client.ts';

export interface SlackAuthor {
  kind: 'self' | 'human' | 'other-bot' | 'unknown';
  actorId: string | null;
  userId: string | null;
  botId: string | null;
  origin: 'mind-speech' | 'host-status' | 'unverified';
}
export interface SlackDeliveryIdentity { channel: string; messageTs: string; botUserId: string; effectId: string; origin: 'mind-speech' | 'host-status' }
export interface SlackObservedMessage {
  teamId: string; channel: string; messageTs: string; threadTs: string; revision: string;
  text: string; author: SlackAuthor; scope: DataScope; deleted: boolean;
  attribution: 'authenticated-slack-metadata';
}

/** Content, display names, mentions and quoted speaker labels never establish identity. */
export function slackAuthor(teamId: string, botUserId: string | undefined, message: Pick<SlackMessage, 'user' | 'bot_id' | 'subtype'>, delivery?: SlackDeliveryIdentity): SlackAuthor {
  const userId = typeof message.user === 'string' && message.user.length > 0 ? message.user : null;
  const botId = typeof message.bot_id === 'string' && message.bot_id.length > 0 ? message.bot_id : null;
  const receiptMatches = delivery !== undefined && delivery.botUserId === botUserId && (userId === null || userId === botUserId);
  const self = botUserId !== undefined && (userId === botUserId || receiptMatches);
  return { kind: self ? 'self' : !userId ? 'unknown' : botId || message.subtype === 'bot_message' ? 'other-bot' : 'human',
    actorId: userId ? `slack:${teamId}:${userId}` : self ? `slack:${teamId}:${botUserId}` : null,
    userId, botId, origin: self && receiptMatches ? delivery.origin : 'unverified' };
}

export function slackObservationKey(teamId: string, channel: string, messageTs: string): string { return identity({ teamId, channel, messageTs }); }
export function slackDelivery(store: OperationalStore, channel: string, messageTs: string): SlackDeliveryIdentity | undefined {
  return store.get<SlackDeliveryIdentity>('communications.slack.deliveries', `${channel}:${messageTs}`)?.value;
}
export function retainSlackObservation(store: OperationalStore, message: SlackObservedMessage): SlackObservedMessage {
  const key = slackObservationKey(message.teamId, message.channel, message.messageTs);
  const previous = store.get<SlackObservedMessage>('communications.slack.observations', key);
  if (previous && Number(previous.value.revision) >= Number(message.revision)) return previous.value;
  if (previous && !scopeAllows(previous.value.scope, message.scope) && !scopeAllows(message.scope, previous.value.scope)) return previous.value;
  const retained = previous && !scopeAllows(previous.value.scope, message.scope) ? { ...message, scope: previous.value.scope } : message;
  store.put('communications.slack.observations', key, retained, previous?.revision ?? null);
  return retained;
}
