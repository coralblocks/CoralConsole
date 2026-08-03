#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

"$project_dir/scripts/docker-stop.sh"
"$project_dir/scripts/build-site.sh"
"$project_dir/scripts/docker-start.sh"
