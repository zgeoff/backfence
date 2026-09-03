import { PROTOCOL_V } from '../protocol/protocol';
import { RelayError } from '../protocol/relay-error';
import type { PeerStore } from '../store/peer-store';
import { formatAddress } from './format-address';
import { mintMessageID } from './mint-message-id';
import { parseAddress } from './parse-address';
import type { PeerSession, Presence } from './presence';

export interface RouteContext {
  readonly store: PeerStore;
  readonly presence: Presence;
  readonly now: () => number;
}

export interface RouteResult {
  readonly id: string;
  readonly to: string;
  readonly status: 'delivered' | 'queued';
}

const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The row exists before anything goes on the wire, so a crash between the write and the send
// redelivers rather than loses.
export async function routeMessage(
  ctx: RouteContext,
  from: PeerSession,
  to: string,
  body: string,
): Promise<RouteResult> {
  const address = parseAddress(to);

  if (address === null) {
    throw new RelayError('bad_args', `"${to}" is not a peer/session address`);
  }

  const target = await ctx.store.findPeerByName(address.peer);

  if (target === null || target.status !== 'allowed') {
    throw new RelayError('no_such_peer', `no peer named "${address.peer}"`);
  }

  const sessions = ctx.presence.findSessions(target.userID, address.session ?? undefined);

  if (address.session === null && sessions.length > 1) {
    const names = sessions.map((s) => s.sessionName).join(', ');

    throw new RelayError(
      'ambiguous_peer',
      `${address.peer} has ${sessions.length} sessions: ${names}; address one by name`,
    );
  }

  const [session] = sessions;
  const now = ctx.now();
  const id = mintMessageID(now);
  const fromAddress = formatAddress(from.peer, from.sessionName);
  const toSession = session?.sessionName ?? address.session ?? '';

  await ctx.store.writeMessage({
    id,
    fromUser: from.peer.userID,
    fromAddress,
    toUser: target.userID,
    toSession,
    body,
    createdAt: now,
    expiresAt: now + MESSAGE_TTL_MS,
  });

  const toAddress = toSession === '' ? address.peer : formatAddress(target, toSession);

  if (session === undefined) {
    return { id, to: toAddress, status: 'queued' };
  }

  session.send(
    JSON.stringify({
      v: PROTOCOL_V,
      ev: 'Message',
      id,
      from: fromAddress,
      fromUser: from.peer.login,
      fromName: from.peer.displayName,
      body,
      sentAt: now,
    }),
  );

  return { id, to: toAddress, status: 'delivered' };
}
