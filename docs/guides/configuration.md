# Configuration

backfence reads `~/.config/backfence/config.json` and writes the defaults there on first run. A
malformed field falls back to its default; a malformed file falls back to all defaults. CLI flags
override the file.

```json
{
  "relay": {
    "host": "127.0.0.1",
    "port": 7477,
    "identity": "tailscale"
  },
  "channel": {
    "relay": "ws://127.0.0.1:7477/ws"
  }
}
```

## Relay

| Key        | Flag         | Values             | Meaning                                                                   |
| ---------- | ------------ | ------------------ | ------------------------------------------------------------------------- |
| `host`     | `--host`     | address            | Bind address. Use the machine's tailnet address so only peers reach it.   |
| `port`     | `--port`     | number             | Bind port.                                                                |
| `identity` | `--identity` | `tailscale`, `dev` | Where identity comes from. `dev` trusts request headers and is for tests. |

The database path defaults to `~/.local/state/backfence/backfence.db`; `--db` overrides it.

## Channel

| Key     | Flag      | Meaning                                    |
| ------- | --------- | ------------------------------------------ |
| `relay` | `--relay` | The relay's WebSocket URL, ending in `/ws` |

The channel takes its session id and project directory from the environment Claude Code sets, and
its session name from Claude Code's session registry. `BACKFENCE_SESSION_NAME` overrides the name.

## Identity in dev mode

With `identity: "dev"` the relay reads `x-backfence-dev-login`, `x-backfence-dev-name`, and
`x-backfence-dev-node` from the WebSocket upgrade request and keys the peer as `dev:<login>`. A
connection without the login header is refused with code `4001`. Never expose a dev-mode relay
beyond localhost.
