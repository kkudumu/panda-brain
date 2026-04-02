---
name: ftm-council-chat
description: AIM-styled browser chatroom where Claude, Codex, and Gemini hold real-time conversations with the user as a full participant. Use when user says "chatroom", "aim chat", "council chat", "live debate", "open the chatroom", or "council-chat".
---

# ftm-council-chat

An AIM (AOL Instant Messenger) styled browser chatroom where Claude, Codex, and Gemini hold real-time conversations with the user as a full participant. Each model has full codebase access via its CLI, a randomly-generated nostalgic screenname, and a distinct adversarial persona that forces genuine disagreement.

## Instructions

### Launch

Run the chatroom server and open the browser:

```bash
cd ~/.claude/skills/ftm-council-chat/app && node server.js --topic "TOPIC_HERE"
```

Replace `TOPIC_HERE` with the user's discussion topic.

### With Council Escalation Context

When escalated from ftm-council (after 3+ rounds without consensus):

```bash
cd ~/.claude/skills/ftm-council-chat/app && node server.js --topic "TOPIC" --context '{"topic":"...","rounds_completed":3,"positions":{"claude":"...","codex":"...","gemini":"..."},"open_questions":["..."]}'
```

### What Happens

1. Server starts and opens browser automatically
2. Sign On screen appears — user clicks to enter (satisfies browser audio permission)
3. Models "sign on" one by one with AIM door sounds
4. Claude speaks first (Skeptic persona), then Codex (Pragmatist), then Gemini (Contrarian)
5. User can type messages and @mention specific models
6. Conversation continues in round-robin until user closes the browser or Ctrl+C

### Ending a Chat

Conversations end through one of three triggers:

1. **User command**: Type `/done`, `wrap it up`, `conclude`, `that's enough`, or `end chat` in the chatroom
2. **Auto-consensus**: The facilitator detects when 2-of-3 models substantially agree (after round 2+)
3. **Round limit**: Configurable max rounds (default: 10) — chat wraps up when reached

When any trigger fires:
1. All models give a final 1-sentence position in parallel
2. A verdict JSON is generated and written to `/tmp/council-chat-verdict-{sessionId}.json`
3. The verdict is displayed in the browser as a styled card
4. The server shuts down after 5 seconds

### Reading the Verdict

After the server exits, read the verdict file:

```bash
cat /tmp/council-chat-verdict-*.json | jq .
```

Verdict JSON structure:
```json
{
  "topic": "Redis vs SQLite",
  "rounds": 5,
  "reason": "auto_consensus",
  "positions": {
    "claude": "Final 1-sentence position...",
    "codex": "Final 1-sentence position...",
    "gemini": "Final 1-sentence position..."
  },
  "consensus": {
    "detected": true,
    "agreed_by": ["claude", "codex"],
    "dissent": "gemini"
  },
  "timestamp": "2026-04-02T12:00:00.000Z"
}
```

### Model Personas

- **Claude = The Skeptic**: Pokes holes, challenges assumptions, asks "but what about..."
- **Codex = The Pragmatist**: Focuses on implementation reality, calls out hand-waving
- **Gemini = The Contrarian**: Finds the weakest assumption and attacks it, proposes alternatives

### Features

- Windows 98 / AIM visual theme with authentic sound effects
- Real-time typing indicators and "researching..." status
- Gemini responses stream character-by-character
- @mention autocomplete for model screennames
- SQLite conversation persistence with rolling 20-message context window
- Randomized nostalgic AIM screennames per session
- Three wrap-up triggers: user command, auto-consensus detection, round limit
- Structured verdict JSON with consensus analysis
- AIM-styled verdict card in browser

### Configuration

Add to `~/.claude/ftm-config.yml`:

```yaml
council_chat:
  round_limit: 10        # max rounds before auto-wrap-up
  auto_consensus: true   # detect when 2-of-3 models agree
  wrap_up_keywords:      # user messages that trigger wrap-up
    - "/done"
    - "wrap it up"
    - "conclude"
    - "that's enough"
    - "end chat"
```

All settings are optional — defaults are used if the section is missing.

## Requirements

- tool: `node` | required | Node.js runtime for the server
- cli: `codex` | required | Codex CLI for model turns
- cli: `gemini` | required | Gemini CLI for model turns
- cli: `claude` | required | Claude CLI for model turns
- config: none

## Risk

- level: high_write
- scope: Spawns child processes (codex, gemini, claude CLIs) that can read/write files in the user's project directory. Opens a local web server. Opens the default browser.
- rollback: Ctrl+C kills all processes. No persistent changes made by the chatroom itself.

## Approval Gates

- trigger: server launch | action: auto (user explicitly invoked the skill)
- trigger: model CLI execution | action: auto (CLIs run with their own permission models)

## Fallbacks

- condition: A CLI is not installed or not authenticated | action: Health check reports actionable error message before launching
- condition: A model errors during a turn | action: Skip to next model, show error in chat as away message
- condition: Port 3000 is in use | action: Auto-retry ports 3001-3010

## Capabilities

- cli: `node` | required
- cli: `codex` | required  
- cli: `gemini` | required
- cli: `claude` | required
- env: none
