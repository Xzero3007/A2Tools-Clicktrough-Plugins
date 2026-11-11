#!/usr/bin/env bash
# bosses.js is Enhanced Boss Telegraph's (A2 Tools, GPL-3.0), built from the
# game's tables: copy it again from the original's plugins as this build pins
# them (../ct-plugins after dev/setup.sh), then raise the version.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${1:-$here/../../../../ct-plugins/plugins/boss-telegraph/bosses.js}"
cp "$src" "$here/../bosses.js"
echo "bosses.js copied from $src"
