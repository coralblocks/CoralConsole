import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import Database from "better-sqlite3";

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
  let actorStatusCount = 0;
  let session = "2607232154";
  let operationalState = { open: true, disconnected: false, rewinding: false, active: true };
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
        let resultOverride;
        if (input.adminCommand === "list" && input.params === "") {
          results = "VM\nSEQ\n";
        } else if (input.adminCommand === "list" && input.params === "SEQ") {
          scopedListCount += 1;
          results = [
            "SEQ open",
            "SEQ close",
            "SEQ actorStatus",
            "SEQ status",
            ...(scopedListCount > 1 ? ["SEQ healthCheck"] : []),
            "SEQ rollSessionAuto",
            "SEQ slowAction",
            "SEQ invalidResult",
            "SEQ dropConnection",
            "",
            "SEQ-CommandReceiver-0.0.0.0:40002",
            "SEQ-SequencerMoldPublisher-224.0.0.0:40040",
            "SEQ-CircularStore-2607232154-1048576",
            "",
          ].join("\n");
        } else if (input.adminCommand === "SEQ actorStatus" && input.params === "") {
          actorStatusCount += 1;
          results = [
            "name:\tSEQ",
            "type:\tSEQUENCER",
            "class:\tPassThroughSequencer",
            `open:\t${operationalState.open}`,
            `rewinding:\t${operationalState.rewinding}`,
            `active:\t${operationalState.active}`,
            `disconnected:\t${operationalState.disconnected}`,
            `session:\t${session}`,
            ...(actorStatusCount === 1
              ? [
                  "sequence:\t41",
                  "accounts:\t3",
                  "clock tick interval:\t1000",
                ]
              : [
                  "sequence:\t42",
                  "accounts:\t4",
                  "clockTickInterval:\t2000",
                ]),
            "store implementation:\tCircularStore-1048576-1450",
            "",
          ].join("\n");
        } else if (input.adminCommand === "SEQ rollSessionAuto" && input.params === "") {
          results = "As a safeguard, pass 'true' to indicate you really want to do this!";
        } else if (input.adminCommand === "SEQ slowAction" && input.params === "") {
          results = "Slow action complete";
        } else if (input.adminCommand === "SEQ healthCheck" && input.params === "") {
          healthCheckCount += 1;
          results = healthCheckCount === 2 ? "NOT HEALTHY"
            : healthCheckCount === 3 ? "ALIVE but CLOSED"
              : "ALIVE and OPEN";
          if (healthCheckCount === 4) resultOverride = false;
          if (healthCheckCount === 5) resultOverride = "invalid";
        } else if (input.adminCommand === "SEQ dropConnection" && input.params === "") {
          socket.destroy();
          return;
        }

        const actionResult = resultOverride ?? (input.adminCommand === "SEQ invalidResult"
          ? "invalid"
          : input.adminCommand !== "SEQ rollSessionAuto");
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
        const sendResponse = () => {
          if (shouldClose) {
            socket.end(response);
            return;
          }
          socket.write(response);
        };
        if (input.adminCommand === "SEQ slowAction") {
          setTimeout(sendResponse, 150);
        } else {
          sendResponse();
        }
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
    get activeConnectionCount() { return sockets.size; },
    get connectionCount() { return connectionCount; },
    setOperationalState(next) {
      operationalState = next;
    },
    setSession(next) {
      session = next;
    },
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
    assert.equal(initial.settings.keepPollingWithoutViewers, false);
    assert.equal(initial.settings.viewerGracePeriodSeconds, 90);

    const saved = await json(server.baseUrl, "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topologyName: "Test Topology",
        backgroundColor: "#e8f2ed",
        pollIntervalSeconds: 30,
        healthCheckIntervalSeconds: 1,
        keepPollingWithoutViewers: true,
        viewerGracePeriodSeconds: 5,
        auditRetentionDays: 90,
        summaryActorKinds: ["sequencer", "replayer", "application"],
        setupComplete: true,
      }),
    });
    assert.equal(saved.settings.topologyName, "Test Topology");
    assert.equal(saved.settings.healthCheckIntervalSeconds, 1);
    assert.equal(saved.settings.keepPollingWithoutViewers, true);
    assert.equal(saved.settings.viewerGracePeriodSeconds, 5);
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
    assert.equal(discovered.actor.account, "SEQ");
    assert.equal(discovered.actor.status, "online");
    assert.equal(discovered.actor.operationalState, "active");
    assert.equal(discovered.actor.session, "2607232154");
    assert.equal(discovered.actor.outboundSequence, "41");
    assert.equal(discovered.actor.accounts, "3");
    assert.equal(discovered.actor.clockTickInterval, "1000");
    assert.deepEqual(discovered.actor.actorStatusFields.at(-1), {
      label: "store implementation",
      value: "CircularStore-1048576-1450",
    });
    assert.equal(discovered.actor.sessionStarted, "23 Jul 2026 · 21:54");
    assert.equal(Number.isNaN(Date.parse(discovered.actor.actorStatusRespondedAt)), false);
    assert.equal(discovered.actor.actions.includes("actorStatus"), true);
    assert.equal(discovered.actor.actions.includes("status"), true);
    assert.equal(discovered.actor.actions.includes("healthCheck"), true);
    assert.equal("commands" in discovered.actor, false);
    assert.deepEqual(actorServer.requests, [
      { adminCommand: "list", params: "" },
      { adminCommand: "list", params: "SEQ" },
      { adminCommand: "SEQ actorStatus", params: "" },
    ]);
    assert.deepEqual(actorServer.requestConnections, [1, 2, 3]);

    const firstRefresh = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const firstRefreshedActor = firstRefresh.actors.find((actor) => actor.id === discovered.actor.id);
    assert.equal(firstRefreshedActor?.status, "online");
    assert.equal(firstRefreshedActor?.operationalState, "active");
    assert.equal(firstRefreshedActor?.outboundSequence, "42");
    assert.equal(firstRefreshedActor?.accounts, "4");
    assert.equal(firstRefreshedActor?.clockTickInterval, "2000");
    assert.equal(firstRefreshedActor?.actions.includes("healthCheck"), true);
    assert.equal(Number.isNaN(Date.parse(firstRefreshedActor?.actorStatusRespondedAt)), false);
    const persistentConnection = actorServer.requestConnections.at(-1);
    assert.deepEqual(actorServer.requests.slice(-2), [
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.equal(actorServer.requestConnections.at(-2), persistentConnection);
    const connectionsAfterFirstRefresh = actorServer.connectionCount;

    const operationalStateCases = [
      [{ open: false, disconnected: true, rewinding: true, active: true }, "closed"],
      [{ open: true, disconnected: true, rewinding: true, active: true }, "disconnected"],
      [{ open: true, disconnected: false, rewinding: true, active: true }, "rewinding"],
      [{ open: true, disconnected: false, rewinding: false, active: true }, "active"],
      [{ open: true, disconnected: false, rewinding: false, active: false }, "inactive"],
    ];
    for (const [reportedState, expectedState] of operationalStateCases) {
      actorServer.setOperationalState(reportedState);
      const targetedRefreshStart = actorServer.requests.length;
      const targetedRefresh = await json(server.baseUrl, `/api/actors/${discovered.actor.id}/refresh`, {
        method: "POST",
      });
      assert.equal(targetedRefresh.actor.id, discovered.actor.id);
      assert.equal(targetedRefresh.actor.operationalState, expectedState);
      assert.equal(Number.isNaN(Date.parse(targetedRefresh.actor.actorStatusRespondedAt)), false);
      const targetedPollRequests = actorServer.requests.slice(targetedRefreshStart)
        .filter((request) => request.adminCommand === "SEQ actorStatus" || (request.adminCommand === "list" && request.params === "SEQ"));
      assert.deepEqual(targetedPollRequests, [
        { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
        { adminCommand: "list", params: "SEQ", shouldLog: false },
      ]);
    }
    actorServer.setOperationalState({ open: true, disconnected: false, rewinding: false, active: true });
    assert.equal(actorServer.requestConnections.at(-2), persistentConnection);
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);

    actorServer.setSession("overnight-primary");
    const unparseableSessionRefresh = await json(server.baseUrl, `/api/actors/${discovered.actor.id}/refresh`, {
      method: "POST",
    });
    assert.equal(unparseableSessionRefresh.actor.session, "overnight-primary");
    assert.equal(unparseableSessionRefresh.actor.sessionStarted, undefined);
    actorServer.setSession("2607232154");

    const auditAfterTargetedRefresh = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&limit=20`);
    assert.equal(auditAfterTargetedRefresh.entries.length, 0);

    for (let attempt = 0; attempt < 100 && actorServer.requests.at(-1)?.adminCommand !== "SEQ healthCheck"; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.deepEqual(actorServer.requests.at(-1), { adminCommand: "SEQ healthCheck", params: "", shouldLog: false });
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);
    assert.equal(actorServer.connectionCount, connectionsAfterFirstRefresh);
    const actorBeforeForcedHealth = await json(server.baseUrl, `/api/actors/${discovered.actor.id}`);
    const actorStatusRespondedAtBeforeHealth = actorBeforeForcedHealth.actor.actorStatusRespondedAt;

    const failedHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const failedHealthActor = failedHealthCheck.actors.find((actor) => actor.id === discovered.actor.id);
    assert.equal(failedHealthActor?.status, "offline");
    assert.equal(failedHealthActor?.actorStatusRespondedAt, actorStatusRespondedAtBeforeHealth);
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);

    const recoveredHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(recoveredHealthCheck.actors.find((actor) => actor.id === discovered.actor.id)?.status, "online");
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);

    const falseHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(falseHealthCheck.actors.find((actor) => actor.id === discovered.actor.id)?.status, "offline");

    const invalidHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(invalidHealthCheck.actors.find((actor) => actor.id === discovered.actor.id)?.status, "offline");

    const validHealthCheck = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(validHealthCheck.actors.find((actor) => actor.id === discovered.actor.id)?.status, "online");

    await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.deepEqual(actorServer.requests.slice(-2), [
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.equal(actorServer.requestConnections.at(-2), persistentConnection);
    assert.equal(actorServer.requestConnections.at(-1), persistentConnection);
    assert.equal(actorServer.connectionCount, connectionsAfterFirstRefresh);

    const manualStatusStart = actorServer.requests.length;
    await json(server.baseUrl, `/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", params: "" }),
    });
    assert.deepEqual(actorServer.requests.slice(manualStatusStart, manualStatusStart + 4), [
      { adminCommand: "SEQ status", params: "" },
      { adminCommand: "SEQ healthCheck", params: "", shouldLog: false },
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.notEqual(actorServer.requestConnections[manualStatusStart], persistentConnection);
    assert.deepEqual(
      actorServer.requestConnections.slice(manualStatusStart + 1, manualStatusStart + 4),
      [persistentConnection, persistentConnection, persistentConnection],
    );
    const successAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&query=status&outcome=success&limit=20`);
    assert.equal(successAudit.entries[0].outcome, "success");
    assert.equal("success" in successAudit.entries[0], false);

    const slowActionStart = actorServer.requests.length;
    const slowAction = json(server.baseUrl, `/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "slowAction", params: "" }),
    });
    for (let attempt = 0; attempt < 50 && actorServer.requests.length === slowActionStart; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.deepEqual(actorServer.requests[slowActionStart], { adminCommand: "SEQ slowAction", params: "" });
    const requestsDuringSlowAction = actorServer.requests.length;
    await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(actorServer.requests.length, requestsDuringSlowAction);
    const slowActionReply = await slowAction;
    assert.equal(slowActionReply.result, true);
    assert.deepEqual(actorServer.requests.slice(slowActionStart, slowActionStart + 4), [
      { adminCommand: "SEQ slowAction", params: "" },
      { adminCommand: "SEQ healthCheck", params: "", shouldLog: false },
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.notEqual(actorServer.requestConnections[slowActionStart], persistentConnection);
    assert.deepEqual(
      actorServer.requestConnections.slice(slowActionStart + 1, slowActionStart + 4),
      [persistentConnection, persistentConnection, persistentConnection],
    );

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
    assert.equal(reconnected.actors.find((actor) => actor.id === discovered.actor.id)?.status, "offline");
    assert.notEqual(actorServer.requestConnections.at(-1), persistentConnection);
    assert.equal(actorServer.requestConnections.at(-2), actorServer.requestConnections.at(-1));
    const onlineAgain = await json(server.baseUrl, "/api/actors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(onlineAgain.actors.find((actor) => actor.id === discovered.actor.id)?.status, "online");

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

    const idleSettings = await json(server.baseUrl, "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepPollingWithoutViewers: false }),
    });
    assert.equal(idleSettings.settings.keepPollingWithoutViewers, false);
    for (let attempt = 0; attempt < 40 && actorServer.activeConnectionCount > 0; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.equal(actorServer.activeConnectionCount, 0);
    const requestsWhileIdle = actorServer.requests.length;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200));
    assert.equal(actorServer.requests.length, requestsWhileIdle);

    const presence = await json(server.baseUrl, "/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerId: "integration-test-viewer", active: true }),
    });
    assert.equal(presence.activeViewers, 1);
    assert.equal(presence.heartbeatIntervalSeconds, 2);
    for (let attempt = 0; attempt < 40 && actorServer.requests.length === requestsWhileIdle; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(actorServer.requests.length > requestsWhileIdle);
    assert.ok(actorServer.activeConnectionCount > 0);

    const requestsBeforeDeparture = actorServer.requests.length;
    const departure = await json(server.baseUrl, "/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerId: "integration-test-viewer", active: false }),
    });
    assert.equal(departure.activeViewers, 0);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
    assert.ok(actorServer.requests.length > requestsBeforeDeparture);
    for (let attempt = 0; attempt < 90 && actorServer.activeConnectionCount > 0; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.equal(actorServer.activeConnectionCount, 0);
    const requestsAfterGrace = actorServer.requests.length;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200));
    assert.equal(actorServer.requests.length, requestsAfterGrace);

    const backgroundSettings = await json(server.baseUrl, "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepPollingWithoutViewers: true }),
    });
    assert.equal(backgroundSettings.settings.keepPollingWithoutViewers, true);
    for (let attempt = 0; attempt < 40 && actorServer.requests.length === requestsAfterGrace; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(actorServer.requests.length > requestsAfterGrace);

    await stopServer(server.child);
    server = await startServer(databasePath, port);
    const persistedSettings = await json(server.baseUrl, "/api/settings");
    const persistedAudit = await json(server.baseUrl, "/api/audit?actorId=demo-seq-01&limit=20");
    const persistedActors = await json(server.baseUrl, "/api/actors");
    assert.equal(persistedSettings.settings.topologyName, "Test Topology");
    assert.equal(persistedSettings.settings.healthCheckIntervalSeconds, 1);
    assert.equal(persistedSettings.settings.keepPollingWithoutViewers, true);
    assert.equal(persistedSettings.settings.viewerGracePeriodSeconds, 5);
    assert.deepEqual(persistedSettings.settings.summaryActorKinds, ["sequencer", "replayer", "application"]);
    assert.equal(persistedAudit.entries.length, 1);
    assert.equal(persistedActors.actors.some((actor) => actor.host === "127.0.0.1" && actor.port === actorServer.port), true);
  } finally {
    if (server) await stopServer(server.child);
    if (actorServer) await new Promise((resolveClose) => actorServer.server.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
  }
});

