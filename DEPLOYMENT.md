# Installation and deployment

CoralConsole is designed as one Node.js process, one SQLite database, and one topology per installation. Each freshly extracted GitHub Release folder is a separate installation. On the same host, additional installations use different public and loopback-internal ports; on different hosts they may reuse the defaults.

## Security boundary

CoralConsole has no usernames, roles, or per-user permissions. By default, any person who can reach the URL can add or remove actors and execute the admin actions exposed by those actors. Treat unprotected network access as full operator access.

The reference deployment offers two independent, optional defenses. `CORAL_ALLOWED_CLIENTS` restricts the TCP peers accepted by the trusted ingress, and `CORAL_ACCESS_KEY_HASH` enables a shared-key gate for the application. Both are empty and disabled by default for compatibility with existing installations. The installer offers to configure either one during a fresh installation.

- Keep the service on a private LAN, VPN, or zero-trust network.
- Do not publish port 3000 directly to the public internet.
- Choose the localhost binding when placing CoralConsole behind an authenticated internal reverse proxy.
- If binding to a private interface, restrict the port with the host and network firewalls.
- Terminate HTTPS at the reverse proxy if traffic crosses an untrusted segment.
- The host/container must be able to reach every configured actor's REST admin port.
- The reference deployment requires Linux host networking. On Docker Desktop 4.34 or newer, enable **Settings → Resources → Network → Enable host networking**.

CoralConsole does not send topology or admin action data to an external service.

## Install from a GitHub Release

```bash
sha256sum --check coralconsole-A.B.C-linux-amd64.tar.gz.sha256
tar -xzf coralconsole-A.B.C-linux-amd64.tar.gz
cd coralconsole-A.B.C
./install.sh
```

Use the `linux-amd64` asset on x86-64 servers and the `linux-arm64` asset on ARM64 servers. Do not use GitHub's automatically generated **Source code** archives; they do not contain the prebuilt image.

The host needs only Docker Engine and Docker Compose v2. The installer checks the daemon, loads the package's prebuilt image, prepares a private Docker namespace for that folder, warns about the reachability of the selected bind address, suggests and validates available ports, optionally configures a client allowlist and generated shared access key, writes the ignored `.env`, starts both services, and waits for their health checks. It does not run `apt-get`, npm, an application build, or a Docker-registry pull. Every installed-server command uses shell and Docker; Node.js and npm always run inside a CoralConsole container or Docker build, never as host prerequisites.

The generated `COMPOSE_PROJECT_NAME` in `.env` is internal Docker plumbing. It keeps the folder's containers, images, and volume independent even when another installation has the same final directory name. It is not an installation label in CoralConsole and normally should not be edited.

The installer checks that both suggested and manually entered ports can actually bind. A port can still be claimed by another process in the small interval before Compose starts; Docker startup is authoritative and the installer reports a late collision without disturbing the existing listener.

CoralConsole images are never pulled from or pushed to a Docker registry. The release asset contains both the complete editable source and the standard runtime image.

Maintainers do not cross-compile these images. A tag-triggered GitHub Actions workflow builds the AMD64 and ARM64 packages on matching native Linux runners and creates a draft GitHub Release for review and publication.

## Folder-local lifecycle

Every command below operates only on the installation folder containing it:

```bash
./scripts/docker-start.sh
./scripts/docker-stop.sh
./scripts/docker-release.sh
./scripts/docker-backup.sh
./scripts/docker-restart.sh
./scripts/docker-status.sh
./scripts/docker-logs.sh
```

`docker-start.sh` starts the existing standard image, reloading it from the release package if the private image was removed. `docker-release.sh` deliberately rebuilds the current source and relaunches standard mode. Lifecycle scripts require the `.env` created by `install.sh`; they never discover or select another installation.

The health endpoint is `GET /api/health`. View both application and ingress logs with:

```bash
docker compose logs -f coralconsole coralconsole-ingress
```

`./scripts/docker-stop.sh` uses `docker compose stop`, which leaves both the containers and named volume intact. The lifecycle scripts require only Docker Compose.

For direct private-LAN access, use the server's private address in `.env`:

```dotenv
COMPOSE_PROJECT_NAME=coralconsole-a1b2c3d4e5f6
CORAL_BIND_ADDRESS=10.20.30.40
CORAL_PORT=3000
CORAL_INTERNAL_PORT=39000
CORAL_ALLOWED_CLIENTS=10.20.30.0/24,2001:db8:1234::/48
CORAL_ACCESS_KEY_HASH=
```

