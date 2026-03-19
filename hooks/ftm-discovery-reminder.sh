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
