export interface Address {
  readonly peer: string;
  readonly session: string | null;
}

// The session part may hold spaces, since Claude Code session names do.
export function parseAddress(raw: string): Address | null {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf('/');

  if (slash === -1) {
    return trimmed === '' ? null : { peer: trimmed, session: null };
  }

  const peer = trimmed.slice(0, slash).trim();
  const session = trimmed.slice(slash + 1).trim();

  if (peer === '') {
    return null;
  }

  return { peer, session: session === '' ? null : session };
}
