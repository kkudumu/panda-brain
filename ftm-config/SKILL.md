---
name: ftm-config
description: Configure ftm skill settings including model profiles, execution preferences, and defaults. Use when user says "ftm config", "ftm settings", "set ftm profile", "ftm model", or wants to change how ftm skills behave.
---

## Events

### Emits
- `task_completed` — when a configuration change is validated, saved, and confirmed to the user

### Listens To
(none — ftm-config is explicitly invoked by the user and does not respond to events)

# FTM Config

Manage configuration for all ftm skills, including model profiles, execution preferences, and session settings.

## Config File Location

`~/.claude/ftm-config.yml`

This is the single source of truth for all ftm skill behavior. Every ftm skill reads from this file at startup.

## Config Schema

```yaml
# FTM Skills Configuration
# Edit this file or use /ftm-config to modify settings

# Model profiles control which model is used at each stage
# Options: opus, sonnet, haiku, inherit (use session default)
profile: balanced  # quality | balanced | budget | custom | inherit

profiles:
  quality:
    planning: opus      # brainstorm, research, plan generation
    execution: opus     # agent task implementation
    review: sonnet      # audit, debug review, council synthesis

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

# Execution preferences
execution:
  max_parallel_agents: 5          # max agents dispatched simultaneously
  auto_audit: true                # run ftm-audit after each executor task
  progress_tracking: true         # write PROGRESS.md during execution

# Session management
session:
  auto_pause_on_exit: false       # automatically save state when conversation ends
  state_retention_days: 7         # archive states older than this
```

## Instructions

### Step 1: Read Current Config

Read `~/.claude/ftm-config.yml`. If it does not exist, create it with the default configuration (balanced profile active, all defaults as shown in the schema above). Use the file-creator pattern or Write tool to create the file.

### Step 2: Determine Intent

Parse the user's input to determine what they want:

- **No arguments** (bare `/ftm-config`): Display current configuration.
- **`set profile <name>`**: Change the active profile.
- **`set profile custom`**: Activate the custom profile, then interactively ask which model to use for each stage (planning, execution, review).
- **`set <dotted.path> <value>`**: Update a specific setting (e.g., `set execution.max_parallel_agents 3`).
- **`enable <skill-name>`** / **`disable <skill-name>`**: Enable or disable a skill in ftm-mind routing.
- **`reset`**: Restore all settings to defaults.
- **`show profiles`**: Display all available profiles side by side.
- **`show skills`**: Display all skills and their enabled/disabled status.

### Step 3: Display Current Configuration (No Args)

When displaying the config, format it clearly:

```
FTM Configuration
====================

Active Profile: balanced

  Planning   → opus    (brainstorm, research, plan generation)
  Execution  → sonnet  (agent task implementation)
  Review     → sonnet  (audit, debug review, council synthesis)

Execution Settings:
  Max Parallel Agents:  5
  Auto Audit:           true
  Progress Tracking:    true

Session Settings:
  Auto Pause on Exit:   false
  State Retention Days: 7
```

### Step 4: Apply Changes

When the user requests a change:

1. **Validate inputs**:
   - Model names must be one of: `opus`, `sonnet`, `haiku`, `inherit`. Reject anything else with a clear error.
   - Profile names must be one of: `quality`, `balanced`, `budget`, `custom`, `inherit`. Reject anything else.
   - Numeric values must be positive integers where applicable.
   - Boolean values must be `true` or `false`.

2. **Show before/after**:
   ```
   Changing active profile:
     Before: balanced (opus / sonnet / sonnet)
     After:  quality  (opus / opus / sonnet)
   ```

3. **Save changes**: Write the updated YAML back to `~/.claude/ftm-config.yml`.

4. **Confirm**: Display the updated configuration section that changed.

### Step 5: Handle Custom Profile

When the user sets `profile custom`:

1. Show the current custom profile settings.
2. Ask: "Which model for **planning** (brainstorm, research)? [opus/sonnet/haiku/inherit]"
3. Ask: "Which model for **execution** (agent tasks, code writing)? [opus/sonnet/haiku/inherit]"
4. Ask: "Which model for **review** (audit, debug, council)? [opus/sonnet/haiku/inherit]"
5. Validate each answer, save, and display the final custom profile.

If the user provides all three in one line (e.g., `set profile custom opus haiku sonnet`), parse them positionally as planning/execution/review without asking interactively.

### Step 6: Handle Reset

When the user says `reset`:

1. Show current configuration.
2. Confirm: "This will restore all ftm settings to defaults. Proceed?"
3. If confirmed, write the default configuration to `~/.claude/ftm-config.yml`.
4. Display the restored defaults.

## Valid Model Options

| Model | Description | Best For |
|-------|-------------|----------|
| `opus` | Most capable, highest quality | Complex planning, architecture decisions |
| `sonnet` | Balanced capability and speed | General execution, code writing, reviews |
| `haiku` | Fastest, most efficient | Simple reviews, quick checks, budget tasks |
| `inherit` | Use session default | When you want the conversation's current model |

## Valid Profiles

| Profile | Planning | Execution | Review | Use Case |
|---------|----------|-----------|--------|----------|
| `quality` | opus | opus | sonnet | Maximum quality, complex projects |
| `balanced` | opus | sonnet | sonnet | Good default for most work |
| `budget` | sonnet | sonnet | haiku | Token-efficient, simpler tasks |
| `inherit` | inherit | inherit | inherit | Use whatever model the session runs |
| `custom` | (user-defined) | (user-defined) | (user-defined) | Full user control |

