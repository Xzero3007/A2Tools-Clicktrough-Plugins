#!/usr/bin/env bash
# Clicktrough build: checks Closet against the plugin decoder of the meter
# version it ships with (src-tauri/src/plugins/decoder.rs, unchanged), with
# frames built from the layouts (no capture), and runs its logic tests.
#
#   dev/ci.sh <meter source folder>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$here")"
meter="$(cd "$1" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Pet Finder's decoder runner (the meter's decoder.rs, run as the meter does).
cp -r "$plugin/../pet-finder/dev/decoder-check" "$work/decoder-check"
cp "$meter/src-tauri/src/plugins/decoder.rs" "$work/decoder-check/src/decoder.rs"
cargo build -q --manifest-path "$work/decoder-check/Cargo.toml" --target-dir "$work/target"
D="$work/target/debug/decoder-check"

mkdir "$work/plugin"
cp "$plugin"/*.js "$plugin/manifest.json" "$work/plugin/"
cp -r "$here/tests" "$work/tests"
cd "$work/tests"
python3 -I frames.py
"$D" "$work/plugin/manifest.json" < frames.txt > events.jsonl
PLUGIN_DIR="$work/plugin" node --test logic.test.cjs
