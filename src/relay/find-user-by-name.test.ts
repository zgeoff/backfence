import { expect, test } from 'bun:test';
import { findUserByName } from './find-user-by-name';

const ALICE = {
  userID: 'ts:1',
  login: 'alice@example.com',
  displayName: 'Alice Smith',
  firstSeen: 1,
  lastSeen: 1,
};

const OTHER_ALICE = { ...ALICE, userID: 'ts:2', login: 'alice@other.example' };

test('it finds a user by person name', () => {
  expect(findUserByName([ALICE], 'alice-smith')).toStrictEqual({ kind: 'found', user: ALICE });
});

test('it finds a user by login even when the person name is shared', () => {
  expect(findUserByName([ALICE, OTHER_ALICE], 'alice@other.example')).toStrictEqual({
    kind: 'found',
    user: OTHER_ALICE,
  });
});

test('it reports the logins when a person name is shared', () => {
  expect(findUserByName([ALICE, OTHER_ALICE], 'alice-smith')).toStrictEqual({
    kind: 'ambiguous',
    logins: ['alice@example.com', 'alice@other.example'],
  });
});

test('it reports none for a name nobody has', () => {
  expect(findUserByName([ALICE], 'bob')).toStrictEqual({ kind: 'none' });
});
