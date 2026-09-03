import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayClient } from '../src/channel/relay-client';
import type { EventMsg } from '../src/protocol/protocol';
import { startRelay } from '../src/relay/start-relay';
import { waitFor } from './wait-for';

const ALICE = { 'x-backfence-dev-login': 'alice@example.com', 'x-backfence-dev-name': 'Alice' };
const BOB = { 'x-backfence-dev-login': 'bob@example.com', 'x-backfence-dev-name': 'Bob' };
const CAROL = { 'x-backfence-dev-login': 'carol@example.com', 'x-backfence-dev-name': 'Carol' };
const DAY_MS = 24 * 60 * 60 * 1000;

interface Session {
  readonly client: RelayClient;
  readonly events: readonly EventMsg[];
  readonly hello: Readonly<Record<string, unknown>>;
}

async function setupTest() {
  const dir = mkdtempSync(join(tmpdir(), 'backfence-relay-'));
  const clients: RelayClient[] = [];
  const clock = { offset: 0 };

  const relay = await startRelay({
    host: '127.0.0.1',
    port: 0,
    dbPath: join(dir, 'backfence.db'),
    identity: 'dev',
    build: 'backfence/test',
    now: () => Date.now() + clock.offset,
  });

  const openSession = async (
    headers: Readonly<Record<string, string>>,
    sessionName: string,
    node = 'dev',
  ) => {
    const client = await RelayClient.open({
      url: relay.url,
      headers: { ...headers, 'x-backfence-dev-node': node },
    });

    const events: EventMsg[] = [];

    client.onEvent = (event) => {
      events.push(event);
    };

    clients.push(client);

    const hello = await client.sendRequest('relay.hello', {
      client: 'test',
      sessionID: `${sessionName}-id`,
      sessionName,
      cwd: `/home/${sessionName}`,
    });

    return { client, events: events as readonly EventMsg[], hello };
  };

  return {
    url: relay.url,
    clock,
    openSession,

    // Opens the pair: the first sends a knock, the second accepts it and acks the drained knock
    // message, so later assertions look for their own bodies.
    async open(first: Session, second: Session, secondPerson: string, firstPerson: string) {
      await first.client.sendRequest('message.send', { to: secondPerson, body: 'knock knock' });
      await second.client.sendRequest('peer.accept', { peer: firstPerson });

      await waitFor(() => first.events.find((e) => e.ev === 'Accepted'));

      const drained = await waitFor(() => second.events.find((e) => e.ev === 'Message'));

      await second.client.sendRequest('message.ack', { id: drained['id'] });
    },
    async [Symbol.asyncDispose]() {
      for (const client of clients) {
        client.dispose();
      }

      await relay.stop();

      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('it holds the first message and knocks with identity only', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop', 'thinkpad');
  const bob = await ctx.openSession(BOB, 'desk');

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob/desk',
    body: 'secret until accepted',
  });

  const knock = await waitFor(() => bob.events[0]);

  expect(sent).toStrictEqual({ to: 'bob', status: 'knocked' });

  expect(knock).toStrictEqual({
    v: 1,
    ev: 'Knock',
    from: 'alice/laptop',
    person: 'alice',
    login: 'alice@example.com',
    displayName: 'Alice',
    node: 'thinkpad',
    sessionName: 'laptop',
    knockedAt: expect.toBeWithin(Date.now() - 5000, Date.now() + 1),
  });

  expect(JSON.stringify(knock)).not.toInclude('secret');
});

test('it delivers the held message and tells the sender when the receiver accepts', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob/desk', body: 'first' });
  await alice.client.sendRequest('message.send', { to: 'bob/desk', body: 'newest' });

  const accepted = await bob.client.sendRequest('peer.accept', { peer: 'alice' });
  const delivered = await waitFor(() => bob.events.find((e) => e.ev === 'Message'));
  const told = await waitFor(() => alice.events.find((e) => e.ev === 'Accepted'));

  expect(accepted).toStrictEqual({ person: 'alice', login: 'alice@example.com', open: true });

  expect(delivered).toStrictEqual({
    v: 1,
    ev: 'Message',
    id: expect.stringMatching(/^m_/u),
    from: 'alice/laptop',
    fromUser: 'alice@example.com',
    fromName: 'Alice',
    body: 'newest',
    sentAt: expect.toBeWithin(Date.now() - 5000, Date.now() + 1),
  });

  expect(told).toStrictEqual({
    v: 1,
    ev: 'Accepted',
    person: 'bob',
    login: 'bob@example.com',
    displayName: 'Bob',
  });
});

