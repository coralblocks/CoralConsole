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

Every actor is assumed to provide the baseline admin actions `list`, `actorStatus`, and `healthCheck`; keep them available even if a scoped `list` response temporarily omits one. Only `actorStatus` and scoped `list` are called automatically. `healthCheck` and the legacy `status` action remain available for manual use when selected by an operator, but CoralConsole must never call either automatically. Discovery begins with `list`, then calls `list` with the first non-`VM` scope and `<scope> actorStatus`. Parse the ordered `label: value` actorStatus output into a persisted JSON field list so newly added fields appear without another schema change. Derive known metadata with spacing-, punctuation-, and case-insensitive labels: `name`, `type`, `class`, `open`, `rewinding`, `active`, `disconnected`, `session`, `sequence`, `accounts`, and `clock tick interval`. Derive the separate operational classification in this strict priority: Closed when not open; Disconnected when open and disconnected; Rewinding when open, connected, and rewinding; Active when open, connected, not rewinding, and active; otherwise Inactive. Determine Primary versus Backup Sequencer from the explicit actor type/discovery role, not the operational `active` field. Session identifiers normally use `YYMMDDHHmm`; show both the raw identifier and a readable start time only when the value is a valid timestamp, and otherwise omit the start-time subtitle. Prefer an explicit start time returned by the actor. Coral REST servers may return a non-standard timezone name in the HTTP `Date` header and literal tabs inside JSON strings, so actor calls use Node's tolerant HTTP parser and narrowly repair unescaped JSON control characters.

One process-level scheduler owns actor polling independently of browser tabs. Each open tab reports an ephemeral, session-only viewer lease through `POST /api/presence`; the server prunes missed leases and applies the shared viewer grace period, 90 seconds by default. Unless Settings enables polling without viewers, the scheduler pauses after the last lease and grace period expire, deliberately closes every persistent actor connection without changing actor connectivity, and forces an immediate refresh when a viewer returns. At the single configured polling interval, five seconds by default, it sends `<scope> actorStatus` and then scoped `list` over one dedicated persistent HTTP/HTTPS connection per actor. Actor connectivity has exactly two states: Online and Offline, and only `actorStatus` determines it. A valid `actorStatus` response with `result: true` marks the actor Online and updates Last Response; parseable output also updates metadata, operational state, and the ordered field cache, while missing or unparseable output leaves the previous metadata intact. A transport failure, `result: false`, missing or invalid `result`, or an actor/HTTP error marks it Offline. Scoped `list` refreshes available actions but a list failure must not override a successful actorStatus result. Losing an idle persistent monitoring connection still marks the actor Offline immediately; the next successful actorStatus request establishes a replacement connection and restores Online. The connection has no client-side idle expiry. Initial discovery calls and operator-triggered admin actions use new one-shot connections and close them after each response. Per-actor coordination waits for any active scheduled poll before a manual action, defers new scheduled polls while the action runs, then immediately sends `actorStatus` and scoped `list` over the persistent monitoring connection before releasing the actor. Visible topology and actor-detail views also fetch at the configured interval so the displayed state stays current; server-side throttling consolidates those requests with the scheduler.

## Runtime architecture

- Next.js 16 standalone Node.js server, React 19, and TypeScript.
- Node.js 22 is the minimum supported runtime.
- SQLite with `better-sqlite3`, Drizzle schema, generated SQL migrations, WAL mode, foreign keys, and a five-second busy timeout.
- One installation owns one topology and one SQLite file. Never run multiple application processes against the same file.
- `Dockerfile` is the canonical release package; `docker-compose.yml` is the reference private deployment.
- The reference Compose deployment has two containers: the bridge-networked application is published only on a loopback-only internal port, while a minimal host-network ingress owns the public port. The ingress removes browser-supplied forwarding headers, captures the TCP peer address, and passes that validated address to the application in a private internal header. Linux host networking is required; Docker Desktop 4.34 or newer must have host networking enabled.
- `better-sqlite3` may compile from source on Linux ARM64. Keep Python 3, `make`, and `g++` in the Docker dependency-build stage only; do not add compilers to the final runtime stage. Keep all Docker stages on Debian Trixie so the runtime provides the glibc and libstdc++ versions required by the packaged ARM64 native module.
- The persistent database is `/data/coralconsole.db` in Docker and `.data/coralconsole.db` in local development unless `DATABASE_PATH` overrides it.
- Migrations run both through `scripts/migrate.mjs` at container startup and defensively when the application opens the database.
- Demo data is off by default and enabled only by `CORAL_DEMO_MODE=true`.

## Data ownership and persistence

