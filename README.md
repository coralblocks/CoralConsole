# CoralConsole

CoralConsole is a colorful operations console for discovering, organizing, and administering actors in a [Coral Sequencer](https://www.coralblocks.com/coralsequencer) distributed system.

![CoralConsole topology overview](public/og-v2.png)

> **Project status:** early development. The current version is a local-first prototype intended for evaluation on trusted networks. Shared server-side persistence and a self-contained internal Docker deployment are designed but not implemented yet.

## What it does

- Discovers an actor from its host/IP address and REST admin port.
- Organizes Sequencers, Backup Sequencers, Replayers, Archivers, Loggers, Bridges, Dispatchers, Nodes, Applications, Links, and MultiMqApps by operational role.
- Shows actor health, the active Sequencer session, and topology-level status.
- Opens each actor in a dedicated browser tab for REST admin actions.
- Relays actor requests through the local server, avoiding browser CORS limitations.

## Run the current prototype

Requirements:

- Node.js `>=22.13.0`
- Network access from the CoralConsole server to each actor's REST admin port

```bash
git clone https://github.com/coralblocks/CoralConsole.git
cd CoralConsole
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Connect an actor

1. Select **Add actor**.
2. Enter the actor's IP address or hostname and REST admin port.
3. CoralConsole sends `list`, follows the discovered non-`VM` scope, and derives the actor's name, role, class hint, and available commands.
4. The actor is added to the topology and stored in that browser's local storage.

The REST admin request and response format is documented in [examples_rest_server.txt](./examples_rest_server.txt).

## Current limitations

- Added actors are stored per browser; they are not yet shared between users.
- Clearing browser storage removes locally added actors.
- The application does not currently provide authentication or authorization.
- The server-side REST relay must run only on a trusted network because it can reach configured actor endpoints and execute admin commands.
- The current production build targets a Cloudflare Worker-compatible runtime rather than the planned internal Docker package.

The approved shared SQLite persistence and private Docker deployment design is recorded in [INTERNAL_DEPLOYMENT_PLAN.md](./INTERNAL_DEPLOYMENT_PLAN.md).

## Development

```bash
npm run build
npm test
npm run lint
```

- `npm run dev` starts the local development server.
- `npm run build` creates the deployable worker build.
- `npm test` builds the app and runs repository guard tests.
- `npm run lint` runs ESLint.

Product architecture and contribution conventions live in [AGENTS.md](./AGENTS.md).

## License

Licensed under the [Apache License 2.0](./LICENSE).
