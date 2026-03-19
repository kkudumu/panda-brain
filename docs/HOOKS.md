# FTM Hooks — Programmatic Guardrails

Hooks are shell scripts that run at specific points in Claude Code's lifecycle. Unlike skill instructions (which the model can rationalize past), hooks execute as real programs and can block actions, inject reminders, or enforce workflows.

## Installation

Hooks are installed automatically by `install.sh` into `~/.claude/hooks/`. To activate them, add the hook configuration to your `~/.claude/settings.json`.

### Quick Setup

After running `install.sh`, add this to your `settings.json` hooks section:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/ftm-plan-gate.sh",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "mcp__slack__slack_post_message|mcp__slack__slack_reply_to_thread|mcp__gmail__send_email",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/ftm-drafts-gate.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/ftm-discovery-reminder.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/ftm-blackboard-enforcer.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## Hooks Reference

### ftm-plan-gate.sh

**Event:** PreToolUse (Edit, Write)

Prevents Claude from grinding through file edits without presenting a plan first. Tracks edit count per session — soft reminder on edits 1-2, escalated warning on 3+.

**How it works:**
- Checks for a plan marker at `~/.claude/ftm-state/.plan-presented`
- If no marker exists and edits are happening, injects context telling Claude to stop and plan
- Claude creates the marker after presenting a plan to the user

**Bypasses (always allowed):**
- Skill files (`~/.claude/skills/`)
- FTM state files (`~/.claude/ftm-state/`)
- Drafts (`.ftm-drafts/`)
- Documentation files (INTENT.md, ARCHITECTURE.mmd, STYLE.md, DEBUG.md, CLAUDE.md, .gitignore)

**State files:**
- `~/.claude/ftm-state/.plan-presented` — session ID marker (created by Claude after presenting plan)
- `~/.claude/ftm-state/.edit-count` — edit counter per session

---

### ftm-drafts-gate.sh

**Event:** PreToolUse (Slack post, Slack reply, Gmail send)

Hard-blocks outbound messages unless a draft was saved to `.ftm-drafts/` in the last 30 minutes. Creates an audit trail of all messages Claude drafts on your behalf.

**How it works:**
- Checks for `.md` files modified in the last 30 minutes in:
  - `<project>/.ftm-drafts/` (project-level)
  - `~/.claude/ftm-drafts/` (global fallback)
- If no recent draft found: returns `permissionDecision: deny`
- If draft exists: allows through (other guards like `external-action-guard.sh` still apply)

**Pairs with:** ftm-mind section 3.5 (draft-before-send protocol)

---

### ftm-blackboard-enforcer.sh

**Event:** Stop

Prevents Claude from ending a session without recording what it learned to the blackboard. If meaningful work was done (3+ edits or ftm skills invoked) but no experience was recorded, blocks the stop.

**How it works:**
- Checks edit counter and `context.json` for skills_invoked
- If meaningful work detected, checks for today's experience files in `~/.claude/ftm-state/blackboard/experiences/`
- If no experience recorded: blocks stop with instructions to write the blackboard
- Has infinite-loop guard via `stop_hook_active` check

**State files checked:**
- `~/.claude/ftm-state/.edit-count`
- `~/.claude/ftm-state/blackboard/context.json`
- `~/.claude/ftm-state/blackboard/experiences/` (looks for today's files)

---

### ftm-discovery-reminder.sh

**Event:** UserPromptSubmit

Detects when a user's prompt involves external systems or stakeholder coordination and injects a reminder about the discovery interview before Claude starts working.

**Trigger patterns:**
- System changes: reroute, migrate, update integration, change endpoint, switch from/to
- Coordination: draft message, notify about, check with, coordinate with
- Workflow changes: jira automation, freshservice automation, update workflow

**Skip signals (no reminder injected):**
- "just do it", "no questions", "skip the interview"
- "here's the slack thread", "per the conversation"

**Pairs with:** ftm-mind Orient section 10 (Discovery Interview)

## Dependencies

All hooks require `jq` for JSON parsing. Install with:

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

## Troubleshooting

**Hook not firing:** Check that the `matcher` regex in settings.json matches the tool name. Use `Ctrl+O` in Claude Code for verbose output.

**Hook blocking unexpectedly:** Check the state files listed above. Reset with:
```bash
rm -f ~/.claude/ftm-state/.edit-count ~/.claude/ftm-state/.plan-presented
```

**Testing a hook manually:**
```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/test.py"},"cwd":"/tmp"}' | ~/.claude/hooks/ftm-plan-gate.sh
```
