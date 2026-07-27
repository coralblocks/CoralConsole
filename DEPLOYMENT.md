# Internal deployment

CoralConsole is designed as one Node.js process, one SQLite database, and one topology per installation. Deploy a second installation with a different port and volume when a customer needs a second topology.

## Security boundary

CoralConsole intentionally has no login or role system in this version. Any person who can reach the URL can add or remove actors and execute the admin actions exposed by those actors. Treat network access as full operator access.

- Keep the service on a private LAN, VPN, or zero-trust network.
- Do not publish port 3000 directly to the public internet.
- Prefer the default localhost binding behind an authenticated internal reverse proxy.
- If binding to a private interface, restrict the port with the host and network firewalls.
- Terminate HTTPS at the reverse proxy if traffic crosses an untrusted segment.
- The host/container must be able to reach every configured actor's REST admin port.
- The reference deployment requires Linux host networking. On Docker Desktop 4.34 or newer, enable **Settings → Resources → Network → Enable host networking**.

CoralConsole does not send topology or admin action data to an external service.

## Docker Compose

```bash
./scripts/docker-start.sh
docker compose ps coralconsole coralconsole-ingress
```

On the first run, the start script copies `.env.example` to the ignored `.env` file and builds `coralconsole:local`. Subsequent starts use that local image without rebuilding, which supports disconnected/offline testing. Run `npm run docker:build` intentionally after pulling or editing application code, followed by `npm run docker:start`.

The health endpoint is `GET /api/health`. View both application and ingress logs with:

```bash
docker compose logs -f coralconsole coralconsole-ingress
```

The project also provides:

```bash
npm run docker:stop
npm run docker:backup
npm run docker:restart
npm run docker:status
npm run docker:logs
```

`./scripts/docker-stop.sh` and `docker:stop` use `docker compose stop`, which leaves both the container and named volume intact. The shell scripts require only Docker Compose; the `npm run` aliases additionally require Node.js.

For direct private-LAN access, use the server's private address in `.env`:

```dotenv
CORAL_BIND_ADDRESS=10.20.30.40
CORAL_PORT=3000
CORAL_INTERNAL_PORT=39000
```

`CORAL_PORT` belongs to the host-network ingress. `CORAL_INTERNAL_PORT` publishes the application only on host loopback and must not be made remotely reachable.

Native Linux can bind the ingress to a specific host address as shown above. Docker Desktop host networking cannot bind a container process to a specific host interface; use `CORAL_BIND_ADDRESS=0.0.0.0` there and enforce the intended private-network scope with the host firewall.

### Audit source IP

The reference deployment does not trust IP-related HTTP headers from browsers. `coralconsole-ingress` owns the public listener, removes `Forwarded`, every `X-Forwarded-*` header, `X-Real-IP`, and its private handoff header, then records the peer address from the accepted TCP socket. It forwards that validated address to the loopback-only application port.

With a direct private-LAN connection to a native Linux deployment, this is normally the workstation address seen by the CoralConsole server. A network proxy or source NAT in front of CoralConsole necessarily changes the TCP peer to that intermediary. Docker Desktop adds a VM/backend networking layer and should be treated as a development environment rather than relied on for production-grade workstation attribution. DHCP reassignment and IPv6 privacy addresses can also change a workstation's address over time, so correlate audit timestamps with company DHCP/IPAM records. An IP is useful evidence but is not a substitute for future authenticated user identity.

For a reverse proxy on the same host, retain `127.0.0.1`; the built-in ingress will correctly record that proxy as its TCP peer rather than trusting forwarded claims. If an installation must attribute users through another proxy, make that proxy the explicitly trusted capture boundary in a custom deployment, ensure it overwrites (not appends) all client-IP headers, and enable `CORAL_TRUST_PROXY` only there. Never expose the loopback application port as a public route.

## Persistence and backup

The Compose volume `coralconsole-data` mounts at `/data`; SQLite uses WAL mode and stores its main file at `/data/coralconsole.db`.

Docker images and volumes are independent. These operations preserve the database:

- quitting and restarting Docker Desktop or the Docker service;
- `./scripts/docker-stop.sh` followed by `./scripts/docker-start.sh`;
- `docker compose down` followed by `npm run docker:start`;
- removing/rebuilding the `coralconsole:local` image;
- removing and recreating the CoralConsole container.

These operations delete or can delete the database and must not be used unless data loss is intentional:

- `docker compose down -v`;
- `docker volume rm` targeting this project's `coralconsole-data` volume;
- `docker system prune --volumes` when the volume is considered unused;
- Docker Desktop **Reset to factory defaults** or equivalent storage reset.

Compose normally prefixes the physical volume with the project/directory name. If the checkout directory or `COMPOSE_PROJECT_NAME` changes, Docker may create a new empty volume; the original database normally still exists in the old volume.

To confirm the active database and volume:

```bash
docker compose exec coralconsole ls -lh /data/coralconsole.db
docker volume ls --filter label=com.docker.compose.volume=coralconsole-data
```

For a consistent online backup while CoralConsole remains available, run:

```bash
./scripts/docker-backup.sh
```

The script uses SQLite's online backup API, runs an integrity check, copies a timestamped database into the ignored local `backups/` directory, restricts the file to the current user, and removes its temporary container copy. Provide a destination directory as the first argument when needed:

```bash
./scripts/docker-backup.sh /secure/company/backup/location
```

Store backups according to the customer's retention and security policy. Audit records contain admin action parameters and returned output and may therefore contain operationally sensitive data. The script never automatically deletes older backups.

To restore, stop CoralConsole, replace the database file in `/data`, preserve ownership for the container user (`uid 1001`), and restart. Always retain a copy of the current volume before restoration.

## Upgrade

1. Create a database backup.
2. Pull the desired tagged release.
3. Run `docker compose build`, followed by `./scripts/docker-start.sh`.
4. Confirm `docker compose ps coralconsole coralconsole-ingress` reports both services healthy and open `/api/health`.

Migrations run automatically on container startup. Do not run multiple CoralConsole containers against the same SQLite file.

## Reverse proxy notes

Proxy normal HTTP requests and WebSocket upgrades to the public ingress at `http://127.0.0.1:3000`. Do not proxy to `CORAL_INTERNAL_PORT`. Preserve the original host and scheme. Apply the customer's authentication, TLS, access logs, and request-size policy at the proxy. CoralConsole adds baseline content, frame, referrer, and permissions security headers itself.
