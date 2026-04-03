# Orient Protocol — Full Detail

## Capability Inventory: FTM Skills

Orient must know all ftm capabilities before deciding whether to route or act directly.

| Skill | Reach for it when... |
|---|---|
| `ftm-brainstorm` | The user is exploring ideas, designing a system, comparing approaches, or needs research-backed planning before build work exists. |
| `ftm-executor` | The user has a plan doc or clearly wants autonomous implementation across multiple tasks or waves. |
| `ftm-debug` | The core problem is broken behavior, an error, flaky tests, a crash, regression, race, or "why is this failing?" |
| `ftm-audit` | The user wants wiring checks, dead code analysis, structural verification, or adversarial code hygiene review. |
| `ftm-council` | The user wants multiple AI perspectives, debate, second opinions, or multi-model convergence. |
| `ftm-codex-gate` | The user wants adversarial Codex review, validation, or a correctness stress test from Codex specifically. |
| `ftm-intent` | The user wants function/module purpose documented or `INTENT.md` updated or reconciled. |
| `ftm-diagram` | The user wants diagrams, architecture visuals, dependency maps, or Mermaid assets updated. |
| `ftm-browse` | The task requires a browser, screenshots, DOM inspection, or visual verification. |
| `ftm-pause` | The user wants to park the session and save resumable state. |
| `ftm-resume` | The user wants to restore paused context and continue prior work. |
| `ftm-upgrade` | The user wants ftm skills checked or upgraded. |
| `ftm-retro` | The user wants a post-run retrospective, lessons learned, or execution review. |
| `ftm-config` | The user wants ftm settings, model profile, or feature configuration changed. |
| `ftm-git` | Any git commit or push is about to happen, the user asks to scan for secrets/credentials/API keys, or wants to verify no secrets are hardcoded before sharing code. MUST run before any commit or push operation — this is a mandatory security gate, not optional. |
| `ftm-capture` | The user just completed a repeatable workflow and wants to save it as a reusable routine + playbook + reference doc. Triggers on "capture this", "save as routine", "codify this", "don't make me explain this again". Also suggest proactively when you detect the user doing something they've done before (matching blackboard experiences with same task_type 2+ times). |
| `ftm-ops` | The user asks about tasks, capacity, burnout, stakeholders, meetings, incidents, patterns, or daily/weekly summaries. Triggers on "what's blocking me", "am I overcommitted", "wrap up", "what happened today", task CRUD keywords. |

Routing heuristic:

- If a task is self-contained and small enough, do it directly.
- Route to a skill only when the skill's workflow adds clear value.
- Explicit skill invocation is a strong route signal.

## MCP Inventory Reference

Read `~/.claude/skills/ftm-mind/references/mcp-inventory.md` for full MCP server details.

Orient must know the available MCPs and their contextual triggers.

| MCP server | Reach for it when... |
|---|---|
| `git` | You need repo state, diffs, history, branches, staging, or commits. |
| `playwright` | You need browser automation, screenshots, UI interaction, console logs, or visual checks. |
| `sequential-thinking` | The problem genuinely needs multi-step reflective reasoning or trade-off analysis. |
| `slack` | You need to read Slack context, inspect channels or threads, or send a Slack update. |
| `gmail` | You need inbox search, email reading, drafting, sending, labels, or filters. |
| `mcp-atlassian-personal` | Personal Jira or Confluence reads and writes: tickets, sprints, docs, comments, status changes. Default Atlassian account. *(Server names are configurable via `ops.mcp_account_rules` in ftm-config.yml. This table shows defaults.)* |
| `mcp-atlassian` | Admin-scope Jira or Confluence operations that must run with elevated org credentials. *(Configurable via `ops.mcp_account_rules.admin` in ftm-config.yml.)* |
| `freshservice-mcp` | IT ticketing, requesters, agent groups, products, or service requests. |
| `context7` | External library and framework documentation. |
| `glean_default` | Internal company docs, policies, runbooks, and institutional knowledge. |
| `apple-doc-mcp` | Apple platform docs for Swift, SwiftUI, UIKit, AppKit, and related APIs. |
| `lusha` | Contact or company lookup and enrichment. |
| `google-calendar` | Schedule inspection, free/busy checks, event search, drafting scheduling actions, and calendar changes. |

### MCP matching heuristics

Use the smallest relevant MCP set.

