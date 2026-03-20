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

---

## Step 1: Read and Validate

Read `~/.claude/ftm-state/STATE.md`.

Run all validation checks before proceeding. See `references/protocols/VALIDATION.md` for the full validation protocol covering:
- State file integrity and required frontmatter fields
- Version compatibility between saved state and installed skills
- Project directory existence
- Git state drift (branch changes, new commits)
- Worktree branch availability (executor and debug)
- Plan file existence (executor)
- Artifact file availability (debug)
- Session staleness (< 24h / 1–7 days / > 7 days)
- Skill availability

Present a consolidated validation summary before asking the user to confirm. A single block-level failure prevents resumption. Warnings require user acknowledgment.

---

## Step 2: Parse the Frontmatter

Extract required YAML frontmatter: `skill`, `phase`, `timestamp`, `project_dir`. Optional fields: `phase_detail`, `git_branch`, `git_commit`.

---

## Step 3: Present the Resume Summary

After validation passes (or the user acknowledges warnings), present the resume summary for the relevant skill.

All summaries follow this structure — adapt the "Where we left off" fields to the skill:

```
Resuming ftm-{skill} session from {timestamp}
Project: {project_dir}

Where we left off:
  [skill-specific fields — see below]

Next step:
  {next_step from state file}

Ready to continue? (or type new context to add before resuming)
```

**ftm-brainstorm fields:**
- Phase: {phase} — {phase_detail}, Path: {A or B}
- Research sprints completed: {N}, Challenge turns: {N}
- Decisions locked: {N} (list them), Open questions: {N} (list them)

**ftm-executor fields:**
- Wave: {current_wave} of {total_waves}, Tasks: {completed}/{total} complete
- Done / In-progress (with agent) / Pending / Failed+Blocked (list each)
- Worktrees: {N active}, Last audit: {result}

**ftm-debug fields:**
- Phase: {phase} — {phase_detail}, Problem: {one-line summary}
- Investigation: Instrumenter / Researcher / Reproducer / Hypothesizer (complete/pending + finding)
- Solver attempts: {N}, Reviewer verdict: {if any}, Worktrees: {list}

**ftm-council fields:**
- Council prompt: {brief summary}, Round: {N} of 5
- Each model's one-line position, Consensus: {Yes/No + detail}

**ftm-audit fields:**
- Trigger: {what triggered it}
- Phase 0 / Layer 1 / Layer 2 / Layer 3: {complete with findings / pending}
- Status: {PASS/FAIL/in-progress}

---

## Step 4: Handle User Response

**"Yes" / "Continue" / "Go"** — proceed to Step 5.

**New context / additional information** — the user may say "yes, but also..." or provide updated information. Capture this as a "Post-pause update" section in the Context Snapshot. Pass it forward when invoking the skill.

**"Start fresh" / "Never mind"** — archive the state file (see Step 6) and tell the user: "State archived. You can start a fresh session with /ftm-{skill}."

---

## Step 5: Invoke the Appropriate FTM Skill

Invoke the ftm skill with the full saved context injected so it picks up exactly where it left off, not from the beginning. Construct a context preamble that tells the skill its position.

Read `../ftm-pause/references/protocols/SKILL-RESTORE-PROTOCOLS.md` for the exact per-skill state fields to inject and restoration instructions for each skill (brainstorm, executor, debug, council, audit).

### Context preamble pattern:

```
RESUMING FROM SAVED STATE — DO NOT START FROM PHASE 0.

[Inject all relevant state sections from the state file, organized by the
field groups defined in SKILL-RESTORE-PROTOCOLS.md for this skill.]

NEXT STEP: {paste next_step from state file — this is where execution picks up}

{if post-pause update: POST-PAUSE UPDATE FROM USER: {new context}}
```

Then invoke the skill via the Skill tool:
- brainstorm: `/ftm-brainstorm`
- executor: `/ftm-executor {plan_path}`
- debug: `/ftm-debug`
- council: `/ftm-council`
- audit: `/ftm-audit`

---

## Step 6: Archive the State File

After the skill has been successfully invoked, archive the consumed state file immediately:

```bash
mkdir -p ~/.claude/ftm-state/archive
mv ~/.claude/ftm-state/STATE.md ~/.claude/ftm-state/archive/STATE-$(date +%Y%m%d-%H%M%S).md
```

Archive immediately after invocation — not after the full session completes. The state has been consumed. If the user needs to pause again, ftm-pause will create a new STATE.md from the now-continued session.

---

## Edge Cases

**Multiple state files** — If both `STATE.md` and `STATE-ftm-brainstorm.md` exist, ask the user which one to resume. List them with skill type and timestamp.

**User wants to resume but also change direction** — Add the direction change as a post-pause update. Let the skill's natural conversation flow handle it. Do not edit the state file directly.

**Archived states** — If the user asks "do I have any old sessions?", check the archive:
```bash
ls -la ~/.claude/ftm-state/archive/
```
List archived states with skill type, timestamp, and phase. Offer to restore any of them (copy from archive to STATE.md, then run the normal resume flow).

**Nothing to resume** — If `~/.claude/ftm-state/` doesn't exist or contains no STATE.md:
```
No saved ftm session found.

To save a session for later:
1. Start any ftm skill (/ftm-brainstorm, /ftm-executor, /ftm-debug, /ftm-council, /ftm-audit)
2. When you need to stop, use /ftm-pause
3. In a new conversation, use /ftm-resume to continue
```

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
