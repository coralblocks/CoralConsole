#!/bin/sh

if [ -z "${coral_project_dir:-}" ]; then
  coral_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fi
coral_release_bundle_dir="$coral_project_dir/.coralconsole"

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

coral_require_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required for this source-development command but is not installed." >&2
    echo "Install Node.js 22 with npm, then run the command again." >&2
    echo "The standard CoralConsole installation does not require npm on the host." >&2
    exit 1
  fi
}

coral_host_architecture() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' amd64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    *) return 1 ;;
  esac
}

coral_validate_release_bundle() {
  coral_bundle_archive="$coral_release_bundle_dir/release-image.tar"
  coral_bundle_name_file="$coral_release_bundle_dir/image-name"
  coral_bundle_arch_file="$coral_release_bundle_dir/image-architecture"

  if ! coral_bundle_host_arch=$(coral_host_architecture); then
    echo "Unsupported CPU architecture: $(uname -m). CoralConsole supports Linux x86-64 and ARM64." >&2
    return 1
  fi
  for coral_bundle_file in "$coral_bundle_archive" "$coral_bundle_name_file" "$coral_bundle_arch_file"; do
    if [ ! -s "$coral_bundle_file" ]; then
      echo "This folder is not a complete CoralConsole installation package: ${coral_bundle_file#"$coral_project_dir/"} is missing or empty." >&2
      echo "Download and extract the Linux $coral_bundle_host_arch release asset, not GitHub's automatic source archive." >&2
      return 1
    fi
  done

  coral_bundle_arch=$(sed -n '1p' "$coral_bundle_arch_file")
  if [ "$coral_bundle_arch" != "$coral_bundle_host_arch" ]; then
    echo "This package is for Linux $coral_bundle_arch, but this host is Linux $coral_bundle_host_arch." >&2
    echo "Download the matching CoralConsole release asset." >&2
    return 1
  fi

  coral_bundle_image=$(sed -n '1p' "$coral_bundle_name_file")
  case "$coral_bundle_image" in
    ""|*[!A-Za-z0-9._:/-]*)
      echo "The bundled Docker image metadata is invalid." >&2
      return 1
      ;;
  esac
  case "$coral_bundle_image" in
    coralconsole-release:*-linux-"$coral_bundle_host_arch") ;;
    *)
      echo "The bundled Docker image does not match this CoralConsole release package." >&2
      return 1
      ;;
  esac
}

coral_load_release_image() {
  coral_target_image=$1
  if docker image inspect "$coral_target_image" >/dev/null 2>&1; then
    return 0
  fi
  coral_validate_release_bundle || return 1

  if ! docker image inspect "$coral_bundle_image" >/dev/null 2>&1; then
    echo "Loading the prebuilt CoralConsole image from this release package..."
    docker load --input "$coral_bundle_archive" || return 1
  fi
  if ! docker image inspect "$coral_bundle_image" >/dev/null 2>&1; then
    echo "Docker loaded the release archive but the expected image $coral_bundle_image was not found." >&2
    return 1
  fi
  docker tag "$coral_bundle_image" "$coral_target_image" || return 1
  echo "Prepared this installation's private image: $coral_target_image"
}

coral_standard_image() {
  docker compose config --images | sed -n '1p'
}

coral_development_image() {
  docker compose -f docker-compose.yml -f docker-compose.dev.yml config --images | sed -n '1p'
}
