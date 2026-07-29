# CoralConsole

CoralConsole is a colorful operations console for discovering, organizing, and
administering actors in a
[CoralSequencer](https://www.coralblocks.com/sequencer) distributed system.
It gives operators one live view of every actor, its connectivity, operational
state, and available REST admin actions.

![CoralConsole topology overview](public/og-v2.png)

![CoralConsole application screenshot](docs/images/coralconsole-dashboard.png)

## Purpose

[CoralSequencer](https://www.coralblocks.com/sequencer) systems are composed of a
central Sequencer and surrounding actors such as Backup Sequencers, Replayers,
Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, and MultiMqApps.
CoralConsole discovers those processes, organizes them by role, monitors them,
and provides a single place for operators to inspect and administer the
deployment.

## Features

- Live System Pulse with Online, Offline, Closed, Rewinding, Active, Inactive,
  and Disconnected counts.
- Filterable Actor Map organized by system layer and actor type.
- Automatic actor discovery from a host/IP address and REST admin port.
- Server-side monitoring that polls each actor with `actorStatus` and `list`
  over a dedicated persistent connection.
- One home-page browser refresh request retrieves current information for the
  complete topology, regardless of the number of actors.
- Dedicated actor pages with complete status fields and manual REST admin
  actions.
- Actor registry with endpoint editing, removal, and persisted precedence
  ordering within each actor type.
- Protected, searchable audit history for manual actions, including outcome,
  duration, output, timestamp, and requester IP when available.
- Persistent topology settings, configurable polling, audit retention, and
  actor count visibility.
- Clear stale-interface warnings when the browser loses contact with the
  CoralConsole server.
- SQLite persistence, a verified backup script that runs without stopping
  CoralConsole, and Docker deployment.
- No external telemetry; topology, actor, action, and audit data remain inside
  CoralConsole.

## How it works

The browser communicates only with the CoralConsole server. At each UI refresh
interval, the home page makes one HTTP request for the complete topology. It
never sends one request per actor and never contacts actor REST endpoints
directly.

Separately, the server monitors every actor at the configured actor polling
interval. For each actor, it calls `actorStatus` to update connectivity and
operational state, then `list` to update the available actions. These calls reuse
a dedicated persistent connection for that actor.

The browser and server timers are independent, but server-side throttling
consolidates their work. A browser refresh receives the current stored topology
when actor data is still fresh; when a refresh is due, it can join or initiate
the same server-side monitoring operation. Multiple browser tabs do not multiply
actor polling.

When an actor is added, the server contacts its endpoint to discover its
identity, role, and actions before saving it. Manual admin actions use separate
one-shot connections and are recorded in the audit history.

One CoralConsole installation owns one topology and one database. Every browser
connected to that installation sees the same actors and settings.

## Installation

**Under Construction**

## License

Licensed under the [Apache License 2.0](./LICENSE).
