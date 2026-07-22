import type { Actor, ActorKind, AdminReply } from "./types";

export class ActorCallError extends Error {
  constructor(message: string, public status = 502, public reply?: AdminReply) {
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

export async function callActorEndpoint(host: string, port: number, adminCommand: string, params = "") {
  const target = actorUrl(host, port);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCommand, params }),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await upstream.text();
    let payload: AdminReply;
    try {
      payload = JSON.parse(text) as AdminReply;
    } catch {
      throw new ActorCallError(`Actor returned a non-JSON response (${upstream.status}).`, 502);
    }
    if (!upstream.ok || payload.error) {
      throw new ActorCallError(payload.error || `Actor returned HTTP ${upstream.status}.`, upstream.ok ? 400 : upstream.status, payload);
    }
    return payload;
  } catch (error) {
    if (error instanceof ActorCallError) throw error;
    const message = error instanceof Error && error.name === "AbortError"
      ? "Actor did not respond within 6.5 seconds."
      : "Could not reach the actor. Check its address, REST port, and network access.";
    throw new ActorCallError(message, 502);
  } finally {
    clearTimeout(timeout);
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

export function commandsFromDiscovery(scope: string, details: string) {
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

function sessionStartFromStatus(results: string, session: string) {
  const explicit = results.match(/\bsession\s+start(?:\s+time)?\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
  return explicit || sessionStartFromId(session);
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

  const kind = kindFromDiscovery(scope, details);
  const commands = commandsFromDiscovery(scope, details);
  const isSequencer = kind === "sequencer" || kind === "backup-sequencer";
  let statusDetails = "";
  if (isSequencer && commands.includes("status")) {
    try {
      statusDetails = (await callActorEndpoint(host, port, `${scope} status`)).results || "";
    } catch {
      // Status metadata is optional during discovery.
    }
  }

  const isBackup = isSequencer && (kind === "backup-sequencer" || /backup|standby|failover/i.test(`${details} ${statusDetails}`));
  const discoveredKind: ActorKind = isBackup ? "backup-sequencer" : kind;
  const session = isSequencer ? sessionFromStatus(statusDetails) : "discovered";
  return {
    id,
    name: scope,
    kind: discoveredKind,
    status: isBackup ? "standby" : "online",
    host,
    port,
    account: scope,
    className: classFromDiscovery(scope, details, discoveredKind),
    sequencerRole: isSequencer ? (isBackup ? "Backup" : "Primary") : undefined,
    latency: "connected",
    session,
    sessionStarted: sessionStartFromStatus(statusDetails, session),
    lastSeen: "just now",
    commands: commands.length ? commands : ["list", "status"],
  };
}
