import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Migration, MigrationProvider } from 'kysely/migration';

interface PeersTable {
  user_id: string;
  login: string;
  display_name: string;
  alias: string | null;
  status: string;
  admin: number;
  first_seen: number;
  last_seen: number;
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
  peers: PeersTable;
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