test('it delivers to a connected session of an open pair and marks it delivered on ack', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await ctx.open(alice, bob, 'bob', 'alice');

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob/desk',
    body: 'tests are green on #967',
  });

  const delivered = await waitFor(() => bob.events.find((e) => e['id'] === sent['id']));
  const acked = await bob.client.sendRequest('message.ack', { id: delivered['id'] });

  expect(sent).toStrictEqual({
    id: expect.stringMatching(/^m_/u),
    to: 'bob/desk',
    status: 'delivered',
  });

  expect(delivered).toMatchObject({ ev: 'Message', body: 'tests are green on #967' });
  expect(acked).toStrictEqual({ acked: true });
});

test('it opens both directions and every session once a pair is accepted', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await ctx.open(alice, bob, 'bob', 'alice');

  const aliceGarage = await ctx.openSession(ALICE, 'garage');

  const sent = await bob.client.sendRequest('message.send', {
    to: 'alice/garage',
    body: 'no knock needed',
  });

  await waitFor(() => aliceGarage.events[0]);

  expect(sent).toMatchObject({ status: 'delivered', to: 'alice/garage' });
});

test("it queues a message for an offline session and drains it on that session's hello", async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bobBefore = await ctx.openSession(BOB, 'desk');

  await ctx.open(alice, bobBefore, 'bob', 'alice');

  bobBefore.client.dispose();

  await waitFor(async () => {
    const listed = await alice.client.sendRequest('peer.list');

    return Array.isArray(listed['sessions']) && listed['sessions'].length === 1 ? true : undefined;
  });

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob/desk',
    body: 'read this when you are back',
  });

  const bob = await ctx.openSession(BOB, 'desk');
  const drained = await waitFor(() => bob.events[0]);

  expect(sent).toMatchObject({ status: 'queued', to: 'bob/desk' });
  expect(bob.hello).toMatchObject({ queued: 1, knocks: 0 });

  expect(drained).toMatchObject({
    ev: 'Message',
    id: sent['id'],
    from: 'alice/laptop',
    fromUser: 'alice@example.com',
    fromName: 'Alice',
  });
});

test('it replays a waiting knock when the receiver connects later', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bobBefore = await ctx.openSession(BOB, 'desk');

  bobBefore.client.dispose();

  await waitFor(async () => {
    const listed = await alice.client.sendRequest('peer.list');

    return Array.isArray(listed['sessions']) && listed['sessions'].length === 1 ? true : undefined;
  });

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'anyone home' });

  const bob = await ctx.openSession(BOB, 'desk');
  const knock = await waitFor(() => bob.events[0]);

  expect(bob.hello).toMatchObject({ knocks: 1 });
  expect(knock).toMatchObject({ ev: 'Knock', from: 'alice/laptop', sessionName: 'laptop' });
});

test('it answers knocked after a decline and sends no fresh knock within a day', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'first' });

  await waitFor(() => bob.events[0]);

  const declined = await bob.client.sendRequest('peer.decline', { peer: 'alice' });

  ctx.clock.offset = DAY_MS / 2;

  const sent = await alice.client.sendRequest('message.send', { to: 'bob', body: 'again' });
  const edges = await alice.client.sendRequest('peer.edges');

  await Bun.sleep(50);

  expect(declined).toStrictEqual({ person: 'alice', login: 'alice@example.com' });
  expect(sent).toStrictEqual({ to: 'bob', status: 'knocked' });
  expect(bob.events).toHaveLength(1);

  expect(edges).toStrictEqual({
    edges: [expect.objectContaining({ person: 'bob', you: 'accepted', them: 'none' })],
  });
});

test('it knocks again a day after a decline', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'first' });

  await waitFor(() => bob.events[0]);

  await bob.client.sendRequest('peer.decline', { peer: 'alice' });

  ctx.clock.offset = DAY_MS + 1000;

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'again' });

  const second = await waitFor(() => bob.events[1]);

  expect(second).toMatchObject({ ev: 'Knock', from: 'alice/laptop' });
});

test('it delivers the latest held message at once when accept follows a decline', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'first' });

  await waitFor(() => bob.events[0]);

  await bob.client.sendRequest('peer.decline', { peer: 'alice' });
  await alice.client.sendRequest('message.send', { to: 'bob', body: 'sent while declined' });
  await bob.client.sendRequest('peer.accept', { peer: 'alice' });

  const delivered = await waitFor(() => bob.events.find((e) => e.ev === 'Message'));

  expect(delivered).toMatchObject({ body: 'sent while declined', from: 'alice/laptop' });
});

