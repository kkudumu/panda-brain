# Reflexion Protocol — Verbal RL for FTM-Mind

**Location**: `~/.claude/skills/ftm-mind/references/reflexion-protocol.md`
**Purpose**: Defines how ftm-mind stores and reuses execution experience through the Reflexion pattern — a lightweight verbal reinforcement learning loop that improves behavior across sessions without fine-tuning.

---

## The Reflexion Pattern

Reflexion is a simple feedback mechanism: after each significant action, write a short natural-language reflection describing what happened and why. Before the next attempt at a similar task, retrieve and prepend relevant reflections to the working context.

Core loop:
1. **Act** — execute the task using available skills and tools
2. **Reflect** — generate a structured verbal reflection on the outcome
3. **Store** — write the reflection as an experience entry to the blackboard
4. **Retrieve** — on the next similar task, load matching experiences during Orient
5. **Adjust** — synthesize retrieved lessons into an adjusted approach before acting

The key insight: language models do not update weights between conversations, but they can update behavior when prior experience is injected as context. Reflexion makes that injection systematic.

### What "Prepend to Next Attempt" Means

When ftm-mind enters the Orient phase of the OODA loop for a new task:

1. Read `experiences/index.json`
2. Filter entries matching the current `task_type` and any overlapping tags
3. Load the top 3–5 most recent matching experience files
4. Synthesize their `lessons` arrays into a short prior-experience summary
5. That summary is the first input considered when forming the plan — not an afterthought

This is the prepend. The retrieved experience shapes the approach before any analysis of the current task begins.

---

## Trigger Conditions

Micro-reflections are written after any of the following events:

| Event | When It Fires | What to Record |
|---|---|---|
| `task_completed` | Any task finishes — micro through large | Outcome, approach, what worked |
| `bug_fixed` | A bug was diagnosed and resolved | Root cause, fix strategy, what was misleading |
| `error_encountered` | An unexpected error during execution | Error context, what caused it, how to avoid |
| `code_committed` | A meaningful commit is made | What changed, why, any surprising side effects |
| `plan_generated` | A plan was created from brainstorming | Plan structure, assumptions made, expected risks |
| `user_correction` | The user corrected the mind's approach | What the mind got wrong, what the correct approach was |

Do not wait for a formal retro to record these. Write the experience file immediately after the triggering event resolves. Delayed recording produces lower-quality lessons.

---

## Reflection Format

For each trigger, generate a structured verbal RL reflection before writing the experience entry:

```
I [succeeded / failed / partially succeeded] at [task description] because [specific reason].
Next time I should [concrete, actionable adjustment].
Confidence: [low / medium / high]
```

### Good Reflection Examples

```
I succeeded at adding the freshservice enrichment poller because the existing poller_runtime.py
pattern was reusable with minimal modification.
Next time I should check for existing runtime patterns before writing new polling infrastructure.
Confidence: medium
```

```
I partially succeeded at the Jira sync task because the field mapping worked but the
attachment handling failed silently — no error was surfaced until the next run.
Next time I should add explicit attachment count validation after every sync and log
mismatches immediately rather than relying on downstream detection.
Confidence: low
```

```
I failed at the database migration because I assumed the staging schema matched production
and did not read the migration history first.
Next time I should always read the last 5 migration files before writing a new one.
Confidence: high
```

### Bad Reflection Examples (Do Not Write These)

```
I did okay at the task. It was kind of complex.
Next time I should be more careful.
Confidence: medium
```

Why bad: "be more careful" is not actionable. No specific reason for the outcome. Cannot be acted on by a future skill loading this file.

```
I succeeded because I am good at code.
```

Why bad: No transferable lesson. Causation is not traced. Useless as a retrieval artifact.

### Decomposing Into Lessons

The verbal reflection maps to the `lessons` array in the experience entry. Decompose the "Next time I should..." clause into one or more concrete lesson strings:

Reflection: "Next time I should check for existing runtime patterns before writing new polling infrastructure and validate attachment handling with explicit count checks."

Lessons array:
```json
[
  "Check for existing runtime patterns (e.g. poller_runtime.py) before writing new polling infrastructure from scratch.",
  "Add explicit attachment count validation after every sync operation; do not rely on downstream error detection."
]
```

---

## Experience Entry Format Reference

Full schema defined in `blackboard-schema.md`. Key fields for micro-reflections:

```json
{
  "task_type": "bug | feature | refactor | investigation | configuration | documentation | test | deploy",
  "description": "1-2 sentence summary of what was attempted",
  "approach": "How the task was approached — tools, strategies, sequence of steps",
  "outcome": "success | partial | failure",
  "lessons": [
    "Concrete, actionable takeaway derived from the verbal RL reflection",
    "Each lesson string must be specific enough to act on without further context"
  ],
  "complexity_estimated": "trivial | low | medium | high | very_high",
  "complexity_actual": "trivial | low | medium | high | very_high",
  "capabilities_used": ["ftm-executor", "mcp__mcp-atlassian-personal__jira_get_issue", "backend-architect"],
  "tags": ["python", "slack", "database", "auth"],
  "confidence": "low | medium | high",
  "recorded_at": "ISO8601 timestamp"
}
```

