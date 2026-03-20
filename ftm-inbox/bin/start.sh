#!/bin/bash
# Start ftm-inbox backend + pollers
cd "$(dirname "$0")/.."
PORT=${FTM_INBOX_PORT:-8042}
echo "Starting ftm-inbox on port $PORT..."
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port $PORT &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"
echo $BACKEND_PID > /tmp/ftm-inbox.pid
echo "ftm-inbox running. Stop with: ftm-inbox/bin/stop.sh"