test('it holds nothing after a block, so accept after block delivers only what follows', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'first' });

  await waitFor(() => bob.events[0]);

  const blocked = await bob.client.sendRequest('peer.block', { peer: 'alice' });

  ctx.clock.offset = 2 * DAY_MS;

  const sent = await alice.client.sendRequest('message.send', { to: 'bob', body: 'while blocked' });

  await bob.client.sendRequest('peer.accept', { peer: 'alice' });

  await waitFor(() => alice.events.find((e) => e.ev === 'Accepted'));

  const after = await alice.client.sendRequest('message.send', { to: 'bob', body: 'after' });

  await waitFor(() => bob.events.find((e) => e.ev === 'Message'));

  expect(blocked).toStrictEqual({ person: 'alice', login: 'alice@example.com' });
  expect(sent).toStrictEqual({ to: 'bob', status: 'knocked' });
  expect(after).toMatchObject({ status: 'delivered' });
  expect(bob.events.map((e) => e.ev)).toStrictEqual(['Knock', 'Message']);
  expect(bob.events[1]).toMatchObject({ body: 'after' });
});

test('it refuses a send to someone whose knock the sender has not answered', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'first' });

  await waitFor(() => bob.events[0]);

  expect(
    bob.client.sendRequest('message.send', { to: 'alice', body: 'reply without accept' }),
  ).rejects.toMatchObject({ code: 'not_accepted', message: expect.toInclude('accept') });
});

test('it refuses a send to someone the sender declined', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await alice.client.sendRequest('message.send', { to: 'bob', body: 'first' });

  await waitFor(() => bob.events[0]);

  await bob.client.sendRequest('peer.decline', { peer: 'alice' });

  expect(
    bob.client.sendRequest('message.send', { to: 'alice', body: 'changed my mind' }),
  ).rejects.toMatchObject({ code: 'not_accepted', message: expect.toInclude('declined') });
});

test('it lets a person accept before any knock so the first message delivers at once', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');
  const early = await bob.client.sendRequest('peer.accept', { peer: 'alice@example.com' });
  const sent = await alice.client.sendRequest('message.send', { to: 'bob/desk', body: 'hi' });

  await waitFor(() => bob.events[0]);

  expect(early).toStrictEqual({ person: 'alice', login: 'alice@example.com', open: false });
  expect(sent).toMatchObject({ status: 'delivered' });
  expect(bob.events[0]).toMatchObject({ ev: 'Message', body: 'hi' });
});

test('it lists each side of every edge for the caller', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');
  const carol = await ctx.openSession(CAROL, 'phone');

  await ctx.open(alice, bob, 'bob', 'alice');
  await carol.client.sendRequest('message.send', { to: 'bob', body: 'knock' });

  await waitFor(() => bob.events.find((e) => e.ev === 'Knock' && e['person'] === 'carol'));

  const edges = await bob.client.sendRequest('peer.edges');

  expect(edges).toStrictEqual({
    edges: [
      {
        person: 'alice',
        login: 'alice@example.com',
        displayName: 'Alice',
        you: 'accepted',
        them: 'accepted',
        decidedAt: expect.toBeWithin(1, Number.MAX_SAFE_INTEGER),
        knockedAt: expect.toBeWithin(1, Number.MAX_SAFE_INTEGER),
      },
      {
        person: 'carol',
        login: 'carol@example.com',
        displayName: 'Carol',
        you: 'none',
        them: 'accepted',
        decidedAt: null,
        knockedAt: expect.toBeWithin(1, Number.MAX_SAFE_INTEGER),
      },
    ],
  });
});

test('it lists only the sessions of open pairs plus the caller', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop', 'thinkpad');
  const bob = await ctx.openSession(BOB, 'desk');

  await ctx.openSession(CAROL, 'phone');
  await ctx.open(alice, bob, 'bob', 'alice');

  const listed = await alice.client.sendRequest('peer.list');

  expect(listed).toStrictEqual({
    sessions: [
      {
        address: 'alice/laptop',
        person: 'alice',
        device: 'thinkpad',
        session: 'laptop',
        login: 'alice@example.com',
        displayName: 'Alice',
        cwd: '/home/laptop',
        mode: '',
        connectedAt: expect.toBeWithin(1, Number.MAX_SAFE_INTEGER),
        self: true,
      },
      expect.objectContaining({ address: 'bob/desk', self: false, login: 'bob@example.com' }),
    ],
  });
});

