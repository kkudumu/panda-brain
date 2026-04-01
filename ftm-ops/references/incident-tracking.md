# Incident Lifecycle Protocol

Manages incident opening, timeline tracking, root cause analysis, and follow-up actions. Delegates persistence to brain.py `--incident-add` and `--incident-list`.

---

## Opening an Incident

When user reports a production issue, outage, or significant failure:

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --incident-add \
  --title "Brief incident name" \
  --severity critical|high|medium|low \
  --status investigating \
  --started YYYY-MM-DDTHH:MM \
  --systems "system1,system2" \
  --impact "Brief impact description"
```

Also create a file: `~/.claude/ftm-ops/incidents/YYYY-MM-DD-incident-name.md`  
And update the index: `~/.claude/ftm-ops/incidents/incident-index.md`

---

## Incident File Structure

```markdown
# Incident: [Name/Description]
**Date**: YYYY-MM-DD
**Duration**: [Start] — [End] (Total: X hours)
**Severity**: Critical / High / Medium / Low
**Status**: Investigating / Mitigated / Resolved

## Impact
- Users affected: [number/percentage]
- Systems affected: [list]
- Business impact: [revenue, reputation, SLA breach, etc.]

## Timeline
- **HH:MM** — Initial detection: [how detected]
- **HH:MM** — [Action taken]
- **HH:MM** — [Key finding]
- **HH:MM** — Mitigation applied: [what]
- **HH:MM** — Resolved

## Root Cause
[Fill in when known — do not guess during active incident]

## Mitigation Steps
1. [What was done to fix]
2. [Temporary vs permanent fixes noted]

## People Involved
- On-call: [name]
- Incident commander: [name]
- Contributors: [names]

## Follow-up Actions
- [ ] Write postmortem — Owner: [name] — Due: [date]
- [ ] Implement permanent fix — Owner: [name] — Due: [date]
- [ ] Update runbook — Owner: [name] — Due: [date]
- [ ] Add monitoring — Owner: [name] — Due: [date]

## Related
- Similar incidents: [links to other incident files]
- Related systems: [system names]
- Documentation: [runbook links]
```

---

## Incident Index Structure

`~/.claude/ftm-ops/incidents/incident-index.md`:

```markdown
# Incident Index

## Active Incidents
- **[Incident Name]** — Started: YYYY-MM-DD HH:MM — Severity: [level] — [Status]

## Recent Incidents (Last 30 days)
- YYYY-MM-DD: [Incident] — Duration: X hours — Severity: [level] — [One line summary]

## Incident Patterns
- **Auth service**: 3 incidents this month (pattern: Monday mornings)
- **Database**: 2 connection timeout incidents (pattern: high load)

## By System
### [System Name]
- YYYY-MM-DD: [Incident name] — [severity]
```

---

## Active Incident Protocol

During an active incident, prioritize speed and clarity:

1. **Log the incident immediately** — even sparse details are better than nothing
2. **Track timeline entries in real time** — add `HH:MM — [what happened]` as events unfold
3. **Don't diagnose root cause yet** — focus on mitigation first
4. **Surface relevant past incidents** — check incident-index for the affected system
5. **Track who's involved** — on-call, commander, SMEs
6. **Draft stakeholder update** if duration >30 min (follow comms drafts protocol)

---

## Root Cause Analysis

After mitigation, before closing:

1. Ask: What was the proximate cause? What were the contributing factors?
2. Consider: Was this preventable? Has it happened before?
3. Link to `patterns/recurring-issues.md` if this is a repeat
4. Identify: What monitoring would have caught this earlier?
5. Propose 3-5 follow-up actions with owners and deadlines

**Root cause depth check:**
- Did you answer "why" at least 3 levels deep?
- Is the fix addressing root cause or just symptoms?
- Is there a systemic change that prevents recurrence?

---

## Listing and Querying Incidents

```bash
# List all incidents
python3 ~/.claude/skills/ftm/bin/brain.py --incident-list

# Check for patterns on a specific system
grep -i "auth\|authentication" ~/.claude/ftm-ops/incidents/incident-index.md
```

When user asks "what happened with [system]" or "have we seen this before":
1. Query brain.py incident list
2. Grep the incident index for the system name
3. Load matching incident files for detail
4. Summarize pattern if 2+ similar incidents exist

---

## Pattern Linkage

After resolving any incident:
1. Check `patterns/recurring-issues.md` — has this happened before?
2. If yes: update the recurring issues count, link this incident
3. If this is 2nd occurrence in 30 days: trigger pattern recognition alert
4. If postmortem action items include documentation: flag in documentation gaps

---

## Follow-up Actions Tracking

Convert incident follow-ups to tasks:

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --followup-add \
  --stakeholder "Team / Person" \
  --topic "Incident follow-up: [action]" \
  --due YYYY-MM-DD \
  --priority high
```

Track postmortem writing as a task — it should be done within 48 hours of resolution for significant incidents.

---

## What to Avoid

- Never write the root cause during an active incident — focus on mitigation
- Never close an incident without follow-up actions logged
- Never skip linking to similar incidents — patterns matter
- Never let incident follow-ups fall through — add them to task list immediately
