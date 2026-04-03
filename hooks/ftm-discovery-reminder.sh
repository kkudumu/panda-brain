#!/usr/bin/env bash
# ftm-discovery-reminder.sh
# UserPromptSubmit hook that detects when a user's prompt mentions
# external systems, migrations, rerouting, or stakeholder coordination.
# Injects a reminder about the discovery interview before Claude starts working.
#
# This is a soft nudge, not a block — it adds additionalContext that
# reminds Claude about the ftm-mind discovery interview protocol.
#
# Hook: UserPromptSubmit

set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')

# Lowercase the prompt for matching
PROMPT_LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# Patterns that indicate external system work requiring discovery interview
EXTERNAL_PATTERNS=(
  "reroute"
  "migrate"
  "migration"
  "move.*to.*board"
  "move.*to.*project"
  "point.*to.*new"
  "update.*integration"
  "change.*endpoint"
  "switch.*from.*to"
  "redirect.*to"
  "jira.*automation"
  "freshservice.*automation"
  "update.*workflow"
  "change.*routing"
  "slack.*message.*to"
  "email.*to"
  "draft.*message"
  "notify.*about"
  "check.*with"
  "coordinate.*with"
  "ask.*about"
  "tell.*about.*change"
)

# Patterns that indicate the user already provided comprehensive context
# (e.g., pasted a Slack thread, gave detailed instructions)
CONTEXT_SIGNALS=(
  "here's the slack"
  "here's the thread"
  "here's what they said"
  "per the conversation"
  "just do it"
  "no questions"
  "skip the interview"
  "don't ask"
)

# Check if user already provided enough context
for signal in "${CONTEXT_SIGNALS[@]}"; do
  if [[ "$PROMPT_LOWER" == *"$signal"* ]]; then
    exit 0  # User explicitly provided context or asked to skip
  fi
done

# Check for external system patterns
MATCHED=false
MATCHED_PATTERN=""
for pattern in "${EXTERNAL_PATTERNS[@]}"; do
  if echo "$PROMPT_LOWER" | grep -qE "$pattern"; then
    MATCHED=true
    MATCHED_PATTERN="$pattern"
    break
  fi
done

if [[ "$MATCHED" == "false" ]]; then
  exit 0  # No external system work detected
fi

# Check blackboard for experiences that say "you already have access — just do it"
# If a matching experience exists with tags like "api-access" or "full-access",
# skip the discovery interview — the user has already established this context.
FTM_STATE="$HOME/.claude/ftm-state"
EXP_INDEX="$FTM_STATE/blackboard/experiences/index.json"
CWD_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")

if [ -f "$EXP_INDEX" ]; then
  SKIP_DISCOVERY=$(python3 -c "
import json, sys
try:
    with open('$EXP_INDEX') as f:
        idx = json.load(f)
    for entry in idx.get('entries', []):
        tags = entry.get('tags', [])
        # Skip discovery if there's an experience tagged with api-access or the repo name
        # that indicates we already know we have credentials and should just act
        tag_str = ' '.join(tags).lower()
        if 'api-access' in tag_str or 'full-access' in tag_str or 'just-do-it' in tag_str:
            print('1')
            sys.exit(0)
        if '$CWD_NAME' in tag_str and ('api' in tag_str or 'access' in tag_str or 'credentials' in tag_str):
            print('1')
            sys.exit(0)
    print('0')
except:
    print('0')
" 2>/dev/null)

  if [ "$SKIP_DISCOVERY" = "1" ]; then
    # Don't block — but change the nudge to "you have access, just do it"
    cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[ftm-discovery-reminder] Blackboard has an experience confirming API access in this repo. Do NOT run a discovery interview — you have credentials and access. Just do the thing. If something fails, debug it directly."
  }
}
JSON
    exit 0
  fi
fi

# Inject discovery interview reminder
cat <<JSON
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[ftm-discovery-reminder] This request involves external systems or stakeholder coordination (matched: ${MATCHED_PATTERN}). Before generating a plan or starting work, run the Discovery Interview from ftm-mind section 10. Ask 2-4 focused questions about: (1) who else needs to know, (2) downstream dependencies, (3) anything to leave as-is, (4) timeline/approval constraints. The user's answers should feed into the plan. Skip the interview ONLY if the user already provided comprehensive context in their message or explicitly said to skip it."
  }
}
JSON
exit 0
