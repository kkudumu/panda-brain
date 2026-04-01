# Capacity & Burnout Tracking Protocol

Monitors workload against sustainable thresholds and proactively flags burnout indicators. Delegates all persistence to brain.py `--capacity-log`.

---

## Alert Thresholds

| Indicator | Threshold | Signal |
|---|---|---|
| Weekly capacity | >90% committed | Warning |
| Weekly capacity | >100% committed | Alert |
| Context switches | >20 per week | Warning |
| On-call incidents | >3 per week | Warning |
| Weekend work detected | Any | Alert |
| Work hours | >45/week for 2 consecutive weeks | Warning |

---

## Logging a Capacity Entry

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --capacity-log \
  --date YYYY-MM-DD \
  --capacity-pct 95 \
  --context-switches 18 \
  --hours 9.5 \
  --weekend-work false \
  --notes "3 incidents, 2 unplanned escalations"
```

Log entries:
- When user does a daily wrap-up
- When user explicitly says "log my capacity"
- When a burnout indicator is detected during conversation

Also append a summary entry to `~/.claude/ftm-ops/capacity/weekly-capacity.md`.

---

## Calculating Capacity

When user asks "how busy am I" or "am I overcommitted":

1. Pull this week's capacity log entries from brain.py
2. Pull task list and estimate hours for open items
3. Compare committed hours vs. available hours (assume 40hr week baseline)
4. Check context switch count from daily files
5. Check for weekend work mentions in daily files

**Capacity formula:**
```
Capacity % = (Committed hours + Meeting hours + Incident hours) / 40 × 100
```

If unplanned work is frequent, add a 20% buffer recommendation.

---

## Burnout Indicator Analysis

When capacity data suggests risk, analyze patterns:

1. **Trend direction**: Is capacity improving or worsening over 3 weeks?
2. **Context switch pattern**: Which days are worst? Are there focus blocks?
3. **Weekend work pattern**: One-off or recurring?
4. **On-call load**: Is rotation coverage adequate?

**Output format:**
```
## Capacity Check — [Date]
Committed: [X]% | Context switches: [N] this week
Status: [Green / Warning / Alert]

Red flags:
- [flag with specifics]

Trend: [Improving / Stable / Worsening] over [N] weeks

Recommendations:
1. [Specific, actionable suggestion]
2. [Specific, actionable suggestion]
```

---

## Proactive Alert Examples

**High capacity (>90%):**
> "Capacity Alert: You're at 95% committed this week with 15 hours of unplanned work.
> Red flags: 4 context switches yesterday, 3 on-call incidents this week, weekend work Saturday.
>
> Recommendations:
> 1. Block Thursday afternoon as focus time (no meetings)
> 2. Defer [Task A] and [Task B] — low priority, can wait until next week
> 3. Request on-call backup for next rotation
>
> Want me to draft a message to your manager about workload?"

**Context switching (>20/week):**
> "Context Switch Alert: 23 switches this week (target: <15).
> Peak days: Tuesday (7), Thursday (6).
>
> Impact: ~30% productivity loss estimated.
>
> Suggestions:
> 1. Block Tuesday/Thursday afternoons as 'Deep Work'
> 2. Batch similar tasks (group all Slack responses to end of day)
> 3. Document context before switching to speed up restoration"

**Weekend work detected:**
> "Weekend work detected — you logged 4 hours Saturday. That's a red flag.
> Is this an isolated incident or a pattern? If recurring, we should address workload."

---

## Weekly Burnout File

Read `~/.claude/ftm-ops/capacity/burnout-indicators.md` when analyzing multi-week trends. It tracks:
- Running capacity percentages by week
- Context switch counts
- Weekend work occurrences
- On-call incident counts
- Trend direction and notes

Update this file after each capacity check.

---

## What to Avoid

- Never dismiss burnout signals as "just a busy week" without checking trends
- Never suggest working harder as a solution
- Always pair a capacity alert with specific, actionable recommendations
- Never calculate capacity without checking both logged entries and open task list
