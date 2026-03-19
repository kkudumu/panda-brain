# FTM-Mind Blackboard Schema Reference

**Location**: `~/.claude/ftm-state/blackboard/`
**Purpose**: Shared persistent memory for the ftm-mind unified intelligence system. Skills read from and write to these files using the Read and Write tools directly — no code libraries, no APIs.

---

## Source of Truth Matrix

Each file has a single, non-overlapping responsibility. Never duplicate information across files.

| File / Location | Owns | Never Contains |
|---|---|---|
| `blackboard/context.json` | Active session state — current task, decisions made this session, live constraints, user prefs | Cross-session learnings, historical patterns |
| `blackboard/experiences/` | Cross-session learnings recorded after task completion | Current session state, live constraints |
| `blackboard/patterns.json` | Promoted meta-insights distilled from multiple experiences | Raw individual experiences, session state |
| `blackboard/experiences/index.json` | Index of all experience files (titles, tags, types, paths) | Full experience content |
| `STATE.md` | Pause/resume snapshots (ftm-pause / ftm-resume) | Anything not related to pausing a session mid-stream |
| `PROGRESS.md` | Executor wave progress during multi-agent runs | Session state, historical learnings |
| `DEBUG.md` | Debug session traces from ftm-debug | Non-debug information |
| `INTENT.md` | Codebase contract documents (API shapes, invariants) | Session state, learnings |

---

## 1. context.json

**Path**: `~/.claude/ftm-state/blackboard/context.json`
**Role**: Single source of truth for what is happening RIGHT NOW in the active session. Overwritten frequently — treat every write as a full replacement of the file.

### Full Schema

```json
{
  "current_task": {
    "id": "string | null",
    "description": "string | null",
    "type": "string | null",
    "started_at": "ISO8601 timestamp | null",
    "status": "pending | in_progress | blocked | complete | null"
  },
  "recent_decisions": [
    {
      "decision": "string — what was decided",
      "reasoning": "string — why this choice was made",
      "timestamp": "ISO8601 timestamp",
      "task_id": "string | null — links back to current_task.id if applicable"
    }
  ],
  "active_constraints": [
    {
      "constraint": "string — description of the constraint",
      "source": "string — where it came from (e.g. user, skill-name, inferred)",
      "expires_at": "ISO8601 timestamp | null — null means indefinite"
    }
  ],
  "user_preferences": {
    "communication_style": "string | null — e.g. terse, detailed, bullet-first",
    "approval_gates": "string | null — e.g. ask_before_write, ask_before_commit, never",
    "default_model_profile": "string | null — e.g. fast, balanced, thorough"
  },
  "session_metadata": {
    "started_at": "ISO8601 timestamp | null",
    "last_updated": "ISO8601 timestamp | null",
    "conversation_id": "string | null",
    "messages_count": "integer",
    "skills_invoked": ["array of skill name strings invoked this session"]
  }
}
```

### Field Notes

- **`current_task.id`**: Use a short slug, e.g. `"refactor-auth-flow"` or `"debug-poller-crash"`. Does not need to be globally unique — it scopes within the session.
- **`current_task.type`**: Free-form but aim for consistency: `feature`, `bug`, `refactor`, `investigation`, `configuration`, `documentation`, `test`, `deploy`.
- **`recent_decisions`**: Cap at 10 entries. When adding an 11th, drop the oldest. This is a rolling window, not a history log.
- **`active_constraints`**: Anything that limits what the system can do — e.g. "do not modify production DB", "user wants no auto-commits". Remove expired entries on each write.
- **`user_preferences`**: Populated from observation or explicit instruction. Skills should read this before deciding how verbose to be or whether to ask for approval.
- **`session_metadata.skills_invoked`**: Append skill names as they are activated. Used for retrospectives and debugging.

### Write Convention

Always read the file first, apply your changes to the parsed object in memory, then write the entire file back. Never write partial JSON.

---

## 2. patterns.json

**Path**: `~/.claude/ftm-state/blackboard/patterns.json`
**Role**: Promoted meta-insights. An entry here means the same thing has been observed across multiple sessions and is considered reliable enough to act on without re-deriving it each time.

### Full Schema

