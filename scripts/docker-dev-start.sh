#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

development_image=$(coral_development_image)
if [ -z "$development_image" ]; then
  echo "Docker Compose could not resolve this installation's development image." >&2
  exit 1
fi
if ! docker image inspect "$development_image" >/dev/null 2>&1; then
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
  const host = process.env.CORAL_INGRESS_BIND_ADDRESS || "0.0.0.0";
  const port = process.env.CORAL_INGRESS_PORT || "3000";
  const displayHost = host === "0.0.0.0" ? "<server-address>" : host;
  process.stdout.write(`${displayHost}:${port}`);
')
echo "CoralConsole development mode is available at http://$public_endpoint"

echo "Source changes now hot-reload without rebuilding Docker."
echo "Database storage remains in this installation's private Docker volume."
