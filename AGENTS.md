# CoralConsole — Agent Guide

## Purpose

This repository is the shared internal web console for Coral Sequencer deployments. Treat the Sequencer as the centralized source of truth and every surrounding process as an actor with a REST admin endpoint. The interface should help an operator understand topology, connectivity, operational state, identity, and available admin actions at a glance.

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

Every actor is assumed to provide the baseline admin actions `list`, `actorStatus`, and `healthCheck`; keep them available and poll them even if a scoped `list` response temporarily omits one. The legacy `status` action may remain available when advertised for manual use, but CoralConsole must never call it automatically. Discovery begins with `list`, then calls `list` with the first non-`VM` scope and `<scope> actorStatus`. Parse the ordered `label: value` actorStatus output into a persisted JSON field list so newly added fields appear without another schema change. Derive known metadata with spacing-, punctuation-, and case-insensitive labels: `name`, `type`, `class`, `open`, `rewinding`, `active`, `disconnected`, `session`, `sequence`, `accounts`, and `clock tick interval`. Derive the separate operational classification in this strict priority: Closed when not open; Disconnected when open and disconnected; Rewinding when open, connected, and rewinding; Active when open, connected, not rewinding, and active; otherwise Inactive. Determine Primary versus Backup Sequencer from the explicit actor type/discovery role, not the operational `active` field. Session identifiers normally use `YYMMDDHHmm`; show both the raw identifier and a readable start time only when the value is a valid timestamp, and otherwise omit the start-time subtitle. Prefer an explicit start time returned by the actor. Coral REST servers may return a non-standard timezone name in the HTTP `Date` header and literal tabs inside JSON strings, so actor calls use Node's tolerant HTTP parser and narrowly repair unescaped JSON control characters.

One process-level scheduler owns actor polling independently of browser tabs. Each open tab reports an ephemeral, session-only viewer lease through `POST /api/presence`; the server prunes missed leases and applies the shared viewer grace period, 90 seconds by default. Unless Settings enables polling without viewers, the scheduler pauses after the last lease and grace period expire, deliberately closes every persistent actor connection without changing actor connectivity, and forces an immediate refresh when a viewer returns. It sends `<scope> actorStatus` and then scoped `list` over one dedicated persistent HTTP/HTTPS connection per actor at the configured actor-status interval, 30 seconds by default. A separate heartbeat sends `<scope> healthCheck` over that same connection at the configured health-check interval, five seconds by default. Actor connectivity has exactly two states: Online and Offline. A successful heartbeat requires the standard `result: true` response and a `results` string that starts with `ALIVE`; do not require a particular suffix such as `and OPEN`. Any heartbeat failure—including transport failure, `result: false`, an invalid result, an actor/HTTP error, or output that does not start with `ALIVE`—marks the actor Offline; the next successful heartbeat marks it Online. ActorStatus and list refreshes update metadata, operational state, the ordered field cache, and available actions without overriding heartbeat-derived connectivity, although losing the persistent monitoring connection immediately marks the actor Offline. The connection has no client-side idle expiry, and the next scheduled request may establish its replacement after a failure. Initial discovery calls and operator-triggered admin actions use new one-shot connections and close them after each response. Per-actor coordination waits for any active scheduled check before a manual action, defers new scheduled checks while the action runs, then immediately sends `healthCheck`, `actorStatus`, and scoped `list` over the persistent monitoring connection before releasing the actor. Visible topology and actor-detail views also fetch at those intervals so the displayed state stays current; server-side throttling consolidates those requests with the scheduler.

## Runtime architecture

