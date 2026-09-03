import { formatDevice } from '../identity/format-device';
import type { Principal } from '../identity/principal';
import { parseRequestParams } from '../protocol/parse-request-params';
import type { RequestMethod } from '../protocol/parse-request-params';
import { MAX_FRAME, PROTOCOL_V, decodeMessage, encodeMessage } from '../protocol/protocol';
import type { ErrorCode, RequestMsg } from '../protocol/protocol';
import { RelayError } from '../protocol/relay-error';
import type { PeerStore, SideState, UserRecord } from '../store/peer-store';
import { buildKnockEvent } from './build-knock-event';
import { findUserByName } from './find-user-by-name';
import { formatAddress } from './format-address';
import { formatPerson } from './format-person';
import type { PeerSession, Presence } from './presence';
import { routeMessage } from './route-message';
import { routeOpenMessage } from './route-open-message';

export interface RelayContext {
  readonly build: string;
  readonly store: PeerStore;
  readonly presence: Presence;
  readonly now: () => number;
}

interface Socket {
  readonly send: (frame: string) => void;
  readonly close: (code: number, reason: string) => void;
}

interface ResolvedPeer {
  readonly user: UserRecord;
  readonly person: string;
  readonly users: readonly UserRecord[];
}

type Answer = Readonly<Record<string, unknown>>;

let nextConnID = 1;

// Every identified connection may speak; consent is checked per pair on each send, never per
// connection.
export class RelayConnection {
  readonly connID: number;

  private readonly ctx: RelayContext;

  private readonly principal: Principal;

  private readonly socket: Socket;

  private readonly user: UserRecord;

  private readonly device: string;

  private session: PeerSession | null = null;

  private constructor(ctx: RelayContext, principal: Principal, user: UserRecord, socket: Socket) {
    this.connID = nextConnID++;
    this.ctx = ctx;
    this.principal = principal;
    this.user = user;
    this.device = formatDevice(principal.nodeName);
    this.socket = socket;
  }

  static async open(
    ctx: RelayContext,
    principal: Principal,
    socket: Socket,
  ): Promise<RelayConnection> {
    const user = await ctx.store.upsertUser(principal, ctx.now());

    return new RelayConnection(ctx, principal, user, socket);
  }

  async applyFrame(frame: string): Promise<void> {
    if (frame.length > MAX_FRAME) {
      this.socket.close(1009, 'frame too large');

      return;
    }

    const decoded = decodeMessage(frame);

    if (decoded.kind === 'malformed') {
      this.socket.close(1002, decoded.reason);

      return;
    }

    if (decoded.kind !== 'request') {
      return;
    }

    const msg = decoded.msg;

    if (msg.v !== PROTOCOL_V) {
      this.answerError(
        msg.id,
        'protocol_mismatch',
        `relay speaks protocol ${PROTOCOL_V}, client sent ${msg.v}`,
      );

      return;
    }

    try {
      const ok = await this.answer(msg);

      this.socket.send(encodeMessage({ v: PROTOCOL_V, id: msg.id, ok }));
    } catch (error) {
      if (error instanceof RelayError) {
        this.answerError(msg.id, error.code, error.message);
      } else {
        const detail = error instanceof Error ? error.message : 'error';

        this.answerError(msg.id, 'internal', detail);
      }
    }
  }

  dispose(): void {
    if (this.session !== null) {
      this.ctx.presence.remove(this.connID);

      this.session = null;
    }
  }

  private answer(msg: RequestMsg): Promise<Answer> {
    switch (msg.m) {
      case 'relay.hello': {
        return this.answerHello(msg);
      }
      case 'peer.list': {
        return this.answerPeerList();
      }
      case 'peer.edges': {
        return this.answerPeerEdges();
      }
      case 'peer.accept': {
        return this.answerPeerAccept(msg);
      }
      case 'peer.decline': {
        return this.answerPeerDecision(msg, 'peer.decline', 'declined');
      }
      case 'peer.block': {
        return this.answerPeerDecision(msg, 'peer.block', 'blocked');
      }
      case 'message.send': {
        return this.answerMessageSend(msg);
      }
      case 'message.ack': {
        return this.answerMessageAck(msg);
      }
      default: {
        throw new RelayError('unknown_method', `unknown method "${msg.m}"`);
      }
    }
  }

