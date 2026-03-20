#!/bin/bash
if [ -f /tmp/ftm-inbox.pid ] && kill -0 $(cat /tmp/ftm-inbox.pid) 2>/dev/null; then
    echo "ftm-inbox is running (PID: $(cat /tmp/ftm-inbox.pid))"
    # Show last poll times from DB if available
    CONFIG_DIR="$HOME/.claude/ftm-inbox"
    DB_PATH="$CONFIG_DIR/inbox.db"
    if [ -f "$DB_PATH" ] && command -v sqlite3 &>/dev/null; then
        echo ""
        echo "Last poll times:"
        sqlite3 "$DB_PATH" "SELECT adapter, MAX(fetched_at) FROM inbox_items GROUP BY adapter;" 2>/dev/null | \
            while IFS='|' read -r adapter ts; do
                echo "  $adapter: $ts"
            done
    fi
else
    echo "ftm-inbox is not running."
fi
