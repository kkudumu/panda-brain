# Meeting Intelligence Protocol

Processes meeting transcripts and notes to extract structured intelligence: action items, decisions, open questions, commitments, and risks.

---

## Transcript Processing Steps

When user shares a meeting transcript or raw notes:

1. **Read through completely** before extracting — technical details are in the middle, not just the beginning
2. **Extract action items** in structured format (see below)
3. **List open questions** that need clarification before work can proceed
4. **Document decisions made** and their rationale
5. **Identify commitments** — promises made by you or to you
6. **Flag risks and blockers** mentioned or implied
7. **Suggest follow-up items** the user may not have noticed
8. **Write to today's daily file** — append meeting section

---

## Action Item Format

```
## Action Items from [Meeting Name] — [Date]

**High Priority:**
- [ ] [Action] — [Owner] — [Deadline if mentioned]

**Standard Priority:**
- [ ] [Action] — [Owner] — [Deadline if mentioned]

**Follow-ups:**
- [ ] [Action] — [Owner]
```

Owner disambiguation: if "we" means you, attribute to yourself. If ambiguous, note it as "Owner: TBD — clarify with [person]".

---

## Open Questions Format

```
## Questions to Clarify

**Critical for Decision:**
- [Question] — Why it matters: [context]

**Important for Implementation:**
- [Question] — Why it matters: [context]

**Nice to Know:**
- [Question]
```

---

## Decisions Log Format

```
## Decisions Made

- [Decision] — Rationale: [why] — Made by: [who] — Date: [date]
```

Write decisions to `~/.claude/ftm-ops/knowledge/decisions.md` if they have lasting architectural or operational impact.

---

## Commitments Tracking

Commitments are promises made in the meeting — by you or to you.

**Commitments you made:**
- Flag for follow-up tracking via brain.py `--followup-add`
- Add deadline-based tasks for anything with a hard date

**Commitments made to you:**
- Track as blockers if they're on a critical path
- Add to `~/.claude/ftm-ops/dependencies/active-blockers.md` if blocking your work

---

## Risk & Blocker Detection

During transcript review, flag:
- Scope creep ("can we also..." mid-decision)
- Unclear ownership (no one explicitly said they'd do it)
- Ambiguous timelines ("soon", "next sprint" without dates)
- Missing stakeholders (decision made without someone who should have been there)
- Technical debt being accepted under time pressure

**Risk output:**
```
## Risks & Concerns
- [Risk] — Type: [scope/timeline/ownership/technical] — Suggested action: [what to do]
```

---

## Slack Message Processing

When user shares Slack thread or messages:

1. Categorize by type: Request / Question / Decision / FYI / Escalation
2. Identify urgency for each
3. Note context from communication history before responding
4. Flag recurring questions — potential documentation opportunities
5. Draft response if user asks, following the comms drafts protocol

---

## Daily File Integration

After processing any meeting, append to today's daily file `~/.claude/ftm-ops/daily/YYYY-MM-DD.md`:

```markdown
## Meetings & Notes
### [Meeting Name] — HH:MM
- Attendees: [names]
- Decisions: [key decisions]
- Action items: [who — what — when]
- Open questions: [questions needing answers]
- Commitments to me: [what others promised]
- Risks noted: [any flags]
```

---

## Clarifying Questions

After extracting intelligence, ask 1-3 clarifying questions if:
- An action item owner is ambiguous
- A deadline was mentioned but not confirmed
- A technical decision seems under-specified
- A commitment was made but no timeline given

Don't ask all at once — prioritize the highest-risk ambiguities.

---

## What to Avoid

- Never skip commitments extraction — they become follow-ups
- Never assume "we" means the other person — often it means the user
- Never skip open questions — they block execution
- Never process a transcript without writing the summary to the daily file
