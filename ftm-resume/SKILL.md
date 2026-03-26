---
name: ftm-resume
description: Resume a previously paused ftm skill session from saved state. Use when user says "resume", "continue where we left off", "ftm resume", "pick up", or starts a new conversation wanting to continue previous ftm work.
---

## Events

### Emits
- `session_resumed` — when a saved session state has been validated and the appropriate ftm skill is re-invoked with restored context
- `task_completed` — when the resume workflow finishes (skill re-invoked and state file archived)

### Listens To
(none — ftm-resume is explicitly invoked by the user and does not respond to events)

# FTM Resume — Session State Restoration

Read a saved ftm session state file and seamlessly continue the workflow in a fresh conversation. The user should feel like they never left — same context, same decisions, same progress, picking up at exactly the right step.

## Why This Exists

FTM skills are long-running, multi-phase workflows. A brainstorm session might span 10+ turns of research and questioning. An executor session might be mid-way through wave 2 of a 5-wave plan. A debug war room might have 4 investigation agents completed and a solver mid-attempt. When these sessions end — whether by choice, crash, or context exhaustion — the work shouldn't be lost. This skill reads the state file that ftm-pause saved and reconstructs the session so the appropriate ftm skill can continue exactly where it stopped.

## Step 1: Read the State File

Read `~/.claude/ftm-state/STATE.md`.

If the file doesn't exist:
```
No saved ftm session found at ~/.claude/ftm-state/STATE.md

To save a session mid-workflow, use /ftm-pause during any active ftm skill.
```
Stop here.

If the file exists but can't be parsed (missing frontmatter, malformed YAML):
```
Found state file but it appears corrupted — missing required frontmatter fields.
Expected fields: skill, phase, timestamp, project_dir

Would you like me to try to extract what I can from the file, or should we start fresh?
```

## Step 2: Parse the Frontmatter

Extract the YAML frontmatter fields:

| Field | Required | Purpose |
|-------|----------|---------|
| `skill` | Yes | Which ftm skill to resume (brainstorm, executor, debug, council, audit) |
| `phase` | Yes | Which phase the skill was in |
| `phase_detail` | No | Human-readable detail about position within the phase |
| `timestamp` | Yes | When the session was saved |
| `project_dir` | Yes | The project directory the session was working in |
| `git_branch` | No | The git branch at time of save |
| `git_commit` | No | The HEAD commit at time of save |

## Step 3: Validate the Environment

Run these checks before attempting to resume. Each check either passes, warns, or blocks.

### Check 1: Project directory exists

```bash
test -d "{project_dir}" && echo "EXISTS" || echo "MISSING"
```

- **EXISTS**: Pass. Continue.
- **MISSING**: Block. "The project directory `{project_dir}` no longer exists. Cannot resume — the codebase isn't available. Did the project move?"

### Check 2: Git state (if git fields present)

```bash
cd "{project_dir}" && git branch --show-current && git rev-parse --short HEAD
```

Compare current branch and commit against saved values.

- **Same branch, same commit**: Perfect — nothing changed.
- **Same branch, different commit**: Warn. "The codebase has been modified since the session was saved. {N} new commits on `{branch}` since `{saved_commit}`." Show the commit log between saved and current. Ask the user if they want to continue anyway or review changes first.
- **Different branch**: Warn. "You're now on branch `{current}` but the session was saved on `{saved_branch}`. Would you like to switch back to `{saved_branch}`, or continue on `{current}`?"

### Check 3: Worktree branches (for executor and debug)

If the state file references worktree branches:

```bash
cd "{project_dir}" && git worktree list
git branch --list "plan-exec/*" "debug/*"
```

- **All referenced branches exist**: Pass.
- **Some missing**: Warn. List which branches are missing. "These worktree branches from the saved session no longer exist: {list}. Tasks associated with these branches may need to be re-executed."
- **All missing**: Warn more strongly. "All worktree branches from the saved session have been cleaned up. Completed task work may have been merged already. In-progress tasks will need to restart."

### Check 4: Plan files (for executor)

If the state references a plan file:

```bash
test -f "{plan_path}" && echo "EXISTS" || echo "MISSING"
```

- **EXISTS**: Pass.
- **MISSING**: Block (for executor). "The plan file `{plan_path}` no longer exists. Cannot resume executor without a plan. Do you have the plan elsewhere?"

### Check 5: Research/investigation files (for debug)

Check for any referenced artifact files (RESEARCH-FINDINGS.md, HYPOTHESES.md, REPRODUCTION.md, etc.):

```bash
for f in {artifact_paths}; do test -f "$f" && echo "$f: EXISTS" || echo "$f: MISSING"; done
```

