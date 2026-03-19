# Report Format — Retro Output Template

This is the exact format for all retro report files saved to `~/.claude/ftm-retros/`.

---

## File Naming

Save to: `~/.claude/ftm-retros/{plan-slug}-{YYYY-MM-DD}.md`

### Slug Generation

Take the plan title, lowercase it, replace spaces with hyphens, strip all non-alphanumeric characters except hyphens.

Examples:
- "FTM Ecosystem Expansion" → `ftm-ecosystem-expansion`
- "Fix Auth Bug + Rate Limiting" → `fix-auth-bug-rate-limiting`
- "v2.0 API Refactor" → `v20-api-refactor`

---

## Report Template

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

## Improvement Specificity Standard

"Improve parallelism" is not an improvement proposal. "Add a dependency pre-check step to ftm-executor Phase 2 that flags tasks with no declared dependencies as parallelizable, and warn when they are dispatched serially" is an improvement proposal. Every proposed improvement must be concrete enough that a future session could implement it from the description alone without asking clarifying questions.

## Pattern Escalation Standard

Recurring issues that have appeared in 3+ retros without being addressed should be flagged with `[ESCALATED - 3+ occurrences]` and moved to the top of the Proposed Improvements list. These are systemic problems, not one-off noise.
