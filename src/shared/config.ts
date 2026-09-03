import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { buildOptionalString } from './build-optional-string';
import { isRecord } from './is-record';

export type IdentityMode = 'tailscale' | 'dev';

export type UnknownPeerPolicy = 'refuse' | 'knock';

interface RelayConfig {
  readonly host: string;
  readonly port: number;
  readonly identity: IdentityMode;
  readonly unknownPeers: UnknownPeerPolicy;
  readonly admins: readonly string[];
}

interface ChannelConfig {
  readonly relay: string;
}

export interface Config {
  readonly relay: RelayConfig;
  readonly channel: ChannelConfig;
}

const DEFAULTS: Config = {
  relay: {
    host: '127.0.0.1',
    port: 7477,
    identity: 'tailscale',
    unknownPeers: 'knock',
    admins: [],
  },
  channel: {
    relay: 'ws://127.0.0.1:7477/ws',
  },
};

const configDir = join(homedir(), '.config', 'backfence');
const stateDir = join(homedir(), '.local', 'state', 'backfence');

export const dbFile = join(stateDir, 'backfence.db');
const PORT_SCHEMA = z.number().optional();
const IDENTITY_SCHEMA = z.enum(['tailscale', 'dev']).optional();
const UNKNOWN_PEERS_SCHEMA = z.enum(['refuse', 'knock']).optional();
const ADMINS_SCHEMA = z.array(z.string()).optional();

const RELAY_SCHEMA = z.object({
  host: buildOptionalString(),
  port: z.preprocess(toNumber, PORT_SCHEMA),
  identity: z.preprocess(toIdentityMode, IDENTITY_SCHEMA),
  unknownPeers: z.preprocess(toUnknownPeerPolicy, UNKNOWN_PEERS_SCHEMA),
  admins: z.preprocess(toStringArray, ADMINS_SCHEMA),
});

const CHANNEL_SCHEMA = z.object({
  relay: buildOptionalString(),
});

// A malformed field falls back to its default rather than failing the file, so a hand-edited
// config never stops backfence from starting.
export function loadConfig(): Config {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const file = join(configDir, 'config.json');

  if (!existsSync(file)) {
    writeFileSync(file, `${JSON.stringify(DEFAULTS, null, 2)}\n`);

    return DEFAULTS;
  }

  try {
    return parseConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return DEFAULTS;
  }
}

function parseConfig(raw: unknown): Config {
  const root = isRecord(raw) ? raw : {};
  const rawRelay = isRecord(root['relay']) ? root['relay'] : {};
  const rawChannel = isRecord(root['channel']) ? root['channel'] : {};
  const relay = RELAY_SCHEMA.safeParse(rawRelay);
  const channel = CHANNEL_SCHEMA.safeParse(rawChannel);
  const relayData = relay.success ? relay.data : {};
  const channelData = channel.success ? channel.data : {};

  return {
    relay: {
      host: relayData.host ?? DEFAULTS.relay.host,
      port: relayData.port ?? DEFAULTS.relay.port,
      identity: relayData.identity ?? DEFAULTS.relay.identity,
      unknownPeers: relayData.unknownPeers ?? DEFAULTS.relay.unknownPeers,
      admins: relayData.admins ?? DEFAULTS.relay.admins,
    },
    channel: {
      relay: channelData.relay ?? DEFAULTS.channel.relay,
    },
  };
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toIdentityMode(value: unknown): IdentityMode | undefined {
  return value === 'tailscale' || value === 'dev' ? value : undefined;
}

function toUnknownPeerPolicy(value: unknown): UnknownPeerPolicy | undefined {
  return value === 'refuse' || value === 'knock' ? value : undefined;
}
