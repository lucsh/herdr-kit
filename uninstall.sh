#!/bin/bash
# Removes what install.sh put in place (listed in its manifest) and its settings merges.
# Task lists in ~/.local/state/herdr-tasks are kept.
set -euo pipefail

KIT=$(cd "$(dirname "$0")" && pwd)
HERDR=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
SHARE=$HOME/.local/share/herdr-kit
MANIFEST=$SHARE/manifest.txt

[ -f "$MANIFEST" ] || { echo "herdr-kit is not installed (no $MANIFEST)"; exit 0; }
if command -v herdr-app >/dev/null && HERDR_APP_HOME=$HERDR herdr-app status >/dev/null 2>&1; then
  HERDR_APP_HOME=$HERDR herdr-app do layout.switch '{"name":"main"}' >/dev/null || true
fi
node "$KIT/lib/merge.mjs" uninstall --share "$SHARE" --herdr "$HERDR"
while IFS= read -r p; do
  case $p in "$HERDR"/*|"$HOME"/.local/*) rm -rf -- "$p" ;; *) echo "skipped unexpected path: $p" ;; esac
done < "$MANIFEST"
rm -rf -- "$SHARE"
echo "Removed herdr-kit. Your task lists in ~/.local/state/herdr-tasks were kept."
