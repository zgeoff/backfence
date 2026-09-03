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
`no_such_peer`, `ambiguous_peer`, `not_accepted`, `internal`. An unknown method is an
`unknown_method` error, never a disconnect; unknown fields in any frame are ignored. Both rules
exist so additive evolution never breaks a peer.

## Connection

The relay identifies a connection before it may speak. A socket it cannot identify receives a
`Refused` event with code `4001` and is expected to hang up. An identified socket receives a
`Welcome` event, and a client counts its dial as open only then. Every identified connection may
speak: the tailnet is the allowlist.

The first request must be `relay.hello`, which registers the session:

```jsonc
{ "v": 1, "id": 1, "m": "relay.hello",
  "p": { "client": "backfence/0.1.0", "sessionID": "…", "sessionName": "laptop", "cwd": "/repo", "kind": "session" } }

{ "v": 1, "id": 1, "ok": { "relay": "backfence/0.1.0", "queued": 2, "knocks": 1,
                           "you": { "userID": "ts:…", "login": "alice@example.com", "displayName": "Alice",
                                    "person": "alice", "device": "laptop", "address": "alice/laptop" } } }
```

`kind: "cli"` identifies a shell client, which may query and decide but is never listed as a session
and cannot send. After the answer the relay replays every queued `Message` for the session and a
`Knock` for every person still waiting on the caller.

## Names

Every name is derived from the identity tailscaled reports; nothing is configured.

- **Person** is the Tailscale display name in kebab case (`Geoff Whatley` is `geoff-whatley`). When
  two people on the relay share a display name, both are shown by login instead. A login is always
  accepted where a person is expected, and it is the only name a sender has for a person whose pair
  is not yet open. `fromUser` and `login` fields always carry the login.
- **Device** is the tailnet node's short name, the first label of its DNS name.
- **Session** is the Claude Code session name, which may hold spaces.

A session's address is `person/session`. When two of a person's connected sessions share a name,
each is shown as `person/device/session`, and a bare `person/session` for that name is refused with
`ambiguous_peer` listing the long forms. A bare `person` addresses their only session.

## Consent

The relay opens a pair only when both people have accepted each other. It keeps one edge per pair
holding each side's decision: `none`, `accepted`, `declined`, or `blocked`.

Sending is the sender's consent. A `message.send` to a person whose side is not `accepted` never
delivers the body. Instead it holds the message (one per pair, the newest replaces the older) and
answers `status: "knocked"`. When the receiver's side is `none`, every connected session of the
receiver gets a `Knock` event, identity only:

```jsonc
{
  "v": 1,
  "ev": "Knock",
  "from": "alice/laptop",
  "person": "alice",
  "login": "alice@example.com",
  "displayName": "Alice",
  "node": "laptop",
  "sessionName": "laptop",
  "knockedAt": 1757000000000,
}
```

The receiver decides with `peer.accept`, `peer.decline`, or `peer.block`:

- `accept` sets the caller's side to `accepted`. It works on a knock, on a person the caller
  declined or blocked earlier, and on a person who never knocked. When the other side is also
  `accepted`, the pair is open: the other person's sessions get an `Accepted` event and the held
  message delivers as a normal `Message`.
- `decline` drops the held message. The sender's next send holds again, silently; a fresh `Knock`
  goes out only when the last one is older than 24 hours.
- `block` drops the held message and holds nothing further. No `Knock` goes out until the caller
  accepts.

The sender cannot tell a decline or a block from a knock still waiting: every one of them answers
`knocked`. A send to a person the caller has declined or blocked fails with `not_accepted`, as does
a send to a person whose knock the caller has not answered; `peer.accept` lifts both. A person who
accepted the caller without knocking is open to the caller's first send, which delivers at once.

```jsonc
{ "v": 1, "ev": "Accepted", "person": "bob", "login": "bob@example.com", "displayName": "Bob" }
```

## Methods

| Method         | Who     | Params                  | Answer                                             |
| -------------- | ------- | ----------------------- | -------------------------------------------------- |
| `relay.hello`  | anyone  | session fields, `kind`  | `relay`, `you`, `queued`, `knocks`                 |
| `peer.list`    | anyone  | none                    | `sessions` of open pairs plus self                 |
| `peer.edges`   | anyone  | none                    | `edges`: person, login, `you`, `them`, dates       |
| `peer.accept`  | anyone  | `peer`                  | `person`, `login`, `open`                          |
| `peer.decline` | anyone  | `peer`                  | `person`, `login`                                  |
| `peer.block`   | anyone  | `peer`                  | `person`, `login`                                  |
| `message.send` | session | `to`, `body` (≤ 64 KiB) | `id`, `to`, `status` delivered, queued, or knocked |
| `message.ack`  | anyone  | `id`                    | `acked`                                            |

`peer` is a person name or a login. A `peer.list` entry carries `address`, `person`, `device`,
`session`, `login`, `displayName`, `cwd`, `mode`, `connectedAt`, and `self`. A `peer.edges` entry
carries `person`, `login`, `displayName`, `you`, `them`, `decidedAt` (the caller's side), and
`knockedAt`. `them` is `accepted` or `none`: the other side's decline or block is never shown.

## Delivery

A `message.send` to an open pair writes the row before anything goes on the wire. A connected target
receives a `Message` event at once and the row waits for `message.ack`; a target that never acks
gets the row again at its next hello. An offline target's row waits for the hello. The relay
re-reads the edge on every send, so a decision takes effect at the peer's next call. Queued rows and
held messages expire seven days after they were sent.
