"use client";

import { useEffect } from "react";

function createViewerId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  // Plain HTTP on a private LAN is not a secure browser context, so Web Crypto
  // may be unavailable. This ID only distinguishes short-lived viewer presence;
  // it is not used for authentication or any security decision.
  return `viewer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function ViewerPresence() {
  useEffect(() => {
    const id = createViewerId();
    let stopped = false;
    let sending = false;
    let timer: number | undefined;

    const schedule = (seconds: number) => {
      if (stopped) return;
      timer = window.setTimeout(() => void heartbeat(), seconds * 1000);
    };

    const heartbeat = async () => {
      if (stopped || sending) return;
      sending = true;
      let nextHeartbeatSeconds = 5;
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerId: id, active: true }),
          cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json() as { heartbeatIntervalSeconds?: number };
          if (Number.isFinite(payload.heartbeatIntervalSeconds)) nextHeartbeatSeconds = Number(payload.heartbeatIntervalSeconds);
        }
      } catch {
        // A later heartbeat will retry after a transient connection failure.
      } finally {
        sending = false;
        schedule(nextHeartbeatSeconds);
      }
    };

    const reportVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) window.clearTimeout(timer);
      void heartbeat();
    };

    void heartbeat();
    document.addEventListener("visibilitychange", reportVisible);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", reportVisible);
      const body = JSON.stringify({ viewerId: id, active: false });
      if (!navigator.sendBeacon("/api/presence", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, []);

  return null;
}
