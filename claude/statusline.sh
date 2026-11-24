#!/bin/sh
# Claude Code status line: model [context bar] pct | 5h usage ↻reset | wk usage ↻reset.
# Inside the Herdr app it also saves its input to ~/.cache/herdr-claude/<terminal>.json, which the
# Herdr status bar (mods/my-status) reads.
input=$(cat)

case "$HC_TERMINAL_ID" in
  ""|*[!A-Za-z0-9_-]*) ;;
  *) hd="$HOME/.cache/herdr-claude"
     mkdir -p "$hd" && printf '%s' "$input" > "$hd/.$HC_TERMINAL_ID.$$" && mv -f "$hd/.$HC_TERMINAL_ID.$$" "$hd/$HC_TERMINAL_ID.json" ;;
esac

model=$(echo "$input" | jq -r '.model.display_name')
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
filled=$((pct / 10)); [ "$filled" -gt 10 ] && filled=10
bar=''
for i in 1 2 3 4 5 6 7 8 9 10; do
  if [ "$i" -le "$filled" ]; then bar="${bar}█"; else bar="${bar}░"; fi
done
out=$(printf '%s [%s] %s%%' "$model" "$bar" "$pct")

p5=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seg=''
[ -n "$p5" ] && seg="$(printf '%.0f' "$p5")%"
if [ -n "$reset" ]; then t=$(date -r "${reset%.*}" +%H:%M 2>/dev/null); [ -n "$t" ] && seg="${seg:+$seg }↻$t"; fi
[ -n "$seg" ] && out="$out | 5h $seg"

p7=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
wk=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
seg=''
[ -n "$p7" ] && seg="$(printf '%.0f' "$p7")%"
if [ -n "$wk" ]; then w=$(date -r "${wk%.*}" '+%a %H:%M' 2>/dev/null); [ -n "$w" ] && seg="${seg:+$seg }↻$w"; fi
[ -n "$seg" ] && out="$out | wk $seg"

printf '%s' "$out"
