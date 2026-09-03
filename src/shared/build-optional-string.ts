import { z } from 'zod';

// A non-string parses to undefined so the caller's default stands instead of failing the object.
export function buildOptionalString() {
  return z.preprocess((v) => (typeof v === 'string' ? v : undefined), z.string().optional());
}
