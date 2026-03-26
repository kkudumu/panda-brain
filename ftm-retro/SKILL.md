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

## Scoring Dimensions

Score each dimension 0–10 with a citation to specific data. Do not estimate without evidence — if data is missing, note it and score conservatively.

### 1. Wave Parallelism Efficiency (0–10)

Were independent tasks actually dispatched in parallel? Could more tasks have been parallelized?

- **10**: Every task that could run in parallel did. No serial bottlenecks where parallelism was possible.
- **7–9**: Minor serial steps that could have been parallel (e.g., final post-processing tasks run sequentially).
- **4–6**: Significant parallelism opportunities missed. Tasks that had no dependencies ran serially.
- **1–3**: Nearly all tasks ran serially despite having no dependencies on each other.
- **0**: Everything was serial regardless of dependency structure.

Evidence to cite: wave structure from PROGRESS.md, task dependency graph, agent dispatch timestamps.

### 2. Audit Pass Rate (0–10)

What percentage of tasks passed ftm-audit on the first attempt?

- **10**: 100% first-pass. No task needed a fix cycle.
- **8**: 90%+ first-pass. One or two tasks needed minor fixes.
- **6**: 75–89% first-pass.
- **4**: 50–74% first-pass. Roughly half the tasks needed audit remediation.
- **2**: Below 50% first-pass.
- **0**: Every single task failed audit on the first attempt.

Evidence to cite: per-task audit results (pass/fail counts, auto-fix counts, manual-fix counts).

### 3. Codex Gate Pass Rate (0–10)

What percentage of waves passed the ftm-codex-gate on the first attempt?

- **10**: All waves passed on first gate run.
- **7–9**: One wave needed a fix-and-retry.
- **4–6**: Multiple waves needed retries.
- **1–3**: Most waves failed the gate at least once.
- **0**: Every wave failed the gate.

Evidence to cite: codex gate results per wave (pass/fail, failure types).

### 4. Retry and Fix Count (0–10)

How many total review-fix cycles were needed across all tasks and waves? Lower is better.

Formula: score = max(0, 10 - (total_retries / task_count) * 5)

- **10**: Zero retries.
- **8**: Fewer than 0.5 retries per task on average.
- **6**: 0.5–1.0 retries per task.
- **4**: 1–2 retries per task.
- **2**: 2–3 retries per task.
- **0**: More than 3 retries per task on average.

Evidence to cite: total retries, broken down by type (audit fix, codex gate retry, manual intervention).

### 5. Execution Smoothness (0–10)

Subjective but evidence-grounded assessment. Were there blockers, ambiguous plan steps, confusing errors, or required manual interventions?

- **10**: Fully autonomous from start to finish. No blockers, no ambiguity, no manual steps.
- **7–9**: Minor friction — one clarification needed, one unexpected error handled gracefully.
- **4–6**: Moderate friction — multiple ambiguities, one blocker that paused execution, one manual intervention.
- **1–3**: Significant friction — repeated blockers, unclear plan steps that caused wrong-direction work, multiple manual interventions.
- **0**: Execution could not proceed without constant human steering.

Evidence to cite: error log entries, any manual interventions recorded in PROGRESS.md, plan ambiguities encountered.

---

## Report Generation

### Step 1: Create retro directory

```bash
mkdir -p ~/.claude/ftm-retros/
```

### Step 2: Generate plan slug

Take the plan title, lowercase it, replace spaces with hyphens, strip all non-alphanumeric characters except hyphens.

Examples:
- "FTM Ecosystem Expansion" → `ftm-ecosystem-expansion`
- "Fix Auth Bug + Rate Limiting" → `fix-auth-bug-rate-limiting`
- "v2.0 API Refactor" → `v20-api-refactor`

### Step 3: Check for past retros

Before writing anything, check whether any `.md` files exist in `~/.claude/ftm-retros/`. If they do, read them all. You will use them for the Pattern Analysis section.

### Step 4: Write the report

Save to: `~/.claude/ftm-retros/{plan-slug}-{YYYY-MM-DD}.md`

Use this exact format:

