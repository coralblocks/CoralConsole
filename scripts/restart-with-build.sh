#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$project_dir/scripts/docker-common.sh"

# Check before stopping CoralConsole so a missing host prerequisite cannot leave
# a running installation unnecessarily offline.
coral_require_npm

"$project_dir/scripts/docker-stop.sh"
"$project_dir/scripts/build-site.sh"
"$project_dir/scripts/docker-start.sh"
