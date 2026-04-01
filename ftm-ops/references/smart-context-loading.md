# Smart Context Loading Strategy

Defines exactly what to load, when, and in what order to maximize intelligence per token spent. Total typical context target: ~10-12K tokens.

---

## The Cardinal Rule: Grep First, Load Second

**NEVER load all daily files to search across history.** That blows the context budget.

**Always follow this 3-step pattern for history searches:**
1. Grep `daily/daily-index.md` for the keyword/topic (fast, ~1KB file)
2. Note which specific date files contain matches
3. Load ONLY those 1-3 matching daily files

Example: User asks "when did we fix the Gainsight issue?" → grep index for "gainsight" → load only those dates.

---

## Layer-by-Layer Loading Strategy

### Layer 1: Always Load (Every Invocation)

These are non-negotiable. Load on every session start.

```bash
# Current date and week
date +%Y-%m-%d
date +%Y-W%V

# Today's tasks
python3 ~/.claude/skills/ftm/bin/brain.py --tasks --task-json

# Today's daily file
~/.claude/ftm-ops/daily/YYYY-MM-DD.md
# (create it if it doesn't exist — see daily-weekly-analysis.md for structure)

# Overdue follow-ups
python3 ~/.claude/skills/ftm/bin/brain.py --followup-list --overdue

# Active blockers
~/.claude/ftm-ops/dependencies/active-blockers.md
```

**Token budget for Layer 1**: ~2-3K tokens

### Layer 2: Load If Today's File Is New or Sparse (<10 lines)

```bash
# Last session snapshot — preserves conversation context across sessions
ls -t ~/.claude/ftm-ops/sessions/ | head -1
# Load that file
```

This is the most important recovery mechanism. If the daily file is empty, the session file is the memory bridge.

**Token budget for Layer 2**: ~1-2K tokens (only if needed)

### Layer 3: Load Weekly Summary (Filtered)

```bash
~/.claude/ftm-ops/weekly/YYYY-WNN.md
```

Load only: open action items, active blockers, major decisions. Skip completed items and verbose meeting notes.

**Token budget for Layer 3**: ~1-2K tokens (200-300 lines max)

### Layer 4: Load Knowledge Files (As Needed)

Load based on what the user is talking about:

| Trigger | Load |
|---|---|
| First interaction of session | `knowledge/infrastructure.md` |
| Discussing people or org structure | `knowledge/team.md` |
| Working style / preferences questions | `knowledge/preferences.md` |
| Problem-solving a technical issue | `knowledge/solutions.md` |

**Token budget for Layer 4**: ~1-2K tokens per file, load max 2 at a time

### Layer 5: Load Pattern Files (Weekly Check)

Load on Monday mornings or when user reports an issue:

```bash
~/.claude/ftm-ops/patterns/recurring-issues.md
~/.claude/ftm-ops/patterns/recurring-questions.md
~/.claude/ftm-ops/patterns/documentation-gaps.md
```

**Token budget for Layer 5**: ~1K tokens total (these files should be kept lean)

### Layer 6: Load Stakeholder Files (When Communicating)

Load before generating any stakeholder communication or update:

```bash
~/.claude/ftm-ops/stakeholders/communication-log.md
```

Combined with `--followup-list` from brain.py.

**Token budget for Layer 6**: ~1K tokens

### Layer 7: Load Incidents (When Relevant)

Load when discussing production issues:

```bash
# Always load the index first
~/.claude/ftm-ops/incidents/incident-index.md

# Then load specific incident files only when referenced
~/.claude/ftm-ops/incidents/YYYY-MM-DD-incident-name.md
```

Never load all incident files. Use the index to identify which ones matter.

**Token budget for Layer 7**: ~500 tokens for index, ~500-1K per specific incident

### Layer 8: Load API References (When Working With Specific APIs)

Load only when actively using that API in the current session:

```bash
~/.claude/ftm-ops/references/freshservice-custom-objects-api.md
# (other API docs as needed)
```

Use Read tool to extract specific sections — don't load the entire file.

**Token budget for Layer 8**: ~1-2K tokens per reference, extract sections only

### Layer 9: On-Demand — Grep First, Load Specific Files

For any historical search:
1. Grep `daily/daily-index.md` for the keyword
2. Identify matching date files (1-3 max)
3. Load only those specific files

For previous week's context: load that week's file directly if user asks "what did we do last week?"

Monthly files: only load if user explicitly asks "what have I done this month?" — never auto-load.

**Token budget for Layer 9**: ~1-2K tokens max (targeted reads only)

---

## Total Token Budget

| Layer | Condition | Tokens |
|---|---|---|
| Layer 1 (always) | Every session | 2-3K |
| Layer 2 (session snapshot) | Only if daily file sparse | 1-2K |
| Layer 3 (weekly) | Always | 1-2K |
| Layer 4 (knowledge) | As needed | 1-2K |
| Layer 5 (patterns) | Monday / issue detected | 1K |
| Layer 6 (stakeholders) | When drafting comms | 1K |
| Layer 7 (incidents) | When discussing prod issues | 0.5-1.5K |
| Layer 8 (API refs) | When using specific API | 1-2K |
| Layer 9 (historical) | On demand, grep first | 1-2K |

**Typical session**: Layers 1+3+4 = ~6-8K tokens. Well within budget.  
**Heavy session** (incidents + comms + patterns): ~12K tokens max.

---

## Context Loading Decision Flowchart

```
Request received
    ↓
Always run Layer 1 (tasks, today's file, follow-ups, blockers)
    ↓
Is today's daily file sparse? → Yes → Run Layer 2 (session snapshot)
    ↓
Is it Monday? → Yes → Run Layer 5 (patterns)
    ↓
Is request about: people/org? → Load knowledge/team.md
Is request about: tech/systems? → Load knowledge/infrastructure.md + solutions.md
Is request about: stakeholder comms? → Load Layer 6
Is request about: incidents/prod? → Load Layer 7 (index first)
Is request about: specific API? → Load Layer 8 (sections only)
Is request about: past events? → Layer 9 (grep daily-index first)
    ↓
Load the appropriate reference file for the request type
(see SKILL.md sub-routing table)
    ↓
Respond
```

---

## What to Avoid

- Never grep history by loading all files — always use daily-index.md first
- Never load monthly files proactively — they're for reflection, not daily use
- Never load API references unless actively using that API
- Never load all incident files — load index, then specific files only when referenced
- Never skip Layer 1 — it's the foundation of every session
