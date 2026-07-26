#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

docker compose -f docker-compose.yml -f docker-compose.dev.yml stop coralconsole
docker compose -f docker-compose.yml -f docker-compose.dev.yml build coralconsole
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps coralconsole sh -c 'npm ci && rm -rf .next/*'
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build --force-recreate coralconsole
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps coralconsole

echo "Development dependencies and hot-reload container rebuilt."
