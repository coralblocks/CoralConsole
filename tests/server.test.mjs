import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function startServer(databasePath, port) {
  const child = spawn(process.execPath, [join(projectRoot, ".next/standalone/server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      CORAL_DEMO_MODE: "true",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server stopped before becoming ready:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl };
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  child.kill("SIGTERM");
  throw new Error(`Server did not become ready:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolveStop(); }, 2000);
    child.once("exit", () => { clearTimeout(timeout); resolveStop(); });
  });
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = await response.json();
  assert.equal(response.ok, true, `${path}: ${payload.error || response.status}`);
  return payload;
}

test("standalone server persists settings, actors, and command audit in SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coralconsole-test-"));
  const databasePath = join(directory, "coralconsole.db");
  const port = await availablePort();
  let server;
  try {
    server = await startServer(databasePath, port);
    const health = await json(server.baseUrl, "/api/health");
    assert.equal(health.status, "ok");

    const initial = await json(server.baseUrl, "/api/settings");
    assert.equal(initial.settings.setupComplete, false);

    const saved = await json(server.baseUrl, "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topologyName: "Test Topology",
        backgroundColor: "#e8f2ed",
        pollIntervalSeconds: 30,
        auditRetentionDays: 90,
        setupComplete: true,
      }),
    });
    assert.equal(saved.settings.topologyName, "Test Topology");

    const actorPayload = await json(server.baseUrl, "/api/actors");
    assert.equal(actorPayload.actors.length, 12);
    assert.equal(actorPayload.actors[0].demo, true);

    const command = await json(server.baseUrl, "/api/actors/demo-seq-01/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "status", params: "" }),
    });
    assert.equal(command.result, true);

    const firstAudit = await json(server.baseUrl, "/api/audit?actorId=demo-seq-01&limit=20");
    assert.equal(firstAudit.entries.length, 1);
    assert.match(firstAudit.entries[0].output, /simulated successfully/);

    await stopServer(server.child);
    server = await startServer(databasePath, port);
    const persistedSettings = await json(server.baseUrl, "/api/settings");
    const persistedAudit = await json(server.baseUrl, "/api/audit?actorId=demo-seq-01&limit=20");
    assert.equal(persistedSettings.settings.topologyName, "Test Topology");
    assert.equal(persistedAudit.entries.length, 1);
  } finally {
    if (server) await stopServer(server.child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment and UI conventions stay explicit", async () => {
  const [page, actorDetail, guide, compose, dockerfile] = await Promise.all([
    readFile(join(projectRoot, "app/page.tsx"), "utf8"),
    readFile(join(projectRoot, "app/actor/[id]/actor-detail.tsx"), "utf8"),
    readFile(join(projectRoot, "AGENTS.md"), "utf8"),
    readFile(join(projectRoot, "docker-compose.yml"), "utf8"),
    readFile(join(projectRoot, "Dockerfile"), "utf8"),
  ]);
  assert.match(page, /target="_blank"/);
  assert.match(page, /\/api\/actors\/refresh/);
  assert.match(page, /Shared topology · Persisted in SQLite/);
  assert.match(actorDetail, /\/commands/);
  assert.match(actorDetail, /Recent activity/);
  assert.match(guide, /Keep this file current/);
  assert.match(compose, /coralconsole-data:\/data/);
  assert.match(dockerfile, /HEALTHCHECK/);
});
