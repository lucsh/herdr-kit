# Herdr app: a reboot restores each terminal as a plain shell; resume the Claude session it was
# running (labels set by ~/.claude/hooks/herdr-app-session-label.py). Sourced from ~/.zshrc.
if [[ -o interactive && -n "$HC_TERMINAL_ID" && -z "$CLAUDECODE" && -z "$HERDR_CLAUDE_RESUMED" ]]; then
  export HERDR_CLAUDE_RESUMED=1
  IFS=$'\t' read -r __hc_sid __hc_cwd < <(hc get "$HC_TERMINAL_ID" --json 2>/dev/null | jq -r '[.labels["claude.session"] // "", .labels["claude.cwd"] // ""] | @tsv')
  if [[ -n "$__hc_sid" ]]; then
    cd -- "${__hc_cwd:-$PWD}" && claude --resume "$__hc_sid"
  fi
  unset __hc_sid __hc_cwd
fi
