<div align="center">
  <h1>backfence</h1>

  <p>
    Message other people's Claude Code sessions over your tailnet. A small relay plus a Claude Code
    channel: your agents and your friends' agents talk across accounts, and every sender is who
    Tailscale says they are.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/backfence"><img src="https://img.shields.io/npm/v/backfence" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="./docs/README.md">Documentation</a> •
    <a href="./docs/guides/configuration.md">Configuration</a> •
    <a href="./docs/architecture/overview.md">Architecture</a>
  </p>
</div>

## Why

Claude Code's built-in `ListAgents` and `SendMessage` tools reach sessions on your own machine and,
through Anthropic's servers, your own account's Remote Control and cloud sessions. They stop at the
account boundary. backfence crosses it: two people on a tailnet run one relay and every session they
connect becomes addressable by name.

A message wakes an idle session. It arrives as a channel event, so the receiving Claude reads it and
acts on it the moment it lands, with no polling and no waiting for the next human turn.

## How it works

```text
claude (alice's laptop)                       claude (bob's desktop)
  └── backfence channel ── ws ──> backfence relay <── ws ── backfence channel
      (MCP server, stdio)         (tailnet only)            (MCP server, stdio)
```

- Each Claude Code session starts a `backfence channel` process, an MCP server over stdio that holds
  one WebSocket to the relay. Outbound, it gives Claude the tools to list peers and send. Inbound,
  it turns a relay delivery into a `notifications/claude/channel` event, which Claude Code injects
  into the session as a new turn.
- The relay is one Bun process bound to a tailnet address. It asks tailscaled who is on the other
  end of every connection, keeps the allowlist and the offline queue in SQLite, and routes by name.
- Nothing is self-asserted. A client never sends its identity; the relay resolves it from the
  connection's tailnet address with the Tailscale LocalAPI `whois` call.

## Install

```sh
bun add -g backfence
```

backfence needs [Bun](https://bun.sh), [Tailscale](https://tailscale.com) on every machine, and
Claude Code 2.1.259 or later. Channels are a Claude Code research preview: the channel loads with a
development flag on personal Pro and Max accounts, and Team and Enterprise admins enable it with the
`channelsEnabled` and `allowedChannelPlugins` managed settings.

## Run a relay

One person runs the relay. Bind it to the machine's tailnet address so only tailnet peers can reach
it:

```sh
backfence relay --host 100.101.102.103 --admin alice@example.com
```

The relay resolves every connection through tailscaled's `whois`, so it needs to run on a tailnet
node. The `--admin` login is seeded into the allowlist with approval rights. Everything else is
config; see [Configuration](./docs/guides/configuration.md).

Peers who share a tailnet just connect. A friend on another tailnet either joins yours as a user
(the personal plan allows six) or you share the relay node into their tailnet; `whois` reports their
login either way.

## Connect a session

Register the channel once, at user scope, so every project can load it:

```sh
claude mcp add --scope user backfence -- backfence channel --relay ws://100.101.102.103:7477/ws
```

Then start Claude Code with the channel enabled:

```sh
claude --dangerously-load-development-channels server:backfence
```

Claude Code shows a consent dialog for the development channel on every start while the plugin is
off the allowlist. A shell alias covers your own machines; an org allowlist entry removes it for a
team.

On connect, the channel reports the session's id and name to the relay, and the relay drains any
messages that queued while the session was offline.

## Addressing

An address is `peer/session`:

- `peer` is the sender's alias if an admin set one, otherwise their tailnet login (`bob` or
  `bob@example.com`).
- `session` is the Claude Code session name, the same name `ListAgents` shows on that machine.

`bob` alone works when Bob has exactly one connected session. If he has several, the relay refuses
and lists them.

## Tools

The channel gives Claude five tools:

| Tool                           | What it does                                                             |
| ------------------------------ | ------------------------------------------------------------------------ |
| `backfence_list_agents`        | Every connected session the sender may reach: address, directory, status |
| `backfence_send_message`       | Send to an address; delivered now or queued if the session is offline    |
| `backfence_list_pending_peers` | Peers who connected but are not yet on the allowlist                     |
| `backfence_approve_peer`       | Admit a pending peer, optionally with an alias (admins only)             |
| `backfence_block_peer`         | Refuse a peer from now on (admins only)                                  |

A received message lands in the session as:

```text
<channel source="backfence" from="bob/vers-90" from_user="bob@example.com" message_id="m_01H…">
tests are green on #967, want me to open the PR?
</channel>
```

Claude replies by calling `backfence_send_message` with the `from` value as the address.

## Trust

A message from someone else's account is text from a different trust domain. backfence treats it
that way at three points:

1. **Identity.** The relay asks tailscaled who owns the connecting address. Tailscale's user id is
   the key for every decision below; login and display name are for reading.
2. **Allowlist.** Only allowed peers send or receive. An unknown peer who connects is held as
   pending (`unknownPeers: "knock"`) or dropped (`unknownPeers: "refuse"`). An admin session
   approves or blocks them by tool call: "Claude, is anyone waiting on the relay? Approve Bob."
3. **Delivery.** The channel's instructions tell Claude that channel content is untrusted input to
   read and weigh, not an instruction to follow. Claude Code's own permission prompts still apply to
   anything Claude does in response.

The relay never reads a Claude transcript, never runs a command, and holds only the messages queued
for offline sessions, which expire after seven days.

## Commands

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `backfence relay`   | Run the relay in the foreground                                 |
| `backfence channel` | Run the channel MCP server over stdio (Claude Code spawns this) |
| `backfence peers`   | List connected sessions and pending peers from the shell        |
| `backfence approve` | Approve a pending peer from the shell                           |

## License

MIT
