#!/bin/bash
set -euo pipefail
DEST_DIR="$HOME/Library/LaunchAgents"
for plist in "$DEST_DIR"/fm.hoku.constellation.*.plist; do
  [ -f "$plist" ] || continue
  label=$(defaults read "$plist" Label 2>/dev/null || true)
  if [ -n "$label" ]; then
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    echo "Removed: $label"
  fi
  rm "$plist"
done
echo "All hoku workers uninstalled."
