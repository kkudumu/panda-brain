#!/bin/bash
# ftm-session-end.sh
# Hook: Deactivate ftm session tracking and ensure daily log exists when conversation ends
# Trigger: Stop
#
# Always runs — not gated on ftm session state. Every session that ends should:
# 1. Mark context.json as completed (if active)
# 2. Ensure today's daily log file exists (create if missing)
# 3. Remind Claude to append a session summary before exiting

FTM_STATE="$HOME/.claude/ftm-state"
CONTEXT_JSON="$FTM_STATE/blackboard/context.json"
TODAY=$(date +%Y-%m-%d)
DAILY_DIR="$HOME/.claude/ftm-ops/daily"
DAILY_FILE="$DAILY_DIR/$TODAY.md"

# Mark session as completed in context.json (if it has an active task)
python3 -c "
import json, sys, os
from datetime import datetime

ctx_path = '$CONTEXT_JSON'
if not os.path.exists(ctx_path):
    sys.exit(0)

try:
    with open(ctx_path) as f:
        d = json.load(f)

    if 'current_task' in d and isinstance(d['current_task'], dict):
        status = d['current_task'].get('status', '')
        if status not in ('', 'completed', 'none'):
            d['current_task']['status'] = 'completed'

    if 'session_metadata' in d and isinstance(d['session_metadata'], dict):
        d['session_metadata']['last_updated'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

    with open(ctx_path, 'w') as f:
        json.dump(d, f, indent=2)
except Exception:
    pass
" 2>/dev/null

# Ensure daily log directory and file exist
mkdir -p "$DAILY_DIR"
if [ ! -f "$DAILY_FILE" ]; then
    echo "# Daily Log — $TODAY" > "$DAILY_FILE"
    echo "" >> "$DAILY_FILE"
fi

# Remind Claude to write session summary to daily log
echo ""
echo "[Session ending] Before you finish, append a summary of this session to the daily log:"
echo "  File: $DAILY_FILE"
echo "  Format: ## Session — HH:MM"
echo "  Then bullet points of what was accomplished, decisions made, and next steps."
echo "  Do this silently — just write the file."
echo ""
