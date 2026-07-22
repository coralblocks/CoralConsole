# Internal deployment

CoralConsole is designed as one Node.js process, one SQLite database, and one topology per installation. Deploy a second installation with a different port and volume when a customer needs a second topology.

## Security boundary

CoralConsole intentionally has no login or role system in this version. Any person who can reach the URL can add or remove actors and execute the admin commands exposed by those actors. Treat network access as full operator access.

- Keep the service on a private LAN, VPN, or zero-trust network.
- Do not publish port 3000 directly to the public internet.
- Prefer the default localhost binding behind an authenticated internal reverse proxy.
- If binding to a private interface, restrict the port with the host and network firewalls.
- Terminate HTTPS at the reverse proxy if traffic crosses an untrusted segment.
- The host/container must be able to reach every configured actor's REST admin port.

CoralConsole does not send topology or command data to an external service.

## Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

The health endpoint is `GET /api/health`. View logs with:

```bash
docker compose logs -f coralconsole
```

For direct private-LAN access, use the server's private address in `.env`:

```dotenv
CORAL_BIND_ADDRESS=10.20.30.40
CORAL_PORT=3000
```

For a reverse proxy on the same host, retain `127.0.0.1`. Set `CORAL_TRUST_PROXY=true` only when CoralConsole is behind a trusted proxy that overwrites `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.

## Persistence and backup

The Compose volume `coralconsole-data` mounts at `/data`; SQLite uses WAL mode and stores its main file at `/data/coralconsole.db`.

For a consistent online backup, use SQLite's backup command inside the running container and copy the result out:

```bash
docker compose exec coralconsole node -e "const D=require('better-sqlite3'); const db=new D('/data/coralconsole.db'); db.backup('/data/coralconsole-backup.db').then(()=>db.close())"
docker compose cp coralconsole:/data/coralconsole-backup.db ./coralconsole-backup.db
```

Store backups according to the customer's retention and security policy. Audit records contain command parameters and returned output and may therefore contain operationally sensitive data.

To restore, stop CoralConsole, replace the database file in `/data`, preserve ownership for the container user (`uid 1001`), and restart. Always retain a copy of the current volume before restoration.

## Upgrade

1. Create a database backup.
2. Pull the desired tagged release.
3. Run `docker compose up -d --build`.
4. Confirm `docker compose ps` reports a healthy service and open `/api/health`.

Migrations run automatically on container startup. Do not run multiple CoralConsole containers against the same SQLite file.

## Reverse proxy notes

Proxy normal HTTP requests and WebSocket upgrades to `http://127.0.0.1:3000`. Preserve the original host and scheme. Apply the customer's authentication, TLS, access logs, and request-size policy at the proxy. CoralConsole adds baseline content, frame, referrer, and permissions security headers itself.
