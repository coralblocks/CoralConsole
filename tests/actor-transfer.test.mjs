import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const projectRoot = resolve(import.meta.dirname, "..");
const internalMode = "--internal-database-mode";

function runNode(script, databasePath, input) {
  return spawnSync(process.execPath, [join(projectRoot, script), internalMode], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: databasePath },
    input,
  });
}

function migrate(databasePath) {
  const result = spawnSync(process.execPath, [join(projectRoot, "scripts/migrate.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: databasePath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("actor CSV export and empty-database import preserve portable actor configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coralconsole-actor-transfer-"));
  const sourcePath = join(directory, "source.db");
  const targetPath = join(directory, "target.db");
  try {
    migrate(sourcePath);
    const source = new Database(sourcePath);
    const insert = source.prepare(`
      INSERT INTO actors (id, name, kind, host, port, account, class_name, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run("source-seq", "Source Sequencer", "sequencer", "10.0.0.1", 30001, "SEQ,PRIMARY", "PassThroughSequencer", 0);
    insert.run("source-node-b", "Node B", "node", "10.0.0.3", 30003, "NODE-B", "SimpleNode", 4);
    insert.run("source-node-a", "Node A", "node", "10.0.0.2", 30002, "NODE-A", "SimpleNode", 1);
    source.close();

    const exported = runNode("scripts/export-actors.mjs", sourcePath);
    assert.equal(exported.status, 0, exported.stderr);
    assert.match(exported.stderr, /Exported 3 actors/);
    assert.equal(exported.stdout.startsWith("account,host,port,kind\n"), true);
    assert.equal(exported.stdout.includes("format_version"), false);
    assert.match(exported.stdout, /"SEQ,PRIMARY",10\.0\.0\.1,30001,sequencer/);
    assert.ok(exported.stdout.indexOf("NODE-A") < exported.stdout.indexOf("NODE-B"));

    migrate(targetPath);
    const imported = runNode("scripts/import-actors.mjs", targetPath, exported.stdout);
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /Imported 3 actors/);

    const target = new Database(targetPath);
    const columns = target.prepare("PRAGMA table_info(actors)").all().map((column) => column.name);
    assert.equal(columns.includes("demo"), false);
    const actors = target.prepare(`
      SELECT id, name, kind, status, operational_state AS operationalState,
        host, port, account, class_name AS className, sequencer_role AS sequencerRole,
        sort_order AS sortOrder
      FROM actors
      ORDER BY CASE kind WHEN 'sequencer' THEN 0 ELSE 1 END, sort_order
    `).all();
    assert.deepEqual(actors.map((actor) => {
      const withoutId = { ...actor };
      delete withoutId.id;
      return withoutId;
    }), [
      {
        name: "SEQ,PRIMARY",
        kind: "sequencer",
        status: "offline",
        operationalState: "inactive",
        host: "10.0.0.1",
        port: 30001,
        account: "SEQ,PRIMARY",
        className: "Sequencer",
        sequencerRole: "Primary",
        sortOrder: 0,
      },
      {
        name: "NODE-A",
        kind: "node",
        status: "offline",
        operationalState: "inactive",
        host: "10.0.0.2",
        port: 30002,
        account: "NODE-A",
        className: "Node",
        sequencerRole: null,
        sortOrder: 0,
      },
      {
        name: "NODE-B",
        kind: "node",
        status: "offline",
        operationalState: "inactive",
        host: "10.0.0.3",
        port: 30003,
        account: "NODE-B",
        className: "Node",
        sequencerRole: null,
        sortOrder: 1,
      },
    ]);
    assert.equal(actors.some((actor) => actor.id.startsWith("source-")), false);
    target.close();

    const repeated = runNode("scripts/import-actors.mjs", targetPath, exported.stdout);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /requires an empty actors table/);
    const unchanged = new Database(targetPath, { readonly: true });
    assert.equal(unchanged.prepare("SELECT COUNT(*) AS count FROM actors").get().count, 3);
    unchanged.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("actor CSV import rejects invalid files without writing rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coralconsole-actor-validation-"));
  const databasePath = join(directory, "target.db");
  try {
    migrate(databasePath);
    const invalid = [
      "account,host,port,kind",
      "NODE-A,10.0.0.1,30001,node",
      "NODE-A,10.0.0.1,30001,node",
      "NODE-B,10.0.0.2,30002,node",
      "BROKEN,10.0.0.3,70000,unknown",
      "",
    ].join("\n");
    const result = runNode("scripts/import-actors.mjs", databasePath, invalid);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /actor identity duplicates line 2/);
    assert.match(result.stderr, /valid CoralConsole actor endpoint/);
    assert.match(result.stderr, /unsupported actor kind/);
    const sqlite = new Database(databasePath, { readonly: true });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM actors").get().count, 0);
    sqlite.close();

    const oldHeader = runNode(
      "scripts/import-actors.mjs",
      databasePath,
      "account,host,port,kind,sort_order\nNODE-A,10.0.0.1,30001,node,0\n",
    );
    assert.notEqual(oldHeader.status, 0);
    assert.match(oldHeader.stderr, /exact header: account,host,port,kind/);

    const interleaved = [
      "account,host,port,kind",
      "NODE-B,10.0.0.2,30002,node",
      "SEQ,10.0.0.1,30001,sequencer",
      "NODE-A,10.0.0.3,30003,node",
      "APP,10.0.0.4,30004,application",
      "NODE-C,10.0.0.5,30005,node",
      "",
    ].join("\n");
    const imported = runNode("scripts/import-actors.mjs", databasePath, interleaved);
    assert.equal(imported.status, 0, imported.stderr);
    const ordered = new Database(databasePath, { readonly: true });
    assert.deepEqual(
      ordered.prepare("SELECT account, kind, sort_order AS sortOrder FROM actors ORDER BY kind, sort_order").all(),
      [
        { account: "APP", kind: "application", sortOrder: 0 },
        { account: "NODE-B", kind: "node", sortOrder: 0 },
        { account: "NODE-A", kind: "node", sortOrder: 1 },
        { account: "NODE-C", kind: "node", sortOrder: 2 },
        { account: "SEQ", kind: "sequencer", sortOrder: 0 },
      ],
    );
    ordered.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
