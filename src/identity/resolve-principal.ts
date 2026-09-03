import type { IdentityMode } from '../shared/config';
import { parseWhoIs } from './parse-whois';
import type { Principal } from './principal';

export interface ConnectionOrigin {
  readonly remoteAddress: string;
  readonly headers: Readonly<Headers>;
}

export const TAILSCALE_SOCKET = '/var/run/tailscale/tailscaled.sock';

// In tailscale mode the answer comes from tailscaled's whois for the peer's address, so a client
// can never claim an identity; dev mode trusts two request headers, for tests only.
export async function resolvePrincipal(
  origin: ConnectionOrigin,
  mode: IdentityMode,
  socketPath = TAILSCALE_SOCKET,
): Promise<Principal | null> {
  if (mode === 'dev') {
    return resolveDevPrincipal(origin.headers);
  }

  const addr = origin.remoteAddress.includes(':')
    ? `[${origin.remoteAddress}]:0`
    : `${origin.remoteAddress}:0`;

  try {
    const response = await fetch(
      `http://local-tailscaled.sock/localapi/v0/whois?addr=${encodeURIComponent(addr)}`,
      { unix: socketPath },
    );

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();

    return parseWhoIs(body);
  } catch {
    return null;
  }
}

function resolveDevPrincipal(headers: Readonly<Headers>): Principal | null {
  const login = headers.get('x-backfence-dev-login');

  if (login === null || login === '') {
    return null;
  }

  return {
    userID: `dev:${login}`,
    login,
    displayName: headers.get('x-backfence-dev-name') ?? login,
    nodeID: 'dev',
    nodeName: 'dev',
    caps: {},
  };
}
