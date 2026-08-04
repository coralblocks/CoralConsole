"use client";

import { KeyRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { ConsoleBrand } from "../console-chrome";

type AccessGateProps = {
  returnTo: string;
};

export default function AccessGate({ returnTo }: AccessGateProps) {
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey }),
        cache: "no-store",
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Access could not be verified.");
      window.location.replace(returnTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Access could not be verified.");
      setSubmitting(false);
    }
  };

  return (
    <main className="access-gate-shell">
      <section className="access-gate-card" aria-labelledby="access-gate-title">
        <ConsoleBrand ariaLabel="CoralConsole" subtitle="Operator access" />
        <div className="access-gate-icon" aria-hidden="true"><KeyRound /></div>
        <div>
          <p className="eyebrow">Protected console</p>
          <h1 id="access-gate-title">Enter the access key</h1>
          <p className="access-gate-copy">Paste this installation&apos;s shared key to continue.</p>
        </div>
        <form onSubmit={submit} className="access-gate-form">
          <label htmlFor="access-key">Access key</label>
          <input
            id="access-key"
            name="access-key"
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          <div className="access-gate-feedback" role="status" aria-live="polite">{error}</div>
          <button className="button button-dark" type="submit" disabled={submitting || !accessKey.trim()}>
            <span>{submitting ? "Checking…" : "Continue"}</span>
            <KeyRound aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  );
}
