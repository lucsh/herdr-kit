#!/bin/sh
# Builds HerdrNotify.app next to this script (ad-hoc signed). Rebuilding changes its signature,
# so macOS asks to allow its notifications again.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app=$here/HerdrNotify.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$here/src/Info.plist" "$app/Contents/Info.plist"
swiftc -O -framework UserNotifications -o "$app/Contents/MacOS/HerdrNotify" "$here/src/main.swift"
codesign --force --sign - "$app" 2>/dev/null
echo "$app"
