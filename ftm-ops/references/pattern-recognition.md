# Pattern Recognition Protocol

Detects recurring issues, recurring questions, documentation gaps, and alerts the user with data-backed suggestions. Delegates persistence to brain.py `--pattern-add` and `--pattern-list`.

---

## When to Run Pattern Checks

Auto-trigger pattern analysis when:
- User reports solving a problem ("fixed it", "resolved", "sorted out")
- User answers someone else's question
- User mentions re-researching something they've done before
- Multiple signals converge on the same system or topic
- Monday morning session start (weekly pattern check)

---

## 1. Recurring Issues Detection

**Trigger**: User reports solving a problem that sounds familiar.

```bash
# Check for existing pattern
python3 ~/.claude/skills/ftm/bin/brain.py --pattern-list --type issue --keyword "auth timeout"

# Add/update pattern observation
python3 ~/.claude/skills/ftm/bin/brain.py --pattern-add \
  --type issue \
  --title "Database connection timeouts" \
  --occurred YYYY-MM-DD \
  --context "Monday morning after weekend deploy" \
  --fix "Restart connection pool"
```

Also check: `~/.claude/ftm-ops/patterns/recurring-issues.md`

**Alert threshold: 2+ occurrences in 30 days**

Alert format:
> "You've solved [issue] 3 times this month.
> Pattern: Always happens Monday mornings after weekend deployments.
>
> Suggestions:
> 1. Create a runbook (saves ~2 hours per incident)
> 2. Investigate root cause (connection pool size? deployment process?)
> 3. Add monitoring to catch this earlier
>
> What would you like to do?"

**Recurring Issues File Structure** (`patterns/recurring-issues.md`):
```markdown
## High Frequency (3+ times in 30 days)
### [Issue Name] — Count: 5 times
- **Last occurred**: YYYY-MM-DD
- **Pattern**: [When/why it happens]
- **Typical fix**: [What you do each time]
- **Occurrences**: [date — context]
- **Documentation status**: No runbook / Incomplete / Documented
- **Action needed**: [specific next step]
```

---

## 2. Recurring Questions Detection

**Trigger**: User answers a question someone asked them.

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --pattern-add \
  --type question \
  --title "How do I reset the production cache?" \
  --asked-by "Support team" \
  --occurred YYYY-MM-DD \
  --channel "Slack #support"
```

Also update: `~/.claude/ftm-ops/patterns/recurring-questions.md`

**Alert threshold: 3+ occurrences from any combination of people**

Alert format:
> "'How do I reset the production cache?' has been asked 6 times this month.
> Asked by: Support team (3 times), Engineering (3 times)
> Time spent: ~30 minutes each = 3 hours total
>
> Suggestion: Create a runbook with screenshots. Would save 3 hours/month.
> Want me to draft an outline based on your previous explanations?"

Track:
- Who's asking (to identify gaps by team)
- How much time spent answering (estimate if not stated)
- Whether documentation exists already

---

## 3. Documentation Gap Detection

**Trigger**: Multiple signals converge on the same system or topic.

Signals that trigger gap detection:
- Same issue recurring (from recurring-issues patterns)
- Same question being asked (from recurring-questions patterns)
- Multiple people asking about the same system
- User re-researches something they've done before (mentions "I had to look this up again")

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --pattern-add \
  --type doc-gap \
  --system "Auth Service" \
  --evidence "4 recurring issues + 3 people asking about OAuth" \
  --impact "high" \
  --suggested-doc "Auth service runbook"
```

Also update: `~/.claude/ftm-ops/patterns/documentation-gaps.md`

Alert format:
> "Documentation gap detected: Auth Service
>
> Evidence:
> - OAuth flow issue occurred 4 times (recurring-issues)
> - 'How does token refresh work?' asked by 3 people (recurring-questions)
> - You've re-explained this 7 times total
>
> Impact: High — affects 3 teams, ~5 hours wasted this month
>
> Suggestion: Create auth service runbook with:
> - OAuth flow diagram
> - Token refresh troubleshooting
> - Common error codes
> Estimated effort: 2-3 hours
>
> Should I add this to your backlog?"

**Documentation Gaps File Structure** (`patterns/documentation-gaps.md`):
```markdown
## Critical (Affects multiple people/teams)
### [System Name]
- **Gap**: [What's missing]
- **Evidence**: [What triggered detection]
- **Impact**: [Time wasted, people affected]
- **Priority**: High / Medium / Low
- **Estimated effort**: [hours to document]
- **Owner**: [Suggested owner]
```

---

## 4. Pattern Queries

When user asks "have we seen this before" or "is this a pattern":

1. Query brain.py pattern list with keyword
2. Grep `patterns/recurring-issues.md` for system/topic name
3. Check `incidents/incident-index.md` for related incidents
4. Synthesize: "Yes — this has occurred [N] times. Here's the pattern..."

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --pattern-list
grep -i "[keyword]" ~/.claude/ftm-ops/patterns/recurring-issues.md
grep -i "[keyword]" ~/.claude/ftm-ops/incidents/incident-index.md
```

---

## 5. Weekly Pattern Review

Every Monday (or when user says "weekly review"):

1. Pull all patterns from brain.py for last 30 days
2. Surface any that crossed alert thresholds this week
3. Check if previous pattern recommendations were acted on
4. Report: "3 patterns detected this week. 1 crossed the runbook threshold."

---

## Alert Priorities

| Pattern Type | Threshold | Suggested Action |
|---|---|---|
| Recurring issue | 2+ in 30 days | Runbook / Root cause investigation |
| Recurring issue | 3+ in 30 days | Escalate as systemic — add to sprint |
| Recurring question | 3+ occurrences | Create wiki / FAQ entry |
| Recurring question | 5+ occurrences | Schedule knowledge transfer session |
| Documentation gap | Multi-signal | Add to backlog with priority estimate |

---

## What to Avoid

- Never dismiss a recurrence without logging it
- Never log patterns without suggesting a specific next action
- Never surface a pattern alert without including the data behind it
- Don't wait for the user to notice patterns — surface them proactively
