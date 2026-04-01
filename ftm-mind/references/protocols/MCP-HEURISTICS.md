# MCP Matching Heuristics and Chaining

## Matching Rules

Use the smallest relevant MCP set.

- Jira issue key or Atlassian URL → `mcp-atlassian-personal` (default; configured via `ops.mcp_account_rules.personal` in ftm-config.yml)
- "internal docs", "runbook", "Klaviyo", "Glean" → `glean_default`
- "how do I use X library" → `context7`
- "calendar", "meeting", "free time" → `google-calendar`
- "Slack", "channel", "thread", "notify" → `slack`
- "email", "Gmail", "draft" → `gmail`
- "ticket", "hardware", "access request" → `freshservice-mcp`
- "browser", "screenshot", "look at the page" → `playwright`
- "profile performance in browser" → `chrome-devtools`
- "talk through trade-offs" → `sequential-thinking`
- "SwiftUI" or Apple framework names → `apple-doc-mcp`
- "find contact/company" → `lusha`

## Multi-MCP Chaining

Detect mixed-domain requests early.

Examples:
- "check my calendar and draft a Slack message" → `google-calendar` + `slack`
- "read the Jira ticket, inspect the repo, then propose a fix" → `mcp-atlassian-personal` + `git`
- "search internal docs, then update a Confluence page" → `glean_default` + `mcp-atlassian-personal`

Rules:
- parallelize reads when safe
- gather state before proposing writes
- chain writes sequentially
