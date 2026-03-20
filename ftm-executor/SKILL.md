---
name: ftm-executor
description: Autonomous plan execution engine. Takes any plan document and executes it end-to-end with a dynamically assembled agent team — analyzing tasks, creating purpose-built agents, dispatching them in parallel worktrees, and running each through a commit-review-fix loop until complete. Use this skill whenever the user wants to execute a plan, run a plan doc, launch an agent team on tasks, or says things like "execute this plan", "run this", "launch agents on this doc", "take this plan and go", or points to a plan file and wants it implemented autonomously. Even if they just paste a plan path and say "go" — this is the skill.
---

## Events

### Emits
- `task_received` — when a new task is acknowledged and added to the execution queue
- `plan_generated` — when a plan document is created or validated and ready for review
- `plan_approved` — when the user confirms a plan and execution is authorized to begin
- `code_changed` — when files are modified in a worktree (pre-commit state)
- `code_committed` — when a git commit is successfully made in any worktree
- `test_passed` — when the test suite passes (post-task verification or full-suite run)
- `test_failed` — when the test suite fails during post-task verification or regression check
- `task_completed` — when a task passes all verification gates (tests, audit, Codex gate)
- `error_encountered` — when an unexpected error occurs that halts or disrupts a task or wave

### Listens To
- `plan_approved` — begin Phase 3 worktree setup and dispatch agents for the first wave

## Blackboard Read

Before starting, load context from the blackboard:

1. Read `/Users/kioja.kudumu/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `/Users/kioja.kudumu/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by task_type matching plan tasks and tags overlapping with the plan domain
3. Load top 3-5 matching experience files for relevant lessons on agent performance and timing
4. Read `/Users/kioja.kudumu/.claude/ftm-state/blackboard/patterns.json` — check execution_patterns for agent performance and timing accuracy patterns

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# Plan Executor

Autonomous agent-team orchestrator for plan documents. You read the plan, assemble the right team, give each agent its own worktree, and let them rip through tasks in a commit-review-fix loop until everything is done.

## Why This Exists

Executing a multi-task plan manually means: read plan, pick a task, do it, commit, review, fix, repeat — while also tracking dependencies and parallelism yourself. That's slow and error-prone. This skill automates the entire thing by treating the plan as a job spec and dynamically building the team to fulfill it.

## The Process

### Phase 0: Plan Requirement Gate

**Before anything else, verify that a plan document exists and has been approved by the user.**

This gate exists because the executor's entire value comes from structured, parallel execution of a well-defined plan. Without a plan, you're just grinding through code changes sequentially — which is what ftm-mind's direct action path does, and it's worse at it than a focused engineer because it lacks the user's judgment about ordering and priorities.

**Check for a plan:**

1. Was a plan path provided? (e.g., the user said "execute ~/.claude/plans/foo.md" or ftm-mind routed with a plan reference)
2. If yes, read the plan and proceed to Phase 0.5.
3. If no plan path was provided, **do not start coding**. Instead:

   a. Read the user's request and the codebase context passed from ftm-mind.
   b. Generate a structured plan document with numbered tasks, file lists, dependencies, acceptance criteria, and verification steps.
   c. Present the plan to the user for approval:

   ```
   I need a plan before I can execute. Here's what I'd propose:

     1. [ ] [task description] → [files] | verify: [method]
     2. [ ] [task description] → [files] | verify: [method]
     3. [ ] [task description] → [files] | verify: [method]
     ...

   Approve? Or tell me what to change.
   ```

   d. Wait for user approval. Parse their response the same way ftm-mind's Interactive Plan Approval handles it (approve, skip N, modify step N, deny).
   e. Only after approval, save the plan to `~/.claude/plans/` and proceed to Phase 0.5.

**Why this gate matters**: The Jira rerouting incident showed what happens without it — the executor (or mind acting as executor) jumped straight into reading files and making 15+ edits across a 1700-line file without ever presenting a plan. The user never got to say "wait, also draft a Slack message to Mo" or "check with the ARIA team about epic assignment first" or "actually, don't change the sprint logic yet." By the time the user saw the changes, 2 minutes of grinding had already happened in the wrong direction. A 30-second plan would have caught all of this.

