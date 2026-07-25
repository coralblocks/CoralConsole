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

async function startMockActorServer() {
  const requests = [];
  const requestConnections = [];
  const sockets = new Map();
  let connectionCount = 0;
  let scopedListCount = 0;
  let healthCheckCount = 0;
  const server = createServer((socket) => {
    const connectionId = ++connectionCount;
    sockets.set(connectionId, socket);
    let received = Buffer.alloc(0);
    socket.on("close", () => sockets.delete(connectionId));
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      while (received.length) {
        const headerEnd = received.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const headers = received.subarray(0, headerEnd).toString("utf8").split("\r\n");
        const contentLength = Number(headers.find((line) => line.toLowerCase().startsWith("content-length:"))?.split(":")[1] || 0);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (received.length < bodyEnd) return;
        const input = JSON.parse(received.subarray(bodyStart, bodyEnd).toString("utf8"));
        received = received.subarray(bodyEnd);
        requests.push(input);
        requestConnections.push(connectionId);

        let results = "";
        if (input.adminCommand === "list" && input.params === "") {
          results = "VM\nSEQ\n";
        } else if (input.adminCommand === "list" && input.params === "SEQ") {
          scopedListCount += 1;
          results = [
            "SEQ open",
            "SEQ close",
            "SEQ status",
            ...(scopedListCount > 1 ? ["SEQ healthCheck"] : []),
            "SEQ rollSessionAuto",
            "SEQ invalidResult",
            "SEQ dropConnection",
            "",
            "SEQ-CommandReceiver-0.0.0.0:40002",
            "SEQ-SequencerMoldPublisher-224.0.0.0:40040",
            "SEQ-CircularStore-2607232154-1048576",
            "",
          ].join("\n");
        } else if (input.adminCommand === "SEQ status" && input.params === "") {
          results = [
            "actor type:\tSEQUENCER",
            "actor class:\tcom.coralblocks.coralsequencer.mq.PassThroughSequencer",
            "sequencer name:\tSEQ",
            "sequencer account:\tTRADING",
            "sequencer active:\ttrue",
            "sequencer open:\ttrue",
            "sequencer session:\t2607232154",
            "publisher pending replays:\t0",
            "",
          ].join("\n");
        } else if (input.adminCommand === "SEQ rollSessionAuto" && input.params === "") {
          results = "As a safeguard, pass 'true' to indicate you really want to do this!";
        } else if (input.adminCommand === "SEQ healthCheck" && input.params === "") {
          healthCheckCount += 1;
          results = healthCheckCount === 2 ? "NOT HEALTHY"
            : healthCheckCount === 3 ? "ALIVE but CLOSED"
              : "ALIVE and OPEN";
        } else if (input.adminCommand === "SEQ dropConnection" && input.params === "") {
          socket.destroy();
          return;
        }

        const actionResult = input.adminCommand === "SEQ invalidResult"
          ? "invalid"
          : input.adminCommand !== "SEQ rollSessionAuto";
        const responseBody = JSON.stringify({
          result: actionResult,
          adminCommand: input.adminCommand,
          params: input.params,
          results,
        }).replaceAll("\\t", "\t");
        const shouldClose = headers.some((line) => /^connection:\s*close$/i.test(line));
        const response = [
          "HTTP/1.1 200 OK",
          "Content-Type: application/json",
          "Date: Thu, 23 Jul 2026 21:59:06 Europe/Stockholm",
          `Content-Length: ${Buffer.byteLength(responseBody)}`,
          `Connection: ${shouldClose ? "close" : "keep-alive"}`,
          "",
          responseBody,
        ].join("\r\n");
        if (shouldClose) {
          socket.end(response);
          return;
        }
        socket.write(response);
      }
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock actor server did not bind to a TCP port.");
  return {
    server,
    port: address.port,
    requests,
    requestConnections,
    get connectionCount() { return connectionCount; },
    closeConnection(connectionId) {
      const socket = sockets.get(connectionId);
      if (!socket) return false;
      socket.destroy();
      return true;
    },
  };
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

test("standalone server persists settings, actors, and admin action audit in SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coralconsole-test-"));
  const databasePath = join(directory, "coralconsole.db");
  const port = await availablePort();
  let server;
  let actorServer;
  try {
    actorServer = await startMockActorServer();
    server = await startServer(databasePath, port);
    const health = await json(server.baseUrl, "/api/health");
    assert.equal(health.status, "ok");

    const initial = await json(server.baseUrl, "/api/settings");
    assert.equal(initial.settings.setupComplete, false);
    assert.equal(initial.settings.healthCheckIntervalSeconds, 5);

    const saved = await json(server.baseUrl, "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topologyName: "Test Topology",
        backgroundColor: "#e8f2ed",
        pollIntervalSeconds: 30,
        healthCheckIntervalSeconds: 1,
        auditRetentionDays: 90,
        summaryActorKinds: ["sequencer", "replayer", "application"],
        setupComplete: true,
      }),
    });
    assert.equal(saved.settings.topologyName, "Test Topology");
    assert.equal(saved.settings.healthCheckIntervalSeconds, 1);
    assert.deepEqual(saved.settings.summaryActorKinds, ["sequencer", "replayer", "application"]);

    const actorPayload = await json(server.baseUrl, "/api/actors");
    assert.equal(actorPayload.actors.length, 12);
    assert.equal(actorPayload.actors[0].demo, true);

    const discovered = await json(server.baseUrl, "/api/actors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "127.0.0.1", port: actorServer.port }),
    });
    assert.equal(discovered.actor.name, "SEQ");
    assert.equal(discovered.actor.kind, "sequencer");
    assert.equal(discovered.actor.className, "PassThroughSequencer");
    assert.equal(discovered.actor.account, "TRADING");
    assert.equal(discovered.actor.status, "online");
    assert.equal(discovered.actor.session, "2607232154");
    assert.equal(discovered.actor.sessionStarted, "23 Jul 2026 · 21:54");
    assert.equal(discovered.actor.actions.includes("status"), true);
    assert.equal(discovered.actor.actions.includes("healthCheck"), false);
    assert.equal("commands" in discovered.actor, false);
    assert.deepEqual(actorServer.requests, [
      { adminCommand: "list", params: "" },
      { adminCommand: "list", params: "SEQ" },
      { adminCommand: "SEQ status", params: "" },
    ]);
    assert.deepEqual(actorServer.requestConnections, [1, 2, 3]);

    const firstRefresh = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const firstRefreshedActor = firstRefresh.actors.find((actor) => actor.id === discovered.actor.id);
    assert.equal(firstRefreshedActor?.status, "online");
    assert.equal(firstRefreshedActor?.actions.includes("healthCheck"), true);
    const persistentConnection = actorServer.requestConnections.at(-1);
    assert.deepEqual(actorServer.requests.slice(-2), [
      { adminCommand: "SEQ status", params: "" },
      { adminCommand: "list", params: "SEQ" },
    ]);
    assert.equal(actorServer.requestConnections.at(-2), persistentConnection);
    const connectionsAfterFirstRefresh = actorServer.connectionCount;

    for (let attempt = 0; attempt < 100 && actorServer.requests.at(-1)?.adminCommand !== "SEQ healthCheck"; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.deepEqual(actorServer.requests.at(-1), { adminCommand: "SEQ healthCheck", params: "" });
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);
    assert.equal(actorServer.connectionCount, connectionsAfterFirstRefresh);

    const failedHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(failedHealthCheck.actors.find((actor) => actor.id === discovered.actor.id)?.status, "warning");
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);

    const recoveredHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(recoveredHealthCheck.actors.find((actor) => actor.id === discovered.actor.id)?.status, "online");
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);

    await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.deepEqual(actorServer.requests.slice(-2), [
      { adminCommand: "SEQ status", params: "" },
      { adminCommand: "list", params: "SEQ" },
    ]);
    assert.equal(actorServer.requestConnections.at(-2), persistentConnection);
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);
    assert.equal(actorServer.connectionCount, connectionsAfterFirstRefresh);

    await json(server.baseUrl, `/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", params: "" }),
    });
    assert.notEqual(actorServer.requestConnections.at(-1), persistentConnection);
    const successAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&query=status&outcome=success&limit=20`);
    assert.equal(successAudit.entries[0].outcome, "success");
    assert.equal("success" in successAudit.entries[0], false);

    const failedResponse = await fetch(`${server.baseUrl}/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rollSessionAuto", params: "" }),
    });
    const failedPayload = await failedResponse.json();
    assert.equal(failedResponse.ok, false);
    assert.match(failedPayload.error, /admin action failed/i);
    const failedAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&query=rollSessionAuto&outcome=failed&limit=20`);
    assert.equal(failedAudit.entries.length, 1);
    assert.equal(failedAudit.entries[0].action, "SEQ rollSessionAuto");
    assert.equal(failedAudit.entries[0].outcome, "failed");
    assert.match(failedAudit.entries[0].output, /safeguard/);

    const errorResponse = await fetch(`${server.baseUrl}/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invalidResult", params: "" }),
    });
    const errorPayload = await errorResponse.json();
    assert.equal(errorResponse.ok, false);
    assert.match(errorPayload.error, /required boolean result/i);
    const errorAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&outcome=error&limit=20`);
    assert.equal(errorAudit.entries.length, 1);
    assert.equal(errorAudit.entries[0].action, "SEQ invalidResult");
    assert.equal(errorAudit.entries[0].outcome, "error");

    const unreachableResponse = await fetch(`${server.baseUrl}/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dropConnection", params: "" }),
    });
    const unreachablePayload = await unreachableResponse.json();
    assert.equal(unreachableResponse.ok, false);
    assert.match(unreachablePayload.error, /could not reach the actor/i);
    const unreachableAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&outcome=unreachable&limit=20`);
    assert.equal(unreachableAudit.entries.length, 1);
    assert.equal(unreachableAudit.entries[0].action, "SEQ dropConnection");
    assert.equal(unreachableAudit.entries[0].outcome, "unreachable");

    assert.equal(actorServer.closeConnection(persistentConnection), true);
    let disconnectedActor;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const payload = await json(server.baseUrl, "/api/actors");
      disconnectedActor = payload.actors.find((actor) => actor.id === discovered.actor.id);
      if (disconnectedActor?.status === "offline") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(disconnectedActor?.status, "offline");

    const reconnected = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(reconnected.actors.find((actor) => actor.id === discovered.actor.id)?.status, "online");
    assert.notEqual(actorServer.requestConnections.at(-1), persistentConnection);
    assert.equal(actorServer.requestConnections.at(-2), actorServer.requestConnections.at(-1));

    const action = await json(server.baseUrl, "/api/actors/demo-seq-01/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", params: "" }),
    });
    assert.equal(action.result, true);

    const firstAudit = await json(server.baseUrl, "/api/audit?actorId=demo-seq-01&limit=20");
    assert.equal(firstAudit.entries.length, 1);
    assert.equal(firstAudit.entries[0].action, "SEQ-NYC-01 status");
    assert.equal("command" in firstAudit.entries[0], false);
    assert.match(firstAudit.entries[0].output, /simulated successfully/);

    await stopServer(server.child);
    server = await startServer(databasePath, port);
    const persistedSettings = await json(server.baseUrl, "/api/settings");
    const persistedAudit = await json(server.baseUrl, "/api/audit?actorId=demo-seq-01&limit=20");
    const persistedActors = await json(server.baseUrl, "/api/actors");
    assert.equal(persistedSettings.settings.topologyName, "Test Topology");
    assert.equal(persistedSettings.settings.healthCheckIntervalSeconds, 1);
    assert.deepEqual(persistedSettings.settings.summaryActorKinds, ["sequencer", "replayer", "application"]);
    assert.equal(persistedAudit.entries.length, 1);
    assert.equal(persistedActors.actors.some((actor) => actor.host === "127.0.0.1" && actor.port === actorServer.port), true);
  } finally {
    if (server) await stopServer(server.child);
    if (actorServer) await new Promise((resolveClose) => actorServer.server.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment and UI conventions stay explicit", async () => {
  const [page, actorDetail, guide, compose, dockerfile, dockerStart, dockerStop, dockerBackup, gitMergeToMain] = await Promise.all([
    readFile(join(projectRoot, "app/page.tsx"), "utf8"),
    readFile(join(projectRoot, "app/actor/[id]/actor-detail.tsx"), "utf8"),
    readFile(join(projectRoot, "AGENTS.md"), "utf8"),
    readFile(join(projectRoot, "docker-compose.yml"), "utf8"),
    readFile(join(projectRoot, "Dockerfile"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-start.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-stop.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-backup.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/git-merge-to-main.sh"), "utf8"),
  ]);
  assert.match(page, /target="_blank"/);
  assert.match(page, /\/api\/actors\/refresh/);
  assert.match(page, /\/api\/actors\/health/);
  assert.match(page, /Shared topology · Persisted in SQLite/);
  assert.match(actorDetail, /\/actions/);
  assert.match(actorDetail, /\/api\/actors\/refresh/);
  assert.match(actorDetail, /\/api\/actors\/health/);
  assert.match(actorDetail, /Recent activity/);
  assert.match(guide, /Keep this file current/);
  assert.match(compose, /coralconsole-data:\/data/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /node:22-trixie-slim/);
  assert.match(dockerfile, /python3 make g\+\+/);
  assert.match(dockerfile, /node_modules\/drizzle-orm/);
  assert.match(dockerStart, /docker compose up -d --no-build/);
  assert.match(dockerStop, /docker compose stop/);
  assert.doesNotMatch(`${dockerStart}\n${dockerStop}`, /down\s+-v|volume\s+rm|prune/);
  assert.match(dockerBackup, /source\.backup/);
  assert.match(dockerBackup, /quick_check/);
  assert.match(dockerBackup, /chmod 600/);
  assert.doesNotMatch(dockerBackup, /down\s+-v|volume\s+rm|prune/);
  assert.match(gitMergeToMain, /git status --porcelain/);
  assert.match(gitMergeToMain, /git merge --ff-only origin\/main/);
  assert.match(gitMergeToMain, /git merge --no-ff --no-edit/);
  assert.match(gitMergeToMain, /git push origin main/);
  assert.doesNotMatch(gitMergeToMain, /push[^\n]*--force/);
});