- **All exist**: Pass.
- **Some missing**: Warn. The state file should contain the key content from these files, so they're reconstructible. Note which are missing.

### Check 6: Staleness (all skills)

Calculate the age of the saved state:

```bash
# Compare saved timestamp to current time
```

- **< 24 hours**: Fresh. No warning needed.
- **1-7 days**: Mild staleness. Note it but proceed: "This session is {N} days old. The codebase may have changed — check the git log above."
- **> 7 days**: Stale warning. Present explicitly:
  ```
  This session was saved 12 days ago. The codebase has likely changed significantly.

  Options:
  1. Resume anyway — I'll use the saved context but some references may be outdated
  2. Resume with a fresh repo scan — I'll re-run Phase 0 to update project context, then continue from where you left off
  3. Start fresh — discard this state and begin a new session

  Which would you prefer?
  ```

If the user picks option 2, run Phase 0 of the relevant skill (repo scan for brainstorm, plan re-read for executor, codebase reconnaissance for debug) with fresh data, then merge the new scan with the saved state — keeping all decisions, answers, and progress but updating the project context.

## Step 4: Present the Resume Summary

After all validation checks pass (or the user acknowledges warnings), present the resume:

### For ftm-brainstorm:
```
Resuming ftm-brainstorm session from {timestamp}
Project: {project_dir}

Where we left off:
  Phase: {phase} — {phase_detail}
  Path: {A or B}
  Research sprints completed: {N}
  Challenge turns completed: {N}
  Decisions locked: {N}
    - {decision 1}
    - {decision 2}
    - ...
  Open questions: {N}
    - {question 1}
    - {question 2}

Next step:
  {next_step from state file}

Ready to continue? (or type new context to add information before resuming)
```

### For ftm-executor:
```
Resuming ftm-executor session from {timestamp}
Project: {project_dir}
Plan: {plan_path}

Where we left off:
  Wave: {current_wave} of {total_waves}
  Tasks: {completed}/{total} complete
    Done: {list of completed task numbers and titles}
    In progress: {list with agent assignments}
    Pending: {list}
    Failed/Blocked: {list with reasons}
  Worktrees: {N active}
  Last audit: {result}

Next step:
  {next_step from state file}

Ready to continue? (or type new context to add information before resuming)
```

### For ftm-debug:
```
Resuming ftm-debug war room from {timestamp}
Project: {project_dir}

Where we left off:
  Phase: {phase} — {phase_detail}
  Problem: {one-line problem summary}
  Investigation status:
    Instrumenter: {complete/pending} {brief finding if complete}
    Researcher: {complete/pending} {brief finding if complete}
    Reproducer: {complete/pending} {brief finding if complete}
    Hypothesizer: {complete/pending} {top hypothesis if complete}
  Solver attempts: {N}
  Reviewer verdict: {if any}
  Worktrees: {list with status}

Next step:
  {next_step from state file}

Ready to continue? (or type new context to add information before resuming)
```

### For ftm-council:
```
Resuming ftm-council session from {timestamp}
Project: {project_dir}

Where we left off:
  Council prompt: {brief summary}
  Round: {N} of 5
  Positions:
    Claude: {one-line position}
    Codex: {one-line position}
    Gemini: {one-line position}
  Consensus: {Yes — X and Y agree / No — still diverging}

Next step:
  {next_step from state file}

Ready to continue? (or type new context to add information before resuming)
```

### For ftm-audit:
```
Resuming ftm-audit session from {timestamp}
Project: {project_dir}

Where we left off:
  Trigger: {what triggered the audit}
  Phase 0 (patterns): {complete/pending}
  Layer 1 (knip): {complete — N findings / pending}
  Layer 2 (adversarial): {complete — N findings / pending}
  Layer 3 (auto-fix): {N fixed, N manual / pending}
  Status: {PASS/FAIL/in-progress}

Next step:
  {next_step from state file}

Ready to continue? (or type new context to add information before resuming)
```

## Step 5: Handle User Response

The user can respond in three ways:

### "Yes" / "Continue" / "Go"
Proceed directly to Step 6 (invoke the skill).

### New context / additional information
The user may say "yes, but also..." or provide new information (the bug now has a new symptom, requirements changed, they thought of something overnight). Capture this new context and incorporate it into the state before invoking the skill. Add it to the "Context Snapshot" as a "Post-pause update" section.

### "Start fresh" / "Never mind"
Archive the state file (see Step 7) and tell the user: "State archived. You can start a fresh session with /ftm-{skill}."

