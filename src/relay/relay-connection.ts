import type { Principal } from '../identity/principal';
import { parseRequestParams } from '../protocol/parse-request-params';
import type { RequestMethod } from '../protocol/parse-request-params';
import { MAX_FRAME, PROTOCOL_V, decodeMessage, encodeMessage } from '../protocol/protocol';
import type { ErrorCode, RequestMsg } from '../protocol/protocol';
import { RelayError } from '../protocol/relay-error';
import type { UnknownPeerPolicy } from '../shared/config';
import type { PeerRecord, PeerStore } from '../store/peer-store';
import { formatAddress } from './format-address';
import type { PeerSession, Presence } from './presence';
import { routeMessage } from './route-message';

export interface RelayContext {
  readonly build: string;
  readonly store: PeerStore;
  readonly presence: Presence;
  readonly unknownPeers: UnknownPeerPolicy;
  readonly admins: readonly string[];
  readonly now: () => number;
}

interface Socket {
  readonly send: (frame: string) => void;
  readonly close: (code: number, reason: string) => void;
}

type Answer = Readonly<Record<string, unknown>>;

let nextConnID = 1;

// The peer record is re-read on every request so an approve or block takes effect at the peer's
// next call, with no reconnect.
export class RelayConnection {
  readonly connID: number;

  private readonly ctx: RelayContext;

  private readonly principal: Principal;

  private readonly socket: Socket;

  private peer: PeerRecord;

  private session: PeerSession | null = null;

  private constructor(ctx: RelayContext, principal: Principal, peer: PeerRecord, socket: Socket) {
    this.connID = nextConnID++;
    this.ctx = ctx;
    this.principal = principal;
    this.peer = peer;
    this.socket = socket;
  }

