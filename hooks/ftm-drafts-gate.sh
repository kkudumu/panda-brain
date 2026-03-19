#!/usr/bin/env bash
# ftm-drafts-gate.sh
# PreToolUse hook for Slack/Gmail send tools.
#
# Before allowing a message to be sent via Slack or Gmail, checks that
# a corresponding draft exists in .ftm-drafts/ (project root) or
# ~/.claude/ftm-drafts/ (global fallback).
#
# If no draft exists, blocks the send and tells Claude to save the draft first.
#
# Hook: PreToolUse (matcher: mcp__slack__slack_post_message|mcp__slack__slack_reply_to_thread|mcp__gmail__send_email)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only gate send tools (not reads/searches)
case "$TOOL_NAME" in
  *slack_post_message*|*slack_reply_to_thread*|*send_email*)
    ;;
  *)
    exit 0  # Not a send tool, allow
    ;;
esac

# Check for drafts in project .ftm-drafts/ or global ~/.claude/ftm-drafts/
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
PROJECT_DRAFTS="${CWD}/.ftm-drafts"
GLOBAL_DRAFTS="$HOME/.claude/ftm-drafts"

HAS_RECENT_DRAFT=false

# Check both locations for any draft file modified in the last 30 minutes
for DRAFTS_DIR in "$PROJECT_DRAFTS" "$GLOBAL_DRAFTS"; do
  if [[ -d "$DRAFTS_DIR" ]]; then
    # Find draft files modified in the last 30 minutes
    RECENT=$(find "$DRAFTS_DIR" -name "*.md" -mmin -30 2>/dev/null | head -1)
    if [[ -n "$RECENT" ]]; then
      HAS_RECENT_DRAFT=true
      break
    fi
  fi
done

if [[ "$HAS_RECENT_DRAFT" == "true" ]]; then
  # Draft exists, allow the send (the external-action-guard will still prompt for approval)
  exit 0
fi

# No draft found — block and tell Claude to save one first
cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "[ftm-drafts-gate] No draft found in .ftm-drafts/ before sending. Save the message to .ftm-drafts/ first (using the draft-before-send protocol from ftm-mind section 3.5), then retry the send. This creates an audit trail and lets the user review before sending."
  }
}
JSON
exit 0