`CORAL_PORT` belongs to the host-network ingress. The application also uses host networking but binds `CORAL_INTERNAL_PORT` only on `127.0.0.1`; that internal listener must not be made remotely reachable.

Native Linux can bind the ingress to a specific host address as shown above. Docker Desktop host networking cannot bind a container process to a specific host interface; use `CORAL_BIND_ADDRESS=0.0.0.0` there and enforce the intended private-network scope with the host firewall.

After changing either port in `.env`, run `./scripts/docker-start.sh` to recreate the affected services with the new values. The public and internal ports must remain different.

## Optional network and access controls

The two controls are independent. Either variable may remain empty while the other is enabled, and leaving both empty preserves the open private-network behavior.

### Ingress client allowlist

`CORAL_ALLOWED_CLIENTS` is a comma-separated list of exact IPv4 or IPv6 addresses and CIDR ranges:

```dotenv
CORAL_ALLOWED_CLIENTS=10.20.30.0/24,10.21.4.18,2001:db8:1234::/48
```

The trusted ingress validates the complete list at startup and refuses to start if an entry is malformed. It compares each request's normalized `socket.remoteAddress` before opening any connection to the application. A nonmatching HTTP request receives a plain `403 Forbidden`; a nonmatching WebSocket upgrade socket is destroyed. Browser-supplied forwarding headers are never consulted. Empty or unset means that all TCP peers are accepted, as in earlier releases.

An allowlist controls network addresses, not human identity. If a NAT or reverse proxy sits in front of CoralConsole, the ingress normally sees that intermediary; allow the proxy address and enforce workstation-level policy at the proxy, or connect clients directly through the intended private network. DHCP leases and IPv6 privacy addresses can change over time. Docker Desktop's VM/backend networking can also obscure the original peer, so use host or upstream firewall controls rather than depending on address attribution there.

### Shared access key

`CORAL_ACCESS_KEY_HASH` enables one installation-wide key when it contains a lowercase, 64-character SHA-256 hash. The fresh installer can generate a strong random key, displays it once, and stores only its hash in `.env`. Keep the displayed key in the customer's approved secret manager. To prepare a compatible hash later without host Node.js, pipe the key on standard input—not as a command-line argument—to this command while CoralConsole is running:

```bash
docker compose exec -T coralconsole node scripts/hash-access-key.mjs
```

Put the returned hash in `.env`, then run `./scripts/docker-start.sh`. Changing the hash invalidates previously issued sessions; clearing it disables the gate. When enabled, an operator pastes the shared key into a minimal gate page and receives a signed, HttpOnly, SameSite session cookie. Every page and API requires that session except `GET /api/health`, which remains unauthenticated for container checks. The ingress allowlist still applies to remote health requests.

This is deliberately a shared secret, not user authentication: it provides no usernames, roles, reset workflow, or per-user audit attribution. Admin-action audit rows continue to contain the trusted source IP only. Per-user accountability requires a future authentication system or an authenticated upstream proxy with its own identity-aware logs.

The key and session cookie are bearer credentials. Direct HTTP sends the key without transport encryption; terminate TLS at a trusted reverse proxy whenever traffic crosses an untrusted segment. A TLS proxy should preserve the browser-facing `Host`, proxy normal requests and upgrades, and prevent a separate plain-HTTP path from bypassing TLS.

## Runtime modes

Standard mode is installed and started by default. It uses the optimized standalone Next.js build loaded from the release asset and tagged as this installation's `<compose-project>:local` image. Source changes take effect only after `./scripts/docker-release.sh` rebuilds and relaunches it. Rebuilding is an explicit advanced operation that may download the Node base image and npm/build dependencies; ordinary installation and restart remain offline.

Development mode is optional contributor tooling. `./scripts/docker-dev-start.sh` builds this installation's `<compose-project>:dev` image on first use, bind-mounts the source, and runs the Next.js development server with hot reload. Both modes use the same Compose services, ports, and SQLite volume, so switching recreates those services instead of running two application processes concurrently. Return to a deliberate standard build with `./scripts/docker-release.sh`.

### Audit source IP

The reference deployment does not trust IP-related HTTP headers from browsers. `coralconsole-ingress` owns the public listener, removes `Forwarded`, every `X-Forwarded-*` header, `X-Real-IP`, and its private handoff header, then records the peer address from the accepted TCP socket. It uses that same address for the optional ingress allowlist and forwards the validated value to the loopback-only application port.

