#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Desktop or Docker Engine first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but is not running. Start Docker and try again." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

if ! docker image inspect coralconsole:dev >/dev/null 2>&1; then
  echo "Building the CoralConsole development image for the first time..."
  docker compose -f docker-compose.yml -f docker-compose.dev.yml build coralconsole
fi

if ! docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build --wait coralconsole coralconsole-ingress; then
  echo "CoralConsole's trusted ingress requires host networking." >&2
  echo "On Docker Desktop 4.34+, enable host networking in Settings > Resources > Network, then try again." >&2
  exit 1
fi
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps coralconsole coralconsole-ingress

public_endpoint=$(docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T coralconsole-ingress node -e '
  const host = process.env.CORAL_INGRESS_BIND_ADDRESS || "127.0.0.1";
  const port = process.env.CORAL_INGRESS_PORT || "3000";
  process.stdout.write(`${host}:${port}`);
')
echo "CoralConsole development mode is available at http://$public_endpoint"

echo "Source changes now hot-reload without rebuilding Docker."
echo "Database storage remains in the coralconsole-data Docker volume."
