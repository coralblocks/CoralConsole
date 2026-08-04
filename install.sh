#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
if [ ! -f "$project_dir/scripts/docker-common.sh" ]; then
  echo "This release is incomplete: scripts/docker-common.sh is missing. Extract a fresh CoralConsole release package." >&2
  exit 1
fi
coral_project_dir=$project_dir
. "$project_dir/scripts/docker-common.sh"

PORT_PROBE_IMAGE=
PORT_PROBE_SCRIPT='const net = require("node:net");
const host = process.argv[1];
const port = Number(process.argv[2]);
const server = net.createServer();
const timer = setTimeout(() => process.exit(12), 5000);
server.once("error", (error) => {
  clearTimeout(timer);
  if (error.code === "EADDRINUSE" || error.code === "EACCES") process.exit(10);
  if (error.code === "EADDRNOTAVAIL" || error.code === "ENOTFOUND") process.exit(11);
  console.error(error.message);
  process.exit(12);
});
server.listen({ host, port, exclusive: true }, () => {
  clearTimeout(timer);
  server.close((error) => process.exit(error ? 12 : 0));
});'

fail() {
  echo "$1" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$2"
  fi
}

check_prerequisites() {
  if [ "$(uname -s)" != "Linux" ]; then
    fail "The CoralConsole release installer supports native Linux. Use the documented contributor workflow on other platforms."
  fi

  case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ;;
    *) fail "Unsupported CPU architecture: $(uname -m). CoralConsole supports Linux x86-64 and ARM64." ;;
  esac

  require_command docker "Docker is not installed. Install Docker Engine and the Docker Compose v2 plugin first."
  require_command od "The required POSIX utility 'od' is not installed."
  require_command tr "The required POSIX utility 'tr' is not installed."

  if ! docker compose version >/dev/null 2>&1; then
    fail "Docker Compose v2 is not available. Install the 'docker compose' plugin and try again."
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "Docker is installed but is not running or is not accessible to this user."
  fi
  docker_os=$(docker info --format '{{.OSType}}' 2>/dev/null || true)
  if [ "$docker_os" != "linux" ]; then
    fail "The selected Docker Engine must run Linux containers."
  fi

  for required_file in Dockerfile Dockerfile.dev docker-compose.yml docker-compose.dev.yml package.json package-lock.json scripts/docker-common.sh; do
    if [ ! -f "$required_file" ]; then
      fail "This release is incomplete: $required_file is missing. Extract a fresh CoralConsole release archive."
    fi
  done
  coral_validate_release_bundle || exit 1
}

prompt_value() {
  label=$1
  default_value=$2
  printf '%s [%s]: ' "$label" "$default_value" >&2
  IFS= read -r entered_value || entered_value=
  if [ -n "$entered_value" ]; then
    printf '%s\n' "$entered_value"
  else
    printf '%s\n' "$default_value"
  fi
}

prompt_yes_no() {
  yes_no_label=$1
  while :; do
    printf '%s [y/N]: ' "$yes_no_label" >&2
    IFS= read -r yes_no_value || yes_no_value=
    case "$yes_no_value" in
      y|Y|yes|YES|Yes) return 0 ;;
      ""|n|N|no|NO|No) return 1 ;;
      *) echo "Enter y or n." >&2 ;;
    esac
  done
}

valid_bind_address() {
  case "$1" in
    ""|*[!A-Za-z0-9._:-]*) return 1 ;;
    *) return 0 ;;
  esac
}

valid_port() {
  case "$1" in
    ""|0|0*|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}

port_reserved_by_other_installation() {
  reserved_value=$1
  container_ids=$(docker ps -aq --filter "label=com.docker.compose.service=coralconsole-ingress")
  [ -n "$container_ids" ] || return 1

  for container_id in $container_ids; do
    container_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null || true)
    if [ -n "${CORAL_PROJECT_NAME:-}" ] && [ "$container_project" = "$CORAL_PROJECT_NAME" ]; then
      continue
    fi
    container_environment=$(docker inspect --format '{{ range .Config.Env }}{{ println . }}{{ end }}' "$container_id" 2>/dev/null || true)
    if printf '%s\n' "$container_environment" | grep -Eq "^(CORAL_INGRESS_PORT|CORAL_UPSTREAM_PORT)=$reserved_value$"; then
      return 0
    fi
  done
  return 1
}

