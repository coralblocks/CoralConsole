import { checkActorHealth, refreshActorStatus } from "./actor-server";
import { getActor, getSettings, listActors, markActorOffline, recordActorHeartbeat, updateActor } from "./repository";

let refreshPromise: Promise<ReturnType<typeof listActors>> | null = null;
let lastRefreshAt = 0;
let healthCheckPromise: Promise<ReturnType<typeof listActors>> | null = null;
let lastHealthCheckAt = 0;

type ActorOperationState = {
  manualActions: number;
  pendingOperations: number;
  tail: Promise<void>;
};

const globalOperations = globalThis as typeof globalThis & {
  coralActorOperations?: Map<string, ActorOperationState>;
};

const actorOperations = globalOperations.coralActorOperations
  ?? (globalOperations.coralActorOperations = new Map());

function operationState(actorId: string) {
  let state = actorOperations.get(actorId);
  if (!state) {
    state = { manualActions: 0, pendingOperations: 0, tail: Promise.resolve() };
    actorOperations.set(actorId, state);
  }
  return state;
}

function cleanupOperationState(actorId: string, state: ActorOperationState) {
  if (state.manualActions === 0 && state.pendingOperations === 0 && actorOperations.get(actorId) === state) {
    actorOperations.delete(actorId);
  }
}

function enqueueActorOperation<T>(actorId: string, state: ActorOperationState, operation: () => Promise<T>) {
  state.pendingOperations += 1;
  const result = state.tail.then(operation);
  state.tail = result.then(() => undefined, () => undefined);
  return result.finally(() => {
    state.pendingOperations -= 1;
    cleanupOperationState(actorId, state);
  });
}

async function runScheduledActorOperation(actorId: string, operation: () => Promise<void>) {
  const state = operationState(actorId);
  if (state.manualActions > 0) {
    cleanupOperationState(actorId, state);
    return false;
  }
  await enqueueActorOperation(actorId, state, operation);
  return true;
}

function disconnectHandler(actorId: string) {
  return (message: string) => {
    const current = getActor(actorId);
    if (current && !current.demo) markActorOffline(current, message);
  };
}

async function refreshOneActor(actorId: string) {
  const actor = getActor(actorId);
  if (!actor || actor.demo) return;
  try {
    updateActor(await refreshActorStatus(actor, disconnectHandler(actorId)));
  } catch (error) {
    markActorOffline(actor, error instanceof Error ? error.message : "Actor refresh failed.");
  }
}

async function healthCheckOneActor(actorId: string) {
  const actor = getActor(actorId);
  if (!actor || actor.demo) return;
  try {
    const heartbeat = await checkActorHealth(actor, disconnectHandler(actorId));
    if (heartbeat) recordActorHeartbeat(actor.id, heartbeat);
  } catch (error) {
    markActorOffline(actor, error instanceof Error ? error.message : "Actor health check failed.");
  }
}

async function reconcileActorAfterAdminAction(actorId: string) {
  await healthCheckOneActor(actorId);
  await refreshOneActor(actorId);
}

export function runCoordinatedAdminAction<T>(actorId: string, action: () => Promise<T>) {
  const state = operationState(actorId);
  state.manualActions += 1;
  return enqueueActorOperation(actorId, state, async () => {
    let result: T | undefined;
    let actionFailed = false;
    let actionError: unknown;
    try {
      result = await action();
    } catch (error) {
      actionFailed = true;
      actionError = error;
    }
    await reconcileActorAfterAdminAction(actorId);
    if (actionFailed) throw actionError;
    return result as T;
  }).finally(() => {
    state.manualActions -= 1;
    cleanupOperationState(actorId, state);
  });
}

async function refreshWithLimit() {
  const actors = listActors();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, actors.length) }, async () => {
    while (cursor < actors.length) {
      const actor = actors[cursor++];
      if (!actor || actor.demo) continue;
      await runScheduledActorOperation(actor.id, () => refreshOneActor(actor.id));
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
      await runScheduledActorOperation(actor.id, () => healthCheckOneActor(actor.id));
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
