#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

container_id=$(docker compose ps --status running -q coralconsole)
if [ -z "$container_id" ]; then
  echo "CoralConsole is not running. Start it before creating an online backup." >&2
  exit 1
fi

backup_dir=${1:-${CORAL_BACKUP_DIR:-"$project_dir/backups"}}
mkdir -p "$backup_dir"
backup_dir=$(CDPATH= cd -- "$backup_dir" && pwd)

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="coralconsole-$timestamp-$$.db"
container_backup="/data/.$backup_name"
backup_path="$backup_dir/$backup_name"

cleanup_container_backup() {
  docker compose exec -T coralconsole node -e '
    const fs = require("node:fs");
    try { fs.unlinkSync(process.argv[1]); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  ' "$container_backup" >/dev/null 2>&1 || true
}
trap cleanup_container_backup 0

docker compose exec -T coralconsole node -e '
  const Database = require("better-sqlite3");
  const source = new Database("/data/coralconsole.db", { readonly: true, fileMustExist: true });

  (async () => {
    try {
      await source.backup(process.argv[1]);
      const backup = new Database(process.argv[1], { readonly: true, fileMustExist: true });
      try {
        const result = backup.pragma("quick_check", { simple: true });
        if (result !== "ok") throw new Error(`SQLite integrity check failed: ${result}`);
      } finally {
        backup.close();
      }
    } finally {
      source.close();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
' "$container_backup"

docker compose cp "coralconsole:$container_backup" "$backup_path"
chmod 600 "$backup_path"
cleanup_container_backup
trap - 0

echo "Backup complete: $backup_path"
echo "The live database was not stopped or modified."
