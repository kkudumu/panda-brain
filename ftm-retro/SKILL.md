---
name: ftm-retro
description: Post-execution self-assessment skill. Automatically triggered after ftm-executor completes a plan. Scores execution across 5 dimensions, identifies what went well and what was slow, writes structured report with improvement suggestions. Use when user says "retro", "retrospective", "how did that go", "execution review", "self-assessment", "ftm retro".
---

## Events

### Emits
- `experience_recorded` — when a task outcome, fix attempt, or blocker is written to the blackboard experience log
- `pattern_discovered` — when a recurring pattern is identified from accumulated experiences and promoted to patterns.json
- `task_completed` — when the retro report is saved and the self-assessment session concludes

### Listens To
- `task_completed` — micro-reflection trigger: record the task outcome as a structured experience entry
- `error_encountered` — failure analysis: record the error context as a failure experience for pattern learning
- `bug_fixed` — success recording: record the fix details as a positive experience (what worked, what the root cause was)

# FTM Retro — Post-Execution Self-Assessment

Structured retrospective system for ftm-executor plans. Scores execution across 5 evidence-based dimensions, surfaces bottlenecks with specifics, and builds a cumulative pattern library that makes each future execution smarter.

## Why This Exists

Execution without reflection is a loop with no exit. FTM-retro closes the feedback cycle: every plan run generates a scored report, every report feeds a pattern library, and recurring issues get escalated until they're fixed. The goal is measurable improvement across executions, not vibes.

## Operating Modes

### Mode 1: Auto-triggered by ftm-executor (Phase 6.5)

FTM-executor calls this skill after all waves complete and the final commit is made. It passes execution context directly:

- Plan title and absolute path
- Task count and wave count
- Total agents spawned
- Per-task audit results: pass/fail/auto-fix counts per phase
- Codex gate results per wave (pass/fail + any failures found)
- Total execution duration
- Errors, blockers, or manual interventions that occurred

When invoked in this mode, proceed directly to scoring — all data is available.

### Mode 2: Manual (`/ftm retro`)

When invoked without execution context:

1. Search the current project for the most recent `PROGRESS.md` file. Read it fully to reconstruct what ran.
2. If no `PROGRESS.md` exists, check `~/.claude/ftm-retros/` for the most recent `.md` file and ask the user which execution they want to review.
3. Once context is established, proceed to scoring.

Never ask the user to provide data you can find yourself. Read the files.

---

## Scoring Flow

Score execution across 5 dimensions. Read `references/protocols/SCORING-RUBRICS.md` for the full rubric for each dimension (scale breakpoints, evidence requirements, formula for Dimension 4).

**The 5 dimensions:**

1. **Wave Parallelism Efficiency** — were independent tasks actually dispatched in parallel?
2. **Audit Pass Rate** — what percentage of tasks passed ftm-audit on the first attempt?
3. **Codex Gate Pass Rate** — what percentage of waves passed the ftm-codex-gate on the first attempt?
4. **Retry and Fix Count** — how many total review-fix cycles were needed? Lower is better.
5. **Execution Smoothness** — evidence-grounded assessment of blockers, ambiguities, and manual interventions.

Every score requires a citation to specific data. If data for a dimension is unavailable, note the gap and score conservatively.

---

## Report Generation

### Step 1: Create retro directory

```bash
mkdir -p ~/.claude/ftm-retros/
```

### Step 2: Check for past retros

Before writing anything, check whether any `.md` files exist in `~/.claude/ftm-retros/`. If they do, read them all. You will use them for the Pattern Analysis section.

### Step 3: Write the report

Read `references/templates/REPORT-FORMAT.md` for the exact output template, slug generation rules, and section format.

Save to: `~/.claude/ftm-retros/{plan-slug}-{YYYY-MM-DD}.md`

---

## Key Behaviors

### Improvement specificity

"Improve parallelism" is not an improvement proposal. "Add a dependency pre-check step to ftm-executor Phase 2 that flags tasks with no declared dependencies as parallelizable, and warn when they are dispatched serially" is an improvement proposal. Every proposed improvement must be concrete enough that a future session could implement it from the description alone.

### Pattern escalation

Recurring issues that have appeared in 3+ retros without being addressed should be flagged with `[ESCALATED - 3+ occurrences]` and moved to the top of the Proposed Improvements list. These are systemic problems, not one-off noise.

---

## Output

After saving the retro file, print to the user:

```
Retro saved: ~/.claude/ftm-retros/{filename}

Overall: {score}/50
Top issue: {single most impactful bottleneck in one sentence}
Top suggestion: {single highest-value proposed improvement in one sentence}
```

Do not print the full report to the terminal — it lives in the file.

---

