#!/usr/bin/env bash
# Plays the Orbital's sounds on this machine, through PipeWire.
#   audition.sh theme     the theme with the login intro, on an empty workspace
#   audition.sh <id>      one motif (ids in out/motifs.json)
#   audition.sh all       every motif in turn, with its name
set -euo pipefail
out="$(cd "$(dirname "$0")" && pwd)/out"
[[ -f $out/theme.wav ]] || node "$(dirname "$0")/render.js" >/dev/null

case "${1:-all}" in
  theme)
    hyprctl dispatch 'hl.dsp.focus({ workspace = "empty" })' >/dev/null
    sleep 0.4
    omarchy-shell orbital intro >/dev/null &
    pw-play "$out/theme.wav"
    ;;
  all)
    for id in $(jq -r '.[].id' "$out/motifs.json"); do
      [[ $id == theme ]] && continue
      printf '%-14s %s\n' "$id" "$(jq -r --arg id "$id" '.[] | select(.id == $id) | .when' "$out/motifs.json")"
      pw-play "$out/$id.wav"
      sleep 0.6
    done
    ;;
  *)
    pw-play "$out/$1.wav"
    ;;
esac
