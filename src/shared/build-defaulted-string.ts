import { z } from 'zod';

/**
 * A string with a fallback: a missing or non-string value parses to the
 * default instead of failing the object it belongs to.
 */
export function buildDefaultedString(fallback: string) {
  return z.preprocess((v) => (typeof v === 'string' ? v : fallback), z.string());
}
