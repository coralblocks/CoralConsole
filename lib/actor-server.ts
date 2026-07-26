import { Agent as HttpAgent, request as requestHttp } from "node:http";
import { Agent as HttpsAgent, request as requestHttps } from "node:https";
import type { Socket } from "node:net";
import { sessionStartFromId } from "./session";
import { BASELINE_ADMIN_ACTIONS, type Actor, type ActorKind, type ActorOperationalState, type ActorStatusField, type AdminActionReply, type AuditOutcome } from "./types";

const ACTOR_TIMEOUT_MS = 6500;
const MONITORING_CONNECTION_LOST = "The persistent actor monitoring connection was lost.";

type MonitoringDisconnectHandler = (message: string) => void;

type PersistentMonitoringRequest = {
  actorId: string;
  onDisconnect: MonitoringDisconnectHandler;
  shouldLog?: boolean;
};

type MonitoringConnection = {
  actorId: string;
  agent: HttpAgent;
  closing: boolean;
  disconnectedSockets: WeakSet<Socket>;
  observedSockets: WeakSet<Socket>;
  onDisconnect: MonitoringDisconnectHandler;
  socket?: Socket;
  target: string;
};

const monitoringConnections = new Map<string, MonitoringConnection>();

export class ActorCallError extends Error {
  constructor(
    message: string,
    public status = 502,
    public reply?: AdminActionReply,
    public outcome: Exclude<AuditOutcome, "success"> = "error",
  ) {
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

function closeMonitoringConnection(connection: MonitoringConnection) {
  connection.closing = true;
  monitoringConnections.delete(connection.actorId);
  connection.agent.destroy();
}

export function closeActorMonitoringConnection(actorId: string) {
  const connection = monitoringConnections.get(actorId);
  if (connection) closeMonitoringConnection(connection);
}

export function closeAllActorMonitoringConnections() {
  for (const connection of [...monitoringConnections.values()]) closeMonitoringConnection(connection);
}

function getMonitoringConnection(actorId: string, target: URL, onDisconnect: MonitoringDisconnectHandler) {
  const targetKey = target.origin;
  const current = monitoringConnections.get(actorId);
  if (current?.target === targetKey) {
    current.onDisconnect = onDisconnect;
    return current;
  }
  if (current) closeMonitoringConnection(current);

  const options = {
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 1,
    maxTotalSockets: 1,
    maxFreeSockets: 1,
    // The monitoring connection is intentionally kept across every configured
    // polling interval. Request timeouts are enforced separately below.
    timeout: 0,
  };
  const connection: MonitoringConnection = {
    actorId,
    agent: target.protocol === "https:" ? new HttpsAgent(options) : new HttpAgent(options),
    closing: false,
    disconnectedSockets: new WeakSet(),
    onDisconnect,
    observedSockets: new WeakSet(),
    target: targetKey,
  };
  monitoringConnections.set(actorId, connection);
  return connection;
}

function observeMonitoringSocket(connection: MonitoringConnection, socket: Socket) {
  connection.socket = socket;
  socket.setKeepAlive(true, 1000);
  if (connection.observedSockets.has(socket)) return;
  connection.observedSockets.add(socket);

  const disconnected = () => {
    if (
      connection.closing
      || monitoringConnections.get(connection.actorId) !== connection
      || connection.socket !== socket
      || connection.disconnectedSockets.has(socket)
    ) return;
    connection.disconnectedSockets.add(socket);
    connection.socket = undefined;
    connection.onDisconnect(MONITORING_CONNECTION_LOST);
  };
  socket.once("error", disconnected);
  socket.once("close", disconnected);
}

function postActorRequest(
  target: URL,
  body: string,
  persistentMonitoring?: PersistentMonitoringRequest,
) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const send = target.protocol === "https:" ? requestHttps : requestHttp;
    const monitoringConnection = persistentMonitoring
      ? getMonitoringConnection(persistentMonitoring.actorId, target, persistentMonitoring.onDisconnect)
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
        "Connection": monitoringConnection ? "keep-alive" : "close",
      },
      agent: monitoringConnection?.agent || false,
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
    if (monitoringConnection) {
      request.on("socket", (socket) => observeMonitoringSocket(monitoringConnection, socket));
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
  persistentMonitoring?: PersistentMonitoringRequest,
) {
  const target = actorUrl(host, port);

  try {
    const requestBody = {
      adminCommand: adminAction,
      params,
      ...(persistentMonitoring?.shouldLog === undefined ? {} : { shouldLog: persistentMonitoring.shouldLog }),
    };
    const upstream = await postActorRequest(target, JSON.stringify(requestBody), persistentMonitoring);
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
      throw new ActorCallError("Actor reported that the admin action failed.", 400, payload, "failed");
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
    throw new ActorCallError(message, 502, undefined, "unreachable");
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
  const discovered = details.split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
  return [...new Set([
    ...BASELINE_ADMIN_ACTIONS,
    ...discovered.filter((action) => !BASELINE_ADMIN_ACTIONS.includes(action as typeof BASELINE_ADMIN_ACTIONS[number])),
  ])];
}

export function classFromDiscovery(scope: string, details: string, kind: ActorKind) {
  const component = details.split(/\r?\n/).find((line) => line.startsWith(`${scope}-`)
    && /Receiver|Publisher|Store|Replayer|Bridge|Dispatcher|Archiver|Application|Node|Logger|Link|MultiMQ|Sequencer/i.test(line));
  if (!component) return kind === "backup-sequencer" ? "Sequencer" : kind.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
  const withoutScope = component.slice(scope.length + 1);
  const addressStart = withoutScope.search(/-(?:\d{1,3}\.){3}\d{1,3}:\d+|-[\d.]+$/);
  return addressStart > 0 ? withoutScope.slice(0, addressStart) : withoutScope;
}

function actorStatusKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseActorStatusFields(results: string): ActorStatusField[] {
  return results.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return [];
    const label = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    return label ? [{ label, value }] : [];
  });
}