```markdown
# Retro: {Plan Title}

**Date:** {YYYY-MM-DD}
**Plan:** {absolute path to plan file}
**Duration:** {total execution time, e.g. "47 minutes"}

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Wave Parallelism | X/10 | {1-sentence justification with data} |
| Audit Pass Rate | X/10 | {N}/{total} tasks first-pass |
| Codex Gate Pass Rate | X/10 | {N}/{total} waves first-pass |
| Retry/Fix Count | X/10 | {total retries} across {N} tasks |
| Execution Smoothness | X/10 | {1-sentence justification} |

**Overall: {sum}/50**

## Raw Data

- Tasks: {N}
- Waves: {N}
- Agents spawned: {N}
- Audit findings: {N} total ({N} auto-fixed, {N} manual)
- Codex gate results: Wave 1: pass | Wave 2: fail → pass | Wave 3: pass
- Errors/blockers: {list any, or "none"}

## What Went Well

{2–4 specific observations, each grounded in a data point or task number.}

Example format:
- **Task 3 (auth middleware)** completed in a single commit with zero audit findings. The agent prompt had clear acceptance criteria and a scoped file list — the agent never wandered.
- **Wave 2 parallelism** was fully utilized: all 4 tasks dispatched simultaneously, cutting estimated serial time from ~32 minutes to ~9 minutes.

## What Was Slow

{2–4 specific bottlenecks with timing data or retry counts where available.}

Example format:
- **ftm-audit Phase 1 (knip)** repeated full project analysis for each task in wave 3, even though tasks only touched 2–3 files each. Added ~40s × 5 tasks = ~3.5 minutes of unnecessary scanning.
- **Task 7 needed 3 audit fix cycles** due to an import path that kept regenerating incorrectly. The agent prompt did not specify the alias configuration in tsconfig.paths.

## Proposed Improvements

{3–5 specific, actionable suggestions. Each must identify: which skill to change, what to change exactly, and why it would help.}

Format each as:
**N. {Short title}** — {Skill to change} — {Specific change} — {Expected impact}

Examples:
1. **Cache knip results within a wave** — ftm-audit — In Phase 1, check whether knip results are already cached for the current wave (via a temp file at `/tmp/ftm-knip-cache-{wave-id}.json`). Only re-run knip if the cache is missing or if the files changed by this task differ from cached scope. Expected: 3× speedup for ftm-audit on large projects with many tasks per wave.
2. **Dispatch Instrumentor and Researcher in parallel** — ftm-debug — These two agents have no shared state and currently run sequentially. Dispatch them simultaneously. Expected: ~40% reduction in ftm-debug total runtime.
3. **Add tsconfig.paths to agent context for TypeScript projects** — ftm-executor — When generating agent prompts for TypeScript tasks, include the relevant `paths` aliases from `tsconfig.json`. Expected: eliminates the import-alias regeneration loop that caused 3 retries on Task 7.

## Pattern Analysis

{Only include this section if past retros exist in ~/.claude/ftm-retros/}

### Recurring Issues

{List problems that appeared in 2 or more retros. Format: "Issue description — appeared in: retro-slug-1, retro-slug-2"}

### Score Trends

{Compare overall scores across retros. Are they improving, declining, or stable? Cite actual numbers.}

Example: Overall scores: 32/50 → 38/50 → 41/50 across the last 3 retros. Parallelism and smoothness improving; audit pass rate stuck at 6/10 for all three runs.

### Unaddressed Suggestions

{List proposed improvements from past retros that have not yet been implemented. These get escalated — flag them explicitly.}

Format: "**[ESCALATED]** {suggestion} — first proposed in {retro-slug-date}, appeared {N} times"
```

---

## Key Behaviors

### Evidence-first scoring

Every score needs a citation. "Tasks passed audit" is not a citation. "12/14 tasks passed audit on first attempt; Tasks 3 and 9 each needed one auto-fix cycle" is a citation. If the data to score a dimension is genuinely unavailable, note the gap explicitly and score conservatively (assume worst case for that dimension).

### Improvement specificity

"Improve parallelism" is not an improvement proposal. "Add a dependency pre-check step to ftm-executor Phase 2 that flags tasks with no declared dependencies as parallelizable, and warn when they are dispatched serially" is an improvement proposal. Every proposed improvement must be concrete enough that a future session could implement it from the description alone without asking clarifying questions.

### Pattern escalation

Recurring issues that have appeared in 3+ retros without being addressed should be flagged with `[ESCALATED - 3+ occurrences]` and moved to the top of the Proposed Improvements list. These are systemic problems, not one-off noise.

### No vibes

Do not write "the execution felt smooth" or "agents seemed efficient." Write "0 manual interventions were required and all errors were caught and auto-resolved by ftm-audit Phase 2." The report is read by future executions that need to calibrate behavior, not by humans looking for encouragement.

---

## Output

After saving the retro file, print to the user:

```
Retro saved: ~/.claude/ftm-retros/{filename}

Overall: {score}/50
Top issue: {single most impactful bottleneck in one sentence}
Top suggestion: {single highest-value proposed improvement in one sentence}
```

Do not print the full report to the terminal — it lives in the file. The summary above is sufficient for the user to know the run completed and where to find details.

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

Write a structured experience entry to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` following the schema in blackboard-schema.md.

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
