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

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by task_type matching plan tasks and tags overlapping with the plan domain
3. Load top 3-5 matching experience files for relevant lessons on agent performance and timing
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check execution_patterns for agent performance and timing accuracy patterns

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# Plan Executor

Read the plan, assemble a team, give each agent an isolated worktree, execute tasks in a commit-review-fix loop.

## Phase Sequence

```
Phase 0.5 → Plan Verification Gate
Phase 0.7 → Load Model Profile
Phase 1   → Analyze the Plan
Phase 1.5 → Documentation Layer Bootstrap
Phase 2   → Assemble the Agent Team
Phase 3   → Set Up Worktrees
Phase 3.5 → Initialize Progress Tracking
Phase 4   → Dispatch Agents (parallel, per wave)
Phase 4.5 → Post-Task Audit (automatic, per task)
Phase 5   → Collect and Integrate
Phase 5.5 → Codex Gate (wave boundary validation)
[repeat 3–5.5 for each wave]
Phase 6   → Final Verification and Completion
Phase 6.5 → Retrospective
```

---

### Phase 0.5: Plan Verification Gate

Spawn a **Plan Checker** agent to validate the plan before any execution. Read `references/phases/PHASE-0-VERIFICATION.md` for the full agent prompt and checks.

**Decision gate:** PASS → proceed | WARN → show warnings, proceed unless user objects | FAIL → present blockers and fixes, ask user to fix or override

---

### Phase 0.7: Load Model Profile

Read `references/protocols/MODEL-PROFILE.md` for config loading rules and model-to-phase assignment. Use loaded models when spawning all subsequent agents.

---

### Phase 1: Analyze the Plan

Instead of parsing the plan manually, use the ftm-runtime module for mechanical orchestration.

1. **Index the plan** — Run:
   ```bash
   node ~/.claude/skills/ftm-executor/runtime/ftm-runtime.mjs plan-index <plan-path>
   ```
   This returns JSON with: all tasks (id, title, description, files, dependencies, agent_type), computed waves, and task count.

2. **Review the runtime's output** — Verify the wave structure makes sense. Check for:
   - Tasks that should be parallel but aren't (missing from same wave)
   - Tasks in the same wave that touch the same files (should be sequential)
   - Adjust by re-running with modified plan if needed

3. **Output the execution summary** — Use the runtime's wave structure:
   ```
   Plan: [title]
   Tasks: [N] total across [W] waves

   Wave 1: Tasks [list] (parallel)
   Wave 2: Tasks [list] (depends on wave 1)
   ...
   ```

---

### Phase 1.5: Documentation Layer Bootstrap

Check for INTENT.md, ARCHITECTURE.mmd, STYLE.md, and DEBUG.md in the project root. Create any missing ones. Read `references/protocols/DOCUMENTATION-BOOTSTRAP.md` for creation rules. If all exist, skip entirely.

---

### Phase 2: Assemble the Agent Team

Map each domain cluster to an existing agent type. When none fits, create a purpose-built prompt. Read `references/phases/PHASE-2-AGENT-ASSEMBLY.md` for the matching table and custom agent creation rules.

---

### Phase 3: Set Up Worktrees

Each agent gets its own isolated worktree. Ensure `.worktrees/` is in `.gitignore` first. Read `references/phases/PHASE-3-WORKTREES.md` for setup commands, naming convention, and clean-start verification.

---

### Phase 3.5: Initialize Progress Tracking

If `progress_tracking` is enabled in `~/.claude/ftm-config.yml` (default: true), create `PROGRESS.md` in the project root. Read `references/protocols/PROGRESS-TRACKING.md` for the template, update events, and activity log format.

---

### Phase 4: Dispatch Agents

Before dispatching each wave, call:
```bash
node ~/.claude/skills/ftm-executor/runtime/ftm-runtime.mjs next-wave
```
to get the current wave's tasks. This returns the task list for the next pending wave.

Launch agents for all tasks in that wave **in parallel**. Read `references/phases/PHASE-4-DISPATCH.md` for the complete dispatch prompt template.

After each task agent completes successfully, call:
```bash
node ~/.claude/skills/ftm-executor/runtime/ftm-runtime.mjs mark-complete <task-id>
```

---

### Phase 4.5: Post-Task Audit (automatic)

