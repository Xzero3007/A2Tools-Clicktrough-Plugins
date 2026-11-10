#!/usr/bin/env bash
# Clicktrough build: the Market plugin's tests (its sums on the data).
#
#   dev/ci.sh <meter source folder>   (the meter isn't needed: the prices come
#                                      through plugins::plugin_web_get, whose
#                                      own tests run with the meter's)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$here")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# A copy outside the meter: its package.json sets "type": "module", and Node
# would then read the scripts as modules instead of classic scripts.
mkdir "$work/plugin"
cp "$plugin"/*.js "$work/plugin/"
cp -r "$here/tests" "$work/tests"
python3 -I "$here/tests/test_history.py"
PLUGIN_DIR="$work/plugin" node --test "$work"/tests/*.test.cjs
# anomaly.js is the same file in the Inventory plugin.
cmp -s "$plugin/anomaly.js" "$plugin/../inventory/anomaly.js" || { echo "plugins/inventory/anomaly.js differs from plugins/market/anomaly.js" >&2; exit 1; }
