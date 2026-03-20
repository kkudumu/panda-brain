---
name: ftm-codex-gate
description: Codex CLI integration gate for adversarial code validation. Invokes codex exec --yolo --ephemeral with gpt-5.4 to form test scenarios, review code quality, fix failures, and enforce STYLE.md patterns. Use when ftm-executor needs Codex validation at wave boundaries or task completion, or when user says "codex gate", "run codex", "validate with codex". Not for direct user interaction — primarily auto-invoked by ftm-executor.
---

## Events

### Emits
- `review_complete` — when Codex finishes analysis and a PASS, PASS_WITH_FIXES, or FAIL verdict is produced
- `issue_found` — when Codex identifies a quality violation, INTENT.md conflict, or test failure in the reviewed files
- `task_completed` — when the gate run concludes and results are returned to the calling skill

### Listens To
- `code_committed` — run adversarial validation at wave boundaries after commits land in the executor's worktree

## Blackboard Read

Before starting, load context from the blackboard:

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by tags matching "validation", "codex", or "review"
3. Load top 3-5 matching experience files for patterns in what Codex commonly flags or auto-fixes
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check recurring_issues for common validation failures and execution_patterns for typical fix types

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# Codex Gate

This skill is the integration layer between ftm-executor and the Codex CLI. It constructs adversarial validation prompts, runs them through `codex exec`, captures structured output, and returns results to the calling skill. It does not interact with the user directly — it is invoked at wave boundaries or task completion.

---

## Inputs

Expect these inputs from the calling skill (ftm-executor). If any are missing, ask for them before proceeding.

- `file_list` — List of changed files to review (absolute paths)
- `acceptance_criteria` — The acceptance criteria from the plan tasks in this wave
- `wave_context` — A summary of what this wave accomplished
- `project_root` — The working directory path (absolute)
- `mode` — `"wave"` (default) or `"single-task"`

---

## Step 1: Read Context Files

Read the following files from `project_root` before constructing the Codex prompt:

1. `{project_root}/INTENT.md` (root) — Provides function-level context on what each piece of code should do
2. `{project_root}/STYLE.md` — Provides code standards and AI-ergonomic patterns Codex must enforce
3. For each file in `file_list`, check if a module-level `INTENT.md` exists alongside it (e.g. `src/auth/INTENT.md`) and read it if present

If either root file is missing, note it in the prompt to Codex and continue — do not abort.

---

## Step 2: Determine Mode

- If `mode` is `"wave"`, use broad wave-level context in the prompt (all files together, full acceptance criteria, wave summary)
- If `mode` is `"single-task"`, scope the prompt tightly to the single task's files and criteria only

---

## Step 3: Construct the Codex Prompt

Build a prompt string using the template below. Substitute all `{variables}` before passing to Codex.

```
You are an adversarial code reviewer for a software project. Your job is to break the implementation, find edge cases, enforce code standards, and leave the codebase cleaner than you found it.

## Context

Mode: {mode}
Wave summary: {wave_context}

## Acceptance Criteria

{acceptance_criteria}

## Files Changed

{file_list — one per line}

## Reference Documents

### INTENT.md (root)
{contents of root INTENT.md, or "Not found — skip INTENT validation"}

### STYLE.md
{contents of STYLE.md, or "Not found — skip style enforcement"}

{if module-level INTENT.md files were found, include each one with a header like:}
### INTENT.md ({module path})
{contents}

## Your Tasks — execute all of these in order

1. Read every file in the file list. Understand what each function does and what it is supposed to do per INTENT.md.

2. Form adversarial test scenarios. Think about:
   - Edge cases the happy-path tests don't cover
   - Inputs that should fail gracefully but might not
   - Race conditions, off-by-one errors, null/undefined handling
   - Boundary conditions in the acceptance criteria
   - Any place INTENT.md says a function should do X but the code does Y

3. Run the tests. Fix every failure you find. Commit each fix separately with a descriptive message (e.g. "fix: handle null user in auth guard").

4. Review code quality against STYLE.md:
   - Flag any function over 50 lines
   - Flag any file over 1000 lines
   - Flag more than 3 levels of nesting
   - Flag barrel index.ts re-exports
   - Flag unclear naming that requires a comment to explain

5. Fix any STYLE.md violations. Commit each fix separately.

6. Append a summary of all findings and fixes to DEBUG.md at the project root. Use this format:
   ### Codex Gate — {timestamp}
   **Wave**: {wave_context summary, one line}
   **Fixes**: [list each fix with commit hash and description]
   **Quality issues**: [list each issue found, whether fixed or not]
   **INTENT.md conflicts**: [list any place code diverged from INTENT.md]

7. Write your structured output summary to the output file. Use exactly this format:

## Codex Gate Results

**Status**: PASS | PASS_WITH_FIXES | FAIL
**Tests formed**: [count]
**Tests passed**: [count]
**Fixes applied**: [count]
**Quality issues**: [count]

### Fixes Applied
- [commit hash]: [description]

### Remaining Issues
- [file:line] — [description]

### INTENT.md Conflicts
- [conflict description] — [affected function] — [what you changed vs what INTENT.md says]

Status rules:
- PASS: no failures, no quality issues
- PASS_WITH_FIXES: failures or quality issues found and resolved
- FAIL: failures remain that you could not fix
```

