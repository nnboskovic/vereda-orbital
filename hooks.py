#!/usr/bin/env python3
"""Adds or removes the session-lights hooks (presence.sh) in ~/.claude/settings.json.

    hooks.py add      install them (idempotent; other hooks are left alone)
    hooks.py remove   take them out again

They run async, so Claude Code never waits on them.
"""
import json
import os
import sys

EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Notification", "SessionEnd"]
MARK = "vereda-orbital/presence.sh"
COMMAND = '"$HOME/.local/share/vereda-orbital/presence.sh"'

path = os.path.expanduser("~/.claude/settings.json")
settings = json.load(open(path)) if os.path.exists(path) else {}
hooks = settings.setdefault("hooks", {})

for event in EVENTS:
    groups = []
    for group in hooks.get(event, []):
        group["hooks"] = [h for h in group.get("hooks", []) if MARK not in h.get("command", "")]
        if group["hooks"]:
            groups.append(group)
    if sys.argv[1:] == ["add"]:
        groups.append({"hooks": [{"type": "command", "command": COMMAND, "async": True, "timeout": 10}]})
    if groups:
        hooks[event] = groups
    else:
        hooks.pop(event, None)

tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