---

### Phase 0.5: Plan Verification Gate

**Before executing anything, validate the plan.** A bad plan wastes every agent's time. This gate catches structural problems, missing dependencies, and unrealistic scope before any code is written.

Spawn a **Plan Checker** agent to verify the plan:

```
You are a plan quality checker. Analyze this implementation plan and report issues.
Do NOT implement anything — just verify the plan is sound.

Plan path: [path]

Check these dimensions:

1. STRUCTURAL INTEGRITY
   - Every task has: description, files list, dependencies, acceptance criteria
   - Task numbering is consistent (no gaps, no duplicates)
   - Dependencies reference valid task numbers
   - No circular dependencies (Task A depends on B, B depends on A)

2. DEPENDENCY GRAPH VALIDITY
   - Build the full dependency graph
   - Verify all referenced tasks exist
   - Check for implicit dependencies (two tasks modifying the same file
     but not declared as dependent)
   - Flag tasks with too many dependencies (>3 usually means bad decomposition)

3. FILE CONFLICT DETECTION
   - Map every task to its file list
   - Flag any files touched by multiple tasks in the same wave
   - These MUST be sequential, not parallel — if the plan puts them
     in the same wave, that's a bug

4. SCOPE REASONABLENESS
   - Flag tasks that touch >10 files (probably too big for one agent)
   - Flag tasks with vague acceptance criteria ("make it work", "looks good")
   - Flag tasks with no verification steps

5. PROJECT COMPATIBILITY
   - Check that file paths reference real directories in the project
   - Verify the tech stack matches what the plan assumes
   - Check that dependencies/libraries the plan references are installed
     or listed in package.json/requirements.txt

Return a structured report:

PASS — plan is sound, proceed to execution
WARN — issues found but execution can proceed (list warnings)
FAIL — critical issues that must be fixed before execution (list blockers)

For FAIL findings, suggest specific fixes.
```

**Interpret the result:**
- **PASS**: Proceed to Phase 1
- **WARN**: Show warnings to user, proceed unless they object
- **FAIL**: Present blockers and suggested fixes. Ask user: fix the plan and re-run, or override and execute anyway?

If the plan checker finds file conflicts between tasks in the same wave, automatically restructure the wave ordering to make conflicting tasks sequential. Report the change.

---

### Phase 0.7: Load Model Profile

Read `~/.claude/ftm-config.yml` to determine which models to use for agent dispatch. If the file doesn't exist, use balanced defaults:
- Planning agents: opus
- Execution agents: sonnet
- Review/audit agents: sonnet

When spawning agents in subsequent phases, pass the `model` parameter based on the agent's role:
- Phase 2 (team assembly / plan checking): use `planning` model
- Phase 4 (task execution): use `execution` model
- Phase 4.5 (audit): use `review` model

If the profile specifies `inherit`, omit the `model` parameter (uses session default).

---

### Phase 1: Analyze the Plan

Read the plan document and extract:

1. **All tasks** — number, description, files touched, dependencies
2. **Dependency graph** — which tasks block which (the plan usually states this)
3. **Domain clusters** — group tasks by what kind of work they are (frontend, backend, infra, testing, styling, etc.)
4. **Parallelism opportunities** — independent tasks or independent clusters that can run simultaneously

Output a brief execution summary before proceeding:
```
Plan: [title]
Tasks: [N] total
Agents needed: [list with reasoning]
Parallel waves:
  Wave 1 (independent): Tasks 1, 2, 3, 4
  Wave 2 (depends on wave 1): Tasks 5, 6, 7
  Wave 3: Tasks 8-14
  ...
  Final: Task [N] (integration/cleanup)
```

### Phase 1.5: Documentation Layer Bootstrap

Before dispatching any agents, check if the project has the required documentation layer. If any of these files are missing, create them.