## Micro-Reflection Mode

Micro-reflections are lightweight experience entries recorded after significant actions — not just full executor runs. The mind triggers this mode via the `task_completed`, `error_encountered`, and `bug_fixed` events.

### Trigger Events
- `task_completed` — any task completion (micro through large)
- `bug_fixed` — a bug was resolved
- `error_encountered` — an unexpected error during execution
- `code_committed` — a meaningful commit was made
- `plan_generated` — a plan was created from brainstorming
- `user_correction` — the user corrected the mind's approach

### Reflection Format (Verbal RL)

For each trigger, generate a structured reflection:

"I [succeeded/failed/partially succeeded] at [task description] because [specific reason].
Next time I should [concrete actionable adjustment].
Confidence: [low/medium/high]"

### Experience Entry Creation

Write a structured experience entry to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json`.

Key fields:
- `task_type`: derived from the task
- `description`: 1-2 sentence summary
- `approach`: what was tried
- `outcome`: success/partial/failure
- `lessons`: concrete, actionable takeaways — the verbal RL reflection above, decomposed into individual lesson strings
- `complexity_estimated` vs `complexity_actual`: track both for calibration
- `capabilities_used`: skills, MCPs, and agent types activated
- `tags`: searchable labels
- `confidence`: low for first-time observations, medium for confirmed patterns

### Pattern Extraction

After writing an experience, check for pattern promotion:

1. Read `experiences/index.json`
2. Count entries with overlapping `task_type` AND `tags` that share the same lesson theme
3. If 3+ similar experiences exist with the same lesson → promote to `patterns.json`:
   - Choose the appropriate category (codebase_insights, execution_patterns, user_behavior, recurring_issues)
   - Set `confidence: "low"` for newly promoted patterns (3 occurrences)
   - Raise to `"medium"` at 5+, `"high"` at 8+

### Pattern Decay

Patterns that are not reinforced within 30 days should have their confidence reduced:
- `high` → `medium`
- `medium` → `low`
- `low` → remove from patterns.json

Check for decay when reading patterns.json during any blackboard operation.

### Cold-Start Behavior

During the first ~10 interactions (when `experiences/index.json` has `total_count < 10`):
- Record EVERY completed task, even trivial ones
- Set `confidence: "low"` on all entries
- Prioritize breadth of recording over depth of analysis

## Blackboard Write

After completing, update:
1. `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json`
3. Update `experiences/index.json` with the new entry
4. Emit `task_completed`

## Requirements

- reference: `PROGRESS.md` | optional | executor progress log for auto-triggered mode
- reference: `~/.claude/ftm-retros/` | optional | prior retro files for pattern analysis
- reference: `references/protocols/SCORING-RUBRICS.md` | required | scoring scale breakpoints and evidence requirements
- reference: `references/templates/REPORT-FORMAT.md` | required | retro report output template
- reference: `~/.claude/ftm-state/blackboard/experiences/index.json` | optional | experience inventory for micro-reflection mode
- reference: `~/.claude/ftm-state/blackboard/patterns.json` | optional | pattern registry for promotion and decay

## Risk

- level: low_write
- scope: writes retro report to ~/.claude/ftm-retros/; writes experience files to blackboard; promotes patterns to patterns.json; does not modify project source files
- rollback: delete retro report file; remove experience entry from blackboard

## Approval Gates

- trigger: pattern promotion triggered (3+ matching experiences) | action: auto-promote to patterns.json without user gate (learning system behavior)
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: PROGRESS.md not found and manual mode | action: check ~/.claude/ftm-retros/ for most recent .md file; ask user which execution to review if multiple found
- condition: execution context not provided by ftm-executor | action: reconstruct from PROGRESS.md or ask user for context
- condition: scoring rubric file missing | action: apply built-in scoring heuristics from skill body
- condition: experiences/index.json has fewer than 10 entries | action: cold-start mode — record every task, set all confidence to low

## Capabilities

- env: none required

## Event Payloads

### experience_recorded
- skill: string — "ftm-retro"
- experience_path: string — path to written experience file
- task_type: string — type of task recorded
- outcome: string — success | partial | failure
- confidence: string — low | medium | high

### pattern_discovered
- skill: string — "ftm-retro"
- pattern_name: string — name of the promoted pattern
- category: string — codebase_insights | execution_patterns | user_behavior | recurring_issues
- occurrence_count: number — number of experiences that triggered promotion
- confidence: string — low | medium | high

### task_completed
- skill: string — "ftm-retro"
- report_path: string — absolute path to saved retro report
- overall_score: number — total score out of 50
- top_issue: string — most impactful bottleneck identified
- patterns_promoted: number — new patterns added to patterns.json
