# CoralConsole Shared Internal Deployment Plan

> **Implementation status (22 July 2026):** the baseline described here is implemented on `feature/internal-deployment`. This document remains the architectural rationale and validation checklist; operational instructions live in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Summary

- Replace the browser-local prototype with shared SQLite persistence and a conventional internal Node.js deployment.
- Make a self-contained Docker deployment the canonical distribution: one installation, one topology, one SQLite database, and one configurable internal port.
- Run the container on a server that can reach the actors' REST ports. The customer's firewall, VPN, or reverse proxy prevents internet access.
- Two topologies use two installations with separate ports, data volumes, names, and colors.

## Architecture and deployment

- Move from the Cloudflare Worker runtime to a conventional Next.js Node 22 standalone server while preserving the existing React application.
- Add a multi-stage Dockerfile and Docker Compose example with a configurable host port, persistent `/data` volume, SQLite database at `/data/coralconsole.db`, `/api/health` health check, and demo mode disabled by default.
- Default port binding to localhost for reverse-proxy deployments; document binding directly to a private LAN address when required.
- Use SQLite WAL mode, foreign keys, migrations at container startup, and one application process. Document volume backup and restore.
- Remove unused Cloudflare/D1 deployment plumbing after the Node build and Docker smoke test pass.

## Shared data and UI

- Store singleton topology settings: name, custom `#RRGGBB` background color, 30-second refresh interval, and 90-day audit retention.
- Require topology name and color during first-run setup. Keep the name visible in the header and use the color as a prominent environment indicator plus subtle page tint, with automatically calculated accessible contrast.
- Store actor endpoint, discovered identity, type, available admin actions, cached status, session, timestamps, and errors in SQLite. Enforce unique host-and-port pairs.
- Replace browser actor persistence and detail snapshots with database-backed loading. Keep `localStorage` only for device-specific preferences such as intro visibility.
- Offer a one-time import for existing browser actors. Re-discover endpoints, deduplicate them, and clear only successfully imported entries.
- Poll actors only while a dashboard is visible, with manual refresh, paused background tabs, bounded concurrency, and server-side refresh deduplication.
- Keep sample actors available only through an explicit demo-mode deployment option.

## APIs, admin actions, and audit

- Add same-origin endpoints for settings, actors, refresh, admin action execution, audit history, and health.
- Admin action requests reference an actor ID; the server resolves the stored endpoint so clients cannot supply arbitrary relay destinations.
- Preserve current discovery behavior and the 6.5-second actor timeout.
- Store full admin action history: actor snapshot, action, parameters, returned output, outcome, duration, timestamp, and source IP when available.
- Cap parameters and output to documented safe sizes, mark truncation, and purge records older than 90 days daily.
- Add a searchable global Audit page and actor-specific history in each actor detail view.
- Enforce same-origin mutation requests, JSON validation, plain-text output rendering, security headers, and confirmation before destructive actions.
- Do not add application login in this version. Anyone who can reach the internal URL has full configuration and admin action access; deployment documentation must state this clearly.

## Validation

- Verify actors added in one browser appear in another and survive container restarts.
- Verify direct actor-detail URLs work without browser snapshots.
- Test migrations, endpoint uniqueness, concurrent writes, refresh throttling, actor failures, and deletion with preserved audit history.
- Test full admin action recording, truncation, search, filtering, and 90-day cleanup.
- Test first-run topology setup, arbitrary custom colors, contrast, and separate installations using distinct ports and volumes.
- Test one-time `localStorage` migration, including duplicates and partial failures.
- Build and smoke-test the production Docker image, health check, persistent volume, private-network relay, and restart behavior.

## Assumptions

- Each installation manages exactly one topology.
- SQLite is sufficient because each topology runs as one container rather than a replicated cluster.
- The customer controls network reachability, firewall rules, TLS termination, and reverse-proxy configuration.
- CoralConsole sends no topology, admin action, or audit data to external services.
- Authentication, roles, Kubernetes, and multi-instance high availability remain out of scope for this version.