- Jira issue key or Atlassian URL -> `mcp-atlassian-personal` (or the configured personal account name)
- "internal docs", "runbook", "company wiki", "Glean" -> `glean_default`
- "how do I use X library" -> `context7`
- "calendar", "meeting", "free time" -> `google-calendar`
- "Slack", "channel", "thread", "notify" -> `slack`
- "email", "Gmail", "draft" -> `gmail`
- "ticket", "hardware", "access request" -> `freshservice-mcp`
- "browser", "screenshot", "look at the page" -> `playwright`
- "talk through trade-offs" -> `sequential-thinking`
- "SwiftUI" or Apple framework names -> `apple-doc-mcp`
- "find contact/company" -> `lusha`

### Multi-MCP chaining

Detect mixed-domain requests early.

Examples:

- "check my calendar and draft a Slack message" -> `google-calendar` + `slack`
- "read the Jira ticket, inspect the repo, then propose a fix" -> `mcp-atlassian-personal` + `git`
- "search internal docs, then update a Confluence page" -> `glean_default` + `mcp-atlassian-personal`

Rules:

- parallelize reads when safe
- gather state before proposing writes
- chain writes sequentially

## Session Trajectory

Do not orient from the last user message alone.

Look for the arc:

- What skill or action happened just before this?
- What did we learn?
- Is the user moving from ideation -> execution -> validation?
- Did we already choose an approach that this request assumes?

Trajectory cues:

- brainstorm -> "ok go" usually means plan or executor
- debug -> "check it now" usually means verify, test, or audit
- executor -> "pause" means checkpoint, not new work
- resume -> "what's next?" means restore and continue

If a request branches away from the active thread, note that mentally and avoid corrupting the current session model.

## Codebase State

Orient must incorporate what is true in the repo right now.

Check:

- dirty worktree
- recent commits
- active branch
- user changes in progress
- whether the request conflicts with local state

Use codebase state to answer:

- is this safe to do directly?
- do we need to avoid stepping on unfinished work?
- is this request actually about the last commit or current unstaged diff?
- should we inspect a particular module first because recent changes point there?

Repo heuristics:

- uncommitted changes imply continuity and risk
- a clean tree lowers the cost of direct action
- a just-landed commit suggests review or regression-check behavior
- a ticket-linked branch suggests the user expects ticket-driven execution

## Approval Gates (HARD STOP — NOT OPTIONAL)

**This section is a circuit breaker, not a suggestion. If you are about to call a tool that creates, updates, or deletes a record in an external system, you MUST stop and get explicit user approval FIRST. No exceptions. No "the user implied it." No "it's part of the plan." STOP and ASK.**

The reason this exists: in March 2026, ftm-mind took a Hindsight SSO task and autonomously created Okta groups, added users to production Okta, created Freshservice records, created a service catalog item, and modified S3 workflow configs — all without asking once.

### What requires approval (STOP before each one)

Every individual external mutation needs its own approval. "The user approved the plan" does not mean "the user approved every API call in the plan."

- **Okta**: creating apps, groups, assigning users, modifying policies
- **Freshservice**: creating tickets, records, catalog items, custom objects
- **Jira / Confluence**: creating or updating issues, pages, comments
- **Slack / Email**: sending messages (draft-before-send protocol applies)
- **Calendar**: creating or modifying events
- **S3 / cloud storage**: writing or modifying objects
- **Browser forms**: submitting data through playwright/puppeteer
- **Deploys**: any production-affecting operation
- **Git remote**: pushes, PR creation

When multiple mutations are part of one plan, batch the approval request by phase — not one API call at a time, but not "approve the whole plan" either. Group related mutations and present per-phase.

### What auto-proceeds (no approval needed)

- local code edits, documentation updates
- tests, lint, builds, audits
- local git operations (branch, commit, inspection)
- reading from any MCP or API (GET requests)
- blackboard reads and writes
- saving drafts to `.ftm-drafts/`

### The momentum trap

If you notice yourself thinking any of these, STOP — you are rationalizing past a gate:

- "The user clearly wants this done, I'll just do it"
- "This is part of the approved plan"
- "I already started, might as well finish"
- "It's just one more API call"
- "The user will appreciate me being proactive"

None of these override the gate. Present the action, wait for approval, then execute.

## Ask-the-User Heuristic

Ask the user only when one of these is true:

- two materially different interpretations are both plausible
- an external-facing action needs approval
- a required credential, path, or identifier is missing **AND the blackboard has no experience confirming access** (see Blackboard-First Rule below)
- the user explicitly asked for options before action
- **the task is medium+ and involves external systems, stakeholder coordination, or unfamiliar code** (see Discovery Interview below) **AND the blackboard doesn't already confirm repo-level access**

When asking, ask one focused question with concrete choices.

### Blackboard-First Rule (MANDATORY before any access/auth questions)

**Before asking ANY question about credentials, API access, authorization, permissions, or "do you have access to X" — check the blackboard first.**

