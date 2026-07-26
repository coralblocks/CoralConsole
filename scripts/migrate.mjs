import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databasePath = resolve(process.env.DATABASE_PATH?.trim() || join(process.cwd(), ".data", "coralconsole.db"));
mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

try {
  migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), "drizzle") });
  sqlite.prepare(`
    INSERT OR IGNORE INTO topology_settings
      (id, topology_name, background_color, poll_interval_seconds, audit_retention_days, setup_complete)
    VALUES (1, 'Coral Topology', '#f4eee7', 5, 90, 0)
  `).run();
  console.log(`CoralConsole database ready at ${databasePath}`);
} finally {
  sqlite.close();
}