## Step 6: Invoke the Appropriate Panda Skill

This is the critical step. You need to invoke the ftm skill with the full saved context injected so it picks up exactly where it left off, not from the beginning.

**How to do this:** Construct a comprehensive context injection that tells the skill exactly where it is. The skill will receive this as its starting context instead of starting from scratch.

### For ftm-brainstorm:

Invoke the ftm-brainstorm skill with the following context preamble:

```
RESUMING FROM SAVED STATE — DO NOT START FROM PHASE 0.

This is a resumed session. All prior phases and turns have been completed as described below.
Pick up at exactly the point described in "Next Step." Do not re-ask questions that have
already been answered. Do not re-run research sprints that have already completed. Do not
re-present suggestions the user has already responded to.

PROJECT CONTEXT (from Phase 0 scan — already completed):
{paste full Phase 0 results from state}

INTAKE COMPLETE (Phase 1 — already completed):
{paste all rounds, answers, and research sprint results from state}

RESEARCH TURNS COMPLETED (Phase 2 — {N} turns done):
{paste each turn's suggestions, challenges, user responses, and direction from state}

ACCUMULATED DECISIONS:
{paste decisions list from state}

OPEN QUESTIONS:
{paste open questions from state}

CURRENT DIRECTION:
{paste current direction from state}

NEXT STEP:
{paste next step from state — this is where you pick up}

{if post-pause update exists: POST-PAUSE UPDATE FROM USER: {new context}}
```

Then invoke `/ftm-brainstorm` via the Skill tool. The brainstorm skill will see this context and should continue from the specified point — running the next research sprint, asking the next question, or generating the next section of the plan.

### For ftm-executor:

```
RESUMING FROM SAVED STATE — DO NOT START FROM PHASE 1.

Plan file: {plan_path}
Plan has been analyzed. Agent team has been assembled. Execution is in progress.

COMPLETED TASKS:
{for each completed task: task number, title, status, commits, audit result}

IN-PROGRESS TASKS:
{task details, agent assignments, what's been done}

PENDING TASKS:
{task list}

FAILED/BLOCKED TASKS:
{task details with error information}

ACTIVE WORKTREES:
{branch names, paths, status}

CURRENT WAVE: {N}
NEXT STEP: {what to do next — dispatch next wave, retry failed task, merge completed work, etc.}

{if post-pause update: POST-PAUSE UPDATE FROM USER: {new context}}
```

Then invoke `/ftm-executor {plan_path}` via the Skill tool.

### For ftm-debug:

```
RESUMING FROM SAVED STATE — DO NOT START FROM PHASE 0.

PROBLEM STATEMENT:
{original problem from state}

CODEBASE RECONNAISSANCE (Phase 0 — already completed):
{full recon results from state}

INVESTIGATION PLAN:
{the plan from state}

INVESTIGATION RESULTS (Phase 1):
Instrumenter: {full report or "not yet run"}
Researcher: {full report or "not yet run"}
Reproducer: {full report or "not yet run"}
Hypothesizer: {full report or "not yet run"}

SYNTHESIS (Phase 2):
{cross-reference analysis if completed}

SOLVER ATTEMPTS:
{list of attempts, hypotheses tried, commits, outcomes}

REVIEWER VERDICTS:
{list of verdicts if any}

ACTIVE WORKTREES:
{branch names, paths, status}

NEXT STEP: {what to do — run remaining investigation agents, synthesize, solve, review, etc.}

{if post-pause update: POST-PAUSE UPDATE FROM USER: {new context}}
```

Then invoke `/ftm-debug` via the Skill tool.

### For ftm-council:

```
RESUMING FROM SAVED STATE — DO NOT START FROM STEP 0.

COUNCIL PROMPT:
{the framed problem}

COMPLETED ROUNDS:
{for each round: each model's full research, position, reasoning, concerns, confidence}
{for rebuttal rounds: updated positions, new evidence, responses}

ALIGNMENT STATUS:
{agreement areas, divergence points, majority forming?}

CURRENT ROUND: {N}
NEXT STEP: {run next rebuttal round, check consensus, present verdict, etc.}

{if post-pause update: POST-PAUSE UPDATE FROM USER: {new context}}
```

Then invoke `/ftm-council` via the Skill tool.

### For ftm-audit:

```
RESUMING FROM SAVED STATE — DO NOT START FROM PHASE 0.

AUDIT TRIGGER: {what triggered it}
SCOPE: {files/project}

PROJECT PATTERNS (Phase 0 — already completed):
{detected framework, dimensions, configuration}

LAYER 1 RESULTS:
{knip findings if completed, or "not yet run"}

LAYER 2 RESULTS:
{adversarial findings if completed, or "not yet run"}

LAYER 3 RESULTS:
{fixes applied, manual items, iteration count}

NEXT STEP: {run remaining layers, apply fixes, re-verify, etc.}

{if post-pause update: POST-PAUSE UPDATE FROM USER: {new context}}
```

