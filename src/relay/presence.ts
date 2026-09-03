import type { Principal } from '../identity/principal';
import type { PeerRecord } from '../store/peer-store';

export interface PeerSession {
  readonly connID: number;
  readonly principal: Principal;
  readonly peer: PeerRecord;
  readonly sessionID: string;
  readonly sessionName: string;
  readonly cwd: string;
  readonly mode: string;
  readonly connectedAt: number;
  readonly send: (frame: string) => void;
}

/**
 * The in-memory roster of connected sessions, keyed by connection. A
 * session is present from a successful hello until its socket closes.
 */
export class Presence {
  private readonly sessions = new Map<number, PeerSession>();

  register(session: PeerSession): void {
    this.sessions.set(session.connID, session);
  }

  remove(connID: number): void {
    this.sessions.delete(connID);
  }

  collectSessions(): PeerSession[] {
    return [...this.sessions.values()].toSorted((a, b) => a.connectedAt - b.connectedAt);
  }

  // Every session of one peer, narrowed to one name when given.
  findSessions(userID: string, sessionName?: string): PeerSession[] {
    return this.collectSessions().filter(
      (s) =>
        s.peer.userID === userID && (sessionName === undefined || s.sessionName === sessionName),
    );
  }
}
