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
if [[ -d $HOME/.config/omarchy/plugins/$user.background ]]; then
  omarchy plugin remove "$user.background" --yes
fi
echo "Vereda Orbital reverted."
