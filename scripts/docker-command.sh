#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

coral_require_environment
coral_require_docker

case "${1:-}" in
  build)
    docker compose build
    ;;
  restart)
    docker compose restart coralconsole coralconsole-ingress
    ;;
  status)
    docker compose ps coralconsole coralconsole-ingress
    ;;
  logs)
    docker compose logs -f coralconsole coralconsole-ingress
    ;;
  dev-logs)
    docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f coralconsole coralconsole-ingress
    ;;
  dev-stop)
    docker compose -f docker-compose.yml -f docker-compose.dev.yml stop coralconsole-ingress coralconsole
    ;;
  *)
    echo "Usage: $0 {build|restart|status|logs|dev-logs|dev-stop}" >&2
    exit 1
    ;;
esac