```json
{
  "codebase_insights": [
    {
      "insight": "string — the observation about the codebase",
      "file_pattern": "string — glob or path description, e.g. 'src/**/*.ts' or 'bin/poller*.py'",
      "confidence": "low | medium | high",
      "last_seen": "ISO8601 timestamp",
      "occurrences": "integer — how many times this was independently observed"
    }
  ],
  "execution_patterns": [
    {
      "pattern": "string — description of the recurring execution approach",
      "context": "string — what situation triggers this pattern",
      "outcome": "string — what typically results",
      "confidence": "low | medium | high",
      "occurrences": "integer",
      "last_reinforced": "ISO8601 timestamp"
    }
  ],
  "user_behavior": [
    {
      "behavior": "string — description of the observed user behavior or preference",
      "frequency": "rarely | sometimes | usually | always",
      "context": "string — when or under what conditions this behavior appears",
      "confidence": "low | medium | high"
    }
  ],
  "recurring_issues": [
    {
      "issue": "string — short title for the issue",
      "symptoms": "string — what it looks like when it occurs",
      "root_cause": "string | null — the underlying reason, if known",
      "resolution": "string | null — how to fix or work around it",
      "occurrences": "integer",
      "last_seen": "ISO8601 timestamp"
    }
  ]
}
```

### Promotion Threshold

A pattern should be promoted into patterns.json only after it has appeared in at least 2 separate experience files (different dates, different task slugs). A single observation belongs in an experience file, not here. Use `confidence: "low"` for newly promoted patterns with only 2 occurrences; raise to `"medium"` at 4+, `"high"` at 8+.

### Write Convention

patterns.json is written infrequently — typically at the end of a session or after multiple experiences are reviewed. Read it, merge new insights, and write the full file back.

---

## 3. Experience Files

**Directory**: `~/.claude/ftm-state/blackboard/experiences/`
**Role**: Durable cross-session learnings, one file per completed task or significant interaction.

### File Naming Convention

```
YYYY-MM-DD_task-slug.json
```

Examples:
- `2026-03-17_refactor-auth-flow.json`
- `2026-03-17_debug-slack-poller-crash.json`
- `2026-03-18_add-freshservice-enrichment.json`

The task slug should be lowercase kebab-case, derived from `current_task.id` or the task description. If two tasks share a date and slug (rare), append a short suffix: `2026-03-17_refactor-auth-flow-2.json`.

### Experience Entry Schema

```json
{
  "task_type": "string — matches current_task.type vocabulary: feature | bug | refactor | investigation | configuration | documentation | test | deploy",
  "description": "string — 1-2 sentence summary of what was attempted",
  "approach": "string — how the task was approached: tools used, strategies employed, sequence of steps",
  "outcome": "success | partial | failure",
  "lessons": [
    "string — each lesson is a concrete, actionable takeaway",
    "string — avoid vague statements like 'be more careful'; prefer 'check X before doing Y'"
  ],
  "time_taken": "string | null — approximate duration, e.g. '12 minutes', '2 hours'",
  "complexity_estimated": "trivial | low | medium | high | very_high",
  "complexity_actual": "trivial | low | medium | high | very_high",
  "capabilities_used": [
    "string — skill names, MCP tools, or agent types that were activated"
  ],
  "tags": [
    "string — searchable labels, e.g. 'python', 'slack', 'database', 'auth', 'poller'"
  ],
  "confidence": "low | medium | high",
  "recorded_at": "ISO8601 timestamp"
}
```

### Field Notes

- **`outcome`**: Use `partial` when the core task completed but side effects failed or follow-up is needed. Use `failure` only when the primary objective was not achieved.
- **`lessons`**: The most important field. Write at least one lesson per experience. Make it specific enough that a future skill loading this file can act on it without further context.
- **`complexity_estimated` vs `complexity_actual`**: Track both so the system can learn when its estimates are systematically off. If they diverge by more than one level, note why in `approach` or `lessons`.
- **`capabilities_used`**: Include skill names (e.g. `ftm-executor`, `ftm-debug`), MCP server names (e.g. `mcp__mcp-atlassian-personal__jira_get_issue`), and agent types (e.g. `backend-architect`).
- **`confidence`**: Reflects how certain you are that the lessons are generalizable. A one-off issue warrants `low`; a pattern confirmed multiple times within the session warrants `high`.

---

## 4. experiences/index.json

**Path**: `~/.claude/ftm-state/blackboard/experiences/index.json`
**Role**: Lightweight index for fast retrieval. Never contains full experience content — only enough metadata to decide which files to load.

### Full Schema

