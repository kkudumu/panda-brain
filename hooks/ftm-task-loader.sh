#!/usr/bin/env bash
# ftm-task-loader.sh
# PostToolUse hook that fires after the Skill tool is invoked.
# When ftm-ops or ftm is the invoked skill, loads tasks from brain.py
# and injects TaskCreate instructions as additionalContext.
#
# This is deterministic — brain.py runs in the hook (fast), and the
# model receives pre-parsed TaskCreate calls it must execute.
#
# Hook: PostToolUse (matcher: Skill)

set -euo pipefail

INPUT=$(cat)

# Extract the tool name and check it's the Skill tool
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
if [[ "$TOOL_NAME" != "Skill" ]]; then
  exit 0
fi

# Extract which skill was invoked from the tool input
SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null)

# Only fire for ftm-ops, ftm, or ftm-mind (which routes to ftm-ops for task requests)
case "$SKILL_NAME" in
  ftm-ops|ftm|ftm-mind|eng-buddy) ;;
  *) exit 0 ;;
esac

# Find brain.py — check multiple locations
BRAIN_PY=""
for candidate in \
  "$HOME/.claude/skills/ftm/bin/brain.py" \
  "$HOME/.claude/skills/ftm-ops/../bin/brain.py" \
  "$HOME/Documents/Code/feed-the-machine/bin/brain.py"; do
  if [[ -f "$candidate" ]]; then
    BRAIN_PY="$candidate"
    break
  fi
done

if [[ -z "$BRAIN_PY" ]]; then
  # brain.py not found — skip silently
  exit 0
fi

# Run brain.py and capture task JSON
TASKS_JSON=$(python3 "$BRAIN_PY" --tasks --task-json 2>/dev/null) || exit 0

# Count active tasks
TASK_COUNT=$(echo "$TASKS_JSON" | python3 -c "
import sys, json
try:
    tasks = json.load(sys.stdin)
    active = [t for t in tasks if t.get('status') in ('pending', 'in_progress')]
    print(len(active))
except:
    print(0)
" 2>/dev/null)

if [[ "$TASK_COUNT" == "0" ]]; then
  exit 0
fi

# Generate TaskCreate instructions from the task data
TASK_INSTRUCTIONS=$(echo "$TASKS_JSON" | python3 -c "
import sys, json
try:
    tasks = json.load(sys.stdin)
    active = [t for t in tasks if t.get('status') in ('pending', 'in_progress')]
    lines = []
    for t in active:
        tid = t.get('id', t.get('legacy_number', '?'))
        title = t.get('title', 'Untitled')
        status = t.get('status', 'pending')
        priority = t.get('priority', 'medium')
        jira = t.get('jira_key', '')
        desc_parts = [status, priority]
        if jira:
            desc_parts.append(jira)
        desc = ' | '.join(desc_parts)
        lines.append(f'TaskCreate(subject: \"#{tid} {title}\", description: \"{desc}\")')
    print('\n'.join(lines))
except:
    pass
" 2>/dev/null)

if [[ -z "$TASK_INSTRUCTIONS" ]]; then
  exit 0
fi

# Output as additionalContext — the model MUST process this
cat <<EOF
[ftm-task-loader] Loaded $TASK_COUNT active tasks from tasks.db. You MUST now call TaskCreate for each one so they appear in Claude Code's sidebar task list. Do NOT skip this — rendering a table is not enough. Call each one:

$TASK_INSTRUCTIONS

Call all of these TaskCreate invocations NOW, before doing anything else. This is non-negotiable.
EOF
