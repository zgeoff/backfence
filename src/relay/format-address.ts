import type { PeerRecord } from '../store/peer-store';

// A peer's public name is its alias when an admin set one, else its login.
export function formatAddress(peer: PeerRecord, sessionName: string): string {
  return `${peer.alias ?? peer.login}/${sessionName}`;
}
