import http from "node:http";
import net from "node:net";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const TRUSTED_PEER_HEADER = "x-coral-peer-ip";

const FORWARDED_HEADERS = new Set([
  "forwarded",
  "x-real-ip",
  TRUSTED_PEER_HEADER,
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function numericPort(value, fallback, label) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return port;
}

export function normalizePeerIp(value) {
  const candidate = String(value || "").trim().replace(/^::ffff:/, "");
  return net.isIP(candidate) ? candidate : "N/A";
}

export function createClientAllowlist(value = "") {
  const configuredValue = String(value).trim();
  if (!configuredValue) {
    return {
      entries: [],
      allows: () => true,
    };
  }

  const entries = configuredValue.split(",").map((entry) => entry.trim());
  const blockList = new net.BlockList();

  entries.forEach((entry, index) => {
    if (!entry) {
      throw new Error(`CORAL_ALLOWED_CLIENTS entry ${index + 1} is empty.`);
    }

    const slashIndex = entry.indexOf("/");
    const address = slashIndex < 0 ? entry : entry.slice(0, slashIndex);
    const prefixValue = slashIndex < 0 ? undefined : entry.slice(slashIndex + 1);
    if (slashIndex >= 0 && (prefixValue === "" || entry.indexOf("/", slashIndex + 1) >= 0)) {
      throw new Error(`CORAL_ALLOWED_CLIENTS entry "${entry}" is not a valid IP address or CIDR range.`);
    }

    const version = net.isIP(address);
    if (!version) {
      throw new Error(`CORAL_ALLOWED_CLIENTS entry "${entry}" is not a valid IP address or CIDR range.`);
    }
    const family = version === 4 ? "ipv4" : "ipv6";

    if (prefixValue === undefined) {
      blockList.addAddress(address, family);
      return;
    }

    if (!/^\d+$/.test(prefixValue)) {
      throw new Error(`CORAL_ALLOWED_CLIENTS entry "${entry}" has an invalid CIDR prefix.`);
    }
    const prefix = Number(prefixValue);
    const maximumPrefix = version === 4 ? 32 : 128;
    if (prefix < 0 || prefix > maximumPrefix) {
      throw new Error(`CORAL_ALLOWED_CLIENTS entry "${entry}" must use a CIDR prefix from 0 through ${maximumPrefix}.`);
    }
    blockList.addSubnet(address, prefix, family);
  });

  return {
    entries,
    allows(peerAddress) {
      const peerIp = normalizePeerIp(peerAddress);
      const version = net.isIP(peerIp);
      if (!version) return false;
      return blockList.check(peerIp, version === 4 ? "ipv4" : "ipv6");
    },
  };
}

function connectionHeaderNames(headers) {
  const value = headers.connection;
  const values = Array.isArray(value) ? value : [value];
  return new Set(
    values
      .flatMap((entry) => String(entry || "").split(","))
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function copyEndToEndHeaders(headers, { preserveUpgrade = false } = {}) {
  const copied = {};
  const connectionHeaders = connectionHeaderNames(headers);
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (
      value === undefined
      || FORWARDED_HEADERS.has(lowerName)
      || lowerName.startsWith("x-forwarded-")
    ) continue;
    if (connectionHeaders.has(lowerName)) continue;
    if (HOP_BY_HOP_HEADERS.has(lowerName)) continue;
    copied[lowerName] = value;
  }
  if (preserveUpgrade && headers.upgrade) {
    copied.connection = "Upgrade";
    copied.upgrade = headers.upgrade;
  }
  return copied;
}

export function trustedRequestHeaders(headers, peerIp, { preserveUpgrade = false } = {}) {
  const copied = copyEndToEndHeaders(headers, { preserveUpgrade });
  const observedPeer = normalizePeerIp(peerIp);
  const originalHost = Array.isArray(headers.host) ? headers.host[0] : headers.host;

  if (originalHost) {
    copied.host = originalHost;
    copied["x-forwarded-host"] = originalHost;
  }
  copied["x-forwarded-for"] = observedPeer;
  copied["x-forwarded-proto"] = "http";
  copied["x-real-ip"] = observedPeer;
  copied[TRUSTED_PEER_HEADER] = observedPeer;
  return copied;
}

function responseHeaders(headers) {
  return copyEndToEndHeaders(headers);
}

function writeUpgradeRequest(socket, request, headers) {
  socket.write(`${request.method || "GET"} ${request.url || "/"} HTTP/${request.httpVersion}\r\n`);
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) socket.write(`${name}: ${item}\r\n`);
    } else if (value !== undefined) {
      socket.write(`${name}: ${value}\r\n`);
    }
  }
  socket.write("\r\n");
}

