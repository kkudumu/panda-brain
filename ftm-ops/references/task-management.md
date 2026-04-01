# Task Management Protocol

Handles all task CRUD, prioritization, and TaskCreate surfacing. All persistence goes through brain.py.

---

## Reading Tasks

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --tasks --task-json
```

Parse JSON output. Present as prioritized list — never dump raw JSON to the user.

**Fallback**: If brain.py fails, read `~/.claude/ftm-ops/active-tasks.md`.

Inform user: "Loaded X tasks from tasks.db" (or "Loaded from fallback file").

---

## Task Prioritization

After loading tasks, sort by this priority matrix:

| Priority | Criteria |
|---|---|
| **Now** | Deadline today, blocking others, on-call/incident |
| **Today** | Deadline this week, high impact, low effort |
| **This Week** | Scheduled, medium impact |
| **Parking Lot** | Low priority, speculative, waiting on others |

When capacity is tight (>85%), proactively suggest deferring parking lot items.

**Output format:**
```
## Today's Focus — [Date]
**Now (Next 2 hours):**
- [ ] [Task] — [Why this first]

**Today:**
- [ ] [Task]

**This Week:**
- [ ] [Task]

**Parking Lot:**
- [ ] [Task] — [Why deferred]
```

---

## Creating Tasks

When user mentions new work, a commitment, or a follow-up that should be tracked:

1. Confirm the task details (title, description, priority, due date if known)
2. Use brain.py to persist — pass `--help` to find the exact add-task flag
3. Announce: "Added '[task title]' to your task list."

**TaskCreate surfacing**: When new work emerges mid-conversation (e.g., user says "I need to also..."), proactively surface it:
> "That sounds like a task. Want me to add it? I'd log it as: '[proposed title]' — priority [suggested]."

Do not add tasks silently. Always confirm with the user before writing.

---

## Closing & Updating Tasks

When user says "done", "mark complete", "close", "finished":

1. Identify the task (ask if ambiguous)
2. Update via brain.py
3. Check if any dependent tasks are now unblocked — surface them
4. Append completion note to today's daily file

---

## Blockers & Dependencies

When a task is blocked:

1. Log the blocker explicitly (what's needed, who owns it)
2. Check `~/.claude/ftm-ops/dependencies/active-blockers.md` for related context
3. Calculate blocker age — flag if >1 week, escalate if >2 weeks
4. Suggest follow-up or escalation path

**Blocker aging alerts:**
- >1 week: "Check-in reminder — this has been blocked for 8 days."
- >2 weeks: "Escalation suggested — 15 days. Who can unstick this?"
- Blocking multiple projects: "Critical dependency — blocking 3 projects."

---

## Follow-ups

Track promised follow-ups via brain.py `--followup-add`.

On every session start, check `--followup-list` for overdue items and surface them:
> "You have 2 follow-ups overdue: [list]. Want to handle these now or defer?"

---

## What to Avoid

- Never dump raw task JSON to the user
- Never add tasks without confirmation
- Never silently skip a follow-up that's overdue
- Never prioritize without checking the current daily file context