---

## Step 4: Generate Timestamp and Output Path

Generate a Unix timestamp for the output file path to avoid collisions:

```
TIMESTAMP=$(date +%s)
OUTPUT_FILE="/tmp/codex-result-${TIMESTAMP}.md"
```

---

## Step 5: Construct and Run the Command

Assemble the full command using the prompt from Step 3. Pass the prompt as the positional argument to `codex exec`.

Base command template:
```
codex exec --yolo --ephemeral -m "gpt-5.4" -c model_reasoning_effort="high" -o {OUTPUT_FILE} "{prompt}"
```

Full invocation example (run via Bash):
```bash
TIMESTAMP=$(date +%s)
OUTPUT_FILE="/tmp/codex-result-${TIMESTAMP}.md"
codex exec --yolo --ephemeral \
  -m "gpt-5.4" \
  -c model_reasoning_effort="high" \
  -o "$OUTPUT_FILE" \
  "$CODEX_PROMPT"
```

Set a timeout of 600 seconds. If Codex does not complete within 600s, move to Step 6 with whatever partial output exists.

**Flags reference:**
- `--yolo` — No sandbox, no approval prompts; Claude Code is the outer sandbox
- `--ephemeral` — No session state persisted on the Codex side
- `-m "gpt-5.4"` — Model to use
- `-c model_reasoning_effort="high"` — High reasoning effort for thorough analysis
- `-o {OUTPUT_FILE}` — Write structured output to this file for clean capture

---

## Step 6: Error Handling

Handle each failure case before reading the output file.

**Codex not found:**
```
If `which codex` returns nothing or the command exits with "command not found":
Return: "Codex CLI not found. Install with: npm install -g @openai/codex — then re-run the gate."
Do not proceed.
```

**Timeout (>600s):**
```
If the command exceeds 600 seconds:
Check if OUTPUT_FILE exists and has content.
If yes: proceed to Step 7 with a note "PARTIAL RESULTS — Codex timed out at 600s"
If no: return FAIL with message "Codex timed out with no output captured."
```

**Non-zero exit code:**
```
Capture stderr. Include it in the results under "Remaining Issues" as:
- [stderr content] — Codex exited with code {exit_code}
Proceed to Step 7 to read any partial output.
```

**Output file empty or missing:**
```
Return structured result with Status: FAIL and message:
"Codex output file not found or empty at {OUTPUT_FILE}. Codex may have crashed or produced no output."
```

---

## Step 7: Read and Parse the Output File

Read `OUTPUT_FILE`. Extract the structured block that begins with `## Codex Gate Results`.

Return the full structured summary to the calling skill (ftm-executor) in this exact format:

```
## Codex Gate Results

**Status**: PASS | PASS_WITH_FIXES | FAIL
**Tests formed**: [count]
**Tests passed**: [count]
**Fixes applied**: [count]
**Quality issues**: [count]

### Fixes Applied
- [commit hash]: [description]

### Remaining Issues
- [file:line] — [description]

### INTENT.md Conflicts
- [conflict description] — [affected function] — [what Codex changed vs what INTENT.md says]
```