test('it delivers a bare-person address when the person has exactly one session', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await ctx.open(alice, bob, 'bob', 'alice');

  const sent = await alice.client.sendRequest('message.send', { to: 'bob', body: 'hi' });

  await waitFor(() => bob.events.find((e) => e['id'] === sent['id']));

  expect(sent).toMatchObject({ status: 'delivered', to: 'bob/desk' });
});

test('it refuses a bare-person address with ambiguous_peer when the person has two sessions', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bob = await ctx.openSession(BOB, 'desk');

  await ctx.open(alice, bob, 'bob', 'alice');
  await ctx.openSession(BOB, 'garage');

  expect(alice.client.sendRequest('message.send', { to: 'bob', body: 'hi' })).rejects.toMatchObject(
    { code: 'ambiguous_peer', message: expect.toInclude('bob/desk, bob/garage') },
  );
});

test('it addresses same-named sessions on two devices as person/device/session', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');
  const bobHome = await ctx.openSession(BOB, 'api', 'home');

  await ctx.open(alice, bobHome, 'bob', 'alice');

  const bobWork = await ctx.openSession(BOB, 'api', 'work');
  const listed = await alice.client.sendRequest('peer.list');

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob/work/api',
    body: 'to the work box',
  });

  await waitFor(() => bobWork.events[0]);

  expect(listed).toMatchObject({
    sessions: [
      expect.objectContaining({ address: 'alice/laptop' }),
      expect.objectContaining({ address: 'bob/home/api' }),
      expect.objectContaining({ address: 'bob/work/api' }),
    ],
  });

  expect(sent).toMatchObject({ status: 'delivered', to: 'bob/work/api' });
  expect(bobHome.events.find((e) => e['id'] === sent['id'])).toBeUndefined();

  expect(
    alice.client.sendRequest('message.send', { to: 'bob/api', body: 'which one' }),
  ).rejects.toMatchObject({
    code: 'ambiguous_peer',
    message: expect.toInclude('bob/home/api, bob/work/api'),
  });
});

test('it shows two people with the same display name by login', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');

  const other = await ctx.openSession(
    { ...ALICE, 'x-backfence-dev-login': 'alice@other.example' },
    'desk',
  );

  const bob = await ctx.openSession(BOB, 'desk');
  const knocked = await other.client.sendRequest('message.send', { to: 'bob', body: 'hi' });
  const knock = await waitFor(() => bob.events[0]);

  const renamed = await alice.client.sendRequest('relay.hello', {
    sessionID: 'laptop-id',
    sessionName: 'laptop',
  });

  expect(renamed).toMatchObject({ you: { person: 'alice@example.com' } });
  expect(other.hello).toMatchObject({ you: { address: 'alice@other.example/desk' } });
  expect(knocked).toStrictEqual({ to: 'bob', status: 'knocked' });
  expect(knock).toMatchObject({ from: 'alice@other.example/desk', person: 'alice@other.example' });

  expect(bob.client.sendRequest('peer.accept', { peer: 'alice' })).rejects.toMatchObject({
    code: 'ambiguous_peer',
  });
});

test("it delivers between a person's own sessions with no knock", async () => {
  await using ctx = await setupTest();

  const laptop = await ctx.openSession(ALICE, 'laptop');
  const garage = await ctx.openSession(ALICE, 'garage');

  const sent = await laptop.client.sendRequest('message.send', {
    to: 'alice/garage',
    body: 'note to self',
  });

  await waitFor(() => garage.events[0]);

  expect(sent).toMatchObject({ status: 'delivered', to: 'alice/garage' });
});

test('it rejects a send to a name nobody has with no_such_peer', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');

  expect(
    alice.client.sendRequest('message.send', { to: 'nobody/desk', body: 'hi' }),
  ).rejects.toMatchObject({ code: 'no_such_peer' });
});

test('it rejects a decision about the caller themselves with bad_args', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.openSession(ALICE, 'laptop');

  expect(alice.client.sendRequest('peer.accept', { peer: 'alice' })).rejects.toMatchObject({
    code: 'bad_args',
  });
});

test('it refuses a connection the relay cannot identify', async () => {
  await using ctx = await setupTest();

  expect(RelayClient.open({ url: ctx.url })).rejects.toMatchObject({
    message: expect.toInclude('4001'),
  });
});

test('it rejects a send before hello with unauthorized', async () => {
  await using ctx = await setupTest();

  const client = await RelayClient.open({ url: ctx.url, headers: ALICE });

  try {
    expect(client.sendRequest('message.send', { to: 'bob', body: 'hi' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  } finally {
    client.dispose();
  }
});
