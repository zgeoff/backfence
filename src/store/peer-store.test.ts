import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeerStore } from './peer-store';

const ALICE = {
  userID: 'ts:1',
  login: 'alice@example.com',
  displayName: 'Alice',
  nodeID: 'nA',
  nodeName: 'laptop.tail.ts.net',
  caps: {},
};

const HELD = {
  fromUser: 'ts:1',
  toUser: 'ts:2',
  fromAddress: 'alice/laptop',
  fromSession: 'laptop',
  fromNode: 'laptop',
  toSession: '',
  body: 'first',
  createdAt: 5,
  expiresAt: 1000,
};

async function setupTest() {
  const dir = mkdtempSync(join(tmpdir(), 'backfence-store-'));

  const store = await PeerStore.open(join(dir, 'backfence.db'));

  return {
    store,
    async [Symbol.asyncDispose]() {
      await store.dispose();

      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('it inserts a new user and refreshes the name and last seen on a later upsert', async () => {
  await using ctx = await setupTest();

  const first = await ctx.store.upsertUser(ALICE, 10);
  const second = await ctx.store.upsertUser({ ...ALICE, displayName: 'Alice W' }, 20);

  expect(first).toStrictEqual({
    userID: 'ts:1',
    login: 'alice@example.com',
    displayName: 'Alice',
    firstSeen: 10,
    lastSeen: 10,
  });

  expect(second).toStrictEqual({ ...first, displayName: 'Alice W', lastSeen: 20 });
});

test('it reports both sides undecided for a pair with no edge', async () => {
  await using ctx = await setupTest();

  const edge = await ctx.store.findEdge('ts:1', 'ts:2');

  expect(edge).toStrictEqual({
    otherUser: 'ts:2',
    you: 'none',
    youAt: null,
    them: 'none',
    themAt: null,
    knockedAt: null,
  });
});

test('it keeps one row per pair whichever side decides first', async () => {
  await using ctx = await setupTest();

  await ctx.store.updateEdgeSide('ts:2', 'ts:1', 'accepted', 10);

  const fromAlice = await ctx.store.updateEdgeSide('ts:1', 'ts:2', 'declined', 20);
  const fromBob = await ctx.store.findEdge('ts:2', 'ts:1');
  const edges = await ctx.store.collectEdges('ts:1');

  expect(fromAlice).toStrictEqual({
    otherUser: 'ts:2',
    you: 'declined',
    youAt: 20,
    them: 'accepted',
    themAt: 10,
    knockedAt: null,
  });

  expect(fromBob).toStrictEqual({
    otherUser: 'ts:1',
    you: 'accepted',
    youAt: 10,
    them: 'declined',
    themAt: 20,
    knockedAt: null,
  });

  expect(edges).toStrictEqual([fromAlice]);
});

test('it records when the last knock went out', async () => {
  await using ctx = await setupTest();

  await ctx.store.updateEdgeSide('ts:1', 'ts:2', 'accepted', 10);
  await ctx.store.updateKnockedAt('ts:1', 'ts:2', 11);

  const edge = await ctx.store.findEdge('ts:2', 'ts:1');

  expect(edge).toMatchObject({ knockedAt: 11 });
});

test('it keeps one held message per direction, the newest replacing the older', async () => {
  await using ctx = await setupTest();

  await ctx.store.writeHeld(HELD);
  await ctx.store.writeHeld({ ...HELD, body: 'second', createdAt: 6, toSession: 'desk' });

  const held = await ctx.store.findHeld('ts:1', 'ts:2', 10);

  expect(held).toStrictEqual({ ...HELD, body: 'second', createdAt: 6, toSession: 'desk' });
});

test('it hides an expired held message and forgets a removed one', async () => {
  await using ctx = await setupTest();

  await ctx.store.writeHeld(HELD);

  const expired = await ctx.store.findHeld('ts:1', 'ts:2', 1000);

  await ctx.store.removeHeld('ts:1', 'ts:2');

  const removed = await ctx.store.findHeld('ts:1', 'ts:2', 10);

  expect(expired).toBeNull();
  expect(removed).toBeNull();
});

test('it returns queued messages for a session by name and for its user with no session named', async () => {
  await using ctx = await setupTest();

  const base = {
    fromUser: 'ts:9',
    fromAddress: 'bob/desk',
    toUser: 'ts:1',
    body: 'hi',
    createdAt: 5,
    expiresAt: 1000,
  };

  await ctx.store.writeMessage({ ...base, id: 'm1', toSession: 'work' });
  await ctx.store.writeMessage({ ...base, id: 'm2', toSession: '' });
  await ctx.store.writeMessage({ ...base, id: 'm3', toSession: 'other' });
  await ctx.store.writeMessage({ ...base, id: 'm4', toSession: 'work', expiresAt: 4 });
  await ctx.store.updateDelivered('m2', 6);

  const queued = await ctx.store.collectQueued('ts:1', 'work', 10);

  expect(queued.map((m) => m.id)).toStrictEqual(['m1']);
});

test('it removes delivered, expired, and stale held messages and keeps live ones', async () => {
  await using ctx = await setupTest();

  const base = {
    fromUser: 'ts:9',
    fromAddress: 'bob/desk',
    toUser: 'ts:1',
    toSession: '',
    body: 'hi',
    createdAt: 5,
  };

  await ctx.store.writeMessage({ ...base, id: 'live', expiresAt: 1000 });
  await ctx.store.writeMessage({ ...base, id: 'old', expiresAt: 9 });
  await ctx.store.writeMessage({ ...base, id: 'done', expiresAt: 1000 });
  await ctx.store.updateDelivered('done', 6);
  await ctx.store.writeHeld(HELD);
  await ctx.store.writeHeld({ ...HELD, toUser: 'ts:3', expiresAt: 9 });
  await ctx.store.removeStaleMessages(10);

  const queued = await ctx.store.collectQueued('ts:1', 'x', 10);
  const liveHeld = await ctx.store.findHeld('ts:1', 'ts:2', 10);
  const staleHeld = await ctx.store.findHeld('ts:1', 'ts:3', 10);

  expect(queued.map((m) => m.id)).toStrictEqual(['live']);
  expect(liveHeld).toStrictEqual(HELD);
  expect(staleHeld).toBeNull();
});
