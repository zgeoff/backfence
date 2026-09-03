export interface Address {
  readonly person: string;
  readonly rest: string | null;
}

// Everything after the first slash names the session, or the device and the session; the
// session part may hold spaces, since Claude Code session names do.
export function parseAddress(raw: string): Address | null {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf('/');

  if (slash === -1) {
    return trimmed === '' ? null : { person: trimmed, rest: null };
  }

  const person = trimmed.slice(0, slash).trim();
  const rest = trimmed.slice(slash + 1).trim();

  if (person === '') {
    return null;
  }

  return { person, rest: rest === '' ? null : rest };
}
