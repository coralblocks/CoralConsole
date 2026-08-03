#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$project_dir/scripts/docker-common.sh"

coral_require_npm
cd "$project_dir"
exec npm run docker:build

