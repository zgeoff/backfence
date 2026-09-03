import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isRecord } from '../shared/is-record';

export interface SessionIdentity {
  readonly sessionID: string;
  readonly sessionName: string;
  readonly cwd: string;
}

const DEFAULT_REGISTRY = join(homedir(), '.claude', 'sessions');

/**
 * Who this channel process speaks for. Claude Code puts the session id and
 * project directory in the environment of every MCP server it spawns; the
 * session's name comes from the registry entry Claude Code writes for
 * itself, so it matches what ListAgents shows on that machine. With no
 * registry entry the directory's basename stands in.
 */
export function readSessionIdentity(
  env: Readonly<Record<string, string | undefined>> = process.env,
  registryDir = DEFAULT_REGISTRY,
): SessionIdentity {
  const sessionID = env['CLAUDE_CODE_SESSION_ID'] ?? `unregistered-${process.pid}`;
  const cwd = env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const override = env['BACKFENCE_SESSION_NAME'];

  if (override !== undefined && override !== '') {
    return { sessionID, sessionName: override, cwd };
  }

  return {
    sessionID,
    sessionName: findRegisteredName(registryDir, sessionID) ?? basename(cwd),
    cwd,
  };
}

function findRegisteredName(registryDir: string, sessionID: string): string | null {
  if (!existsSync(registryDir)) {
    return null;
  }

  for (const file of readdirSync(registryDir)) {
    if (!file.endsWith('.json')) {
      continue;
    }

    try {
      const entry: unknown = JSON.parse(readFileSync(join(registryDir, file), 'utf8'));

      if (
        isRecord(entry) &&
        entry['sessionId'] === sessionID &&
        typeof entry['name'] === 'string' &&
        entry['name'] !== ''
      ) {
        return entry['name'];
      }
    } catch {
      continue;
    }
  }

  return null;
}