  private async answerHello(msg: RequestMsg): Promise<Answer> {
    const p = this.parse('relay.hello', msg);
    const now = this.ctx.now();

    const users = await this.ctx.store.collectUsers();

    const person = formatPerson(this.user, users);

    this.dispose();

    const session: PeerSession = {
      connID: this.connID,
      principal: this.principal,
      user: this.user,
      device: this.device,
      sessionID: p.sessionID,
      sessionName: p.sessionName,
      cwd: p.cwd,
      mode: p.mode,
      connectedAt: now,
      send: (frame) => {
        this.socket.send(frame);
      },
    };

    if (p.kind === 'session') {
      this.session = session;

      this.ctx.presence.register(session);
    }

    const siblings = this.ctx.presence.findSessions(this.user.userID);

    const you = {
      userID: this.user.userID,
      login: this.user.login,
      displayName: this.user.displayName,
      person,
      device: this.device,
      address: formatAddress(person, session, siblings),
    };

    const queued = await this.ctx.store.collectQueued(this.user.userID, p.sessionName, now);

    for (const message of queued) {
      const sender = users.find((u) => u.userID === message.fromUser);

      session.send(
        encodeMessage({
          v: PROTOCOL_V,
          ev: 'Message',
          id: message.id,
          from: message.fromAddress,
          fromUser: sender?.login ?? '',
          fromName: sender?.displayName ?? '',
          body: message.body,
          sentAt: message.createdAt,
        }),
      );
    }

    const edges = await this.ctx.store.collectEdges(this.user.userID);

    const waiting = edges.filter(
      (edge) => edge.them === 'accepted' && edge.you === 'none' && edge.knockedAt !== null,
    );

    for (const edge of waiting) {
      const other = users.find((u) => u.userID === edge.otherUser);

      if (other === undefined || p.kind !== 'session') {
        continue;
      }

      const held = await this.ctx.store.findHeld(other.userID, this.user.userID, now);

      const otherPerson = formatPerson(other, users);

      session.send(
        encodeMessage(
          buildKnockEvent({
            from: held?.fromAddress ?? otherPerson,
            person: otherPerson,
            login: other.login,
            displayName: other.displayName,
            node: held?.fromNode ?? '',
            sessionName: held?.fromSession ?? '',
            knockedAt: edge.themAt ?? now,
          }),
        ),
      );
    }

    return { relay: this.ctx.build, you, queued: queued.length, knocks: waiting.length };
  }

  private async answerPeerList(): Promise<Answer> {
    const users = await this.ctx.store.collectUsers();
    const edges = await this.ctx.store.collectEdges(this.user.userID);

    const open = new Set(
      edges.filter((e) => e.you === 'accepted' && e.them === 'accepted').map((e) => e.otherUser),
    );

    const sessions = this.ctx.presence
      .collectSessions()
      .filter((s) => s.user.userID === this.user.userID || open.has(s.user.userID))
      .map((s) => {
        const person = formatPerson(s.user, users);
        const siblings = this.ctx.presence.findSessions(s.user.userID);

        return {
          address: formatAddress(person, s, siblings),
          person,
          device: s.device,
          session: s.sessionName,
          login: s.user.login,
          displayName: s.user.displayName,
          cwd: s.cwd,
          mode: s.mode,
          connectedAt: s.connectedAt,
          self: s.connID === this.connID,
        };
      });

    return { sessions };
  }

  // The other side shows as accepted or none: a decline or block is theirs to know, not ours.
  private async answerPeerEdges(): Promise<Answer> {
    const users = await this.ctx.store.collectUsers();
    const edges = await this.ctx.store.collectEdges(this.user.userID);

    const listed = edges.flatMap((edge) => {
      const other = users.find((u) => u.userID === edge.otherUser);

      if (other === undefined) {
        return [];
      }

      return [
        {
          person: formatPerson(other, users),
          login: other.login,
          displayName: other.displayName,
          you: edge.you,
          them: edge.them === 'accepted' ? 'accepted' : 'none',
          decidedAt: edge.youAt,
          knockedAt: edge.knockedAt,
        },
      ];
    });

    return { edges: listed.toSorted((a, b) => a.person.localeCompare(b.person)) };
  }

