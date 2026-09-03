import { expect, test } from 'bun:test';
import { parseAddress } from './parse-address';

test.each([
  ['bob/desk', { person: 'bob', rest: 'desk' }],
  ['bob', { person: 'bob', rest: null }],
  ['bob/laptop/desk', { person: 'bob', rest: 'laptop/desk' }],
  ['bob@example.com/PIM catalogue gaps', { person: 'bob@example.com', rest: 'PIM catalogue gaps' }],
  ['  bob / desk ', { person: 'bob', rest: 'desk' }],
  ['bob/', { person: 'bob', rest: null }],
  ['/desk', null],
  ['', null],
])('it parses %s', (raw, expected) => {
  expect(parseAddress(raw)).toStrictEqual(expected);
});
