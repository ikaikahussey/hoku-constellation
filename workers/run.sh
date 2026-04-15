#!/bin/bash
set -euo pipefail
WORKER_NAME="$1"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_DIR/workers/logs"
mkdir -p "$LOG_DIR"

cd "$REPO_DIR"

# Load env
if [ -f workers/.env ]; then
  set -a; source workers/.env; set +a
fi

npx tsx --tsconfig workers/tsconfig.json "workers/${WORKER_NAME}.ts" \
  >> "$LOG_DIR/${WORKER_NAME}.log" 2>&1

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${WORKER_NAME} exited $?" >> "$LOG_DIR/scheduler.log"
