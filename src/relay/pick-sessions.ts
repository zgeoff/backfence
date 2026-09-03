import type { PeerSession } from './presence';

// The rest of an address is device/session when a device of that person matches; otherwise the
// whole rest is the session name, slashes included.
export function pickSessions(sessions: readonly PeerSession[], rest: string | null): PeerSession[] {
  if (rest === null) {
    return [...sessions];
  }

  const slash = rest.indexOf('/');

  if (slash !== -1) {
    const device = rest.slice(0, slash).trim();
    const name = rest.slice(slash + 1).trim();
    const byDevice = sessions.filter((s) => s.device === device && s.sessionName === name);

    if (byDevice.length > 0) {
      return byDevice;
    }
  }

  return sessions.filter((s) => s.sessionName === rest);
}
