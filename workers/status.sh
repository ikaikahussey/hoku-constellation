#!/bin/bash
echo "=== Hoku Constellation Workers ==="
echo ""
launchctl list | grep -E "hoku\.constellation" || echo "No workers found"
echo ""
echo "=== Recent log activity ==="
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
for log in "$REPO_DIR"/workers/logs/*.log; do
  [ -f "$log" ] || continue
  echo "--- $(basename "$log") ---"
  tail -3 "$log"
  echo ""
done
