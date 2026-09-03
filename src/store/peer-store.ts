import { Database } from 'bun:sqlite';
import { Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely';
import type { Principal } from '../identity/principal';
import { BunSqliteDriver } from './bun-sqlite-driver';
import { runMigrations } from './run-migrations';
import type { PeerStoreSchema } from './run-migrations';

export type SideState = 'none' | 'accepted' | 'declined' | 'blocked';

export interface UserRecord {
  readonly userID: string;
  readonly login: string;
  readonly displayName: string;
  readonly firstSeen: number;
  readonly lastSeen: number;
}

// One pair's edge seen from one side: `you` is that side's decision, `them` the other's.
export interface EdgeRecord {
  readonly otherUser: string;
  readonly you: SideState;
  readonly youAt: number | null;
  readonly them: SideState;
  readonly themAt: number | null;
  readonly knockedAt: number | null;
}

export interface HeldMessage {
  readonly fromUser: string;
  readonly toUser: string;
  readonly fromAddress: string;
  readonly fromSession: string;
  readonly fromNode: string;
  readonly toSession: string;
  readonly body: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface QueuedMessage {
  readonly id: string;
  readonly fromUser: string;
  readonly fromAddress: string;
  readonly toUser: string;
  readonly toSession: string;
  readonly body: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

const NO_EDGE: Omit<EdgeRecord, 'otherUser'> = {
  you: 'none',
  youAt: null,
  them: 'none',
  themAt: null,
  knockedAt: null,
};

// Every query runs through kysely over the one bun:sqlite connection this store owns, so every
// method is asynchronous and the driver's connection mutex keeps writes ordered.
export class PeerStore {
  private readonly sqlite: Database;

  private readonly db: Kysely<PeerStoreSchema>;

  private constructor(sqlite: Database, db: Kysely<PeerStoreSchema>) {
    this.sqlite = sqlite;
    this.db = db;
  }

  // Migrations run statements that cannot happen inside a constructor, so
  // opening a store is this factory instead of `new`.
  static async open(dbPath: string): Promise<PeerStore> {
    const sqlite = new Database(dbPath, { create: true });

    sqlite.run('PRAGMA journal_mode = WAL;');

    const db = new Kysely<PeerStoreSchema>({
      dialect: {
        createAdapter: () => new SqliteAdapter(),
        createDriver: () => new BunSqliteDriver(sqlite),
        createIntrospector: (kysely) => new SqliteIntrospector(kysely),
        createQueryCompiler: () => new SqliteQueryCompiler(),
      },
    });

    await runMigrations(db);

    return new PeerStore(sqlite, db);
  }

  async upsertUser(principal: Principal, now: number): Promise<UserRecord> {
    await this.db
      .insertInto('users')
      .values({
        user_id: principal.userID,
        login: principal.login,
        display_name: principal.displayName,
        first_seen: now,
        last_seen: now,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          login: principal.login,
          display_name: principal.displayName,
          last_seen: now,
        }),
      )
      .execute();

    const record = await this.findUser(principal.userID);

    if (record === null) {
      throw new Error(`user ${principal.userID} vanished after upsert`);
    }

    return record;
  }

  async findUser(userID: string): Promise<UserRecord | null> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('user_id', '=', userID)
      .executeTakeFirst();

    return row === undefined ? null : toUserRecord(row);
  }

  async collectUsers(): Promise<UserRecord[]> {
    const rows = await this.db
      .selectFrom('users')
      .selectAll()
      .orderBy('first_seen', 'asc')
      .execute();

    return rows.map((row) => toUserRecord(row));
  }

  // A pair with no row is an edge with both sides undecided.
  async findEdge(userID: string, otherUser: string): Promise<EdgeRecord> {
    const [a, b] = sortPair(userID, otherUser);

    const row = await this.db
      .selectFrom('edges')
      .selectAll()
      .where('a_user', '=', a)
      .where('b_user', '=', b)
      .executeTakeFirst();

    return row === undefined ? { otherUser, ...NO_EDGE } : toEdgeRecord(row, userID);
  }

  async collectEdges(userID: string): Promise<EdgeRecord[]> {
    const rows = await this.db
      .selectFrom('edges')
      .selectAll()
      .where((eb) => eb.or([eb('a_user', '=', userID), eb('b_user', '=', userID)]))
      .execute();

    return rows.map((row) => toEdgeRecord(row, userID));
  }

  async updateEdgeSide(
    userID: string,
    otherUser: string,
    state: SideState,
    now: number,
  ): Promise<EdgeRecord> {
    const [a, b] = sortPair(userID, otherUser);
    const mine = a === userID;
    const patch = mine ? { a_state: state, a_at: now } : { b_state: state, b_at: now };

    await this.db
      .insertInto('edges')
      .values({
        a_user: a,
        b_user: b,
        a_state: mine ? state : 'none',
        a_at: mine ? now : null,
        b_state: mine ? 'none' : state,
        b_at: mine ? null : now,
        knocked_at: null,
      })
      .onConflict((oc) => oc.columns(['a_user', 'b_user']).doUpdateSet(patch))
      .execute();

    return this.findEdge(userID, otherUser);
  }

  async updateKnockedAt(userID: string, otherUser: string, now: number): Promise<void> {
    const [a, b] = sortPair(userID, otherUser);

    await this.db
      .updateTable('edges')
      .set({ knocked_at: now })
      .where('a_user', '=', a)
      .where('b_user', '=', b)
      .execute();
  }

  // One held message per direction: a newer one replaces the older.
  async writeHeld(held: HeldMessage): Promise<void> {
    await this.db
      .insertInto('held')
      .values({
        from_user: held.fromUser,
        to_user: held.toUser,
        from_address: held.fromAddress,
        from_session: held.fromSession,
        from_node: held.fromNode,
        to_session: held.toSession,
        body: held.body,
        created_at: held.createdAt,
        expires_at: held.expiresAt,
      })
      .onConflict((oc) =>
        oc.columns(['from_user', 'to_user']).doUpdateSet({
          from_address: held.fromAddress,
          from_session: held.fromSession,
          from_node: held.fromNode,
          to_session: held.toSession,
          body: held.body,
          created_at: held.createdAt,
          expires_at: held.expiresAt,
        }),
      )
      .execute();
  }

  async findHeld(fromUser: string, toUser: string, now: number): Promise<HeldMessage | null> {
    const row = await this.db
      .selectFrom('held')
      .selectAll()
      .where('from_user', '=', fromUser)
      .where('to_user', '=', toUser)
      .where('expires_at', '>', now)
      .executeTakeFirst();

    return row === undefined
      ? null
      : {
          fromUser: row.from_user,
          toUser: row.to_user,
          fromAddress: row.from_address,
          fromSession: row.from_session,
          fromNode: row.from_node,
          toSession: row.to_session,
          body: row.body,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        };
  }

  async removeHeld(fromUser: string, toUser: string): Promise<void> {
    await this.db
      .deleteFrom('held')
      .where('from_user', '=', fromUser)
      .where('to_user', '=', toUser)
      .execute();
  }

  async writeMessage(message: QueuedMessage): Promise<void> {
    await this.db
      .insertInto('messages')
      .values({
        id: message.id,
        from_user: message.fromUser,
        from_address: message.fromAddress,
        to_user: message.toUser,
        to_session: message.toSession,
        body: message.body,
        created_at: message.createdAt,
        delivered_at: null,
        expires_at: message.expiresAt,
      })
      .execute();
  }

  // Includes rows addressed to the user with no session named.
  async collectQueued(toUser: string, toSession: string, now: number): Promise<QueuedMessage[]> {
    const rows = await this.db
      .selectFrom('messages')
      .selectAll()
      .where('to_user', '=', toUser)
      .where('delivered_at', 'is', null)
      .where('expires_at', '>', now)
      .where('to_session', 'in', [toSession, ''])
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      fromUser: row.from_user,
      fromAddress: row.from_address,
      toUser: row.to_user,
      toSession: row.to_session,
      body: row.body,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  async updateDelivered(id: string, at: number): Promise<boolean> {
    const result = await this.db
      .updateTable('messages')
      .set({ delivered_at: at })
      .where('id', '=', id)
      .where('delivered_at', 'is', null)
      .executeTakeFirst();

    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  // Delivered messages, expired queued ones, and expired held ones are gone for good.
  async removeStaleMessages(now: number): Promise<void> {
    await this.db
      .deleteFrom('messages')
      .where((eb) => eb.or([eb('delivered_at', 'is not', null), eb('expires_at', '<=', now)]))
      .execute();

    await this.db.deleteFrom('held').where('expires_at', '<=', now).execute();
  }

  async dispose(): Promise<void> {
    await this.db.destroy();

    this.sqlite.close();
  }
}

function sortPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

function toUserRecord(row: Readonly<PeerStoreSchema['users']>): UserRecord {
  return {
    userID: row.user_id,
    login: row.login,
    displayName: row.display_name,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}

function toEdgeRecord(row: Readonly<PeerStoreSchema['edges']>, userID: string): EdgeRecord {
  const mine = row.a_user === userID;
  const yourState = mine ? row.a_state : row.b_state;
  const theirState = mine ? row.b_state : row.a_state;

  return {
    otherUser: mine ? row.b_user : row.a_user,
    you: toSideState(yourState),
    youAt: mine ? row.a_at : row.b_at,
    them: toSideState(theirState),
    themAt: mine ? row.b_at : row.a_at,
    knockedAt: row.knocked_at,
  };
}

function toSideState(value: string): SideState {
  return value === 'accepted' || value === 'declined' || value === 'blocked' ? value : 'none';
}
