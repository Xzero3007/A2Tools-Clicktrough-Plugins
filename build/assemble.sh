#!/usr/bin/env bash
# Clicktrough: the plugins the meter's package ships (its data/ct-plugins),
# put together from this repo. The release workflow of
# Xzero3007/A2Tools-DPS-Meter_Clicktrough runs it, and so do the app's
# setup-workspace.sh (--build) and a2tools-rebuild.sh, so all three ship the
# same.
#
#   build/assemble.sh <clone of taengu/A2Tools-Plugins> <dest>
#
# The clone needs its whole history (`git am -3` merges a patch made on an
# older version of a plugin). It is left on branch ct-patches: the original's
# plugins at original/PIN, the plugins named in original/pins.txt at their own
# commit, and each original/<id>/*.patch applied. Into <dest> (emptied first):
#   <id>/                 each plugin the package ships
#   installed-only.txt    the original's plugins that run only where installed
#                         (all of them unless original/<id>/ changes one
#                         without an `installed-only` file)
#   left-out.txt          the original's plugins never shipped or run
#                         (original/left-out.txt; the meter's patch 0026)
# This repo's own plugins (plugins/<id>) go in whole, without dev/.
# Prints each plugin with its version.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
up="$(cd "$1" && pwd)"
dest="$2"
# Patch commits: the patch author, the committer as set outside (or this).
who=(-c user.name="${GIT_AUTHOR_NAME:-A2Tools-patch}" -c user.email="${GIT_AUTHOR_EMAIL:-patch@localhost}")
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Clicktrough}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-clicktrough@users.noreply.github.com}"

pin="$(sed -n '1{s/[^0-9a-f]//g;p}' "$here/original/PIN")"
left_out() { sed '/^#/d;/^$/d' "$here/original/left-out.txt"; }

git -C "$up" am --abort >/dev/null 2>&1 || true
git -C "$up" checkout -q -f -B ct-patches "$pin"

# Plugins taken at a commit of their own.
while read -r id sha _; do
  case "$id" in ''|\#*) continue ;; esac
  git -C "$up" rm -r -q --ignore-unmatch "plugins/$id"
  git -C "$up" checkout -q "$sha" -- "plugins/$id"
  git -C "$up" "${who[@]}" commit -q -m "$id at ${sha:0:7} (original/pins.txt)"
done < "$here/original/pins.txt"

# Where the patches start: dev/export-patches.sh writes them from here.
git -C "$up" tag -f ct-base >/dev/null

# The changed plugins' patches. -3: a change upstream next to a patched
# line merges instead of failing (only a real conflict still stops it).
for d in "$here"/original/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  set -- "$d"*.patch
  [ -e "$1" ] || continue
  if ! git -C "$up" "${who[@]}" am -3 -q "$@"; then
    git -C "$up" am --abort >/dev/null 2>&1 || true
    echo "The patches of $id don't apply to the original's plugin (original/PIN, original/pins.txt)." >&2
    exit 1
  fi
done

rm -rf "$dest"
mkdir -p "$dest"
: > "$dest/installed-only.txt"
left_out > "$dest/left-out.txt"

# The original's plugins: the changed ones, then the others as they are
# (each runs only where installed, the meter's patch 0020). Not one held back
# by its author, left out here, or with an own plugin's id.
for d in "$up"/plugins/*/; do
  id=$(basename "$d")
  [ -f "$d/manifest.json" ] || continue
  [ -e "$d/.unpublished" ] && continue
  left_out | grep -qx "$id" && continue
  [ -e "$here/plugins/$id" ] && continue
  cp -r "$d" "$dest/$id"
  if [ ! -d "$here/original/$id" ] || [ -e "$here/original/$id/installed-only" ]; then
    echo "$id" >> "$dest/installed-only.txt"
  fi
  echo "$id $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$d/manifest.json" | head -n1)$([ -d "$here/original/$id" ] && echo " (changed)")"
done

# This repo's own plugins.
for d in "$here"/plugins/*/; do
  [ -f "$d/manifest.json" ] || continue
  id=$(basename "$d")
  mkdir -p "$dest/$id"
  cp -r "$d/." "$dest/$id/"
  # Developer tools and tests don't go into the package.
  rm -rf "$dest/$id/dev"
  echo "$id $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$d/manifest.json" | head -n1) (own)"
done