function actorStatusValue(fields: ActorStatusField[], label: string) {
  const key = actorStatusKey(label);
  return fields.find((field) => actorStatusKey(field.label) === key)?.value;
}

function actorStatusBoolean(fields: ActorStatusField[], label: string) {
  const value = actorStatusValue(fields, label)?.toLowerCase();
  return value === "true" ? true : value === "false" ? false : undefined;
}

function operationalStateFromActorStatus(fields: ActorStatusField[], fallback: ActorOperationalState) {
  const open = actorStatusBoolean(fields, "open");
  if (open === false) return "closed";
  if (open !== true) return fallback;

  const disconnected = actorStatusBoolean(fields, "disconnected");
  if (disconnected === true) return "disconnected";
  if (disconnected !== false) return fallback;

  const rewinding = actorStatusBoolean(fields, "rewinding");
  if (rewinding === true) return "rewinding";
  if (rewinding !== false) return fallback;

  const active = actorStatusBoolean(fields, "active");
  if (active === true) return "active";
  if (active === false) return "inactive";
  return fallback;
}

function kindFromActorStatus(fields: ActorStatusField[]) {
  const actorType = actorStatusValue(fields, "type");
  return actorType ? kindFromDiscovery(actorType, "") : undefined;
}

function sessionStartFromActorStatus(fields: ActorStatusField[], session: string) {
  const explicit = actorStatusValue(fields, "session start time") || actorStatusValue(fields, "session start");
  return explicit || sessionStartFromId(session);
}

function actorFromActorStatus(actor: Actor, actorStatusDetails: string): Actor {
  const fields = parseActorStatusFields(actorStatusDetails);
  const reportedKind = kindFromActorStatus(fields);
  const kind = reportedKind || actor.kind;
  const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
  const isBackup = isSequencer && (
    reportedKind === "backup-sequencer"
    || (reportedKind === undefined && actor.kind === "backup-sequencer")
  );
  const discoveredKind: ActorKind = isBackup ? "backup-sequencer" : kind;
  const name = actorStatusValue(fields, "name") || actor.name;
  const session = actorStatusValue(fields, "session") || actor.session;
  return {
    ...actor,
    name,
    kind: discoveredKind,
    status: "online",
    operationalState: operationalStateFromActorStatus(fields, actor.operationalState),
    account: actorStatusValue(fields, "account") || name,
    className: actorStatusValue(fields, "class") || actor.className,
    sequencerRole: isSequencer ? (isBackup ? "Backup" : "Primary") : undefined,
    latency: "connected",
    session,
    outboundSequence: actorStatusValue(fields, "sequence") || actor.outboundSequence,
    accounts: actorStatusValue(fields, "accounts") || actor.accounts,
    clockTickInterval: actorStatusValue(fields, "clock tick interval") || actor.clockTickInterval,
    actorStatusFields: fields.length ? fields : actor.actorStatusFields,
    sessionStarted: sessionStartFromActorStatus(fields, session),
    actorStatusRespondedAt: new Date().toISOString(),
    lastSeen: "just now",
  };
}

export async function refreshActorStatus(actor: Actor, onDisconnect: MonitoringDisconnectHandler) {
  const persistentMonitoring = { actorId: actor.id, onDisconnect, shouldLog: false };
  const reply = await callActorEndpoint(
    actor.host,
    actor.port,
    `${actor.name} actorStatus`,
    "",
    persistentMonitoring,
  );
  const refreshed = actorFromActorStatus(actor, typeof reply.results === "string" ? reply.results : "");

  try {
    const listReply = await callActorEndpoint(
      actor.host,
      actor.port,
      "list",
      actor.name,
      persistentMonitoring,
    );
    const actions = actionsFromDiscovery(actor.name, listReply.results || "");
    return actions.length ? { ...refreshed, actions } : refreshed;
  } catch {
    // Actor connectivity comes exclusively from actorStatus. A list failure
    // must not override a valid actorStatus response.
    return refreshed;
  }
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
  const kind = kindFromDiscovery(scope, details);
  const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
  const isBackup = kind === "backup-sequencer";
  const discoveredKind: ActorKind = isBackup ? "backup-sequencer" : kind;
  const actor: Actor = {
    id,
    name: scope,
    kind: discoveredKind,
    status: "online",
    operationalState: "inactive",
    host,
    port,
    account: scope,
    className: classFromDiscovery(scope, details, discoveredKind),
    sequencerRole: isSequencer ? (isBackup ? "Backup" : "Primary") : undefined,
    latency: "connected",
    session: "Not reported",
    outboundSequence: "Not reported",
    accounts: "Not reported",
    clockTickInterval: "Not reported",
    actorStatusFields: [],
    lastSeen: "just now",
    actions,
  };
  try {
    const actorStatusReply = await callActorEndpoint(host, port, `${scope} actorStatus`);
    const actorStatusDetails = typeof actorStatusReply.results === "string" ? actorStatusReply.results : "";
    return actorFromActorStatus(actor, actorStatusDetails);
  } catch {
    // Root and scoped list responses still provide a usable actor if metadata is temporarily unavailable.
    return actor;
  }
}
