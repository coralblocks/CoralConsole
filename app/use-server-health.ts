"use client";

import { useEffect, useState } from "react";

export const SERVER_HEALTH_INTERVAL_MS = 5_000;
export const SERVER_HEALTH_TIMEOUT_MS = 4_000;

export function useServerHealth() {
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    let checkNumber = 0;
    let controller: AbortController | undefined;

    async function checkServerHealth() {
      const currentCheck = ++checkNumber;
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      const timeout = window.setTimeout(() => currentController.abort(), SERVER_HEALTH_TIMEOUT_MS);
      let connected = false;

      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          signal: currentController.signal,
        });
        connected = response.ok;
      } catch {
        connected = false;
      } finally {
        window.clearTimeout(timeout);
        if (active && currentCheck === checkNumber) setServerConnected(connected);
      }
    }

    void checkServerHealth();
    const timer = window.setInterval(() => void checkServerHealth(), SERVER_HEALTH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, []);

  return serverConnected;
}
