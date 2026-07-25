type ViewerPresenceState = {
  lastViewerActivityAt: number;
  viewers: Map<string, number>;
};

const globalPresence = globalThis as typeof globalThis & {
  coralViewerPresence?: ViewerPresenceState;
};

const presence = globalPresence.coralViewerPresence
  ?? (globalPresence.coralViewerPresence = { lastViewerActivityAt: 0, viewers: new Map() });

export function reportViewerPresence(viewerId: string, active: boolean) {
  const now = Date.now();
  presence.lastViewerActivityAt = now;
  if (active) presence.viewers.set(viewerId, now);
  else presence.viewers.delete(viewerId);
  return presence.viewers.size;
}

export function hasRecentViewer(gracePeriodSeconds: number) {
  const cutoff = Date.now() - gracePeriodSeconds * 1000;
  for (const [viewerId, lastSeenAt] of presence.viewers) {
    if (lastSeenAt < cutoff) presence.viewers.delete(viewerId);
  }
  return presence.viewers.size > 0 || presence.lastViewerActivityAt >= cutoff;
}

export function viewerHeartbeatIntervalSeconds(gracePeriodSeconds: number) {
  return Math.max(2, Math.min(15, Math.floor(gracePeriodSeconds / 3)));
}
