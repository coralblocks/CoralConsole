import { closeAllActorMonitoringConnections, invalidateActorActionLists, refreshActorStatus } from "./actor-server";
import { refreshActorLogs, resetActorLogCursor } from "./actor-logs";
import { getActor, getSettings, listActors, markActorOffline, updateActor } from "./repository";
import { hasRecentViewer } from "./viewer-presence";

let refreshPromise: Promise<ReturnType<typeof listActors>> | null = null;
let refreshPromiseRefreshesActions = false;
let lastRefreshAt = 0;

type ActorRefreshOptions = {
  refreshActions?: boolean;
};

type RefreshActorsOptions = ActorRefreshOptions & {
  force?: boolean;
};

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
    if (current && !current.demo) {
      invalidateActorActionLists(actorId);
      resetActorLogCursor(actorId);
      markActorOffline(current, message);
    }
  };
}

async function refreshOneActor(actorId: string, options: ActorRefreshOptions = {}) {
  const actor = getActor(actorId);
  if (!actor || actor.demo) return;
  try {
    const refreshed = updateActor(await refreshActorStatus(actor, disconnectHandler(actorId), options));
    if (!refreshed) return;
    if (actor.status === "offline" || actor.session !== refreshed.session) {
      resetActorLogCursor(actorId);
    }
    try {
      await refreshActorLogs(refreshed, disconnectHandler(actorId));
    } catch {
      // Log retrieval is supplemental. A lastLogs failure must not override a
      // successful actorStatus result or discard the last cached log window.
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Actor refresh failed.";
    invalidateActorActionLists(actorId);
    markActorOffline(actor, message);
  }
}

async function reconcileActorAfterAdminAction(actorId: string) {
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

export function runExclusiveActorMutation<T>(actorId: string, mutation: () => Promise<T> | T) {
  const state = operationState(actorId);
  state.manualActions += 1;
  return enqueueActorOperation(actorId, state, async () => mutation()).finally(() => {
    state.manualActions -= 1;
    cleanupOperationState(actorId, state);
  });
}

async function refreshWithLimit(options: ActorRefreshOptions = {}) {
  const actors = listActors();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, actors.length) }, async () => {
    while (cursor < actors.length) {
      const actor = actors[cursor++];
      if (!actor || actor.demo) continue;
      await runScheduledActorOperation(actor.id, () => refreshOneActor(actor.id, options));
    }
  });
  await Promise.all(workers);
  lastRefreshAt = Date.now();
  return listActors();
}

export function refreshActors(options: RefreshActorsOptions = {}): Promise<ReturnType<typeof listActors>> {
  const force = Boolean(options.force);
  const refreshActions = Boolean(options.refreshActions);
  if (refreshPromise) {
    if (!refreshActions || refreshPromiseRefreshesActions) return refreshPromise;
    return refreshPromise.then(() => refreshActors({ force: true, refreshActions: true }));
  }
  const intervalMs = getSettings().pollIntervalSeconds * 1000;
  if (!force && Date.now() - lastRefreshAt < intervalMs) return Promise.resolve(listActors());
  refreshPromiseRefreshesActions = refreshActions;
  refreshPromise = refreshWithLimit({ refreshActions }).finally(() => {
    refreshPromise = null;
    refreshPromiseRefreshesActions = false;
  });
  return refreshPromise;
}

export async function refreshActorNow(actorId: string, options: ActorRefreshOptions = {}) {
  const actor = getActor(actorId);
  if (!actor || actor.demo) return actor;
  const state = operationState(actorId);
  await enqueueActorOperation(actorId, state, () => refreshOneActor(actorId, options));
  return getActor(actorId);
}

type ActorSchedulerState = {
  polling: boolean;
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
};

const globalScheduler = globalThis as typeof globalThis & { coralActorScheduler?: ActorSchedulerState };

export function ensureActorScheduler() {
  if (globalScheduler.coralActorScheduler) return;
  const state: ActorSchedulerState = { polling: false, running: false };
  globalScheduler.coralActorScheduler = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const settings = getSettings();
      const viewerPresent = hasRecentViewer(settings.viewerGracePeriodSeconds);
      const shouldPoll = settings.keepPollingWithoutViewers || viewerPresent;
      if (!shouldPoll) {
        closeAllActorMonitoringConnections();
        state.polling = false;
        return;
      }
      const resumed = !state.polling;
      state.polling = true;
      await refreshActors({ force: resumed });
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(() => void tick(), 1000);
  state.timer.unref();
  void tick();
}