- `topology_settings` stores the singleton shared name, color, actor polling interval, idle-polling policy, viewer grace period, retention, summary-count visibility, and first-run status.
- `actors` stores endpoint, discovered identity, type, Online/Offline connectivity, the separate operational state, actions, the full ordered actorStatus field list, derived common metadata, per-type precedence order, and timestamps. Host plus port is unique. `sort_order` is scoped to `kind`; ordering actors across different kinds has no meaning. The legacy SQL column name `status_responded_at` records the latest successful actorStatus response time.
- The legacy-named `command_audit` table stores the actor snapshot, scoped admin action, parameters, plain-text output, four-state outcome, error, duration, timestamp, requester IP, and truncation state. In the reference Compose deployment, new manual actions record the TCP peer address observed by the trusted host-network ingress; client-supplied forwarding headers cannot override it. Legacy or unavailable addresses are persisted as `N/A`. Actor deletion retains audit rows with a null actor reference.
- Audit parameters are capped at 8 KiB and output at 256 KiB. Older rows are purged according to the shared retention setting.
- `localStorage` is device-specific only: `coral-console-intro` stores intro visibility. `coral-console-actors` is a legacy import source and must not become the canonical topology again.
- Never send topology, actor, admin action, or audit data to an external service.

## API and REST admin contract

The same-origin API surface is:

- `GET/PATCH /api/settings`
- `GET/POST /api/actors`
- `GET/PATCH/DELETE /api/actors/<id>`
- `PATCH /api/actors/order` with one actor `kind` and every current actor ID of that kind in the desired order
- `POST /api/actors/<id>/refresh`
- `POST /api/actors/refresh`
- `POST /api/actors/<id>/actions`
- `POST /api/presence`
- `GET /api/audit`
- `GET /api/health`

Admin actions accept an actor ID, action name, and parameters. The server must resolve the stored actor endpoint; never reintroduce a client-supplied arbitrary relay route. Validate same-origin mutations, keep the actor timeout at 6.5 seconds, and render actor results only as plain text.

The singular boolean `result` in an actor reply is authoritative. Persist one of four audit outcomes: `success` for a valid response with `result: true`; `failure` for a valid response with `result: false`; `error` for a malformed response, missing or non-boolean `result`, actor error, or non-2xx HTTP response; and `unreachable` when no usable HTTP response arrives because of refusal, reset, timeout, DNS, TLS, or another transport failure. The plural `results` field is output text only and must never determine the outcome.

Actors receive JSON shaped as:

```json
{
  "adminCommand": "list",
  "params": ""
}
```

The optional `shouldLog` boolean defaults to `true` at the actor. Omit it for discovery and operator-triggered admin actions, including manually selected `healthCheck`. Server-driven monitoring requests over the persistent actor connection—`actorStatus` and scoped `list`, including post-action reconciliation—must send `"shouldLog": false` so routine polling does not fill actor logs.

## Code structure

- `app/page.tsx` owns the shared topology UI, first-run settings, refresh polling, add-actor flow, and one-time browser migration.
- `app/actor-ui.tsx` owns shared actor labels, icons, and UI metadata.
- `app/actors/` renders the dedicated actor registry tab for endpoint editing, persisted drag ordering, and confirmed deletion.
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
- `npm run version:set -- A.B.C` — validate and set the shared CoralConsole application version in `package.json` and `package-lock.json`.
- `npm run db:generate` — generate a migration after an intentional schema change.
- `npm run db:migrate` — migrate the configured local database.
- `npm run docker:start` / `npm run docker:stop` — start or stop the reference container while preserving its named volume.
- `npm run docker:build` — intentionally rebuild the local image after code changes.
- `npm run docker:backup` — create and verify a timestamped online SQLite backup without stopping the application.
- `npm run docker:dev:start` / `npm run docker:dev:stop` — run or stop the bind-mounted Next.js development container with hot reload and the shared Docker data volume.
- `npm run docker:dev:rebuild` — rebuild development dependencies after package or `Dockerfile.dev` changes.
- `npm run docker:release` — build the current source into the production image and replace development mode with the production container while preserving the data volume.
- `npm run docker:status` / `npm run docker:logs` — inspect the reference container.
- `./scripts/git-merge-to-main.sh` — interactively merge the current clean feature branch into an up-to-date `main` and push `origin/main`; never run this helper unless the user explicitly asks for the merge.

Use the existing npm lockfile. Commit schema changes and their generated migration together. Validate substantive changes with `npm run lint` and `npm test`; smoke-test Docker when deployment files or native dependencies change.

