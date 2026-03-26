#!/usr/bin/env bash
# ftm-blackboard-enforcer.sh
# Stop hook that nudges Claude to record an experience if meaningful work
# was done but no blackboard entry was written.
#
# Uses additionalContext (not "decision: block") so Claude can still act on
# the reminder. A blocking stop creates a deadlock — Claude can't write files
# after the user ends the conversation.
#
# "Meaningful work" = 3+ edits tracked by the edit counter,
# or ftm skills were invoked (checked via context.json).
#
# Hook: Stop

set -euo pipefail

# shellcheck disable=SC2034
INPUT=$(cat)

STATE_DIR="$HOME/.claude/ftm-state"
BB_DIR="$STATE_DIR/blackboard"
EDIT_COUNTER="$STATE_DIR/.edit-count"
CONTEXT_FILE="$BB_DIR/context.json"
EXPERIENCES_DIR="$BB_DIR/experiences"

# Check 1: Were there meaningful edits this session?
# Edit counter contains just a number now (no session ID).
# If the counter file is recent (< 4 hours) and >= 3, count as meaningful.
HAD_EDITS=false
if [[ -f "$EDIT_COUNTER" ]]; then
  COUNTER_AGE=$(( $(date +%s) - $(stat -c %Y "$EDIT_COUNTER" 2>/dev/null || stat -f %m "$EDIT_COUNTER" 2>/dev/null || echo "0") ))
  if [[ "$COUNTER_AGE" -lt 14400 ]]; then
    STORED_COUNT=$(cat "$EDIT_COUNTER" 2>/dev/null || echo "0")
    if [[ "$STORED_COUNT" -ge 3 ]]; then
      HAD_EDITS=true
    fi
  fi
fi

# Check 2: Were ftm skills invoked this session?
HAD_SKILLS=false
if [[ -f "$CONTEXT_FILE" ]]; then
  SKILLS_COUNT=$(jq -r '.session_metadata.skills_invoked | length' "$CONTEXT_FILE" 2>/dev/null || echo "0")
  if [[ "$SKILLS_COUNT" -gt 0 ]]; then
    HAD_SKILLS=true
  fi
fi

# If no meaningful work detected, allow stop quietly
if [[ "$HAD_EDITS" == "false" && "$HAD_SKILLS" == "false" ]]; then
  # Clean up session markers
  rm -f "$EDIT_COUNTER" "$STATE_DIR/.plan-presented" 2>/dev/null
  exit 0
fi

# Check 3: Was an experience recorded today?
TODAY=$(date +%Y-%m-%d)
HAS_EXPERIENCE=false

if [[ -d "$EXPERIENCES_DIR" ]]; then
  TODAY_EXPERIENCE=$(find "$EXPERIENCES_DIR" -name "${TODAY}*" -type f 2>/dev/null | head -1)
  if [[ -n "$TODAY_EXPERIENCE" ]]; then
    HAS_EXPERIENCE=true
  fi
fi

# Also check if context.json was updated today (recent_decisions not empty)
if [[ -f "$CONTEXT_FILE" ]]; then
  DECISIONS_COUNT=$(jq -r '.recent_decisions | length' "$CONTEXT_FILE" 2>/dev/null || echo "0")
  LAST_UPDATED=$(jq -r '.session_metadata.last_updated // ""' "$CONTEXT_FILE" 2>/dev/null || echo "")
  if [[ "$DECISIONS_COUNT" -gt 0 && -n "$LAST_UPDATED" ]]; then
    if [[ "$LAST_UPDATED" == *"$TODAY"* ]]; then
      HAS_EXPERIENCE=true
    fi
  fi
fi

if [[ "$HAS_EXPERIENCE" == "true" ]]; then
  # Blackboard was written, clean up and allow stop
  rm -f "$EDIT_COUNTER" "$STATE_DIR/.plan-presented" 2>/dev/null
  exit 0
fi

# Work was done but no blackboard write — nudge (don't block)
cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "[ftm-blackboard-enforcer] You did meaningful work this session but did not record an experience to the blackboard. Before finishing, please: (1) Update ~/.claude/ftm-state/blackboard/context.json with current_task status and recent_decisions. (2) Write an experience file to ~/.claude/ftm-state/blackboard/experiences/ with task_type, tags, outcome, and lessons. (3) Update ~/.claude/ftm-state/blackboard/experiences/index.json with the new entry. This is how ftm learns — skipping it means the next session starts from zero."
  }
}
JSON

# Clean up session markers regardless — don't let stale state carry over
rm -f "$EDIT_COUNTER" "$STATE_DIR/.plan-presented" 2>/dev/null
exit 0