- Next.js 16 standalone Node.js server, React 19, and TypeScript.
- Node.js 22 is the minimum supported runtime.
- SQLite with `better-sqlite3`, Drizzle schema, generated SQL migrations, WAL mode, foreign keys, and a five-second busy timeout.
- One installation owns one topology and one SQLite file. Never run multiple application processes against the same file.
- `Dockerfile` is the canonical release package; `docker-compose.yml` is the reference private deployment.
- `better-sqlite3` may compile from source on Linux ARM64. Keep Python 3, `make`, and `g++` in the Docker dependency-build stage only; do not add compilers to the final runtime stage. Keep all Docker stages on Debian Trixie so the runtime provides the glibc and libstdc++ versions required by the packaged ARM64 native module.
- The persistent database is `/data/coralconsole.db` in Docker and `.data/coralconsole.db` in local development unless `DATABASE_PATH` overrides it.
- Migrations run both through `scripts/migrate.mjs` at container startup and defensively when the application opens the database.
- Demo data is off by default and enabled only by `CORAL_DEMO_MODE=true`.

## Data ownership and persistence

- `topology_settings` stores the singleton shared name, color, actor-status and health-check intervals, idle-polling policy, viewer grace period, retention, summary-count visibility, and first-run status.
- `actors` stores endpoint, discovered identity, type, Online/Offline connectivity, the separate operational state, actions, the full ordered actorStatus field list, derived common metadata, and timestamps. Host plus port is unique. The legacy SQL column name `status_responded_at` records the latest successful actorStatus response time.
- The legacy-named `command_audit` table stores the actor snapshot, scoped admin action, parameters, plain-text output, four-state outcome, error, duration, timestamp, source IP (when trusted), and truncation state. Actor deletion retains audit rows with a null actor reference.
- Audit parameters are capped at 8 KiB and output at 256 KiB. Older rows are purged according to the shared retention setting.
- `localStorage` is device-specific only: `coral-console-intro` stores intro visibility. `coral-console-actors` is a legacy import source and must not become the canonical topology again.
- Never send topology, actor, admin action, or audit data to an external service.

## API and REST admin contract

The same-origin API surface is:

- `GET/PATCH /api/settings`
- `GET/POST /api/actors`
- `GET/DELETE /api/actors/<id>`
- `POST /api/actors/<id>/refresh`
- `POST /api/actors/refresh`
- `POST /api/actors/health`
- `POST /api/actors/<id>/actions`
- `POST /api/presence`
- `GET/DELETE /api/audit`
- `GET /api/health`

Admin actions accept an actor ID, action name, and parameters. The server must resolve the stored actor endpoint; never reintroduce a client-supplied arbitrary relay route. Validate same-origin mutations, keep the actor timeout at 6.5 seconds, and render actor results only as plain text.

The singular boolean `result` in an actor reply is authoritative. Persist one of four audit outcomes: `success` for a valid response with `result: true`; `failed` for a valid response with `result: false`; `error` for a malformed response, missing or non-boolean `result`, actor error, or non-2xx HTTP response; and `unreachable` when no usable HTTP response arrives because of refusal, reset, timeout, DNS, TLS, or another transport failure. The plural `results` field is output text only and must never determine the outcome.

Actors receive JSON shaped as:

```json
{
  "adminCommand": "list",
  "params": ""
}
```

The optional `shouldLog` boolean defaults to `true` at the actor. Omit it for discovery and operator-triggered admin actions. Server-driven monitoring requests over the persistent actor connection—`list`, `actorStatus`, and `healthCheck`, including post-action reconciliation—must send `"shouldLog": false` so routine polling does not fill actor logs.

## Code structure

