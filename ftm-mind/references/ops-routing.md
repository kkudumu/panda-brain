# Ops Routing — ftm-ops Triggers & Communication Drafts Protocol

## When to Route to ftm-ops

Route to `ftm-ops` when the request matches any of the following patterns:

### Task Management
- "what's on my plate", "what tasks", "my tasks", "add task", "update task", "complete task", "mark done"

### Capacity & Burnout
- "am I overcommitted", "capacity", "burnout", "how much bandwidth", "can I take this on"

### Stakeholders
- "stakeholder", "who needs to know", "follow up with", "notify"

### Meetings
- "meeting notes", "transcript", "action items from", "what came out of"

### Incidents
- "incident", "outage", "postmortem", "pagerduty", "on-call"

### Recurring Patterns
- "recurring issue", "keeps happening", "pattern", "documentation gap"

### Daily & Weekly
- "wrap up", "what happened today", "weekly summary", "end of day", "eod", "what did I do"

### Blocking
- "what's blocking me", "blockers", "stuck on", "unblocked"

## Communication Drafts Protocol

**ALWAYS follow this when writing any comms draft (Slack message, email, status update, escalation):**

Write the file FIRST — before showing any draft content in chat. The file must exist before outputting the draft.

1. Determine filename: `[recipient]-[topic]-[YYYY-MM-DD].md`
2. Write the file to `~/.claude/ftm-ops/drafts/` using the Write tool — this happens BEFORE anything else
3. Include metadata at top: Date, Channel, To
4. Return the full file path in chat, then show the draft content
5. Treat as a living document — update in place for revisions, do not create new files

Example path returned in chat:
`~/.claude/ftm-ops/drafts/nik-structure-licensing-2026-02-19.md`

**Wrong order:** Draft in chat → maybe save later
**Right order:** Write file → return path → show content
