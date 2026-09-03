import { expect, test } from 'bun:test';
import { parseAddress } from './parse-address';

test.each([
  ['bob/desk', { peer: 'bob', session: 'desk' }],
  ['bob', { peer: 'bob', session: null }],
  [
    'bob@example.com/PIM catalogue gaps',
    { peer: 'bob@example.com', session: 'PIM catalogue gaps' },
  ],
  ['  bob / desk ', { peer: 'bob', session: 'desk' }],
  ['bob/', { peer: 'bob', session: null }],
  ['/desk', null],
  ['', null],
])('it parses %s', (raw, expected) => {
  expect(parseAddress(raw)).toStrictEqual(expected);
});
