#!/usr/bin/env bash
# Clicktrough build: the Inventory plugin's tests (its sums on the data).
#
#   dev/ci.sh <meter source folder>   (the items and prices come through capture::items and
#                                      plugins::plugin_web_get, whose own tests run with the
#                                      meter's; the gathering decoder is checked here with the
#                                      meter's own decoder.rs, as Pet Finder's are)
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
if [ -n "${1:-}" ] && [ -f "$1/src-tauri/src/plugins/decoder.rs" ]; then
  cp -r "$plugin/../pet-finder/dev/decoder-check" "$work/decoder-check"
  cp "$1/src-tauri/src/plugins/decoder.rs" "$work/decoder-check/src/decoder.rs"
  cargo build -q --manifest-path "$work/decoder-check/Cargo.toml" --target-dir "$work/target"
  "$work/target/debug/decoder-check" "$plugin/manifest.json" < "$here/tests/gather-frames.txt" > "$work/tests/gather-events.jsonl"
fi
PLUGIN_DIR="$work/plugin" node --test "$work"/tests/*.test.cjs
