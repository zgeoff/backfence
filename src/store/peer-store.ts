import { Database } from 'bun:sqlite';
import { Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely';
import type { Principal } from '../identity/principal';
import { BunSqliteDriver } from './bun-sqlite-driver';
import { runMigrations } from './run-migrations';
import type { PeerStoreSchema } from './run-migrations';

export type PeerStatus = 'allowed' | 'blocked' | 'pending';

export interface PeerRecord {
  readonly userID: string;
  readonly login: string;
  readonly displayName: string;
  readonly alias: string | null;
  readonly status: PeerStatus;
  readonly admin: boolean;
  readonly firstSeen: number;
  readonly lastSeen: number;
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

interface UpsertOptions {
  readonly status: PeerStatus;
  readonly admin: boolean;
  readonly now: number;
}

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

  async findPeer(userID: string): Promise<PeerRecord | null> {
    const row = await this.db
      .selectFrom('peers')
      .selectAll()
      .where('user_id', '=', userID)
      .executeTakeFirst();

    return row === undefined ? null : toPeerRecord(row);
  }

  // A peer by the name an address carries: alias first, then login.
  async findPeerByName(name: string): Promise<PeerRecord | null> {
    const row = await this.db
      .selectFrom('peers')
      .selectAll()
      .where((eb) => eb.or([eb('alias', '=', name), eb('login', '=', name)]))
      .orderBy('alias', 'desc')
      .executeTakeFirst();

    return row === undefined ? null : toPeerRecord(row);
  }

  // A known peer keeps its status; admin rights only ever go up, so a config admin becomes allowed
  // and admin whatever its row held.
  async upsertPeer(principal: Principal, options: UpsertOptions): Promise<PeerRecord> {
    await this.db
      .insertInto('peers')
      .values({
        user_id: principal.userID,
        login: principal.login,
        display_name: principal.displayName,
        alias: null,
        status: options.status,
        admin: options.admin ? 1 : 0,
        first_seen: options.now,
        last_seen: options.now,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet((eb) => ({
          login: principal.login,
          display_name: principal.displayName,
          last_seen: options.now,
          ...(options.admin ? { status: 'allowed', admin: 1 } : {}),
          ...(options.admin ? {} : { admin: eb.ref('peers.admin') }),
        })),
      )
      .execute();

    const record = await this.findPeer(principal.userID);

    if (record === null) {
      throw new Error(`peer ${principal.userID} vanished after upsert`);
    }

    return record;
  }

  async collectPeers(status: PeerStatus): Promise<PeerRecord[]> {
    const rows = await this.db
      .selectFrom('peers')
      .selectAll()
      .where('status', '=', status)
      .orderBy('first_seen', 'asc')
      .execute();

    return rows.map((row) => toPeerRecord(row));
  }

  // False when no peer has that user id.
  async updatePeerStatus(userID: string, status: PeerStatus, alias?: string): Promise<boolean> {
    const result = await this.db
      .updateTable('peers')
      .set({ status, ...(alias === undefined ? {} : { alias }) })
      .where('user_id', '=', userID)
      .executeTakeFirst();

    return (result.numUpdatedRows ?? 0n) > 0n;
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

  // Includes rows addressed to the peer with no session named.
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

  // Delivered messages and expired queued ones are gone for good.
  async removeStaleMessages(now: number): Promise<void> {
    await this.db
      .deleteFrom('messages')
      .where((eb) => eb.or([eb('delivered_at', 'is not', null), eb('expires_at', '<=', now)]))
      .execute();
  }

  async dispose(): Promise<void> {
    await this.db.destroy();

    this.sqlite.close();
  }
}

function toPeerRecord(row: Readonly<PeerStoreSchema['peers']>): PeerRecord {
  return {
    userID: row.user_id,
    login: row.login,
    displayName: row.display_name,
    alias: row.alias,
    status: toPeerStatus(row.status),
    admin: row.admin !== 0,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}

function toPeerStatus(value: string): PeerStatus {
  return value === 'allowed' || value === 'blocked' ? value : 'pending';
}