**Check for and create if missing:**
1. **INTENT.md** (project root) — If missing, bootstrap from the plan's Vision and Architecture Decisions sections. Use the ftm-intent skill's root template format.
2. **ARCHITECTURE.mmd** (project root) — If missing, bootstrap by scanning the codebase for modules and their import relationships. Use the ftm-diagram skill's root template format.
3. **STYLE.md** (project root) — If missing, copy from `~/.claude/skills/ftm-executor/references/STYLE-TEMPLATE.md` into the project root.
4. **DEBUG.md** (project root) — If missing, create with a header:
   ```markdown
   # Debug Log

   Failed approaches and their outcomes. Codex and Claude append here — never retry what's already logged.
   ```

This bootstrap runs once at the start of execution. If the files already exist, skip this phase entirely.

---

### Phase 2: Assemble the Agent Team

For each domain cluster, you need an agent. Here's how to pick or create them:

#### Check existing agents first

Look at the available agent types (the ones in the Agent tool). Map each task cluster to the best fit:

| Domain | Likely Agent |
|--------|-------------|
| React/UI/CSS/components | frontend-developer |
| API/server/database | backend-architect |
| CI/CD/deploy/infra | devops-automator |
| Tests/coverage | test-writer-fixer |
| Mobile/native | mobile-app-builder |
| AI/ML features | ai-engineer |
| General coding | general-purpose |

#### When no existing agent fits

If a task cluster requires specialized knowledge that none of the standard agents cover well — for example, "theme system with CSS custom properties and dark mode" or "WebSocket terminal integration" — create a purpose-built agent prompt.

Write a focused agent definition that includes:
- **Domain expertise**: What this agent knows deeply
- **Task context**: The specific tasks from the plan it will handle
- **Standards**: Coding conventions from the project (infer from existing code)
- **Constraints**: Don't touch files outside your scope

Store these as reference prompts in the skill workspace so they can be reused. The prompt becomes the `prompt` parameter when spawning the agent.

The goal is that over time, your agent library grows with battle-tested specialists. A "theme-engineer" agent created for one project's CSS system can be reused next time themes come up.

### Phase 3: Set Up Worktrees

Each agent gets its own isolated worktree so they don't step on each other's changes.

For each agent in the current wave:

1. Create a worktree branch: `plan-exec/<agent-name>` (e.g., `plan-exec/frontend-tasks-1-4`)
2. Use git worktree to create isolation:
   ```bash
   git worktree add .worktrees/plan-exec-<agent-name> -b plan-exec/<agent-name>
   ```
3. Run any project setup (npm install, etc.) in the worktree
4. Verify the worktree starts clean (tests pass or at least build succeeds)

Make sure `.worktrees/` is in `.gitignore` first. If it's not, add it.

### Phase 3.5: Initialize Progress Tracking

If `progress_tracking` is enabled in `~/.claude/ftm-config.yml` (default: true), create a `PROGRESS.md` file in the project root that gets updated after every significant event. This gives visibility into long-running executions without interrupting them.

**Create the initial file:**

```markdown
# FTM Executor — Progress

**Plan:** [plan title]
**Started:** [timestamp]
**Status:** IN PROGRESS

## Execution Summary
| Wave | Tasks | Status | Started | Completed |
|------|-------|--------|---------|-----------|
| 1 | [task list] | PENDING | — | — |
| 2 | [task list] | PENDING | — | — |
| ... | | | | |

## Task Status
| # | Title | Agent | Status | Audit | Notes |
|---|-------|-------|--------|-------|-------|
| 1 | [title] | [agent] | PENDING | — | |
| 2 | [title] | [agent] | PENDING | — | |
| ... | | | | | |

## Activity Log
[reverse chronological — newest first]
```

**Update PROGRESS.md at these events:**
- Wave starts → update wave status to `IN PROGRESS`, add timestamp
- Task agent returns → update task status to `COMPLETE` or `FAILED`, add audit result
- Wave completes → update wave status to `COMPLETE`, add timestamp
- Merge completes → add to activity log
- Errors/blockers → add to activity log with details

**Activity log entries** use this format:
```
### [HH:MM] [event type]
[brief description]
```

