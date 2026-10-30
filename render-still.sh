#!/usr/bin/env bash
# Renders a still Orbital frame with the same shader and camera as the live background.
#   render-still.sh out.png [width height] [json-overrides] [scene-time]
# ORBITAL_WEATHER='{"cover":90,"code":63}' previews a weather (see weatherLook in Scene.js).
# ORBITAL_BENCH=N also times N frames.
set -euo pipefail
kit="$(cd "$(dirname "$0")" && pwd)"
out="$(realpath -m "${1:-$kit/orbital.png}")"
export ORBITAL_WEATHER="${ORBITAL_WEATHER:-null}" ORBITAL_OUT="$out" ORBITAL_W="${2:-1920}" ORBITAL_H="${3:-1080}" ORBITAL_PARAMS="${4:-{\}}" ORBITAL_T="${5:-0}"
rm -f "$out"
timeout 120 quickshell -p "$kit/shader/still.qml" 2>&1 | grep -E "orbital frame|ERROR|rror|WARN" | grep -v "Hyprland IPC" || true
[[ -s $out ]] && echo "$out" || { echo "render failed" >&2; exit 1; }
