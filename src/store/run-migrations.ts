import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Migration, MigrationProvider } from 'kysely/migration';

interface UsersTable {
  user_id: string;
  login: string;
  display_name: string;
  first_seen: number;
  last_seen: number;
}

interface EdgesTable {
  a_user: string;
  b_user: string;
  a_state: string;
  a_at: number | null;
  b_state: string;
  b_at: number | null;
  knocked_at: number | null;
}

interface HeldTable {
  from_user: string;
  to_user: string;
  from_address: string;
  from_session: string;
  from_node: string;
  to_session: string;
  body: string;
  created_at: number;
  expires_at: number;
}

interface MessagesTable {
  id: string;
  from_user: string;
  from_address: string;
  to_user: string;
  to_session: string;
  body: string;
  created_at: number;
  delivered_at: number | null;
  expires_at: number;
}

export interface PeerStoreSchema {
  users: UsersTable;
  edges: EdgesTable;
  held: HeldTable;
  messages: MessagesTable;
}

const MIGRATIONS: Record<string, Migration> = {
  '001_create_initial_schema': {
    async up(db: Kysely<PeerStoreSchema>) {
      await db.schema
        .createTable('peers')
        .ifNotExists()
        .addColumn('user_id', 'text', (c) => c.primaryKey())
        .addColumn('login', 'text', (c) => c.notNull())
        .addColumn('display_name', 'text', (c) => c.notNull())
        .addColumn('alias', 'text')
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('admin', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('first_seen', 'integer', (c) => c.notNull())
        .addColumn('last_seen', 'integer', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('messages')
        .ifNotExists()
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('from_user', 'text', (c) => c.notNull())
        .addColumn('from_address', 'text', (c) => c.notNull())
        .addColumn('to_user', 'text', (c) => c.notNull())
        .addColumn('to_session', 'text', (c) => c.notNull())
        .addColumn('body', 'text', (c) => c.notNull())
        .addColumn('created_at', 'integer', (c) => c.notNull())
        .addColumn('delivered_at', 'integer')
        .addColumn('expires_at', 'integer', (c) => c.notNull())
        .execute();

      await db.schema
        .createIndex('messages_to_user_undelivered')
        .ifNotExists()
        .on('messages')
        .columns(['to_user', 'delivered_at'])
        .execute();
    },
  },
  '002_pairwise_consent': {
    async up(db: Kysely<PeerStoreSchema>) {
      await db.schema.dropTable('peers').ifExists().execute();

      await db.schema
        .createTable('users')
        .ifNotExists()
        .addColumn('user_id', 'text', (c) => c.primaryKey())
        .addColumn('login', 'text', (c) => c.notNull())
        .addColumn('display_name', 'text', (c) => c.notNull())
        .addColumn('first_seen', 'integer', (c) => c.notNull())
        .addColumn('last_seen', 'integer', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('edges')
        .ifNotExists()
        .addColumn('a_user', 'text', (c) => c.notNull())
        .addColumn('b_user', 'text', (c) => c.notNull())
        .addColumn('a_state', 'text', (c) => c.notNull())
        .addColumn('a_at', 'integer')
        .addColumn('b_state', 'text', (c) => c.notNull())
        .addColumn('b_at', 'integer')
        .addColumn('knocked_at', 'integer')
        .addPrimaryKeyConstraint('edges_pair', ['a_user', 'b_user'])
        .execute();

      await db.schema
        .createTable('held')
        .ifNotExists()
        .addColumn('from_user', 'text', (c) => c.notNull())
        .addColumn('to_user', 'text', (c) => c.notNull())
        .addColumn('from_address', 'text', (c) => c.notNull())
        .addColumn('from_session', 'text', (c) => c.notNull())
        .addColumn('from_node', 'text', (c) => c.notNull())
        .addColumn('to_session', 'text', (c) => c.notNull())
        .addColumn('body', 'text', (c) => c.notNull())
        .addColumn('created_at', 'integer', (c) => c.notNull())
        .addColumn('expires_at', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('held_pair', ['from_user', 'to_user'])
        .execute();
    },
  },
};

// Kysely records applied migrations in its own table, so reopening an up-to-date store is a no-op.
export async function runMigrations(db: Kysely<PeerStoreSchema>): Promise<void> {
  const provider: MigrationProvider = {
    getMigrations: () => Promise.resolve(MIGRATIONS),
  };

  const migrator = new Migrator({ db, provider });

  const result = await migrator.migrateToLatest();

  if (result.error !== undefined) {
    throw result.error instanceof Error
      ? result.error
      : new Error('migration failed', { cause: result.error });
  }
}
