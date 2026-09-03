/**
 * Polls `read` until it returns a value, for tests that wait on an event
 * arriving over a real socket. Throws past the timeout so a missing event
 * fails loudly rather than hanging the run.
 */
export async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await read();

    if (value !== undefined) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(`waited ${timeoutMs}ms for a value that never came`);
    }

    await Bun.sleep(10);
  }
}
