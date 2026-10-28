#!/usr/bin/env bash
# Clicktrough build: the Armory plugin's tests (its sums on the game's
# enhance tables, its reading of NC's pages and of a saved questlog.gg page).
#
#   dev/ci.sh <meter source folder>   (the meter isn't needed: NC's pages
#                                      come through plugins::plugin_web_get
#                                      and _web_image, whose own tests run
#                                      with the meter's)
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