probe_port() {
  probe_host=$1
  probe_value=$2
  if port_reserved_by_other_installation "$probe_value"; then
    return 10
  fi
  if docker run --rm --network host "$PORT_PROBE_IMAGE" node -e "$PORT_PROBE_SCRIPT" "$probe_host" "$probe_value" >/dev/null; then
    return 0
  else
    return $?
  fi
}

find_available_port() {
  find_host=$1
  find_port=$2
  excluded_port=${3:-}
  attempts=0

  while [ "$find_port" -le 65535 ] && [ "$attempts" -lt 1000 ]; do
    if [ -n "$excluded_port" ] && [ "$find_port" = "$excluded_port" ]; then
      find_port=$((find_port + 1))
      attempts=$((attempts + 1))
      continue
    fi

    if probe_port "$find_host" "$find_port"; then
      printf '%s\n' "$find_port"
      return 0
    else
      probe_status=$?
    fi

    case "$probe_status" in
      10) find_port=$((find_port + 1)); attempts=$((attempts + 1)) ;;
      11) return 11 ;;
      *) return 12 ;;
    esac
  done
  return 12
}

choose_bind_address() {
  bind_default=0.0.0.0
  echo "Network access warning: binding to 0.0.0.0 grants full CoralConsole operator access to the entire network that can reach this port." >&2
  while :; do
    chosen_bind=$(prompt_value "Bind address" "$bind_default")
    if ! valid_bind_address "$chosen_bind"; then
      echo "Enter a local address or hostname without spaces." >&2
      continue
    fi

    if candidate=$(find_available_port "$chosen_bind" 3000); then
      CORAL_CHOSEN_BIND=$chosen_bind
      CORAL_PUBLIC_SUGGESTION=$candidate
      return 0
    else
      bind_status=$?
    fi

    if [ "$bind_status" -eq 11 ]; then
      echo "Docker cannot bind to $chosen_bind on this host. Choose one of the host's local addresses." >&2
    else
      fail "Docker could not test ports on $chosen_bind. Confirm that Linux host networking is available."
    fi
  done
}

validate_allowed_clients() {
  validate_clients_value=$1
  docker run --rm --network none \
    -e "CORAL_ALLOWED_CLIENTS=$validate_clients_value" \
    "$PORT_PROBE_IMAGE" \
    node --input-type=module -e \
    'import { createClientAllowlist } from "./scripts/trusted-ingress.mjs"; createClientAllowlist(process.env.CORAL_ALLOWED_CLIENTS);'
}

choose_allowed_clients() {
  CORAL_CHOSEN_ALLOWED_CLIENTS=
  if ! prompt_yes_no "Configure an IP/CIDR client allowlist"; then
    return 0
  fi

  while :; do
    printf '%s' "Allowed client IPs/CIDRs (comma-separated): " >&2
    IFS= read -r allowed_clients_value || allowed_clients_value=
    allowed_clients_value=$(printf '%s' "$allowed_clients_value" | tr -d '[:space:]')
    if [ -z "$allowed_clients_value" ]; then
      echo "Enter at least one IPv4 or IPv6 address or CIDR range." >&2
      continue
    fi
    if validate_allowed_clients "$allowed_clients_value"; then
      CORAL_CHOSEN_ALLOWED_CLIENTS=$allowed_clients_value
      return 0
    fi
    echo "The client allowlist is invalid. Correct the entries and try again." >&2
  done
}

choose_access_key() {
  CORAL_CHOSEN_ACCESS_KEY_HASH=
  CORAL_GENERATED_ACCESS_KEY=
  if ! prompt_yes_no "Generate a random shared access key"; then
    return 0
  fi

  echo "The shared key is not encrypted by plain HTTP; use a trusted TLS proxy outside a private segment." >&2
  CORAL_GENERATED_ACCESS_KEY=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  if ! CORAL_CHOSEN_ACCESS_KEY_HASH=$(printf '%s' "$CORAL_GENERATED_ACCESS_KEY" | \
    docker run --rm -i --network none "$PORT_PROBE_IMAGE" node scripts/hash-access-key.mjs); then
    fail "The bundled image could not hash the generated access key."
  fi
  case "$CORAL_CHOSEN_ACCESS_KEY_HASH" in
    ""|*[!0-9a-f]*)
      fail "The bundled image could not hash the generated access key."
      ;;
  esac
  if [ "${#CORAL_CHOSEN_ACCESS_KEY_HASH}" -ne 64 ]; then
    fail "The bundled image returned an invalid access-key hash."
  fi
}

