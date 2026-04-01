# Daily & Weekly Narrative Analysis Protocol

Produces data-backed narrative summaries of the day or week. Reads daily/weekly files, synthesizes patterns, surfaces open items, and gives the user a clear picture of where things stand.

---

## Daily Wrap-up Protocol

**Triggers**: "wrap up", "daily summary", "what happened today", "end of day", "EOD"

### Steps

1. **Get today's date**: `date +%Y-%m-%d`
2. **Read today's daily file**: `~/.claude/ftm-ops/daily/YYYY-MM-DD.md`
3. **Pull open tasks from brain.py**: `--tasks --task-json`
4. **Check follow-ups**: `--followup-list --overdue`
5. **Analyze capacity signals**: context switches, hours worked, unplanned work count
6. **Check blocker status**: `~/.claude/ftm-ops/dependencies/active-blockers.md`
7. **Write narrative summary** (see format below)
8. **Log capacity entry** via brain.py `--capacity-log`
9. **Update daily-index.md** with today's entry

### Daily Narrative Format

```
## Daily Wrap-up — [Day, Date]

**The Day in 3 Lines**
[1-3 sentence plain-language summary of what happened — tone of a peer debriefing]

**Completed**
- [Item] — [brief impact note]

**Still Open**
- [Item] — [status / why still open]

**Blockers**
- [Blocker] — Age: [N days] — [Next action]

**Patterns Noticed**
- [Any recurring issues, questions, or signals worth flagging]

**Capacity**
- Hours: [N] | Context switches: [N] | Status: [Green/Warning/Alert]

**Tomorrow's Setup**
- Priority 1: [task]
- Priority 2: [task]
- Watch for: [any upcoming deadlines or dependencies]
```

**Tone**: Supportive but honest. If it was a hard day, say so. If something looks concerning, name it directly. Don't sugarcoat capacity problems.

---

## Weekly Rollup Protocol

**Triggers**: "weekly rollup", "what happened this week", "week in review", "weekly summary", end of week

### Steps

1. **Get current week**: `date +%Y-W%V`
2. **Read weekly summary**: `~/.claude/ftm-ops/weekly/YYYY-WNN.md`
3. **Pull all tasks completed this week** from brain.py
4. **Pull patterns from this week**: `--pattern-list`
5. **Pull incidents from this week**: `--incident-list`
6. **Check capacity trend**: compare this week vs last week's weekly file
7. **Identify themes**: what dominated the week? (incidents, planned work, comms, unplanned requests)
8. **Write rollup narrative** (see format below)
9. **Update weekly file** with rollup section

### Weekly Rollup Format

```
## Week in Review — [Week Number, Date Range]

**Theme of the Week**
[1-2 sentences: what dominated your time and attention]

**Completed**
- [Item] — [impact]

**Still In Progress**
- [Item] — [status, ETA]

**Blockers Carried Over**
- [Blocker] — Age: [N days] — [Escalation status]

**Incidents**
- [Incident] — Duration: [N hours] — Status: [Resolved/Open]

**Patterns Detected**
- [Pattern] — Count: [N] — [Suggested action taken/pending]

**Capacity**
- Hours this week: [N] | Context switches: [N] | Weekend work: [Yes/No]
- Status: [Green / Warning / Alert]
- Trend: [Improving / Stable / Worsening vs last week]

**Wins**
- [Something completed, unblocked, or improved]

**Next Week Setup**
- Top priority: [task]
- Watch for: [deadline, dependency, or risk]
- Intention: [one word or phrase for the week — "stabilize", "ship", "catch up"]
```

---

## Weekly File Structure

The weekly file at `~/.claude/ftm-ops/weekly/YYYY-WNN.md` should accumulate throughout the week:

```markdown
# Weekly Summary — YYYY Week NN

## Open Action Items (Rolled from daily)
- [ ] [Task] — Owner — Deadline — Origin: [which daily/meeting]

## Active Blockers
- [Blocker] — Impact: [what's blocked]

## Completed
- [Item] — Impact

## Key Decisions Made
- [Decision] — Rationale — Date

## Systems & Projects Status
- **[System/Project]**: [Status] — [Key updates]

## Patterns & Insights
- [Observations about recurring issues, improvements needed]
```

---

## Daily File Structure

`~/.claude/ftm-ops/daily/YYYY-MM-DD.md`:

```markdown
# Daily Log — YYYY-MM-DD (Day Name)

## Today's Focus
- [ ] Primary task
- [ ] Secondary task

## Completed
- [x] Task — outcome notes

## Meetings & Notes
### Meeting Name — HH:MM
- Attendees: [names]
- Decisions: [key decisions]
- Action items: [who — what — when]
- Open questions: [questions]

## Requests & Communications
- **From [Name]** via [Slack/Email] — [Request] — Status: [Pending/Done]

## Context Switches
### Project/System Name
- What I was doing: [context]
- Where I left off: [state]
- Next steps: [what's next]

## Blockers & Issues
- [Description] — Waiting on: [what/who]

## Things to Remember
- [Insights, decisions, patterns noticed]
```

---

## Daily Index Update (Mandatory)

Every time a new daily file is created, immediately append to `daily/daily-index.md`:

```
### YYYY-MM-DD (DayName)
tags: [system names, people, incident type, task numbers, topic types]
summary: [1-2 sentences: what happened, key decisions, completions, blockers]
```

Update the `Last updated:` date at top of daily-index.md.

**Tag guidelines**: system names (okta, jira, freshservice), people (first-last), topics (incident, PTO, migration, blockers-cleared), task refs (ITWORK2-XXXX).

---

## Narrative Quality Standards

A good daily wrap-up:
- Reads like a colleague debriefing you, not a report
- Names capacity concerns directly if present
- Surfaces tomorrow's setup so context is preserved
- Is written, not just shown in chat — append to daily file

A good weekly rollup:
- Identifies the theme of the week, not just a list of events
- Compares capacity trend to prior week
- Names wins explicitly — they're easy to overlook
- Ends with a clear intention for next week

---

## What to Avoid

- Never generate a wrap-up without reading the actual daily file
- Never skip the capacity log after a daily wrap-up
- Never produce a list without the narrative context around it
- Never end a wrap-up without "tomorrow's setup" — that's the most useful part
