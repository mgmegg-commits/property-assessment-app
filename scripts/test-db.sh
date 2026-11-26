#!/usr/bin/env bash
# Starts a throwaway PostgreSQL server for the tests, on port 55432.
# Its data lives in memory and is gone when the container stops.
#   ./scripts/test-db.sh        start (or keep running)
#   ./scripts/test-db.sh stop   stop and remove it
set -euo pipefail

NAME=crb-test-db
PORT=${TEST_DB_PORT:-55432}

if [ "${1:-}" = "stop" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "Test database stopped."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start Docker (Docker Desktop on a Mac) and try again." >&2
  exit 1
fi

if [ -z "$(docker ps -q --filter "name=^${NAME}$")" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" \
    -e POSTGRES_PASSWORD=postgres --tmpfs /var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
fi

for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then
    echo "Test database ready: postgres://postgres:postgres@127.0.0.1:${PORT}/postgres"
    exit 0
  fi
  sleep 1
done
echo "The test database didn't start within a minute." >&2
exit 1
