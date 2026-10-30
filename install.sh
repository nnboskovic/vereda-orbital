#!/usr/bin/env bash
# Installs the Vereda Orbital desktop on Omarchy: the theme, and the live Orbital
# background inside a clone of Omarchy's background plugin. Safe to run again,
# e.g. after editing theme/look.json or the shader. Undo with revert.sh.
set -euo pipefail

kit="$(cd "$(dirname "$0")" && pwd)"
user="${USER:-$(id -un)}"
plugin="$HOME/.config/omarchy/plugins/$user.background"
theme="$HOME/.config/omarchy/themes/vereda-orbital"

"$kit/build.sh"

# The live background rides in Omarchy's own background plugin, cloned so updates leave it alone.
[[ -d $plugin ]] || omarchy plugin clone omarchy.background
cp "$kit/plugin/Background.qml" "$kit/shader/"{OrbitalLive.qml,OrbitalPainter.qml,OrbitalWeather.qml,OrbitalLightning.qml,OrbitalMeteors.qml,OrbitalLights.qml,OrbitalSessions.qml,OrbitalIntro.qml,Scene.js,orbital.frag.qsb,flash.frag.qsb,Manrope-latin.woff2} "$plugin/"

# The theme: colours, icons, the look, and the still frame the live background starts from
# (also what the lock screen and theme picker show). Rendered at the focused monitor's size.
mkdir -p "$theme/backgrounds"
cp "$kit/theme/colors.toml" "$kit/theme/icons.theme" "$kit/theme/unlock.png" "$theme/"
cp "$kit/theme/look.json" "$theme/backgrounds/orbital-live.json"
read -r width height scale < <(hyprctl monitors -j | jq -r '(map(select(.focused)) + .)[0] | "\(.width) \(.height) \(.scale)"')
logical_w=$(awk -v w="$width" -v s="$scale" 'BEGIN { printf "%d", w / s + 0.5 }')
logical_h=$(awk -v h="$height" -v s="$scale" 'BEGIN { printf "%d", h / s + 0.5 }')
still=$(mktemp --suffix=.png)
"$kit/render-still.sh" "$still" "$logical_w" "$logical_h" "$(cat "$kit/theme/look.json")" 0 >/dev/null
magick "$still" -alpha off "$theme/backgrounds/orbital-live.png"
magick "$theme/backgrounds/orbital-live.png" -resize 1280x720 "$theme/preview.png"
rm -f "$still"

# The drone, a bar widget whose aura shows the sessions' mood (and tints the window border).
drone="$HOME/.config/omarchy/plugins/vereda.drone"
mkdir -p "$drone"
cp "$kit/drone/"{Drone.qml,manifest.json} "$kit/shader/"{Scene.js,OrbitalSessions.qml} "$drone/"
grep -q '"vereda.drone"' "$HOME/.config/omarchy/shell.json" 2>/dev/null || omarchy plugin enable vereda.drone --section right

# Notifications as Culture signal traffic: a clone of Omarchy's notifications, patched.
notes="$HOME/.config/omarchy/plugins/$user.notifications"
[[ -d $notes ]] || omarchy plugin clone omarchy.notifications
cp "$kit/shader/"{Scene.js,Manrope-latin.woff2} "$notes/"
"$kit/notifications/patch.py" "$notes"

# Session lights read the sessions Claude Code's hooks record. The hooks live in Claude Code's
# own settings, so they are a separate step you run yourself: hooks.py add (hooks.py remove undoes it).
mkdir -p "$HOME/.cache/vereda-orbital"
[[ -s $HOME/.cache/vereda-orbital/sessions.json ]] || echo '{}' >"$HOME/.cache/vereda-orbital/sessions.json"
grep -q "vereda-orbital/presence.sh" "$HOME/.claude/settings.json" 2>/dev/null ||
  echo "Session lights are off until you run: $kit/hooks.py add"

current=$(omarchy theme current)
[[ $current == "Vereda Orbital" ]] || echo "$current" >"$kit/.previous-theme"
omarchy theme set "Vereda Orbital"
# A background service is created once per shell, so pick up plugin changes with a restart.
omarchy restart shell
echo "Vereda Orbital installed."
