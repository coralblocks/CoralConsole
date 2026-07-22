# CoralConsole — Agent Guide

## Purpose

This repository is the shared internal web console for Coral Sequencer deployments. Treat the Sequencer as the centralized source of truth and every surrounding process as an actor with a REST admin endpoint. The interface should help an operator understand topology, health, identity, and available admin actions at a glance.

Keep this file current whenever the architecture, scripts, discovery rules, persistence model, deployment model, or testing expectations change.

## Product model and actor types

- Sequencer: the single active source of truth. A deployment may have zero or one active Sequencer.
- Backup Sequencer: a standby actor for failover. A deployment may have any number.
- Replayer: may run in a cluster and catches nodes up from persisted messages.
- Bridge, Dispatcher, Link, and MultiMqApp: transport and fan-out actors.
- Archiver and Logger: persistence, audit, and observability actors.
- Application and Node: customer-built actors that publish and consume messages.
- Every actor is initially identified by a host/IP and REST admin port.

The supported actor types are Sequencer, Backup Sequencer, Replayer, Archiver, Logger, Bridge, Dispatcher, Node, Application, Link, and MultiMqApp. Use this title casing in the interface.

Discovery begins with `list`, then calls `list` with the first non-`VM` scope. For a Sequencer with a `status` action, discovery also calls `<scope> status` to determine Primary/Backup state and session metadata. Session identifiers normally use `YYMMDDHHmm`; show both the raw identifier and a readable start time. Prefer an explicit start time returned by the actor.

## Runtime architecture

- Next.js 16 standalone Node.js server, React 19, and TypeScript.
- Node.js 22 is the minimum supported runtime.
- SQLite with `better-sqlite3`, Drizzle schema, generated SQL migrations, WAL mode, foreign keys, and a five-second busy timeout.
- One installation owns one topology and one SQLite file. Never run multiple application processes against the same file.
- `Dockerfile` is the canonical release package; `docker-compose.yml` is the reference private deployment.
- The persistent database is `/data/coralconsole.db` in Docker and `.data/coralconsole.db` in local development unless `DATABASE_PATH` overrides it.
- Migrations run both through `scripts/migrate.mjs` at container startup and defensively when the application opens the database.
- Demo data is off by default and enabled only by `CORAL_DEMO_MODE=true`.

## Data ownership and persistence

- `topology_settings` stores the singleton shared name, color, poll interval, retention, and first-run status.
- `actors` stores endpoint, discovered identity, type, actions, cached health/session data, and timestamps. Host plus port is unique.
- `command_audit` stores the actor snapshot, scoped command, parameters, plain-text output, result, error, duration, timestamp, source IP (when trusted), and truncation state. Actor deletion retains audit rows with a null actor reference.
- Audit parameters are capped at 8 KiB and output at 256 KiB. Older rows are purged according to the shared retention setting.
- `localStorage` is device-specific only: `coral-console-intro` stores intro visibility. `coral-console-actors` is a legacy import source and must not become the canonical topology again.
- Never send topology, actor, command, or audit data to an external service.

## API and REST admin contract

The same-origin API surface is:

- `GET/PATCH /api/settings`
- `GET/POST /api/actors`
- `GET/DELETE /api/actors/<id>`
- `POST /api/actors/refresh`
- `POST /api/actors/<id>/commands`
- `GET/DELETE /api/audit`
- `GET /api/health`

Commands accept an actor ID, command name, and parameters. The server must resolve the stored actor endpoint; never reintroduce a client-supplied arbitrary relay route. Validate same-origin mutations, keep the actor timeout at 6.5 seconds, and render actor results only as plain text.

Actors receive JSON shaped as:

```json
{
  "adminCommand": "list",
  "params": ""
}
```

## Code structure

- `app/page.tsx` owns the shared topology UI, first-run settings, refresh polling, add-actor flow, and one-time browser migration.
- `app/actor-ui.tsx` owns shared actor labels, icons, and UI metadata.
- `app/actor/[id]/` loads direct actor details from SQLite and runs audited commands in a dedicated tab.
- `app/audit/` renders searchable global command history.
- `app/api/` contains the same-origin server API.
- `lib/actor-server.ts` owns actor endpoint validation, REST calls, and discovery.
- `lib/repository.ts` owns SQLite reads/writes and audit retention.
- `db/schema.ts` is the schema source; `drizzle/` contains committed migrations.

## Commands and validation

- `npm run dev` — run the Next.js development server.
- `npm run build` — produce the standalone Node.js build.
- `npm test` — build, start the standalone server with a temporary SQLite database, exercise APIs, restart, and verify persistence.
- `npm run lint` — run ESLint.
- `npm run db:generate` — generate a migration after an intentional schema change.
- `npm run db:migrate` — migrate the configured local database.
- `npm run docker:start` / `npm run docker:stop` — start or stop the reference container while preserving its named volume.
- `npm run docker:build` — intentionally rebuild the local image after code changes.
- `npm run docker:status` / `npm run docker:logs` — inspect the reference container.

Use the existing npm lockfile. Commit schema changes and their generated migration together. Validate with `npm run lint` and `npm test`; smoke-test Docker when deployment files or native dependencies change.

## Git workflow

- Work directly on `main` and push completed changes to `origin/main` after validation.
- Do not create pull requests or temporary branches unless the user explicitly requests them for a specific change.
- The current internal-deployment work uses `feature/internal-deployment` because the user explicitly requested a new branch.
- Before committing, inspect the exact diff and avoid staging unrelated or sensitive files.
- Use short, descriptive commit messages and keep the working tree clean after pushing.

## UI conventions

- The topology is the primary view; do not turn it into generic dashboard chrome.
- Split Sequencers into **Primary Sequencer** and **Backup Sequencers** panels, using a darker coral for Primary and a lighter coral for Backups.
- Use **Replayer Fabric / Replayers**, **Transport layer / Bridge · Dispatcher · MultiMqApp**, **Persistence & audit / Archiver · Logger**, and **Application Layer / Nodes · Applications**. Keep Link supported by discovery but hidden from the topology and summary for now; render Node before Application.
- Keep the header brand square and aligned. Keep the hero optional through the persistent Hide intro / Show intro control.
- Keep summary and Actor Map on the same responsive gutters. Order summary counts as Sequencer, Backup Sequencers, Replayers, Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, and MultiMqApps. Never show Links; always show MultiMqApps, including at zero.
- Use pictorial Lucide icons, consistent role colors, readable status text, keyboard focus, reduced-motion support, and responsive behavior down to 320 px.
- Actor cards are links that open `/actor/<id>` in a new browser tab. Do not use scripted popups or browser-local actor snapshots.
- Admin output belongs in a bounded monospace area. Actor details show recent audit entries and the global Audit page supports search and outcome filtering.
- Shared topology name, color, polling, and retention changes belong in Settings, not browser storage.

## Security and deployment expectations

- This version has no application authentication or roles. Network reachability equals full operator access.
- Default Docker binding is localhost. Document private LAN, VPN, firewall, TLS, and authenticated reverse-proxy requirements; never imply that public exposure is safe.
- Lifecycle helpers must preserve `coralconsole-data` by default. Never put `down -v`, `volume rm`, or volume pruning in ordinary start/stop scripts.
- Enable `CORAL_TRUST_PROXY` only behind a trusted proxy that overwrites forwarding headers.
- Maintain baseline security headers and confirmation for destructive UI actions.
- Avoid logging database contents, admin payloads, actor output, tokens, or secrets to process logs.
- Keep `/api/health` minimal; do not expose database paths or sensitive configuration.