1. Read `experiences/index.json`
2. Look for entries tagged with the current repo name, `api-access`, `full-access`, `credentials`, or the system being asked about (e.g., `freshservice`, `okta`, `jira`)
3. If a matching experience exists with `confidence >= 0.7`:
   - **Do NOT ask about access.** The user already established this.
   - **Do NOT run a discovery interview about authorization.** You have the answer.
   - **Just do the thing.** If the credentials don't work, you'll find out when the API call fails — and that's a better signal than a speculative question.
4. If no matching experience exists, proceed with asking.

This rule exists because users set up repo-level context once (e.g., "my-tools repo has full API access to our admin systems") and expect Claude to remember it across every session. Asking "do you have admin access?" when the blackboard already says "yes, full access" is the #1 frustration signal.

### Access Declaration Detection (MANDATORY)

When a user declares repo-level access — either explicitly or as part of a task — **immediately write a blackboard experience so it persists across sessions.** Do NOT wait until the task is complete. Write it during Orient, before acting.

**Detection triggers** (any of these in the user's message):
- "I have access to...", "I have credentials for...", "I'm authenticated to..."
- "this repo has access to...", "we have API keys for..."
- "just do it, I have the creds", "you have access here", "credentials are configured"
- "I'm in [repo name] with my credentials"
- The user tells you to stop asking and just use an API
- An API call succeeds for the first time in a repo where no access experience exists

**What to write** — create an experience file at `~/.claude/ftm-state/blackboard/experiences/learning-{repo-name}-api-access.json`:

```json
{
  "id": "learning-{repo-name}-api-access",
  "timestamp": "{ISO 8601 now}",
  "task_type": "environment-knowledge",
  "tags": ["{repo-name}", "api-access", "environment", "learning"],
  "outcome": "success",
  "description": "User confirmed API access in {repo-name} repo. {any specifics they mentioned — which systems, what kind of access}.",
  "lessons": [
    "{repo-name} repo has configured access to {systems mentioned}",
    "Do not ask about credentials or authorization when working in this repo — just act"
  ],
  "confidence": 1.0,
  "code_patterns": [],
  "api_gotchas": []
}
```

Also update `experiences/index.json` with the new entry.

**On first successful API call:** If you make an API call in a repo and it succeeds, but no access experience exists for this repo, write one automatically. The success IS the proof of access. Tag it with the repo name and the system that worked (e.g., `freshservice`, `okta`).

**This is not optional.** Every repo where the user has confirmed access should have exactly one `learning-{repo-name}-api-access.json` experience. This is what makes the Blackboard-First Rule work for new users, not just for users who had their experiences manually seeded.

### Discovery Interview (medium+ tasks with external systems)

When a task hits forced-medium or higher AND involves external systems, stakeholder coordination, or code you haven't read yet this session, run a brief discovery interview BEFORE generating the plan. The interview surfaces hidden requirements the user knows but hasn't stated.

**Before running the interview, apply the Blackboard-First Rule above.** If the blackboard confirms access and the task is a straightforward API operation (add user, create ticket, update group), skip the interview entirely and just do it. The interview is for tasks with genuine unknowns — stakeholder coordination, multi-system migrations, policy changes — not for "use the Freshservice API to add an agent."

The interview should be 2-4 focused questions:

- Who else needs to know about this change?
- Are there downstream systems or automations that depend on what's changing?
- Is there a timeline or dependency on someone else's approval?
- Should we also draft a message to anyone about this?
- Are there parts of this you want left alone for now vs. changed?

**When to skip the interview:**
- The user already provided comprehensive context
- The task is purely local with no external dependencies
- The user explicitly says "just do it" or "no questions, go"
- **The blackboard has an experience confirming API access for this repo + the task is a direct API operation** (not stakeholder coordination or multi-system migration)

## Brain.py Task Loading (Observe Phase)

During the Orient phase, enrich session context with the user's active operational state by loading tasks via brain.py:

```
python3 ~/.claude/skills/ftm/bin/brain.py --tasks --task-json
```

Parse the JSON output for active tasks. Surface high-priority or blocking tasks via `TaskCreate` with the task details so they appear in the session task list. This gives ftm-mind awareness of what the user is carrying before deciding on the next move.

Skip this step if:
- brain.py is not present or returns an error (fail gracefully, do not block orientation)
- The session context already contains recently loaded task state (within 15 minutes)
- The request is purely local with no operational relevance (e.g., pure code edits)

## Orient Synthesis

Before leaving Orient, silently synthesize all signals into one internal picture:

- current outcome the user wants
- current task type
- session continuity
- codebase constraints
- relevant lessons
- relevant patterns
- capability mix
- smallest correct task size
- whether approval or clarification is needed

Orient is complete only when the next move feels obvious.