Example:
```
### 14:32 Wave 1 complete
Tasks 1-4 merged to main. All audits passed. 2 auto-fixes applied.

### 14:15 Task 3 audit — auto-fix
Added missing import for UserPreferences in SettingsView.tsx

### 13:45 Wave 1 started
Dispatching 4 agents in parallel: frontend (tasks 1,2), backend (task 3), testing (task 4)
```

This file is for human consumption — the user can check it anytime without interrupting execution. Keep entries concise and informative.

---

### Phase 4: Dispatch Agents

Launch agents for all tasks in the current wave **in parallel**. Each agent gets a prompt structured like this:

```
You are working in an isolated git worktree at: [worktree path]
Your working directory is: [worktree path]

## Your Assignment

Execute the following tasks from the plan:

[paste the relevant task sections verbatim from the plan doc]

## Plan Context

Full plan: [plan path]
Your tasks: [task numbers]
Dependencies satisfied: [list what was already completed in prior waves]

## Execution Loop

For EACH task, follow this cycle:

1. **Implement** — Follow the plan's steps exactly. Read files before modifying them. Use the project's existing patterns.

2. **Commit** — Before committing, run **ftm-git** to scan staged files for hardcoded secrets. If ftm-git emits `secrets_found`, stop and remediate before proceeding. Only after ftm-git emits `secrets_clear` or `secrets_remediated`, stage and commit your changes with a clear message describing what was done. Never reference AI/Claude in commit messages.

2.5. **Document** — Every commit must include documentation updates:
   - Update the module's INTENT.md: add entries for new functions, update entries for changed functions (Does/Why/Relationships/Decisions format)
   - Update the module's DIAGRAM.mmd: add nodes for new functions, update edges for changed dependencies
   - If you created a new module directory, also create its INTENT.md and DIAGRAM.mmd, and add rows to root INTENT.md module map and root ARCHITECTURE.mmd
   - Reference STYLE.md for code standards — your code must comply with all Hard Limits and Structure Rules

3. **Review** — After committing, review your own changes:
   - Run `git diff HEAD~1` to see what changed
   - Check for: bugs, missing error handling, type errors, style inconsistencies
   - Run any verification commands the plan specifies
   - Run the project's linter/typecheck if available

4. **Fix** — If the review surfaces issues:
   - Fix them immediately
   - Commit the fixes
   - Review again
   - Repeat until clean

5. **Continue** — Move to the next task. Do not stop to ask questions. If something is ambiguous, make the best technical decision and document it in your commit message.

## Rules

- NEVER stop to ask for input. Make decisions and keep going.
- ALWAYS commit after each task (not one big commit at the end).
- ALWAYS review after each commit. The review-fix loop is not optional.
- Follow the plan's steps exactly — don't improvise unless the plan is clearly wrong.
- Stay in your worktree. Don't touch files outside your assigned scope.
- If a verification step fails and you can't fix it in 3 attempts, note it in a commit message and move on.
- Run tests/build after each task if the project supports it.
- Read STYLE.md at the project root before writing code. Follow all Hard Limits and Structure Rules.
- Every commit must include: code changes + tests + INTENT.md update + DIAGRAM.mmd update. A commit without documentation updates is incomplete.
```

### Phase 4.5: Post-Task Audit (automatic)

After each task agent returns and before marking the task complete, run the ftm-audit verification automatically.

**Per-Task Verification Gate (runs before audit):**

Before running ftm-audit, verify these four checks pass for every task:

1. **Claude's tests pass** — any tests written or affected by the task must be green
2. **INTENT.md updated** — check that new/changed functions have entries in their module's INTENT.md
3. **Diagram updated** — check that new/changed functions have nodes in their module's DIAGRAM.mmd
4. **Full suite still green** — run the project's test suite (if one exists) and verify no regressions

5. **Visual smoke test (optional)** — If the project has a running dev server (detected via `lsof -i :3000` or `lsof -i :5173` or configured in plan metadata as `dev_server_url`), run:
   - `$PB goto <dev_server_url>`
   - `$PB screenshot`
   - Verify the screenshot shows a rendered page (not a blank screen or error page)
   - If the task modified UI components, `$PB snapshot -i` to verify new elements appear in the ARIA tree

   Where `$PB` is `$HOME/.claude/skills/ftm-browse/bin/ftm-browse`.

   **Graceful degradation**: If ftm-browse binary is not installed at `$HOME/.claude/skills/ftm-browse/bin/ftm-browse`, skip visual checks with a note: "Visual smoke test skipped — ftm-browse not installed." Do not fail the task.

