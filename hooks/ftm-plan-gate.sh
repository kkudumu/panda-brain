#!/usr/bin/env bash
# ftm-plan-gate.sh
# PreToolUse hook for Edit/Write tools AND mutating MCP calls.
#
# Checks if a plan has been presented this session before allowing code edits
# or external API mutations. If no plan marker exists and the action count is
# climbing, injects warnings telling Claude to stop and present a plan first.
#
# Gates: Edit, Write, and MCP tools that create/update/delete external resources
# (Freshservice, Okta, Jira, Slack sends, Gmail sends, etc.)
#
# The marker file (~/.claude/ftm-state/.plan-presented) is created by Claude
# when it presents a plan. Any non-empty content counts as "plan presented".
# The file is cleaned up by the blackboard enforcer at session end.
#
# Hook: PreToolUse (matcher: Edit|Write|mcp__*)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Determine if this is a gated tool
IS_GATED=false

# Gate Edit and Write
if [[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" ]]; then
  IS_GATED=true
fi

# Gate mutating MCP calls (create, update, delete, send, add, remove, apply, transition)
if [[ "$TOOL_NAME" == mcp__* ]]; then
  case "$TOOL_NAME" in
    *create*|*update*|*delete*|*send*|*add*|*remove*|*apply*|*transition*|*commit*|*push*|*post_message*|*reply*|*modify*|*batch*|*convert*)
      IS_GATED=true
      ;;
  esac
fi

if [[ "$IS_GATED" != "true" ]]; then
  exit 0
fi

STATE_DIR="$HOME/.claude/ftm-state"
PLAN_MARKER="$STATE_DIR/.plan-presented"
EDIT_COUNTER="$STATE_DIR/.edit-count"

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

# If plan marker exists (any content), allow edits
if [[ -f "$PLAN_MARKER" ]] && [[ -s "$PLAN_MARKER" ]]; then
  exit 0
fi

# Reset edit counter if it's stale (older than 4 hours = likely a new session)
if [[ -f "$EDIT_COUNTER" ]]; then
  COUNTER_AGE=$(( $(date +%s) - $(stat -c %Y "$EDIT_COUNTER" 2>/dev/null || echo "0") ))
  if [[ "$COUNTER_AGE" -gt 14400 ]]; then
    rm -f "$EDIT_COUNTER"
  fi
fi

# Count edits without a plan marker
EDIT_COUNT=0
if [[ -f "$EDIT_COUNTER" ]]; then
  EDIT_COUNT=$(cat "$EDIT_COUNTER" 2>/dev/null || echo "0")
fi

EDIT_COUNT=$((EDIT_COUNT + 1))
echo "$EDIT_COUNT" > "$EDIT_COUNTER"

# First 2 edits get a soft reminder (don't block — could be micro tasks)
# After 3+ edits without a plan marker, escalate the warning
if [[ $EDIT_COUNT -le 2 ]]; then
  cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[ftm-plan-gate] You are editing files without having presented a plan this session. If this task is medium+ (touches 3+ files, involves external systems, or has stakeholder coordination), you MUST present a numbered plan and get user approval BEFORE editing code. If this is a micro/small task, you can proceed — but create the plan marker: write any content to ~/.claude/ftm-state/.plan-presented to acknowledge you've considered it."
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
    "additionalContext": "[ftm-plan-gate WARNING] You have made 3+ file edits this session without presenting a plan. This is exactly the 'grinding without a plan' pattern that ftm-mind is supposed to prevent. STOP editing and do one of: (1) Present a numbered plan to the user and wait for approval, then write any content to ~/.claude/ftm-state/.plan-presented. (2) If the user explicitly said 'just do it' or this is genuinely a micro task, write the plan marker to acknowledge you've considered it. Do NOT continue editing without addressing this."
  }
}
JSON
exit 0
