import type { ErrorCode } from './protocol';

/**
 * A protocol-level error answer from the relay, thrown to reject the
 * request that caused it.
 */
export class RelayError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, msg: string) {
    super(msg);

    this.code = code;
    this.name = 'RelayError';
  }
}
