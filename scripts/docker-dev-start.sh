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

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build coralconsole
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps coralconsole

published_endpoint=$(docker compose -f docker-compose.yml -f docker-compose.dev.yml port coralconsole 3000 2>/dev/null || true)
if [ -n "$published_endpoint" ]; then
  echo "CoralConsole development mode is available at http://$published_endpoint"
else
  echo "CoralConsole development mode started. Check its address with Docker Compose."
fi

echo "Source changes now hot-reload without rebuilding Docker."
echo "Database storage remains in the coralconsole-data Docker volume."
