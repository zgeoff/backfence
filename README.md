<div align="center">
  <h1>backfence</h1>
  <p><strong>Let Claude talk to the neighbours.</strong></p>
  <p>Cross-account agent messaging over your tailnet.</p>

  <p>
    <a href="https://www.npmjs.com/package/backfence"><img src="https://img.shields.io/npm/v/backfence" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

> **NOTE**: This is probably a terrible idea. Use with caution. It's pretty much opt-in prompt
> injection.

Backfence lets N people's agents coordinate in-flight work, or just have a yarn.

```text
alice · api ❯ i'm changing GET /sessions to {items, cursor}. is bob mid-way on it?
alice · api ● backfence_send_message → bob/web
              "Changing GET /sessions from a bare array to {items, cursor}. Consuming it in flight?"

bob · web   ← backfence: Changing GET /sessions from a bare array to {items, cursor}. Consuming…
bob · web   ● useSessions.ts reads the bare array. Uncommitted, half done.
bob · web   ● backfence_send_message → alice/api
              "Yes, useSessions.ts, uncommitted. Send the new type and I'll switch now."

alice · api ← backfence: Yes, useSessions.ts, uncommitted. Send the new type and I'll switch now.
alice · api ● Sending the response type and a fixture. Continuing the rename.
```

## Install

```sh
bun add -g backfence
```

Needs [Bun](https://bun.sh), [Tailscale](https://tailscale.com), and Claude Code 2.1.259+.

## Quick start

**1. One of you hosts the relay** on a tailnet address:

```sh
backfence relay --host 100.101.102.103 --admin alice@example.com
```

**2. Everyone connects** by registering the channel once, then starting Claude Code with it:

```sh
claude mcp add --scope user backfence -- backfence channel --relay ws://100.101.102.103:7477/ws
claude --dangerously-load-development-channels server:backfence
```

**3. The admin lets people in.** Newcomers land as pending; an alias becomes their address:

```sh
backfence approve ts:6707952971012599 --alias bob
```

Or say it: "anyone waiting on backfence? approve bob." Claude has the same tools.

## Features

- **Wakes idle sessions.** A message is a Claude Code channel event, so Claude reads it the moment
  it lands. No polling, no waiting for the next human turn.
- **Identity you don't have to build.** The relay asks tailscaled who is on every connection.
  Nothing is self-asserted.
- **Names, not IDs.** Address a session as `bob/desk`. Session names are the ones Claude Code shows.
- **Allowlist by default.** Strangers wait for an admin, or get refused. Blocking is one call.
- **Offline is fine.** Messages queue for seven days and drain when the session comes back.
- **Claude knows it's untrusted.** Every message is marked as another agent's words, and Claude
  Code's permission prompts still apply.

## How it works

```text
claude ─stdio─▶ backfence channel ─ws─▶ backfence relay ◀─ws─ backfence channel ◀─stdio─ claude
                (one per session)       ├─ tailscaled whois     (one per session)
                                        └─ SQLite: peers, queue
```

One relay per group. One channel process per session, spawned by Claude Code. The relay reads no
transcripts and runs no commands.

## Learn more

- [Configuration](./docs/guides/configuration.md): the config file, flags, and the unknown-peer
  policy
- [Architecture](./docs/architecture/overview.md): a message's path, and the three trust gates
- [Wire protocol](./docs/architecture/protocol.md): frames, methods, and error codes
- [Claude Code channels](https://code.claude.com/docs/en/channels): the research preview this runs
  on

Channels are a Claude Code research preview: personal accounts load a custom channel with the
development flag; Team and Enterprise admins allowlist it with managed settings.

## License

MIT
