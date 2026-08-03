#!/usr/bin/env node

const INTERNAL_DATABASE_MODE = "--internal-database-mode";
const CSV_HEADER = ["account", "host", "port", "kind"];

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportFromDatabase() {
  const databasePath = process.env.DATABASE_PATH?.trim();
  if (!databasePath) throw new Error("DATABASE_PATH is not configured inside the CoralConsole container.");

  const { default: Database } = await import("better-sqlite3");
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 5000");
    const actors = sqlite.prepare(`
      SELECT account, host, port, kind
      FROM actors
      ORDER BY
        CASE kind
          WHEN 'sequencer' THEN 0
          WHEN 'backup-sequencer' THEN 1
          WHEN 'replayer' THEN 2
          WHEN 'archiver' THEN 3
          WHEN 'logger' THEN 4
          WHEN 'bridge' THEN 5
          WHEN 'dispatcher' THEN 6
          WHEN 'node' THEN 7
          WHEN 'application' THEN 8
          WHEN 'link' THEN 9
          WHEN 'multimqapp' THEN 10
          ELSE 99
        END,
        sort_order,
        created_at,
        id
    `).all();
    const lines = [CSV_HEADER, ...actors.map((actor) => [
      actor.account,
      actor.host,
      actor.port,
      actor.kind,
    ])];
    process.stdout.write(`${lines.map((line) => line.map(csvField).join(",")).join("\n")}\n`);
    process.stderr.write(`Exported ${actors.length} ${actors.length === 1 ? "actor" : "actors"}.\n`);
  } finally {
    sqlite.close();
  }
}

try {
  if (process.argv[2] !== INTERNAL_DATABASE_MODE || process.argv.length !== 3) {
    throw new Error("This database helper must be run inside CoralConsole by ./scripts/actors-export.sh.");
  }
  await exportFromDatabase();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Actor export failed."}\n`);
  process.exitCode = 1;
}
