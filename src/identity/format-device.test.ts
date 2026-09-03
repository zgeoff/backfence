import { expect, test } from 'bun:test';
import { formatDevice } from './format-device';

test.each([
  ['laptop.tail1234.ts.net', 'laptop'],
  ['Desk-PC', 'desk-pc'],
  ['', 'unknown'],
])('it formats the device %p as %p', (nodeName, expected) => {
  expect(formatDevice(nodeName)).toBe(expected);
});
