# FTM Configuration Reference

Configuration lives in `~/.claude/ftm-config.yml`. This file controls model selection, execution behavior, skill routing, and session management.

The repository ships a complete default configuration at `ftm-config.default.yml`. When you install ftm, this file is copied to `~/.claude/ftm-config.yml`. You can edit it directly or use `/ftm-config` to make changes interactively.

---

## Table of Contents

- [Profile System](#profile-system)
- [Execution Settings](#execution-settings)
- [Skills Section](#skills-section)
- [Session Settings](#session-settings)
- [Complete Example](#complete-example)
- [Common Scenarios](#common-scenarios)

---

## Profile System

The `profile` field selects which model profile is active. A profile assigns a specific model to each of three task stages.

```yaml
profile: balanced  # quality | balanced | budget | custom | inherit
```

### Built-in Profiles

| Profile | `planning` | `execution` | `review` |
|---------|-----------|-------------|---------|
| `quality` | opus | opus | sonnet |
| `balanced` | opus | sonnet | sonnet |
| `budget` | sonnet | sonnet | haiku |
| `inherit` | inherit | inherit | inherit |

**Stages**:
- `planning` — Used by brainstorm, research, and plan generation steps.
- `execution` — Used by agent task implementation inside `ftm-executor`.
- `review` — Used by audit, debug review, and council synthesis.

### The `inherit` Value

Setting a stage to `inherit` tells ftm to use whatever model the current Claude Code session is running on. This is useful when you want ftm to match the context you're already in, rather than switching models.

The `inherit` profile sets all three stages to `inherit`.

### Custom Profile

The `custom` profile lets you mix models freely:

```yaml
profiles:
  custom:
    planning: opus
    execution: sonnet
    review: haiku
```

Set `profile: custom` to activate it. Edit the `custom` section under `profiles:` to adjust the mix.

### Overriding Individual Profiles

All five profile definitions live under `profiles:`. You can edit any of them. For example, to make the `balanced` profile use haiku for review:

```yaml
profiles:
  balanced:
    planning: opus
    execution: sonnet
    review: haiku  # changed from sonnet
```

---

## Execution Settings

```yaml
execution:
  max_parallel_agents: 5
  auto_audit: true
  progress_tracking: true
  approval_mode: auto  # auto | plan_first | always_ask
```

### `max_parallel_agents`

**Type**: integer
**Default**: `5`

Maximum number of agents dispatched simultaneously during a `ftm-executor` wave. Increase for faster execution on large plans. Decrease if you want more sequential, observable progress or if you're on a rate-limited API tier.

### `auto_audit`

**Type**: boolean
**Default**: `true`

When `true`, `ftm-audit` runs automatically after each `ftm-executor` task completes. This catches dead code, broken imports, and wiring issues as they are introduced rather than at the end of a plan.

Set to `false` if you want to run audits manually or if the audit overhead is too slow for your workflow.

### `progress_tracking`

**Type**: boolean
**Default**: `true`

When `true`, `ftm-executor` writes a `PROGRESS.md` file to the blackboard during multi-agent runs. This file tracks wave progress and is used by `ftm-resume` to restore mid-execution state.

### `approval_mode`

**Type**: string
**Default**: `auto`
**Options**: `auto` | `plan_first` | `always_ask`

Controls whether a plan is shown and approved before execution begins.

| Mode | Behavior |
|------|---------|
| `auto` | No approval gate. Micro/small execute immediately. Medium shows steps then runs. Large routes to brainstorm or executor without a separate gate. |
| `plan_first` | For medium and large tasks, present a numbered plan and wait for explicit approval before executing anything. Supports partial approval: skip steps, modify steps, or add steps before running. |
| `always_ask` | Same as `plan_first` but also applies to small tasks. Only micro tasks (single obvious edits) skip the gate. |

`plan_first` is recommended for collaborative work or when you want visibility into what will happen before it does.

**Note**: Regardless of `approval_mode`, external-facing actions (Slack, email, Jira mutations, remote git pushes, deploys) always require explicit approval.

---

## Skills Section

The `skills` section enables or disables individual skills for routing. A disabled skill is invisible to `ftm-mind` — it will not be considered as a routing target.

```yaml
skills:
  ftm-brainstorm: { enabled: true }
  ftm-executor: { enabled: true }
  ftm-debug: { enabled: true }
  ftm-audit: { enabled: true }
  ftm-council: { enabled: true }
  ftm-codex-gate: { enabled: true }
  ftm-intent: { enabled: true }
  ftm-diagram: { enabled: true }
  ftm-browse: { enabled: true }
  ftm-pause: { enabled: true }
  ftm-resume: { enabled: true }
  ftm-upgrade: { enabled: true }
  ftm-retro: { enabled: true }
  ftm-config: { enabled: true }
  ftm-git: { enabled: true }
  ftm-mind: { enabled: true }
```

### Disabling a Skill

Set `enabled: false` to prevent routing to that skill:

```yaml
skills:
  ftm-codex-gate: { enabled: false }  # skip Codex validation
  ftm-council: { enabled: false }     # skip multi-model deliberation
```

Disabled skills are still installed. They can be re-enabled at any time by changing the flag back to `true`.

### Disabling `ftm-mind`

Setting `ftm-mind: { enabled: false }` removes the OODA routing loop from consideration. Use only if you are invoking individual skills directly and want no re-orientation pass.

---

## Session Settings

```yaml
session:
  auto_pause_on_exit: false
  state_retention_days: 7
```

### `auto_pause_on_exit`

**Type**: boolean
**Default**: `false`

When `true`, ftm automatically saves session state (equivalent to running `/ftm pause`) when the conversation ends. This preserves mid-execution state so it can be restored with `/ftm resume` in a new conversation.

When `false`, you must manually run `/ftm pause` before ending a session if you want to resume later.

### `state_retention_days`

**Type**: integer
**Default**: `7`

Number of days before blackboard state files are archived. Session snapshots older than this threshold are moved to an archive location during cleanup. Experience files and patterns are not subject to this retention policy — only session-scoped `STATE.md` pause files.

---

## Complete Example

Default configuration with all fields:

```yaml
profile: balanced

profiles:
  quality:
    planning: opus
    execution: opus
    review: sonnet

  balanced:
    planning: opus
    execution: sonnet
    review: sonnet

  budget:
    planning: sonnet
    execution: sonnet
    review: haiku

  inherit:
    planning: inherit
    execution: inherit
    review: inherit

  custom:
    planning: opus
    execution: sonnet
    review: haiku

execution:
  max_parallel_agents: 5
  auto_audit: true
  progress_tracking: true
  approval_mode: auto

skills:
  ftm-brainstorm: { enabled: true }
  ftm-executor: { enabled: true }
  ftm-debug: { enabled: true }
  ftm-audit: { enabled: true }
  ftm-council: { enabled: true }
  ftm-codex-gate: { enabled: true }
  ftm-intent: { enabled: true }
  ftm-diagram: { enabled: true }
  ftm-browse: { enabled: true }
  ftm-pause: { enabled: true }
  ftm-resume: { enabled: true }
  ftm-upgrade: { enabled: true }
  ftm-retro: { enabled: true }
  ftm-config: { enabled: true }
  ftm-git: { enabled: true }
  ftm-mind: { enabled: true }

session:
  auto_pause_on_exit: false
  state_retention_days: 7
```

---

## Common Scenarios

### Minimize cost on a personal project

```yaml
profile: budget
execution:
  max_parallel_agents: 3
  auto_audit: false
```

### Maximum quality for production work

```yaml
profile: quality
execution:
  max_parallel_agents: 5
  auto_audit: true
  approval_mode: plan_first
```

### Always review plans before execution

```yaml
execution:
  approval_mode: plan_first
```

### Disable Codex validation (if Codex CLI is not installed)

```yaml
skills:
  ftm-codex-gate: { enabled: false }
```

### Auto-save session state on every exit

```yaml
session:
  auto_pause_on_exit: true
```

### Use the current session's model for everything

```yaml
profile: inherit
```
