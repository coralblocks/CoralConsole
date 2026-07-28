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
  let actorStatusCount = 0;
  let actorStatusResult = true;
  let actorStatusHasFields = true;
  let session = "2607232154";
  let operationalState = { open: true, disconnected: false, rewinding: false, active: true };
  const server = createServer((socket) => {
    const connectionId = ++connectionCount;
    sockets.set(connectionId, socket);
    let received = Buffer.alloc(0);
    socket.on("error", (error) => {
      assert.ok(
        error.code === "ECONNRESET" || error.code === "EPIPE",
        `Unexpected mock actor socket error: ${error.message}`,
      );
    });
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
          resultOverride = actorStatusResult;
          results = actorStatusHasFields ? [
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
          ].join("\n") : "";
        } else if (input.adminCommand === "SEQ rollSessionAuto" && input.params === "") {
          results = "As a safeguard, pass 'true' to indicate you really want to do this!";
        } else if (input.adminCommand === "SEQ slowAction" && input.params === "") {
          results = "Slow action complete";
        } else if (input.adminCommand === "SEQ healthCheck" && input.params === "") {
          results = "ALIVE and OPEN";
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
    setActorStatusResult(next) {
      actorStatusResult = next;
    },
    setActorStatusHasFields(next) {
      actorStatusHasFields = next;
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
  const upstreamPort = await availablePort();
  const child = spawn(process.execPath, [join(projectRoot, ".next/standalone/server.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      CORAL_DEMO_MODE: "true",
      CORAL_TRUSTED_INGRESS: "true",
      HOSTNAME: "127.0.0.1",
      PORT: String(upstreamPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
  let upstreamReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server stopped before becoming ready:\n${output}`);
    try {
      const response = await fetch(`${upstreamUrl}/api/health`);
      if (response.ok) {
        upstreamReady = true;
        break;
      }
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (!upstreamReady) {
    child.kill("SIGTERM");
    throw new Error(`Server did not become ready:\n${output}`);
  }

  const ingressChild = spawn(process.execPath, [join(projectRoot, "scripts/trusted-ingress.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CORAL_INGRESS_BIND_ADDRESS: "127.0.0.1",
      CORAL_INGRESS_PORT: String(port),
      CORAL_UPSTREAM_HOST: "127.0.0.1",
      CORAL_UPSTREAM_PORT: String(upstreamPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  ingressChild.stdout.on("data", (chunk) => { output += chunk; });
  ingressChild.stderr.on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (ingressChild.exitCode !== null) {
      child.kill("SIGTERM");
      throw new Error(`Trusted ingress stopped before becoming ready:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, ingressChild, baseUrl };
    } catch {
      // The trusted ingress is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  ingressChild.kill("SIGTERM");
  child.kill("SIGTERM");
  throw new Error(`Trusted ingress did not become ready:\n${output}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolveStop(); }, 2000);
    child.once("exit", () => { clearTimeout(timeout); resolveStop(); });
  });
}

async function stopServer(server) {
  await stopChild(server.ingressChild);
  await stopChild(server.child);
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
    assert.equal(initial.settings.pollIntervalSeconds, 5);
    assert.equal("healthCheckIntervalSeconds" in initial.settings, false);
    assert.equal(initial.settings.keepPollingWithoutViewers, false);
    assert.equal(initial.settings.viewerGracePeriodSeconds, 90);
    assert.deepEqual(initial.settings.summaryActorKinds, [
      "sequencer",
      "backup-sequencer",
      "replayer",
      "archiver",
      "logger",
      "bridge",
      "dispatcher",
      "node",
    ]);

    const saved = await json(server.baseUrl, "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topologyName: "Test Topology",
        backgroundColor: "#e8f2ed",
        pollIntervalSeconds: 1,
        keepPollingWithoutViewers: true,
        viewerGracePeriodSeconds: 5,
        auditRetentionDays: 90,
        summaryActorKinds: ["sequencer", "replayer", "application"],
        setupComplete: true,
      }),
    });
    assert.equal(saved.settings.topologyName, "Test Topology");
    assert.equal(saved.settings.pollIntervalSeconds, 1);
    assert.equal("healthCheckIntervalSeconds" in saved.settings, false);
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

    const orderBefore = await json(server.baseUrl, "/api/actors");
    const sequencersBefore = orderBefore.actors.filter((actor) => actor.kind === "sequencer");
    const reorderedIds = [
      discovered.actor.id,
      ...sequencersBefore.filter((actor) => actor.id !== discovered.actor.id).map((actor) => actor.id),
    ];
    const reordered = await json(server.baseUrl, "/api/actors/order", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sequencer", actorIds: reorderedIds }),
    });
    const reorderedSequencers = reordered.actors.filter((actor) => actor.kind === "sequencer");
    assert.deepEqual(reorderedSequencers.map((actor) => actor.id), reorderedIds);
    assert.deepEqual(reorderedSequencers.map((actor) => actor.sortOrder), reorderedIds.map((_, index) => index));
    assert.deepEqual(
      reordered.actors.filter((actor) => actor.kind === "replayer").map((actor) => actor.sortOrder),
      [0, 1, 2],
    );
    const invalidOrder = await fetch(`${server.baseUrl}/api/actors/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sequencer",
        actorIds: [discovered.actor.id, orderBefore.actors.find((actor) => actor.kind === "replayer").id],
      }),
    });
    assert.equal(invalidOrder.status, 400);
    assert.match((await invalidOrder.json()).error, /every current actor of that type/);

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

    actorServer.setActorStatusHasFields(false);
    const emptyActorStatus = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const emptyActorStatusActor = emptyActorStatus.actors.find((actor) => actor.id === discovered.actor.id);
    assert.equal(emptyActorStatusActor?.status, "online");
    assert.deepEqual(emptyActorStatusActor?.actorStatusFields, unparseableSessionRefresh.actor.actorStatusFields);
    actorServer.setActorStatusHasFields(true);

    actorServer.setActorStatusResult(false);
    const failedActorStatus = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(failedActorStatus.actors.find((actor) => actor.id === discovered.actor.id)?.status, "offline");
    assert.deepEqual(actorServer.requests.at(-1), { adminCommand: "SEQ actorStatus", params: "", shouldLog: false });

    actorServer.setActorStatusResult("invalid");
    const invalidActorStatus = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(invalidActorStatus.actors.find((actor) => actor.id === discovered.actor.id)?.status, "offline");
    assert.deepEqual(actorServer.requests.at(-1), { adminCommand: "SEQ actorStatus", params: "", shouldLog: false });

    actorServer.setActorStatusResult(true);
    const recoveredActorStatus = await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(recoveredActorStatus.actors.find((actor) => actor.id === discovered.actor.id)?.status, "online");
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
      headers: {
        "Content-Type": "application/json",
        "X-Coral-Peer-IP": "198.51.100.25",
        "X-Forwarded-For": "203.0.113.77",
        "X-Real-IP": "192.0.2.18",
      },
      body: JSON.stringify({ action: "status", params: "" }),
    });
    assert.deepEqual(actorServer.requests.slice(manualStatusStart, manualStatusStart + 3), [
      { adminCommand: "SEQ status", params: "" },
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.notEqual(actorServer.requestConnections[manualStatusStart], persistentConnection);
    assert.deepEqual(
      actorServer.requestConnections.slice(manualStatusStart + 1, manualStatusStart + 3),
      [persistentConnection, persistentConnection],
    );
    const successAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&query=status&outcome=success&limit=20`);
    assert.equal(successAudit.entries[0].outcome, "success");
    assert.equal(successAudit.entries[0].sourceIp, "127.0.0.1");
    assert.equal("success" in successAudit.entries[0], false);
    const multiTermAudit = await json(server.baseUrl, `/api/audit?query=${encodeURIComponent("SEQ 127.0.0.1")}&limit=20`);
    assert.equal(multiTermAudit.entries.length, 1);
    assert.equal(multiTermAudit.entries[0].id, successAudit.entries[0].id);
    const quotedPhraseAudit = await json(server.baseUrl, `/api/audit?query=${encodeURIComponent("\"SEQ 127.0.0.1\"")}&limit=20`);
    assert.equal(quotedPhraseAudit.entries.length, 0);

    const manualHealthCheckStart = actorServer.requests.length;
    const manualHealthCheck = await json(server.baseUrl, `/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "healthCheck", params: "" }),
    });
    assert.equal(manualHealthCheck.result, true);
    assert.deepEqual(actorServer.requests.slice(manualHealthCheckStart, manualHealthCheckStart + 3), [
      { adminCommand: "SEQ healthCheck", params: "" },
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.notEqual(actorServer.requestConnections[manualHealthCheckStart], persistentConnection);

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
    await json(server.baseUrl, "/api/actors/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(actorServer.requests.length, requestsDuringSlowAction);
    const slowActionReply = await slowAction;
    assert.equal(slowActionReply.result, true);
    assert.deepEqual(actorServer.requests.slice(slowActionStart, slowActionStart + 3), [
      { adminCommand: "SEQ slowAction", params: "" },
      { adminCommand: "SEQ actorStatus", params: "", shouldLog: false },
      { adminCommand: "list", params: "SEQ", shouldLog: false },
    ]);
    assert.notEqual(actorServer.requestConnections[slowActionStart], persistentConnection);
    assert.deepEqual(
      actorServer.requestConnections.slice(slowActionStart + 1, slowActionStart + 3),
      [persistentConnection, persistentConnection],
    );

    const failedResponse = await fetch(`${server.baseUrl}/api/actors/${discovered.actor.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rollSessionAuto", params: "" }),
    });
    const failedPayload = await failedResponse.json();
    assert.equal(failedResponse.ok, false);
    assert.match(failedPayload.error, /admin action failed/i);
    const failureAudit = await json(server.baseUrl, `/api/audit?actorId=${discovered.actor.id}&query=rollSessionAuto&outcome=failure&limit=20`);
    assert.equal(failureAudit.entries.length, 1);
    assert.equal(failureAudit.entries[0].action, "SEQ rollSessionAuto");
    assert.equal(failureAudit.entries[0].outcome, "failure");
    assert.match(failureAudit.entries[0].output, /safeguard/);

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
    const auditDelete = await fetch(`${server.baseUrl}/api/audit`, { method: "DELETE" });
    assert.equal(auditDelete.status, 405);

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

    const duplicateEndpointResponse = await fetch(`${server.baseUrl}/api/actors/${discovered.actor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: actorPayload.actors[0].host, port: actorPayload.actors[0].port }),
    });
    assert.equal(duplicateEndpointResponse.status, 409);
    assert.match((await duplicateEndpointResponse.json()).error, /already exists/i);

    const editedEndpoint = await json(server.baseUrl, `/api/actors/${discovered.actor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "localhost", port: actorServer.port }),
    });
    assert.equal(editedEndpoint.actor.host, "localhost");
    assert.equal(editedEndpoint.actor.port, actorServer.port);
    assert.equal(editedEndpoint.actor.status, "offline");

    await stopServer(server);
    server = await startServer(databasePath, port);
    const persistedSettings = await json(server.baseUrl, "/api/settings");
    const persistedAudit = await json(server.baseUrl, "/api/audit?actorId=demo-seq-01&limit=20");
    const persistedActors = await json(server.baseUrl, "/api/actors");
    assert.equal(persistedSettings.settings.topologyName, "Test Topology");
    assert.equal(persistedSettings.settings.pollIntervalSeconds, 1);
    assert.equal("healthCheckIntervalSeconds" in persistedSettings.settings, false);
    assert.equal(persistedSettings.settings.keepPollingWithoutViewers, true);
    assert.equal(persistedSettings.settings.viewerGracePeriodSeconds, 5);
    assert.deepEqual(persistedSettings.settings.summaryActorKinds, ["sequencer", "replayer", "application"]);
    assert.equal(persistedAudit.entries.length, 1);
    const persistedActor = persistedActors.actors.find((actor) => actor.id === discovered.actor.id);
    assert.equal(persistedActor.host, "localhost");
    assert.equal(persistedActor.port, actorServer.port);
    assert.equal(
      persistedActors.actors.filter((actor) => actor.kind === "sequencer").at(0).id,
      discovered.actor.id,
    );
  } finally {
    if (server) await stopServer(server);
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
      "0010_polite_ultimates",
      "0011_rare_captain_america",
      "0012_milky_kingpin",
      "0013_concerned_gamma_corps",
      "0014_chilly_cammi",
    ];
    for (const [index, name] of migrationNames.entries()) {
      if (index === 5) {
        const insertActor = database.prepare(
          "INSERT INTO actors (id, name, kind, status, host, port, account, class_name, commands) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const [id, status, kind] of [
          ["a", "online", "node"],
          ["b", "standby", "logger"],
          ["c", "warning", "node"],
          ["d", "offline", "logger"],
        ]) {
          insertActor.run(id, id, kind, status, id, 30001, id, "Node", "[]");
        }
        database.prepare(
          "INSERT INTO command_audit (actor_id, actor_name, actor_endpoint, command, output, outcome, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run("a", "a", "a:30001", "status", "ok", "failed", 1);
      }
      if (index === 10) {
        database.prepare(`
          INSERT INTO topology_settings
            (id, topology_name, background_color, poll_interval_seconds, health_check_interval_seconds, audit_retention_days, setup_complete)
          VALUES (1, 'Migrated Topology', '#f4eee7', 30, 7, 90, 1)
        `).run();
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
      database.prepare("SELECT outcome, source_ip AS sourceIp FROM command_audit").get(),
      { outcome: "failure", sourceIp: "N/A" },
    );
    assert.deepEqual(
      database.prepare("SELECT outbound_sequence AS outboundSequence, accounts, clock_tick_interval AS clockTickInterval, actor_status_fields AS actorStatusFields, status_responded_at AS actorStatusRespondedAt, operational_state AS operationalState FROM actors WHERE id = 'a'").get(),
      { outboundSequence: "Not reported", accounts: "Not reported", clockTickInterval: "Not reported", actorStatusFields: "[]", actorStatusRespondedAt: null, operationalState: "inactive" },
    );
    assert.deepEqual(
      database.prepare("SELECT id, kind, sort_order AS sortOrder FROM actors ORDER BY id").all(),
      [
        { id: "a", kind: "node", sortOrder: 0 },
        { id: "b", kind: "logger", sortOrder: 0 },
        { id: "c", kind: "node", sortOrder: 1 },
        { id: "d", kind: "logger", sortOrder: 1 },
      ],
    );
    assert.equal(database.pragma("index_list('actors')").some((index) => index.name === "actors_kind_order_idx"), true);
    assert.deepEqual(
      database.prepare("SELECT poll_interval_seconds AS pollIntervalSeconds FROM topology_settings WHERE id = 1").get(),
      { pollIntervalSeconds: 7 },
    );
    assert.equal(database.prepare("PRAGMA table_info(topology_settings)").all().some((column) => column.name === "health_check_interval_seconds"), false);
    assert.deepEqual(database.pragma("foreign_key_check"), []);
  } finally {
    database.close();
  }
});

test("deployment and UI conventions stay explicit", async () => {
  const [page, actorList, actorDetail, auditView, auditRoute, actorUi, consoleChrome, styles, layout, viewerPresence, guide, packageMetadata, packageLock, setVersion, compose, dockerfile, dockerStart, dockerStop, dockerBackup, gitMergeToMain, devCompose, devDockerfile, devStart, dockerRelease, nextConfig, trustedIngress, httpHelpers] = await Promise.all([
    readFile(join(projectRoot, "app/page.tsx"), "utf8"),
    readFile(join(projectRoot, "app/actors/actor-list.tsx"), "utf8"),
    readFile(join(projectRoot, "app/actor/[id]/actor-detail.tsx"), "utf8"),
    readFile(join(projectRoot, "app/audit/audit-view.tsx"), "utf8"),
    readFile(join(projectRoot, "app/api/audit/route.ts"), "utf8"),
    readFile(join(projectRoot, "app/actor-ui.tsx"), "utf8"),
    readFile(join(projectRoot, "app/console-chrome.tsx"), "utf8"),
    readFile(join(projectRoot, "app/globals.css"), "utf8"),
    readFile(join(projectRoot, "app/layout.tsx"), "utf8"),
    readFile(join(projectRoot, "app/viewer-presence.tsx"), "utf8"),
    readFile(join(projectRoot, "AGENTS.md"), "utf8"),
    readFile(join(projectRoot, "package.json"), "utf8"),
    readFile(join(projectRoot, "package-lock.json"), "utf8"),
    readFile(join(projectRoot, "scripts/set-version.mjs"), "utf8"),
    readFile(join(projectRoot, "docker-compose.yml"), "utf8"),
    readFile(join(projectRoot, "Dockerfile"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-start.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-stop.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-backup.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/git-merge-to-main.sh"), "utf8"),
    readFile(join(projectRoot, "docker-compose.dev.yml"), "utf8"),
    readFile(join(projectRoot, "Dockerfile.dev"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-dev-start.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-release.sh"), "utf8"),
    readFile(join(projectRoot, "next.config.ts"), "utf8"),
    readFile(join(projectRoot, "scripts/trusted-ingress.mjs"), "utf8"),
    readFile(join(projectRoot, "lib/http.ts"), "utf8"),
  ]);
  assert.match(page, /target="_blank"/);
  assert.match(page, /href="\/audit" target="_blank" rel="noopener noreferrer">Audit/);
  assert.match(page, /\/api\/actors\/refresh/);
  assert.doesNotMatch(page, /\/api\/actors\/health/);
  assert.match(page, /Actor polling interval \(seconds\)/);
  assert.doesNotMatch(page, /Health check \(seconds\)/);
  assert.match(page, /Keep polling actors when nobody is viewing CoralConsole/);
  assert.match(page, /disabled=\{settingsDraft\.keepPollingWithoutViewers\}/);
  assert.match(page, /\[\s*"all",\s*"online",\s*"offline",\s*"closed",\s*"rewinding",\s*"active",\s*"inactive",\s*"disconnected",?\s*\]/);
  assert.match(page, /operationalStateForDisplay\(actor\.status, actor\.operationalState\) === filter/);
  assert.match(page, /aria-pressed=\{filter === value\}/);
  assert.match(page, /className="section-heading topology-heading"/);
  assert.match(page, /className="button button-ghost" type="button" onClick=\{\(\) => setAddOpen\(true\)\}>＋ Add Actor<\/button>/);
  assert.match(page, /href="\/actors"[\s\S]*target="_blank"[\s\S]*List Actors/);
  assert.match(page, /\{refreshing \? "Refreshing…" : "Refresh Now"\}/);
  assert.match(page, /online in the console/);
  assert.match(page, /connected to the sequencer/);
  assert.match(page, /onlineCount - disconnectedCount - operationalStateCounts\.closed/);
  assert.match(page, /count === 1 \? "Actor" : "Actors"/);
  assert.match(page, /<small>ONLINE<\/small>/);
  assert.match(page, /<small>OFFLINE<\/small>/);
  assert.match(page, /PULSE_OPERATIONAL_STATES\.map/);
  assert.match(page, /<small>Total actors<\/small>/);
  assert.match(page, /<strong>\{actors\.length\}<\/strong>/);
  assert.match(page, /Added to CoralConsole/);
  assert.match(page, /className="pulse-total"[\s\S]*type="button"[\s\S]*aria-pressed=\{filter === "all"\}[\s\S]*onClick=\{\(\) => setFilter\("all"\)\}/);
  assert.doesNotMatch(styles, /\.pulse-total:hover span \{[^}]*text-decoration/);
  assert.doesNotMatch(page, /id="system-pulse"/);
  assert.doesNotMatch(page, /href="#system-pulse"/);
  assert.match(page, /className="health-orbit" type="button" aria-label="Show all actors"/);
  assert.match(page, /onClick=\{\(\) => setFilter\("all"\)\}/);
  assert.match(page, /const pulseConnectivityFilter: ActorFilter = !actors\.length \? "all" : offlineCount \? "offline" : "online"/);
  assert.match(page, /setFilter\(pulseConnectivityFilter\)/);
  assert.match(page, /setFilter\("disconnected"\)/);
  assert.match(page, /onClick=\{\(\) => setFilter\(state\)\}/);
  assert.match(page, /<h2>Actor Map<\/h2>/);
  assert.match(page, /visibleSummaryKinds\.length === 8 \? 4 : Math\.min\(3, visibleSummaryKinds\.length\)/);
  assert.match(page, /ACTOR_COUNTS_VISIBILITY_KEY = "coral-console-counts"/);
  assert.match(page, /\{actorCountsVisible \? "Hide counts" : "Show counts"\}/);
  assert.match(page, /showActorCounts && <div[\s\S]*id="actor-counts"/);
  assert.match(page, /settings\.summaryActorKinds\.includes\("dispatcher"\) && "Dispatcher"/);
  assert.match(page, /settings\.summaryActorKinds\.includes\("multimqapp"\) && "MultiMqApp"/);
  assert.match(page, /settings\.summaryActorKinds\.includes\("application"\) && "Applications"/);
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
  assert.match(styles, /\.group-cards \{[^}]*grid-auto-flow: row[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.actor-card\.actor-card-offline,\s*\.actor-detail-panel\.actor-detail-offline \.inspector-head/);
  assert.match(styles, /background-image: repeating-linear-gradient/);
  assert.match(styles, /\.actor-detail-panel\.actor-detail-offline \.inspector-head \{[^}]*background-color: var\(--panel\)/);
  assert.match(styles, /\.actor-state-badge \{[^}]*font-weight: 800/);
  assert.match(styles, /\.actor-card \.actor-state-badge \{[^}]*font-size: 8px/);
  assert.match(styles, /\.actor-state-badge, \.status-badge \{[^}]*font-size: 9px/);
  assert.match(styles, /\.actor-card-sequence \{[^}]*font-size: 9px/);
  assert.match(styles, /\.actor-heading small \{[^}]*font-size: 9px/);
  assert.match(styles, /\.inspector-head p \{[^}]*font-size: 10px/);
  assert.match(page, /function ActorGroupCountLink\(\{ count, label \}: \{ count: number; label: string \}\)/);
  assert.match(page, /className="group-count-link"[\s\S]*href="\/actors"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/);
  assert.match(page, /<ActorGroupCountLink count=\{primarySequencers\.length\} label="Primary Sequencer" \/>/);
  assert.match(page, /<ActorGroupCountLink count=\{backupSequencers\.length\} label="Backup Sequencer" \/>/);
  assert.match(page, /<ActorGroupCountLink count=\{grouped\.length\} label=\{group\.eyebrow\} \/>/);
  assert.match(styles, /\.group-count-link \{[^}]*font-size: 11px[^}]*transition:/);
  assert.match(styles, /\.group-count-link:hover \{[^}]*transform: translateY\(-1px\)/);
  assert.match(styles, /\.topology-heading \{[^}]*display: grid[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.topology-heading-actions \{[^}]*grid-column: 2[^}]*grid-row: 1[^}]*justify-self: end/);
  assert.match(styles, /\.topology-heading-actions \.button \{[^}]*font-weight: 500/);
  assert.match(styles, /\.topology-heading \.filters \{[^}]*grid-column: 1 \/ -1[^}]*grid-row: 2/);
  assert.match(styles, /\.filters \{[^}]*overflow-x: auto/);
  assert.doesNotMatch(styles, /\.pulse-panel \{[^}]*scroll-margin-top/);
  assert.match(styles, /\.pulse-count \{[^}]*cursor: pointer/);
  assert.match(styles, /\.pulse-count \{[^}]*justify-items: center[^}]*text-align: center/);
  assert.match(styles, /\.pulse-footer \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.pulse-total strong \{[^}]*font-size: 17px/);
  assert.match(styles, /\.pulse-session \{[^}]*border-left: 1px solid/);
  assert.match(styles, /\.pulse-session strong \{[^}]*font-size: 14px/);
  assert.match(styles, /\.actor-groups \{[^}]*grid-template-columns: 1fr/);
  assert.match(styles, /\.system-overview \{[^}]*grid-template-columns: 1fr/);
  assert.doesNotMatch(styles, /\.sequencer-groups/);
  assert.doesNotMatch(styles, /\.actor-groups \{[^}]*repeat\(2/);
  assert.doesNotMatch(page, /className="sequencer-groups"/);
  assert.match(page, /id: "replayer", kinds: \["replayer"\][\s\S]*id: "persistence", kinds: \["archiver", "logger"\][\s\S]*id: "transport"[\s\S]*kinds: \["bridge", "dispatcher", "multimqapp"\][\s\S]*id: "customer", kinds: \["node", "application"\]/);
  assert.match(page, /function actorsInPanelOrder\(source: Actor\[\], kinds: ActorKind\[\]\)/);
  assert.match(page, /kindOrder\.get\(left\.kind\)! - kindOrder\.get\(right\.kind\)!/);
  assert.match(page, /left\.sortOrder \?\? Number\.MAX_SAFE_INTEGER/);
  assert.match(page, /const grouped = actorsInPanelOrder\(visibleActors, group\.kinds\)/);
  assert.doesNotMatch(page, /Shared topology · Persisted in SQLite/);
  assert.match(consoleChrome, /CoralConsole<span className="brand-version">v\{packageMetadata\.version\}<\/span>/);
  assert.match(consoleChrome, /CoralConsole v\{packageMetadata\.version\}/);
  assert.match(consoleChrome, /Shared topology · Persisted in SQLite/);
  assert.match(actorList, /<tr><th>Name<\/th><th>Class<\/th><th>REST IP<\/th><th>PORT<\/th><th>Online\?<\/th><th>Edit<\/th><th>Remove<\/th><\/tr>/);
  for (const heading of ["Name", "Class", "REST IP", "PORT", "Online?", "Edit", "Remove"]) {
    assert.match(actorList, new RegExp(`<th>${heading.replace("?", "\\?")}<\\/th>`));
  }
  assert.doesNotMatch(actorList, /<th>Type<\/th>|data-label="Type"/);
  assert.match(actorList, /ACTOR_KINDS[\s\S]*actors\.filter\(\(actor\) => actor\.kind === kind\)/);
  assert.match(actorList, /<h2 id=\{headingId\}>\{groupLabel\(kind\)\}<\/h2>/);
  assert.match(actorList, /draggable=\{!editingId && !orderingKind\}/);
  assert.match(actorList, /<td data-label="Name">/);
  assert.match(actorList, /<td data-label="Online\?">/);
  assert.match(actorList, /const actorIds = actorsRef\.current\.filter\(\(actor\) => actor\.kind === kind\)/);
  assert.match(actorList, /JSON\.stringify\(\{ kind, actorIds \}\)/);
  assert.match(actorList, /showFeedback\(kind, `\$\{groupLabel\(kind\)\} order saved\.`, "notice", 7000\)/);
  assert.match(actorList, /CoralConsole is checking the new address\.`, "notice", 7000\)/);
  assert.match(actorList, /was removed from CoralConsole\.`, "notice", 7000\)/);
  assert.match(actorList, /was added to CoralConsole\.`, "notice", 7000\)/);
  assert.match(actorList, /disabled=\{Boolean\(editingId\) \|\| Boolean\(removingId\) \|\| actor\.demo\}/);
  assert.match(actorList, /\/api\/actors\/order/);
  assert.match(actorList, /method: "PATCH"/);
  assert.match(actorList, /window\.confirm/);
  assert.doesNotMatch(actorList, /Back to topology|Return to topology/);
  assert.match(styles, /\.actor-list-table-wrap \{/);
  assert.match(styles, /\.actor-list-table thead \{[^}]*background:/);
  assert.match(styles, /\.actor-list-table th \{[^}]*font-size: 13px/);
  assert.match(styles, /\.actor-list-title > p:last-child \{[^}]*max-width: none/);
  assert.match(actorList, /const GroupIcon = ACTOR_META\[kind\]\.icon/);
  assert.match(actorList, /className=\{`actor-list-group actor-\$\{kind\}`\}/);
  assert.match(actorList, /<span className="actor-avatar actor-list-group-icon"[^>]*><GroupIcon \/><\/span>/);
  assert.match(actorList, /className="actor-list-group-count"/);
  assert.match(actorList, /<col className="actor-list-col-host" \/>/);
  assert.match(actorList, /<col className="actor-list-col-port" \/>/);
  assert.match(actorList, /<col className="actor-list-col-edit" \/>/);
  assert.match(styles, /\.actor-list-group-heading \{[^}]*grid-template-columns: minmax\(250px, auto\) minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.actor-list-group-heading h2 \{[^}]*font-size: 17px[^}]*line-height: 1\.25/);
  assert.match(styles, /\.actor-list-col-host \{[^}]*width: 19ch/);
  assert.match(styles, /\.actor-list-col-port \{[^}]*width: 8ch/);
  assert.match(styles, /\.actor-list-col-edit \{[^}]*width: 142px/);
  assert.match(styles, /\.actor-list-feedback \{[^}]*height: 42px/);
  assert.match(actorList, /className="actor-list-add-button"/);
  assert.match(actorList, /className="actor-list-global-add-button"/);
  assert.match(actorList, /onClick=\{\(\) => openAddActor\(\)\}/);
  assert.match(actorList, /<section className=\{`add-modal\$\{addKind \? ` actor-\$\{addKind\}` : ""\}`\}/);
  assert.match(styles, /\.actor-list-notice \{[^}]*var\(--actor-soft\)[^}]*var\(--actor-color\)/);
  assert.match(styles, /\.actor-list-add-button \{[^}]*background: var\(--actor-soft\)/);
  assert.match(styles, /\.actor-list-global-add-button \{[^}]*background: transparent[^}]*border: 1px solid var\(--line\)/);
  assert.match(styles, /\.actor-list-edit-button, \.actor-list-edit-actions button \{[^}]*font-size: 10px/);
  assert.match(styles, /\.actor-list-table th:first-child, \.actor-list-table td:first-child \{[^}]*padding-left: 30px/);
  assert.match(styles, /\.actor-list-table \{[^}]*min-width: 0/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*\.actor-list-table tbody tr \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(actorDetail, /\/actions/);
  assert.match(actorDetail, /\/api\/actors\/refresh/);
  assert.doesNotMatch(actorDetail, /\/api\/actors\/health/);
  assert.match(actorDetail, /Recent activity/);
  assert.match(actorDetail, /href="\/audit" target="_blank" rel="noopener noreferrer">Audit/);
  assert.match(actorDetail, /href=\{`\/audit\?actorId=\$\{encodeURIComponent\(actor\.id\)\}`\} target="_blank" rel="noopener noreferrer">Open Actor Full Audit/);
  assert.match(actorDetail, /auditOutcomeLabel\(entry\.outcome\)/);
  assert.match(actorDetail, /<ConsoleBrand href="\/" ariaLabel="CoralConsole topology" subtitle="Actor detail" \/>/);
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
  assert.match(actorUi, /failure: "Failure"/);
  assert.match(styles, /\.audit-outcome\.failure \{/);
  assert.doesNotMatch(styles, /\.audit-outcome\.failed \{/);
  assert.doesNotMatch(auditView, /Back to topology|Clear audit history|method: "DELETE"/);
  assert.match(auditView, /Protected history/);
  assert.match(auditView, /Audit records cannot be manually cleared/);
  assert.match(auditView, /Clear Search/);
  assert.match(auditView, /function clearSearch\(\) \{[\s\S]*setQuery\(""\)[\s\S]*setAppliedQuery\(""\)[\s\S]*\}/);
  assert.doesNotMatch(auditView, /function clearSearch\(\) \{[\s\S]*setOutcome\("all"\)/);
  assert.match(auditView, /\{value === "all" \? "All" : auditOutcomeLabel\(value\)\}/);
  assert.match(auditView, /<th>Source IP<\/th>/);
  assert.match(auditView, /entry\.sourceIp \|\| "N\/A"/);
  assert.match(auditView, /auditOutcomeLabel\(entry\.outcome\)/);
  assert.match(auditView, /<h1>Admin Action Audit<\/h1>/);
  assert.match(auditView, /<ConsoleBrand href="\/" ariaLabel="CoralConsole topology" subtitle="The Ops Console for CoralSequencer" \/>/);
  assert.match(auditView, /className="audit-time"/);
  assert.match(auditView, /Updated by search and outcome filters/);
  assert.doesNotMatch(auditView, /setInterval/);
  assert.doesNotMatch(auditRoute, /export function DELETE|clearAudit/);
  assert.match(styles, /\.audit-integrity-note \{/);
  assert.match(styles, /\.audit-table-heading \{/);
  assert.match(styles, /\.audit-table th:nth-child\(6\), \.audit-table td:nth-child\(6\) \{ text-align: center; \}/);
  assert.match(styles, /\.audit-time \{ display: grid;/);
  assert.match(styles, /\.audit-table \{[^}]*min-width: 760px/);
  assert.match(styles, /@media \(max-width: 800px\) \{[\s\S]*\.audit-table tbody tr \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  for (const state of ["active", "inactive", "closed", "rewinding", "disconnected", "unknown"]) {
    assert.match(styles, new RegExp(`\\.actor-state-badge\\.state-${state} \\{`));
  }
  assert.match(layout, /ViewerPresence/);
  assert.match(layout, /<ConsoleFooter \/>/);
  const applicationVersion = JSON.parse(packageMetadata).version;
  assert.match(applicationVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(packageLock).version, applicationVersion);
  assert.equal(JSON.parse(packageLock).packages[""].version, applicationVersion);
  assert.match(setVersion, /\/\^\\d\+\\\.\\d\+\\\.\\d\+\$\//);
  assert.match(setVersion, /packageMetadata\.version = version/);
  assert.match(setVersion, /packageLock\.packages\[""\]\.version = version/);
  assert.match(viewerPresence, /\/api\/presence/);
  assert.match(viewerPresence, /crypto\.randomUUID/);
  assert.match(guide, /Keep this file current/);
  assert.match(compose, /coralconsole-data:\/data/);
  assert.match(compose, /coralconsole-ingress:/);
  assert.match(compose, /network_mode: host/);
  assert.match(compose, /127\.0\.0\.1:\$\{CORAL_INTERNAL_PORT:-39000\}:3000/);
  assert.match(compose, /CORAL_TRUSTED_INGRESS: "true"/);
  assert.match(trustedIngress, /request\.socket\.remoteAddress/);
  assert.match(trustedIngress, /FORWARDED_HEADERS/);
  assert.match(trustedIngress, /TRUSTED_PEER_HEADER/);
  assert.match(httpHelpers, /process\.env\.CORAL_TRUSTED_INGRESS === "true"/);
  assert.match(httpHelpers, /if \(process\.env\.CORAL_TRUST_PROXY !== "true"\) return "N\/A"/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /node:22-trixie-slim/);
  assert.match(dockerfile, /python3 make g\+\+/);
  assert.match(dockerfile, /node_modules\/drizzle-orm/);
  assert.match(dockerStart, /docker compose up -d --no-build --wait coralconsole coralconsole-ingress/);
  assert.match(dockerStop, /docker compose stop/);
  assert.match(dockerStop, /coralconsole-ingress coralconsole/);
  assert.doesNotMatch(`${dockerStart}\n${dockerStop}`, /down\s+-v|volume\s+rm|prune/);
  assert.match(devCompose, /WATCHPACK_POLLING: "true"/);
  assert.match(devCompose, /command: npm run dev -- --webpack/);
  assert.match(devCompose, /- \.:\/app/);
  assert.match(devCompose, /- coralconsole-data:\/data/);
  assert.match(devCompose, /coralconsole-dev-node-modules:\/app\/node_modules/);
  assert.match(devCompose, /coralconsole-dev-next:\/app\/\.next/);
  assert.match(devDockerfile, /node:22-trixie-slim/);
  assert.match(devDockerfile, /npm ci/);
  assert.match(devDockerfile, /USER coral/);
  assert.match(devStart, /up -d --no-build --wait coralconsole coralconsole-ingress/);
  assert.doesNotMatch(devStart, /down\s+-v|volume\s+rm|prune/);
  assert.match(dockerRelease, /docker compose build coralconsole/);
  assert.match(dockerRelease, /docker compose up -d --no-build --wait coralconsole coralconsole-ingress/);
  assert.doesNotMatch(dockerRelease, /down\s+-v|volume\s+rm|prune/);
  assert.match(nextConfig, /process\.env\.NODE_ENV === "development"/);
  assert.match(nextConfig, /'unsafe-eval'/);
  assert.match(nextConfig, /: "'self' 'unsafe-inline'";/);
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
