import type { PeerSession } from './presence';

// The short form is person/session; when another of the person's sessions shares the name, the
// device goes in the middle so each is addressable.
export function formatAddress(
  person: string,
  session: PeerSession,
  siblings: readonly PeerSession[],
): string {
  const shared = siblings.some(
    (s) => s.connID !== session.connID && s.sessionName === session.sessionName,
  );

  return shared
    ? `${person}/${session.device}/${session.sessionName}`
    : `${person}/${session.sessionName}`;
}
