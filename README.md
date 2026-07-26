# CoralConsole

CoralConsole is a colorful, shared operations console for discovering, organizing, and administering actors in a [Coral Sequencer](https://www.coralblocks.com/coralsequencer) distributed system.

![CoralConsole topology overview](public/og-v2.png)

> **Project status:** early development. Run CoralConsole only on a trusted private network. This release has no application login; anyone who can reach its URL can change the topology and run available actor admin actions.

## What it does

- Discovers an actor from its host/IP address and REST admin port.
- Organizes Sequencers, Backup Sequencers, Replayers, Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, Links, and MultiMqApps by operational role.
- Stores one shared topology in SQLite, so every browser sees the same actors and configuration.
- Refreshes actor health every 30 seconds by default, with visibility-aware polling and manual refresh.
- Opens each actor in a dedicated browser tab for REST admin actions.
- Records admin action inputs, outputs, outcome, duration, timestamp, and source IP when trusted proxy headers are enabled.
- Runs as a self-contained Node.js server or Docker container without sending topology data to an external service.

## Quick start with Docker

Requirements: Docker Engine with Docker Compose and network access from the Docker host to each actor's REST admin port.

```bash
git clone https://github.com/coralblocks/CoralConsole.git
cd CoralConsole
./scripts/docker-start.sh
```

Open [http://localhost:3000](http://localhost:3000), choose a topology name and workspace color, then add actors.

By default the container binds only to `127.0.0.1`. To make it reachable on a private LAN, set `CORAL_BIND_ADDRESS` in `.env` to the server's private IP (or `0.0.0.0` when a firewall or reverse proxy controls access). See [DEPLOYMENT.md](./DEPLOYMENT.md) before exposing the service to other users.

The Compose volume `coralconsole-data` holds `/data/coralconsole.db`. It survives Docker restarts, container recreation, application upgrades, and image removal. The volume—not the image—is what preserves actors and settings.

Useful lifecycle commands:

```bash
./scripts/docker-start.sh  # builds once if needed, then starts without rebuilding
./scripts/docker-stop.sh    # stops the app and preserves the database volume
./scripts/docker-backup.sh  # creates a verified timestamped backup in backups/
npm run docker:restart      # restarts the existing container
npm run docker:status       # shows container and health status
npm run docker:logs         # follows application logs; Ctrl-C stops following only
```

The `npm run docker:*` commands are convenient aliases for developers who already have Node.js. The start and stop shell scripts require only Docker Compose.

Create an online database backup at any time while CoralConsole is running:

```bash
./scripts/docker-backup.sh
```

Pass a directory to save it elsewhere, for example `./scripts/docker-backup.sh /Volumes/CompanyBackups`. Backup files contain operational configuration and admin action history, so store them securely.

After the first successful image build, `docker:start` can run without internet access as long as Docker still has the image and its base layers locally.

## Local development

Requirements:

- Docker with Docker Compose
- Network access from the CoralConsole process to each actor's REST admin port

For the fastest UI iteration, run the Docker development mode:

```bash
npm run docker:dev:start
```

Open [http://localhost:3000](http://localhost:3000). Source changes are bind-mounted into a Next.js development server and hot-reload without rebuilding Docker. Development mode uses the same `coralconsole-data` volume as the production container, but the two modes never run concurrently.

Rebuild the development image and its cached dependency volume only after changing `package.json`, `package-lock.json`, or `Dockerfile.dev`:

```bash
npm run docker:dev:rebuild
```

### Releasing the current source to production

Hot reload changes only the running development container. The immutable production image must be rebuilt once when the current source is ready for release:

```bash
npm run lint
npm test
npm run docker:release
```

`docker:release` builds `coralconsole:local` from the current source and replaces the development container with the production container. Both modes mount the same `coralconsole-data` volume, so actors, settings, and audit history remain intact. Create a backup first when a release includes a schema migration.

Rebuild production Docker whenever releasing source, dependency, or Docker configuration changes—including CSS changes. Do not rebuild merely to restart an unchanged production image after a reboot or manual stop; use `npm run docker:start` in that case.

Host-only development remains available for cases that should use the separate `.data/coralconsole.db` database:

```bash
npm ci
npm run db:migrate
npm run dev
```

## Connect an actor

1. Select **Add actor**.
2. Enter the actor's IP address or hostname and REST admin port.
3. The server sends `list`, follows the first discovered non-`VM` scope, and runs `<scope> status` when available to derive the actor's role, class, account, state, session, and available admin actions.
4. CoralConsole saves the actor in SQLite. Other users see it on their next refresh.

Existing prototype users receive a one-time option to re-discover and move browser-local actors into the shared topology. Only successfully imported entries are removed from browser storage.

The REST admin request and response format is documented in [examples_rest_server.txt](./examples_rest_server.txt).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CORAL_BIND_ADDRESS` | `127.0.0.1` | Host interface published by Docker Compose. |
| `CORAL_PORT` | `3000` | Host port published by Docker Compose. |
| `DATABASE_PATH` | `/data/coralconsole.db` in Docker | SQLite database location. |
| `CORAL_DEMO_MODE` | `false` | Adds clearly marked, simulated sample actors when `true`. |
| `CORAL_TRUST_PROXY` | `false` | Trusts proxy client-IP headers for audit entries when `true`. |

Topology name, workspace color, refresh interval, audit retention, and which actor types appear in the summary count panel are shared settings editable in the UI and persisted in SQLite.

## Development checks

```bash
npm run lint
npm test
```

`npm test` creates a production standalone build, starts it against a temporary SQLite database, exercises the APIs and audit path, restarts the server, and verifies persistence.

Database changes use Drizzle migrations:

```bash
npm run db:generate
npm run db:migrate
```

When work on an explicitly requested feature branch is complete, merge it directly into `main` without opening a pull request:

```bash
./scripts/git-merge-to-main.sh
```

Run the helper while checked out on the feature branch. It requires a clean working tree, asks for confirmation, updates local `main` from `origin/main`, creates a merge commit, and pushes `main`. It never force-pushes.

Product architecture and contribution conventions live in [AGENTS.md](./AGENTS.md).

## License

Licensed under the [Apache License 2.0](./LICENSE).
