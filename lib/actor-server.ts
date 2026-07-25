import { Agent as HttpAgent, request as requestHttp } from "node:http";
import { Agent as HttpsAgent, request as requestHttps } from "node:https";
import type { Socket } from "node:net";
import type { Actor, ActorKind, AdminActionReply } from "./types";

const ACTOR_TIMEOUT_MS = 6500;
const STATUS_CONNECTION_LOST = "The persistent status connection was lost.";

type StatusDisconnectHandler = (message: string) => void;

type StatusConnection = {
  actorId: string;
  agent: HttpAgent;
  closing: boolean;
  disconnectedSockets: WeakSet<Socket>;
  observedSockets: WeakSet<Socket>;
  onDisconnect: StatusDisconnectHandler;
  socket?: Socket;
  target: string;
};

const statusConnections = new Map<string, StatusConnection>();

export class ActorCallError extends Error {
  constructor(message: string, public status = 502, public reply?: AdminActionReply) {
    super(message);
  }
}

export function actorUrl(host: string, port: number) {
  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Unsupported protocol");
    if (target.username || target.password || target.search || target.hash || (target.pathname !== "/" && target.pathname !== "")) throw new Error("Unexpected URL parts");
    target.port = String(port);
    target.pathname = "/";
    target.search = "";
    target.hash = "";
  } catch {
    throw new ActorCallError("Enter a plain IP address or hostname.", 400);
  }
  return target;
}

function closeStatusConnection(connection: StatusConnection) {
  connection.closing = true;
  statusConnections.delete(connection.actorId);
  connection.agent.destroy();
}

export function closeActorStatusConnection(actorId: string) {
  const connection = statusConnections.get(actorId);
  if (connection) closeStatusConnection(connection);
}

function getStatusConnection(actorId: string, target: URL, onDisconnect: StatusDisconnectHandler) {
  const targetKey = target.origin;
  const current = statusConnections.get(actorId);
  if (current?.target === targetKey) {
    current.onDisconnect = onDisconnect;
    return current;
  }
  if (current) closeStatusConnection(current);

  const options = {
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 1,
    maxTotalSockets: 1,
    maxFreeSockets: 1,
    // The status connection is intentionally kept across every configured
    // polling interval. Request timeouts are enforced separately below.
    timeout: 0,
  };
  const connection: StatusConnection = {
    actorId,
    agent: target.protocol === "https:" ? new HttpsAgent(options) : new HttpAgent(options),
    closing: false,
    disconnectedSockets: new WeakSet(),
    onDisconnect,
    observedSockets: new WeakSet(),
    target: targetKey,
  };
  statusConnections.set(actorId, connection);
  return connection;
}

function observeStatusSocket(connection: StatusConnection, socket: Socket) {
  connection.socket = socket;
  socket.setKeepAlive(true, 1000);
  if (connection.observedSockets.has(socket)) return;
  connection.observedSockets.add(socket);

  const disconnected = () => {
    if (
      connection.closing
      || statusConnections.get(connection.actorId) !== connection
      || connection.socket !== socket
      || connection.disconnectedSockets.has(socket)
    ) return;
    connection.disconnectedSockets.add(socket);
    connection.socket = undefined;
    connection.onDisconnect(STATUS_CONNECTION_LOST);
  };
  socket.once("error", disconnected);
  socket.once("close", disconnected);
}

function postActorRequest(
  target: URL,
  body: string,
  persistentStatus?: { actorId: string; onDisconnect: StatusDisconnectHandler },
) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const send = target.protocol === "https:" ? requestHttps : requestHttp;
    const statusConnection = persistentStatus
      ? getStatusConnection(persistentStatus.actorId, target, persistentStatus.onDisconnect)
      : undefined;
    const resolveRequest = (value: { status: number; text: string }) => {
      clearTimeout(timeout);
      resolve(value);
    };
    const rejectRequest = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };
    const request = send(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Connection": statusConnection ? "keep-alive" : "close",
      },
      agent: statusConnection?.agent || false,
      // Coral REST admin servers can emit a timezone name in the Date header.
      // Node fetch rejects that otherwise usable response before exposing its body.
      insecureHTTPParser: true,
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => resolveRequest({ status: response.statusCode || 502, text }));
      response.on("error", rejectRequest);
    });
    const timeout = setTimeout(() => {
      const timeoutError = new Error(`Actor did not respond within ${ACTOR_TIMEOUT_MS / 1000} seconds.`);
      timeoutError.name = "AbortError";
      request.destroy(timeoutError);
    }, ACTOR_TIMEOUT_MS);
    if (statusConnection) {
      request.on("socket", (socket) => observeStatusSocket(statusConnection, socket));
    }
    request.on("error", rejectRequest);
    request.end(body);
  });
}

