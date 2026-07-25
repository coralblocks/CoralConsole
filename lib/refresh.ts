import { checkActorHealth, refreshActorStatus } from "./actor-server";
import { getActor, getSettings, listActors, markActorOffline, recordActorHeartbeat, updateActor } from "./repository";

let refreshPromise: Promise<ReturnType<typeof listActors>> | null = null;
let lastRefreshAt = 0;
let healthCheckPromise: Promise<ReturnType<typeof listActors>> | null = null;
let lastHealthCheckAt = 0;

async function refreshWithLimit() {
  const actors = listActors();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, actors.length) }, async () => {
    while (cursor < actors.length) {
      const actor = actors[cursor++];
      if (!actor || actor.demo) continue;
      try {
        const refreshed = await refreshActorStatus(actor, (message) => {
          const current = getActor(actor.id);
          if (current && !current.demo) markActorOffline(current, message);
        });
        updateActor(refreshed);
      } catch (error) {
        markActorOffline(actor, error instanceof Error ? error.message : "Actor refresh failed.");
      }
    }
  });
  await Promise.all(workers);
  lastRefreshAt = Date.now();
  return listActors();
}

export function refreshActors(force = false) {
  if (refreshPromise) return refreshPromise;
  const intervalMs = getSettings().pollIntervalSeconds * 1000;
  if (!force && Date.now() - lastRefreshAt < intervalMs) return Promise.resolve(listActors());
  refreshPromise = refreshWithLimit().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function healthCheckWithLimit() {
  const actors = listActors();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, actors.length) }, async () => {
    while (cursor < actors.length) {
      const actor = actors[cursor++];
      if (!actor || actor.demo) continue;
      try {
        const heartbeat = await checkActorHealth(actor, (message) => {
          const current = getActor(actor.id);
          if (current && !current.demo) markActorOffline(current, message);
        });
        if (heartbeat) recordActorHeartbeat(actor.id, heartbeat);
      } catch (error) {
        markActorOffline(actor, error instanceof Error ? error.message : "Actor health check failed.");
      }
    }
  });
  await Promise.all(workers);
  lastHealthCheckAt = Date.now();
  return listActors();
}

export function checkActorsHealth(force = false) {
  if (healthCheckPromise) return healthCheckPromise;
  const intervalMs = getSettings().healthCheckIntervalSeconds * 1000;
  if (!force && Date.now() - lastHealthCheckAt < intervalMs) return Promise.resolve(listActors());
  healthCheckPromise = healthCheckWithLimit().finally(() => { healthCheckPromise = null; });
  return healthCheckPromise;
}

type ActorSchedulerState = {
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
};

const globalScheduler = globalThis as typeof globalThis & { coralActorScheduler?: ActorSchedulerState };

export function ensureActorScheduler() {
  if (globalScheduler.coralActorScheduler) return;
  const state: ActorSchedulerState = { running: false };
  globalScheduler.coralActorScheduler = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await Promise.allSettled([refreshActors(false), checkActorsHealth(false)]);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(() => void tick(), 1000);
  state.timer.unref();
  void tick();
}
