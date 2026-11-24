"""Tag the Herdr app terminal running this Claude session so ~/.zshrc can resume it after a reboot.

SessionStart sets labels claude.session/claude.cwd on $HC_TERMINAL_ID; SessionEnd clears them
when the user quit Claude on purpose (any reason other than "other"/"clear").
"""
import json, os, subprocess, sys

term = os.environ.get("HC_TERMINAL_ID")
if not term:
    sys.exit(0)
data = json.load(sys.stdin)
if data.get("agent_id"):
    sys.exit(0)

info = json.loads(subprocess.run(["hc", "get", term, "--json"], capture_output=True, text=True, timeout=5).stdout or "{}")
fg = (info.get("foreground") or {}).get("pid")
pid = os.getppid()
while pid > 1 and pid != fg:
    out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    pid = int(out) if out else 1
if pid != fg:
    sys.exit(0)  # a nested claude (e.g. claude -p from a tool), not the terminal's own session

if data.get("hook_event_name") == "SessionStart":
    labels = [f"claude.session={data['session_id']}", f"claude.cwd={data.get('cwd') or os.getcwd()}"]
elif data.get("reason") not in ("other", "clear"):
    labels = ["claude.session=", "claude.cwd="]
else:
    sys.exit(0)
subprocess.run(["hc", "label", term, *labels], capture_output=True, timeout=5)
