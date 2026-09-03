// backfence CLI entry: `relay` serves the tailnet, `channel` is the MCP
// server Claude Code spawns, and `peers` and `approve` are the shell views
// of what the channel's tools do.
import { defineCommand, runMain } from 'citty';
import pkg from '../package.json';
import { RelayClient } from './channel/relay-client';
import { RelayError } from './protocol/relay-error';
import { dbFile, loadConfig } from './shared/config';

const build = `backfence/${pkg.version}`;

const main = defineCommand({
  meta: {
    name: 'backfence',
    version: pkg.version,
    description: "Message other people's Claude Code sessions over your tailnet",
  },
  subCommands: {
    relay: () =>
      defineCommand({
        meta: { name: 'relay', description: 'Run the relay in the foreground' },
        args: {
          host: { type: 'string', description: 'Address to bind; use the tailnet address' },
          port: { type: 'string', description: 'Port to bind' },
          db: { type: 'string', description: 'SQLite file for peers and queued messages' },
          identity: { type: 'string', description: 'tailscale (default) or dev' },
          'unknown-peers': { type: 'string', description: 'knock (default) or refuse' },
          admin: { type: 'string', description: 'Admin login; repeat the flag for several' },
        },
        async run(ctx) {
          const relay = await import('./relay/start-relay');

          const cfg = loadConfig().relay;
          const admins = collectStrings(ctx.args.admin);
          const identity = ctx.args.identity === 'dev' ? 'dev' : cfg.identity;
          const unknownPeersArg = ctx.args['unknown-peers'];

          const unknownPeers =
            unknownPeersArg === 'refuse' || unknownPeersArg === 'knock'
              ? unknownPeersArg
              : cfg.unknownPeers;

          const handle = await relay.startRelay({
            host: ctx.args.host ?? cfg.host,
            port: ctx.args.port === undefined ? cfg.port : Number(ctx.args.port),
            dbPath: ctx.args.db ?? dbFile,
            identity,
            unknownPeers,
            admins: admins.length > 0 ? admins : cfg.admins,
            build,
          });

          process.stderr.write(
            `${build} relay listening on ${handle.url} (identity: ${identity}, unknown peers: ${unknownPeers})\n`,
          );

          const stop = () => {
            void (async () => {
              await handle.stop();

              process.exit(0);
            })();
          };

          process.on('SIGINT', stop);
          process.on('SIGTERM', stop);
        },
      }),
    channel: () =>
      defineCommand({
        meta: { name: 'channel', description: 'Run the channel MCP server over stdio' },
        args: {
          relay: { type: 'string', description: 'Relay WebSocket URL' },
        },
        async run(ctx) {
          const channel = await import('./channel/run-channel-server');
          const session = await import('./channel/read-session-identity');

          await channel.runChannelServer({
            relayURL: ctx.args.relay ?? loadConfig().channel.relay,
            identity: session.readSessionIdentity(),
            build,
          });
        },
      }),
    peers: () =>
      defineCommand({
        meta: { name: 'peers', description: 'List connected sessions and pending peers' },
        args: {
          relay: { type: 'string', description: 'Relay WebSocket URL' },
        },
        async run(ctx) {
          await withRelay(ctx.args.relay, async (client) => {
            const sessions = await client.sendRequest('peer.list');

            process.stdout.write(`${JSON.stringify(sessions['sessions'], null, 2)}\n`);

            const pending = await tryReadPending(client);

            if (pending !== null) {
              process.stdout.write(`pending: ${JSON.stringify(pending, null, 2)}\n`);
            }
          });
        },
      }),
    approve: () =>
      defineCommand({
        meta: { name: 'approve', description: 'Approve a pending peer' },
        args: {
          user: { type: 'positional', description: 'The user id from `backfence peers`' },
          alias: { type: 'string', description: 'Short name for addresses' },
          relay: { type: 'string', description: 'Relay WebSocket URL' },
        },
        async run(ctx) {
          await withRelay(ctx.args.relay, async (client) => {
            await client.sendRequest('peer.approve', {
              userID: ctx.args.user,
              alias: ctx.args.alias ?? '',
            });

            process.stdout.write(`approved ${ctx.args.user}\n`);
          });
        },
      }),
  },
});

await runMain(main);

async function withRelay(
  url: string | undefined,
  run: (client: RelayClient) => Promise<void>,
): Promise<void> {
  const client = await RelayClient.open({ url: url ?? loadConfig().channel.relay });

  try {
    await client.sendRequest('relay.hello', {
      client: build,
      sessionID: `cli-${process.pid}`,
      sessionName: 'cli',
      kind: 'cli',
    });

    await run(client);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'error'}\n`);

    process.exitCode = 1;
  } finally {
    client.dispose();
  }
}

// Null for a caller who is not an admin: the pending list is theirs to see.
async function tryReadPending(client: RelayClient): Promise<unknown> {
  try {
    const answer = await client.sendRequest('peer.pending');

    return answer['pending'];
  } catch (error) {
    if (error instanceof RelayError && error.code === 'unauthorized') {
      return null;
    }

    throw error;
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return value === '' ? [] : [value];
  }

  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