With a direct private-LAN connection to a native Linux deployment, this is normally the workstation address seen by the CoralConsole server. A network proxy or source NAT in front of CoralConsole necessarily changes the TCP peer to that intermediary. Docker Desktop adds a VM/backend networking layer and should be treated as a development environment rather than relied on for production-grade workstation attribution. DHCP reassignment and IPv6 privacy addresses can also change a workstation's address over time, so correlate audit timestamps with company DHCP/IPAM records. An IP is useful evidence but is not a substitute for future authenticated user identity.

For a reverse proxy on the same host, retain `127.0.0.1`; the built-in ingress will correctly record that proxy as its TCP peer rather than trusting forwarded claims. If an installation must attribute users through another proxy, make that proxy the explicitly trusted capture boundary in a custom deployment, ensure it overwrites (not appends) all client-IP headers, and enable `CORAL_TRUST_PROXY` only there. Never expose the loopback application port as a public route.

## Persistence and backup

The logical volume `coralconsole-data` mounts at `/data`; its physical Docker name is `<compose-project>_coralconsole-data`. CoralConsole creates it when absent and declares it external to the Compose lifecycle so configuration metadata changes cannot trigger a destructive volume-recreation prompt. SQLite uses WAL mode and stores its main file at `/data/coralconsole.db`.

Docker images and volumes are independent. These operations preserve the database:

- quitting and restarting Docker Desktop or the Docker service;
- `./scripts/docker-stop.sh` followed by `./scripts/docker-start.sh`;
- `docker compose down` followed by `./scripts/docker-start.sh`;
- `docker compose down -v` followed by `./scripts/docker-start.sh`, because the database volume is external;
- removing or rebuilding this installation's local image;
- removing and recreating the CoralConsole container.

These operations delete or can delete the database and must not be used unless data loss is intentional:

- `docker volume rm` targeting this project's `coralconsole-data` volume;
- `docker system prune --volumes` when the volume is considered unused;
- Docker Desktop **Reset to factory defaults** or equivalent storage reset.

The physical volume name uses the generated project name stored in `.env`. Changing `COMPOSE_PROJECT_NAME` creates a different Docker project and therefore a different empty volume; leave it unchanged for an established installation.

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

### Transfer actors to a fresh installation

For a new CoralConsole installation that uses a new empty database, export the actor routing and ordering configuration from the running old installation:

```bash
./scripts/actors-export.sh coralconsole-actors.csv
```

The CSV contains only actor account, host, REST port, and kind. Rows are exported in the current per-kind actor order. It does not contain settings, audit history, actor status, discovered metadata, or browser preferences. The export command refuses to overwrite an existing file.

Build and start the new installation once so its current database migrations run, copy the CSV to the new checkout, and import it while CoralConsole remains running:

```bash
./scripts/actors-import.sh coralconsole-actors.csv
```

Import is intentionally allowed only when the destination `actors` table is empty. The entire CSV is validated before a single transaction; duplicate actor identities, invalid endpoints, or malformed rows reject the file without importing anything. Each kind's relative CSV row order becomes its actor order. Imported actors receive new internal IDs and begin Offline until normal polling refreshes their current identity, actions, and status. Re-enter installation Settings manually after a fresh-folder transfer.

## Release upgrades

`install.sh` installs or resumes the release in its own folder; it is not a release-to-release upgrader. Automated source and database upgrade handling is outside the current packaging workflow. Always create a verified database backup and follow the target release's notes before changing an established installation.

Migrations run automatically on container startup. Do not run multiple CoralConsole containers against the same SQLite file.

## Reverse proxy notes

Proxy normal HTTP requests and WebSocket upgrades to the public ingress at `http://127.0.0.1:3000`. Do not proxy to `CORAL_INTERNAL_PORT`. Preserve the browser-facing `Host`; same-host HTTPS origins are recognized across this trusted TLS-to-loopback-HTTP hop so CoralConsole's CSRF checks remain active and access sessions receive a `Secure` cookie. Apply the customer's authentication, TLS, access logs, and request-size policy at the proxy. When `CORAL_ALLOWED_CLIENTS` is enabled here, include the proxy's TCP address; the ingress cannot recover individual workstation addresses from stripped forwarding headers. CoralConsole adds baseline content, frame, referrer, and permissions security headers itself.