  // Null means the policy refuses unknown peers and this one is unknown; the caller closes the socket.
  static async open(
    ctx: RelayContext,
    principal: Principal,
    socket: Socket,
  ): Promise<RelayConnection | null> {
    const admin = ctx.admins.includes(principal.login);

    const known = await ctx.store.findPeer(principal.userID);

    if (known === null && !admin && ctx.unknownPeers === 'refuse') {
      return null;
    }

    const peer = await ctx.store.upsertPeer(principal, {
      status: admin ? 'allowed' : 'pending',
      admin,
      now: ctx.now(),
    });

    return new RelayConnection(ctx, principal, peer, socket);
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

  private async answer(msg: RequestMsg): Promise<Answer> {
    const refreshed = await this.ctx.store.findPeer(this.principal.userID);

    if (refreshed !== null) {
      this.peer = refreshed;
    }

    if (this.peer.status === 'blocked') {
      throw new RelayError('peer_blocked', 'this peer is blocked on the relay');
    }

    switch (msg.m) {
      case 'relay.hello': {
        return this.answerHello(msg);
      }
      case 'peer.list': {
        return this.answerPeerList();
      }
      case 'peer.pending': {
        return this.answerPeerPending();
      }
      case 'peer.approve': {
        return this.answerPeerApprove(msg);
      }
      case 'peer.block': {
        return this.answerPeerBlock(msg);
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

    const you = {
      userID: this.peer.userID,
      login: this.peer.login,
      displayName: this.peer.displayName,
      alias: this.peer.alias,
      status: this.peer.status,
      admin: this.peer.admin,
      address: formatAddress(this.peer, p.sessionName),
    };

    if (this.peer.status !== 'allowed') {
      return { relay: this.ctx.build, you };
    }

    this.dispose();

    const session: PeerSession = {
      connID: this.connID,
      principal: this.principal,
      peer: this.peer,
      sessionID: p.sessionID,
      sessionName: p.sessionName,
      cwd: p.cwd,
      mode: p.mode,
      connectedAt: this.ctx.now(),
      send: (frame) => {
        this.socket.send(frame);
      },
    };

    if (p.kind === 'session') {
      this.session = session;

      this.ctx.presence.register(session);
    }

    const queued = await this.ctx.store.collectQueued(
      this.peer.userID,
      p.sessionName,
      this.ctx.now(),
    );

    for (const message of queued) {
      session.send(
        encodeMessage({
          v: PROTOCOL_V,
          ev: 'Message',
          id: message.id,
          from: message.fromAddress,
          fromUser: '',
          fromName: '',
          body: message.body,
          sentAt: message.createdAt,
        }),
      );
    }

    return { relay: this.ctx.build, you, queued: queued.length };
  }

  private answerPeerList(): Answer {
    this.requireAllowed();

    const sessions = this.ctx.presence.collectSessions().map((s) => ({
      address: formatAddress(s.peer, s.sessionName),
      login: s.peer.login,
      displayName: s.peer.displayName,
      cwd: s.cwd,
      mode: s.mode,
      connectedAt: s.connectedAt,
      self: s.connID === this.connID,
    }));

    return { sessions };
  }

  private async answerPeerPending(): Promise<Answer> {
    this.requireAdmin();

    const pending = await this.ctx.store.collectPeers('pending');

    return {
      pending: pending.map((peer) => ({
        userID: peer.userID,
        login: peer.login,
        displayName: peer.displayName,
        firstSeen: peer.firstSeen,
        lastSeen: peer.lastSeen,
      })),
    };
  }

  private async answerPeerApprove(msg: RequestMsg): Promise<Answer> {
    this.requireAdmin();

    const p = this.parse('peer.approve', msg);

    if (p.alias !== '') {
      if (!/^[a-z0-9][a-z0-9._-]*$/u.test(p.alias)) {
        throw new RelayError(
          'bad_args',
          'an alias is lowercase letters, digits, dot, dash, or underscore',
        );
      }

      const taken = await this.ctx.store.findPeerByName(p.alias);

      if (taken !== null && taken.userID !== p.userID) {
        throw new RelayError('bad_args', `alias "${p.alias}" already names ${taken.login}`);
      }
    }

    const alias = p.alias === '' ? undefined : p.alias;

    const updated = await this.ctx.store.updatePeerStatus(p.userID, 'allowed', alias);

    if (!updated) {
      throw new RelayError('no_such_peer', `no peer with user id ${p.userID}`);
    }

    return { approved: p.userID };
  }

  private async answerPeerBlock(msg: RequestMsg): Promise<Answer> {
    this.requireAdmin();

    const p = this.parse('peer.block', msg);

    if (p.userID === this.peer.userID) {
      throw new RelayError('bad_args', 'an admin cannot block themselves');
    }

    const updated = await this.ctx.store.updatePeerStatus(p.userID, 'blocked');

    if (!updated) {
      throw new RelayError('no_such_peer', `no peer with user id ${p.userID}`);
    }

    for (const session of this.ctx.presence.findSessions(p.userID)) {
      this.ctx.presence.remove(session.connID);
    }

    return { blocked: p.userID };
  }

  private async answerMessageSend(msg: RequestMsg): Promise<Answer> {
    const session = this.requireSession();
    const p = this.parse('message.send', msg);

    const result = await routeMessage(this.ctx, session, p.to, p.body);

    return { id: result.id, to: result.to, status: result.status };
  }

  private async answerMessageAck(msg: RequestMsg): Promise<Answer> {
    this.requireAllowed();

    const p = this.parse('message.ack', msg);

    const acked = await this.ctx.store.updateDelivered(p.id, this.ctx.now());

    return { acked };
  }

  private parse<M extends RequestMethod>(method: M, msg: RequestMsg) {
    const parsed = parseRequestParams(method, msg.p);

    if (!parsed.ok) {
      throw new RelayError('bad_args', parsed.message);
    }

    return parsed.data;
  }

  private requireAllowed(): void {
    if (this.peer.status === 'pending') {
      throw new RelayError('peer_pending', 'this peer is waiting for an admin to approve it');
    }
  }

  private requireAdmin(): void {
    this.requireAllowed();

    if (!this.peer.admin) {
      throw new RelayError('unauthorized', 'only an admin can do that');
    }
  }

  // The session this connection registered with hello, which every send
  // is attributed to.
  private requireSession(): PeerSession {
    this.requireAllowed();

    if (this.session === null) {
      throw new RelayError('unauthorized', 'send relay.hello with kind "session" first');
    }

    return this.session;
  }

  private answerError(id: number, code: ErrorCode, msg: string): void {
    this.socket.send(encodeMessage({ v: PROTOCOL_V, id, err: { code, msg } }));
  }
}
