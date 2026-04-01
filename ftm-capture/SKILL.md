---
name: ftm-capture
description: Extract reusable routines, playbooks, and reference docs from the current session's work. Reads session context (blackboard, daily log, tool history), asks clarifying questions about generalizability, then writes to all three ftm knowledge layers. Use when user says "capture this", "save this as a routine", "make a playbook from this", "ftm capture", "codify this", "turn this into a routine", "extract the pattern", "save what we did", "learn from this", "remember how to do this", "don't make me explain this again".
---

## Events

### Emits
- `capture_complete` — when all three artifacts (routine, playbook, reference doc) are written
- `experience_recorded` — when the capture is logged to the blackboard experience layer
- `known_issue_recorded` — when API gotchas or failure workarounds are encoded

### Listens To
- `task_completed` — can be auto-triggered after task completion to suggest capture
- `pattern_discovered` — if ftm-retro identifies a recurring workflow, suggest capture

# FTM Capture — Session-to-Knowledge Extractor

Turns what you just did into reusable automation. Reads the current session's work (blackboard context, daily log, tool calls, experiences), asks 2-4 clarifying questions about generalizability, then writes to all three ftm knowledge layers simultaneously.

## Why This Exists

Every time you complete a repeatable workflow (SSO setup, service catalog creation, vendor onboarding, incident response), the knowledge lives only in the conversation. Next session starts from zero. ftm-capture closes this gap by extracting the pattern while context is fresh and writing it to durable storage that ftm-mind, ftm-routine, and ftm-ops can all access.

## Output Artifacts

ftm-capture writes to **three locations** simultaneously:

| Artifact | Location | Format | Consumer |
|---|---|---|---|
| **Routine** | `~/.ftm/routines/{name}.yml` | YAML with phases/steps | `ftm-routine` (executable) |
| **Playbook** | `~/.claude/ftm-ops/playbooks/{name}.json` | JSON with exact tool params | ftm-ops playbook engine |
| **Reference Doc** | `~/Documents/Code/panda/docs/playbooks/{name}.md` | Markdown with gotchas | Future agents + humans |

All three are kept in sync. The routine is the executable version, the playbook has exact tool parameters, and the reference doc has the context and gotchas.

## Operating Modes

### Mode 1: Explicit Capture (`/ftm capture [name]`)

User invokes directly after completing work. This is the primary mode.

### Mode 2: Auto-Suggest (via ftm-retro or ftm-mind)

After ftm-retro scores an execution, if it detects a repeatable pattern, it suggests: "This looks like a reusable workflow. Run `/ftm capture` to save it."

ftm-mind can also suggest capture when it detects the user doing something they've done before (matching experiences in the blackboard).

### Mode 3: Inline Capture (mid-session)

User says "capture this" or "save what we just did" while still working. Capture the completed portion and note what's still in progress.

## Execution Protocol

### Step 1: Gather Session Context

Read these files in order:

1. **Blackboard context**: `~/.claude/ftm-state/blackboard/context.json`
   - Extract: `current_task`, `recent_decisions`, `active_constraints`
2. **Today's daily log**: `~/.claude/ftm-ops/daily/{today}.md`
   - Extract: completed items, tool calls, blockers encountered, lessons learned
3. **Recent experiences**: `~/.claude/ftm-state/blackboard/experiences/index.json`
   - Filter for entries from today's session
   - Load matching experience files for their `lessons` and `decisions_made`
4. **Existing routines**: `ls ~/.ftm/routines/` — check if a routine for this workflow already exists
5. **Existing playbooks**: `ls ~/.claude/ftm-ops/playbooks/` — check for existing playbook
6. **Existing reference docs**: `ls ~/Documents/Code/panda/docs/playbooks/` — check for existing doc

If an existing artifact covers this workflow, the capture becomes an **update** not a create. Load the existing version and merge new learnings.

### Step 2: Identify the Pattern

From the gathered context, identify:

- **Workflow name**: kebab-case identifier (e.g., `sso-full-setup`, `vendor-onboarding`, `incident-response`)
- **Trigger**: What kicks off this workflow? (ticket type, user request, event)
- **Phases**: Major stages of the workflow (e.g., "Okta setup", "Freshservice config", "Vendor coordination")
- **Steps per phase**: Specific actions with tools, parameters, and verification
- **Decision points**: Where does the workflow branch based on input? (e.g., "SCIM supported?" → yes/no path)
- **Known issues**: API gotchas, workarounds, things that failed and were fixed
- **Environment assumptions**: What repo, what API access, what tools are available?

### Step 3: Clarifying Questions (2-4 max)

Ask the user focused questions to determine generalizability. DO NOT ask more than 4 questions. Pick the most important from:

