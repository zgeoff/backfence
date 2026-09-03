import { encodeMessage } from '../protocol/protocol';
import { RelayError } from '../protocol/relay-error';
import type { PeerStore } from '../store/peer-store';
import { buildKnockEvent } from './build-knock-event';
import { findUserByName } from './find-user-by-name';
import { formatAddress } from './format-address';
import { formatPerson } from './format-person';
import { parseAddress } from './parse-address';
import type { PeerSession, Presence } from './presence';
import { MESSAGE_TTL_MS, routeOpenMessage } from './route-open-message';

export interface RouteContext {
  readonly store: PeerStore;
  readonly presence: Presence;
  readonly now: () => number;
}

export interface RouteResult {
  readonly id: string | null;
  readonly to: string;
  readonly status: 'delivered' | 'queued' | 'knocked';
}

// A declined person may be knocked again, and an unanswered knock repeated, after this long.
const KNOCK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Sending is the sender's consent. Until the receiver's side is accepted the body stays on the
// relay, and the sender sees the same answer whether the receiver is undecided, declined, or
// blocked.
export async function routeMessage(
  ctx: RouteContext,
  from: PeerSession,
  to: string,
  body: string,
): Promise<RouteResult> {
  const address = parseAddress(to);

  if (address === null) {
    throw new RelayError('bad_args', `"${to}" is not a person/session address`);
  }

  const users = await ctx.store.collectUsers();

  const match = findUserByName(users, address.person);

  if (match.kind === 'none') {
    throw new RelayError('no_such_peer', `nobody named "${address.person}" has connected`);
  }

  if (match.kind === 'ambiguous') {
    throw new RelayError(
      'ambiguous_peer',
      `"${address.person}" names ${match.logins.length} people: ${match.logins.join(', ')}; address one by login`,
    );
  }

  const me = from.user.userID;
  const target = match.user;
  const person = formatPerson(target, users);
  const now = ctx.now();
  const senderPerson = formatPerson(from.user, users);
  const senderAddress = formatAddress(senderPerson, from, ctx.presence.findSessions(me));

  const sender = {
    userID: me,
    address: senderAddress,
    login: from.user.login,
    displayName: from.user.displayName,
  };

  if (target.userID === me) {
    return routeOpenMessage(ctx, sender, { user: target, person, rest: address.rest }, body, now);
  }

  let edge = await ctx.store.findEdge(me, target.userID);

  if (edge.you === 'declined' || edge.you === 'blocked') {
    throw new RelayError('not_accepted', `you ${edge.you} ${person}; accept them to reopen`);
  }

  // A knock always records its time, a pre-accept never does: that is how an unanswered knock
  // from them is told apart from an invitation the sender may take up by sending.
  if (edge.you === 'none' && edge.them === 'accepted' && edge.knockedAt !== null) {
    throw new RelayError('not_accepted', `${person} is waiting for your accept`);
  }

  if (edge.you === 'none') {
    edge = await ctx.store.updateEdgeSide(me, target.userID, 'accepted', now);
  }

  if (edge.them === 'accepted') {
    return routeOpenMessage(ctx, sender, { user: target, person, rest: address.rest }, body, now);
  }

  if (edge.them === 'blocked') {
    return { id: null, to: person, status: 'knocked' };
  }

  const declineStale = edge.themAt !== null && now - edge.themAt > KNOCK_INTERVAL_MS;

  if (edge.them === 'declined' && declineStale) {
    edge = await ctx.store.updateEdgeSide(target.userID, me, 'none', now);
    edge = await ctx.store.findEdge(me, target.userID);
  }

  await ctx.store.writeHeld({
    fromUser: me,
    toUser: target.userID,
    fromAddress: senderAddress,
    fromSession: from.sessionName,
    fromNode: from.device,
    toSession: address.rest ?? '',
    body,
    createdAt: now,
    expiresAt: now + MESSAGE_TTL_MS,
  });

  const knockStale = edge.knockedAt === null || now - edge.knockedAt > KNOCK_INTERVAL_MS;

  if (edge.them === 'none' && knockStale) {
    const knock = encodeMessage(
      buildKnockEvent({
        from: senderAddress,
        person: senderPerson,
        login: from.user.login,
        displayName: from.user.displayName,
        node: from.device,
        sessionName: from.sessionName,
        knockedAt: now,
      }),
    );

    for (const session of ctx.presence.findSessions(target.userID)) {
      session.send(knock);
    }

    await ctx.store.updateKnockedAt(me, target.userID, now);
  }

  return { id: null, to: person, status: 'knocked' };
}
