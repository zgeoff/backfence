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

// The session name comes from Claude Code's own registry so it matches what ListAgents shows;
// the directory basename stands in when no entry matches.
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