**Generalizability questions:**
- "Is this always [SAML/OIDC] or does it vary by vendor?"
- "Are the approvers always [names] or does that change per app?"
- "Should this routine always use the API, or sometimes browser?"
- "Are there apps where [specific step] wouldn't apply?"

**Scope questions:**
- "Should this cover [adjacent step] too, or is that separate?"
- "Does this workflow change if the app supports SCIM?"
- "Should I parameterize [specific value] or hardcode it?"

**Environment questions:**
- "Does this only work in the ragnarok repo, or should it be repo-agnostic?"
- "Are there API access requirements I should document?"

### Step 4: Write the Routine (`~/.ftm/routines/{name}.yml`)

Follow the exact YAML format used by ftm-routine:

```yaml
name: {kebab-case-name}
description: |
  {What this routine does, when to use it, critical ordering rules}
trigger: manual
tags: [{relevant, tags}]

# Usage:
#   /ftm-routine {name}
#   or: "{natural language trigger}"
#
# Required context:
#   - {param}: {description}

phases:
  - name: "Phase N: {Phase Name}"
    steps:
      - name: {Step description}
        action: {api|playwright_cli|python_browser|mcp|skill|routine|comms|manual|wait}
        tool: {tool_name}
        params: {exact parameters}
        notes: |
          {Gotchas, workarounds, known issues}
        approval: {none|review|approve}

known_issues:
  - issue: "{Issue name}"
    description: "{What goes wrong}"
    fix: "{How to fix it}"
```

**Critical rules for routine writing:**
- Every step must specify the exact tool/action — no vague "do X"
- Include `notes` on steps that have known gotchas
- Use `approval: approve` for destructive or externally-visible actions
- Parameterize with `{curly_braces}` for values that change per invocation
- Include `known_issues` section with every API/tool gotcha discovered during the session
- Include environment assumptions (repo, API access, etc.) in the description

### Step 5: Write the Playbook (`~/.claude/ftm-ops/playbooks/{name}.json`)

Follow the exact JSON format used by ftm-ops playbooks:

```json
{
  "id": "{kebab-case-name}",
  "name": "{Human-readable name}",
  "description": "{What and when}",
  "trigger_keywords": ["{keywords}"],
  "input_params": {
    "{param}": {"type": "string", "description": "...", "required": true}
  },
  "steps": [
    {
      "number": 1,
      "description": "{What this step does}",
      "tool": "{exact_tool_name}",
      "tool_params": {"exact": "params"},
      "requires_human": false,
      "notes": "{Gotchas}"
    }
  ],
  "rollback": {
    "description": "{How to undo}",
    "steps": ["{exact}", "{reversal}", "{steps}"]
  },
  "known_issues": [
    {"issue": "{Name}", "description": "...", "fix": "..."}
  ],
  "confidence": 1.0,
  "version": 1,
  "executions": 0,
  "source": "captured",
  "related_links": {}
}
```

**Critical rules for playbook writing:**
- Every step must have exact `tool` and `tool_params` — ftm-ops executes these literally
- Include `rollback` section with exact reversal steps
- Set `requires_human: true` for steps needing auth, visual verification, or judgment
- `source: "captured"` distinguishes from `"manual"` or `"observed"`

### Step 6: Write the Reference Doc (`~/Documents/Code/panda/docs/playbooks/{name}.md`)

This is the human-readable + agent-readable reference that captures context, gotchas, and decision rationale:

```markdown
# {Workflow Name} — {Type} Playbook

## Purpose
{What this workflow does and when to use it}

## Execution Method
{Primary: API / Browser / Mixed — and why}

## Prerequisites
{API access, repo, tools, credentials needed}

## Phases
### Phase 1: {Name}
{Steps with exact tool calls, selectors, API endpoints}

### Phase 2: {Name}
...

## Known Issues & Gotchas
{Every API quirk, UI gotcha, and workaround discovered}

## Decision Points
{Where the workflow branches and how to decide}

## Information Needed from User
{What to collect before starting}
```

### Step 7: Record Experience

Write to `~/.claude/ftm-state/blackboard/experiences/{name}-capture.json`:

```json
{
  "id": "{name}-capture",
  "timestamp": "{ISO timestamp}",
  "task_type": "knowledge-capture",
  "tags": ["{workflow-type}", "capture", "routine", "playbook"],
  "outcome": "success",
  "description": "Captured {workflow name} as routine + playbook + reference doc",
  "lessons": ["{key learnings encoded}"],
  "files_touched": [
    "~/.ftm/routines/{name}.yml",
    "~/.claude/ftm-ops/playbooks/{name}.json",
    "~/Documents/Code/panda/docs/playbooks/{name}.md"
  ],
  "confidence": 1.0
}
```

Update `experiences/index.json` with the new entry.

### Step 8: Update Blackboard Context

Update `~/.claude/ftm-state/blackboard/context.json`:
- Set `current_task.status` to reflect capture completion
- Add to `recent_decisions`: what was captured and why

