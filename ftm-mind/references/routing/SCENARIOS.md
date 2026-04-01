# Routing Scenarios

Use these as behavioral tests for the Orient → Decide pipeline.

| Input | What Orient notices | Decision |
|---|---|---|
| `debug this flaky test` | bug, uncertainty, likely multiple hypotheses | route to `ftm-debug` |
| `help me think through auth design` | ideation, architecture, not implementation yet | route to `ftm-brainstorm` |
| `execute ~/.claude/plans/foo.md` | explicit plan path and execution ask | route to `ftm-executor` |
| `rename this variable` | one obvious local edit, tiny blast radius | handle directly as `micro` |
| `what would other AIs think about this approach` | explicit multi-model request | route to `ftm-council` |
| `audit the wiring` | structural verification request | route to `ftm-audit` |
| Jira ticket URL only | ticket-driven work, intent not yet clear | fetch via `mcp-atlassian-personal` (configured name — see `ops.mcp_account_rules` in ftm-config.yml), then re-orient |
| `check my calendar and draft a slack message` | mixed-domain workflow, read + external draft/send boundary | read calendar, draft Slack, ask before send |
| `make this better` | ambiguous, insufficient anchor | ask one focused clarifying question |
| `/ftm help` | explicit help/menu request | show help menu |
| `I just committed the fix, now check it` | continuation, recent commit validation | inspect diff, run tests or audit, then report |
| `/ftm-debug auth race condition` | explicit skill choice | respect explicit route to `ftm-debug` |
| `/ftm-brainstorm replacement for Okta hooks` | explicit design-phase route | respect explicit route to `ftm-brainstorm` |
| `open the page and tell me what looks broken` | visual/browser task | route to `ftm-browse` or use browser support if already in-flow |
| `add error handling to the API routes` | medium task, multi-file, `plan_first` mode | present numbered plan for approval, wait for user response, then execute approved steps |
| `refactor auth to support OAuth` (with `plan_first`) | medium-large, multi-file with dependencies | present plan with 5-7 steps, user says "skip 4, for step 3 use passport.js" → adjust and execute |
