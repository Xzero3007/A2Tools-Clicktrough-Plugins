#!/usr/bin/env bash
# The working clones for plugin work, next to this repo (or $WORKSPACE_DIR):
#
#   ct-plugins                       taengu/A2Tools-Plugins at original/PIN with
#                                    original/pins.txt and every
#                                    original/<id>/*.patch, branch ct-patches
#                                    (build/assemble.sh); tag ct-base where the
#                                    patches start
#   a2tools-dps-meter_clicktrough    the app repo (with --meter or --build)
#   ct-src                           the meter's source with the app's patches
#                                    (with --meter or --build): for the own
#                                    plugins' tests, plugins/<id>/dev/ci.sh ../ct-src
#
#   bash dev/setup.sh            ct-plugins
#   bash dev/setup.sh --meter    and the app repo and ct-src (~1 min)
#   bash dev/setup.sh --build    and a debug meter with these plugins in it
#                                (minutes), run by the app's run-meter.sh
#
# Nothing is ever pushed from ct-plugins or ct-src: they are the original's.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
ws="${WORKSPACE_DIR:-$(dirname "$here")}"
meter=0 build=0
for a in "$@"; do
  case "$a" in
    --meter) meter=1 ;;
    --build) meter=1; build=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done
export GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com

up="$ws/ct-plugins"
if [ ! -d "$up/.git" ]; then
  git clone -q https://github.com/taengu/A2Tools-Plugins.git "$up"
fi
if [ -n "$(git -C "$up" status --porcelain --untracked-files=no)" ]; then
  echo "$up has changes not committed: commit them (and export the patches), or discard them." >&2
  exit 1
fi
git -C "$up" fetch -q origin
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
bash "$here/build/assemble.sh" "$up" "$tmp/ct-plugins" | sed 's/^/    /'
echo "==> $up: branch ct-patches, $(git -C "$up" rev-list --count ct-base..HEAD) patch commits on ct-base"

if [ "$meter" = 1 ]; then
  app="$ws/a2tools-dps-meter_clicktrough"
  if [ ! -d "$app/.git" ]; then
    git clone -q https://github.com/Xzero3007/A2Tools-DPS-Meter_Clicktrough.git "$app"
  fi
  args=()
  [ "$build" = 1 ] && args+=(--build)
  PLUGINS_REPO="$here" bash "$app/clicktrough/dev/setup-workspace.sh" "${args[@]}"
fi
