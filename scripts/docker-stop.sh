#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

docker compose stop coralconsole-ingress coralconsole
echo "CoralConsole is stopped. Its SQLite database remains in the Docker volume."
echo "Restart it later with: npm run docker:start"
