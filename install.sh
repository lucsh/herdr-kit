#!/bin/bash
# Installs herdr-kit: the main-md Herdr layout and its mods, the luc theme, the Claude status line
# bridge, the per-repo Tasks panel and `tasks` CLI. Safe to rerun: it updates what it installed.
set -euo pipefail

KIT=$(cd "$(dirname "$0")" && pwd)
. "$KIT/kit.env"
HERDR=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
SHARE=$HOME/.local/share/herdr-kit
TASKS_DIR=$HOME/.local/share/herdr-tasks
CAL=$HOME/.local/share/herdr-calendar
NOTIFY=$HOME/.local/share/herdr-notify
BIN=$HOME/.local/bin
MANIFEST=$SHARE/manifest.txt
RESUME=0 FORCE=0 CHECK=0
STAMP=$(date +%Y%m%d-%H%M%S)

# Prints the flags.
usage() {
  cat <<EOF
Usage: ./install.sh [--check] [--with-resume] [--force]

  --check        report prerequisites and anything that would block the install,
                 change nothing, exit 1 if a required item fails
  --with-resume  also resume each terminal's Claude session after a reboot
                 (a SessionStart/SessionEnd hook and a line in ~/.zshrc)
  --force        back up (*.bak-herdr-kit-*) and replace files of the same name
                 that this kit did not install, instead of stopping
EOF
}
# Prints an error and stops.
die() { echo "herdr-kit: $*" >&2; exit 1; }
for a in "$@"; do
  case $a in
    --check) CHECK=1 ;;
    --with-resume) RESUME=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# ── preflight ────────────────────────────────────────────────────────────────
# Each line: ok, warn (works, minus a feature) or FAIL (install can't run), then the fix.
# "(person)" marks a fix only the person at the Mac can do.
fails=0
# Records one check result; prints it in --check mode, or when it isn't ok.
report() {
  [ "$1" = FAIL ] && fails=$((fails + 1))
  if [ "$CHECK" = 1 ] || [ "$1" != ok ]; then printf '  %-4s %s%s\n' "$1" "$2" "${3:+  -> $3}"; fi
  return 0
}
# FAIL unless command $1 exists; $2 is the fix.
need() { if command -v "$1" >/dev/null; then report ok "$1"; else report FAIL "$1 not found" "$2"; fi; }

[ "$CHECK" = 1 ] && echo "Prerequisites:"
if [ -d /Applications/Herdr.app ]; then report ok "Herdr app"; else report FAIL "Herdr app not installed" "download it from herdr.dev (person)"; fi
if [ -d "$HERDR" ]; then report ok "Herdr home $HERDR"; else report FAIL "$HERDR missing" "open the Herdr app once (person)"; fi
if command -v herdr-app >/dev/null; then
  v=$(herdr-app --version 2>/dev/null | awk '{print $2}')
  if [ "$v" = "$HERDR_BUILT" ]; then report ok "herdr-app $v"
  else report warn "Herdr $v, kit built against $HERDR_BUILT" "fine; the my-* mods are copies and won't get Herdr's updates"; fi
else report warn "herdr-app not on PATH" "mod checks and the layout switch are skipped; press ctrl-shift-l in Herdr after"; fi
need git "xcode-select --install (person)"
need jq "brew install jq"
need rsync "brew install rsync"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then report ok "node $(node -v)"
else report FAIL "Node.js 20+ not found" "brew install node (or nvm install 22)"; fi
if ! command -v gh >/dev/null; then report warn "gh not found" "brew install gh, then gh auth login (person); needed by the Pull requests panel and GitHub banners"
elif gh auth status >/dev/null 2>&1; then report ok "gh signed in"
else report warn "gh not signed in" "gh auth login (person); needed by the Pull requests panel and GitHub banners"; fi
if command -v swiftc >/dev/null; then report ok "swiftc"
else report warn "swiftc not found" "xcode-select --install (person); needed to build the Calendar and GitHub banner helpers"; fi
if [ "$RESUME" = 1 ]; then need python3 "xcode-select --install (person)"; fi
case ":$PATH:" in *":$BIN:"*) report ok "$BIN on PATH" ;; *) report warn "$BIN not on PATH" "add it to ~/.zshrc so agents can run tasks" ;; esac
if [ -f "$HOME/.claude/settings.json" ] && jq -e '.statusLine' "$HOME/.claude/settings.json" >/dev/null 2>&1 \
  && [ "$(jq -r '.statusLine.command // ""' "$HOME/.claude/settings.json")" != "$SHARE/statusline.sh" ]; then
  report warn "Claude Code already has a status line" "it is kept; the installer prints one line to add for the Herdr status bar"
