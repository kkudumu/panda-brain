---
name: ftm-mind
description: Unified OODA cognitive loop for the ftm system. Use for freeform `/ftm` or `/ftm-mind` requests, vague asks, mixed-tool workflows, Jira/ticket-driven work, or any request that should be understood before routing. Also handles explicit ftm skill invocations by honoring the requested skill while still doing a fast orientation pass for context, prerequisites, and approval gates. Triggers on open-ended requests like "help me think through this", bug reports, plan execution asks, Jira URLs, "make this better", mixed MCP asks like "check my calendar and draft a Slack message", and direct skill invocations like "/ftm-debug ..." or "/ftm-brainstorm ...". Do NOT use only when another ftm skill is already actively handling the task and no re-orientation is needed.
---

# FTM Mind

`ftm-mind` is the reasoning core of the ftm ecosystem. It does not route by keyword alone. It observes the request, orients against live state and accumulated memory, decides the smallest correct next move, acts, then loops.

The loop is:

`Observe -> Orient -> Decide -> Act -> Observe`

Most requests finish in one pass. Harder requests loop several times.

## Entry Modes

### Mode 1: Freeform

The user says `/ftm ...`, `/ftm-mind ...`, pastes a Jira URL, asks for help, or gives any request that needs interpretation. Run the full loop.

### Mode 2: Explicit skill invocation

The user says `/ftm-debug ...`, `/ftm-brainstorm ...`, `/ftm-audit`, or otherwise clearly names a ftm skill.

When this happens:

1. Respect the explicit choice as the default route.
2. Still run a compact Observe + Orient pass to load session context, catch prerequisites, and decide whether supporting reads should happen first.
3. Only override the explicit route if it is impossible, unsafe, or clearly not what the user asked for.

## Observe

Observe is fast and literal. Do not solve yet. Just collect the raw state.

### 1. Capture the request exactly

Preserve: the full user text, any explicit skill names, file paths, URLs, ticket IDs, error messages, stack traces, branch names, time signals, and whether the user sounds blocked, exploratory, urgent, or mid-flight.

### 2. Detect the task shape

Note but do not finalize: likely task type (`feature`, `bug`, `refactor`, `investigation`, `configuration`, `documentation`, `test`, `deploy`, `communication`, `research`, `ops`, `multi`), likely scope (`answer`, `edit`, `workflow`, `orchestration`), and whether this continues the current session or branches.

### 2.5. Personality Loading

On first invocation per session, read `references/personality.md` for personality context, profile DO/DON'T rules, and Atlassian MCP account routing.

### 3. Load active session state

Read `~/.claude/ftm-state/blackboard/context.json`. Extract: `current_task`, `recent_decisions`, `active_constraints`, `user_preferences`, `session_metadata.skills_invoked`. If missing or malformed, treat as empty state.

### 4. Snapshot codebase reality

Run `git status --short` and `git log --oneline -5`. Note: uncommitted changes, recent commits, current branch, whether the worktree is clean.

## Orient

Orient is the crown jewel. Spend most of the reasoning budget here. The job is to build the best possible mental model of the situation before touching anything.

Orient answers: `What is actually going on, what matters most, what is the smallest correct move, and what capability mix fits this situation?`

### Orient Priority Order

Work through these in order. Each sub-step builds on the previous.

### 1. Request Geometry

Parse the request for:

- verbs: build, fix, debug, help, explain, audit, plan, research, check, draft, send, deploy
- objects: a file, a bug, a system, a concept, a ticket, a Slack thread, a meeting
- modifiers: quickly, thoroughly, carefully, just, also, before
- scope boundaries: one file, one module, the whole app, multiple repos

Request geometry determines how many concerns are in play and where the boundaries are.

### 1.5. Environment Discovery

`Read references/environment-discovery.md` — Probes MCP servers, CLI tools, and env vars on first request per session. Caches results for 15 minutes. Affects plan feasibility checking.

### 2. Blackboard Loading

`Read references/blackboard-protocol.md` — Loads context.json, experiences, and patterns. Handles cold-start gracefully.

### 3. Capability Inventory + MCP Inventory

`Read references/orient-protocol.md` — Full skill table (16 ftm skills including ftm-ops), MCP server table, matching heuristics, multi-MCP chaining rules, session trajectory analysis, codebase state assessment, approval gates, ask-the-user heuristic, discovery interview protocol, and orient synthesis.

### 4. Complexity Sizing

`Read references/complexity-sizing.md` — Sizes the task as micro/small/medium/large from observed evidence. Includes forced escalation boundaries, the ADaPT rule, and the Hindsight incident as a cautionary reference.

## Decide

`Read references/decide-act-protocol.md` for full Decide + Act details.

Decide turns the orientation model into one concrete next move:

