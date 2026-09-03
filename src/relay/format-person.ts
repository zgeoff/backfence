import { toKebab } from '../shared/to-kebab';
import type { UserRecord } from '../store/peer-store';

// A person is their display name in kebab case, unless another user shares it or it is empty,
// in which case the login stands in.
export function formatPerson(user: UserRecord, users: readonly UserRecord[]): string {
  const person = toKebab(user.displayName);

  if (person === '') {
    return user.login;
  }

  const shared = users.some((u) => u.userID !== user.userID && toKebab(u.displayName) === person);

  return shared ? user.login : person;
}
