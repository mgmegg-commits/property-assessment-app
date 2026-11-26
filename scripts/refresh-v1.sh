#!/usr/bin/env bash
# Rebuilds v1's front end from a v1 commit into apps/v1-web/, and refreshes
# v1's server tests (and the v1 model files they import) in tests/v1-server/.
# Nothing in the v1 repo is changed: it's cloned into a temporary folder.
#
#   scripts/refresh-v1.sh <v1 commit>
#
# V1_REPO overrides where v1 is cloned from (a URL or a local checkout).
# Afterwards: run the tests (npm run test:all), then commit apps/v1-web and
# tests/v1-server together.
set -euo pipefail
commit=${1:?"Usage: scripts/refresh-v1.sh <v1 commit>"}
repo=${V1_REPO:-https://github.com/mgmegg-commits/cecil-report-app.git}
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Cloning v1 from $repo…"
git clone --quiet --no-checkout "$repo" "$work/v1"
git -C "$work/v1" checkout --quiet "$commit"
full=$(git -C "$work/v1" rev-parse HEAD)

echo "Building v1 at ${full:0:7}…"
(cd "$work/v1" && npm ci --no-audit --no-fund --ignore-scripts >/dev/null && node scripts/build.mjs >/dev/null)

# The page: v1's own build output, unchanged.
mkdir -p "$here/apps/v1-web"
cp "$work/v1/dist/web/index.html" "$here/apps/v1-web/index.html"
node - "$here/apps/v1-web" "$full" "$(git -C "$work/v1" log -1 --format=%cI)" "$(git -C "$work/v1" log -1 --format=%s)" <<'NODE'
const [dir, commit, committedAt, subject] = process.argv.slice(2);
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const page = readFileSync(`${dir}/index.html`);
const version = {
  repo: "mgmegg-commits/cecil-report-app",
  commit,
  committedAt,
  subject,
  file: "index.html",
  sha256: createHash("sha256").update(page).digest("hex"),
  bytes: page.length,
  builtWith: "npm ci && node scripts/build.mjs (dist/web/index.html)",
};
writeFileSync(`${dir}/VERSION.json`, JSON.stringify(version, null, 2) + "\n");
NODE

# v1's server tests, run against v2 through tests/v1-server/server/app.js.
rm -rf "$here/tests/v1-server/tests" "$here/tests/v1-server/src"
mkdir -p "$here/tests/v1-server/tests" "$here/tests/v1-server/src/js/model" "$here/tests/v1-server/src/js/util"
cp "$work/v1/tests/server.test.mjs" "$here/tests/v1-server/tests/"
cp "$work/v1/src/js/model/"*.js "$here/tests/v1-server/src/js/model/"
cp "$work/v1/src/js/util/ids.js" "$work/v1/src/js/util/format.js" "$here/tests/v1-server/src/js/util/"
printf '%s\n' "$full" > "$here/tests/v1-server/V1_COMMIT"

echo "Done: apps/v1-web and tests/v1-server are from v1 ${full}."
