const globalActorOperationalStates = globalThis as typeof globalThis & {
  coralFreshActorOperationalStates?: Set<string>;
};

const freshActorOperationalStates = globalActorOperationalStates.coralFreshActorOperationalStates
  ?? (globalActorOperationalStates.coralFreshActorOperationalStates = new Set());

export function actorOperationalStateIsFresh(actorId: string) {
  return freshActorOperationalStates.has(actorId);
}

export function markActorOperationalStateFresh(actorId: string) {
  freshActorOperationalStates.add(actorId);
}

export function invalidateActorOperationalState(actorId: string) {
  freshActorOperationalStates.delete(actorId);
}

export function forgetActorOperationalState(actorId: string) {
  freshActorOperationalStates.delete(actorId);
}
