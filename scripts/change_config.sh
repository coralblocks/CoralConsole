#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
. "$project_dir/scripts/docker-common.sh"

fail() {
  echo "$1" >&2
  exit 1
}

read_environment_value() {
  environment_key=$1
  environment_default=$2
  environment_count=$(grep -c "^${environment_key}=" "$project_dir/.env" || true)
  if [ "$environment_count" -gt 1 ]; then
    fail ".env contains more than one $environment_key entry. Correct it before running this script."
  fi
  if [ "$environment_count" -eq 0 ]; then
    printf '%s\n' "$environment_default"
  else
    sed -n "s/^${environment_key}=//p" "$project_dir/.env"
  fi
}

prompt_config_value() {
  config_label=$1
  config_default=$2
  printf '%s [%s]: ' "$config_label" "$config_default" >&2
  IFS= read -r config_entered || config_entered=
  if [ -n "$config_entered" ]; then
    printf '%s\n' "$config_entered"
  else
    printf '%s\n' "$config_default"
  fi
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

valid_access_key_hash() {
  access_hash_value=$1
  [ -z "$access_hash_value" ] && return 0
  case "$access_hash_value" in
    *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#access_hash_value}" -eq 64 ]
}

validate_allowed_clients() {
  allowed_clients_value=$1
  [ -z "$allowed_clients_value" ] && return 0
  docker run --rm --network none \
    -e "CORAL_ALLOWED_CLIENTS=$allowed_clients_value" \
    "$PORT_PROBE_IMAGE" \
    node --input-type=module -e \
    'import { createClientAllowlist } from "./scripts/trusted-ingress.mjs"; createClientAllowlist(process.env.CORAL_ALLOWED_CLIENTS);'
}

port_reserved_by_other_installation() {
  reserved_value=$1
  container_ids=$(docker ps -aq --filter "label=com.docker.compose.service=coralconsole-ingress")
  [ -n "$container_ids" ] || return 1

  for container_id in $container_ids; do
    container_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null || true)
    if [ "$container_project" = "$CORAL_PROJECT_NAME" ]; then
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

resume_original_installation() {
  if [ "$installation_was_running" = true ]; then
    echo "Restarting CoralConsole with its original configuration..." >&2
    if ! sh "$project_dir/scripts/docker-start.sh"; then
      echo "CoralConsole could not be restarted automatically. Its original .env is still intact." >&2
    fi
  fi
}

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

coral_require_environment
coral_require_docker

CORAL_PROJECT_NAME=$(read_environment_value COMPOSE_PROJECT_NAME "")
[ -n "$CORAL_PROJECT_NAME" ] || fail ".env does not contain a valid COMPOSE_PROJECT_NAME."

PORT_PROBE_IMAGE=$(coral_standard_image)
[ -n "$PORT_PROBE_IMAGE" ] || fail "Docker Compose could not resolve this installation's standard image."
coral_load_release_image "$PORT_PROBE_IMAGE"

current_bind=$(read_environment_value CORAL_BIND_ADDRESS 0.0.0.0)
current_public_port=$(read_environment_value CORAL_PORT 3000)
current_internal_port=$(read_environment_value CORAL_INTERNAL_PORT 39000)
current_allowed_clients=$(read_environment_value CORAL_ALLOWED_CLIENTS "")
current_access_key_hash=$(read_environment_value CORAL_ACCESS_KEY_HASH "")

echo "Press Enter to keep each current value. Enter - to clear the optional allowlist or access-key hash."

while :; do
  chosen_bind=$(prompt_config_value "Bind address" "$current_bind")
  if valid_bind_address "$chosen_bind"; then
    break
  fi
  echo "Enter a local address or hostname without spaces." >&2
done

while :; do
  chosen_public_port=$(prompt_config_value "Public web port" "$current_public_port")
  if valid_port "$chosen_public_port"; then
    break
  fi
  echo "Enter a port from 1 through 65535." >&2
done

while :; do
  chosen_internal_port=$(prompt_config_value "Internal loopback port" "$current_internal_port")
  if ! valid_port "$chosen_internal_port"; then
    echo "Enter a port from 1 through 65535." >&2
    continue
  fi
  if [ "$chosen_internal_port" = "$chosen_public_port" ]; then
    echo "The public and internal ports must be different." >&2
    continue
  fi
  break
done

while :; do
  chosen_allowed_clients=$(prompt_config_value "Allowed client IPs/CIDRs (comma-separated)" "$current_allowed_clients")
  if [ "$chosen_allowed_clients" = - ]; then
    chosen_allowed_clients=
  else
    chosen_allowed_clients=$(printf '%s' "$chosen_allowed_clients" | tr -d '[:space:]')
  fi
  if validate_allowed_clients "$chosen_allowed_clients"; then
    break
  fi
  echo "The client allowlist is invalid. Correct the entries and try again." >&2
done

generated_access_key=
while :; do
  chosen_access_key_hash=$(prompt_config_value "Access-key SHA-256 hash (64 hex; type generate for a new key)" "$current_access_key_hash")
  if [ "$chosen_access_key_hash" = - ]; then
    chosen_access_key_hash=
  elif [ "$chosen_access_key_hash" = generate ]; then
    generated_access_key=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    if ! chosen_access_key_hash=$(printf '%s' "$generated_access_key" | \
      docker run --rm -i --network none "$PORT_PROBE_IMAGE" node scripts/hash-access-key.mjs); then
      fail "The bundled image could not hash the generated access key."
    fi
  else
    chosen_access_key_hash=$(printf '%s' "$chosen_access_key_hash" | tr '[:upper:]' '[:lower:]')
  fi
  if valid_access_key_hash "$chosen_access_key_hash"; then
    break
  fi
  echo "Enter a 64-character hexadecimal SHA-256 hash, generate, or - to disable the access gate." >&2
done

if [ "$chosen_bind" = 0.0.0.0 ]; then
  echo "Network access warning: 0.0.0.0 grants full CoralConsole operator reachability to every network that can reach the public port." >&2
fi

if [ "$chosen_bind" = "$current_bind" ] &&
   [ "$chosen_public_port" = "$current_public_port" ] &&
   [ "$chosen_internal_port" = "$current_internal_port" ] &&
   [ "$chosen_allowed_clients" = "$current_allowed_clients" ] &&
   [ "$chosen_access_key_hash" = "$current_access_key_hash" ]; then
  echo "No configuration changes were requested."
  exit 0
fi

temporary_path="$project_dir/.env.change.$$"
backup_path="$project_dir/.env.change-backup.$$"
cleanup() {
  rm -f "$temporary_path" "$backup_path"
}
trap cleanup 0 1 2 3 15
umask 077

awk \
  -v bind="$chosen_bind" \
  -v public_port="$chosen_public_port" \
  -v internal_port="$chosen_internal_port" \
  -v allowed_clients="$chosen_allowed_clients" \
  -v access_key_hash="$chosen_access_key_hash" '
  /^CORAL_BIND_ADDRESS=/ { print "CORAL_BIND_ADDRESS=" bind; seen_bind = 1; next }
  /^CORAL_PORT=/ { print "CORAL_PORT=" public_port; seen_public = 1; next }
  /^CORAL_INTERNAL_PORT=/ { print "CORAL_INTERNAL_PORT=" internal_port; seen_internal = 1; next }
  /^CORAL_ALLOWED_CLIENTS=/ { print "CORAL_ALLOWED_CLIENTS=" allowed_clients; seen_allowed = 1; next }
  /^CORAL_ACCESS_KEY_HASH=/ { print "CORAL_ACCESS_KEY_HASH=" access_key_hash; seen_access = 1; next }
  { print }
  END {
    if (!seen_bind) print "CORAL_BIND_ADDRESS=" bind
    if (!seen_public) print "CORAL_PORT=" public_port
    if (!seen_internal) print "CORAL_INTERNAL_PORT=" internal_port
    if (!seen_allowed) print "CORAL_ALLOWED_CLIENTS=" allowed_clients
    if (!seen_access) print "CORAL_ACCESS_KEY_HASH=" access_key_hash
  }
' "$project_dir/.env" > "$temporary_path"
chmod 600 "$temporary_path"

if ! docker compose --env-file "$temporary_path" config --quiet; then
  fail "The selected values do not produce a valid Docker Compose configuration. .env was not changed."
fi

installation_was_running=false
if [ -n "$(docker compose ps --status running -q coralconsole coralconsole-ingress)" ]; then
  installation_was_running=true
fi

network_changed=false
if [ "$chosen_bind" != "$current_bind" ] ||
   [ "$chosen_public_port" != "$current_public_port" ] ||
   [ "$chosen_internal_port" != "$current_internal_port" ]; then
  network_changed=true
fi

if [ "$network_changed" = true ] && [ "$installation_was_running" = true ]; then
  echo "Stopping CoralConsole briefly to validate the new listeners..."
  docker compose stop coralconsole-ingress coralconsole
fi

if [ "$network_changed" = true ]; then
  if probe_port "$chosen_bind" "$chosen_public_port"; then
    :
  else
    probe_status=$?
    resume_original_installation
    case "$probe_status" in
      10) fail "Public port $chosen_public_port is already in use on $chosen_bind. .env was not changed." ;;
      11) fail "Docker cannot bind to $chosen_bind on this host. .env was not changed." ;;
      *) fail "Docker could not validate public port $chosen_public_port on $chosen_bind. .env was not changed." ;;
    esac
  fi
  if probe_port 127.0.0.1 "$chosen_internal_port"; then
    :
  else
    probe_status=$?
    resume_original_installation
    case "$probe_status" in
      10) fail "Internal port $chosen_internal_port is already in use on 127.0.0.1. .env was not changed." ;;
      *) fail "Docker could not validate internal port $chosen_internal_port on 127.0.0.1. .env was not changed." ;;
    esac
  fi
fi

cp -p "$project_dir/.env" "$backup_path"
mv "$temporary_path" "$project_dir/.env"

if [ "$installation_was_running" = true ]; then
  echo "Applying the new configuration..."
  if ! sh "$project_dir/scripts/docker-start.sh"; then
    echo "The new configuration did not start successfully. Restoring the original .env..." >&2
    mv "$backup_path" "$project_dir/.env"
    if ! sh "$project_dir/scripts/docker-start.sh"; then
      echo "The original configuration was restored, but CoralConsole could not be restarted automatically." >&2
    fi
    exit 1
  fi
else
  echo "The installation was stopped, so it remains stopped. Run ./scripts/docker-start.sh when ready."
fi

rm -f "$backup_path"
trap - 0 1 2 3 15
echo "Updated CoralConsole configuration in .env."

if [ -n "$generated_access_key" ]; then
  echo
  echo "CoralConsole shared access key (shown once):"
  echo "$generated_access_key"
  echo "Store this key in the installation's approved secret manager. Only its hash was written to .env."
  echo
fi
