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

if ! docker image inspect coralconsole:local >/dev/null 2>&1; then
  echo "Building the CoralConsole image for the first time..."
  docker compose build
fi

docker compose up -d --no-build coralconsole
docker compose ps coralconsole

published_endpoint=$(docker compose port coralconsole 3000 2>/dev/null || true)
if [ -n "$published_endpoint" ]; then
  echo "CoralConsole is available at http://$published_endpoint"
else
  echo "CoralConsole started. Check its address with: docker compose port coralconsole 3000"
fi

echo "Database storage: Docker volume coralconsole-data (mounted at /data)."
