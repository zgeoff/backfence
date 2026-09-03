import { PROTOCOL_V } from '../protocol/protocol';
import type { EventMsg } from '../protocol/protocol';

export interface KnockInfo {
  readonly from: string;
  readonly person: string;
  readonly login: string;
  readonly displayName: string;
  readonly node: string;
  readonly sessionName: string;
  readonly knockedAt: number;
}

// Identity only: never the body, never the working directory.
export function buildKnockEvent(info: KnockInfo): EventMsg {
  return {
    v: PROTOCOL_V,
    ev: 'Knock',
    from: info.from,
    person: info.person,
    login: info.login,
    displayName: info.displayName,
    node: info.node,
    sessionName: info.sessionName,
    knockedAt: info.knockedAt,
  };
}
