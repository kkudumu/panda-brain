#!/bin/sh
# ftm-repo-context.sh
# UserPromptSubmit hook: injects repo-level blackboard context on first prompt.
# Fires once per session — writes a marker so it doesn't repeat.
#
# If the blackboard has an experience for the current repo (tagged with
# api-access, environment, or the repo name), it injects that context
# so Claude knows what access it has without being asked.
#
# Hook: UserPromptSubmit

set -eu

FTM_STATE="$HOME/.claude/ftm-state"
SESSION_MARKER="$FTM_STATE/.repo-context-injected"

# Only fire once per session (marker is cleaned by session-end hook)
if [ -f "$SESSION_MARKER" ]; then
  exit 0
fi

# Get repo name
CWD_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" 2>/dev/null || echo "unknown")

# Check for repo-level experiences in the blackboard
EXP_INDEX="$FTM_STATE/blackboard/experiences/index.json"
if [ ! -f "$EXP_INDEX" ]; then
  touch "$SESSION_MARKER"
  exit 0
fi

CONTEXT=$(python3 -c "
import json, sys, os

idx_path = '$EXP_INDEX'
exp_dir = os.path.dirname(idx_path)
cwd_name = '$CWD_NAME'.lower()

try:
    with open(idx_path) as f:
        idx = json.load(f)
except:
    sys.exit(0)

# Find experiences matching this repo
matches = []
for entry in idx.get('entries', []):
    tags = [t.lower() for t in entry.get('tags', [])]
    tag_str = ' '.join(tags)

    # Match on repo name + access/environment, or api-access/full-access tags
    is_match = False
    if cwd_name in tag_str and ('api' in tag_str or 'access' in tag_str or 'environment' in tag_str):
        is_match = True
    if 'api-access' in tags or 'full-access' in tags:
        is_match = True

    if is_match:
        # Load the full experience
        exp_file = os.path.join(exp_dir, entry.get('file', ''))
        if os.path.exists(exp_file):
            try:
                with open(exp_file) as f:
                    exp = json.load(f)
                desc = exp.get('description', '')
                lessons = exp.get('lessons', [])
                if desc:
                    matches.append({'desc': desc, 'lessons': lessons})
            except:
                pass

if not matches:
    sys.exit(0)

# Build context string
parts = []
for m in matches:
    parts.append(m['desc'])
    for l in m.get('lessons', []):
        parts.append('  - ' + l)

print('\n'.join(parts))
" 2>/dev/null)

# Write marker regardless
touch "$SESSION_MARKER"

# If we found context, inject it
if [ -n "$CONTEXT" ]; then
  ESCAPED=$(echo "$CONTEXT" | sed 's/"/\\"/g' | tr '\n' ' ')
  cat <<JSONEOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[ftm-repo-context] Blackboard context for this repo: $ESCAPED — You have confirmed access. Do NOT ask about credentials, API keys, or authorization. Use the tools and APIs available in this repo directly."
  }
}
JSONEOF
fi

exit 0
