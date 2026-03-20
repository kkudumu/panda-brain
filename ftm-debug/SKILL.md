---
name: ftm-debug
description: Deep multi-vector debugging war room that launches parallel agent teams to instrument, research, reproduce, hypothesize, solve, and verify tricky bugs. Use when a bug is stubborn, multi-turn debugging hasn't worked, the user says "debug this deeply", "war room this", "I can't figure out why", "this is driving me crazy", "launch the debug team", or any situation where standard debugging is insufficient. Also triggers on "/ftm-debug". Covers any codebase — frontend, backend, CLI tools, native apps, build systems, anything. Do NOT use for simple one-step fixes — this is the heavy artillery for problems that resist normal debugging.
---

## Events

### Emits
- `bug_fixed` — when the Reviewer agent approves a fix and the bug is confirmed resolved
- `issue_found` — when investigation surfaces a specific problem (hypothesis confirmed, instrumentation reveals root cause)
- `test_passed` — when the reproduction test passes after a fix, or when the full suite passes post-fix
- `test_failed` — when the reproduction test fails, or when a fix attempt causes regressions
- `error_encountered` — when an unexpected error halts the war room workflow (agent failure, unrecoverable blocker)
- `task_completed` — when the debug session concludes with an approved and merged fix

### Listens To
- `test_failed` — auto-investigate: launch Phase 0 intake and deploy the war room agent team
- `error_encountered` — diagnose the error: run codebase reconnaissance and begin targeted investigation

## Blackboard Read

Before starting, load context from the blackboard. Read `references/protocols/BLACKBOARD.md` for full protocol. Summary:

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by task_type="bug" and tags matching the current error domain
3. Load top 3-5 matching experience files for known fixes and failed approaches
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check recurring_issues for matching symptoms and codebase_insights for relevant file patterns

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

---

# Debug War Room

Multi-vector deep debugging with parallel agent teams. When a bug resists normal debugging — you've tried the obvious, poked at it for multiple turns, and it's still not yielding — this skill escalates to a coordinated investigation across every angle simultaneously: instrumentation, research, reproduction, hypothesis, fix, and verification.

## Why This Exists

Hard bugs are hard because they hide across multiple dimensions. The symptom is in one place, the cause is in another, and the fix requires understanding both plus the invisible interactions between them. Single-threaded debugging (try a thing, see if it works, try another thing) is too slow and too narrow. The war room attacks from every direction at once.

## Core Principle: Automate Everything Before Involving the User

The entire point of the war room is that **agents do the work**. Every verification step, every test run, every log check, every "does it actually work?" confirmation must be performed by an agent before presenting results to the user. The user should receive a **verified, working result** — not a list of manual steps to try.

- If you can run a command to check if the fix works, **run it**. Don't tell the user to run it.
- "All tests pass" is necessary but NOT sufficient. The Reviewer must verify the actual runtime/visual result, not just test results.
- If an agent produces a "How to Verify" section with manual steps, that's a failure of the process.

Read `references/protocols/EDGE-CASES.md` for anti-patterns and fallback handling.

---

## The Process

### Phase 0: Problem Intake

Before launching agents, understand what you're debugging. This happens in the main conversation thread — no agents yet.

