import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

type DatabaseState = {
  sqlite: Database.Database;
  orm: ReturnType<typeof drizzle<typeof schema>>;
};

const globalDatabase = globalThis as typeof globalThis & { coralDatabase?: DatabaseState };

export function databasePath() {
  return process.env.DATABASE_PATH?.trim()
    || join(/* turbopackIgnore: true */ process.cwd(), ".data", "coralconsole.db");
}

function openDatabase(): DatabaseState {
  const filePath = databasePath();
  mkdirSync(dirname(filePath), { recursive: true });

  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const orm = drizzle(sqlite, { schema });
  migrate(orm, { migrationsFolder: join(/* turbopackIgnore: true */ process.cwd(), "drizzle") });
  sqlite.prepare(`
    INSERT OR IGNORE INTO topology_settings
      (id, topology_name, background_color, poll_interval_seconds, audit_retention_days, setup_complete)
    VALUES (1, 'Coral Topology', '#f4eee7', 30, 90, 0)
  `).run();

  return { sqlite, orm };
}

function state() {
  globalDatabase.coralDatabase ??= openDatabase();
  return globalDatabase.coralDatabase;
}

export function getDb() {
  return state().orm;
}

export function getSqlite() {
  return state().sqlite;
}
