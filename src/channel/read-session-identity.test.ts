import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionIdentity } from './read-session-identity';

function setupTest() {
  const dir = mkdtempSync(join(tmpdir(), 'backfence-registry-'));

  return {
    dir,
    [Symbol.dispose]() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('it takes the session name from the registry entry with the matching session id', () => {
  using ctx = setupTest();

  writeFileSync(
    join(ctx.dir, '4242.json'),
    JSON.stringify({ pid: 4242, sessionId: 'sess-1', cwd: '/repo/vers', name: 'vers-90' }),
  );

  writeFileSync(
    join(ctx.dir, '4300.json'),
    JSON.stringify({ pid: 4300, sessionId: 'sess-2', cwd: '/repo/other', name: 'other' }),
  );

  expect(
    readSessionIdentity(
      { CLAUDE_CODE_SESSION_ID: 'sess-1', CLAUDE_PROJECT_DIR: '/repo/vers' },
      ctx.dir,
    ),
  ).toStrictEqual({ sessionID: 'sess-1', sessionName: 'vers-90', cwd: '/repo/vers' });
});

test('it falls back to the project directory basename when no registry entry matches', () => {
  using ctx = setupTest();

  expect(
    readSessionIdentity(
      { CLAUDE_CODE_SESSION_ID: 'sess-9', CLAUDE_PROJECT_DIR: '/repo/vers' },
      ctx.dir,
    ),
  ).toStrictEqual({ sessionID: 'sess-9', sessionName: 'vers', cwd: '/repo/vers' });
});

test('it prefers an explicit BACKFENCE_SESSION_NAME over the registry', () => {
  using ctx = setupTest();

  writeFileSync(
    join(ctx.dir, '1.json'),
    JSON.stringify({ pid: 1, sessionId: 'sess-1', cwd: '/repo/vers', name: 'vers-90' }),
  );

  expect(
    readSessionIdentity(
      {
        CLAUDE_CODE_SESSION_ID: 'sess-1',
        CLAUDE_PROJECT_DIR: '/repo/vers',
        BACKFENCE_SESSION_NAME: 'ci',
      },
      ctx.dir,
    ).sessionName,
  ).toBe('ci');
});
