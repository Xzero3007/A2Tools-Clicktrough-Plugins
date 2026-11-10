#!/usr/bin/env bash
# Clicktrough build: the Streams plugin's tests (its lists and words).
# Playing, Twitch's queries and FreeTube's file are the meter's
# (plugins/video.rs, meter patch 0047), tested with the meter.
#
#   dev/ci.sh [<meter source folder>]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$(dirname "$here")"
PLUGIN_DIR="$plugin" node --test "$here"/tests/*.test.cjs
