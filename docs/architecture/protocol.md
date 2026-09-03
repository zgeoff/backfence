# Wire protocol

The channel and relay exchange JSON over a WebSocket, one object per text frame, UTF-8. Three
message kinds, distinguished by which fields are present. Every frame carries `v` (protocol version,
currently `1`).

```jsonc
// request  (channel -> relay); id is client-assigned, monotonic per connection
{ "v": 1, "id": 7, "m": "message.send", "p": { "to": "bob/desk", "body": "…" } }

// response (relay -> channel); exactly one per request
{ "v": 1, "id": 7, "ok": { "id": "m_…", "to": "bob/desk", "status": "delivered" } }
{ "v": 1, "id": 7, "err": { "code": "no_such_peer", "msg": "…" } }

// event    (relay -> channel, unsolicited)
{ "v": 1, "ev": "Message", "id": "m_…", "from": "alice/laptop", "fromUser": "alice@example.com", "fromName": "Alice", "body": "…", "sentAt": 1757000000000 }
```

Methods are `noun.verb`; events are PascalCase. Error codes are human-readable strings from a
closed, extendable set: `protocol_mismatch`, `unauthorized`, `unknown_method`, `bad_args`,
`no_such_peer`, `ambiguous_peer`, `peer_pending`, `peer_blocked`, `internal`. An unknown method is
an `unknown_method` error, never a disconnect; unknown fields in any frame are ignored. Both rules
exist so additive evolution never breaks a peer.

## Connection

The relay identifies a connection before it may speak. A socket it cannot identify closes with code
`4001`; one whose peer is unknown under the `refuse` policy closes with `4003`. An identified socket
receives a `Welcome` event, and a client counts its dial as open only then.

The first request must be `relay.hello`, which registers the session:

```jsonc
{ "v": 1, "id": 1, "m": "relay.hello",
  "p": { "client": "backfence/0.1.0", "sessionID": "…", "sessionName": "laptop", "cwd": "/repo", "kind": "session" } }

{ "v": 1, "id": 1, "ok": { "relay": "backfence/0.1.0", "queued": 2,
                           "you": { "userID": "ts:…", "login": "alice@example.com", "displayName": "Alice",
                                    "alias": null, "status": "allowed", "admin": true, "address": "alice@example.com/laptop" } } }
```

A pending peer's hello returns `status: "pending"` and registers nothing; the channel repeats the
hello until an admin approves. `kind: "cli"` identifies a shell client, which may query and
administer but is never listed as a session and cannot send.

## Methods

| Method         | Who     | Params                     | Answer                                   |
| -------------- | ------- | -------------------------- | ---------------------------------------- |
| `relay.hello`  | anyone  | session fields, `kind`     | `relay`, `you`, `queued` (allowed peers) |
| `peer.list`    | allowed | none                       | `sessions`: address, login, cwd, `self`  |
| `message.send` | session | `to`, `body` (≤ 64 KiB)    | `id`, `to`, `status` delivered or queued |
| `message.ack`  | allowed | `id`                       | `acked`                                  |
| `peer.pending` | admin   | none                       | `pending`: userID, login, displayName    |
| `peer.approve` | admin   | `userID`, optional `alias` | `approved`                               |
| `peer.block`   | admin   | `userID`                   | `blocked`                                |

## Delivery

A `message.send` writes the row before anything goes on the wire. A connected target receives a
`Message` event at once and the row waits for `message.ack`; a target that never acks gets the row
again at its next hello. An offline target's row waits for the hello. The relay re-reads the
sender's peer record on every request, so an approve or block takes effect at the peer's next call.
