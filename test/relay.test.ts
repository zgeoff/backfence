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

async function setupTest(unknownPeers: 'knock' | 'refuse' = 'knock') {
  const dir = mkdtempSync(join(tmpdir(), 'backfence-relay-'));
  const clients: RelayClient[] = [];

  const relay = await startRelay({
    host: '127.0.0.1',
    port: 0,
    dbPath: join(dir, 'backfence.db'),
    identity: 'dev',
    unknownPeers,
    admins: ['alice@example.com', 'bob@example.com'],
    build: 'backfence/test',
  });

  return {
    url: relay.url,
    async connect(headers: Readonly<Record<string, string>>, sessionName: string) {
      const client = await RelayClient.open({ url: relay.url, headers });

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

      return { client, events, hello };
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

test('it delivers a message to a connected session and marks it delivered on ack', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');
  const bob = await ctx.connect(BOB, 'desk');

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob@example.com/desk',
    body: 'tests are green on #967',
  });

  const delivered = await waitFor(() => bob.events[0]);
  const acked = await bob.client.sendRequest('message.ack', { id: delivered['id'] });

  expect(sent).toStrictEqual({
    id: expect.stringMatching(/^m_/u),
    to: 'bob@example.com/desk',
    status: 'delivered',
  });

  expect(delivered).toStrictEqual({
    v: 1,
    ev: 'Message',
    id: sent['id'],
    from: 'alice@example.com/laptop',
    fromUser: 'alice@example.com',
    fromName: 'Alice',
    body: 'tests are green on #967',
    sentAt: expect.toBeWithin(Date.now() - 5000, Date.now() + 1),
  });

  expect(acked).toStrictEqual({ acked: true });
});

test("it queues a message for an offline session and drains it on that session's hello", async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');
  const bobBefore = await ctx.connect(BOB, 'desk');

  bobBefore.client.dispose();

  await waitFor(async () => {
    const listed = await alice.client.sendRequest('peer.list');

    return Array.isArray(listed['sessions']) && listed['sessions'].length === 1 ? true : undefined;
  });

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob@example.com/desk',
    body: 'read this when you are back',
  });

  const bob = await ctx.connect(BOB, 'desk');
  const drained = await waitFor(() => bob.events[0]);

  expect(sent).toMatchObject({ status: 'queued', to: 'bob@example.com/desk' });
  expect(bob.hello).toMatchObject({ queued: 1 });

  expect(drained).toMatchObject({
    ev: 'Message',
    id: sent['id'],
    from: 'alice@example.com/laptop',
  });
});

test('it delivers a bare-peer address when the peer has exactly one session', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');
  const bob = await ctx.connect(BOB, 'desk');

  const sent = await alice.client.sendRequest('message.send', {
    to: 'bob@example.com',
    body: 'hi',
  });

  await waitFor(() => bob.events[0]);

  expect(sent).toMatchObject({ status: 'delivered', to: 'bob@example.com/desk' });
});

test('it refuses a bare-peer address with ambiguous_peer when the peer has two sessions', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');

  await ctx.connect(BOB, 'desk');
  await ctx.connect(BOB, 'garage');

  expect(
    alice.client.sendRequest('message.send', { to: 'bob@example.com', body: 'hi' }),
  ).rejects.toMatchObject({ code: 'ambiguous_peer', message: expect.toInclude('desk, garage') });
});

test('it rejects a send to a name nobody has with no_such_peer', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');

  expect(
    alice.client.sendRequest('message.send', { to: 'nobody/desk', body: 'hi' }),
  ).rejects.toMatchObject({ code: 'no_such_peer' });
});

test('it lists connected sessions with their addresses and flags the caller', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');

  await ctx.connect(BOB, 'desk');

  const listed = await alice.client.sendRequest('peer.list');

  expect(listed).toStrictEqual({
    sessions: [
      expect.objectContaining({
        address: 'alice@example.com/laptop',
        self: true,
        cwd: '/home/laptop',
      }),
      expect.objectContaining({
        address: 'bob@example.com/desk',
        self: false,
        login: 'bob@example.com',
      }),
    ],
  });
});

test('it holds an unknown peer as pending and refuses their requests with peer_pending', async () => {
  await using ctx = await setupTest();

  const carol = await ctx.connect(CAROL, 'phone');

  expect(carol.hello).toMatchObject({ you: { status: 'pending', admin: false } });
  expect(carol.client.sendRequest('peer.list')).rejects.toMatchObject({ code: 'peer_pending' });
});

test('it lets an admin approve a pending peer with an alias that becomes their address', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');
  const carol = await ctx.connect(CAROL, 'phone');
  const pending = await alice.client.sendRequest('peer.pending');

  await alice.client.sendRequest('peer.approve', {
    userID: 'dev:carol@example.com',
    alias: 'carol',
  });

  const hello = await carol.client.sendRequest('relay.hello', {
    sessionID: 'phone-id',
    sessionName: 'phone',
  });

  const sent = await alice.client.sendRequest('message.send', {
    to: 'carol/phone',
    body: 'welcome',
  });

  await waitFor(() => carol.events[0]);

  expect(pending).toStrictEqual({
    pending: [
      expect.objectContaining({ userID: 'dev:carol@example.com', login: 'carol@example.com' }),
    ],
  });

  expect(hello).toMatchObject({
    you: { status: 'allowed', alias: 'carol', address: 'carol/phone' },
  });

  expect(sent).toMatchObject({ status: 'delivered', to: 'carol/phone' });
});

test('it refuses a non-admin who tries to approve with unauthorized', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');
  const carol = await ctx.connect(CAROL, 'phone');

  await alice.client.sendRequest('peer.approve', { userID: 'dev:carol@example.com' });
  await carol.client.sendRequest('relay.hello', { sessionID: 'phone-id', sessionName: 'phone' });

  expect(
    carol.client.sendRequest('peer.approve', { userID: 'dev:carol@example.com' }),
  ).rejects.toMatchObject({ code: 'unauthorized' });
});

test('it refuses a blocked peer with peer_blocked on their next request', async () => {
  await using ctx = await setupTest();

  const alice = await ctx.connect(ALICE, 'laptop');
  const carol = await ctx.connect(CAROL, 'phone');

  await alice.client.sendRequest('peer.block', { userID: 'dev:carol@example.com' });

  expect(carol.client.sendRequest('peer.list')).rejects.toMatchObject({ code: 'peer_blocked' });
});

test('it closes a connection the relay cannot identify', async () => {
  await using ctx = await setupTest();

  expect(RelayClient.open({ url: ctx.url })).rejects.toMatchObject({
    message: expect.toInclude('4001'),
  });
});

test('it refuses an unknown peer outright under the refuse policy', async () => {
  await using ctx = await setupTest('refuse');

  expect(RelayClient.open({ url: ctx.url, headers: CAROL })).rejects.toMatchObject({
    message: expect.toInclude('4003'),
  });
});

test('it rejects a send before hello with unauthorized', async () => {
  await using ctx = await setupTest();

  const client = await RelayClient.open({ url: ctx.url, headers: ALICE });

  try {
    expect(
      client.sendRequest('message.send', { to: 'bob@example.com', body: 'hi' }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  } finally {
    client.dispose();
  }
});
