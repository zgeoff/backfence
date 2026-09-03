import { expect, test } from 'bun:test';
import { toKebab } from './to-kebab';

test.each([
  ['Geoff Whatley', 'geoff-whatley'],
  ['  Alice  ', 'alice'],
  ['Zoë Ünal', 'zoe-unal'],
  ["O'Brien, Pat", 'o-brien-pat'],
  ['tag:ci,tag:build', 'tag-ci-tag-build'],
  ['---', ''],
])('it turns %p into %p', (text, expected) => {
  expect(toKebab(text)).toBe(expected);
});
