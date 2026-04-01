# Stakeholder Communications Protocol

Handles communication drafts, follow-up tracking, and stakeholder relationship intelligence. All persistence delegates to brain.py `--stakeholder-add`, `--stakeholder-list`, `--followup-add`, `--followup-list`.

---

## Communication Drafts — Mandatory Order

**Write file FIRST, always. Never show draft content in chat before the file exists.**

### Steps

1. Determine filename: `[recipient]-[topic]-[YYYY-MM-DD].md`
2. **Write the file** to `~/.claude/ftm-ops/drafts/` using Write tool
3. Include metadata header in file:
   ```
   Date: YYYY-MM-DD
   Channel: [Slack / Email / Jira comment]
   To: [recipient name / channel]
   Subject: [topic]
   Status: Draft
   ```
4. Return the full file path in chat
5. Show the draft content
6. On revision: **update the same file in place**, never create a new one

**Wrong**: Draft in chat → maybe save later  
**Right**: Write file → return path → show content

---

## Draft Types

### Status Update (to manager or team)
Structure:
```
## Weekly Status — [Date]

**Completed:**
- [Item] — impact: [brief]

**In Progress:**
- [Item] — [% done], ETA: [date]

**Blockers:**
- [Blocker] — waiting on: [who/what], age: [N days]

**Next Week:**
- [Planned work]
```

### Escalation
Structure:
```
Hi [name],

I wanted to flag [situation] that needs attention.

**Context:** [1-2 sentences]
**Impact:** [what's affected and how]
**Ask:** [specific request — decision, resource, unblock]
**Timeline:** [urgency and why]

Happy to discuss — [preferred next step].
```

### Blocker Follow-up
Structure:
```
Hi [name],

Following up on [item] from [date].

Current status: still blocked on [what]. This is now [N] days old and blocking [downstream impact].

What I need: [specific ask]
Can you confirm: [specific question]?

Thanks
```

### Peer Collaboration Request
Keep it short. Lead with what you need, why, and the time ask.

---

## Stakeholder Tracking

Add a stakeholder when they become a recurring point of contact:

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --stakeholder-add \
  --name "Name" \
  --role "Role / Team" \
  --channel "Slack / Email" \
  --notes "Communication preferences, context"
```

List stakeholders:
```bash
python3 ~/.claude/skills/ftm/bin/brain.py --stakeholder-list
```

Also maintain `~/.claude/ftm-ops/stakeholders/communication-log.md` for conversation history. Read this file before generating any stakeholder update to maintain continuity.

---

## Follow-up Tracking

Track every promised follow-up:

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --followup-add \
  --stakeholder "Name" \
  --topic "What was promised / what's needed" \
  --due YYYY-MM-DD \
  --priority high
```

On session start, check follow-up list and surface overdue items:

```bash
python3 ~/.claude/skills/ftm/bin/brain.py --followup-list --overdue
```

**Overdue follow-up alert:**
> "Follow-up Overdue:
> '[Topic]' owed to [Name] — promised [N] days ago.
> Options: 1) Send status update now, 2) Escalate if waiting on something, 3) Request extension.
> Want me to draft a message?"

---

## Incoming Comms Processing

When user shares Slack messages or email threads:

1. Categorize each item by type: Request / Question / FYI / Escalation
2. Identify urgency: Needs response now / Today / This week / No action needed
3. Note who's asking and what they need
4. Flag dependencies or blockers you'd need to respond
5. Surface draft response opportunities: "Want me to draft a reply to [name]?"

**Output format:**
```
## Incoming Comms Review
**Needs response now:**
- [Person] via [Channel]: [What they need] — [Suggested action]

**Today:**
- [Person] via [Channel]: [What they need]

**FYI / No action:**
- [Person]: [Topic] — noted
```

---

## Context Before Drafting

Before writing any stakeholder communication:

1. Read `~/.claude/ftm-ops/stakeholders/communication-log.md` for history with this person
2. Check `--followup-list` for any outstanding promises to them
3. Check task list for relevant in-progress work they care about
4. Calibrate tone to their known preferences (detail level, formality)

---

## What to Avoid

- Never draft a message without checking communication history first
- Never show draft content in chat before the file is written
- Never create a new draft file for a revision — update the existing one
- Never let overdue follow-ups go unreported at session start
