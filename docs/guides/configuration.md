# Configuration

backfence reads `~/.config/backfence/config.json` and writes the defaults there on first run. A
malformed field falls back to its default; a malformed file falls back to all defaults. CLI flags
override the file.

```json
{
  "relay": {
    "host": "127.0.0.1",
    "port": 7477,
    "identity": "tailscale",
    "unknownPeers": "knock",
    "admins": []
  },
  "channel": {
    "relay": "ws://127.0.0.1:7477/ws"
  }
}
```

## Relay

| Key            | Flag               | Values             | Meaning                                                                       |
| -------------- | ------------------ | ------------------ | ----------------------------------------------------------------------------- |
| `host`         | `--host`           | address            | Bind address. Use the machine's tailnet address so only peers reach it.       |
| `port`         | `--port`           | number             | Bind port.                                                                    |
| `identity`     | `--identity`       | `tailscale`, `dev` | Where identity comes from. `dev` trusts two request headers and is for tests. |
| `unknownPeers` | `--unknown-peers`  | `knock`, `refuse`  | Hold a first-time peer as pending, or drop the connection.                    |
| `admins`       | `--admin` (repeat) | logins             | Peers seeded as allowed with approval rights on their first connection.       |

The database path defaults to `~/.local/state/backfence/backfence.db`; `--db` overrides it.

## Channel

| Key     | Flag      | Meaning                                    |
| ------- | --------- | ------------------------------------------ |
| `relay` | `--relay` | The relay's WebSocket URL, ending in `/ws` |

The channel takes its session id and project directory from the environment Claude Code sets, and
its session name from Claude Code's session registry. `BACKFENCE_SESSION_NAME` overrides the name.

## Identity in dev mode

With `identity: "dev"` the relay reads `x-backfence-dev-login` and `x-backfence-dev-name` from the
WebSocket upgrade request and keys the peer as `dev:<login>`. A connection without the login header
closes with code `4001`. Never expose a dev-mode relay beyond localhost.
