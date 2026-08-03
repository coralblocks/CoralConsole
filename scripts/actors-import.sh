#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

usage() {
  echo "Usage: ./scripts/actors-import.sh <input.csv>" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 1
fi

input_path=$1
if [ ! -f "$input_path" ] || [ ! -r "$input_path" ]; then
  echo "Actor import file is missing or unreadable: $input_path" >&2
  exit 1
fi

coral_require_environment
coral_require_docker

container_id=$(docker compose ps --status running -q coralconsole)
if [ -z "$container_id" ]; then
  echo "CoralConsole is not running. Start it before importing actors." >&2
  exit 1
fi

if ! docker compose exec -T coralconsole node scripts/import-actors.mjs --internal-database-mode < "$input_path"; then
  echo "Actor import failed. No actors are imported unless the complete CSV passes validation." >&2
  exit 1
fi