Written to: `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json`

After writing the file, append a metadata entry to `experiences/index.json` and increment `total_count`.

---

## Pattern Promotion Thresholds

Patterns are promoted from individual experience files into `patterns.json` when the same lesson has been independently observed enough times to be considered reliable.

| Occurrences | Action | Confidence Level |
|---|---|---|
| 1–2 | Stay in experience files only | — |
| 3 | Promote to `patterns.json` | `low` |
| 5+ | Raise confidence | `medium` |
| 8+ | Raise confidence | `high` |

### How to Detect Promotion Candidates

After writing an experience entry:

1. Read `experiences/index.json`
2. Find all entries where `task_type` matches AND at least one `tag` overlaps with the new entry
3. Load those experience files
4. Compare `lessons` arrays across all loaded files — look for thematic overlap (same root cause, same fix pattern, same constraint)
5. If 3+ entries share a lesson theme, the theme is ready to be promoted

Promotion writes to the appropriate category in `patterns.json`:
- `codebase_insights` — observations about the codebase structure, conventions, or tech choices
- `execution_patterns` — what approaches work or fail for specific task types
- `user_behavior` — observed user preferences, correction patterns, approval expectations
- `recurring_issues` — problems that keep appearing, with their symptoms and known resolutions

---

## Pattern Decay Rules

Patterns that are not reinforced within 30 days become less reliable. Apply decay when reading `patterns.json` during any blackboard operation:

| Current Confidence | Days Since `last_reinforced` | Action |
|---|---|---|
| `high` | > 30 days | Reduce to `medium` |
| `medium` | > 30 days | Reduce to `low` |
| `low` | > 30 days | Remove from `patterns.json` |

Decay is applied in-place: read `patterns.json`, compute which entries have expired, reduce or remove them, write the file back.

Do not decay entries that have been reinforced recently — `last_reinforced` is updated each time a new experience confirms the same pattern.

---

## How the Mind Uses Reflexion During Orient

Orient is the second phase of the OODA loop (Observe → Orient → Decide → Act). It is where the mind interprets current context and forms a plan. Reflexion inserts prior experience directly into Orient:

```
Orient Phase Protocol:

1. Read experiences/index.json
2. Filter by current task_type + tag overlap
3. Load top 3–5 experience files (most recent first; prefer confidence: high)
4. Read patterns.json → filter patterns relevant to the current task domain
5. Apply decay to any patterns with last_reinforced > 30 days
6. Synthesize a prior-experience summary:
   - List the most relevant lessons from loaded experiences
   - Note any patterns that apply (from patterns.json)
   - Flag any recurring issues that match the current task's context
7. Use this summary as the first input when forming the execution plan
```

The synthesis does not need to be formal. A short bullet list of 3–5 observations from past experience is sufficient. The goal is to surface "things that have gone wrong before in situations like this" before committing to an approach.

### Retrieval Priority

When loading experience files, prioritize in this order:
1. `confidence: "high"` entries over `"medium"` over `"low"`
2. `outcome: "success"` for positive lessons (what to repeat)
3. `outcome: "failure"` for cautionary lessons (what to avoid)
4. Most recent `recorded_at` as tiebreaker

Load both success and failure experiences — learning what not to do is as valuable as learning what works.

---

## Cold-Start Behavior

The blackboard starts empty. During the first ~10 interactions (`total_count < 10` in `index.json`):

- Record EVERY completed task, even trivial ones
- Set `confidence: "low"` on all entries — they have not been cross-validated
- Prioritize breadth of recording over depth of analysis — getting entries into the index quickly is more valuable than perfect lesson articulation
- Do not skip recording because a task "was simple" — even trivial tasks reveal conventions and constraints that are useful context

The cold-start window is how the system bootstraps its memory. By the 10th interaction, retrieval should already be returning context that reduces repeated mistakes.

---

## Quick Reference

| Concept | Rule |
|---|---|
| When to reflect | After every trigger event — do not wait for retro |
| Reflection format | "I [outcome] at [task] because [reason]. Next time: [adjustment]. Confidence: [level]." |
| Experience file location | `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` |
| Schema reference | `blackboard-schema.md` section 3 |
| Promotion threshold | 3+ occurrences → `low` confidence; 5+ → `medium`; 8+ → `high` |
| Decay window | 30 days without reinforcement → reduce confidence one level; at `low` → remove |
| Orient integration | Load 3–5 matching experiences + relevant patterns before forming any plan |
| Cold-start rule | Record everything until `total_count >= 10`, all at `confidence: "low"` |
