#!/bin/bash
# End-to-end check on a macOS runner: install from dist, fire hooks as the tools would, screenshot the strip.
set -euo pipefail
mkdir -p ~/.claude ~/.codex e2e
dist/petsia-macos-arm64/petsia setup
for i in $(seq 1 30); do curl -sf http://127.0.0.1:7788/health >/dev/null && break; sleep 1; done

claude=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.claude/settings.json")))["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"])')
codex=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.codex/hooks.json")))["hooks"]["PermissionRequest"][0]["hooks"][0]["command"])')
echo "claude hook: $claude"
echo "codex hook:  $codex"
echo '{"hook_event_name":"UserPromptSubmit","session_id":"0603472f-b7c5-4dae-b7a1-142468264b30","cwd":"/w/web"}' | bash -c "$claude"
echo '{"hook_event_name":"PermissionRequest","session_id":"019dabc6-8fef-7681-a054-b5bb75fcb97d","cwd":"/w/app","tool_name":"Bash","tool_input":{"command":"npm test"}}' | bash -c "$codex"
echo '{"hook_event_name":"Stop","session_id":"019dabc6-8fef-7681-a054-b5bb75fcb97e","cwd":"/w/api"}' | bash -c "$codex"
sleep 3

"$HOME/Library/Application Support/pets-ia/bin/petsia" status
sessions=$(curl -sf http://127.0.0.1:7788/health | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessions"])')
echo "sessions: $sessions"
screencapture -x e2e/macos.png || true
cp ~/Library/Logs/pets-ia/*.log e2e/ 2>/dev/null || true
[ "$sessions" -ge 3 ] || { echo "expected 3 sessions"; exit 1; }
pgrep -x petsia-overlay >/dev/null || { echo "overlay is not running"; cat e2e/overlay.log || true; exit 1; }
"$HOME/Library/Application Support/pets-ia/bin/petsia" uninstall --purge