test("actor migrations preserve audit references and initialize status metadata", async () => {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  try {
    const migrationNames = [
      "0000_oval_ender_wiggin",
      "0001_rapid_masque",
      "0002_huge_donald_blake",
      "0003_large_changeling",
      "0004_handy_thunderbolts",
      "0005_outgoing_invaders",
      "0006_skinny_redwing",
      "0007_abandoned_romulus",
      "0008_broken_storm",
      "0009_familiar_scarecrow",
    ];
    for (const [index, name] of migrationNames.entries()) {
      if (index === 5) {
        const insertActor = database.prepare(
          "INSERT INTO actors (id, name, kind, status, host, port, account, class_name, commands) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const [id, status] of [["a", "online"], ["b", "standby"], ["c", "warning"], ["d", "offline"]]) {
          insertActor.run(id, id, "node", status, id, 30001, id, "Node", "[]");
        }
        database.prepare(
          "INSERT INTO command_audit (actor_id, actor_name, actor_endpoint, command, output, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
        ).run("a", "a", "a:30001", "status", "ok", 1);
      }
      const sql = await readFile(join(projectRoot, "drizzle", `${name}.sql`), "utf8");
      const statements = sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
      database.transaction(() => statements.forEach((statement) => database.exec(statement)))();
    }
    assert.deepEqual(database.prepare("SELECT id, status FROM actors ORDER BY id").all(), [
      { id: "a", status: "online" },
      { id: "b", status: "online" },
      { id: "c", status: "offline" },
      { id: "d", status: "offline" },
    ]);
    assert.deepEqual(database.prepare("SELECT actor_id AS actorId FROM command_audit").get(), { actorId: "a" });
    assert.deepEqual(
      database.prepare("SELECT outbound_sequence AS outboundSequence, accounts, clock_tick_interval AS clockTickInterval, actor_status_fields AS actorStatusFields, status_responded_at AS actorStatusRespondedAt, operational_state AS operationalState FROM actors WHERE id = 'a'").get(),
      { outboundSequence: "Not reported", accounts: "Not reported", clockTickInterval: "Not reported", actorStatusFields: "[]", actorStatusRespondedAt: null, operationalState: "inactive" },
    );
    assert.deepEqual(database.pragma("foreign_key_check"), []);
  } finally {
    database.close();
  }
});

