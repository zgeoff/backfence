import { PROTOCOL_V, encodeMessage } from '../protocol/protocol';
import { RelayError } from '../protocol/relay-error';
import type { PeerStore, UserRecord } from '../store/peer-store';
import { formatAddress } from './format-address';
import { mintMessageID } from './mint-message-id';
import { pickSessions } from './pick-sessions';
import type { Presence } from './presence';

export interface OpenRouteContext {
  readonly store: PeerStore;
  readonly presence: Presence;
}

export interface Sender {
  readonly userID: string;
  readonly address: string;
  readonly login: string;
  readonly displayName: string;
}

export interface Target {
  readonly user: UserRecord;
  readonly person: string;
  readonly rest: string | null;
  readonly anySession?: boolean;
}

export interface OpenRouteResult {
  readonly id: string;
  readonly to: string;
  readonly status: 'delivered' | 'queued';
}

export const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The pair is already open here. The row exists before anything goes on the wire, so a crash
// between the write and the send redelivers rather than loses.
export async function routeOpenMessage(
  ctx: OpenRouteContext,
  sender: Sender,
  target: Target,
  body: string,
  now: number,
): Promise<OpenRouteResult> {
  const siblings = ctx.presence.findSessions(target.user.userID);
  const sessions = pickSessions(siblings, target.rest);

  if (sessions.length > 1 && target.anySession !== true) {
    const names = sessions.map((s) => formatAddress(target.person, s, siblings)).join(', ');

    throw new RelayError(
      'ambiguous_peer',
      `${target.person} has ${sessions.length} matching sessions: ${names}; address one by name`,
    );
  }

  const [session] = sessions;
  const id = mintMessageID(now);
  const toSession = session?.sessionName ?? target.rest ?? '';

  await ctx.store.writeMessage({
    id,
    fromUser: sender.userID,
    fromAddress: sender.address,
    toUser: target.user.userID,
    toSession,
    body,
    createdAt: now,
    expiresAt: now + MESSAGE_TTL_MS,
  });

  if (session === undefined) {
    const to = toSession === '' ? target.person : `${target.person}/${toSession}`;

    return { id, to, status: 'queued' };
  }

  session.send(
    encodeMessage({
      v: PROTOCOL_V,
      ev: 'Message',
      id,
      from: sender.address,
      fromUser: sender.login,
      fromName: sender.displayName,
      body,
      sentAt: now,
    }),
  );

  return { id, to: formatAddress(target.person, session, siblings), status: 'delivered' };
}
