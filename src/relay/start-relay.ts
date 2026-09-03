import { Elysia } from 'elysia';
import { TAILSCALE_SOCKET, resolvePrincipal } from '../identity/resolve-principal';
import { PROTOCOL_V, encodeMessage } from '../protocol/protocol';
import type { IdentityMode } from '../shared/config';
import { PeerStore } from '../store/peer-store';
import { Presence } from './presence';
import { RelayConnection } from './relay-connection';
import type { RelayContext } from './relay-connection';

export interface RelayOptions {
  readonly host: string;
  readonly port: number;
  readonly dbPath: string;
  readonly identity: IdentityMode;
  readonly build: string;
  readonly tailscaleSocket?: string;
  readonly now?: () => number;
}

export interface RelayHandle {
  readonly url: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// How long a refused client gets to hang up on its own before the relay
// closes the socket for it.
const REFUSE_GRACE_MS = 1000;

// How long stop waits for the server to drain before moving on.
const STOP_GRACE_MS = 1000;

// Resolves once the socket is bound.
export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const store = await PeerStore.open(options.dbPath);

  const presence = new Presence();

  const ctx: RelayContext = {
    build: options.build,
    store,
    presence,
    now: options.now ?? (() => Date.now()),
  };

  const socketPath = options.tailscaleSocket ?? TAILSCALE_SOCKET;

  const connections = new Map<string, Promise<RelayConnection | null>>();

  const app = new Elysia()
    .get('/health', () => ({ ok: true, relay: options.build }))
    .ws('/ws', {
      open(ws) {
        // A refused client is told why and asked to hang up itself: on this
        // Bun version a server-initiated close leaves `server.stop()` waiting
        // forever, so the relay's own close is only the fallback.
        const refuse = (code: number, reason: string) => {
          ws.send(encodeMessage({ v: PROTOCOL_V, ev: 'Refused', code, reason }));

          setTimeout(() => {
            ws.close(code, reason);
          }, REFUSE_GRACE_MS).unref();
        };

        const opening = (async () => {
          const principal = await resolvePrincipal(
            { remoteAddress: ws.remoteAddress, headers: ws.data.request.headers },
            options.identity,
            socketPath,
          );

          if (principal === null) {
            refuse(4001, 'unidentified');

            return null;
          }

          const connection = await RelayConnection.open(ctx, principal, {
            send: (frame) => {
              ws.send(frame);
            },
            close: (code, reason) => {
              ws.close(code, reason);
            },
          });

          ws.send(encodeMessage({ v: PROTOCOL_V, ev: 'Welcome', relay: options.build }));

          return connection;
        })();

        connections.set(ws.id, opening);
      },
      async message(ws, message) {
        const connection = await connections.get(ws.id);

        if (connection === undefined || connection === null) {
          return;
        }

        const frame = typeof message === 'string' ? message : JSON.stringify(message);

        await connection.applyFrame(frame);
      },
      async close(ws) {
        const connection = await connections.get(ws.id);

        connections.delete(ws.id);
        connection?.dispose();
      },
    })
    .listen({ hostname: options.host, port: options.port });

  const sweep = setInterval(() => {
    void store.removeStaleMessages(ctx.now());
  }, SWEEP_INTERVAL_MS);

  sweep.unref();

  const port = app.server?.port ?? options.port;

  return {
    url: `ws://${options.host}:${port}/ws`,
    port,
    async stop() {
      clearInterval(sweep);

      // Bounded because a socket the relay closed itself keeps the server's
      // stop from ever resolving on this Bun version.
      await Promise.race([app.stop(true), Bun.sleep(STOP_GRACE_MS)]);
      await store.dispose();
    },
  };
}
