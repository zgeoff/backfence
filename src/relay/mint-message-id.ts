import { randomBytes } from 'node:crypto';

// Time-ordered so a queue drains in send order even across relay restarts.
export function mintMessageID(now = Date.now()): string {
  return `m_${now.toString(36).padStart(9, '0')}${randomBytes(5).toString('hex')}`;
}