If the output file does not contain the expected format, return the raw file content and flag it as unstructured with Status: FAIL.

---

## Step 8: Return to Caller

Pass the structured result back to ftm-executor. Do not post to any external system, do not notify the user directly unless ftm-executor explicitly delegates that to this skill.

If Status is FAIL or PASS_WITH_FIXES, include the full "Remaining Issues" and "INTENT.md Conflicts" sections so ftm-executor can decide whether to retry, escalate, or continue to the next wave.

---

## Invocation Modes Summary

| Mode | Scope | Prompt focus |
|------|-------|-------------|
| `wave` (default) | All files from completed wave | Full wave context, all acceptance criteria, broader adversarial sweep |
| `single-task` | Files from one task | Tight scope, single task criteria, targeted adversarial cases |

---

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions including the gate verdict (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing gate mode, verdict, tests formed/passed, fixes applied, and any INTENT.md conflicts found
3. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `task_completed` event

## Error Output Template

When returning an error before Codex runs:

```
## Codex Gate Results

**Status**: FAIL
**Error**: [description]
**Tests formed**: 0
**Tests passed**: 0
**Fixes applied**: 0
**Quality issues**: 0

### Remaining Issues
- [error detail]
```

## Requirements

- tool: `codex` | required | OpenAI Codex CLI for adversarial validation
- reference: `{project_root}/INTENT.md` | optional | root intent documentation for conflict detection
- reference: `{project_root}/STYLE.md` | optional | code style standards for quality enforcement
- reference: module-level `INTENT.md` files | optional | per-module intent for targeted conflict detection
- reference: `~/.claude/ftm-state/blackboard/context.json` | optional | session state
- reference: `~/.claude/ftm-state/blackboard/experiences/index.json` | optional | prior validation patterns

## Risk

- level: medium_write
- scope: Codex modifies source files and commits fixes directly in the project working directory (--yolo mode); writes entries to DEBUG.md; writes structured output to /tmp/codex-result-*.md
- rollback: git revert codex fix commits; delete /tmp/codex-result-*.md cleanup is automatic

## Approval Gates

- trigger: codex gate returns PASS_WITH_FIXES and INTENT.md conflict detected | action: auto-invoke ftm-council for arbitration before accepting or reverting the fix
- trigger: codex gate returns FAIL after 2 fix attempts | action: report remaining issues to ftm-executor caller, wait for direction
- trigger: codex CLI not found | action: return FAIL immediately with install instructions, do not proceed
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: codex CLI not installed | action: return FAIL with "Codex CLI not found. Install with: npm install -g @openai/codex"
- condition: codex times out after 600s | action: read partial output if available, return PARTIAL results with note; if no output, return FAIL
- condition: output file empty or missing | action: return FAIL with "Codex output not found — may have crashed"
- condition: INTENT.md missing at project root | action: note in prompt to Codex and continue without INTENT validation
- condition: STYLE.md missing | action: note in prompt to Codex and continue without style enforcement

## Capabilities

- cli: `codex` | required | OpenAI Codex CLI (npm install -g @openai/codex)
- env: `OPENAI_API_KEY` | required | authentication for Codex CLI execution

## Event Payloads

### review_complete
- skill: string — "ftm-codex-gate"
- mode: string — "wave" | "single-task"
- status: string — "PASS" | "PASS_WITH_FIXES" | "FAIL"
- tests_formed: number — adversarial test scenarios generated
- tests_passed: number — test scenarios that passed
- fixes_applied: number — fixes committed by Codex
- quality_issues: number — style/quality violations found
- intent_conflicts: number — INTENT.md conflicts detected

### issue_found
- skill: string — "ftm-codex-gate"
- file_path: string — file where issue was found
- line: number | null — line number if available
- description: string — issue description
- type: string — "test_failure" | "quality_violation" | "intent_conflict"

### task_completed
- skill: string — "ftm-codex-gate"
- status: string — "PASS" | "PASS_WITH_FIXES" | "FAIL"
- output_file: string — path to Codex result file