  private async answerPeerAccept(msg: RequestMsg): Promise<Answer> {
    const p = this.parse('peer.accept', msg);

    const peer = await this.resolvePeer(p.peer);

    const now = this.ctx.now();
    const me = this.user.userID;

    const edge = await this.ctx.store.updateEdgeSide(me, peer.user.userID, 'accepted', now);

    const open = edge.them === 'accepted';

    if (open) {
      const myPerson = formatPerson(this.user, peer.users);

      const accepted = encodeMessage({
        v: PROTOCOL_V,
        ev: 'Accepted',
        person: myPerson,
        login: this.user.login,
        displayName: this.user.displayName,
      });

      for (const session of this.ctx.presence.findSessions(peer.user.userID)) {
        session.send(accepted);
      }

      await this.drainHeld(peer.user, peer.person, this.user, myPerson, now);
      await this.drainHeld(this.user, myPerson, peer.user, peer.person, now);
    }

    return { person: peer.person, login: peer.user.login, open };
  }

  private async answerPeerDecision(
    msg: RequestMsg,
    method: 'peer.decline' | 'peer.block',
    state: SideState,
  ): Promise<Answer> {
    const p = this.parse(method, msg);

    const peer = await this.resolvePeer(p.peer);

    await this.ctx.store.updateEdgeSide(this.user.userID, peer.user.userID, state, this.ctx.now());
    await this.ctx.store.removeHeld(peer.user.userID, this.user.userID);

    return { person: peer.person, login: peer.user.login };
  }

  private async answerMessageSend(msg: RequestMsg): Promise<Answer> {
    const session = this.requireSession();
    const p = this.parse('message.send', msg);

    const result = await routeMessage(this.ctx, session, p.to, p.body);

    return {
      ...(result.id === null ? {} : { id: result.id }),
      to: result.to,
      status: result.status,
    };
  }

  private async answerMessageAck(msg: RequestMsg): Promise<Answer> {
    const p = this.parse('message.ack', msg);

    const acked = await this.ctx.store.updateDelivered(p.id, this.ctx.now());

    return { acked };
  }

  // A held message from one person to the other becomes a normal delivery once the pair is open.
  private async drainHeld(
    from: UserRecord,
    fromPerson: string,
    to: UserRecord,
    toPerson: string,
    now: number,
  ): Promise<void> {
    const held = await this.ctx.store.findHeld(from.userID, to.userID, now);

    if (held === null) {
      return;
    }

    await this.ctx.store.removeHeld(from.userID, to.userID);

    const fromAddress = held.fromAddress === '' ? fromPerson : held.fromAddress;

    await routeOpenMessage(
      this.ctx,
      {
        userID: from.userID,
        address: fromAddress,
        login: from.login,
        displayName: from.displayName,
      },
      {
        user: to,
        person: toPerson,
        rest: held.toSession === '' ? null : held.toSession,
        anySession: true,
      },
      held.body,
      now,
    );
  }

  private async resolvePeer(name: string): Promise<ResolvedPeer> {
    const users = await this.ctx.store.collectUsers();

    const match = findUserByName(users, name);

    if (match.kind === 'none') {
      throw new RelayError('no_such_peer', `nobody named "${name}" has connected`);
    }

    if (match.kind === 'ambiguous') {
      throw new RelayError(
        'ambiguous_peer',
        `"${name}" names ${match.logins.length} people: ${match.logins.join(', ')}; use a login`,
      );
    }

    if (match.user.userID === this.user.userID) {
      throw new RelayError('bad_args', `"${name}" is you`);
    }

    return { user: match.user, person: formatPerson(match.user, users), users };
  }

  private parse<M extends RequestMethod>(method: M, msg: RequestMsg) {
    const parsed = parseRequestParams(method, msg.p);

    if (!parsed.ok) {
      throw new RelayError('bad_args', parsed.message);
    }

    return parsed.data;
  }

  // The session this connection registered with hello, which every send
  // is attributed to.
  private requireSession(): PeerSession {
    if (this.session === null) {
      throw new RelayError('unauthorized', 'send relay.hello with kind "session" first');
    }

    return this.session;
  }

  private answerError(id: number, code: ErrorCode, msg: string): void {
    this.socket.send(encodeMessage({ v: PROTOCOL_V, id, err: { code, msg } }));
  }
}