Then invoke `/ftm-audit` via the Skill tool.

## Step 7: Archive the State File

After the skill has been successfully invoked and the user is continuing their work, archive the consumed state file so it doesn't interfere with future pause/resume cycles.

```bash
mkdir -p ~/.claude/ftm-state/archive
mv ~/.claude/ftm-state/STATE.md ~/.claude/ftm-state/archive/STATE-$(date +%Y%m%d-%H%M%S).md
```

Do this immediately after the skill is invoked, not after the full session completes. The state has been consumed — if the user needs to pause again, ftm-pause will create a new STATE.md from the current (now-continued) session.

## Edge Cases

### State file references a skill that isn't installed
If the state says `skill: ftm-debug` but ftm-debug isn't in the skills directory, tell the user: "The saved session requires ftm-debug but that skill isn't available. Install it and try again."

### User wants to resume but also change direction
If the user says something like "resume, but actually I want to go with option 2 instead of the microservices approach we chose," add this as a post-pause update and let the skill handle the direction change. Don't try to edit the state — just pass the new context along and the skill's natural conversation flow will handle it.

### Multiple state files
If both `STATE.md` and `STATE-ftm-brainstorm.md` exist (from a session where multiple skills were paused), ask the user which one to resume. List them with their skill type and timestamp.

### Corrupted or incomplete state
If the state file is missing critical sections (no "Next Step," no "Context Snapshot"), warn the user: "The state file is incomplete — it may have been saved during an error. I can try to resume with what's available, but some context may be missing. Alternatively, we can start fresh."

### The user runs /ftm-resume but there's nothing to resume
If `~/.claude/ftm-state/` doesn't exist or contains no STATE.md:
```
No saved ftm session found.

To save a session for later:
1. Start any ftm skill (/ftm-brainstorm, /ftm-executor, /ftm-debug, /ftm-council, /ftm-audit)
2. When you need to stop, use /ftm-pause
3. In a new conversation, use /ftm-resume to continue
```

### Archived states
If the user asks "do I have any old sessions?" or "what sessions have I saved?", check the archive:
```bash
ls -la ~/.claude/ftm-state/archive/
```
List the archived states with their skill type, timestamp, and phase. Offer to restore any of them (copy from archive to STATE.md, then run the normal resume flow).

## Requirements

- reference: `~/.claude/ftm-state/STATE.md` | required | saved session state file from ftm-pause
- reference: `../ftm-pause/references/protocols/SKILL-RESTORE-PROTOCOLS.md` | required | per-skill state field restoration instructions
- reference: `../ftm-pause/references/protocols/VALIDATION.md` | required | validation protocol for state file integrity
- reference: `~/.claude/ftm-state/archive/` | optional | archived prior state files
- tool: `git` | optional | checking git state drift since session was paused

## Risk

- level: low_write
- scope: archives STATE.md by moving it to ~/.claude/ftm-state/archive/; invokes the target ftm skill with restored context; does not modify project source files
- rollback: copy archived STATE.md back from archive if restoration was incorrect

## Approval Gates

- trigger: validation finds warnings (git drift, stale state, missing artifacts) | action: present consolidated validation summary and require user acknowledgment before proceeding
- trigger: validation finds block-level failure | action: stop and report failure; do not invoke target skill
- trigger: user provides new context along with "yes" | action: capture as post-pause update and inject into skill invocation
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: STATE.md not found | action: report "No saved ftm session found" with instructions for saving sessions
- condition: STATE.md frontmatter missing required fields | action: report validation failure with specific missing fields
- condition: multiple STATE.md files (STATE.md + STATE-*.md) | action: ask user which to resume, list each with skill type and timestamp
- condition: state is >7 days old | action: flag as potentially stale with warning, require user acknowledgment

## Capabilities

- cli: `git` | optional | branch and commit state validation
- env: none required

## Event Payloads

### session_resumed
- skill: string — "ftm-resume"
- resumed_skill: string — the ftm skill that was re-invoked
- phase: string — phase the session is resuming at
- state_age_hours: number — how long ago the session was paused
- post_pause_update: boolean — whether user provided new context

### task_completed
- skill: string — "ftm-resume"
- resumed_skill: string — the ftm skill re-invoked
- state_file_archived: string — path where STATE.md was archived
