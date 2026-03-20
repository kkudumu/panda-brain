---
name: ftm-pause
description: Save the current ftm skill session state so work can be resumed in a new conversation. Use when user says "pause", "save state", "I need to stop", "continue later", "ftm pause", "save progress", or is about to end a session mid-workflow. Works with any ftm skill (brainstorm, executor, debug, council, audit).
---

## Events

### Emits
- `session_paused` — when the session state has been successfully serialized and written to disk
- `task_completed` — when the pause workflow finishes (state file written and confirmation presented)

### Listens To
(none — ftm-pause is explicitly invoked by the user and does not respond to events)

# FTM Pause — Session State Capture

Save the full state of any active ftm skill session to disk so it can be resumed in a new conversation with zero context loss.

## Step 1: Detect the Active FTM Skill

Scan the current conversation context to determine which ftm skill is active. Look for these signals:

| Signal | Skill |
|--------|-------|
| Phase 0 repo scan, intake rounds, research sprints, 5-suggestion format, plan generation | **ftm-brainstorm** |
| Plan analysis, agent team assembly, worktree setup, wave dispatch, task completion tracking | **ftm-executor** |
| Problem intake, investigation plan, war room agents (instrumenter/researcher/reproducer/hypothesizer), solver/reviewer loop | **ftm-debug** |
| Council prompt framing, multi-model dispatch (Claude/Codex/Gemini), rebuttal rounds, alignment checks | **ftm-council** |
| Project pattern detection, knip analysis, adversarial audit, auto-fix, wiring contracts | **ftm-audit** |

If no ftm skill is active, tell the user: "No active ftm session detected. This skill saves state for ftm-brainstorm, ftm-executor, ftm-debug, ftm-council, and ftm-audit sessions."

If multiple skills have been invoked in the same conversation (e.g., brainstorm followed by executor), capture the most recently active one. If the user says which one to save, respect that.

## Step 2: Capture State by Skill Type

Read `references/protocols/SKILL-RESTORE-PROTOCOLS.md` for the full per-skill capture specification. Each skill section defines exactly which fields must be captured and what is required for reliable restoration.

Capture every field listed for the detected skill. Do not omit fields because a phase hasn't been reached yet — record those as "not started" or "N/A" so ftm-resume knows the session stopped before that phase.

## Step 3: Gather Artifacts

Scan the conversation and filesystem for artifacts created during the session:

- **Plan files**: `~/.claude/plans/*.md`
- **Research documents**: Any `.md` files created by agents (RESEARCH-FINDINGS.md, HYPOTHESES.md, REPRODUCTION.md, FIX-SUMMARY.md, REVIEW-VERDICT.md, DEBUG-INSTRUMENTATION.md)
- **Worktree branches**: Run `git worktree list` and `git branch --list "plan-exec/*" "debug/*"` to capture active branches
- **Audit changelogs**: Any ftm audit changelog output
- **Brain dump extractions**: If Path B brainstorm, the structured extraction

For each artifact, record its absolute path and verify it still exists on disk.

## Step 4: Write the State File

Create the directory if it doesn't exist:
```bash
mkdir -p ~/.claude/ftm-state
```

Write the state file to `~/.claude/ftm-state/STATE.md`. Required structure:

```markdown
---
skill: <skill-name>
phase: <phase-number-or-name>
phase_detail: "<human-readable one-liner: exactly where the session stopped>"
timestamp: <ISO-8601>
project_dir: <absolute-path>
git_branch: <branch>       # omit if no git repo
git_commit: <short-hash>   # omit if no git repo
---

# FTM Session State

## Active Skill
[One paragraph: skill, phase, path, turn, and current direction]

## Context Snapshot
[Full state for this skill per references/protocols/SKILL-RESTORE-PROTOCOLS.md]

## Decisions Made
[Every decision the user confirmed — use real content, not placeholders]

## Open Questions
[Anything unresolved or about to be explored]

## Next Step
[Specific and actionable: what ftm-resume does first, what the user needs to respond to,
what research runs next. Must be specific enough to resume without "where were we?"]

## Artifacts
[Absolute path for each artifact, or "none on disk"]
```

**Rules:**
- `git_commit`: run `git rev-parse --short HEAD`. `git_branch`: run `git branch --show-current`.
- Include actual content — real URLs, real decisions, real findings. No placeholders.
- Omit raw agent prompts (the skill files have them) and full file contents (reference by path).

See `references/protocols/VALIDATION.md` for the full pre-write and post-write validation checklist.

## Step 5: Confirm to User

After saving, present a brief confirmation:

```
Session saved to ~/.claude/ftm-state/STATE.md

Captured:
- Skill: <skill-name>
- Phase: <phase and detail>
- <skill-specific counts: decisions, tasks, rounds, findings, etc.>
- Artifacts: <count and locations, or "none on disk">

To resume in a new conversation:
/ftm-resume
```

Tailor the counts to the skill: brainstorm shows decisions + turns, executor shows task completion, debug shows investigation agents, council shows round count + consensus status, audit shows layer completion + finding counts.

## Edge Cases

**Multiple skills active:** Ask which to save. If "both," save most recent to STATE.md and the other to STATE-[skill].md.

**Very early session:** Save what exists — even a Phase 0 scan is worth capturing. "Next Step" should say the user needs to answer the first intake question.

**State file already exists:** Overwrite it. Prior state was either consumed or abandoned. FTM-resume archives before loading if the user needs the old one.

**No git repo:** Omit `git_branch` and `git_commit` fields. Record `project_dir` only.

**Skill invoked, no user interaction yet:** Save what exists (Phase 0 scan, initial question). "Next Step" notes that the user hasn't answered yet.

**Large state:** Do not truncate. Some sessions produce massive state files. Completeness is required for reliable restoration.

## Requirements

- reference: `~/.claude/ftm-state/STATE.md` | optional | existing state file to overwrite
- reference: `~/.claude/ftm-pause/references/protocols/SKILL-RESTORE-PROTOCOLS.md` | required | per-skill capture field specifications
- reference: `~/.claude/ftm-pause/references/protocols/VALIDATION.md` | required | pre-write and post-write validation checklist
- tool: `git` | optional | git branch and commit hash capture for state file

## Risk

- level: low_write
- scope: writes ~/.claude/ftm-state/STATE.md only; does not modify project source files or blackboard experiences; overwrites existing STATE.md without backup
- rollback: no project mutations; prior STATE.md is overwritten (not backed up) by design

## Approval Gates

- trigger: multiple skills active and unclear which to pause | action: ask user which skill state to save before writing
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: ~/.claude/ftm-state/ directory doesn't exist | action: create directory before writing STATE.md
- condition: no ftm skill detected as active | action: report "No active ftm session detected" and list which skills this applies to
- condition: git not available | action: omit git_branch and git_commit fields from state file frontmatter
- condition: artifact files referenced in state don't exist on disk | action: note as "path recorded but file not found" in Artifacts section

## Capabilities

- cli: `git` | optional | branch name and commit hash for state file metadata

## Event Payloads

### session_paused
- skill: string — "ftm-pause"
- saved_skill: string — the ftm skill whose state was saved
- phase: string — phase at which the session was paused
- state_file: string — absolute path to written STATE.md
- artifacts_count: number — number of artifact paths recorded

### task_completed
- skill: string — "ftm-pause"
- saved_skill: string — the ftm skill whose state was saved
- state_file: string — absolute path to STATE.md
