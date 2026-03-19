# Progress Tracking — PROGRESS.md Template and Update Rules

## Enabling Progress Tracking

If `progress_tracking` is enabled in `~/.claude/ftm-config.yml` (default: true), create `PROGRESS.md` in the project root at the start of Phase 3.5.

## Initial File Template

Create the file with this structure, filling in plan details:

```markdown
# FTM Executor — Progress

**Plan:** [plan title]
**Started:** [timestamp]
**Status:** IN PROGRESS

## Execution Summary
| Wave | Tasks | Status | Started | Completed |
|------|-------|--------|---------|-----------|
| 1 | [task list] | PENDING | — | — |
| 2 | [task list] | PENDING | — | — |
| ... | | | | |

## Task Status
| # | Title | Agent | Status | Audit | Notes |
|---|-------|-------|--------|-------|-------|
| 1 | [title] | [agent] | PENDING | — | |
| 2 | [title] | [agent] | PENDING | — | |
| ... | | | | | |

## Activity Log
[reverse chronological — newest first]
```

## Update Events

Update PROGRESS.md at these events:

- **Wave starts** → update wave status to `IN PROGRESS`, add timestamp to Started column
- **Task agent returns** → update task status to `COMPLETE` or `FAILED`, add audit result
- **Wave completes** → update wave status to `COMPLETE`, add timestamp to Completed column
- **Merge completes** → add to activity log
- **Errors/blockers** → add to activity log with details

## Activity Log Format

Each entry uses this format:
```
### [HH:MM] [event type]
[brief description]
```

Example entries (newest first):
```
### 14:32 Wave 1 complete
Tasks 1-4 merged to main. All audits passed. 2 auto-fixes applied.

### 14:15 Task 3 audit — auto-fix
Added missing import for UserPreferences in SettingsView.tsx

### 13:45 Wave 1 started
Dispatching 4 agents in parallel: frontend (tasks 1,2), backend (task 3), testing (task 4)
```

This file is for human consumption — the user can check it at any time without interrupting execution. Keep entries concise and informative.
