#!/usr/bin/env bash
# Claude Code hook for the Orbital's session lights: records each session's state in
# ~/.cache/vereda-orbital/sessions.json, which the live background reads.
#   presence.sh          the hook (reads the hook's JSON on stdin)
#   presence.sh prune    drops sessions whose Claude Code process has gone
#   presence.sh focus ID focuses the terminal window a session runs in
# States: working (a prompt is being handled), waiting (blocked on a permission prompt or
# a question), idle (turn done, your move). SessionEnd removes the session.
set -u

dir="${XDG_CACHE_HOME:-$HOME/.cache}/vereda-orbital"
file="$dir/sessions.json"
mkdir -p "$dir"

update() { # jq program, then jq args
  exec 9>"$dir/.lock"
  flock -w 2 9 || return 0
  [[ -s $file ]] || echo '{}' >"$file"
  local tmp
  tmp=$(mktemp "$dir/.sessions.XXXXXX")
  if jq "$@" "$file" >"$tmp" 2>/dev/null; then mv -f "$tmp" "$file"; else rm -f "$tmp"; fi
}

dead_sessions() { # ids whose process is gone, as a JSON array
  [[ -s $file ]] || { echo '[]'; return; }
  jq -r 'to_entries[] | "\(.key) \(.value.pid // 0)"' "$file" 2>/dev/null |
    while read -r id pid; do [[ $pid -gt 1 && -d /proc/$pid ]] || echo "$id"; done | jq -R . | jq -sc .
}

if [[ ${1:-} == focus ]]; then
  # walk up from the session's Claude Code process to the window that owns it
  pid=$(jq -r --arg id "${2:-}" '.[$id].pid // empty' "$file" 2>/dev/null)
  [[ -n $pid ]] || exit 0
  owners=$(hyprctl clients -j | jq -r '.[].pid')
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if grep -qx "$pid" <<<"$owners"; then
      hyprctl dispatch "hl.dsp.focus({ window = \"pid:$pid\" })" >/dev/null
      exit 0
    fi
    pid=$(awk '{print $4}' /proc/$pid/stat 2>/dev/null)
    [[ -n $pid && $pid -gt 1 ]] || exit 0
  done
  exit 0
fi

if [[ ${1:-} == prune ]]; then
  update --argjson dead "$(dead_sessions)" 'delpaths([$dead[] | [.]])'
  exit 0
fi

input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input")
id=$(jq -r '.session_id // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
[[ -n $id ]] || exit 0

case "$event" in
  SessionStart | Stop) state=idle ;;
  UserPromptSubmit | PostToolUse) state=working ;;
  Notification)
    # a permission prompt or a question blocks on you; the 60 s idle nudge does not
    kind=$(jq -r '.notification_type // empty' <<<"$input")
    message=$(jq -r '.message // empty' <<<"$input")
    if [[ $kind == idle_prompt || ($kind == "" && $message == *"waiting for your input"*) ]]; then state=idle; else state=waiting; fi
    ;;
  SessionEnd)
    update --arg id "$id" 'del(.[$id])'
    exit 0
    ;;
  *) exit 0 ;;
esac

# The Claude Code process this hook belongs to, so a session that dies without SessionEnd is pruned.
pid=$PPID
for _ in 1 2 3 4 5 6; do
  [[ $(cat /proc/$pid/comm 2>/dev/null) == claude ]] && break
  pid=$(awk '{print $4}' /proc/$pid/stat 2>/dev/null || echo 1)
  [[ $pid -gt 1 ]] || { pid=$PPID; break; }
done

update --arg id "$id" --arg state "$state" --arg project "$(basename "${cwd:-?}")" \
  --argjson pid "$pid" --argjson now "$(date +%s)" \
  '.[$id] = ((.[$id] // {since: $now}) + {state: $state, project: $project, pid: $pid, at: $now})'
