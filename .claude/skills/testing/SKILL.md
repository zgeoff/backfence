---
name: testing
description:
  backfence testing conventions — mock-free tests over the real relay and real sockets, the dev
  identity mode as the one stand-in, assertion discipline (toStrictEqual, jest-extended), and the
  rules for protocol and transport tests. Load when designing, writing, or reviewing tests.
---

# Testing

`bun test` runs every file in one process. backfence is a single-regime repo: mock-free, asserting
on real behavior end to end. The relay suite starts a real relay on a random port and drives it with
the real client over real WebSockets. File-touching units use temp trees (`mkdtemp`), never mocked
filesystems. The one stand-in is the relay's `dev` identity mode, which reads two request headers
instead of asking tailscaled; everything after that point is production code.

## Principles

- Clarity over abstraction: repetition in a test isn't a smell, hidden setup is.
- Isolation is non-negotiable: every test passes alone and in any order.
- Test behavior, not implementation: a refactor that preserves the observable contract breaks no
  test.
- Every mock is a divergence from reality: mock only what is genuinely out of reach (tailscaled, the
  real `claude` binary), and keep it high-fidelity.
- Test utilities are production code, extracted and tested with the same rigor.
- Assertions are the contract: one loose assertion makes the rest of the test theatre.

## Everywhere

- Never use `describe` — flat `test(…)` blocks with behavioral titles that start with "it"
  (`test('it queues a message for an offline session', …)`). Titles describe observable behavior,
  never internal identifiers: verb + outcome + condition.
- A test body arranges, acts, asserts — phases separated by blank lines, never `// arrange`
  comments. A body with two unrelated act-assert pairs is two tests.
- `test.each` only for a closed decision table — data-only rows, title template starting with "it".
  Anything else is one `test()` per case.
- No branching in a test body: narrowing a maybe-value is an explicit `throw` on the line before the
  assertion — never `?.`/`??` fallbacks inside `expect` arguments.
- Lifecycle: no `beforeAll`/`beforeEach`/`afterEach`/`afterAll` in test files. Per-test resources
  come from a local `setupTest()` returning named props plus `Symbol.asyncDispose`, held with
  `await using`.
- `setupTest` is the only local function a test file defines. Every other helper is inlined or
  extracted to a shared util under `test/`, tested beside itself.
- Unit tests co-locate with the module they test; `test/relay.test.ts` is the whole-relay suite.
- `toStrictEqual` when the test determines every field. `toMatchObject`, or asymmetric matchers
  inside `toStrictEqual`, when the value carries fields the test doesn't determine. Never `toEqual`.
- Reach for jest-extended matchers (registered by the `@zgeoff/bun-test-extended` preload) instead
  of hand-rolling assertions.
- A wall-clock-dependent value is asserted with range matchers (`toBeWithin`), never with exact
  timestamps.
- Wait on an event arriving over a socket with the polling `waitFor` helper in `test/`, never a bare
  sleep.

## Protocol and transport rules

- Infrastructure failures run on real transports: a connect-failure test dials a relay that closes
  the socket — never a stubbed connect.
- Failure paths are contract: assert rejections directly —
  `expect(promise).rejects.toMatchObject({ code })` — and test each declared error code.
- Authorization rules are tested in pairs: the positive ("an admin approves") and the named negative
  ("a non-admin gets `unauthorized`") are two tests, never one test with a branch.
- Never spawn the real `claude` binary. The channel's contract with Claude Code (capability name,
  notification method, meta key rules) is verified by hand against a real session before a change to
  it merges.
