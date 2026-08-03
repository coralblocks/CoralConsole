#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

usage() {
  echo "Usage: ./scripts/actors-export.sh [output.csv]" >&2
}

if [ "$#" -gt 1 ]; then
  usage
  exit 1
fi

coral_require_environment
coral_require_docker

container_id=$(docker compose ps --status running -q coralconsole)
if [ -z "$container_id" ]; then
  echo "CoralConsole is not running. Start it before exporting actors." >&2
  exit 1
fi

if [ "$#" -eq 1 ]; then
  display_path=$1
else
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  display_path="coralconsole-actors-$timestamp.csv"
fi
case "$display_path" in
  /*) output_path=$display_path ;;
  *) output_path="$project_dir/$display_path" ;;
esac

if [ -e "$output_path" ] || [ -L "$output_path" ]; then
  echo "Refusing to overwrite the existing file $display_path" >&2
  exit 1
fi

temporary_path=$(mktemp "${output_path}.tmp.XXXXXX") || {
  echo "Could not create a temporary export beside $display_path. Check that its directory exists and is writable." >&2
  exit 1
}
cleanup_export() {
  rm -f "$temporary_path"
}
trap cleanup_export 0 1 2 3 15

if ! docker compose exec -T coralconsole node scripts/export-actors.mjs --internal-database-mode > "$temporary_path"; then
  echo "Actor export failed. Make sure this installation is running its current image." >&2
  exit 1
fi

chmod 600 "$temporary_path"
if ! ln "$temporary_path" "$output_path"; then
  echo "Refusing to overwrite the existing file $display_path" >&2
  exit 1
fi
rm -f "$temporary_path"
trap - 0 1 2 3 15

echo "Saved actor export to $display_path"