function escapeUnescapedJsonControlCharacters(value: string) {
  let escaped = false;
  let inString = false;
  let sanitized = "";
  for (const character of value) {
    if (!inString) {
      if (character === "\"") inString = true;
      sanitized += character;
      continue;
    }
    if (escaped) {
      escaped = false;
      sanitized += character;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      sanitized += character;
      continue;
    }
    if (character === "\"") {
      inString = false;
      sanitized += character;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code < 0x20) {
      sanitized += character === "\b" ? "\\b"
        : character === "\f" ? "\\f"
          : character === "\n" ? "\\n"
            : character === "\r" ? "\\r"
              : character === "\t" ? "\\t"
                : `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    sanitized += character;
  }
  return sanitized;
}

function parseAdminActionReply(text: string) {
  try {
    return JSON.parse(text) as AdminActionReply;
  } catch {
    // Status output from some Coral REST servers contains literal tabs inside
    // the JSON results string. Escape only control characters inside strings.
    return JSON.parse(escapeUnescapedJsonControlCharacters(text)) as AdminActionReply;
  }
}

function adminActionError(message: string) {
  return message.replace(/\badmin\s+commands?\b/gi, (term) => term.toLowerCase().endsWith("s") ? "admin actions" : "admin action");
}

export async function callActorEndpoint(
  host: string,
  port: number,
  adminAction: string,
  params = "",
  persistentStatus?: { actorId: string; onDisconnect: StatusDisconnectHandler },
) {
  const target = actorUrl(host, port);

  try {
    const upstream = await postActorRequest(target, JSON.stringify({ adminCommand: adminAction, params }), persistentStatus);
    let payload: AdminActionReply;
    try {
      payload = parseAdminActionReply(upstream.text);
    } catch {
      throw new ActorCallError(`Actor returned a non-JSON response (${upstream.status}).`, 502);
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      throw new ActorCallError(payload.error ? adminActionError(payload.error) : `Actor returned HTTP ${upstream.status}.`, upstream.status, payload);
    }
    if (payload.error) {
      throw new ActorCallError(adminActionError(payload.error), 400, payload);
    }
    if (payload.result === false) {
      throw new ActorCallError("Actor reported that the admin action failed.", 400, payload);
    }
    if (payload.result !== true) {
      throw new ActorCallError("Actor response is missing the required boolean result.", 502, payload);
    }
    return payload;
  } catch (error) {
    if (error instanceof ActorCallError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? "Actor did not respond within 6.5 seconds."
      : "Could not reach the actor. Check its address, REST port, and network access.";
    throw new ActorCallError(message, 502);
  }
}

export function kindFromDiscovery(scope: string, details: string): ActorKind {
  const signal = `${scope} ${details}`.toLowerCase();
  const compact = signal.replace(/[^a-z0-9]/g, "");
  if (/multimqapp/.test(compact)) return "multimqapp";
  if (/backupsequencer|sequencerbackup/.test(compact)) return "backup-sequencer";
  if (/dispatcher|\bdsp\b/.test(signal)) return "dispatcher";
  if (/replayer|\breplay\b|\brpl\b/.test(signal)) return "replayer";
  if (/archiver|\barchive\b|\barc\b/.test(signal)) return "archiver";
  if (/sequencer|\bseq\b/.test(signal)) return "sequencer";
  if (/bridge|\bbrg\b/.test(signal)) return "bridge";
  if (/logger|\blog\b/.test(signal)) return "logger";
  if (/\blink\b/.test(signal)) return "link";
  if (/application|\bapp\b/.test(signal)) return "application";
  return "node";
}

export function actionsFromDiscovery(scope: string, details: string) {
  const prefix = `${scope} `;
  return details.split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

export function classFromDiscovery(scope: string, details: string, kind: ActorKind) {
  const component = details.split(/\r?\n/).find((line) => line.startsWith(`${scope}-`)
    && /Receiver|Publisher|Store|Replayer|Bridge|Dispatcher|Archiver|Application|Node|Logger|Link|MultiMQ|Sequencer/i.test(line));
  if (!component) return kind === "backup-sequencer" ? "Sequencer" : kind.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
  const withoutScope = component.slice(scope.length + 1);
  const addressStart = withoutScope.search(/-(?:\d{1,3}\.){3}\d{1,3}:\d+|-[\d.]+$/);
  return addressStart > 0 ? withoutScope.slice(0, addressStart) : withoutScope;
}

export function sessionFromStatus(results: string) {
  const labeled = results.match(/\bsession(?:\s+(?:id|name))?\s*[:=]?\s*(\d{10})\b/i);
  return labeled?.[1] || results.match(/\b\d{10}\b/)?.[0] || "Not reported";
}

export function sessionStartFromId(session: string) {
  const match = session.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  if (!monthLabel) return undefined;
  return `${day} ${monthLabel} 20${year} · ${hour}:${minute}`;
}

function statusValue(results: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return results.match(new RegExp(`^${escapedLabel}:\\s*([^\\r\\n]+)`, "im"))?.[1]?.trim();
}

function statusBoolean(results: string, label: string) {
  const value = statusValue(results, label)?.toLowerCase();
  return value === "true" ? true : value === "false" ? false : undefined;
}

function classFromStatus(results: string) {
  const className = statusValue(results, "actor class");
  return className?.split(".").filter(Boolean).at(-1);
}

function kindFromStatus(results: string) {
  const actorType = statusValue(results, "actor type");
  return actorType ? kindFromDiscovery(actorType, "") : undefined;
}

function sessionStartFromStatus(results: string, session: string) {
  const explicit = results.match(/\bsession\s+start(?:\s+time)?\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
  return explicit || sessionStartFromId(session);
}

function actorFromStatus(actor: Actor, statusDetails: string): Actor {
  const reportedKind = kindFromStatus(statusDetails);
  const kind = reportedKind || actor.kind;
  const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
  const sequencerActive = statusBoolean(statusDetails, "sequencer active");
  const actorOpen = statusBoolean(statusDetails, isSequencer ? "sequencer open" : "actor open");
  const isBackup = isSequencer && (
    reportedKind === "backup-sequencer"
    || sequencerActive === false
    || (sequencerActive === undefined && actor.kind === "backup-sequencer")
    || /backup|standby|failover/i.test(statusDetails)
  );
  const discoveredKind: ActorKind = isBackup ? "backup-sequencer" : kind;
  const reportedSession = isSequencer ? sessionFromStatus(statusDetails) : actor.session;
  const session = reportedSession === "Not reported" ? actor.session : reportedSession;
  return {
    ...actor,
    kind: discoveredKind,
    status: actorOpen === false ? "offline" : isBackup ? "standby" : "online",
    account: statusValue(statusDetails, isSequencer ? "sequencer account" : "actor account") || actor.account,
    className: classFromStatus(statusDetails) || actor.className,
    sequencerRole: isSequencer ? (isBackup ? "Backup" : "Primary") : undefined,
    latency: "connected",
    session,
    sessionStarted: sessionStartFromStatus(statusDetails, session) || actor.sessionStarted,
    lastSeen: "just now",
  };
}

export async function refreshActorStatus(actor: Actor, onDisconnect: StatusDisconnectHandler) {
  const reply = await callActorEndpoint(
    actor.host,
    actor.port,
    `${actor.name} status`,
    "",
    { actorId: actor.id, onDisconnect },
  );
  return actorFromStatus(actor, reply.results || "");
}

export async function discoverActor(host: string, port: number, id = crypto.randomUUID()): Promise<Actor> {
  const root = await callActorEndpoint(host, port, "list");
  const scopes = (root.results || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line.toUpperCase() !== "VM");
  const scope = scopes[0] || `ACTOR-${id.slice(0, 8)}`;
  let details = "";
  try {
    details = (await callActorEndpoint(host, port, "list", scope)).results || "";
  } catch {
    // A root-only list still provides enough information for a useful actor.
  }

  const actions = actionsFromDiscovery(scope, details);
  let statusDetails = "";
  if (actions.includes("status")) {
    try {
      statusDetails = (await callActorEndpoint(host, port, `${scope} status`)).results || "";
    } catch {
      // Status metadata is optional during discovery.
    }
  }

  const kind = kindFromStatus(statusDetails) || kindFromDiscovery(scope, details);
  const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
  const sequencerActive = statusBoolean(statusDetails, "sequencer active");
  const actorOpen = statusBoolean(statusDetails, isSequencer ? "sequencer open" : "actor open");
  const isBackup = isSequencer && (
    kind === "backup-sequencer"
    || sequencerActive === false
    || /backup|standby|failover/i.test(`${details} ${statusDetails}`)
  );
  const discoveredKind: ActorKind = isBackup ? "backup-sequencer" : kind;
  const session = isSequencer ? sessionFromStatus(statusDetails) : "discovered";
  return {
    id,
    name: scope,
    kind: discoveredKind,
    status: actorOpen === false ? "offline" : isBackup ? "standby" : "online",
    host,
    port,
    account: statusValue(statusDetails, isSequencer ? "sequencer account" : "actor account") || scope,
    className: classFromStatus(statusDetails) || classFromDiscovery(scope, details, discoveredKind),
    sequencerRole: isSequencer ? (isBackup ? "Backup" : "Primary") : undefined,
    latency: "connected",
    session,
    sessionStarted: sessionStartFromStatus(statusDetails, session),
    lastSeen: "just now",
    actions: actions.length ? actions : ["list", "status"],
  };
}
