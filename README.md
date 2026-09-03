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

## Disclaimer

This is probably a terrible idea. Use with caution. It's pretty much opt-in prompt injection.

## What it does

Claude Code can already message your own sessions. backfence lets it message someone else's. You run
one relay on your tailnet; each of you connects your sessions to it; from then on your Claude can
say "ask bob's desk session whether the tests pass", and Bob's Claude wakes up, checks, and answers
back. Idle sessions wake in about two seconds. Offline sessions get the message when they return.

## Sixty seconds

Everything needs [Bun](https://bun.sh), [Tailscale](https://tailscale.com), and Claude Code 2.1.259
or later.

**One of you hosts the relay.** Bind it to that machine's tailnet address so only tailnet peers can
reach it, and name yourself admin:

```sh
bun add -g backfence
backfence relay --host 100.101.102.103 --admin alice@example.com
```

**Everyone connects their sessions.** Register the channel once at user scope, then start Claude
Code with it loaded:

```sh
bun add -g backfence
claude mcp add --scope user backfence -- backfence channel --relay ws://100.101.102.103:7477/ws
claude --dangerously-load-development-channels server:backfence
```

**The admin lets people in.** A newcomer's first connection lands as pending. Approve them with an
alias, which becomes the first half of their address:

```sh
backfence peers
backfence approve ts:6707952971012599 --alias bob
```

Or just tell your Claude: "anyone waiting on backfence? approve bob." It has the same tools.

## What a conversation looks like

Alice, in a session named `vers-90`, asks her Claude to check with Bob:

```text
❯ ask bob's desk session whether #967 is green yet
● backfence_send_message(to: "bob/desk", message: "Is #967 green on your side?")
  delivered to bob/desk (message m_1k3f2d…)
```

Bob's session is idle. It wakes with the message on screen and in context:

```text
← backfence: Is #967 green on your side?
● Checking. Tests pass on main as of 7:41 PM.
● backfence_send_message(to: "alice/vers-90", message: "Yes, #967 is green as of 7:41 PM.")
```

Alice's session wakes with the answer the same way. Every message arrives as a channel event that
Claude reads as untrusted input from another person's agent:

```text
<channel source="backfence" from="bob/desk" from_user="bob@example.com" message_id="m_1k3f2e…">
Yes, #967 is green as of 7:41 PM.
</channel>
```

## Addresses

An address is `peer/session`. The peer is the alias an admin gave, or the tailnet login. The session
is the Claude Code session name, the one `/rename` sets and `ListAgents` shows. A bare peer works
when they have exactly one session connected; with several, the relay lists them and asks you to
pick.

## Tools

The channel gives Claude five tools:

| Tool                           | What it does                                                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `backfence_list_agents`        | Every connected session you may reach: address, owner, directory          |
| `backfence_send_message`       | Send to an address; delivered now, or queued while the session is offline |
| `backfence_list_pending_peers` | Peers who connected but are not yet approved (admins)                     |
| `backfence_approve_peer`       | Admit a pending peer, optionally with an alias (admins)                   |
| `backfence_block_peer`         | Refuse a peer from now on (admins)                                        |

## Who gets in

- **Identity is resolved, never claimed.** The relay asks tailscaled who owns each connecting
  address. A client sends no credentials and cannot pretend to be someone else.
- **Only approved peers send or receive.** A stranger who connects is held as pending, or dropped
  outright with `unknownPeers: "refuse"`. Admins come from the relay's config, not from a request.
- **Claude treats every message as untrusted.** The channel's instructions say so, and Claude Code's
  permission prompts still apply to anything Claude does in response.

A friend on another tailnet either joins yours as a user (the personal plan allows six) or you share
the relay node into their tailnet; either way tailscaled reports their login.

## Day to day

- The development-channel dialog appears on every start while the plugin is off Claude Code's
  allowlist. An alias such as
  `alias cc='claude --dangerously-load-development-channels server:backfence'` removes the typing.
- `backfence peers` shows who is connected and, for admins, who is waiting.
- Messages to an offline session queue on the relay for seven days and drain when it next connects.
- The relay keeps peers and queued messages in `~/.local/state/backfence/backfence.db` and reads
  `~/.config/backfence/config.json`. See [Configuration](./docs/guides/configuration.md).

## Under the hood

- The channel is a Claude Code [channel](https://code.claude.com/docs/en/channels): an MCP server
  over stdio that pushes events into a session. Claude Code spawns one per session; it holds one
  WebSocket to the relay.
- The relay is one Bun process with a WebSocket endpoint, tailscaled's `whois` for identity, and
  SQLite for the allowlist and the queue. It reads no transcripts and runs no commands.
- The [architecture](./docs/architecture/overview.md) and
  [protocol](./docs/architecture/protocol.md) pages cover the rest.

Channels are a Claude Code research preview. Personal Pro and Max accounts load a custom channel
with the development flag; Team and Enterprise admins enable channels and allowlist the plugin with
managed settings. Not available on Bedrock, Vertex, or Foundry.

## License

MIT
