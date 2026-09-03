# Architecture overview

backfence connects Claude Code sessions that belong to different accounts. Claude Code's own
cross-session messaging stops at the account boundary because its remote leg runs through Anthropic
and is scoped to one login. backfence replaces that leg with a relay the participants run
themselves, and uses Tailscale as the identity provider so the relay never has to believe what a
client claims about itself.

## Process model

```text
claude ──stdio──> backfence channel ──ws──> backfence relay <──ws── backfence channel <──stdio── claude
                  (one per session)         (one per group)          (one per session)
                                              ├── tailscaled whois (identity)
                                              └── SQLite (peers, queued messages)
```

- **Channel.** Claude Code spawns one channel process per session as an MCP server over stdio. The
  channel declares the `claude/channel` capability, which makes Claude Code listen for
  `notifications/claude/channel` events from it, and registers the five backfence tools. It holds
  one WebSocket to the relay for the life of the session, redialing with backoff when it drops.
- **Relay.** One Bun process bound to a tailnet address. On every new socket it asks tailscaled who
  owns the peer address, records the peer, and only then lets the connection speak. It keeps the
  roster of connected sessions in memory and the allowlist and offline queue in SQLite.
- **Identity.** The relay calls the Tailscale LocalAPI `whois` endpoint over tailscaled's unix
  socket with the connection's remote address. The response carries the user's stable id, login, and
  display name, the node's stable id, and any application capabilities the tailnet policy grants
  that peer. The user id keys every allowlist decision.

## A message's path

1. Claude calls `backfence_send_message` with an address and a body.
2. The channel sends `message.send` to the relay.
3. The relay resolves the address: the peer part by alias then login, the session part against the
   roster. It writes the message row first, then, when the target session is connected, sends it a
   `Message` event. Otherwise the row waits.
4. The target channel receives the event, emits a `notifications/claude/channel` notification with
   the body as content and the sender as meta, then acks the message id.
5. Claude Code injects the event into the session as a new turn. An idle session wakes.
6. When a session sends hello, the relay drains every undelivered row addressed to it or to its peer
   with no session named. Rows expire seven days after they were sent.

## Trust

Three gates stand between a foreign account and a session:

- **Identity** is resolved, never claimed. A client sends no credentials; the relay asks tailscaled.
- **The allowlist** is a per-peer status: `allowed`, `pending`, or `blocked`. A peer the relay has
  not seen is held as pending under the `knock` policy or dropped under `refuse`. Only an admin can
  approve or block, and admin rights come from the relay's config, not from a request.
- **Delivery** marks the content as untrusted in the channel's instructions to Claude. Claude Code's
  permission prompts apply to whatever Claude does in response, exactly as they would for any other
  input.

The relay reads no transcripts and runs no commands. It holds message bodies only while they wait
for an offline session.
