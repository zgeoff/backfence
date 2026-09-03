import { expect, test } from 'bun:test';
import { waitFor } from './wait-for';

test('it resolves with the first defined value the reader returns', async () => {
  let calls = 0;

  const value = await waitFor(() => (++calls >= 3 ? 'ready' : undefined));

  expect(value).toBe('ready');
  expect(calls).toBe(3);
});

test('it rejects once the timeout passes with no value', () => {
  const empty: { value?: string } = {};

  expect(waitFor(() => empty.value, 30)).rejects.toThrowWithMessage(
    Error,
    'waited 30ms for a value that never came',
  );
});
