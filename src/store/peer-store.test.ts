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

test('it inserts a new peer with the given status and keeps that status on a later upsert', async () => {
  await using ctx = await setupTest();

  const first = await ctx.store.upsertPeer(ALICE, { status: 'pending', admin: false, now: 10 });

  const second = await ctx.store.upsertPeer(
    { ...ALICE, displayName: 'Alice W' },
    { status: 'allowed', admin: false, now: 20 },
  );

  expect(first).toStrictEqual({
    userID: 'ts:1',
    login: 'alice@example.com',
    displayName: 'Alice',
    alias: null,
    status: 'pending',
    admin: false,
    firstSeen: 10,
    lastSeen: 10,
  });

  expect(second).toStrictEqual({ ...first, displayName: 'Alice W', lastSeen: 20 });
});

test('it promotes a known peer to allowed admin when the upsert carries admin rights', async () => {
  await using ctx = await setupTest();

  await ctx.store.upsertPeer(ALICE, { status: 'pending', admin: false, now: 10 });

  const promoted = await ctx.store.upsertPeer(ALICE, { status: 'pending', admin: true, now: 20 });

  expect(promoted).toMatchObject({ status: 'allowed', admin: true });
});

test('it finds a peer by alias before login', async () => {
  await using ctx = await setupTest();

  await ctx.store.upsertPeer(ALICE, { status: 'allowed', admin: false, now: 10 });

  await ctx.store.upsertPeer(
    { ...ALICE, userID: 'ts:2', login: 'alice', displayName: 'Other Alice' },
    { status: 'allowed', admin: false, now: 10 },
  );

  await ctx.store.updatePeerStatus('ts:1', 'allowed', 'alice');

  const byAlias = await ctx.store.findPeerByName('alice');
  const byLogin = await ctx.store.findPeerByName('alice@example.com');

  expect(byAlias?.userID).toBe('ts:1');
  expect(byLogin?.userID).toBe('ts:1');
});

test('it returns queued messages for a session by name and for its peer with no session named', async () => {
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

test('it removes delivered and expired messages and keeps live queued ones', async () => {
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
  await ctx.store.removeStaleMessages(10);

  const queued = await ctx.store.collectQueued('ts:1', 'x', 10);

  expect(queued.map((m) => m.id)).toStrictEqual(['live']);
});