choose_port() {
  port_label=$1
  port_host=$2
  port_default=$3
  port_excluded=${4:-}

  while :; do
    chosen_port=$(prompt_value "$port_label" "$port_default")
    if ! valid_port "$chosen_port"; then
      echo "Enter a port from 1 through 65535." >&2
      continue
    fi
    if [ -n "$port_excluded" ] && [ "$chosen_port" = "$port_excluded" ]; then
      echo "The public and internal ports must be different." >&2
      continue
    fi

    if probe_port "$port_host" "$chosen_port"; then
      printf '%s\n' "$chosen_port"
      return 0
    else
      chosen_status=$?
    fi

    if [ "$chosen_status" -eq 10 ]; then
      if next_port=$(find_available_port "$port_host" "$((chosen_port + 1))" "$port_excluded"); then
        echo "Port $chosen_port is already in use on $port_host. Suggested available port: $next_port." >&2
        port_default=$next_port
      else
        fail "Port $chosen_port is in use and another available port could not be found automatically."
      fi
    elif [ "$chosen_status" -eq 11 ]; then
      fail "Docker cannot bind to $port_host on this host."
    else
      fail "Docker could not validate port $chosen_port on $port_host."
    fi
  done
}

generate_project_name() {
  while :; do
    suffix=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
    candidate="coralconsole-$suffix"
    if [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$candidate")" ] &&
       [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$candidate")" ] &&
       ! docker image inspect "$candidate:local" >/dev/null 2>&1 &&
       ! docker image inspect "$candidate:dev" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
}

write_environment() {
  environment_path="$project_dir/.env"
  temporary_path="$project_dir/.env.install.$$"
  umask 077
  trap 'rm -f "$temporary_path"' 0 1 2 3 15
  {
    echo "# Generated by CoralConsole install.sh."
    echo "# COMPOSE_PROJECT_NAME is this folder's private Docker namespace."
    echo "COMPOSE_PROJECT_NAME=$CORAL_PROJECT_NAME"
    echo "CORAL_BIND_ADDRESS=$CORAL_CHOSEN_BIND"
    echo "CORAL_PORT=$CORAL_CHOSEN_PUBLIC_PORT"
    echo "CORAL_INTERNAL_PORT=$CORAL_CHOSEN_INTERNAL_PORT"
    echo "CORAL_ALLOWED_CLIENTS=$CORAL_CHOSEN_ALLOWED_CLIENTS"
    echo "CORAL_ACCESS_KEY_HASH=$CORAL_CHOSEN_ACCESS_KEY_HASH"
    echo "CORAL_TRUST_PROXY=false"
    echo "CORAL_DEV_ALLOWED_ORIGINS="
    echo "DATABASE_PATH=.data/coralconsole.db"
  } > "$temporary_path"
  mv "$temporary_path" "$environment_path"
  trap - 0 1 2 3 15
}

configured_image() {
  docker compose config --images | sed -n '1p'
}

