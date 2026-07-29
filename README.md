# CoralConsole

CoralConsole is a colorful operations console for discovering, organizing, and
administering actors in a
[CoralSequencer](https://www.coralblocks.com/coralsequencer) distributed system.
It gives operators one live view of every actor, its connectivity, operational
state, and available REST admin actions.

![CoralConsole topology overview](public/og-v2.png)

![CoralConsole application screenshot](docs/images/coralconsole-dashboard.png)

## Purpose

Coral Sequencer systems are composed of a central Sequencer and surrounding
actors such as Backup Sequencers, Replayers, Archivers, Loggers, Bridges,
Dispatchers, Nodes, Applications, and MultiMqApps. CoralConsole discovers those
processes, organizes them by role, monitors them, and provides a single place for
operators to inspect and administer the deployment.

## Features

- Live System Pulse with Online, Offline, Closed, Rewinding, Active, Inactive,
  and Disconnected counts.
- Filterable Actor Map organized by system layer and actor type.
- Automatic actor discovery from a host/IP address and REST admin port.
- Periodic `actorStatus` and `list` polling with persistent per-actor monitoring
  connections.
- Dedicated actor pages with complete status fields and manual REST admin
  actions.
- Shared actor registry with endpoint editing, removal, and persisted precedence
  ordering within each actor type.
- Protected, searchable audit history for manual actions, including outcome,
  duration, output, timestamp, and requester IP when available.
- Shared topology settings, configurable polling, audit retention, and actor
  count visibility.
- Clear stale-interface warnings when the browser loses contact with the
  CoralConsole server.
- SQLite persistence, online backup support, and Docker deployment.
- No external telemetry or topology data sharing.

## How it works

The browser communicates only with the CoralConsole server. The server discovers
and contacts actor REST endpoints, runs scheduled monitoring, executes manual
admin actions, and stores the shared topology and audit history in SQLite.

Discovery starts with `list`, selects the actor scope, and calls
`<scope> actorStatus`. Scheduled monitoring uses `actorStatus` to determine
Online or Offline state and `list` to refresh available actions. Manual actions
use separate one-shot connections and are recorded in the audit history.

One CoralConsole installation owns one topology and one database. Every browser
connected to that installation sees the same actors and settings.

## Installation

**Under Construction**

## License

Licensed under the [Apache License 2.0](./LICENSE).
