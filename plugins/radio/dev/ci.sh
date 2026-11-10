#!/usr/bin/env bash
# Clicktrough build: the Radio plugin's tests (the station list and the
# helpers). With the meter's source, also that every stream's server is one
# the meter lets the plugin play from (RADIO_HOSTS, meter patch 0043).
#
#   dev/ci.sh [<meter source folder>]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$here")"
meter=""
if [ -n "${1:-}" ] && [ -f "$1/src-tauri/src/plugins/mod.rs" ]; then
  meter="$1/src-tauri/src/plugins/mod.rs"
fi
PLUGIN_DIR="$plugin" METER_PLUGINS_RS="$meter" node --test "$here"/tests/*.test.cjs
