import { callActorEndpoint } from "./actor-server";
import type { Actor } from "./types";

export type ActorLogSnapshot = {
  messagesSaved: number;
  messages: string[];
  updatedAt?: string;
};

type ActorLogState = {
  messagesSaved: number;
  messages: string[];
  updatedAt?: string;
};

const globalLogCache = globalThis as typeof globalThis & {
  coralActorLogCache?: Map<string, ActorLogState>;
};

const actorLogCache = globalLogCache.coralActorLogCache
  ?? (globalLogCache.coralActorLogCache = new Map());

function snapshot(state?: ActorLogState): ActorLogSnapshot {
  return state
    ? { ...state, messages: [...state.messages] }
    : { messagesSaved: 0, messages: [] };
}

function parseLastLogs(results: string) {
  const lines = results.split(/\r?\n/);
  const cursorLine = lines.shift() || "";
  const match = cursorLine.match(/^\s*messagesSaved\s*:\s*(\d+)\s*$/i);
  if (!match) throw new Error("Actor lastLogs response is missing a valid messagesSaved value.");

  const messagesSaved = Number(match[1]);
  if (!Number.isSafeInteger(messagesSaved)) {
    throw new Error("Actor lastLogs response contains an invalid messagesSaved value.");
  }

  while (lines.at(-1) === "") lines.pop();
  return { messagesSaved, messages: lines };
}

export function getActorLogs(actorId: string) {
  return snapshot(actorLogCache.get(actorId));
}

export function clearActorLogs(actorId: string) {
  actorLogCache.delete(actorId);
}

export async function refreshActorLogs(actor: Actor, onDisconnect: (message: string) => void) {
  const current = actorLogCache.get(actor.id);
  const reply = await callActorEndpoint(
    actor.host,
    actor.port,
    "VM lastLogs",
    String(current?.messagesSaved ?? 0),
    { actorId: actor.id, onDisconnect, shouldLog: false },
  );
  if (reply.result !== true) {
    throw new Error("Actor lastLogs action did not succeed.");
  }
  const next = parseLastLogs(typeof reply.results === "string" ? reply.results : "");

  if (
    !current
    || next.messagesSaved !== current.messagesSaved
    || next.messages.length > 0
  ) {
    actorLogCache.set(actor.id, {
      ...next,
      updatedAt: new Date().toISOString(),
    });
  }

  return getActorLogs(actor.id);
}
