# Environment Discovery Protocol

This is an Orient sub-phase that runs automatically on the first request in a session, then caches results for 15 minutes.

## Discovery Sequence

### 1. MCP Server Probe

List connected MCP servers by checking which tool namespaces are available.

For each known MCP server (serena, supabase, playwright, freshservice-mcp, slack, gmail, mcp-atlassian-personal, lusha, apple-doc-mcp), check if tools with that prefix exist.

Record: server name, tools available, verified status.

### 2. CLI Probe

Check for installed CLIs on PATH:

- Essential: `node`, `python3`, `git`, `npm`
- FTM tools: `knip`, `codex` (OpenAI Codex CLI)
- Optional: `gh` (GitHub CLI), `jq`, `curl`

For each: run `which <cmd>` and record path + version if available.

### 3. Environment Variable Check

Check for key env vars (existence only, never log values):

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`
- `JIRA_API_TOKEN`, `FRESHSERVICE_API_KEY`, `SLACK_BOT_TOKEN`

Record: var name, is_set (boolean).

### 4. Write capabilities.json

Write to `~/.claude/ftm-state/blackboard/capabilities.json`:

```json
{
  "discovered_at": "2026-03-20T10:30:00Z",
  "expires_at": "2026-03-20T10:45:00Z",
  "capabilities": [
    {
      "name": "serena",
      "type": "mcp",
      "verified": true,
      "last_verified_at": "2026-03-20T10:30:00Z",
      "operations_verified": ["find_symbol", "search_for_pattern"],
      "confidence": "verified"
    },
    {
      "name": "node",
      "type": "cli",
      "verified": true,
      "path": "/usr/local/bin/node",
      "version": "20.11.0",
      "confidence": "verified"
    }
  ]
}
```

### 5. Cache Logic

- If `capabilities.json` exists and `expires_at` > now, skip re-probing.
- If stale or missing, re-probe.
- User can force refresh by saying "refresh capabilities" or "recon".

## How This Affects Planning

When ftm-mind generates or routes to a plan, it MUST:

- Check `capabilities.json` for every tool/MCP/CLI the plan references.
- If a required capability is `verified: false` or missing, use the skill's fallback from its manifest (## Fallbacks section).
- If no fallback exists for a missing capability, warn the user: "Plan step N requires [capability] which is not available. Skip or find alternative?"