fi
[ "$fails" -eq 0 ] || [ "$CHECK" = 1 ] || die "$fails required item(s) missing (run ./install.sh --check for the full list)"

# ── what goes where ──────────────────────────────────────────────────────────
srcs=() dsts=()
# Queues kit file $1 to be installed at $2.
add() { srcs+=("$KIT/$1"); dsts+=("$2"); }
add herdr/layouts/main-md.json "$HERDR/layouts/main-md.json"
add herdr/themes/luc.json "$HERDR/themes/luc.json"
for m in "$KIT"/herdr/mods/*/; do m=$(basename "$m"); add "herdr/mods/$m" "$HERDR/mods/$m"; done
add bin/tasks "$BIN/tasks"
add claude/statusline.sh "$SHARE/statusline.sh"
add calendar "$CAL"
add notify "$NOTIFY"
if [ "$RESUME" = 1 ]; then
  add herdr/claude-resume.zsh "$HERDR/claude-resume.zsh"
  add claude/herdr-app-session-label.py "$SHARE/herdr-app-session-label.py"
fi

# True when the manifest says a previous run installed $1.
ours() { [ -f "$MANIFEST" ] && grep -qxF "$1" "$MANIFEST"; }
# True when $1 and $2 have the same contents (ignoring Herdr's generated files).
same() { diff -rq -x gpui-kit.d.ts -x jsconfig.json -x HerdrCalendar.app -x HerdrNotify.app -x .built-source.sha "$1" "$2" >/dev/null 2>&1; }

clashes=()
for i in "${!dsts[@]}"; do
  d=${dsts[$i]}
  if [ -e "$d" ] && ! ours "$d" && ! same "${srcs[$i]}" "$d"; then clashes+=("$d"); fi
done
if [ "$CHECK" = 1 ]; then
  echo "Would block the install:"
  [ ${#clashes[@]} -eq 0 ] && echo "  ok   nothing"
  for d in ${clashes[@]+"${clashes[@]}"}; do
    echo "  FAIL $d exists and was not installed by herdr-kit  -> rename it, or ask the person before --force"
    fails=$((fails + 1))
  done
  if [ "$fails" -eq 0 ]; then echo "Ready to install."; exit 0; fi
  echo "$fails item(s) to fix first."; exit 1
fi
if [ ${#clashes[@]} -gt 0 ]; then
  if [ "$FORCE" = 0 ]; then
    printf 'herdr-kit: these exist and were not installed by herdr-kit:\n' >&2
    printf '  %s\n' "${clashes[@]}" >&2
    die "nothing changed. Rename or remove them, or rerun with --force to back them up and replace them"
  fi
  mkdir -p "$SHARE"; touch "$MANIFEST"
  for d in "${clashes[@]}"; do mv "$d" "$d.bak-herdr-kit-$STAMP"; echo "backed up $d"; echo "$d" >> "$MANIFEST"; done
fi

# ── files ────────────────────────────────────────────────────────────────────
echo "Installing into $HERDR"
mkdir -p "$SHARE" "$BIN"
touch "$MANIFEST"
for i in "${!dsts[@]}"; do
  s=${srcs[$i]} d=${dsts[$i]}
  mkdir -p "$(dirname "$d")"
  existed=0; [ -e "$d" ] && existed=1
  if [ -d "$s" ]; then rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude HerdrCalendar.app --exclude HerdrNotify.app --exclude .built-source.sha "$s/" "$d/"
  else cp "$s" "$d"; fi
  # Only what this kit created (or --force replaced) is ours to remove later; an identical file
  # that was already there stays the person's.
  [ "$existed" = 0 ] && ! ours "$d" && echo "$d" >> "$MANIFEST"
done
mkdir -p "$HOME/.cache/herdr-claude"
chmod +x "$BIN/tasks" "$SHARE/statusline.sh" "$CAL/build.sh" "$NOTIFY/build.sh"

# ── calendar helper (its own app, so it gets its own Calendars permission) ───
# Built only when missing or its source changed: each build is a new signature, and macOS asks again.
if command -v swiftc >/dev/null; then
  want=$(cat "$CAL/src/main.swift" "$CAL/src/Info.plist" | shasum | cut -c1-40)
  if [ ! -d "$CAL/HerdrCalendar.app" ] || [ "$(cat "$CAL/.built-source.sha" 2>/dev/null)" != "$want" ]; then
    echo "Building the calendar helper"
    sh "$CAL/build.sh" >/dev/null && echo "$want" > "$CAL/.built-source.sha"
    open -n -g -a "$CAL/HerdrCalendar.app" --args --sync
    echo "note: allow \"Herdr Calendar\" to access your calendars and to control Calendar when macOS asks"
  fi
fi

# ── GitHub banner helper (its own app, so its notifications have their own name and permission) ──
if command -v swiftc >/dev/null; then
  want=$(cat "$NOTIFY/src/main.swift" "$NOTIFY/src/Info.plist" | shasum | cut -c1-40)
  if [ ! -d "$NOTIFY/HerdrNotify.app" ] || [ "$(cat "$NOTIFY/.built-source.sha" 2>/dev/null)" != "$want" ]; then
    echo "Building the GitHub banner helper"
    sh "$NOTIFY/build.sh" >/dev/null && echo "$want" > "$NOTIFY/.built-source.sha"
    open -n -g -a "$NOTIFY/HerdrNotify.app" --args --test
    echo "note: allow notifications from \"Herdr Notify\" (alert style Banners) when macOS asks"
  fi
fi

# ── tasks CLI (zamarrowski/herdr-tasks, pinned) ──────────────────────────────
if [ -d "$TASKS_DIR/.git" ]; then
  git -C "$TASKS_DIR" fetch -q origin && git -C "$TASKS_DIR" checkout -q "$HERDR_TASKS_COMMIT"
elif [ -e "$TASKS_DIR" ]; then
  echo "note: $TASKS_DIR exists and is not a git checkout; left it alone (the tasks CLI may not work)"
else
  git clone -q "$HERDR_TASKS_REPO" "$TASKS_DIR" && git -C "$TASKS_DIR" checkout -q "$HERDR_TASKS_COMMIT"
  ours "$TASKS_DIR" || echo "$TASKS_DIR" >> "$MANIFEST"
fi

# ── settings merges ──────────────────────────────────────────────────────────
echo "Merging settings"
node "$KIT/lib/merge.mjs" install --share "$SHARE" --herdr "$HERDR" $([ "$RESUME" = 1 ] && echo --resume)

# ── checks ───────────────────────────────────────────────────────────────────
if command -v herdr-app >/dev/null; then
  export HERDR_APP_HOME=$HERDR
  for m in "$KIT"/herdr/mods/*/; do
    m=$(basename "$m")
    herdr-app check "$HERDR/mods/$m" >/dev/null 2>&1 || echo "warning: mods/$m failed \`herdr-app check $HERDR/mods/$m\`"
  done
  if herdr-app status >/dev/null 2>&1; then herdr-app do layout.switch '{"name":"main-md"}' >/dev/null && echo "Switched Herdr to main-md"
  else echo "Open Herdr and press ctrl-shift-l to pick the main-md layout"; fi
fi
echo "Done. New Claude/Codex sessions will know about \`tasks\`."