- `app/page.tsx` owns the shared topology UI, first-run settings, refresh polling, add-actor flow, and one-time browser migration.
- `app/actor-ui.tsx` owns shared actor labels, icons, and UI metadata.
- `app/actor/[id]/` loads direct actor details from SQLite and runs audited admin actions in a dedicated tab.
- `app/audit/` renders searchable global admin action history.
- `app/viewer-presence.tsx` owns per-tab presence heartbeats and best-effort departure reporting.
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
- `npm run docker:backup` — create and verify a timestamped online SQLite backup without stopping the application.
- `npm run docker:status` / `npm run docker:logs` — inspect the reference container.
- `./scripts/git-merge-to-main.sh` — interactively merge the current clean feature branch into an up-to-date `main` and push `origin/main`; never run this helper unless the user explicitly asks for the merge.

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
- Use **Replayer Fabric / Replayers**, **Transport layer / Bridge · Dispatcher · MultiMqApp**, **Persistence & audit / Archiver · Logger**, and **Application Layer / Nodes · Applications**. Keep Link supported by discovery but hidden from the topology, summary, and add-actor supported-type list for now; render Node before Application.
- Keep the header brand square and aligned. Keep the hero optional through the persistent Hide intro / Show intro control.
- Keep summary and Actor Map on the same responsive gutters. Order summary counts as Sequencer, Backup Sequencers, Replayers, Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, and MultiMqApps. Never show Links. Show all other actor types, including MultiMqApps at zero, by default; Settings may independently hide any of these counts without changing actor visibility elsewhere.
- Use pictorial Lucide icons, consistent role colors, readable status text, keyboard focus, reduced-motion support, and responsive behavior down to 320 px.
- Use the same full-width actor-card layout in every topology group; multiple actors stack within their group rather than switching non-Sequencer types to narrower cards.
- Actor cards are links that open `/actor/<id>` in a new browser tab. Do not use scripted popups or browser-local actor snapshots.
- Because actor details open in a dedicated tab, their header does not include a redundant Back to topology link.
- Every actor card is concise and type-independent: icon, actor/account name, sequence immediately to the name's right, class, and operational-state badge only. Show `?` instead of the last sequence on an Offline topology card, while Actor Details keeps the last recorded sequence. Do not show an Online/Offline dot on topology cards; preserve connectivity in the accessible card label. Never add endpoint, session, accounts, clock tick, signal, or footer metadata below the icon.
- Give every Offline actor card a visible background of thin diagonal coral-red stripes; keep Online actor cards on the normal unpatterned panel background.
- Every actor detail table starts with REST Endpoint and Last Response, then renders every ordered field returned by actorStatus in two columns. Labels are uppercase through presentation styling and values retain their returned case. Last Response is an absolute timestamp updated only after a successful `actorStatus` admin action; health checks and list calls must not change it.
- Every actor detail header provides a compact, lightly actor-tinted Refresh actor status control beside the actor name. It runs an immediate coordinated `actorStatus`/`list` poll for only that actor with `shouldLog: false`, updates the cached actor, and does not create an audit row.
- Every topology card and actor detail header shows the operational-state badge as Unknown whenever the actor is Offline, without overwriting its last persisted operational state. When Online, show Active, Inactive, Closed, Rewinding, or Disconnected with distinct cyan, neutral gray, coral, violet, and amber treatments respectively. The detail header places this badge immediately to the left of its separate Online/Offline connectivity badge; keep that connectivity badge on the detail page and apply the diagonal coral-red stripe pattern to the full header when Offline.
- System Pulse count labels use uppercase `ONLINE` and `OFFLINE`. Actor Map's Refresh now control immediately polls `actorStatus` and scoped `list` for every actor, bypassing the normal interval without running `healthCheck` or creating audit rows.
- Admin output belongs in a bounded monospace area. Actor details show recent audit entries and the global Audit page supports search and outcome filtering.
- Shared topology name, color, actor-status and health-check polling, idle-polling policy, viewer grace period, retention, and summary-count visibility changes belong in Settings and SQLite, not browser storage.

## Security and deployment expectations

- This version has no application authentication or roles. Network reachability equals full operator access.
- Default Docker binding is localhost. Document private LAN, VPN, firewall, TLS, and authenticated reverse-proxy requirements; never imply that public exposure is safe.
- Lifecycle helpers must preserve `coralconsole-data` by default. Never put `down -v`, `volume rm`, or volume pruning in ordinary start/stop scripts.
- Backup helpers must use SQLite's online backup API, verify integrity, avoid copying a live database file directly, and never apply automatic retention deletion.
- Enable `CORAL_TRUST_PROXY` only behind a trusted proxy that overwrites forwarding headers.
- Maintain baseline security headers and confirmation for destructive UI actions.
- Avoid logging database contents, admin payloads, actor output, tokens, or secrets to process logs.
- Keep `/api/health` minimal; do not expose database paths or sensitive configuration.
