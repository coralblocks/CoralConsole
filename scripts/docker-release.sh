#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

echo "Building the standard image from the current source..."
docker compose build coralconsole
coral_ensure_data_volume
docker compose up -d --no-build --wait coralconsole coralconsole-ingress
docker compose ps coralconsole coralconsole-ingress

echo "Standard mode is running from this installation's newly built local image."
echo "Database storage remains in this installation's private Docker volume."
