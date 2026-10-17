# Agent Guidelines

backfence lets Claude Code sessions on different accounts message each other over a tailnet. A relay
(`backfence relay`) identifies every connection through Tailscale and routes by name. A channel
(`backfence channel`) is the MCP server that Claude Code spawns for each session: it gives Claude
the messaging tools and injects inbound messages as channel events.

## Required reading

The rules a task needs are not repeated here. Load the skill for the work before starting it.

| Skill          | Load before                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `docs-writing` | writing or editing any committed prose: `docs/`, READMEs, this file, skills |
| `testing`      | designing, writing, or reviewing tests                                      |

`docs/architecture/overview.md` explains how the relay, the channel and the store fit together. The
README covers install and use, and `docs/guides/configuration.md` covers config.

## Repo structure

backfence is one Bun package, with no workspaces.

```text
src/
  relay/       the server, the dispatch for each connection, the roster, and routing
  channel/     the MCP server and its client connection to the relay
  identity/    resolves who a connection belongs to
  store/       the SQLite store for users, consent edges, held and queued messages, and its
               migrations
  protocol/    the wire format
  shared/      config and small helpers that the other folders share
  cli.ts       the CLI entrypoint
test/          the relay end-to-end suite and the helpers it shares
bin/backfence  the executable shim
scripts/       repo tooling, never app code
docs/
  architecture/  how the pieces fit
  guides/        steps a user does
```

## Commands

- Bun only. Run tests with `bun test`, never vitest or jest. Run a file with `bun <file>`, never
  node or ts-node.
- Everything the hooks and CI run is a root `package.json` script. Invoke each gate by its script
  name, never by spelling out the command under it.
- lefthook runs the fixers, commitlint and gitleaks before a commit, and the full gates before a
  push.

## Runtime rules

- The relay never trusts what a client says about who it is. Identity comes from the tailscaled
  `whois` lookup for the connection's address. Only in `dev` mode does it come from request headers.

## Integration contract

- The channel is a Claude Code channel: an MCP server over stdio that declares the `claude/channel`
  capability and emits `notifications/claude/channel`. Claude Code owns the process lifetime.
