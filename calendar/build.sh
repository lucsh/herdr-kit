#!/bin/sh
# Builds HerdrCalendar.app next to this script (ad-hoc signed). Rebuilding changes its signature,
# so macOS asks for Calendars access again.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app=$here/HerdrCalendar.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$here/src/Info.plist" "$app/Contents/Info.plist"
swiftc -O -o "$app/Contents/MacOS/HerdrCalendar" "$here/src/main.swift"
codesign --force --sign - "$app" 2>/dev/null
echo "$app"
