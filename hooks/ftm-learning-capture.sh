#!/bin/bash
# ftm-learning-capture.sh
# Hook: Capture write/task completions into learning engine DB
# Trigger: PostToolUse
#
# Behavior:
# - Runs only for active ftm sessions (context.json has non-completed task)
# - Captures Write/Edit/Bash/task-style MCP completions into learning events
# - Routes known categories into knowledge files via brain.py if available
# - If category mapping is unknown, asks Claude to confirm category expansion

set -euo pipefail

FTM_STATE="$HOME/.claude/ftm-state"
CONTEXT_JSON="$FTM_STATE/blackboard/context.json"

PAYLOAD=$(cat)
if [ -z "$PAYLOAD" ]; then
  exit 0
fi

HOOK_EVENT=$(printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("hook_event_name", ""))
except Exception:
    print("")
' 2>/dev/null)

if [ "$HOOK_EVENT" != "PostToolUse" ]; then
  exit 0
fi

TOOL_NAME=$(printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_name", ""))
except Exception:
    print("")
' 2>/dev/null)

case "$TOOL_NAME" in
  Write|Edit|MultiEdit|NotebookEdit|Bash|Task|mcp__*) ;;
  *) exit 0 ;;
esac

# Session gating: check if context.json has an active (non-completed) session
IS_FTM_ACTIVE=$(python3 -c "
import json, sys
try:
    with open('$CONTEXT_JSON') as f:
        d = json.load(f)
    task = d.get('current_task', {})
    status = task.get('status', '')
    print('1' if status not in ('', 'completed', 'none') else '0')
except Exception:
    print('0')
" 2>/dev/null)

if [ "$IS_FTM_ACTIVE" != "1" ]; then
  exit 0
fi

# Attempt brain.py capture if available (ftm skill may ship its own brain.py)
BRAIN_PY="$HOME/.claude/skills/ftm/bin/brain.py"
if [ ! -f "$BRAIN_PY" ]; then
  BRAIN_PY="$HOME/.claude/ftm-state/brain.py"
fi

if [ -f "$BRAIN_PY" ]; then
  RESULT=$(printf '%s' "$PAYLOAD" | python3 "$BRAIN_PY" --capture-post-tool 2>/dev/null || echo '{"recorded": false}')

  NEEDS_EXPANSION=$(printf '%s' "$RESULT" | python3 -c '
import json, sys
try:
    print("1" if json.load(sys.stdin).get("needs_category_expansion") else "0")
except Exception:
    print("0")
' 2>/dev/null)

  if [ "$NEEDS_EXPANSION" = "1" ]; then
    PROPOSED_CATEGORY=$(printf '%s' "$RESULT" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("proposed_category", "new-category"))
except Exception:
    print("new-category")
' 2>/dev/null)

    SAFE_PROPOSED=$(printf '%s' "$PROPOSED_CATEGORY" | tr -cd '[:alnum:]-_')
    if [ -z "$SAFE_PROPOSED" ]; then
      SAFE_PROPOSED="new-category"
    fi

    echo ""
    echo "[Learning Engine] Captured a completion event that does not match an existing learning category."
    echo "Before wrapping up, ask the user:"
    echo "\"Should we add learning category '$SAFE_PROPOSED' so future ftm completions route cleanly?\""
    echo ""
  fi
fi

# --- Auto-Playbook Trigger: detect repeated errors then success on same module ---
ERROR_TRACKER="$FTM_STATE/.error-tracker.jsonl"

if [ "$TOOL_NAME" = "Bash" ]; then
  # Extract module/import and error status from the tool result
  ANALYSIS=$(printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    output = d.get("tool_result", "") or ""
    tool_input = d.get("tool_input", {})
    command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
    is_error = "Error:" in output or "Traceback" in output or "AttributeError" in output or "TypeError" in output or "ImportError" in output or "ModuleNotFoundError" in output
    # Extract the primary module from import statements in the command
    module = ""
    for line in command.split("\n"):
        line = line.strip()
        if line.startswith("from ") and " import " in line:
            module = line.split("from ")[1].split(" import")[0].strip()
            break
        elif line.startswith("import "):
            module = line.split("import ")[1].split()[0].strip()
            break
    import json as j
    j.dump({"is_error": is_error, "module": module}, sys.stdout)
except Exception:
    import json as j
    j.dump({"is_error": False, "module": ""}, sys.stdout)
' 2>/dev/null)

  IS_ERROR=$(printf '%s' "$ANALYSIS" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("is_error") else "0")' 2>/dev/null)
  MODULE=$(printf '%s' "$ANALYSIS" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("module",""))' 2>/dev/null)

  if [ -n "$MODULE" ]; then
    TIMESTAMP=$(date +%s)
    if [ "$IS_ERROR" = "1" ]; then
      # Append error event
      echo "{\"ts\":$TIMESTAMP,\"module\":\"$MODULE\",\"type\":\"error\"}" >> "$ERROR_TRACKER"
    else
      # Success — check if this module had 3+ recent errors
      if [ -f "$ERROR_TRACKER" ]; then
        ERROR_COUNT=$(python3 -c "
import json, sys
count = 0
cutoff = $TIMESTAMP - 600  # last 10 minutes
for line in open('$ERROR_TRACKER'):
    line = line.strip()
    if not line: continue
    try:
        ev = json.loads(line)
        if ev.get('module') == '$MODULE' and ev.get('type') == 'error' and ev.get('ts', 0) >= cutoff:
            count += 1
    except: pass
print(count)
" 2>/dev/null)

        if [ "$ERROR_COUNT" -ge 3 ]; then
          # Write a blackboard experience with the module and error count
          SLUG=$(echo "$MODULE" | tr '.' '-' | tr '[:upper:]' '[:lower:]')
          DATE_STAMP=$(date +%Y-%m-%d)
          EXP_FILE="$FTM_STATE/blackboard/experiences/${DATE_STAMP}_auto-playbook-${SLUG}.json"
          python3 -c "
import json, os, datetime
exp = {
    'task_type': 'api-discovery',
    'task_description': 'Auto-captured: $ERROR_COUNT errors on $MODULE before finding the working pattern',
    'lessons_learned': [
        '$MODULE required $ERROR_COUNT attempts to get right — working pattern saved as playbook',
        'Check experience code_patterns before using this module in future sessions'
    ],
    'code_patterns': [],
    'api_gotchas': [],
    'playbook_ref': None,
    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
    'confidence': 0.7,
    'tags': ['auto-playbook', '$(echo "$MODULE" | tr "." " ")']
}
os.makedirs(os.path.dirname('$EXP_FILE'), exist_ok=True)
with open('$EXP_FILE', 'w') as f:
    json.dump(exp, f, indent=2)

# Update index
idx_path = '$FTM_STATE/blackboard/experiences/index.json'
try:
    with open(idx_path) as f:
        idx = json.load(f)
except:
    idx = {'entries': [], 'metadata': {'total_count': 0, 'last_updated': None, 'max_entries': 200, 'pruning_strategy': 'remove_oldest_low_confidence'}}

idx['entries'].append({
    'id': 'auto-playbook-${SLUG}-${DATE_STAMP}',
    'file': os.path.basename('$EXP_FILE'),
    'task_type': 'api-discovery',
    'tags': ['auto-playbook', '$(echo "$MODULE" | tr "." " ")'],
    'timestamp': exp['timestamp'],
    'confidence': 0.7
})
idx['metadata']['total_count'] = len(idx['entries'])
idx['metadata']['last_updated'] = exp['timestamp']
with open(idx_path, 'w') as f:
    json.dump(idx, f, indent=2)
" 2>/dev/null

          echo ""
          echo "[Auto-Playbook] Detected $ERROR_COUNT errors on '$MODULE' followed by a success in this session."
          echo "A skeleton experience has been saved to the blackboard at: $EXP_FILE"
          echo "NOW you MUST do two things:"
          echo "1. Proactively invoke ftm-capture to save the working code pattern as a playbook"
          echo "2. Update the experience file at $EXP_FILE — fill in the code_patterns array with the working snippet and api_gotchas with every wrong assumption you hit"
          echo "Tell the user: \"That was rough — I'm saving the working pattern so next time it's one clean shot.\""
          echo ""

          # Clear tracked errors for this module so we don't re-trigger
          python3 -c "
import json
lines = []
for line in open('$ERROR_TRACKER'):
    line = line.strip()
    if not line: continue
    try:
        ev = json.loads(line)
        if ev.get('module') != '$MODULE':
            lines.append(line)
    except: pass
with open('$ERROR_TRACKER', 'w') as f:
    f.write('\n'.join(lines) + '\n' if lines else '')
" 2>/dev/null
        fi
      fi
    fi
  fi
fi

# --- Feed Playbook Tracer if active trace exists ---
ACTIVE_TRACE_FILE="$FTM_STATE/.active-trace-id"
if [ -f "$ACTIVE_TRACE_FILE" ] && [ -f "$BRAIN_PY" ]; then
    TRACE_ID=$(cat "$ACTIVE_TRACE_FILE")
    printf '%s' "$PAYLOAD" | python3 -c "
import sys, json
d = json.load(sys.stdin)
tool_name = d.get('tool_name', '')
if tool_name:
    event = {'trace_id': '$TRACE_ID', 'event': {'type': 'tool_call', 'tool': tool_name, 'params': d.get('tool_input', {})}}
    json.dump(event, sys.stdout)
" 2>/dev/null | python3 "$BRAIN_PY" --playbook-trace-event 2>/dev/null
fi

exit 0
