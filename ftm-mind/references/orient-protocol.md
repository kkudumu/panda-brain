# Orient Protocol

## Capability Inventory: FTM Skills

| Skill | Reach for it when... |
|---|---|
| `ftm-brainstorm` | Exploring ideas, designing systems, comparing approaches, research-backed planning |
| `ftm-executor` | Has a plan doc or wants autonomous multi-task implementation |
| `ftm-debug` | Broken behavior, errors, flaky tests, crashes, regressions |
| `ftm-audit` | Wiring checks, dead code analysis, structural verification |
| `ftm-council` | Multiple AI perspectives, debate, second opinions |
| `ftm-codex-gate` | Adversarial Codex review or correctness stress test |
| `ftm-intent` | Function/module purpose docs or INTENT.md updates |
| `ftm-diagram` | Diagrams, architecture visuals, Mermaid assets |
| `ftm-browse` | Browser, screenshots, DOM inspection, visual verification |
| `ftm-pause` / `ftm-resume` | Park or restore session state |
| `ftm-upgrade` | Check or upgrade ftm skills |
| `ftm-retro` | Post-run retrospective or execution review |
| `ftm-config` | Settings, model profiles, feature configuration |
| `ftm-git` | MANDATORY before any commit/push — secret scanning gate |
| `ftm-capture` | Save repeatable workflow as routine/playbook. Also suggest proactively when blackboard shows same task_type 2+ times |
| `ftm-ops` | Tasks, capacity, burnout, stakeholders, meetings, incidents, daily/weekly summaries |

Routing: do it directly if small enough. Route to a skill only when the workflow adds clear value. Explicit invocation is a strong signal.

## MCP Inventory

Read `references/mcp-inventory.md` for full details. Quick heuristics:

| Signal | MCP |
|---|---|
| Jira key or Atlassian URL | `mcp-atlassian-personal` |
| Internal docs, runbook, company wiki | `glean_default` |
| Library/framework docs | `context7` |
| Calendar, meeting, free time | `google-calendar` |
| Slack, channel, thread | `slack` |
| Email, Gmail, draft | `gmail` |
| Ticket, hardware, access request | `freshservice-mcp` |
| Browser, screenshot | `playwright` |
| Trade-off analysis | `sequential-thinking` |
| Apple framework | `apple-doc-mcp` |
| Contact/company lookup | `lusha` |

Multi-MCP: parallelize reads, gather state before writes, chain writes sequentially.

## Session Trajectory

Look for the arc, not just the last message:
- What happened just before? What did we learn?
- brainstorm → "ok go" = plan/executor
- debug → "check it now" = verify/test/audit
- executor → "pause" = checkpoint
- resume → "what's next?" = restore and continue

## Codebase State

Check: dirty worktree, recent commits, active branch, in-progress changes, conflicts with request. Clean tree = lower cost of direct action. Uncommitted changes = continuity and risk.

## Blackboard-First Rule (before any access/auth questions)

Before asking about credentials, API access, or authorization:
1. Read `experiences/index.json`
2. Look for tags: current repo name, `api-access`, `full-access`, or the target system
3. If match exists with confidence ≥ 0.7 → don't ask, just act
4. No match → proceed with asking

## Access Declaration Detection

When user declares repo-level access, **immediately** write a blackboard experience:

**Triggers**: "I have access to...", "credentials are configured", "just do it, I have the creds", user tells you to stop asking, or first successful API call in a repo without an access experience.

**Write**: `experiences/learning-{repo-name}-api-access.json` with tags `["{repo-name}", "api-access", "environment", "learning"]`, confidence 1.0. Update index.

## Discovery Interview (medium+ with external systems)

**Apply Blackboard-First Rule first.** If blackboard confirms access + task is a direct API operation → skip interview, just do it.

Interview is for genuine unknowns only (stakeholder coordination, multi-system migrations, policy changes). 2-4 focused questions:
- Who else needs to know?
- Downstream dependencies?
- Timeline/approval constraints?
- Parts to leave as-is?

**Skip when**: user provided context, purely local, user said "just do it", or blackboard confirms access for a direct API op.

## Brain.py Task Loading

```
python3 ~/.claude/skills/ftm/bin/brain.py --tasks --task-json
```

Load active tasks, surface high-priority via TaskCreate. Skip if brain.py absent, tasks loaded recently (15min), or request is purely local.

## Playbook Lookup (MANDATORY before external system ops)

**Before any external system operation, check all three knowledge sources:**

1. `brain.py --playbook-match "[operation]"` + `--playbook-list`
2. `ls docs/playbooks/` in current repo
3. Blackboard experiences filtered by target system tags — check `code_patterns` and `api_gotchas`

If any source has relevant content, read it before writing code. After checking, write a marker: `~/.claude/ftm-state/.playbook-checked-{system}` so the ftm-guard hook knows you checked.

## Orient Synthesis

Before leaving Orient, have one clear internal picture: what the user wants, task type, session continuity, codebase constraints, relevant lessons/patterns, capability mix, correct task size, whether approval or clarification is needed. Orient is complete when the next move feels obvious.

## Safety Protocols

**Approval gates, destructive action prevention, compare-before-you-loop, and loop detection are enforced by the `ftm-guard` hook**, which fires on every mutating tool call automatically. You do not need to self-enforce these — the hook will inject warnings if you're about to do something dangerous. But you should still be aware of them:

- External mutations need user approval per-phase (not per-call, not whole-plan)
- Destructive actions (delete, recreate) need per-resource confirmation
- 3+ failed API calls = stop and compare against a working reference
- Never trial-and-error; always diff a working resource first

See `references/incidents.md` for the full incident history behind these rules.
