import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import {
  createClientAllowlist,
  createTrustedIngress,
} from "../scripts/trusted-ingress.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

function listen(server, host = "127.0.0.1") {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port."));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

function waitForSocketClose(port, request) {
  return new Promise((resolveClose, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Socket was not closed by the ingress."));
    }, 2_000);
    socket.once("connect", () => socket.write(request));
    socket.once("close", () => {
      clearTimeout(timeout);
      resolveClose();
    });
    socket.once("error", (error) => {
      if (error.code !== "ECONNRESET") {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

test("client allowlists match IPv4, IPv6, exact addresses, and CIDR ranges", () => {
  const open = createClientAllowlist("");
  assert.equal(open.allows("not-an-address"), true);

  const allowlist = createClientAllowlist(
    "192.0.2.44,10.20.0.0/16,2001:db8:abcd::/48,::1",
  );
  assert.equal(allowlist.allows("192.0.2.44"), true);
  assert.equal(allowlist.allows("192.0.2.45"), false);
  assert.equal(allowlist.allows("10.20.99.12"), true);
  assert.equal(allowlist.allows("10.21.0.1"), false);
  assert.equal(allowlist.allows("2001:db8:abcd:5::7"), true);
  assert.equal(allowlist.allows("2001:db8:abce::7"), false);
  assert.equal(allowlist.allows("::1"), true);
  assert.equal(allowlist.allows("::2"), false);
  assert.equal(allowlist.allows("::ffff:192.0.2.44"), true);
  assert.equal(allowlist.allows(undefined), false);
});

test("malformed client allowlists fail with clear configuration errors", () => {
  assert.throws(() => createClientAllowlist("10.0.0.1,"), /entry 2 is empty/);
  assert.throws(() => createClientAllowlist("10.0.0.0/33"), /prefix from 0 through 32/);
  assert.throws(() => createClientAllowlist("2001:db8::/129"), /prefix from 0 through 128/);
  assert.throws(() => createClientAllowlist("example.internal"), /not a valid IP address or CIDR range/);
});

test("trusted ingress accepts allowed HTTP peers and rejects disallowed requests and upgrades", async () => {
  let upstreamRequests = 0;
  const upstream = http.createServer((_request, response) => {
    upstreamRequests += 1;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("upstream response");
  });
  const upstreamPort = await listen(upstream);
  const allowedIngress = createTrustedIngress({
    upstreamPort,
    allowedClients: "127.0.0.0/8",
  });
  const allowedPort = await listen(allowedIngress);
  const deniedIngress = createTrustedIngress({
    upstreamPort,
    allowedClients: "10.0.0.0/8,2001:db8::/32",
  });
  const deniedPort = await listen(deniedIngress);

  try {
    const accepted = await fetch(`http://127.0.0.1:${allowedPort}/accepted`);
    assert.equal(accepted.status, 200);
    assert.equal(await accepted.text(), "upstream response");
    assert.equal(upstreamRequests, 1);

    const rejected = await fetch(`http://127.0.0.1:${deniedPort}/rejected`);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await rejected.text(), "Forbidden.\n");
    assert.equal(upstreamRequests, 1);

    await waitForSocketClose(
      deniedPort,
      "GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    assert.equal(upstreamRequests, 1);
  } finally {
    await close(allowedIngress);
    await close(deniedIngress);
    await close(upstream);
  }
});

test("trusted ingress process fails fast on a malformed configured allowlist", async () => {
  const child = spawn(process.execPath, [resolve(projectRoot, "scripts/trusted-ingress.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CORAL_INGRESS_BIND_ADDRESS: "127.0.0.1",
      CORAL_INGRESS_PORT: "3000",
      CORAL_UPSTREAM_PORT: "39000",
      CORAL_ALLOWED_CLIENTS: "192.168.1.0/99",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
  assert.equal(exitCode, 1);
  assert.match(output, /CORAL_ALLOWED_CLIENTS entry "192\.168\.1\.0\/99" must use a CIDR prefix from 0 through 32/);
});
