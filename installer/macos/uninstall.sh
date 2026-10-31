#!/bin/bash
# Removes JMRI Modern UI:
#   sudo "/Library/Application Support/JMRI Modern UI/uninstall.sh"
set -u
SRC="/Library/Application Support/JMRI Modern UI"
JAR_NAME=jmri-modern-ui-addon.jar
if [ "$(id -u)" != 0 ]; then
  exec sudo "$0" "$@"
fi
user=$(cat "$SRC/installed-for" 2>/dev/null || true)
if [ -n "$user" ]; then
  home=$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: *//')
  settings="${home:-/Users/$user}/Library/Preferences/JMRI"
  rm -rf "$settings/web/modern"
  rm -f "$settings/$JAR_NAME"
  conf="$settings/jmri.conf"
  if [ -f "$conf" ] && grep -qF -- "--cp:a=$settings/$JAR_NAME" "$conf"; then
    tmp=$(mktemp)
    awk -v opt="--cp:a=$settings/$JAR_NAME" '
      /^default_options="/ {
        sub(/^default_options="/, ""); sub(/"[[:space:]]*$/, "")
        n = split($0, parts, " "); line = ""
        for (i = 1; i <= n; i++) if (parts[i] != opt && parts[i] != "") line = line == "" ? parts[i] : line " " parts[i]
        if (line != "") print "default_options=\"" line "\""
        next
      }
      { print }' "$conf" > "$tmp"
    sudo -u "$user" cp "$tmp" "$conf"
    rm -f "$tmp"
  fi
fi
[ -f "$SRC/jar-in-lib" ] && rm -f "$(cat "$SRC/jar-in-lib")"
rm -rf "$SRC"
pkgutil --forget org.jmri.modernui >/dev/null 2>&1 || true
echo "JMRI Modern UI removed. Restart JMRI if it is running."
