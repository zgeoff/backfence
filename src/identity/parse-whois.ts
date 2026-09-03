import { z } from 'zod';
import type { Principal } from './principal';

const USER_PROFILE_SCHEMA = z.object({
  ID: z.number(),
  LoginName: z.string(),
  DisplayName: z.string(),
});

const TAGS_SCHEMA = z.array(z.string()).nullish();

const NODE_SCHEMA = z.object({
  StableID: z.string(),
  Name: z.string(),
  Tags: TAGS_SCHEMA,
});

const CAP_VALUES_SCHEMA = z.array(z.unknown());
const CAP_MAP_SCHEMA = z.record(z.string(), CAP_VALUES_SCHEMA).nullish();

const WHOIS_SCHEMA = z.object({
  UserProfile: USER_PROFILE_SCHEMA,
  Node: NODE_SCHEMA,
  CapMap: CAP_MAP_SCHEMA,
});

// A tagged node has no person behind it: its identity is the node and its tags stand in for a
// login.
export function parseWhoIs(raw: unknown): Principal | null {
  const result = WHOIS_SCHEMA.safeParse(raw);

  if (!result.success) {
    return null;
  }

  const user = result.data.UserProfile;
  const node = result.data.Node;
  const tags = node.Tags ?? [];
  const nodeName = node.Name.replace(/\.$/, '');
  const caps = result.data.CapMap ?? {};

  if (tags.length > 0) {
    return {
      userID: `node:${node.StableID}`,
      login: tags.join(','),
      displayName: nodeName,
      nodeID: node.StableID,
      nodeName,
      caps,
    };
  }

  return {
    userID: `ts:${user.ID}`,
    login: user.LoginName,
    displayName: user.DisplayName,
    nodeID: node.StableID,
    nodeName,
    caps,
  };
}
