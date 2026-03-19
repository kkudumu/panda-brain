#!/usr/bin/env bash
# ftm-blackboard-enforcer.sh
# Stop hook that checks if meaningful work was done but no blackboard
# experience was recorded. If so, blocks the stop and tells Claude
# to write the experience first.
#
# "Meaningful work" = 3+ tool uses detected by the edit counter,
# or ftm skills were invoked (checked via context.json).
#
# Hook: Stop

set -euo pipefail

INPUT=$(cat)

# Prevent infinite loop — if this hook already fired, let Claude stop
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then
  exit 0
fi

STATE_DIR="$HOME/.claude/ftm-state"
BB_DIR="$STATE_DIR/blackboard"
EDIT_COUNTER="$STATE_DIR/.edit-count"
CONTEXT_FILE="$BB_DIR/context.json"
EXPERIENCES_DIR="$BB_DIR/experiences"
EXPERIENCE_INDEX="$EXPERIENCES_DIR/index.json"

CURRENT_SESSION="${CLAUDE_SESSION_ID:-unknown}"

# Check 1: Were there meaningful edits this session?
HAD_EDITS=false
if [[ -f "$EDIT_COUNTER" ]]; then
  STORED=$(cat "$EDIT_COUNTER" 2>/dev/null || echo "0:unknown")
  STORED_SESSION=$(echo "$STORED" | cut -d: -f2)
  STORED_COUNT=$(echo "$STORED" | cut -d: -f1)
  if [[ "$STORED_SESSION" == "$CURRENT_SESSION" && "$STORED_COUNT" -ge 3 ]]; then
    HAD_EDITS=true
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

# If no meaningful work detected, allow stop
if [[ "$HAD_EDITS" == "false" && "$HAD_SKILLS" == "false" ]]; then
  exit 0
fi

# Check 3: Was an experience recorded today?
TODAY=$(date +%Y-%m-%d)
HAS_EXPERIENCE=false

if [[ -d "$EXPERIENCES_DIR" ]]; then
  # Check for experience files created today
  TODAY_EXPERIENCE=$(find "$EXPERIENCES_DIR" -name "${TODAY}*" -type f 2>/dev/null | head -1)
  if [[ -n "$TODAY_EXPERIENCE" ]]; then
    HAS_EXPERIENCE=true
  fi
fi

# Also check if context.json was updated this session (recent_decisions not empty)
if [[ -f "$CONTEXT_FILE" ]]; then
  DECISIONS_COUNT=$(jq -r '.recent_decisions | length' "$CONTEXT_FILE" 2>/dev/null || echo "0")
  LAST_UPDATED=$(jq -r '.session_metadata.last_updated // ""' "$CONTEXT_FILE" 2>/dev/null || echo "")
  if [[ "$DECISIONS_COUNT" -gt 0 && -n "$LAST_UPDATED" ]]; then
    # Check if last_updated is from today
    if [[ "$LAST_UPDATED" == *"$TODAY"* ]]; then
      HAS_EXPERIENCE=true
    fi
  fi
fi

if [[ "$HAS_EXPERIENCE" == "true" ]]; then
  # Blackboard was written, allow stop
  # Clean up session markers
  rm -f "$EDIT_COUNTER" "$STATE_DIR/.plan-presented" 2>/dev/null
  exit 0
fi

# Work was done but no blackboard write — block the stop
cat <<'JSON'
{
  "decision": "block",
  "reason": "[ftm-blackboard-enforcer] You did meaningful work this session (3+ edits or ftm skills used) but did not record an experience to the blackboard. Before stopping, you MUST: (1) Update ~/.claude/ftm-state/blackboard/context.json with current_task status and recent_decisions. (2) Write an experience file to ~/.claude/ftm-state/blackboard/experiences/ with task_type, tags, outcome, lessons, files_touched, stakeholders, and decisions_made. (3) Update ~/.claude/ftm-state/blackboard/experiences/index.json with the new entry. This is how ftm learns — skipping it means the next session starts from zero."
}
JSON
exit 0
