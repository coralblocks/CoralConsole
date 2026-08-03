#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INTERNAL_DATABASE_MODE = "--internal-database-mode";
const CSV_HEADER = ["account", "host", "port", "kind", "sort_order"];
const projectRoot = resolve(import.meta.dirname, "..");

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function defaultOutputName() {
  const timestamp = new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `coralconsole-actors-${timestamp}.csv`;
}

async function exportFromDatabase() {
  const databasePath = process.env.DATABASE_PATH?.trim();
  if (!databasePath) throw new Error("DATABASE_PATH is not configured inside the CoralConsole container.");

  const { default: Database } = await import("better-sqlite3");
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 5000");
    const actors = sqlite.prepare(`
      SELECT account, host, port, kind, sort_order AS sortOrder
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
      actor.sortOrder,
    ])];
    process.stdout.write(`${lines.map((line) => line.map(csvField).join(",")).join("\n")}\n`);
    process.stderr.write(`Exported ${actors.length} ${actors.length === 1 ? "actor" : "actors"}.\n`);
  } finally {
    sqlite.close();
  }
}

async function exportThroughDocker() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: npm run actors:export -- [output.csv]");
  const outputPath = resolve(args[0] || defaultOutputName());
  const result = spawnSync("docker", [
    "compose",
    "exec",
    "-T",
    "coralconsole",
    "node",
    "scripts/export-actors.mjs",
    INTERNAL_DATABASE_MODE,
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") throw new Error("Docker is not installed or is not available on PATH.");
    throw result.error;
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error("Actor export failed. Make sure the current CoralConsole Compose service is running and uses the latest image.");
  }

  try {
    await writeFile(outputPath, result.stdout, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite the existing file ${outputPath}`);
    }
    throw error;
  }
  if (result.stderr) process.stderr.write(result.stderr);
  process.stdout.write(`Saved actor export to ${outputPath}\n`);
}

try {
  if (process.argv[2] === INTERNAL_DATABASE_MODE) await exportFromDatabase();
  else await exportThroughDocker();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Actor export failed."}\n`);
  process.exitCode = 1;
}