test("deployment and UI conventions stay explicit", async () => {
  const [page, actorDetail, actorUi, styles, layout, viewerPresence, guide, compose, dockerfile, dockerStart, dockerStop, dockerBackup, gitMergeToMain] = await Promise.all([
    readFile(join(projectRoot, "app/page.tsx"), "utf8"),
    readFile(join(projectRoot, "app/actor/[id]/actor-detail.tsx"), "utf8"),
    readFile(join(projectRoot, "app/actor-ui.tsx"), "utf8"),
    readFile(join(projectRoot, "app/globals.css"), "utf8"),
    readFile(join(projectRoot, "app/layout.tsx"), "utf8"),
    readFile(join(projectRoot, "app/viewer-presence.tsx"), "utf8"),
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
  assert.match(page, /Keep polling actors when nobody is viewing CoralConsole/);
  assert.match(page, /disabled=\{settingsDraft\.keepPollingWithoutViewers\}/);
  assert.match(page, /\["all", "online", "offline"\]/);
  assert.match(page, /actors online/);
  assert.match(page, /<small>ONLINE<\/small>/);
  assert.match(page, /<small>OFFLINE<\/small>/);
  assert.match(page, /sessionSequencer\?\.sessionStarted && <span>Started \{sessionSequencer\.sessionStarted\}<\/span>/);
  assert.doesNotMatch(page, /Start time not reported/);
  assert.match(page, /Immediately poll actorStatus and list for every actor/);
  assert.match(page, /actor-card-sequence/);
  assert.match(page, /actor\.status === "offline" \? " actor-card-offline" : ""/);
  assert.match(page, /const displayedSequence = actor\.status === "offline" \? "\?" : actor\.outboundSequence/);
  assert.match(page, /Sequence \$\{displayedSequence\}/);
  assert.match(page, /details, \$\{statusLabel\(actor\.status\)\} \(opens in a new tab\)/);
  assert.doesNotMatch(page, /status-dot/);
  assert.match(page, /operationalStateForDisplay\(actor\.status, actor\.operationalState\)/);
  assert.match(page, /state-\$\{displayedState\}/);
  assert.match(actorUi, /return status === "offline" \? "unknown" : state/);
  assert.doesNotMatch(page, /className="actor-data|className="actor-foot/);
  assert.match(page, /ACTOR_KINDS\.filter\(\(kind\) => kind !== "link"\)\.map/);
  assert.match(styles, /\.group-cards \{[^}]*grid-template-columns: 1fr/);
  assert.match(styles, /\.actor-card\.actor-card-offline,\s*\.actor-detail-panel\.actor-detail-offline \.inspector-head/);
  assert.match(styles, /background-image: repeating-linear-gradient/);
  assert.match(styles, /\.actor-detail-panel\.actor-detail-offline \.inspector-head \{[^}]*background-color: var\(--panel\)/);
  assert.match(styles, /\.actor-state-badge \{[^}]*font-weight: 800/);
  assert.match(styles, /\.actor-card \.actor-state-badge \{[^}]*font-size: 7px/);
  assert.match(styles, /\.actor-state-badge, \.status-badge \{[^}]*font-size: 8px/);
  assert.match(styles, /\.actor-card-sequence \{[^}]*font-size: 8px/);
  assert.match(styles, /\.actor-heading small \{[^}]*font-size: 8px/);
  assert.match(styles, /\.inspector-head p \{[^}]*font-size: 9px/);
  assert.doesNotMatch(styles, /\.sequencer-groups \.group-cards/);
  assert.match(page, /Shared topology · Persisted in SQLite/);
  assert.match(actorDetail, /\/actions/);
  assert.match(actorDetail, /\/api\/actors\/refresh/);
  assert.match(actorDetail, /\/api\/actors\/health/);
  assert.match(actorDetail, /Recent activity/);
  assert.match(actorDetail, /<BrandIcon \/>/);
  assert.match(actorDetail, /Refresh actor status/);
  assert.match(actorDetail, /actor\.status === "offline" \? " actor-detail-offline" : ""/);
  assert.match(actorDetail, /operationalStateForDisplay\(actor\.status, actor\.operationalState\)/);
  assert.match(actorDetail, /state-\$\{displayedState\}/);
  assert.match(actorDetail, /operationalStateLabel\(displayedState\)/);
  assert.match(actorDetail, /\/api\/actors\/\$\{encodeURIComponent\(actor\.id\)\}\/refresh/);
  assert.match(actorDetail, /formatLastActorStatusResponse\(actor\.actorStatusRespondedAt\)/);
  assert.match(actorDetail, /<dt>REST endpoint<\/dt>[\s\S]*<dt>Last response<\/dt>[\s\S]*actor\.actorStatusFields\.map/);
  assert.doesNotMatch(actorDetail, /Back to topology/);
  assert.doesNotMatch(actorDetail, /Return to topology/);
  assert.match(styles, /\.status-refresh-button \{[^}]*background: color-mix/);
  for (const state of ["active", "inactive", "closed", "rewinding", "disconnected", "unknown"]) {
    assert.match(styles, new RegExp(`\\.actor-state-badge\\.state-${state} \\{`));
  }
  assert.match(layout, /ViewerPresence/);
  assert.match(viewerPresence, /\/api\/presence/);
  assert.match(viewerPresence, /crypto\.randomUUID/);
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
