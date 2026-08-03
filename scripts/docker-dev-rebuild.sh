#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

docker compose -f docker-compose.yml -f docker-compose.dev.yml stop coralconsole-ingress coralconsole
docker compose -f docker-compose.yml -f docker-compose.dev.yml build coralconsole
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps coralconsole sh -c 'npm_config_cache=/tmp/coralconsole-npm-cache npm ci && rm -rf .next/*'
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build --force-recreate --wait coralconsole coralconsole-ingress
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps coralconsole coralconsole-ingress

echo "Development dependencies and hot-reload container rebuilt."
