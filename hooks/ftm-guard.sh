#!/bin/sh
# ftm-guard.sh
# Safety system for all Claude Code sessions with ftm installed.
# Fires on PreToolUse for mutating tools. Injects safety context
# before Claude executes external mutations, destructive actions,
# or enters trial-and-error loops.
#
# Hook: PreToolUse (matcher: Edit|Write|Bash|mcp__*)
#
# This is NOT gated on ftm session state — it protects ALL sessions.

set -eu

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

# Only gate mutating operations
IS_MUTATING=false

case "$TOOL_NAME" in
  Edit|Write) IS_MUTATING=true ;;
  Bash)
    # Check if the bash command contains mutating API patterns
    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
    case "$COMMAND" in
      *deleteFS*|*delete_custom_object*|*DELETE*|*putFS*|*postFS*) IS_MUTATING=true ;;
      *"curl -X DELETE"*|*"curl -X PUT"*|*"curl -X POST"*|*"curl -X PATCH"*) IS_MUTATING=true ;;
      *"requests.delete"*|*"requests.put"*|*"requests.post"*|*"requests.patch"*) IS_MUTATING=true ;;
    esac
    ;;
esac

# Also catch mutating MCP calls
case "$TOOL_NAME" in
  mcp__*create*|mcp__*update*|mcp__*delete*|mcp__*send*|mcp__*add*|mcp__*remove*|mcp__*apply*|mcp__*transition*|mcp__*commit*|mcp__*push*|mcp__*post_message*|mcp__*reply*|mcp__*modify*|mcp__*batch*|mcp__*convert*)
    IS_MUTATING=true ;;
esac

if [ "$IS_MUTATING" != "true" ]; then
  exit 0
fi

# --- Build safety context based on what's about to happen ---

FTM_STATE="$HOME/.claude/ftm-state"
CONTEXT_PARTS=""

# Check 1: Is this a destructive action?
IS_DESTRUCTIVE=false
case "$TOOL_NAME" in
  mcp__*delete*|mcp__*remove*) IS_DESTRUCTIVE=true ;;
esac
case "${COMMAND:-}" in
  *deleteFS*|*delete_custom_object*|*"curl -X DELETE"*|*"requests.delete"*|*DELETE*) IS_DESTRUCTIVE=true ;;
esac

if [ "$IS_DESTRUCTIVE" = "true" ]; then
  CONTEXT_PARTS="$CONTEXT_PARTS [DESTRUCTIVE ACTION GATE] You are about to DELETE an external resource. STOP. Confirm with the user FIRST — name the specific resource being deleted and warn about downstream dependencies (workflow configs, automation references, lookup fields). Never delete-and-recreate to fix something. See ftm-mind/references/incidents.md -> Braintrust Incident."
fi

# Check 2: Is there a playbook for this system?
SYSTEM=""
case "$TOOL_NAME" in
  mcp__freshservice*) SYSTEM="freshservice" ;;
  mcp__mcp-atlassian*) SYSTEM="jira" ;;
  mcp__slack*) SYSTEM="slack" ;;
  mcp__gmail*) SYSTEM="gmail" ;;
esac
# Also detect from bash commands
case "${COMMAND:-}" in
  *freshservice*|*getFS*|*putFS*|*postFS*|*deleteFS*) SYSTEM="freshservice" ;;
  *okta*|*OktaGroup*|*OktaUser*) SYSTEM="okta" ;;
esac

if [ -n "$SYSTEM" ]; then
  # Check if playbook was consulted this session
  PLAYBOOK_MARKER="$FTM_STATE/.playbook-checked-$SYSTEM"
  if [ ! -f "$PLAYBOOK_MARKER" ]; then
    CONTEXT_PARTS="$CONTEXT_PARTS [PLAYBOOK CHECK] You are calling $SYSTEM APIs. Did you check for playbooks FIRST? Run: brain.py --playbook-match and check docs/playbooks/ and blackboard experiences with code_patterns. If you haven't, STOP and check now. Write to $PLAYBOOK_MARKER after checking."
  fi
fi

# Check 3: Loop detection — count recent failures for this system
ERROR_TRACKER="$FTM_STATE/.error-tracker.jsonl"
if [ -f "$ERROR_TRACKER" ] && [ -n "$SYSTEM" ]; then
  NOW=$(date +%s)
  RECENT_ERRORS=$(python3 -c "
import json
count = 0
cutoff = $NOW - 600
for line in open('$ERROR_TRACKER'):
    line = line.strip()
    if not line: continue
    try:
        ev = json.loads(line)
        if ev.get('module','').lower().find('$SYSTEM') >= 0 and ev.get('type') == 'error' and ev.get('ts',0) >= cutoff:
            count += 1
    except: pass
print(count)
" 2>/dev/null || echo "0")

  if [ "$RECENT_ERRORS" -ge 3 ]; then
    CONTEXT_PARTS="$CONTEXT_PARTS [LOOP DETECTED] $RECENT_ERRORS recent errors on $SYSTEM in the last 10 minutes. STOP trial-and-error. Find a WORKING reference resource, GET it, diff field-by-field against the broken one, and make targeted changes. The answer is in the diff, not in your next guess."
  fi
fi

# Output combined safety context if any checks triggered
if [ -n "$CONTEXT_PARTS" ]; then
  # Escape for JSON
  ESCAPED=$(echo "$CONTEXT_PARTS" | sed 's/"/\\"/g' | tr '\n' ' ')
  cat <<JSONEOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[ftm-guard]$ESCAPED"
  }
}
JSONEOF
fi

exit 0
