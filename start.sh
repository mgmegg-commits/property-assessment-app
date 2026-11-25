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

# Settings for this computer: created once, with a new database password.
if [ ! -f .env ]; then
  password=$(openssl rand -hex 24 2>/dev/null || LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 48)
  sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${password}/" .env.example > .env
  echo "Created .env with this computer's settings."
fi
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

echo "Starting Cecil's Report Builder (the first time takes a few minutes)…"
docker compose up -d --build --wait

cat <<EOF

Cecil's Report Builder is running, with test data.

  On this computer:         http://localhost:${APP_PORT}
  On an iPad or iPhone:     ${PRIMARY_URL}
    (same Wi-Fi; the first time on each device, open http://${device_host}:${SETUP_PORT} and follow the steps)

Stop it with ./stop.sh. Your test data is kept for next time.
EOF
