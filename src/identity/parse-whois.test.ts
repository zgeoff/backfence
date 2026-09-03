import { expect, test } from 'bun:test';
import { parseWhoIs } from './parse-whois';

test('it keys a user-owned node on the Tailscale user id', () => {
  expect(
    parseWhoIs({
      UserProfile: {
        ID: 6_707_952_971_012_599,
        LoginName: 'alice@example.com',
        DisplayName: 'Alice',
      },
      Node: { StableID: 'nKHYJY8gUp11CNTRL', Name: 'home.tail1234.ts.net.', Tags: null },
      CapMap: null,
    }),
  ).toStrictEqual({
    userID: 'ts:6707952971012599',
    login: 'alice@example.com',
    displayName: 'Alice',
    nodeID: 'nKHYJY8gUp11CNTRL',
    nodeName: 'home.tail1234.ts.net',
    caps: {},
  });
});

test('it keys a tagged node on the node itself with its tags as the login', () => {
  expect(
    parseWhoIs({
      UserProfile: { ID: 1, LoginName: 'tagged-devices', DisplayName: 'Tagged Devices' },
      Node: { StableID: 'nABC', Name: 'relay.tail1234.ts.net.', Tags: ['tag:relay'] },
      CapMap: { 'example.com/cap/backfence': [{ role: 'admin' }] },
    }),
  ).toStrictEqual({
    userID: 'node:nABC',
    login: 'tag:relay',
    displayName: 'relay.tail1234.ts.net',
    nodeID: 'nABC',
    nodeName: 'relay.tail1234.ts.net',
    caps: { 'example.com/cap/backfence': [{ role: 'admin' }] },
  });
});

test('it returns null for a response that is not a whois shape', () => {
  expect(parseWhoIs({ error: 'peer not found' })).toBeNull();
});
