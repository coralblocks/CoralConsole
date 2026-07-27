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
} = {}) {
  const resolvedUpstreamPort = numericPort(upstreamPort, 39_000, "CORAL_UPSTREAM_PORT");

  const server = http.createServer((clientRequest, clientResponse) => {
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
  const bindAddress = process.env.CORAL_INGRESS_BIND_ADDRESS?.trim() || "127.0.0.1";
  const port = numericPort(process.env.CORAL_INGRESS_PORT, 3_000, "CORAL_INGRESS_PORT");
  const upstreamHost = process.env.CORAL_UPSTREAM_HOST?.trim() || "127.0.0.1";
  const upstreamPort = numericPort(process.env.CORAL_UPSTREAM_PORT, 39_000, "CORAL_UPSTREAM_PORT");
  const server = createTrustedIngress({ upstreamHost, upstreamPort });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindAddress, resolve);
  });
  console.log(`CoralConsole trusted ingress listening on ${bindAddress}:${port}.`);

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