start_standard_mode() {
  START_FAILURE_KIND=
  image_name=$(configured_image)
  if [ -z "$image_name" ]; then
    fail "Docker Compose could not resolve the CoralConsole image name from .env."
  fi

  if ! coral_load_release_image "$image_name"; then
    START_FAILURE_KIND=image
    return 1
  fi

  if ! coral_ensure_data_volume; then
    START_FAILURE_KIND=volume
    return 1
  fi

  if ! docker compose up -d --no-build --wait coralconsole coralconsole-ingress; then
    START_FAILURE_KIND=startup
    echo "CoralConsole did not start successfully." >&2
    echo "The trusted ingress requires native Linux host networking, and both configured ports must remain available." >&2
    return 1
  fi

  docker compose ps coralconsole coralconsole-ingress
  public_endpoint=$(docker compose exec -T coralconsole-ingress node -e '
    const host = process.env.CORAL_INGRESS_BIND_ADDRESS || "0.0.0.0";
    const port = process.env.CORAL_INGRESS_PORT || "3000";
    const displayHost = host === "0.0.0.0" ? "<server-address>" : host;
    process.stdout.write(`${displayHost}:${port}`);
  ')
  echo "CoralConsole standard mode is available at http://$public_endpoint"
  echo "Its SQLite database is stored in this installation's private Docker volume."
}

check_prerequisites

if [ -f .env ]; then
  echo "Existing .env found; preserving this installation's configuration."
  if ! docker compose config --quiet; then
    fail "The existing .env or Docker Compose configuration is invalid. Correct it before retrying."
  fi
  PORT_PROBE_IMAGE=$(configured_image)
  start_standard_mode
  exit 0
fi

CORAL_PROJECT_NAME=$(generate_project_name)
PORT_PROBE_IMAGE="$CORAL_PROJECT_NAME:local"
coral_load_release_image "$PORT_PROBE_IMAGE" || fail "Docker could not load the prebuilt CoralConsole image from this package."
echo "Checking the default ports with the bundled image. No external download or application build is required."
choose_bind_address
CORAL_CHOSEN_PUBLIC_PORT=$(choose_port "Public web port" "$CORAL_CHOSEN_BIND" "$CORAL_PUBLIC_SUGGESTION")
internal_suggestion=$(find_available_port 127.0.0.1 39000 "$CORAL_CHOSEN_PUBLIC_PORT") ||
  fail "An available internal loopback port could not be found."
CORAL_CHOSEN_INTERNAL_PORT=$(choose_port "Internal loopback port" 127.0.0.1 "$internal_suggestion" "$CORAL_CHOSEN_PUBLIC_PORT")
choose_allowed_clients
choose_access_key
write_environment
echo "Created this installation's private configuration in .env."
if [ -n "$CORAL_GENERATED_ACCESS_KEY" ]; then
  echo
  echo "CoralConsole shared access key (shown once):"
  echo "$CORAL_GENERATED_ACCESS_KEY"
  echo "Store this key in the installation's approved secret manager. Only its hash was written to .env."
  echo
fi

while ! start_standard_mode; do
  if [ "$START_FAILURE_KIND" = image ]; then
    fail "Installation stopped because Docker could not prepare the bundled image. The generated .env was preserved for another attempt."
  fi
  if [ "$START_FAILURE_KIND" = volume ]; then
    fail "Installation stopped because Docker could not prepare its private database volume. The generated .env was preserved for another attempt."
  fi
  docker compose stop coralconsole-ingress coralconsole >/dev/null 2>&1 || true
  public_port_available=true
  internal_port_available=true
  probe_port "$CORAL_CHOSEN_BIND" "$CORAL_CHOSEN_PUBLIC_PORT" || public_port_available=false
  probe_port 127.0.0.1 "$CORAL_CHOSEN_INTERNAL_PORT" || internal_port_available=false

  if [ "$public_port_available" = true ] && [ "$internal_port_available" = true ]; then
    fail "Startup failed for a reason other than a port collision. The containers were stopped and the database was preserved."
  fi

  echo "A selected port became unavailable during startup. Choose another value to retry." >&2
  if [ "$public_port_available" = false ]; then
    next_public=$(find_available_port "$CORAL_CHOSEN_BIND" "$((CORAL_CHOSEN_PUBLIC_PORT + 1))" "$CORAL_CHOSEN_INTERNAL_PORT") ||
      fail "Another available public port could not be found."
    CORAL_CHOSEN_PUBLIC_PORT=$(choose_port "Public web port" "$CORAL_CHOSEN_BIND" "$next_public" "$CORAL_CHOSEN_INTERNAL_PORT")
  fi
  if [ "$internal_port_available" = false ]; then
    next_internal=$(find_available_port 127.0.0.1 "$((CORAL_CHOSEN_INTERNAL_PORT + 1))" "$CORAL_CHOSEN_PUBLIC_PORT") ||
      fail "Another available internal port could not be found."
    CORAL_CHOSEN_INTERNAL_PORT=$(choose_port "Internal loopback port" 127.0.0.1 "$next_internal" "$CORAL_CHOSEN_PUBLIC_PORT")
  fi
  write_environment
done