- The channel reads its session from the environment that Claude Code gives every MCP server
  (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_PROJECT_DIR`). It reads the session name from the Claude Code
  session registry, unless `BACKFENCE_SESSION_NAME` sets one. It never reads a transcript.
- Meta keys on a channel event are identifiers: letters, digits and underscores only. Claude Code
  drops any other key without an error.
- State lives in `~/.local/state/backfence/backfence.db` and config in
  `~/.config/backfence/config.json`.

## Code style

oxfmt, oxlint and format-codemod enforce the mechanical rules, so this section covers only what
tooling can't check.

- One primary export per file, and the file name kebab-cases that export (`with-jest-context.ts`
  exports `withJestContext`). Three exceptions:
  - `index.ts` entrypoints
  - `types.ts` for a package's shared types
  - side-effect-only modules, named for what they do (`augment-bun-test.ts`)
- Module order: imports, the primary export, then private helpers in composition order, depth first.
  Never put helpers first.
- A supporting declaration (a const, an interface, a type alias) sits directly above its first use,
  never below it and never at the top of the file. Types for the primary export's signature may sit
  just above it.
- Acronyms stay uppercase in identifiers (`runCLI`, `parseCLIArgs`, `ASTNode`, `pkgURL`,
  `isPackageJSON`). One exception: an acronym that starts a camelCase name lowercases whole
  (`cliPath`, `astNode`).
- ID counts as an acronym: `userID`, `sessionID`, never `userId`, and `idToken` when it starts a
  name. File names kebab-case everything (`parse-cli-args.ts` exports `parseCLIArgs`).

### Comments

- No JSDoc. A comment is a run of at most three `//` lines. It holds only what neither the code, a
  type, a test name nor the subsystem doc can hold: the reason a line does the non-obvious thing.
- A comment describes the code as it is, never how it got that way or what is planned.
- Never refer to another declaration by name in a comment, because a rename strands the reference.
  Describe the behavior instead.

### Function naming

Every function name starts with a prefix from the closed list below. The `zgeoff/function-verb` lint
rule enforces the list. The prefix is a contract: a reader knows the function's shape without
opening it.

**Predicates** — return boolean, no side effects:

| Prefix   | Contract                | Example          |
| -------- | ----------------------- | ---------------- |
| `is`     | type or state test      | `isVarDecl`      |
| `has`    | containment, possession | `hasBlankLine`   |
| `can`    | capability              | `canResize`      |
| `should` | policy decision         | `shouldSkipFile` |
| `needs`  | requirement             | `needsBlankLine` |

**Pure producers** — result comes from arguments alone, no side effects:

| Prefix                        | Contract                                                                  | Example             |
| ----------------------------- | ------------------------------------------------------------------------- | ------------------- |
| `build<Result>[From<Source>]` | default constructor for values; drop `From<Source>` when no single source | `buildEditsFromAST` |
| `define<X>`                   | identity; its only job is compile-time constraint of its literal argument | `defineErrors`      |
| `parse`                       | unstructured input → structure, invalid input reported                    | `parseSource`       |
| `encode`                      | structure → its defined compact or wire form, reversed by `decode`        | `encodeState`       |
| `decode`                      | `encode`'s output → the original structure, malformed input reported      | `decodeState`       |
| `derive`                      | one-way cryptographic derivation from secret material                     | `deriveAvatarKey`   |
| `plan`                        | compute an action without performing it                                   | `planGapEdit`       |
| `pick`                        | select among known alternatives                                           | `pickMode`          |
| `find`                        | search that can miss — null/undefined on miss                             | `findPrevious`      |
| `get`                         | cheap access that cannot miss (throwing on a broken invariant is fine)    | `getNodeEnd`        |
| `collect`                     | gather from a traversal or scan                                           | `collectChildNodes` |
| `count`                       | how many                                                                  | `countNewlines`     |
| `split`                       | one value → parts                                                         | `splitLines`        |
| `merge`                       | parts → one value                                                         | `mergeWindows`      |
| `sort`                        | reorder                                                                   | `sortEdits`         |
| `format`                      | value → human-readable string                                             | `formatRange`       |
| `render`                      | structure → output text or markup                                         | `renderHunk`        |
| `normalize`                   | variant forms → the canonical form                                        | `normalizePath`     |
| `resolve`                     | follow indirection to a concrete value                                    | `resolveBinPath`    |
| `expand`                      | compact form → full form                                                  | `expandInputs`      |
| `compress`                    | value → its reversible compact encoding                                   | `compressGraph`     |
| `decompress`                  | reverse a `compress` encoding (non-encoded shorthand is `expand`)         | `decompressGraph`   |
| `to<Result>`                  | cheap representation change                                               | `toPosixPath`       |
| `transform`                   | a package's own source→source operation                                   | `transform`         |

**Effectful** — touches the world (filesystem, streams, processes, registries):

| Prefix         | Contract                                                                                                                                | Example            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `apply`        | perform previously planned changes                                                                                                      | `applyEdits`       |
| `create`       | bring a resource into existence (file, directory, process)                                                                              | `createWorkDir`    |
| `claim`        | atomically take exclusive ownership of a work item or resource; ownership ends at commit or an explicit release                         | `claimNextChain`   |
| `read`         | pull raw content from filesystem or network into memory                                                                                 | `readSource`       |
| `load`         | read **and** parse into a ready structure                                                                                               | `loadConfig`       |
| `write`        | persist to the filesystem                                                                                                               | `writeOutput`      |
| `remove`       | delete a resource                                                                                                                       | `removeStaleDist`  |
| `update`       | mutate existing state or resource in place                                                                                              | `updateIndex`      |
| `upsert`       | single-statement insert-or-update keyed by a natural or composite key, refreshing the conflicting row's columns in place                | `upsertUser`       |
| `set`          | assign a store's named state slice wholesale — the store-setter idiom; partial mutation is `update`                                     | `setSelectedNode`  |
| `toggle<Flag>` | invert a boolean state slice                                                                                                            | `toggleDevCamera`  |
| `reset`        | return state to its initial value                                                                                                       | `resetCombatState` |
| `print`        | write to stdout/stderr                                                                                                                  | `printHelp`        |
| `run`          | execute a subprocess, task, or whole pipeline                                                                                           | `runCLI`           |
| `check`        | evaluate and report findings; effects allowed per mode                                                                                  | `checkFile`        |
| `try<X>`       | X with failures captured as a value instead of a throw                                                                                  | `tryCheckFile`     |
| `register`     | add to a registry the caller doesn't own                                                                                                | `registerMatcher`  |
| `subscribe`    | attach a listener to an event source, returning or enabling detachment                                                                  | `subscribeToTicks` |
| `unsubscribe`  | detach what `subscribe` attached                                                                                                        | `unsubscribe`      |
| `assert`       | throw when an invariant doesn't hold                                                                                                    | `assertSpan`       |
| `require`      | throw unless a runtime condition holds — a guard real input can trip (`assert` covers invariants)                                       | `requireAuth`      |
| `verify`       | test a claim or credential against evidence, rejecting on mismatch                                                                      | `verifySession`    |
| `emit`         | dispatch an event or notification                                                                                                       | `emitProgress`     |
| `send`         | transmit a payload to a remote receiver (fire-and-forget or RPC — no resource semantics; REST mutations are `create`/`update`/`remove`) | `sendWebhook`      |
| `wait`         | block until an event or condition resolves; may return the awaited value                                                                | `waitForMessage`   |
| `setup`        | prepare the environment or fixture the following code assumes; `teardown` reverses it                                                   | `setupTest`        |
| `teardown`     | release what `setup` prepared                                                                                                           | `teardownTest`     |
| `start`        | put a long-running resource into service (server, worker, poll loop); `stop` reverses it                                                | `startQueues`      |
| `stop`         | take a long-running resource out of service, releasing what `start` acquired                                                            | `stopWorker`       |
| `drain`        | consume a pending backlog until empty                                                                                                   | `drainJobs`        |

**Wrappers and factories** — the result is behaviour, not data:

| Prefix    | Contract                                  | Example           |
| --------- | ----------------------------------------- | ----------------- |
| `with<X>` | HOF that runs a callback inside a context | `withJestContext` |
| `make<X>` | factory whose result is itself a function | `makeExcluder`    |

**Framework conventions** — where an ecosystem tool or idiom fixes the prefix, it wins:

| Prefix                   | Contract                                                                                                                | Example          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `use<X>`                 | React hook — the prefix drives rules-of-hooks linting; helpers inside a hook follow the normal taxonomy                 | `useDebounce`    |
| `on<Event>`              | event-callback prop or parameter                                                                                        | `onRowClick`     |
| `handle<Event>`          | local implementation passed to an `on<Event>` prop — the idiomatic React pair; the `handle` ban applies everywhere else | `handleRowClick` |
| `handle<LifecycleEvent>` | implementation of an engine lifecycle callback, keyed by the engine's lifecycle-event enum                              | `handleTick`     |

**Banned** — each is a vaguer or synonymous form of a listed verb; use that one instead: `handle`
(except the `handle<Event>` framework conventions), `process`, `manage`, `do`, `perform` (say what
it does), `execute` (→ `run`), `compute` (→ `build`), `fetch` (→ `read`), `save`/`store` (→
`write`), `delete` (→ `remove`), `search`/`lookup` (→ `find`/`get`).

Algorithm-native vocabulary (`walk`, `backtrack`, `slideDiagonal`) is allowed inside the module
implementing that algorithm — forcing list verbs onto textbook terms hides the algorithm.

#### Project verbs

backfence adds these verbs to the shared list. To add another, write it here and in the `verbs`
option of `zgeoff/function-verb` in `.oxlintrc.json`, in the PR that first uses it.

- `answer`: build the result of one MCP tool call.
- `deliver`: hand an inbound event to Claude Code.
- `dispose`: release what a long-lived object holds, such as a socket or a database handle.
- `log`: write one diagnostic line to stderr.
- `mint`: generate an ID that backfence is the sole authority for.
- `open`: dial a connection and return it once it is live.
- `refuse`: turn a connection away with a code and a reason.
- `route`: pick where a message goes and put it there, or hold it and knock when the pair is not
  open.

#### Exempt names

The `exemptNames` option in `.oxlintrc.json` lists these names:

- `main`: the entrypoint convention.
- `init`, `acquireConnection`, `beginTransaction`, `commitTransaction`, `rollbackTransaction`,
  `releaseConnection` and `destroy`: the kysely `Driver` interface fixes these method names.

## Dependencies

- Pin exact versions, with no `^` or `~` ranges. `bun add` saves exact versions (`exact = true` in
  `bunfig.toml`), so the rule covers hand-written edits.
- `bunfig.toml` holds back any version published less than 7 days ago. When the latest version is
  younger than that, pin the newest version that passes. Never add an exclusion for convenience.
- A dependency that knip can't see gets its `knip.json` ignore entry in the PR that adds it, with
  the reason in the PR description.