## How Other FTM Skills Use This Config

All ftm skills should read `~/.claude/ftm-config.yml` at the start of execution to determine which model to use when spawning agents.

### Reading the Config

At the beginning of any ftm skill execution:

1. Read `~/.claude/ftm-config.yml`.
2. Look at the `profile` field to determine which profile is active.
3. Look up that profile under `profiles.<profile_name>` to get the model for each stage.
4. If the config file does not exist, use "balanced" defaults: `opus` for planning, `sonnet` for execution, `sonnet` for review.

### Mapping Stages to FTM Skills

| Stage | Config Key | FTM Skills That Use It |
|-------|-----------|--------------------------|
| **Planning** | `profiles.<active>.planning` | ftm-brainstorm, ftm (research/plan generation phase) |
| **Execution** | `profiles.<active>.execution` | ftm-executor (all spawned task agents) |
| **Review** | `profiles.<active>.review` | ftm-audit, ftm-debug, ftm-council (synthesis phase) |

### Spawning Agents with the Correct Model

When spawning agents, use the `model` parameter on the Agent tool:

- **For planning agents** (research, brainstorming, plan generation):
  Use the profile's `planning` model.

- **For execution agents** (implementing tasks, writing code):
  Use the profile's `execution` model.

- **For review agents** (audit, debug review, council synthesis):
  Use the profile's `review` model.

If the model value is `"inherit"`, omit the `model` parameter entirely so the agent inherits the session's current model.

### Example Resolution

Given this config:
```yaml
profile: balanced
profiles:
  balanced:
    planning: opus
    execution: sonnet
    review: sonnet
```

- `ftm-brainstorm` spawns its research agents with `model: opus`
- `ftm-executor` spawns task agents with `model: sonnet`
- `ftm-audit` spawns review agents with `model: sonnet`
- `ftm-council` spawns synthesis agents with `model: sonnet`

### Execution Preferences

Other ftm skills should also respect:

- **`execution.max_parallel_agents`**: Do not spawn more agents simultaneously than this number. Queue excess agents.
- **`execution.auto_audit`**: If `true`, `ftm-executor` should automatically invoke `ftm-audit` after each task completes.
- **`execution.progress_tracking`**: If `true`, write status updates to `PROGRESS.md` in the workspace during execution.

### Session Preferences

- **`session.auto_pause_on_exit`**: If `true`, ftm skills should automatically save state (like `ftm-pause`) when the conversation is ending.
- **`session.state_retention_days`**: When resuming, archive or clean up state files older than this many days.

## Examples

### View current config
```
User: /ftm-config
→ Displays full current configuration
```

### Switch to quality profile
```
User: /ftm-config set profile quality
→ Shows before/after, saves change
```

### Set custom profile with specific models
```
User: /ftm-config set profile custom opus haiku sonnet
→ Sets custom profile: planning=opus, execution=haiku, review=sonnet
```

### Change a specific setting
```
User: /ftm-config set execution.max_parallel_agents 3
→ Updates max parallel agents from 5 to 3
```

### Disable auto-audit
```
User: /ftm-config set execution.auto_audit false
→ Disables automatic audit after executor tasks
```

### Disable a skill
```
User: /ftm-config disable ftm-council
→ Sets skills.ftm-council.enabled: false — ftm-mind will no longer route to it
```

### Show skill status
```
User: /ftm-config show skills
→ Displays all skills with enabled/disabled status
```

### Reset to defaults
```
User: /ftm-config reset
→ Confirms, then restores all settings to defaults
```

### Show all profiles
```
User: /ftm-config show profiles
→ Displays table of all profiles with their model assignments
```

## Troubleshooting

### Config file is missing
The skill will create `~/.claude/ftm-config.yml` with default settings automatically. No action needed.

### Invalid model name
Only `opus`, `sonnet`, `haiku`, and `inherit` are valid. The skill will reject other values and show the valid options.

### Config file is malformed
If the YAML cannot be parsed, the skill will back up the broken file as `~/.claude/ftm-config.yml.bak` and create a fresh default config.

### Changes not taking effect
Other ftm skills read the config at startup. If a ftm skill is already running, it will use the config that was active when it started. Changes apply to the next invocation.

## Requirements

- config: `~/.claude/ftm-config.yml` | optional | main config file (created with defaults if missing)

## Risk

- level: low_write
- scope: reads and writes ~/.claude/ftm-config.yml only; backs up malformed config to ftm-config.yml.bak before overwriting; no project files touched
- rollback: restore from ~/.claude/ftm-config.yml.bak or delete the file to reset to defaults on next invocation

## Approval Gates

- trigger: reset command issued | action: show current config and ask "Proceed?" before restoring defaults
- trigger: invalid model name or profile name provided | action: reject with clear error showing valid options, do not write
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: ftm-config.yml missing | action: create file with default balanced profile and all defaults
- condition: ftm-config.yml malformed YAML | action: back up as ftm-config.yml.bak, create fresh default config
- condition: invalid model or profile value provided | action: reject and show valid options without writing

## Capabilities

- env: none required

## Event Payloads

### task_completed
- skill: string — "ftm-config"
- action: string — "display" | "set_profile" | "set_value" | "reset" | "show_profiles" | "show_skills"
- changed_key: string | null — dotted path of changed setting
- old_value: string | null — value before change
- new_value: string | null — value after change
