#!/usr/bin/env bash
# Undoes install.sh: switches back to the previous theme and removes the cloned
# background plugin (Omarchy backs it up and restores its built-in background).
# The vereda-orbital theme folder stays, so it can still be picked from the theme menu.
set -euo pipefail

kit="$(cd "$(dirname "$0")" && pwd)"
user="${USER:-$(id -un)}"

# the session-lights hooks come out of Claude Code's settings
"$kit/hooks.py" remove

omarchy theme set "$(cat "$kit/.previous-theme" 2>/dev/null || echo "Tokyo Night")"
for plugin in "$user.background" "$user.notifications" "$user.workspaces" vereda.drone; do
  if [[ -d $HOME/.config/omarchy/plugins/$plugin ]]; then
    omarchy plugin remove "$plugin" --yes
  fi
done

# --- vereda-weather ---------------------------------------------------------------------------
# The weather simulation stops (saving its state) and its service goes; the venv and the maps
# in ~/.cache/vereda-orbital/weather/ stay, so installing again picks the weather up where it was.
systemctl --user disable --now --quiet vereda-weather.service 2>/dev/null || true
rm -f "$HOME/.local/share/systemd/user/vereda-weather.service"
systemctl --user daemon-reload
# --- end vereda-weather -----------------------------------------------------------------------
# Omarchy's own screensaver comes back on its old timer.
shell_json="$HOME/.config/omarchy/shell.json"
if [[ -f $shell_json ]]; then
  saver=$(cat "$kit/.previous-screensaver" 2>/dev/null || echo 150)
  jq --argjson s "$saver" '.idle.screensaver = $s' "$shell_json" > "$shell_json.tmp" && mv "$shell_json.tmp" "$shell_json"
fi
echo "Vereda Orbital reverted."
