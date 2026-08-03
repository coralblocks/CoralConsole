#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

cd "$project_dir"
colima restart
exec "$project_dir/scripts/docker-start.sh"
