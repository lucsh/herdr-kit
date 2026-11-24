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
BIN=$HOME/.local/bin
MANIFEST=$SHARE/manifest.txt
RESUME=0 FORCE=0
STAMP=$(date +%Y%m%d-%H%M%S)

# Prints the flags.
usage() {
  cat <<EOF
Usage: ./install.sh [--with-resume] [--force]

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
    --with-resume) RESUME=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# ── preflight ────────────────────────────────────────────────────────────────
missing=()
for c in git node jq rsync; do command -v "$c" >/dev/null || missing+=("$c"); done
[ "$RESUME" = 1 ] && { command -v python3 >/dev/null || missing+=(python3); }
[ ${#missing[@]} -eq 0 ] || die "missing: ${missing[*]} (brew install ${missing[*]})"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20 or newer is required"
[ -d "$HERDR" ] || die "$HERDR not found: install the Herdr app and open it once first"
command -v gh >/dev/null || echo "note: gh (GitHub CLI) not found; the Pull requests panel needs it (brew install gh && gh auth login)"
command -v swiftc >/dev/null || echo "note: swiftc not found; the Calendar panel needs its helper built (xcode-select --install, then rerun)"

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
if [ "$RESUME" = 1 ]; then
  add herdr/claude-resume.zsh "$HERDR/claude-resume.zsh"
  add claude/herdr-app-session-label.py "$SHARE/herdr-app-session-label.py"
fi

# True when the manifest says a previous run installed $1.
ours() { [ -f "$MANIFEST" ] && grep -qxF "$1" "$MANIFEST"; }
# True when $1 and $2 have the same contents (ignoring Herdr's generated files).
same() { diff -rq -x gpui-kit.d.ts -x jsconfig.json -x HerdrCalendar.app -x .built-source.sha "$1" "$2" >/dev/null 2>&1; }

clashes=()
for i in "${!dsts[@]}"; do
  d=${dsts[$i]}
  if [ -e "$d" ] && ! ours "$d" && ! same "${srcs[$i]}" "$d"; then clashes+=("$d"); fi
done
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
  if [ -d "$s" ]; then rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude HerdrCalendar.app --exclude .built-source.sha "$s/" "$d/"
  else cp "$s" "$d"; fi
  # Only what this kit created (or --force replaced) is ours to remove later; an identical file
  # that was already there stays the person's.
  [ "$existed" = 0 ] && ! ours "$d" && echo "$d" >> "$MANIFEST"
done
mkdir -p "$HOME/.cache/herdr-claude"
chmod +x "$BIN/tasks" "$SHARE/statusline.sh" "$CAL/build.sh"

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
case ":$PATH:" in *":$BIN:"*) ;; *) echo "note: add $BIN to your PATH so agents can run \`tasks\`" ;; esac
if command -v herdr-app >/dev/null; then
  export HERDR_APP_HOME=$HERDR
  for m in "$KIT"/herdr/mods/*/; do
    m=$(basename "$m")
    herdr-app check "$HERDR/mods/$m" >/dev/null 2>&1 || echo "warning: mods/$m failed \`herdr-app check $HERDR/mods/$m\`"
  done
  v=$(herdr-app --version 2>/dev/null | awk '{print $2}')
  [ "$v" = "$HERDR_BUILT" ] || echo "note: built against Herdr $HERDR_BUILT, this is $v. The my-* mods are copies of Herdr's own and won't get its updates"
  if herdr-app status >/dev/null 2>&1; then herdr-app do layout.switch '{"name":"main-md"}' >/dev/null && echo "Switched Herdr to main-md"
  else echo "Open Herdr and press ctrl-shift-l to pick the main-md layout"; fi
fi
echo "Done. New Claude/Codex sessions will know about \`tasks\`."