export function createTrustedIngress({
  upstreamHost = "127.0.0.1",
  upstreamPort,
  allowedClients = "",
} = {}) {
  const resolvedUpstreamPort = numericPort(upstreamPort, 39_000, "CORAL_UPSTREAM_PORT");
  const clientAllowlist = createClientAllowlist(allowedClients);

  const server = http.createServer((clientRequest, clientResponse) => {
    if (!clientAllowlist.allows(clientRequest.socket.remoteAddress)) {
      const body = "Forbidden.\n";
      clientRequest.resume();
      clientResponse.writeHead(403, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        Connection: "close",
      });
      clientResponse.end(body);
      return;
    }

    const headers = trustedRequestHeaders(clientRequest.headers, clientRequest.socket.remoteAddress);
    const upstreamRequest = http.request({
      host: upstreamHost,
      port: resolvedUpstreamPort,
      method: clientRequest.method,
      path: clientRequest.url,
      headers,
    }, (upstreamResponse) => {
      clientResponse.writeHead(
        upstreamResponse.statusCode || 502,
        upstreamResponse.statusMessage,
        responseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.pipe(clientResponse);
    });

    upstreamRequest.on("error", () => {
      if (!clientResponse.headersSent) {
        clientResponse.writeHead(502, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
      }
      clientResponse.end("CoralConsole is temporarily unavailable.");
    });
    clientRequest.on("aborted", () => upstreamRequest.destroy());
    clientRequest.pipe(upstreamRequest);
  });

  server.on("upgrade", (request, clientSocket, head) => {
    if (!clientAllowlist.allows(request.socket.remoteAddress)) {
      clientSocket.destroy();
      return;
    }

    const headers = trustedRequestHeaders(request.headers, request.socket.remoteAddress, { preserveUpgrade: true });
    const upstreamSocket = net.connect(resolvedUpstreamPort, upstreamHost);
    upstreamSocket.once("connect", () => {
      writeUpgradeRequest(upstreamSocket, request, headers);
      if (head.length) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    });
    upstreamSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstreamSocket.destroy());
  });

  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return server;
}

async function start() {
  const bindAddress = process.env.CORAL_INGRESS_BIND_ADDRESS?.trim() || "0.0.0.0";
  const port = numericPort(process.env.CORAL_INGRESS_PORT, 3_000, "CORAL_INGRESS_PORT");
  const upstreamHost = process.env.CORAL_UPSTREAM_HOST?.trim() || "127.0.0.1";
  const upstreamPort = numericPort(process.env.CORAL_UPSTREAM_PORT, 39_000, "CORAL_UPSTREAM_PORT");
  const allowedClients = process.env.CORAL_ALLOWED_CLIENTS || "";
  const parsedAllowlist = createClientAllowlist(allowedClients);
  const server = createTrustedIngress({ upstreamHost, upstreamPort, allowedClients });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindAddress, resolve);
  });
  console.log(`CoralConsole trusted ingress listening on ${bindAddress}:${port}.`);
  if (parsedAllowlist.entries.length) {
    console.log(`CoralConsole client allowlist enabled with ${parsedAllowlist.entries.length} ${parsedAllowlist.entries.length === 1 ? "entry" : "entries"}.`);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : "Trusted ingress failed to start.");
    process.exit(1);
  });
}
