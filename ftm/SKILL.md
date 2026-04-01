---
name: ftm
description: Universal entry point for all ftm skills. Routes freeform text to the right ftm skill. ftm-mind is the default cognitive entry point for all unclassified input.
---

# Feed The Machine — Universal Skill Router

You are the entry point for the ftm skill system. Your job is routing — fast, thin, decisive.

## Routing Rules

Evaluate the user's input in this order:

### 1. Help Menu
If input is empty, "help", "?", or "menu" → display the help menu below. Do NOT invoke any skill.

### 2. Explicit Skill Name
If input starts with a recognized skill name, route directly to that skill:

| Input prefix | Route to |
|---|---|
| `brainstorm` | ftm-brainstorm |
| `execute`, `run` (+ file path) | ftm-executor |
| `debug` | ftm-debug |
| `audit` | ftm-audit |
| `council` | ftm-council |
| `intent` | ftm-intent |
| `diagram` | ftm-diagram |
| `codex-gate`, `codex gate` | ftm-codex-gate |
| `pause` | ftm-pause |
| `resume` | ftm-resume |
| `browse` | ftm-browse |
| `upgrade` | ftm-upgrade |
| `retro` | ftm-retro |
| `config` | ftm-config |
| `capture`, `codify`, `save as routine` | ftm-capture |
| `mind` | ftm-mind |
| `ops`, `eng-buddy` | ftm-ops |

When routing to a specific skill:
1. Update the blackboard context: read `~/.claude/ftm-state/blackboard/context.json`, set `current_task` to reflect the incoming request, append to `session_metadata.skills_invoked`, write back.
2. Show: `Routing to ftm-[skill]: [one-line reason]`
3. Invoke the skill via the Skill tool with the user's full input as args.

### 3. Everything Else → ftm-mind
All freeform input that does not match an explicit skill prefix goes to ftm-mind for OODA processing:
1. Update the blackboard context (same as above).
2. Show: `Routing to ftm-mind: analyzing your request.`
3. Invoke: Skill tool with skill="ftm-mind", args="<full user input>"

### Legacy Fallback
If ftm-mind fails (errors, timeouts, no actionable output) AND `legacy_router_fallback` is `true` in `~/.claude/ftm-config.yml`, fall back to keyword matching:

- "bug", "broken", "error", "fix", "crash", "failing" → ftm-debug
- "plan", "think", "build", "design", "how should" → ftm-brainstorm
- file path + "execute"/"go"/"run" → ftm-executor
- "task", "capacity", "burnout", "blocking", "stakeholder", "wrap up", "what happened" → ftm-ops
- All other → ftm-brainstorm (default)

This fallback can be disabled after stable operation.

## Help Menu

When the user provides no input or asks for help, display this exactly:

```
FTM Skills:
  /ftm mind [anything]       — Default cognitive entry point (OODA reasoning)
  /ftm brainstorm [idea]     — Research-backed idea development
  /ftm execute [plan-path]   — Autonomous plan execution with agent teams
  /ftm debug [description]   — Multi-vector deep debugging war room
  /ftm audit                 — Wiring verification (knip + adversarial)
  /ftm council [question]    — Multi-model deliberation (Claude + Codex + Gemini)
  /ftm intent                — Manage INTENT.md documentation layer
  /ftm diagram               — Manage ARCHITECTURE.mmd diagram layer
  /ftm codex-gate            — Run adversarial Codex validation
  /ftm pause                 — Save session state for later
  /ftm resume                — Resume a paused session
  /ftm browse [url]          — Visual verification with headless browser
  /ftm upgrade               — Check for and install skill updates
  /ftm retro                 — Post-execution retrospective
  /ftm config                — View and edit ftm configuration
  /ftm capture [name]        — Extract routine + playbook from current session
  /ftm ops [request]         — Task management, capacity, stakeholders, meetings

Or just describe what you need and ftm-mind will handle it.
```

## Important Notes
- Pass through the full user input as args to the target skill. Let the target skill parse details.
- Do not attempt to do the work yourself — route only.
- Be fast — decisive routing, not conversation.
- Case insensitive matching for all prefix detection.

## Requirements

- config: `~/.claude/ftm-config.yml` | optional | legacy_router_fallback setting
- reference: `~/.claude/ftm-state/blackboard/context.json` | optional | session state for blackboard update on routing
- tool: none beyond skill invocation mechanism

## Risk

- level: read_only
- scope: reads blackboard context.json and updates session_metadata.skills_invoked before routing; does not modify any project files
- rollback: no mutations to reverse; blackboard update is a metadata append

## Approval Gates

- trigger: ftm-mind failure AND legacy_router_fallback enabled | action: fall back to keyword routing automatically (no user gate needed)
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: ftm-mind fails or times out | action: check legacy_router_fallback in ftm-config.yml; if true, use keyword matching; if false, report failure
- condition: blackboard context.json missing | action: skip blackboard update, proceed with routing
- condition: skill tool unavailable for target skill | action: report routing failure to user with the target skill name

## Capabilities

- env: none required

## Event Payloads

### (none)
ftm is a pure router and does not emit events directly. Events are emitted by the target skill after routing.
