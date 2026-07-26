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

echo "Building the production image from the current source..."
docker compose build coralconsole
docker compose up -d --no-build coralconsole
docker compose ps coralconsole

echo "Production mode is running from the newly built coralconsole:local image."
echo "Database storage remains in the coralconsole-data Docker volume."
