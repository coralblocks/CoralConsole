import { discoverActor } from "./actor-server";
import { listActors, markActorOffline, updateActor } from "./repository";

let refreshPromise: Promise<ReturnType<typeof listActors>> | null = null;
let lastRefreshAt = 0;

async function refreshWithLimit() {
  const actors = listActors();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, actors.length) }, async () => {
    while (cursor < actors.length) {
      const actor = actors[cursor++];
      if (!actor || actor.demo) continue;
      try {
        const refreshed = await discoverActor(actor.host, actor.port, actor.id);
        updateActor({ ...refreshed, account: actor.account, cluster: actor.cluster });
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
  if (!force && Date.now() - lastRefreshAt < 10_000) return Promise.resolve(listActors());
  refreshPromise = refreshWithLimit().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
