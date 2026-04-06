#!/bin/bash
# Hook: Auto-log progress + heartbeat for ftm
# Triggers: UserPromptSubmit while an ftm session is active
#
# 1. Auto-log: reminds Claude to log progress when user reports completing something
# 2. Task inbox: surfaces unreviewed Slack/email tasks every 10 min
# 3. Heartbeat: every 30 min, scans task state for urgent items to surface
#
# Heartbeat inspired by OpenClaw's HEARTBEAT.md pattern (heartbeat.ts):
# Periodically checks task state and prompts Claude to surface time-sensitive
# items without the user asking.
#
# FILES:
#   ~/.claude/ftm-state/blackboard/context.json  - session gate (active_task check)
#   ~/.claude/ftm-state/.last-heartbeat           - timestamp of last heartbeat
#   ~/.claude/ftm-state/HEARTBEAT.md              - user-maintained alert/task config

FTM_STATE="$HOME/.claude/ftm-state"
CONTEXT_JSON="$FTM_STATE/blackboard/context.json"

# NOTE: Session gate removed in v1.7.9. Daily logging should happen for ALL work,
# not just formal ftm sessions. Most productive work happens outside /ftm invocations
# and was going untracked because context.json status was "none" or "completed".

# Read payload from stdin (JSON) — extract prompt for action pattern matching
STDIN_DATA=$(cat)
USER_MESSAGE=$(echo "$STDIN_DATA" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('prompt', ''))
except:
    print('')
" 2>/dev/null)
# Fallback: treat stdin as raw message if JSON parse failed
if [ -z "$USER_MESSAGE" ]; then
    USER_MESSAGE="$STDIN_DATA"
fi

# Action indicators (what users say when they've done something)
ACTION_PATTERNS=(
    "^[Ii] (did|completed?|finished|fixed|sent|responded|closed|created|updated|deployed|merged|pushed|committed|tested|reviewed)"
    "^[Jj]ust (did|completed?|finished|fixed|sent|responded|closed|created|updated|deployed|merged|pushed|committed|tested|reviewed)"
    "^[Dd]one"
    "^[Ff]inished"
    "^[Cc]ompleted?"
    "^[Ss]ent (email|message|response)"
    "^[Rr]esponded to"
    "^[Mm]erged"
    "^[Pp]ushed to"
    "^[Cc]ommitted"
    "^[Dd]eployed"
    "^[Ff]ixed"
    "^[Cc]losed (ticket|issue|task)"
    "[Tt]ask.*complete"
    "[Tt]icket.*closed"
)

# Check if message matches any action pattern
SHOULD_LOG=false
for pattern in "${ACTION_PATTERNS[@]}"; do
    if echo "$USER_MESSAGE" | grep -qE "$pattern"; then
        SHOULD_LOG=true
        break
    fi
done

# Also check for follow-up questions after taking action
if echo "$USER_MESSAGE" | grep -qE "(I|i) .* (what|should|next|now)\?"; then
    SHOULD_LOG=true
fi

# If action detected, output logging reminder with exact instructions
TODAY=$(date +%Y-%m-%d)
DAILY_DIR="$HOME/.claude/ftm-ops/daily"
DAILY_FILE="$DAILY_DIR/$TODAY.md"

if [ "$SHOULD_LOG" = true ]; then
    echo ""
    echo "[Auto-log] Detected progress update. Append to daily log NOW:"
    echo "  File: $DAILY_FILE"
    if [ ! -f "$DAILY_FILE" ]; then
        echo "  File doesn't exist yet — create it with header: # Daily Log — $TODAY"
    fi
    echo "  Format: - HH:MM — [what was done] (ticket/PR/system if applicable)"
    echo "  Do this silently — don't announce it to the user."
    echo ""
fi

# --- Dashboard sync: surface task-state changes made outside the chat ---
CLAUDE_SYNC_FILE="$FTM_STATE/blackboard/.runtime/claude-sync-events.txt"
if [ -s "$CLAUDE_SYNC_FILE" ]; then
    echo ""
    echo "[Dashboard sync] Recent dashboard updates were written to ftm-state:"
    head -20 "$CLAUDE_SYNC_FILE"
    echo "Please reload task state from ftm-state and treat those updates as authoritative."
    echo ""
    : > "$CLAUDE_SYNC_FILE"
fi

# --- Heartbeat: periodic task/urgency check ---
# Fires every 30 minutes. Prompts Claude to scan for time-sensitive items.
HEARTBEAT_INTERVAL=1800  # 30 minutes in seconds
LAST_HEARTBEAT_FILE="$FTM_STATE/.last-heartbeat"
HEARTBEAT_MD="$FTM_STATE/HEARTBEAT.md"

SHOULD_HEARTBEAT=false
if [ -f "$LAST_HEARTBEAT_FILE" ]; then
    LAST_BEAT=$(cat "$LAST_HEARTBEAT_FILE" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    ELAPSED=$(( NOW - LAST_BEAT ))
    if [ "$ELAPSED" -ge "$HEARTBEAT_INTERVAL" ]; then
        SHOULD_HEARTBEAT=true
    fi
else
    # First message of session — no heartbeat on first message, just record time
    echo "$(date +%s)" > "$LAST_HEARTBEAT_FILE"
fi

if [ "$SHOULD_HEARTBEAT" = true ]; then
    echo "$(date +%s)" > "$LAST_HEARTBEAT_FILE"
    echo ""
    echo "[HEARTBEAT — $(date '+%H:%M') check-in]: 30 minutes have passed. Briefly scan for anything time-sensitive:"
    echo "- Check ftm-state/blackboard/context.json for deadlines or blockers that need attention."
    if [ -f "$HEARTBEAT_MD" ]; then
        HB_CONTENT=$(cat "$HEARTBEAT_MD" 2>/dev/null)
        HB_ACTIONABLE=$(echo "$HB_CONTENT" | grep -v "^#" | grep -v "^[[:space:]]*$" | head -3)
        if [ -n "$HB_ACTIONABLE" ]; then
            echo "- HEARTBEAT.md has tasks configured — read it and follow any instructions."
        fi
    fi
    echo "If nothing urgent, proceed normally. If something needs attention, surface it briefly."
    echo ""
fi
