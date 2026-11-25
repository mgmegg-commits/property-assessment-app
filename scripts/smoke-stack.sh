#!/usr/bin/env bash
# Checks the whole stack the way a person starts it: copies this checkout to a
# temporary folder (so your own .env and test data are untouched), runs
# ./start.sh there on spare ports, checks every address answers, then removes
# everything it made. CI runs this on every pull request.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
export COMPOSE_PROJECT_NAME=crb-smoke

cleanup() {
  status=$?
  if [ "${SMOKE_KEEP:-}" = "1" ]; then echo "Left running in $work (SMOKE_KEEP=1)."; exit $status; fi
  if [ $status -ne 0 ] && [ -f "$work/compose.yaml" ]; then
    (cd "$work" && docker compose logs --no-color --tail 80) || true
  fi
  if [ -f "$work/compose.yaml" ]; then
    (cd "$work" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true
  fi
  rm -rf "$work"
  exit $status
}
trap cleanup EXIT

# A clean copy of what's committed or staged, plus any working changes.
(cd "$here" && git ls-files -co --exclude-standard -z | xargs -0 -I{} cp --parents {} "$work/" 2>/dev/null) || cp -R "$here/." "$work/"
cd "$work"
cat > .env <<EOF
APP_ENV=development
LOAD_FIXTURES=1
POSTGRES_PASSWORD=smoke$(date +%s)
APP_PORT=18080
HTTPS_PORT=18443
SETUP_PORT=18081
EOF

./start.sh

fail() { echo "FAILED: $*" >&2; exit 1; }
check() {
  local what=$1 expected=$2; shift 2
  local body
  body=$(curl --noproxy "*" --silent --show-error --fail --max-time 10 "$@") || fail "$what didn't answer"
  grep -q -- "$expected" <<<"$body" || fail "$what didn't contain '$expected': $body"
  echo "ok: $what"
}

check "the app on this computer (HTTP)" '"database":"ok"' http://localhost:18080/api/health
check "the start page" '<div id="root">' http://localhost:18080/
check "the test data" 'Cecil Ingram Properties LLC' http://localhost:18080/api/dev/summary
check "the set-up page" 'Download the certificate' http://localhost:18081/

curl --silent --show-error --fail --max-time 10 -o "$work/root.crt" http://localhost:18081/certificate.crt || fail "the certificate didn't download"
grep -q "BEGIN CERTIFICATE" "$work/root.crt" || fail "the certificate download isn't a certificate"
echo "ok: the certificate downloads"

# HTTPS, trusting only the copy's own certificate authority, as an iPad would after set-up.
check "the app over HTTPS" '"database":"ok"' --cacert "$work/root.crt" https://localhost:18443/api/health

# iOS offers to install the certificate only when it's sent as a certificate.
curl --silent --fail --max-time 10 -o /dev/null -w '%{content_type}' http://localhost:18081/certificate.crt | grep -q 'application/x-x509-ca-cert' || fail "the certificate isn't sent as application/x-x509-ca-cert"
echo "ok: the certificate is sent as a certificate"

# HTTPS at this computer's network address, as an iPad on the same Wi-Fi uses it.
case "$(uname -s)" in
  Darwin) lan_ip=$(ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')" 2>/dev/null || true) ;;
  *) lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true) ;;
esac
if [ -n "$lan_ip" ]; then
  check "the app over HTTPS at $lan_ip" '"database":"ok"' --cacert "$work/root.crt" "https://$lan_ip:18443/api/health"
fi

# The plain-HTTP port is for this computer only.
docker compose port caddy 8080 | grep -q '^127.0.0.1:' || fail "the HTTP port is open beyond this computer"
echo "ok: the HTTP port is published on 127.0.0.1 only"

echo "The stack works."
