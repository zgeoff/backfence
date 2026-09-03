import { expect, test } from 'bun:test';
import { formatPerson } from './format-person';

const ALICE = {
  userID: 'ts:1',
  login: 'alice@example.com',
  displayName: 'Alice Smith',
  firstSeen: 1,
  lastSeen: 1,
};

const OTHER_ALICE = { ...ALICE, userID: 'ts:2', login: 'alice@other.example' };

test('it formats the kebab display name when nobody shares it', () => {
  expect(formatPerson(ALICE, [ALICE])).toBe('alice-smith');
});

test('it falls back to the login when another user shares the display name', () => {
  expect(formatPerson(ALICE, [ALICE, OTHER_ALICE])).toBe('alice@example.com');
});

test('it falls back to the login when the display name has no letters or digits', () => {
  const blank = { ...ALICE, displayName: '***' };

  expect(formatPerson(blank, [blank])).toBe('alice@example.com');
});
