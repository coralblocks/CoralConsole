# CoralConsole — Agent Guide

## Purpose

This repository is the local-first web console for Coral Sequencer deployments. Treat the sequencer as the centralized source of truth and every surrounding process as an actor with a REST admin endpoint. The interface should help an operator understand topology, health, identity, and available admin actions at a glance.

Keep this file current whenever the architecture, scripts, discovery rules, persistence model, or testing expectations change.

The approved future shared-persistence and internal Docker deployment design is saved in [INTERNAL_DEPLOYMENT_PLAN.md](./INTERNAL_DEPLOYMENT_PLAN.md). Keep the current local-first implementation stable until that plan is explicitly resumed.

## Product model and actor types

- Sequencer: the single active source of truth that orders and timestamps the system's messages. A deployment may have zero or one active Sequencer.
- Backup Sequencer: a standby source-of-truth actor that can take over during failover. A deployment may have any number of Backup Sequencers.
- Replayer: may run in a cluster; catches nodes up from persisted messages.
- Bridge, Dispatcher, Link, and MultiMqApp: transport and fan-out actors.
- Archiver and Logger: persistence, audit, and observability actors.
- Application and Node: customer-built actors that publish and consume messages.
- Every actor is identified initially by a host/IP and REST admin port.

The exact supported actor types are Sequencer, Backup Sequencer, Replayer, Archiver, Logger, Bridge, Dispatcher, Node, Application, Link, and MultiMqApp. Use this title casing in the interface; do not display the type names as all-uppercase labels.

Actors expose the same admin commands available over telnet through HTTP POST. Discovery begins with `list`, then calls `list` with the first non-`VM` scope returned by the actor. The UI derives a role, name, class hint, and command list from those responses. For a Sequencer or Backup Sequencer with a `status` action, discovery also calls `<scope> status` to determine Primary/Backup state and the active session. Classify a standby or failover sequencer as Backup Sequencer while preserving a graceful Node fallback for unfamiliar/custom actor types.

Sequencer session identifiers normally use `YYMMDDHHmm`, for example `2607171725`. Decode that identifier as the session start time and display both the raw session and a readable timestamp. Prefer an explicit start time returned by the Sequencer when the REST response provides one.

## REST admin contract

Send JSON with this shape to the actor's REST admin root:

```json
{
  "adminCommand": "list",
  "params": ""
}
```

A normal response includes `result`, `adminCommand`, `params`, and `results`. Error responses may contain only `error`. Treat `results` as plain text and never render it as HTML.

Browser calls go through `app/api/actor/route.ts` so local usage is not blocked by actor CORS settings. Keep the relay narrowly scoped to a user-supplied HTTP(S) host and numeric port, maintain a short timeout, and never log admin payloads or actor output. Do not add cloud persistence or transmit topology data outside the local console without an explicit product decision.

## Stack and structure

- Vinext/Vite with the Next-compatible `app` directory.
- React 19 and TypeScript.
- Plain global CSS in `app/globals.css`; Tailwind is available but the product does not depend on utility classes.
- `app/page.tsx` owns the topology, local state, and actor discovery.
- `app/actor-ui.tsx` owns shared actor types, icon metadata, REST calls, and per-actor detail snapshots.
- `app/actor/[id]/` renders the dedicated actor detail tab and owns the command runner.
- `app/api/actor/route.ts` is the local REST relay.
- User-added actors persist in `localStorage` under `coral-console-actors`.
- Actor cards save a current per-actor snapshot under `coral-console-actor:<id>` so the detail route can load in a separate same-origin browser tab.
- Intro visibility persists in `localStorage` under `coral-console-intro`.
- Demo actors are static fixtures and must remain clearly labeled; their commands are simulated. Keep representative Sequencer, Backup Sequencer, Replayer, Bridge, Dispatcher, Archiver, Logger, Application, and Node examples.

## Commands

- `npm run dev` — run the local console.
- `npm run build` — produce the deployable worker build.
- `npm test` — build, then run rendered-output and repository guard tests.
- `npm run lint` — run ESLint when code changes warrant it.

Use the existing npm lockfile and package manager. Keep Cloudflare Worker compatibility: route handlers should rely on web-standard APIs rather than Node-only modules.
After adding or changing a client dependency, restart the development server so Vite re-optimizes the lockfile before relying on hot reload. Verify that both `/` and the transformed `/app/page.tsx` development module return successfully.

## UI conventions

- The topology is the product's primary view; do not turn it into generic dashboard chrome.
- Split the **Sequencer Fabric** into separate **Primary Sequencer** and **Backup Sequencers** panels. Use a visibly darker coral for the Primary and a visibly lighter coral for Backups.
- Use **Replayer Fabric / Replayers**, **Transport layer / Bridge · Dispatcher · MultiMqApp**, **Persistence & audit / Archiver · Logger**, and **Application Layer / Nodes · Applications** for the remaining groups. Keep Link supported by discovery but hidden from the topology and summary for now; render Node cards before Application cards.
- Use role colors consistently: darker coral for Sequencer, lighter coral for Backup Sequencer, cyan for Replayer, blue/green/pink for transport actors, amber/slate for persistence actors, and violet for Application and Node.
- Keep the header brand mark square and perfectly aligned; do not rotate or skew it.
- The introductory hero must remain optional through a persistent Hide intro / Show intro control.
- Keep the operational summary outside the optional hero so hiding the intro never hides System Pulse, actor counts, health totals, or the active session.
- Align the operational summary and Actor Map to the same responsive outer gutters.
- Order summary counts as Sequencer, Backup Sequencers, Replayers, Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, and MultiMqApps. Never show Links in the summary; always show MultiMqApps, including at zero. Use the singular Sequencer label and plural labels for every other summary category.
- Use the established pictorial icon component for every actor type in summary tiles, actor cards, and the inspector. Do not fall back to two-letter abbreviations. Sequencer and Backup Sequencer share the same central-hub icon but retain different role colors; Bridge uses a connected-points icon and Dispatcher uses a shared-memory icon.
- Give Replayer, Transport, Persistence, and Application topology groups subtle backgrounds and borders derived from their role colors, matching the treatment of Sequencer Fabric without reducing card contrast.
- Health must never rely on color alone; include text, status labels, and clear disabled states.
- Keep the topology full-width without an inline actor inspector. Actor cards are normal links that open `/actor/<id>` in a new browser tab; do not use scripted popups. Admin actions belong in that dedicated detail view. Always show the exact target actor and return result text in a bounded monospace area.
- The actor inspector must inherit the selected actor type's color; do not hard-code the Sequencer/coral color on the inspector.
- Preserve responsive behavior down to 320 px, keyboard focus visibility, reduced-motion support, and semantic labels.
- Prefer CSS shapes, typography, and the installed Lucide icon system over decorative asset files. Do not add model-authored inline SVG artwork.

## Change expectations

- Do not discard existing local actor configuration during ordinary UI updates.
- Keep discovery tolerant of new admin scopes and class names.
- If command scoping rules change, update both discovery and execution paths together.
- Validate with `npm run build` after implementation changes. Update tests when intentional product copy or structure changes.
- When adding server-side persistence later, document migrations, data ownership, and the local-to-hosted transition here before implementation.