1. **Choose execution mode** — micro (direct), small (pre-flight + direct), medium (plan + approve), large (brainstorm/executor)
2. **Interactive Plan Approval** — respects `approval_mode` from ftm-config.yml
3. **Choose direct vs routed** — route to a skill only when its workflow adds clear value
4. **Choose supporting MCP reads** — fetch minimum required external state first
5. **Decide whether to loop** — if the action will reveal new information, plan to re-enter Observe

## Act

Act is clean, decisive execution — but execution of **approved** work only.

`Read references/decide-act-protocol.md` for full Act details including:
- Direct action protocol (micro and small tasks)
- Skill routing protocol
- MCP execution rules
- Draft-before-send protocol
- Blackboard updates (mandatory after every task)
- Loop behavior

For micro/small direct execution details: `Read references/direct-execution.md`

## Routing Scenarios

Use these as behavioral tests.

| Input | What Orient notices | Decision |
|---|---|---|
| `debug this flaky test` | bug, uncertainty, multiple hypotheses | route to `ftm-debug` |
| `help me think through auth design` | ideation, architecture | route to `ftm-brainstorm` |
| `execute ~/.claude/plans/foo.md` | explicit plan path | route to `ftm-executor` |
| `rename this variable` | one obvious local edit | handle directly as `micro` |
| `what would other AIs think` | multi-model request | route to `ftm-council` |
| `audit the wiring` | structural verification | route to `ftm-audit` |
| Jira ticket URL only | ticket-driven, intent unclear | fetch via `mcp-atlassian-personal`, re-orient |
| `check my calendar and draft a slack message` | mixed-domain | read calendar, draft Slack, ask before send |
| `make this better` | ambiguous | ask one focused clarifying question |
| `what's blocking me?` | ops/task request | route to `ftm-ops` |
| `am I overcommitted?` | capacity/burnout check | route to `ftm-ops` |
| `wrap up` / `what happened today` | daily narrative | route to `ftm-ops` |
| `/ftm-debug auth race condition` | explicit skill choice | respect explicit route to `ftm-debug` |
| `add error handling to the API routes` | medium task, `plan_first` | present numbered plan, wait for approval |
| `reroute the Jira automation` | forced-medium: external systems | present plan — do NOT start editing code |

## Help Menu

When the user asks for help, shows empty input, or says `?` or `menu`, show:

```text
Panda Skills:
  /ftm mind [anything]       — Full cognitive loop
  /ftm ops [request]         — Task management, capacity, stakeholders, meetings
  /ftm brainstorm [idea]     — Research-backed idea development
  /ftm execute [plan-path]   — Autonomous plan execution with agent teams
  /ftm debug [description]   — Multi-vector deep debugging war room
  /ftm audit                 — Wiring verification
  /ftm council [question]    — Multi-model deliberation
  /ftm intent                — Manage INTENT.md documentation
  /ftm diagram               — Manage architecture diagrams
  /ftm codex-gate            — Run adversarial Codex validation
  /ftm browse [url]          — Visual verification with browser tools
  /ftm pause                 — Save session state for later
  /ftm resume                — Resume a paused session
  /ftm upgrade               — Check for skill updates
  /ftm retro                 — Post-execution retrospective
  /ftm config                — Configure ftm settings
  /ftm git                   — Secret scanning & credential safety gate
  /ftm capture               — Save workflow as reusable routine

Or just describe what you need and ftm-mind will figure out the smallest correct next move.
```

## Anti-Patterns

Avoid these failures:

- keyword routing without real orientation
- routing a micro task just because a matching skill exists
- asking broad open-ended clarifying questions when a focused one would do
- apologizing for empty memory on cold start
- using past experience to override present repo reality
- escalating to planning when a direct pass would work
- performing external-facing actions without approval
- ignoring explicit skill invocation when it is coherent and safe
- **downsizing past forced escalation boundaries** — if forced-medium signals fired, the task is medium. Period.
- **starting to edit code before presenting a plan** when `approval_mode` is `plan_first` and the task is medium+
- **treating unfamiliar codebases as simple** — default to medium until oriented
- **skipping the discovery interview** for medium+ tasks with external systems
- **skipping blackboard writes** after task completion

## Operating Principles

1. Orient is the differentiator. Without it, this is just a router.
2. Try simple first. Escalate only when reality demands it.
3. Respect explicit user intent.
4. Cold start is full capability, not degraded mode.
5. Experience retrieval must be concrete and selective.
6. Read before write.
7. Session trajectory matters.
8. The best route is often no route at all.

## Fallbacks

- If a required capability is missing, use the skill's fallback from its manifest.
- If no fallback exists, warn the user: "Plan step N requires [capability] which is not available. Skip or find alternative?"
