import { toKebab } from '../shared/to-kebab';
import type { UserRecord } from '../store/peer-store';

export type UserMatch =
  | { readonly kind: 'found'; readonly user: UserRecord }
  | { readonly kind: 'ambiguous'; readonly logins: readonly string[] }
  | { readonly kind: 'none' };

// A login wins outright; a person name matches by kebab display name and is ambiguous when
// shared.
export function findUserByName(users: readonly UserRecord[], name: string): UserMatch {
  const byLogin = users.find((u) => u.login === name);

  if (byLogin !== undefined) {
    return { kind: 'found', user: byLogin };
  }

  const byPerson = users.filter((u) => toKebab(u.displayName) === name);
  const [only] = byPerson;

  if (byPerson.length === 1 && only !== undefined) {
    return { kind: 'found', user: only };
  }

  if (byPerson.length > 1) {
    return { kind: 'ambiguous', logins: byPerson.map((u) => u.login) };
  }

  return { kind: 'none' };
}