Use a fast path for isolated, predictably low-risk presentation tweaks such as changing a single font size, color, spacing value, or short piece of static copy. Make the focused edit, inspect the exact diff, perform only the targeted check needed for the affected UI, and commit promptly. Do not automatically run the full build, API persistence suite, Docker rebuild, and exhaustive browser workflow for these changes. Escalate to broader validation when the tweak affects behavior, data, APIs, schemas, deployment, responsive structure, shared layout logic, or has a meaningful chance of unpredictable results.

Prefer `docker:dev:start` during iterative UI work so source edits hot-reload without production image rebuilds. Rebuild the development image only when its dependencies or Dockerfile change. Run `docker:release` once when approved source needs to become the production container; ordinary production restarts with unchanged source use `docker:start` and do not rebuild.

The raw TCP mock actor in the integration suite must handle `ECONNRESET` and `EPIPE` as normal peer teardown while continuing to fail on every other socket error. Do not mask application failures with broad retries.

## Git workflow

- Work directly on `main` and push completed changes to `origin/main` after validation.
- Do not create pull requests or temporary branches unless the user explicitly requests them for a specific change.
- The current internal-deployment work uses `feature/internal-deployment` because the user explicitly requested a new branch.
- Before committing, inspect the exact diff and avoid staging unrelated or sensitive files.
- Use short, descriptive commit messages and keep the working tree clean after pushing.

## UI conventions

