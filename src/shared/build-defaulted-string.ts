import { z } from 'zod';

// A missing or non-string value parses to the fallback instead of failing the object.
export function buildDefaultedString(fallback: string) {
  return z.preprocess((v) => (typeof v === 'string' ? v : fallback), z.string());
}