**Flow:**
1. Gather problem statement (ask targeted questions if needed — skip what's already known)
2. Spawn an **Explore agent** for codebase reconnaissance
3. Formulate investigation plan → present to user → proceed unless user objects

Read `references/phases/PHASE-0-INTAKE.md` for full intake steps, Explore agent prompt, and investigation plan format.

---

### Phase 1: Parallel Investigation (the war room)

Launch all investigation agents **simultaneously**. This is the core value — attacking from every angle at once.

**Agents to launch in parallel:**
- **Instrumenter** — adds debug logging and observability in its own worktree
- **Researcher** — searches GitHub issues, Stack Overflow, docs, changelogs
- **Reproducer** — creates a minimal failing test or trigger script
- **Hypothesizer** — traces execution paths and forms ranked root cause theories

**Decision:** Not every bug needs all agents. See agent selection guide in `references/phases/PHASE-1-TRIAGE.md` to determine which agents to skip for each bug type.

Read `references/phases/PHASE-1-TRIAGE.md` for the agent selection guide and worktree strategy.

Read `references/phases/PHASE-2-WAR-ROOM-AGENTS.md` for all four agent prompts (Instrumenter, Researcher, Reproducer, Hypothesizer).

---

### Phase 2: Synthesis & Solve

After all Phase 1 agents complete:

1. **Cross-reference findings** — do hypotheses match research? does reproduction confirm a hypothesis? are there contradictions?
2. Present synthesis briefly to the user (Researcher finding / Reproducer status / top hypothesis / Instrumenter summary)
3. **Launch the Solver agent** in a fresh worktree with full synthesis context

**Decision:** If the Solver's fix is NEEDS REWORK, send feedback back for another iteration. Max 3 iterations before escalating.

Read `references/phases/PHASE-3-TO-6-EXECUTION.md` for the full synthesis format, Solver agent prompt, and iteration rules.

---

### Phase 3: Review & Verify

**HARD GATE — Cannot present to user without this phase.**

1. Determine verification method BEFORE launching Reviewer (visual vs behavioral vs error-absence)
2. If fix requires a restart, the Reviewer handles it — not the user
3. Launch **Reviewer agent** independently of the Solver

**Reviewer runs:** reproduction test → full test suite → build/lint → live runtime verification → visual verification (if applicable)

**Decision:** APPROVED → proceed to Phase 4. NEEDS REWORK → back to Solver (max 3 total iterations). Still failing after 3 → escalate to user.

Read `references/phases/PHASE-3-TO-6-EXECUTION.md` for Reviewer agent prompt, verification gate checklist, and escalation protocol.

---

### Phase 4: Present Results

**Checkpoint before presenting:**
- [ ] Reviewer agent was spawned (not Solver declaring victory)
- [ ] Reviewer verdict includes actual evidence (output, screenshots, log snippets)
- [ ] Visual evidence captured if bug was visual
- [ ] Post-restart behavior verified if fix required restart
- [ ] No "How to Verify" manual instructions in the presentation

Once the Reviewer approves, present: root cause → what changed → verification already performed (with evidence) → commits.

Wait for user confirmation, then: merge → clean up worktrees → remove debug instrumentation.

Read `references/phases/PHASE-3-TO-6-EXECUTION.md` for the full result presentation format.

---

## Blackboard Write

After completing, update the blackboard. Read `references/protocols/BLACKBOARD.md` for full write protocol. Summary:

1. Update `~/.claude/ftm-state/blackboard/context.json` — set task complete, append decision summary
2. Write experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` — root cause, hypotheses tested, fix approach, check_first_next_time
3. Update `experiences/index.json` with the new entry
4. Emit `task_completed` event

## Config Read

Before dispatching agents, read `~/.claude/ftm-config.yml`:
- Use the `planning` model from the active profile for all investigation agents
- If config missing, use session default

## Requirements

- config: `~/.claude/ftm-config.yml` | optional | model profiles for investigation agents
- reference: `references/protocols/BLACKBOARD.md` | required | blackboard read/write protocol
- reference: `references/protocols/EDGE-CASES.md` | required | anti-patterns and fallback handling
- reference: `references/phases/PHASE-0-INTAKE.md` | required | intake steps and Explore agent prompt
- reference: `references/phases/PHASE-1-TRIAGE.md` | required | agent selection guide and worktree strategy
- reference: `references/phases/PHASE-2-WAR-ROOM-AGENTS.md` | required | all four agent prompts
- reference: `references/phases/PHASE-3-TO-6-EXECUTION.md` | required | synthesis, solver, reviewer prompts
- tool: `git` | required | worktree creation, diff inspection, commit history
- reference: `~/.claude/ftm-state/blackboard/context.json` | optional | session state
- reference: `~/.claude/ftm-state/blackboard/experiences/index.json` | optional | past bug fixes and known issues
- reference: `~/.claude/ftm-state/blackboard/patterns.json` | optional | recurring failure patterns

## Risk

- level: medium_write
- scope: creates git worktrees for investigation and fix branches; modifies source files in Solver agent worktree; merges fix after Reviewer approval
- rollback: git worktree remove + git branch -D for debug/* worktrees; all fix changes isolated until user confirms merge

## Approval Gates

- trigger: investigation plan formulated in Phase 0 | action: present plan to user and proceed unless user objects
- trigger: Solver produces fix | action: Reviewer agent must independently verify before presenting to user (hard gate — cannot skip)
- trigger: Reviewer APPROVED | action: present root cause + changes + evidence to user, wait for user confirmation before merging
- trigger: Solver NEEDS REWORK after 3 attempts | action: escalate to user with full context, wait for direction
- complexity_routing: micro → auto | small → auto | medium → plan_first | large → plan_first | xl → always_ask

## Fallbacks

- condition: Instrumenter agent fails or produces no useful output | action: skip instrumentation worktree, proceed with remaining agents
- condition: Reproducer cannot create a minimal failing test | action: note as "reproduction failed", proceed with hypothesis-only approach
- condition: Researcher finds no relevant issues or docs | action: proceed with instrumentation and hypothesis findings only
- condition: fix still failing after 3 Solver iterations | action: escalate to user with all hypotheses tested and evidence gathered
- condition: project has no test suite | action: Reviewer uses build check + diff review + live runtime verification instead of test runner

## Capabilities

- cli: `git` | required | worktree isolation for investigation agents
- mcp: `sequential-thinking` | optional | complex multi-hypothesis analysis
- mcp: `playwright` | optional | visual bug verification in Reviewer phase
- mcp: `WebSearch` | optional | Researcher agent for GitHub issues and Stack Overflow
- mcp: `WebFetch` | optional | Researcher agent for docs and changelogs

## Event Payloads

### bug_fixed
- skill: string — "ftm-debug"
- root_cause: string — one-sentence root cause description
- fix_approach: string — description of the fix applied
- worktree: string — path to fix worktree
- iterations: number — number of solver-reviewer cycles needed
- duration_ms: number — total war room duration

### issue_found
- skill: string — "ftm-debug"
- phase: string — "phase1" | "phase2"
- agent: string — "instrumenter" | "researcher" | "reproducer" | "hypothesizer"
- finding: string — description of the specific issue found
- confidence: string — high | medium | low

### test_passed
- skill: string — "ftm-debug"
- scope: string — "reproduction" | "full_suite"
- worktree: string — worktree path where tests ran

### test_failed
- skill: string — "ftm-debug"
- scope: string — "reproduction" | "full_suite"
- worktree: string — worktree path
- error_summary: string — brief failure description

### error_encountered
- skill: string — "ftm-debug"
- phase: string — war room phase where error occurred
- agent: string | null — agent that encountered the error
- error: string — error description

### task_completed
- skill: string — "ftm-debug"
- outcome: string — "fixed" | "escalated" | "unresolved"
- root_cause: string — root cause if found
- duration_ms: number — total session duration
