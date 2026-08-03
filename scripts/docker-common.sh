#!/bin/sh

coral_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

coral_require_environment() {
  if [ ! -f "$coral_project_dir/.env" ]; then
    echo "This folder has not been installed yet. Run ./install.sh first." >&2
    exit 1
  fi
}

coral_require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed. Install Docker Engine and Docker Compose v2 first." >&2
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is not available." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but is not running or is not accessible to this user." >&2
    exit 1
  fi
}

coral_standard_image() {
  docker compose config --images | sed -n '1p'
}

coral_development_image() {
  docker compose -f docker-compose.yml -f docker-compose.dev.yml config --images | sed -n '1p'
}
