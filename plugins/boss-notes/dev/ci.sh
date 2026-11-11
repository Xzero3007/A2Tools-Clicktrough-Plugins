#!/usr/bin/env bash
# Clicktrough build: the Boss Notes plugin's tests (which boss, phases by HP,
# time, casts and buffs, alerts, what a fight records, the starter sheets).
#
#   dev/ci.sh [meter source folder]   (not needed: the decoders are Enhanced
#                                      Boss Telegraph's, checked there)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$here")"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$plugin/manifest.json"
for f in "$plugin"/*.js; do node --check "$f"; done
PLUGIN_DIR="$plugin" node --test "$here"/tests/*.test.cjs
