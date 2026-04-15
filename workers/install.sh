#!/bin/bash
# Install workers as launchd user agents on macOS
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$REPO_DIR/workers/launchd"
DEST_DIR="$HOME/Library/LaunchAgents"

echo "Repo: $REPO_DIR"

# Check deps
command -v node >/dev/null || { echo "Node.js not found. Install it first."; exit 1; }
command -v npx >/dev/null || { echo "npx not found."; exit 1; }

# Check .env
if [ ! -f "$REPO_DIR/workers/.env" ]; then
  echo "ERROR: workers/.env not found. Copy workers/.env.example and fill in values."
  exit 1
fi

# Install npm deps if needed
if [ ! -d "$REPO_DIR/node_modules" ]; then
  echo "Installing npm dependencies..."
  cd "$REPO_DIR" && npm install
fi

# Create log directory
mkdir -p "$REPO_DIR/workers/logs"

# Make run.sh executable
chmod +x "$REPO_DIR/workers/run.sh"

mkdir -p "$DEST_DIR"

# Install plists
for plist in "$PLIST_DIR"/*.plist; do
  filename=$(basename "$plist")
  # Replace __REPO_DIR__ placeholder with actual path
  sed "s|__REPO_DIR__|$REPO_DIR|g" "$plist" > "$DEST_DIR/$filename"
  label=$(defaults read "$DEST_DIR/$filename" Label 2>/dev/null || true)
  if [ -n "$label" ]; then
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$DEST_DIR/$filename"
    echo "Installed: $label"
  fi
done

echo ""
echo "Done. Workers installed as launchd agents."
echo "Logs: $REPO_DIR/workers/logs/"
echo ""
echo "To verify: launchctl list | grep hoku"
echo "To uninstall: workers/uninstall.sh"
