#!/usr/bin/env bash
# Write the patches of the original's plugins again from ../ct-plugins
# (branch ct-patches, from tag ct-base, as dev/setup.sh left it): one
# original/<id>/NNNN-*.patch per commit that touches plugins/<id>. A plugin's
# `installed-only` file stays.
#
#   bash dev/export-patches.sh [<id> ...]     (no id: every patched plugin)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
up="${WORKSPACE_DIR:-$(dirname "$here")}/ct-plugins"
ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  mapfile -t ids < <(git -C "$up" diff --name-only ct-base..HEAD -- plugins/ | cut -d/ -f2 | sort -u)
fi
for id in "${ids[@]}"; do
  mkdir -p "$here/original/$id"
  rm -f "$here/original/$id"/*.patch
  n=0
  for c in $(git -C "$up" rev-list --reverse ct-base..HEAD -- "plugins/$id"); do
    n=$((n + 1))
    git -C "$up" format-patch -q --start-number "$n" -1 "$c" -o "$here/original/$id/"
  done
  echo "$id: $n patch(es)"
done
