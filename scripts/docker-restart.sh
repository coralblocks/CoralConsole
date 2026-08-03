#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec sh "$project_dir/scripts/docker-command.sh" restart
