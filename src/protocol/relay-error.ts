import type { ErrorCode } from './protocol';

export class RelayError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, msg: string) {
    super(msg);

    this.code = code;
    this.name = 'RelayError';
  }
}
