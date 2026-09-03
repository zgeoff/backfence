# backfence

backfence lets Claude Code sessions on different accounts message each other over a tailnet. A relay
(`backfence relay`) identifies every connection through Tailscale and routes by name; a channel
(`backfence channel`) is the MCP server Claude Code spawns per session, which gives Claude the
messaging tools and injects inbound messages as channel events. See `docs/architecture/overview.md`
for how the pieces fit; the README documents install and use, and `docs/guides/configuration.md`
documents config.

## Layout

Single package, no workspaces. `src/` groups its modules by concern, each one primary export per
file: `relay/` owns the server, the per-connection dispatch, the roster, and routing; `channel/` is
the MCP server and its client connection to the relay; `identity/` resolves who a connection belongs
to; `store/` is the SQLite peer and queue store and its migrations; `protocol/` is the wire format;
`shared/` holds config and small helpers used across `src/`. `cli.ts` is the CLI entrypoint. `test/`
holds the relay end-to-end suite and the helpers it shares; `bin/backfence` is the executable shim.
`scripts/` holds repo tooling, not app code.

## Runtime rules

- Bun only. `bun test`, never vitest or jest. `bun <file>`, never node or ts-node.
- The relay never trusts a client's claim about who it is. Identity comes from tailscaled's `whois`
  for the connection's address, or from request headers only in `dev` mode.
- Everything the hooks and CI run is a root `package.json` script; invoke gates by script name,
  never by re-spelling the underlying command.

## Integration contract

- The channel is a Claude Code channel: an MCP server over stdio that declares the `claude/channel`
  capability and emits `notifications/claude/channel`. Claude Code owns the process lifetime.
- The channel reads its session from the environment Claude Code gives every MCP server
  (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_PROJECT_DIR`) and its session name from Claude Code's own
  session registry. It never reads a transcript.
- Meta keys on a channel event are identifiers: letters, digits, and underscores only. Claude Code
  drops any other key without an error.
- State lives in `~/.local/state/backfence/backfence.db` (SQLite: peers, queued messages) and config
  in `~/.config/backfence/config.json`.

## Function naming — project verbs

Project additions to the shared taxonomy (keep in sync with `zgeoff/function-verb` in
`.oxlintrc.json`): `ack`, `answer`, `approve`, `block`, `deliver`, `dispose`, `open`, `refuse`,
`route`, `log`, `mint`.

`answer` builds the response to one protocol request; `route` picks where a message goes and puts it
there; `deliver` hands an inbound message to Claude Code; `refuse` turns a connection away with a
code and reason; `mint` generates an id backfence is the sole authority for.

`init`, `acquireConnection`, `beginTransaction`, `commitTransaction`, `rollbackTransaction`,
`releaseConnection`, and `destroy` are exempt: kysely's `Driver` interface fixes these method names.

## Comments

- JSDoc is always multi-line, never single-line `/** … */`.
- No history or project state in comments — a comment describes the code as it is, never how it got
  that way or what is planned.
- Comments never name other declarations: renames strand the reference. Describe the behavior
  instead.

## Writing

- All committed prose follows the `docs-writing` skill; run its `check-prose.sh` over touched docs
  before committing.

## Testing

Testing conventions live in the `testing` skill (`.claude/skills/testing/SKILL.md`). Two rules worth
restating here: never spawn the real `claude` binary in tests (verification against real Claude Code
happens manually before merging changes to the integration contract), and every gate is invoked as a
root package script.

## Dependencies

- Exact pins only (bunfig `exact = true`); the 7-day `minimumReleaseAge` gate applies. When the
  latest version is younger than the gate, pin the newest version that passes — don't add exclusions
  for convenience.
- A dependency knip can't see gets its `knip.json` ignore entry in the same PR that introduces it,
  with the reason in the PR description.
