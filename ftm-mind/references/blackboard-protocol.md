# Blackboard Loading Protocol

Read the blackboard in this order:

1. `context.json`
2. `experiences/index.json`
3. `patterns.json`

Use these exact paths:

- `~/.claude/ftm-state/blackboard/context.json`
- `~/.claude/ftm-state/blackboard/experiences/index.json`
- `~/.claude/ftm-state/blackboard/patterns.json`

## context.json

Use `context.json` for live session state only.

Pull out:

- `current_task`: does the request continue the active thread or branch away from it?
- `recent_decisions`: what did we already decide this session?
- `active_constraints`: no auto-commit, avoid production, stay terse, etc.
- `user_preferences`: communication and approval preferences
- `session_metadata.skills_invoked`: what workflow is already underway?

Key heuristic:

- trajectory matters more than isolated wording

If the last sequence was brainstorm -> plan -> execute, then "go ahead" means something different than if the session began 10 seconds ago.

## Experience Retrieval

Experience retrieval must be concrete, not hand-wavy.

Protocol:

1. Read `~/.claude/ftm-state/blackboard/experiences/index.json`
2. Parse `entries`
3. Derive a current `task_type`
4. Derive current tags from the request and codebase context
5. Filter entries where:
   - `task_type` matches the current task type, or
   - there is at least one overlapping tag
6. Sort filtered entries by `recorded_at` descending
7. Load the top 3-5 matching experience files from:
   - `~/.claude/ftm-state/blackboard/experiences/{filename}`
8. Prefer lessons from entries with:
   - `outcome: success`
   - higher `confidence`
   - recent dates
9. Synthesize the lessons into concrete adjustments to the current approach

Derive tags from:

- language or framework names
- domain nouns like `auth`, `poller`, `slack`, `database`, `deploy`, `calendar`, `jira`
- task shape like `flaky-test`, `refactor`, `ticket-triage`, `plan-execution`

Use retrieved experience for:

- complexity calibration
- known pitfalls
- better sequencing
- better routing
- faster first checks

Never use experience to blindly repeat an old approach when the live context has changed.

## Pattern Registry

Read `patterns.json` after experience retrieval.

Scan all four sections:

- `codebase_insights`
- `execution_patterns`
- `user_behavior`
- `recurring_issues`

Apply patterns only when they materially match the present case.

Examples:

- matching `file_pattern` on touched files
- recurring issue symptoms that fit the current failure
- user behavior that affects response style or approval expectations
- execution patterns that suggest a proven sequence

Patterns are promoted summaries. They should speed up orientation, not replace it.

## Cold-Start Behavior

Cold start is normal.

When the blackboard is empty:

- do not apologize
- do not say capability is reduced
- do not surface that memory is empty unless the user asked
- operate at full capability using live observation, codebase state, MCP awareness, and base heuristics

Warm start adds shortcuts. Cold start is still a smart engineer on day 1 at a new job.

If `experiences/index.json` has no usable matches:

- continue normally
- lean harder on current repo state and direct inspection
- record the resulting experience aggressively after completion

## Recording Code Patterns and API Gotchas

When writing an experience after task completion, actively check for these:

**code_patterns** — If during the task you wrote code that interacts with an API, library, or module, save the **final working version** (not the failed attempts). Include imports, setup, and the actual call. This is the copy-pasteable snippet future sessions will use.

**api_gotchas** — If you hit errors because an API behaved differently than expected (wrong return type, unexpected method name, None instead of Response, objects instead of dicts), record each one. Format: what the module is, what's surprising, and what you'd wrongly assume.

**playbook_ref** — If a brain.py playbook was created (via ftm-capture or auto-playbook trigger), record the path so the experience and playbook cross-reference each other.

**When to populate these fields:**
- You hit 2+ errors on the same module before getting it right → record code_patterns + api_gotchas
- You used an API/library for the first time in this project → record code_patterns
- The auto-playbook hook fired → record all three fields

**When to skip:**
- Pure file editing, config changes, or git operations — no API interaction worth capturing
- The code pattern is already in an existing experience (check by module name before duplicating)
