import { isRecord } from '../shared/is-record';

// Three message kinds, distinguished by which fields are present: request (id + m), response
// (id + ok or err), event (ev).
export const PROTOCOL_V = 1;
export const MAX_FRAME = 262_144;
export const MAX_BODY = 65_536;

const ERROR_CODES = [
  'protocol_mismatch',
  'unauthorized',
  'unknown_method',
  'bad_args',
  'no_such_peer',
  'ambiguous_peer',
  'not_accepted',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

interface ProtocolError {
  readonly code: ErrorCode;
  readonly msg: string;
}

export interface RequestMsg {
  readonly v: number;
  readonly id: number;
  readonly m: string;
  readonly p?: Readonly<Record<string, unknown>>;
}

export interface ResponseMsg {
  readonly v: number;
  readonly id: number;
  readonly ok?: Readonly<Record<string, unknown>>;
  readonly err?: ProtocolError;
}

export interface EventMsg {
  readonly v: number;
  readonly ev: string;
  readonly [field: string]: unknown;
}

export type DecodedMsg =
  | { readonly kind: 'request'; readonly msg: RequestMsg }
  | { readonly kind: 'response'; readonly msg: ResponseMsg }
  | { readonly kind: 'event'; readonly msg: EventMsg }
  | { readonly kind: 'malformed'; readonly reason: string };

// Unknown fields pass through so additive evolution never breaks a peer; a frame that fits no
// message kind is malformed and the caller closes the connection.
export function decodeMessage(frame: string): DecodedMsg {
  let parsed: unknown;

  try {
    parsed = JSON.parse(frame);
  } catch {
    return { kind: 'malformed', reason: 'not valid JSON' };
  }

  if (!isRecord(parsed) || typeof parsed['v'] !== 'number') {
    return { kind: 'malformed', reason: 'missing v' };
  }

  if (typeof parsed['ev'] === 'string') {
    return { kind: 'event', msg: { ...parsed, v: parsed['v'], ev: parsed['ev'] } };
  }

  if (typeof parsed['id'] !== 'number') {
    return { kind: 'malformed', reason: 'missing id' };
  }

  if (typeof parsed['m'] === 'string') {
    const p = parsed['p'];

    return {
      kind: 'request',
      msg: {
        v: parsed['v'],
        id: parsed['id'],
        m: parsed['m'],
        ...(isRecord(p) ? { p } : {}),
      },
    };
  }

  const ok = parsed['ok'];
  const err = parsed['err'];

  if (isRecord(ok) || isProtocolError(err)) {
    return {
      kind: 'response',
      msg: {
        v: parsed['v'],
        id: parsed['id'],
        ...(isRecord(ok) ? { ok } : {}),
        ...(isProtocolError(err) ? { err } : {}),
      },
    };
  }

  return { kind: 'malformed', reason: 'no m, ok, or err' };
}

export function encodeMessage(msg: EventMsg | RequestMsg | ResponseMsg): string {
  return JSON.stringify(msg);
}

function isProtocolError(value: unknown): value is ProtocolError {
  return (
    isRecord(value) &&
    typeof value['msg'] === 'string' &&
    ERROR_CODES.some((code) => code === value['code'])
  );
}
