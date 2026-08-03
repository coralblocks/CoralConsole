#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

standard_image=$(coral_standard_image)
if [ -z "$standard_image" ]; then
  echo "Docker Compose could not resolve this installation's standard image." >&2
  exit 1
fi
coral_load_release_image "$standard_image"

if ! docker compose up -d --no-build --wait coralconsole coralconsole-ingress; then
  echo "CoralConsole's trusted ingress requires host networking." >&2
  echo "On Docker Desktop 4.34+, enable host networking in Settings > Resources > Network, then try again." >&2
  exit 1
fi
docker compose ps coralconsole coralconsole-ingress

public_endpoint=$(docker compose exec -T coralconsole-ingress node -e '
  const host = process.env.CORAL_INGRESS_BIND_ADDRESS || "127.0.0.1";
  const port = process.env.CORAL_INGRESS_PORT || "3000";
  process.stdout.write(`${host}:${port}`);
')
echo "CoralConsole is available at http://$public_endpoint"

echo "Database storage: this installation's private Docker volume (mounted at /data)."
