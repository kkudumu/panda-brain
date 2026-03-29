# Phase 0.7 — Model Profile and Agent Mode Loading

## Reading ftm-config.yml

Read `~/.claude/ftm-config.yml` to determine which models and permission mode to use when spawning agents. If the file doesn't exist, use these balanced defaults:

| Role | Default Model |
|------|--------------|
| Planning agents | opus |
| Execution agents | sonnet |
| Review/audit agents | sonnet |

## Model Assignment by Phase

When spawning agents in subsequent phases, pass the `model` parameter based on role:

| Phase | Agent Role | Model Key |
|-------|-----------|-----------|
| Phase 0.5 (plan checking) | Planning | `planning` |
| Phase 2 (team assembly) | Planning | `planning` |
| Phase 4 (task execution) | Execution | `execution` |
| Phase 4.5 (audit) | Review | `review` |

If the profile specifies `inherit` for a role, omit the `model` parameter entirely — the agent uses the session default.

## Agent Permission Mode

Read `execution.agent_mode` from ftm-config.yml. Pass this as the `mode` parameter on **every** Agent tool call in all phases. This controls the permission level for spawned agents.

| Value | Behavior |
|-------|----------|
| `bypassPermissions` | Agent runs without prompting user (default) |
| `acceptEdits` | Agent can edit files but prompts for other actions |
| `dontAsk` | Agent makes all decisions autonomously |
| `default` | Uses Claude Code's default permission behavior |
| `auto` | Automatic permission selection |

If `agent_mode` is not set in config, default to `bypassPermissions`.

## Example ftm-config.yml Structure

```yaml
execution:
  agent_mode: bypassPermissions   # permission mode for all spawned agents

profiles:
  balanced:
    planning: opus
    execution: sonnet
    review: sonnet
  fast:
    planning: sonnet
    execution: sonnet
    review: sonnet
  quality:
    planning: opus
    execution: opus
    review: opus
```