```json
{
  "entries": [
    {
      "filename": "YYYY-MM-DD_task-slug.json",
      "task_type": "string",
      "tags": ["array", "of", "tags"],
      "outcome": "success | partial | failure",
      "confidence": "low | medium | high",
      "recorded_at": "ISO8601 timestamp"
    }
  ],
  "metadata": {
    "total_count": "integer",
    "last_updated": "ISO8601 timestamp | null",
    "max_entries": 200,
    "pruning_strategy": "remove_oldest_low_confidence"
  }
}
```

### Pruning Rules

When `total_count` exceeds `max_entries` (200):
1. Collect all entries where `confidence == "low"`.
2. Sort by `recorded_at` ascending (oldest first).
3. Delete index entries and their corresponding files until `total_count` is back under 200.
4. If all low-confidence entries are removed and the count is still over 200, repeat the process with `confidence == "medium"`, oldest first.
5. Never delete `confidence == "high"` entries through automatic pruning.

---

## 5. Retrieval Protocol

When a skill needs to consult past experience before acting:

1. **Read** `experiences/index.json`.
2. **Filter** entries where `task_type` matches the current task type OR there is at least one tag overlap with the current task's tags.
3. **Sort** filtered results by `recorded_at` descending (most recent first).
4. **Load** the top 3–5 matching experience files by reading each `filename` from the `experiences/` directory.
5. **Synthesize** lessons from loaded files to inform the current approach. Prefer lessons from `confidence: "high"` or `outcome: "success"` entries.
6. If no matches are found, proceed without historical context (see Cold Start section).

---

## 6. Cold Start Protocol

The blackboard starts empty. Empty is not broken — it is the normal starting state.

When `experiences/index.json` has `total_count == 0` or `entries == []`:

- **Do not enter a degraded mode.** The system has full capability.
- **Do not warn the user** that there is no historical context unless directly asked.
- **Proceed with full confidence**, relying on the current session context and skill instructions.
- **Record experiences aggressively** during the first ~10 interactions. Every completed task, even trivial ones, should produce an experience file. This is how the system bootstraps its memory.
- **Set `confidence: "low"` on early experiences** — they have not been cross-validated yet. Promote to `"medium"` or `"high"` as patterns recur.

The goal of the cold start window is to populate the blackboard fast enough that by the 10th interaction, retrieval is already returning useful context.

---

## 7. Concurrency Rules

Multiple executor agents may run in parallel during a ftm-executor wave. To prevent index corruption:

- **Single-writer model for index.json**: Only the orchestrator (the coordinating skill, not individual executor agents) writes to `index.json`.
- **Executor agents write individual experience files only.** Each executor writes its own `YYYY-MM-DD_task-slug.json` file using a unique slug derived from its task ID. Because filenames are unique, parallel writes to different files are safe.
- **After wave completion**, the orchestrator reads all newly created experience files, merges their metadata entries into `index.json`, updates `total_count` and `last_updated`, and writes `index.json` once.
- **context.json** is session-scoped and is written only by the primary coordinating agent for that session. Executors do not write context.json.
- **patterns.json** is written only during post-session review or by an explicit pattern-promotion step, never during active execution.

---

## 8. Read/Write Conventions for Skills

### Reading

Always use the Read tool with the absolute path:

```
Read: ~/.claude/ftm-state/blackboard/context.json
```

Parse the JSON content mentally before acting on it. If the file is empty or malformed, treat it as if all fields are null/empty and proceed without crashing.

### Writing

Always:
1. Read the current file first.
2. Apply your changes to the parsed content.
3. Write the complete, valid JSON back using the Write tool.

Never write partial files or append to JSON files. Every write is a full replacement.

Use absolute paths:

```
Write: ~/.claude/ftm-state/blackboard/context.json
Write: ~/.claude/ftm-state/blackboard/patterns.json
Write: ~/.claude/ftm-state/blackboard/experiences/index.json
Write: ~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json
```

### Validation Before Writing

Before writing, verify:
- All required fields are present (nulls are acceptable, missing keys are not).
- Arrays are arrays, objects are objects — no type mismatches.
- Timestamps are ISO8601 strings or null, never integers.
- `recent_decisions` in context.json has at most 10 entries.
- `entries` in index.json matches `metadata.total_count`.

---

## 9. Quick Reference: Key Paths

| What | Absolute Path |
|---|---|
| Session state | `~/.claude/ftm-state/blackboard/context.json` |
| Meta-patterns | `~/.claude/ftm-state/blackboard/patterns.json` |
| Experience index | `~/.claude/ftm-state/blackboard/experiences/index.json` |
| Experience files | `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_slug.json` |
| This document | `~/.claude/skills/ftm-mind/references/blackboard-schema.md` |
