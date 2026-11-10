#!/usr/bin/env bash
# Clicktrough build: the Shugo Cards plugin's tests (the round's layout, what
# is kept, worth and statistics).
#
#   dev/ci.sh <meter source folder>   (with it, the round decoder runs through
#                                      the meter's own decoder.rs, as Pet
#                                      Finder's do; it needs the meter's
#                                      "rest" field, patch 0042)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$here")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# data.js and anomaly.js are the Inventory plugin's files.
for f in data.js anomaly.js; do
  cmp -s "$plugin/$f" "$plugin/../inventory/$f" || { echo "plugins/shugo-cards/$f differs from plugins/inventory/$f (copy it over)" >&2; exit 1; }
done
mkdir "$work/plugin"
cp "$plugin"/*.js "$work/plugin/"
cp -r "$here/tests" "$work/tests"
(cd "$work/tests" && python3 -I frames.py)
if [ -n "${1:-}" ] && [ -f "$1/src-tauri/src/plugins/decoder.rs" ]; then
  cp -r "$plugin/../pet-finder/dev/decoder-check" "$work/decoder-check"
  rm -rf "$work/decoder-check/target"
  cp "$1/src-tauri/src/plugins/decoder.rs" "$work/decoder-check/src/decoder.rs"
  cargo build -q --manifest-path "$work/decoder-check/Cargo.toml" --target-dir "$work/target"
  "$work/target/debug/decoder-check" "$plugin/manifest.json" < "$work/tests/round-frames.txt" > "$work/tests/round-events.jsonl"
fi
PLUGIN_DIR="$work/plugin" node --test "$work"/tests/*.test.cjs
