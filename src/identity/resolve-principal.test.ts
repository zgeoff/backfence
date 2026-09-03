import { expect, test } from 'bun:test';
import { resolvePrincipal } from './resolve-principal';

test('it trusts the dev headers in dev mode', async () => {
  const principal = await resolvePrincipal(
    {
      remoteAddress: '127.0.0.1',
      headers: new Headers({
        'x-backfence-dev-login': 'bob@example.com',
        'x-backfence-dev-name': 'Bob',
      }),
    },
    'dev',
  );

  expect(principal).toStrictEqual({
    userID: 'dev:bob@example.com',
    login: 'bob@example.com',
    displayName: 'Bob',
    nodeID: 'dev',
    nodeName: 'dev',
    caps: {},
  });
});

test('it returns null in dev mode when the login header is absent', async () => {
  const principal = await resolvePrincipal(
    { remoteAddress: '127.0.0.1', headers: new Headers() },
    'dev',
  );

  expect(principal).toBeNull();
});

test('it returns null in tailscale mode when tailscaled is not listening', async () => {
  const principal = await resolvePrincipal(
    { remoteAddress: '100.64.0.1', headers: new Headers() },
    'tailscale',
    '/nonexistent/tailscaled.sock',
  );

  expect(principal).toBeNull();
});