### Step 9: Report to User

Show a summary:

```
Captured: {workflow name}

Written to:
  Routine:   ~/.ftm/routines/{name}.yml
  Playbook:  ~/.claude/ftm-ops/playbooks/{name}.json
  Reference: ~/Documents/Code/panda/docs/playbooks/{name}.md

Known issues encoded: {count}
Parameters: {list of parameterized values}
Phases: {count} phases, {count} steps

Next time, run: /ftm-routine {name}
```

## Updating Existing Artifacts

If Step 1 finds an existing routine/playbook/reference doc:

1. Load the existing version
2. Show the user what exists vs what's new
3. Ask: "Update existing or create new version?"
4. If updating:
   - Merge new steps into existing phases
   - Add new known_issues (don't duplicate)
   - Increment `version` in playbook JSON
   - Add "Updated: {date} — {what changed}" to reference doc
5. If creating new:
   - Use a different name (e.g., `sso-full-setup-v2`)

## Integration Points

### ftm-mind
ftm-mind knows about ftm-capture in its capability inventory. When ftm-mind detects:
- User completing a repeatable workflow
- Matching experiences in the blackboard (same task_type done 2+ times)
- User saying anything about "remembering" or "next time"

It should suggest: "This looks like a reusable pattern. Want me to `/ftm capture` it?"

### ftm-retro
After ftm-retro scores an execution, if the workflow is repeatable, it should note: "Consider running `/ftm capture {name}` to save this as a routine."

### ftm-routine
ftm-routine reads from `~/.ftm/routines/`. Anything ftm-capture writes there becomes immediately available via `/ftm-routine {name}`.

### ftm-ops
ftm-ops's playbook engine reads from `~/.claude/ftm-ops/playbooks/`. Captured playbooks show up on the dashboard's Playbooks tab.

### Environment Awareness

When capturing, always note the environment context:
- **If in `~/Documents/Code/ragnarok`**: Full API access to Okta, Freshservice, Slack, AWS (via shared_services). Prefer API over browser.
- **If in other repos**: May not have API access. Default to browser automation or MCP tools.
- **Always document**: Which APIs are used, what credentials are needed, what repo provides the client libraries.

This prevents future sessions from trying to use APIs they don't have access to.

## Requirements

- reference: `~/.claude/ftm-state/blackboard/context.json` | required | current task and recent decisions for pattern extraction
- reference: `~/.claude/ftm-ops/daily/{today}.md` | optional | daily log for completed items and tool calls
- reference: `~/.claude/ftm-state/blackboard/experiences/index.json` | required | today's session experiences
- reference: `~/.ftm/routines/` | optional | check for existing routines before creating new one
- reference: `~/.claude/ftm-ops/playbooks/` | optional | check for existing playbooks before creating
- reference: `~/Documents/Code/panda/docs/playbooks/` | optional | check for existing reference docs before creating

## Risk

- level: low_write
- scope: writes YAML routine to ~/.ftm/routines/, JSON playbook to ~/.claude/ftm-ops/playbooks/, and Markdown reference doc to ~/Documents/Code/panda/docs/playbooks/; writes experience to blackboard; does not modify project source code
- rollback: delete the three written artifact files; remove experience entry from blackboard experiences/

## Approval Gates

- trigger: existing artifact found for this workflow name | action: show existing vs new content, ask user to confirm update or create new version
- trigger: Step 3 clarifying questions answered | action: proceed to write all three artifacts automatically (no additional gate)
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: blackboard context.json missing | action: ask user directly about the workflow to capture instead of reading from blackboard
- condition: daily log missing or empty | action: skip daily log extraction, rely on conversation context and blackboard experiences
- condition: ~/.ftm/routines/ directory doesn't exist | action: create directory before writing routine
- condition: docs/playbooks/ directory doesn't exist | action: create directory before writing reference doc
- condition: existing artifact found but cannot be parsed | action: treat as missing, create fresh artifact

## Capabilities

- mcp: none required directly (reads files and writes artifacts)
- env: none required

## Event Payloads

### capture_complete
- skill: string — "ftm-capture"
- workflow_name: string — kebab-case name of captured workflow
- routine_path: string — absolute path to written routine YAML
- playbook_path: string — absolute path to written playbook JSON
- reference_path: string — absolute path to written reference doc
- phases_count: number — number of workflow phases captured
- steps_count: number — total steps across all phases
- known_issues_count: number — API gotchas encoded

### experience_recorded
- skill: string — "ftm-capture"
- experience_path: string — path to written experience file
- workflow_name: string — name of captured workflow

### known_issue_recorded
- skill: string — "ftm-capture"
- workflow_name: string — workflow this issue belongs to
- issue: string — issue name
- fix: string — remediation approach encoded