- The topology is the primary view; do not turn it into generic dashboard chrome.
- Split Sequencers into **Primary Sequencer** and **Backup Sequencers** panels, using a darker coral for Primary and a lighter coral for Backups.
- Render Actor Map panels as a single full-width stack in this fixed order: **Primary Sequencer**, **Backup Sequencers**, **Replayers**, **Persistence & audit**, **Transport layer**, and **Application Layer**. Inside every panel, keep a two-column actor-card grid; a single actor occupies one column and never expands across both.
- Use **Replayer Fabric / Replayers**, **Transport layer / Bridge · Dispatcher · MultiMqApp**, **Persistence & audit / Archiver · Logger**, and **Application Layer / Nodes · Applications**. Keep Link supported by discovery but hidden from the topology, summary, and add-actor supported-type list for now; render Node before Application.
- Fill Actor Map card grids from left to right and then downward. Within a mixed-type panel, order types as Archiver then Logger; Bridge then Dispatcher then MultiMqApp; and Node then Application. Within each type, use its SQLite-persisted `sort_order`.
- Render every Actor Map panel count circle as a subtle interactive link to `/actors` that opens the actor registry in a new tab.
- Keep the header brand square and aligned. Keep the hero optional through the persistent Hide intro / Show intro control.
- Render the version from `package.json` beside the CoralConsole name in the shared brand and footer. The root layout owns the shared footer so every page receives it automatically.
- Keep summary and Actor Map on the same responsive gutters. Order summary counts as Sequencer, Backup Sequencers, Replayers, Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, and MultiMqApps. Never show Links. Show all other actor types, including MultiMqApps at zero, by default; Settings may independently hide any of these counts without changing actor visibility elsewhere. Never render more than three actor-type count cells per row.
- Keep Add Actor, List Actors, and Refresh Now together in that order at the upper right of the Actor Map, using the same lightweight ghost-button treatment. List Actors opens `/actors` in a new tab with no back link. Keep a global Add Actor button aligned to the right of the List Actors heading so discovery remains available when the registry is empty. Group the registry into one cohesive section per actor type, with the topology’s matching role icon and color in a compact section header above the table; each table’s columns are Name, Class, REST IP, PORT, Online?, Edit, and Remove. Place a role-colored Add Actor button at the top right of every type section and open the shared actor-discovery dialog from it. Actor precedence can only be changed within the same type. Keep each table fluid and fully visible at tablet widths, and turn each semantic row into a complete stacked card on small screens rather than relying on horizontal scrolling. Reserve a fixed-height, role-colored feedback slot between the type identity and Add Actor button so confirmations never move its table; all confirmations begin fading and disappear after seven seconds. Endpoint edits, removals, actor additions, and per-type row ordering persist in SQLite, endpoint edits close the actor’s old monitoring connection, editing disables every Remove action, no-op drags do not save, and removals require confirmation.
- Actor type counts and System Pulse always occupy separate full-width rows. System Pulse shows Online and Offline counts alongside Closed, Rewinding, Active, Inactive, and Disconnected counts using their established state colors and centered cell content. Its connected-to-Sequencer total includes only Online actors that are neither Closed nor Disconnected; use singular “Actor” when a headline count is one. Its footer shows the total number of actors added to CoralConsole immediately before Active Session, separated by a solid vertical divider. Its icon selects All Actors and anchors the panel to the viewport top, while its summaries and count cells select the corresponding animated Actor Map filter.
- Use pictorial Lucide icons, consistent role colors, readable status text, keyboard focus, reduced-motion support, and responsive behavior down to 320 px.
- Use the same two-column actor-card grid in every full-width topology group. A single actor remains one column wide; additional actors fill rows from left to right.
- Actor cards are links that open `/actor/<id>` in a new browser tab. Do not use scripted popups or browser-local actor snapshots.
- Because actor details open in a dedicated tab, their header does not include a redundant Back to topology link.
- Every actor card is concise and type-independent: icon, actor/account name, sequence immediately to the name's right, class, and operational-state badge only. Show `?` instead of the last sequence on an Offline topology card, while Actor Details keeps the last recorded sequence. Do not show an Online/Offline dot on topology cards; preserve connectivity in the accessible card label. Never add endpoint, session, accounts, clock tick, signal, or footer metadata below the icon.
- Keep operational-state badge text bold and comfortably legible in both topology cards and Actor Details. The topology card's sequence and class, plus the Actor Details type line, must also remain readable at their compact sizes.
- Keep each topology group's actor count clearly legible inside its circular count bubble.
- Give every Offline actor card a visible background of thin diagonal coral-red stripes; keep Online actor cards on the normal unpatterned panel background.
- Every actor detail table starts with REST Endpoint and Last Response, then renders every ordered field returned by actorStatus in two columns. Labels are uppercase through presentation styling and values retain their returned case. Last Response is an absolute timestamp updated only after a successful `actorStatus` admin action; manually selected healthCheck and list actions must not change it.
- Every actor detail header provides a compact, lightly actor-tinted Refresh actor status control beside the actor name. It runs an immediate coordinated `actorStatus`/`list` poll for only that actor with `shouldLog: false`, updates the cached actor, and does not create an audit row.
- Every topology card and actor detail header shows the operational-state badge as Unknown whenever the actor is Offline, without overwriting its last persisted operational state. When Online, show Active, Inactive, Closed, Rewinding, or Disconnected with distinct cyan, neutral gray, coral, violet, and amber treatments respectively. The detail header places this badge immediately to the left of its separate Online/Offline connectivity badge; keep that connectivity badge on the detail page and apply the diagonal coral-red stripe pattern to the full header when Offline.
- Actor Map filters appear in this exact order: All Actors, Online, Offline, Closed, Rewinding, Active, Inactive, Disconnected. Connectivity filters use Online/Offline, while operational filters use the displayed state; an Offline actor displayed as Unknown must not match a stale operational-state filter.
- System Pulse count labels use uppercase `ONLINE` and `OFFLINE`. Keep Actor Map's `Refresh Now` control in the topology header's upper-right corner, above the filter row. It immediately polls `actorStatus` and scoped `list` for every actor, bypassing the normal interval without running `healthCheck` or creating audit rows.
- Admin output belongs in a bounded monospace area. Actor details show recent audit entries and the global Audit page supports search by source IP and other record fields plus outcome filtering. Treat unquoted search words as required terms that may match across different fields; preserve quoted text as one phrase. Audit links open this page in a dedicated tab with no redundant Back to topology control. The audit history is not periodically auto-refreshed and cannot be manually cleared through the interface or API; configured age-based retention remains the only deletion mechanism.
- Shared topology name, color, actor polling interval, idle-polling policy, viewer grace period, retention, and summary-count visibility changes belong in Settings and SQLite, not browser storage.

## Security and deployment expectations

- This version has no application authentication or roles. Network reachability equals full operator access.
- Default Docker binding is localhost. Document private LAN, VPN, firewall, TLS, and authenticated reverse-proxy requirements; never imply that public exposure is safe.
- Lifecycle helpers must preserve `coralconsole-data` by default. Never put `down -v`, `volume rm`, or volume pruning in ordinary start/stop scripts.
- Backup helpers must use SQLite's online backup API, verify integrity, avoid copying a live database file directly, and never apply automatic retention deletion.
- Keep the application’s internal port bound to loopback. The trusted ingress header is an internal handoff and must never be exposed directly to remote clients.
- Enable `CORAL_TRUST_PROXY` only for a custom non-Compose deployment behind a trusted proxy that overwrites forwarding headers. The reference Compose ingress deliberately ignores those headers and records its TCP peer.
- Maintain baseline security headers and confirmation for destructive UI actions.
- Avoid logging database contents, admin payloads, actor output, tokens, or secrets to process logs.
- Keep `/api/health` minimal; do not expose database paths or sensitive configuration.
