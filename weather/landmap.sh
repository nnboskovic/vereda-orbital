#!/usr/bin/env bash
# Renders the maps the weather simulation runs on, with the wallpaper's own shader so they are
# exactly what's drawn: the band unrolled to 3016 x 104 cells of 25 km, drawn at about twice that
# and averaged down. land.png: red land, green the continents' height, blue fine detail.
# towns.png beside it: red where people live (the cities the air routes join), green land.
#   landmap.sh [land.png]
set -euo pipefail
kit="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$HOME/.cache/vereda-orbital/weather/land.png}"
mkdir -p "$(dirname "$out")"
big="$(mktemp --suffix=.png)"
trap 'rm -f "$big"' EXIT
# the installed look (the theme's, with its land threshold), else the kit's
look="$(dirname "$(readlink -f "$HOME/.local/state/omarchy/current/background" 2>/dev/null || echo /nonexistent)")/orbital-live.json"
[[ -f $look ]] || look="$kit/theme/look.json"
"$kit/render-still.sh" "$big" 4024 140 "$(jq -c '. + {mapMode: 1}' "$look")" >/dev/null
"$kit/weather/.venv/bin/python" "$kit/weather/resize.py" "$big" "$out" 3016 104
towns="$(dirname "$out")/towns.png"
"$kit/render-still.sh" "$big" 4024 140 "$(jq -c '. + {mapMode: 2}' "$look")" >/dev/null
"$kit/weather/.venv/bin/python" "$kit/weather/resize.py" "$big" "$towns" 3016 104
echo "$out"
echo "$towns"
