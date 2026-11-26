#!/usr/bin/env bash
# Starts Cecil's Report Builder on this computer, with test data.
# Needs Docker (Docker Desktop on a Mac). Run it again any time: it keeps your
# test data and rebuilds the app if the code changed. Stop it with ./stop.sh.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker isn't installed. Install Docker Desktop (https://www.docker.com/products/docker-desktop/), open it, then run ./start.sh again." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Open Docker Desktop, wait until it says it's running, then run ./start.sh again." >&2
  exit 1
fi

random() { LC_ALL=C tr -dc "$1" </dev/urandom 2>/dev/null | head -c "$2" || true; }

# Settings for this computer: created once, with new passwords and secrets.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env with this computer's settings."
fi
# Fill in anything missing (an .env from an earlier version may not have them).
fill() {
  local key=$1 value=$2
  if grep -q "^${key}=." .env; then return; fi
  if grep -q "^${key}=" .env; then
    sed "s|^${key}=.*|${key}=${value}|" .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
fill POSTGRES_PASSWORD "$(random 'a-f0-9' 48)"
fill APP_PASSWORD "$(random 'a-km-zA-HJ-NP-Z2-9' 12)"
fill SESSION_SECRET "$(random 'a-f0-9' 64)"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
APP_PORT=${APP_PORT:-8080}
HTTPS_PORT=${HTTPS_PORT:-8443}
SETUP_PORT=${SETUP_PORT:-8081}

# This computer's name and address on the network, for iPads and iPhones.
lan_host=""
lan_ip=""
case "$(uname -s)" in
  Darwin)
    name=$(scutil --get LocalHostName 2>/dev/null || true)
    [ -n "$name" ] && lan_host="${name}.local"
    iface=$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}' || true)
    lan_ip=$(ipconfig getifaddr "${iface:-en0}" 2>/dev/null || true)
    ;;
  Linux)
    lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    ;;
esac

# Caddy listens on 8443 inside its container, whichever port this computer uses.
sites="https://localhost:8443"
[ -n "$lan_host" ] && sites="${sites}, https://${lan_host}:8443"
[ -n "$lan_ip" ] && sites="${sites}, https://${lan_ip}:8443"
device_host=${lan_host:-${lan_ip:-localhost}}
export SITE_ADDRESSES="$sites"
export PRIMARY_URL="https://${device_host}:${HTTPS_PORT}"
# A device that opens the app by IP address sends no server name, so Caddy needs a default.
export DEFAULT_SNI="${lan_ip:-localhost}"
# Personal update links point phones at this computer's HTTPS address.
export PUBLIC_URL="${PRIMARY_URL}"

echo "Starting Cecil's Report Builder (the first time takes a few minutes)…"
docker compose up -d --build --wait

# Caddy can take a moment to answer after its container starts; wait for it.
if command -v curl >/dev/null 2>&1; then
  for _ in $(seq 1 30); do
    curl --noproxy '*' --silent --fail --output /dev/null "http://localhost:${APP_PORT}/api/health" && break
    sleep 1
  done
fi

cat <<EOF

Cecil's Report Builder is running.

  On this computer:         http://localhost:${APP_PORT}
  On an iPad or iPhone:     ${PRIMARY_URL}
    (same Wi-Fi; the first time on each device, open http://${device_host}:${SETUP_PORT} and follow the steps)
  Password:                 ${APP_PASSWORD}   (in .env as APP_PASSWORD)
  Follow-up:                http://localhost:${APP_PORT}/follow-up

Stop it with ./stop.sh. Your test data is kept for next time.
EOF