After every task agent returns, run ftm-audit before marking complete. Skip for documentation-only tasks or tasks marked `audit: skip`. Read `references/phases/PHASE-4-5-AUDIT.md` for pre-audit checks, smoke test steps, invocation, result interpretation, and skip conditions.

---

### Phase 5: Collect and Integrate

As each agent completes: read its summary, review commits via `git log`, then merge into the main branch one worktree at a time using `--no-ff`. Run full verification (tests, build, lint) after each merge. Fix any merge issues before proceeding.

For multi-wave plans: after merging wave N:
1. Call `ftm-runtime status` to check overall progress and confirm all wave N tasks are marked complete.
2. Call `ftm-runtime next-wave` to get the next batch of tasks.
3. If `next-wave` returns `complete: true`, all waves are done — proceed to Phase 6.
4. Otherwise, verify everything works, then create fresh worktrees from the updated branch for wave N+1 before dispatch.

---

### Resume Support

If the conversation is interrupted mid-execution:
- The runtime state persists in `~/.claude/ftm-state/runtime-state.json`
- On resume (via ftm-resume), call `ftm-runtime status` to see what's done
- Call `ftm-runtime next-wave` to pick up where execution left off
- Already-completed tasks are never re-executed
- Failed tasks can be retried by dispatching a new agent for that task

---

### Phase 5.5: Codex Gate (Wave Boundary Validation)

After merging all agents' work for a wave and before proceeding to the next wave, invoke the ftm-codex-gate skill.

Read `references/phases/PHASE-5-5-CODEX-GATE.md` for inputs, result interpretation, and INTENT.md conflict resolution steps.

**Decision gate:**
- **PASS** → log in PROGRESS.md, proceed to next wave
- **PASS_WITH_FIXES** → review fix commits against INTENT.md; if conflict detected, invoke ftm-council per reference file
- **FAIL** → attempt self-fix; if unresolved after 2 attempts, report to user and wait

---

### Phase 6: Final Verification and Completion

After all waves are merged:

1. Run full test suite, build, and linting/typechecking
2. Fix any remaining issues — zero broken windows, fix everything
3. **Final Codex gate** — run one last gate across ALL files changed in the entire execution (`mode: "wave"`, complete file list)
4. **Branch finishing** — present exactly 4 options and wait for user selection:
   - **1. Merge locally** — verifies tests, `--no-ff` merge to main/develop, deletes branch
   - **2. Push + Create PR** — auto-generates PR summary from INTENT.md vision, task list, Codex results, and file count
   - **3. Keep branch as-is** — prints branch name, preserves worktrees, skips cleanup
   - **4. Discard** — requires typed "discard" confirmation, full cleanup, cannot be undone

---

### Phase 6.5: Retrospective

Before branch finishing, automatically invoke ftm-retro with: plan title/path, task count, wave count, total agents spawned, per-task audit results, per-wave Codex gate results, errors, and manual interventions. Do not ask. Report saves to `~/.claude/ftm-retros/`. Show one-line score (X/50) before presenting branch options.

**Graceful degradation**: If ftm-retro is not installed, skip with a note and proceed.

---

### Cleanup

Runs automatically after options 1, 2, and 4. Does NOT run for option 3. Remove each worktree with `git worktree remove .worktrees/plan-exec-<name>` then `git branch -d plan-exec/<name>` (use `-D` for option 4). For option 3, print branch name and worktree paths with manual cleanup instructions.

---

## Edge Cases

- **No dependency map**: Infer from file lists — same files = sequential, different domains = parallel
- **Agent fails or gets stuck**: Read output, fix in worktree or respawn with more context
- **Merge conflicts**: Resolve manually using context from both agents' work
- **Large plans (20+ tasks)**: Show wave structure upfront, report progress between waves
- **No tests**: Diff review becomes the primary quality gate
- **Single-task plans**: Skip wave-boundary Codex gate; run it immediately after task completion with `mode: "single-task"`

---

## vs. executing-plans

`executing-plans` = human-in-the-loop checkpoints. `ftm-executor` = fully autonomous. Use `executing-plans` when the human wants steering; use this when they say "just go."

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing task_type, agent team used, wave count, audit outcomes, and lessons learned
3. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `task_completed` event
