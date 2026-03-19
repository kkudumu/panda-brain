#!/usr/bin/env bash
# ftm-plan-gate.sh
# PreToolUse hook for Edit/Write tools.
#
# Checks if a plan has been presented and approved for this session before
# allowing code edits. If no plan marker exists and the session involves
# a medium+ task (detected by ftm-state), injects additionalContext
# telling Claude to stop and present a plan first.
#
# The marker file is created by Claude when it presents a plan — we check
# for it here. If the marker doesn't exist but edits are happening, it
# means Claude skipped the planning step.
#
# Hook: PreToolUse (matcher: Edit|Write)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only gate Edit and Write tools
if [[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

STATE_DIR="$HOME/.claude/ftm-state"
PLAN_MARKER="$STATE_DIR/.plan-presented"
SESSION_MARKER="$STATE_DIR/.session-id"
EDIT_COUNTER="$STATE_DIR/.edit-count"
SKILL_FILES_DIR="$HOME/.claude/skills"

# Get the file being edited
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Always allow edits to: skill files, ftm-state, drafts, .gitignore, markdown docs
# These are "meta" edits that happen during planning/setup, not code grinding
if [[ "$FILE_PATH" == *".claude/skills/"* ]] || \
   [[ "$FILE_PATH" == *".claude/ftm-state/"* ]] || \
   [[ "$FILE_PATH" == *".ftm-drafts/"* ]] || \
   [[ "$FILE_PATH" == *".gitignore" ]] || \
   [[ "$FILE_PATH" == *"INTENT.md"* ]] || \
   [[ "$FILE_PATH" == *"ARCHITECTURE.mmd"* ]] || \
   [[ "$FILE_PATH" == *"STYLE.md"* ]] || \
   [[ "$FILE_PATH" == *"DEBUG.md"* ]] || \
   [[ "$FILE_PATH" == *"PROGRESS.md"* ]] || \
   [[ "$FILE_PATH" == *"CLAUDE.md"* ]]; then
  exit 0
fi

# If plan marker exists and matches current session, allow
CURRENT_SESSION="${CLAUDE_SESSION_ID:-unknown}"
if [[ -f "$PLAN_MARKER" ]]; then
  MARKER_SESSION=$(cat "$PLAN_MARKER" 2>/dev/null || echo "")
  if [[ "$MARKER_SESSION" == "$CURRENT_SESSION" ]]; then
    exit 0  # Plan was presented this session, allow edits
  fi
fi

# Count edits this session (without a plan marker)
EDIT_COUNT=0
if [[ -f "$EDIT_COUNTER" ]]; then
  STORED=$(cat "$EDIT_COUNTER" 2>/dev/null || echo "0:unknown")
  STORED_SESSION=$(echo "$STORED" | cut -d: -f2)
  if [[ "$STORED_SESSION" == "$CURRENT_SESSION" ]]; then
    EDIT_COUNT=$(echo "$STORED" | cut -d: -f1)
  fi
fi

EDIT_COUNT=$((EDIT_COUNT + 1))
echo "${EDIT_COUNT}:${CURRENT_SESSION}" > "$EDIT_COUNTER"

# First 2 edits get a warning injected as context (don't block — could be micro tasks)
# After 3+ edits without a plan marker, escalate the warning
if [[ $EDIT_COUNT -le 2 ]]; then
  # Soft reminder — inject context but allow
  cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[ftm-plan-gate] You are editing files without having presented a plan this session. If this task is medium+ (touches 3+ files, involves external systems, or has stakeholder coordination), you MUST present a numbered plan and get user approval BEFORE editing code. If this is a micro/small task, you can proceed — but create the plan marker by writing the current session ID to ~/.claude/ftm-state/.plan-presented after confirming the task is genuinely small. To create the marker: Write tool → ~/.claude/ftm-state/.plan-presented with content being the session ID."
  }
}
JSON
  exit 0
fi

# 3+ edits without a plan — stronger warning
cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[ftm-plan-gate WARNING] You have made 3+ file edits this session without presenting a plan. This is exactly the 'grinding without a plan' pattern that ftm-mind is supposed to prevent. STOP editing and do one of: (1) Present a numbered plan to the user and wait for approval, then write the session ID to ~/.claude/ftm-state/.plan-presented. (2) If the user explicitly said 'just do it' or this is genuinely a micro task, write the plan marker to acknowledge you've considered it. Do NOT continue editing without addressing this."
  }
}
JSON
exit 0
