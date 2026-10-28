#!/usr/bin/env bash
# Clicktrough build: the Map plugin's tests (marks, map choice, data).
#
#   dev/ci.sh <meter source folder>   (the meter isn't needed: the plugin's
#                                      world comes from plugins/world.rs,
#                                      whose own tests run with the meter's)
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
PLUGIN_DIR="$work/plugin" node --test "$work"/tests/*.test.cjs
