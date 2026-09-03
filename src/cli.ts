// backfence CLI entry: `relay` serves the tailnet, `channel` is the MCP
// server Claude Code spawns, and the rest are the shell views of what the
// channel's tools do.
import { defineCommand, runMain } from 'citty';
import pkg from '../package.json';
import { RelayClient } from './channel/relay-client';
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
          db: { type: 'string', description: 'SQLite file for consent edges and messages' },
          identity: { type: 'string', description: 'tailscale (default) or dev' },
        },
        async run(ctx) {
          const relay = await import('./relay/start-relay');

          const cfg = loadConfig().relay;
          const identity = ctx.args.identity === 'dev' ? 'dev' : cfg.identity;

          const handle = await relay.startRelay({
            host: ctx.args.host ?? cfg.host,
            port: ctx.args.port === undefined ? cfg.port : Number(ctx.args.port),
            dbPath: ctx.args.db ?? dbFile,
            identity,
            build,
          });

          process.stderr.write(
            `${build} relay listening on ${handle.url} (identity: ${identity})\n`,
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
        meta: { name: 'peers', description: 'List reachable sessions and your consent edges' },
        args: {
          relay: { type: 'string', description: 'Relay WebSocket URL' },
        },
        async run(ctx) {
          await withRelay(ctx.args.relay, async (client) => {
            const sessions = await client.sendRequest('peer.list');
            const edges = await client.sendRequest('peer.edges');

            process.stdout.write(`sessions: ${JSON.stringify(sessions['sessions'], null, 2)}\n`);
            process.stdout.write(`edges: ${JSON.stringify(edges['edges'], null, 2)}\n`);
          });
        },
      }),
    accept: () =>
      defineDecisionCommand('accept', 'Accept a person; the channel opens once both sides have'),
    decline: () =>
      defineDecisionCommand('decline', 'Decline a knock; they may knock again after 24 hours'),
    block: () => defineDecisionCommand('block', 'Block a person until you accept them'),
  },
});

await runMain(main);

function defineDecisionCommand(verb: 'accept' | 'decline' | 'block', description: string) {
  return defineCommand({
    meta: { name: verb, description },
    args: {
      peer: { type: 'positional', description: 'A person name or login' },
      relay: { type: 'string', description: 'Relay WebSocket URL' },
    },
    async run(ctx) {
      await withRelay(ctx.args.relay, async (client) => {
        const ok = await client.sendRequest(`peer.${verb}`, { peer: ctx.args.peer });

        const open = ok['open'] === true ? ' (open)' : '';

        process.stdout.write(`${verb}ed ${String(ok['person'])} <${String(ok['login'])}>${open}\n`);
      });
    },
  });
}

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
