#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const INTERNAL_DATABASE_MODE = "--internal-database-mode";
const CSV_HEADER = ["account", "host", "port", "kind"];
const ACTOR_KINDS = new Set([
  "sequencer",
  "backup-sequencer",
  "replayer",
  "archiver",
  "logger",
  "bridge",
  "dispatcher",
  "node",
  "application",
  "link",
  "multimqapp",
]);
const CLASS_NAMES = {
  sequencer: "Sequencer",
  "backup-sequencer": "Sequencer",
  replayer: "Replayer",
  archiver: "Archiver",
  logger: "Logger",
  bridge: "Bridge",
  dispatcher: "Dispatcher",
  node: "Node",
  application: "Application",
  link: "Link",
  multimqapp: "MultiMqApp",
};
const projectRoot = resolve(import.meta.dirname, "..");

function parseCsv(source) {
  const input = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const records = [];
  let fields = [];
  let field = "";
  let state = "plain";
  let line = 1;
  let recordLine = 1;

  const finishField = () => {
    fields.push(field);
    field = "";
    state = "plain";
  };
  const finishRecord = () => {
    finishField();
    records.push({ fields, line: recordLine });
    fields = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (state === "quoted") {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          state = "after-quote";
        }
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (state === "after-quote") {
      if (character === ",") {
        finishField();
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        finishRecord();
        line += 1;
        recordLine = line;
      } else {
        throw new Error(`CSV line ${line}: unexpected text after a closing quote.`);
      }
      continue;
    }

    if (character === '"') {
      if (field) throw new Error(`CSV line ${line}: a quoted field must begin with a quote.`);
      state = "quoted";
    } else if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRecord();
      line += 1;
      recordLine = line;
    } else {
      field += character;
    }
  }

  if (state === "quoted") throw new Error(`CSV line ${recordLine}: unterminated quoted field.`);
  if (state === "after-quote" || field || fields.length) finishRecord();
  return records;
}

function validActorHost(host, port) {
  try {
    const target = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    if (target.username || target.password || target.search || target.hash) return false;
    if (target.pathname !== "/" && target.pathname !== "") return false;
    target.port = String(port);
    return true;
  } catch {
    return false;
  }
}

function validateCsv(source) {
  const records = parseCsv(source);
  if (!records.length) throw new Error(`CSV must begin with the exact header: ${CSV_HEADER.join(",")}`);
  const header = records[0].fields;
  if (header.length !== CSV_HEADER.length || header.some((field, index) => field !== CSV_HEADER[index])) {
    throw new Error(`CSV must begin with the exact header: ${CSV_HEADER.join(",")}`);
  }

  const actors = [];
  const errors = [];
  const identities = new Map();
  for (const record of records.slice(1)) {
    if (record.fields.length !== CSV_HEADER.length) {
      errors.push(`CSV line ${record.line}: expected ${CSV_HEADER.length} columns.`);
      continue;
    }

    const [rawAccount, rawHost, rawPort, rawKind] = record.fields;
    const account = rawAccount.trim();
    const host = rawHost.trim();
    const kind = rawKind.trim();
    const port = /^\d+$/.test(rawPort.trim()) ? Number(rawPort.trim()) : Number.NaN;
    let valid = true;

    if (!account || /[\u0000-\u001f\u007f]/.test(account)) {
      errors.push(`CSV line ${record.line}: account must be non-empty text without control characters.`);
      valid = false;
    }
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !validActorHost(host, port)) {
      errors.push(`CSV line ${record.line}: host and port must form a valid CoralConsole actor endpoint.`);
      valid = false;
    }
    if (!ACTOR_KINDS.has(kind)) {
      errors.push(`CSV line ${record.line}: unsupported actor kind "${kind}".`);
      valid = false;
    }
    if (!valid) continue;

    const identity = JSON.stringify([host, port, account]);
    const identityLine = identities.get(identity);
    if (identityLine) {
      errors.push(`CSV line ${record.line}: actor identity duplicates line ${identityLine}.`);
    } else {
      identities.set(identity, record.line);
    }
    actors.push({ account, host, port, kind });
  }

  if (errors.length) throw new Error(`Actor import validation failed:\n${errors.join("\n")}`);
  return actors;
}

async function readStandardInput() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function importIntoDatabase() {
  const actors = validateCsv(await readStandardInput());
  const databasePath = process.env.DATABASE_PATH?.trim();
  if (!databasePath) throw new Error("DATABASE_PATH is not configured inside the CoralConsole container.");

  const { default: Database } = await import("better-sqlite3");
  const sqlite = new Database(databasePath, { fileMustExist: true });
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    const insert = sqlite.prepare(`
      INSERT INTO actors
        (id, name, kind, host, port, account, class_name, sequencer_role, sort_order)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importActors = sqlite.transaction((pendingActors) => {
      const actorCount = sqlite.prepare("SELECT COUNT(*) AS count FROM actors").get().count;
      if (actorCount !== 0) {
        throw new Error(`Actor import requires an empty actors table; this installation already contains ${actorCount} ${actorCount === 1 ? "actor" : "actors"}.`);
      }
      const nextSortOrderByKind = new Map();
      for (const actor of pendingActors) {
        const sortOrder = nextSortOrderByKind.get(actor.kind) || 0;
        nextSortOrderByKind.set(actor.kind, sortOrder + 1);
        const sequencerRole = actor.kind === "sequencer"
          ? "Primary"
          : actor.kind === "backup-sequencer"
            ? "Backup"
            : null;
        insert.run(
          randomUUID(),
          actor.account,
          actor.kind,
          actor.host,
          actor.port,
          actor.account,
          CLASS_NAMES[actor.kind],
          sequencerRole,
          sortOrder,
        );
      }
    });
    importActors.immediate(actors);
    const pronoun = actors.length === 1 ? "its" : "their";
    process.stdout.write(`Imported ${actors.length} ${actors.length === 1 ? "actor" : "actors"}. Normal polling will refresh ${pronoun} current status and metadata.\n`);
  } finally {
    sqlite.close();
  }
}

async function importThroughDocker() {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error("Usage: npm run actors:import -- <input.csv>");
  const inputPath = resolve(args[0]);
  const csv = await readFile(inputPath, "utf8");
  const result = spawnSync("docker", [
    "compose",
    "exec",
    "-T",
    "coralconsole",
    "node",
    "scripts/import-actors.mjs",
    INTERNAL_DATABASE_MODE,
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    input: csv,
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") throw new Error("Docker is not installed or is not available on PATH.");
    throw result.error;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error("Actor import failed. Make sure the current CoralConsole Compose service is running and uses the latest image.");
  }
}

try {
  if (process.argv[2] === INTERNAL_DATABASE_MODE) await importIntoDatabase();
  else await importThroughDocker();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Actor import failed."}\n`);
  process.exitCode = 1;
}
