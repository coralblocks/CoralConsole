#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed." >&2
  exit 1
fi

docker compose stop coralconsole
echo "CoralConsole is stopped. Its SQLite database remains in the Docker volume."
echo "Restart it later with: npm run docker:start"
