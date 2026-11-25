#!/usr/bin/env bash
# Stops Cecil's Report Builder on this computer. The test data is kept;
# ./start.sh brings it back.
set -euo pipefail
cd "$(dirname "$0")"
docker compose stop
echo "Stopped. Your test data is kept; run ./start.sh to start again."