A task is NOT marked complete until all four checks pass (check 5 is optional). If a check fails:
- For test failures: the agent must fix them before the task can complete
- For missing INTENT.md entries: add them (use ftm-intent format)
- For missing diagram nodes: add them (use ftm-diagram format)
- For regression failures: investigate and fix before continuing

**When to run:**
- After EVERY task agent returns with completed work
- SKIP for documentation-only tasks (tasks that only create/modify .md files with no code)
- SKIP if the plan explicitly marks a task with `audit: skip`

**How to run:**

1. **Invoke ftm-audit** against the agent's changes:
   - Scope the audit to the files the task modified (check the agent's commits)
   - If the task has a `Wiring:` contract in the plan, pass it to ftm-audit for contract checking
   - Run all three layers: knip static analysis → adversarial audit → auto-fix

2. **Interpret results:**
   - **PASS (no findings):** Mark task complete, proceed to next task
   - **PASS after auto-fix:** FTM-audit found issues and fixed them automatically. Commit the fixes in the agent's worktree with message "Auto-fix: wire [description]". Mark task complete.
   - **FAIL (manual intervention needed):** Task stays in-progress. Report the findings to the user:
     ```
     ⚠ Task [N] audit failed — manual intervention needed:
     - [finding 1 with file:line]
     - [finding 2 with file:line]
     Suggested fixes: [ftm-audit's suggestions]
     ```
     Wait for user input before continuing to next task.

3. **Include audit results in task completion report:**
   ```
   Task [N]: [title] — COMPLETE
   Audit: PASS (0 findings) | PASS after auto-fix (2 fixed) | FAIL (1 manual)
   [if auto-fixed: list what was fixed]
   [if failed: list outstanding issues]
   ```

**Skipping the audit:**

To skip the audit for a specific task, the plan can include:
```yaml
audit: skip
reason: "Documentation-only task" | "Config change" | "Test-only change"
```

The audit is also automatically skipped when:
- The task only modified `.md`, `.txt`, `.json` (config), or `.yml` files
- The task is explicitly marked as a "setup" or "scaffold" task
- The project has no `package.json` AND no identifiable entry point (nothing to trace wiring against)

### Phase 5: Collect and Integrate

As each agent completes:

1. **Read the agent's summary** — what was done, any issues encountered
2. **Review the worktree's commits** — `git log` in each worktree to see what changed
3. **Merge into the main branch** — one worktree at a time, resolving conflicts if any:
   ```bash
   git checkout main  # or whatever the working branch is
   git merge plan-exec/<agent-name> --no-ff -m "Merge <agent-name> tasks [N-M]"
   ```
4. **Run full verification** — tests, build, lint after each merge
5. **Fix merge issues** — if merging breaks something, fix it before proceeding

If there are multiple waves, after merging wave N:
- Verify everything still works
- Update each wave N+1 worktree with the merged changes (or create fresh worktrees from the updated branch)
- Dispatch wave N+1

### Phase 5.5: Codex Gate (Wave Boundary Validation)

After merging all agents' work for a wave (Phase 5) and before proceeding to the next wave, invoke the ftm-codex-gate skill for adversarial validation.

**When to invoke:**
- After EVERY wave completes and is merged — this is the heavy validation gate
- For single-task executor runs (plans with only 1 task), invoke on task completion instead of wave completion

**How to invoke:**

1. **Gather inputs for ftm-codex-gate:**
   - `file_list`: All files changed across the wave (collect from all agents' commits via `git diff --name-only` against the pre-wave state)
   - `acceptance_criteria`: Combined acceptance criteria from all tasks in the wave
   - `wave_context`: Summary of what the wave accomplished (task titles + brief descriptions)
   - `project_root`: The project working directory
   - `mode`: `"wave"` for multi-task waves, `"single-task"` for single-task runs

2. **Invoke the Codex gate** by using the ftm-codex-gate skill with these inputs. The gate will:
   - Construct a Codex CLI command with the adversarial review prompt
   - Run `codex exec --yolo --ephemeral -m "gpt-5.4"` against the changed files
   - Return structured results

3. **Interpret the results:**

   **PASS (no issues found):**
   - Log in PROGRESS.md: "Codex gate PASSED — 0 issues"
   - Proceed to next wave (or Phase 6 if this was the last wave)

   **PASS_WITH_FIXES (issues found and auto-fixed by Codex):**
   - Codex committed fixes directly — review the fix commits
   - Read each fix commit and diff it against INTENT.md entries for the affected functions
   - **No INTENT.md conflict?** Accept the fixes. Log in PROGRESS.md and DEBUG.md. Proceed.
   - **INTENT.md conflict detected?** See "INTENT.md Conflict Resolution" below.

   **FAIL (issues Codex could not fix):**
   - Read the remaining issues from the gate results
   - Attempt to fix them yourself (you have full context from the wave)
   - If you can fix them, commit and re-run the Codex gate
   - If you cannot fix them after 2 attempts, report to the user:
     ```
     ⚠ Codex gate FAILED for Wave [N] — manual intervention needed:
     - [remaining issue 1]
     - [remaining issue 2]
     Codex attempted [N] fixes but these remain unresolved.
     ```
     Wait for user input before continuing.

**INTENT.md Conflict Resolution:**

When Codex fixes code in a way that contradicts what INTENT.md says a function should do:

1. **Detect the conflict**: Compare Codex's fix diff against the INTENT.md entry for the affected function. A conflict exists when:
   - Codex changed a function's behavior but INTENT.md's "Does" field describes different behavior
   - Codex reverted a deliberate choice documented in INTENT.md's "Decisions" field
   - Codex changed the function signature documented in the INTENT.md header

2. **Auto-invoke ftm-council** with a structured conflict payload:
   ```
   CONFLICT TYPE: Codex fix contradicts INTENT.md

   ORIGINAL INTENT (from INTENT.md):
   [paste the full INTENT.md entry for the affected function]

   CODEX'S CHANGE:
   [paste the diff of what Codex changed]

   CODEX'S REASONING:
   [paste Codex's explanation from the gate results]

   THE CODE IN QUESTION:
   [file path and relevant code section]

   DEBUG.md HISTORY:
   [paste relevant entries from DEBUG.md so the council doesn't suggest already-failed approaches]

   QUESTION FOR THE COUNCIL:
   Should we (A) update INTENT.md to match Codex's fix, or (B) revert Codex's fix and keep the original intent?
   ```

3. **Execute the council's verdict:**
   - If verdict is "update intent": Update the INTENT.md entry to reflect the new behavior. Commit with message "Update intent: [function] — council verdict [round N]"
   - If verdict is "revert fix": Revert Codex's fix commit. Commit with message "Revert codex fix: [function] — council verdict preserves original intent"
   - Log the full decision + reasoning in DEBUG.md

4. **Continue to next wave** after all conflicts are resolved.

---

### Phase 6: Final Verification and Completion

After all waves are merged:

1. Run the full test suite
2. Run the build
3. Run linting/typechecking
4. Fix any remaining issues (zero broken windows — fix everything, not just "your" stuff)
4.5. **Final Codex gate** — Run one last Codex gate across ALL files changed in the entire plan execution. This catches cross-wave integration issues that per-wave gates might miss. Use `mode: "wave"` with the complete file list.
5. **Branch finishing** — After all verification passes (including the final Codex gate), present exactly 4 options to the user:

   ```
   All tasks complete. All tests pass. Codex gate passed. Choose how to finish:

   1. **Merge locally** — Merge the work branch into main/develop right now
      - Verifies all tests pass one final time before merging
      - Uses --no-ff to preserve branch history
      - Deletes the work branch after successful merge

   2. **Push + Create PR** — Push the branch and create a pull request
      - Pushes the branch to origin
      - Creates a PR with auto-generated summary from:
        - Root INTENT.md vision section
        - Task list with acceptance criteria status
        - Codex gate results summary
        - Files changed count
      - Returns the PR URL

   3. **Keep branch as-is** — Leave everything on the current branch
      - Prints the branch name so the user can return to it
      - Preserves all worktrees (does NOT run cleanup)
      - Good for: "I want to review this myself first"

   4. **Discard** — Delete the branch and all changes
      - Requires typed confirmation: user must type "discard" to proceed
      - Runs full cleanup (worktrees + branches)
      - Cannot be undone
   ```

   Wait for the user to choose. Execute their choice. Do not proceed without explicit selection.

### Phase 6.5: Retrospective

After all verification passes and before presenting branch finishing options, automatically invoke the ftm-retro skill with execution context.

**Invoke ftm-retro** with this context:
- Plan title and path
- Task count, wave count
- Total agents spawned (count of Agent tool invocations)
- Per-task audit results: for each task, whether it passed audit on first attempt, needed auto-fix, or required manual intervention
- Codex gate results: for each wave, whether it passed on first attempt or needed fixes
- Any errors, blockers, or manual interventions that occurred during execution

The retro runs automatically — do not ask the user whether to run it. The report is saved to `~/.claude/ftm-retros/` and a one-line summary of the overall score (X/50) is shown to the user before presenting the branch finishing options.

**Graceful degradation**: If the ftm-retro skill is not available (not installed), skip with a note and proceed to branch finishing.

### Cleanup

Cleanup runs automatically after options 1 (merge), 2 (PR), and 4 (discard). It does NOT run for option 3 (keep branch).

```bash
git worktree list  # verify what exists
git worktree remove .worktrees/plan-exec-<name>  # for each worktree
git branch -d plan-exec/<name>  # delete branches (use -D for discard option)
```

For option 3, print a reminder:
```
Branch preserved: plan-exec/<name>
Worktrees at: .worktrees/plan-exec-*
Run cleanup manually when ready: git worktree remove .worktrees/plan-exec-<name>
```

## Handling Edge Cases

**Plan has no dependency map**: Analyze task descriptions and file lists yourself. Tasks touching the same files must be sequential. Tasks touching different files/domains can be parallel.

**Agent fails or gets stuck**: If an agent returns with unfinished tasks or errors it couldn't resolve, don't panic. Read its output, understand what went wrong, and either:
- Fix it yourself in the worktree
- Respawn the agent with more context about what failed

**Merge conflicts**: These happen when parallel agents touched overlapping files (shouldn't happen with good task partitioning, but sometimes it does). Resolve them manually — you have context from both agents' work.

**Very large plans (20+ tasks)**: Don't try to explain every task upfront. Show the wave structure and agent assignments, then execute. Report progress between waves.

**No tests in the project**: The review step becomes more important. Pay extra attention to the diff review and manual verification steps in the plan.

**Single-task plans**: For plans with only 1 task, skip the wave-boundary Codex gate and instead run the gate immediately after the task completes (using `mode: "single-task"`). The flow is: task agent completes → per-task verification gate → ftm-audit → Codex gate → Phase 6 completion.

## What Makes This Different from executing-plans

The `executing-plans` skill is a human-in-the-loop batch executor — it does 3 tasks, stops, waits for feedback, continues. That's valuable when the human wants to steer.

This skill is fully autonomous. It analyzes the plan, builds a team, and executes everything without stopping. The human trusts the plan and wants it done. The review loop is agent-self-review, not human review.

Use `executing-plans` when: human wants checkpoints and control.
Use `ftm-executor` when: human says "just go" and trusts the plan.

**Critical distinction**: "just go" means "execute this plan autonomously" — it does NOT mean "skip the plan and start coding." If no plan exists, Phase 0 generates one and gets approval first. The autonomy is in execution, not in deciding what to execute.

## Blackboard Write

After completing, update the blackboard:

1. Update `/Users/kioja.kudumu/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `/Users/kioja.kudumu/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing task_type, agent team used, wave count, audit outcomes, and lessons learned
3. Update `/Users/kioja.kudumu/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `task_completed` event

## Requirements

- tool: `git` | required | worktree creation, branch management, commit operations
- config: `~/.claude/ftm-config.yml` | optional | model profiles, max_parallel_agents, auto_audit, progress_tracking
- reference: `~/.claude/plans/` | optional | plan documents for execution
- tool: `node` | optional | project setup commands in worktrees
- reference: `~/.claude/skills/ftm-executor/references/STYLE-TEMPLATE.md` | optional | STYLE.md bootstrap template

## Risk

- level: high_write
- scope: creates git worktrees and branches, modifies source files across multiple tasks, runs tests and builds, optionally pushes branches or creates PRs
- rollback: git worktree remove + git branch -D for each worktree; all changes isolated to plan-exec/* branches until explicitly merged

## Approval Gates

- trigger: no plan document provided | action: generate plan and wait for explicit user approval before any code is written
- trigger: plan_checker returns FAIL | action: present blockers and ask user to fix or override before proceeding
- trigger: plan_checker returns WARN | action: show warnings to user, proceed unless they object
- trigger: wave complete and all agents done | action: auto-invoke ftm-codex-gate (no user gate needed for this step)
- trigger: final phase 6 verification passes | action: present 4 branch finishing options and wait for explicit user choice
- trigger: codex gate FAIL after 2 fix attempts | action: report to user and wait for input before continuing
- complexity_routing: micro → auto | small → auto | medium → plan_first | large → plan_first | xl → always_ask

## Fallbacks

- condition: ftm-browse not installed at $HOME/.claude/skills/ftm-browse/bin/ftm-browse | action: skip visual smoke test checks, log "Visual smoke test skipped — ftm-browse not installed"
- condition: ftm-retro skill not available | action: skip retrospective phase, note in output and proceed to branch finishing
- condition: codex CLI not found | action: skip codex gate, log "Codex gate skipped — codex not installed", proceed to next wave
- condition: no package.json in project | action: skip npm install in worktree setup; skip knip-based audit layers
- condition: project has no test suite | action: skip test verification gates, rely on diff review and build checks
- condition: agent fails or gets stuck | action: read agent output, fix directly or respawn with more context

## Capabilities

- cli: `git` | required | worktree management and version control
- cli: `node` | optional | project dependency installation
- mcp: `sequential-thinking` | optional | complex dependency analysis and plan validation
- env: none required directly (agents inherit from session)

## Event Payloads

### task_received
- skill: string — "ftm-executor"
- task_description: string — description of the task being queued
- plan_path: string — absolute path to plan document

### plan_generated
- skill: string — "ftm-executor"
- plan_path: string — absolute path to saved plan file
- task_count: number — total tasks in the plan
- wave_count: number — number of parallel execution waves

### plan_approved
- skill: string — "ftm-executor"
- plan_path: string — absolute path to approved plan
- approved_steps: number[] — step numbers approved for execution

### code_changed
- skill: string — "ftm-executor"
- worktree: string — path to the worktree where files changed
- files: string[] — list of modified file paths
- agent: string — agent type that made the changes

### code_committed
- skill: string — "ftm-executor"
- worktree: string — path to worktree
- commit_hash: string — short commit hash
- message: string — commit message
- task_number: number — plan task number this commit belongs to

### test_passed
- skill: string — "ftm-executor"
- scope: string — "task" | "full_suite"
- task_number: number | null — task number if scoped to task
- worktree: string — worktree path

### test_failed
- skill: string — "ftm-executor"
- scope: string — "task" | "full_suite"
- task_number: number | null — task number if scoped
- worktree: string — worktree path
- error_summary: string — brief description of failure

### task_completed
- skill: string — "ftm-executor"
- task_number: number — completed task number
- audit_result: string — "pass" | "pass_with_fixes" | "fail" | "skipped"
- auto_fixed_count: number — issues auto-remediated by ftm-audit
- duration_ms: number — task execution time

### error_encountered
- skill: string — "ftm-executor"
- phase: string — execution phase where error occurred
- task_number: number | null — associated task if applicable
- error: string — error description
