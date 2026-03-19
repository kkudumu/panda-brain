---
name: ftm-dashboard
description: Session and weekly analytics dashboard for the FTM skill ecosystem. Reads events.log and blackboard state to show skills invoked, plans presented, approval rates, experiences recorded, and patterns promoted. Use when user says "dashboard", "analytics", "stats", "ftm-dashboard", "show session stats", or "how's the system doing".
---

# FTM Dashboard

Provides analytics about FTM system usage by reading the event log and blackboard state.

## Commands

### `/ftm-dashboard` (default: current session)

Shows stats for the current session:

```
━━━━━━━━━━━ FTM Session Dashboard ━━━━━━━━━━━

Session started: [timestamp]
Duration: [hours:minutes]

Skills Invoked:
  ftm-mind      ████████████  12
  ftm-debug     ████          4
  ftm-executor  ██            2
  ftm-brainstorm █            1

Plans:
  Presented: 5
  Approved: 4 (80%)
  Modified before approval: 2
  Saved as playbook: 1

Experiences Recorded:
  Total: 8
  From LLM: 5 (rich)
  From git hook: 3 (minimal)

Patterns:
  Active: 12
  Reinforced this session: 3
  Aging (>30 days): 2
  Decayed: 0

Context Budget:
  Orient mode: Full (conversation ~25% used)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### `/ftm-dashboard week`

Shows aggregate stats for the past 7 days:

```
━━━━━━━━━━ FTM Weekly Dashboard ━━━━━━━━━━━━━

Period: [date] — [date]

Tasks by Complexity:
  Micro:  ██████████████████  18
  Small:  ████████████        12
  Medium: ██████              6
  Large:  ██                  2

Top Skills:
  1. ftm-mind (45 invocations)
  2. ftm-executor (12 invocations)
  3. ftm-debug (8 invocations)
  4. ftm-brainstorm (6 invocations)
  5. ftm-audit (4 invocations)

Playbooks:
  Created: 2
  Reused: 3
  Parameterized: 0

Learning:
  Experiences recorded: 38
  Patterns promoted: 1
  Patterns decayed: 0
  Sizing corrections: 0

Approval Rate: 85% (34/40 plans approved on first presentation)
Average plan modifications: 1.2 per plan

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Data Sources

### events.log (`~/.claude/ftm-state/events.log`)
- JSONL format, one entry per line
- Each entry has: timestamp, event_type, tool_name, session_id, skill_context
- Filter by session_id for current session, by date range for weekly

### Blackboard State
- `~/.claude/ftm-state/blackboard/context.json` — current session metadata
- `~/.claude/ftm-state/blackboard/experiences/index.json` — experience counts and types
- `~/.claude/ftm-state/blackboard/patterns.json` — pattern health

### Playbooks (`~/.ftm/playbooks/`)
- Count `.yml` files for total playbooks
- Check `use_count` field for reuse stats
- Check `parameterized` field for parameterization stats

## Implementation

1. Read the relevant data sources
2. Compute aggregates
3. Render as markdown tables with ASCII bar charts
4. Output directly — no approval gates needed (read-only operation)

## Rendering

- Use Unicode block characters for bar charts: █ ▓ ░
- Tables in markdown format for terminal rendering
- Keep output concise — one screen max
- If data sources are empty (fresh install), show: "No data yet. Use FTM for a few sessions and check back."

## Events

### Listens To
- `task_completed` — for session stats tracking

### Blackboard Read
- `context.json` — session metadata
- `experiences/index.json` — experience inventory
- `patterns.json` — pattern health
