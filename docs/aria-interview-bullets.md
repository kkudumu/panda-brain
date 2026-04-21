# Feed The Machine — ARIA Interview talking points

> Show the diagram first, then use these bullets to anchor every answer back to concrete code you wrote.

---

## "Design and build LLM-powered applications"

- Built a production TypeScript daemon (`@ftm/daemon`) that orchestrates Claude, Codex, Gemini, and Ollama as interchangeable backends through a unified `ModelAdapter` interface — swap models with a config change, zero code changes.
- Implemented the OODA cognitive loop (`ooda.ts`) as the reasoning core: every task goes through Observe → Orient → Decide → Act before any model is called. This prevents the most common LLM failure mode — acting before understanding.
- Built 26 skills (markdown instruction sets) for Claude Code covering the full developer workflow: research, planning, execution, debugging, code review, CI gate, multi-model debate, and daily activity logging.
- Shipped an Electron desktop app (`ftm-desktop`, Svelte 5) with an animated ASCII machine UI that streams live task state over WebSocket.

---

## "Build and maintain AI integration pipelines"

- Designed a 4-adapter registry (`AdapterRegistry`) with health-checking and TTL-cached availability — the router automatically falls back through `claude → codex → gemini → ollama` when a model is unavailable, with no user-visible disruption.
- Built 3 configurable model profiles (`quality`, `balanced`, `budget`) that assign different models to planning, execution, and review roles — cost-optimized routing without sacrificing plan quality.
- The MCP server (`@ftm/mcp`) exposes 7 tools over stdio JSON-RPC, letting any MCP-compatible AI CLI (Claude, Codex, Gemini) read and write to the same shared SQLite store without port conflicts.
- Integrated with Claude Code's hook system (15 shell hooks): `PreToolUse`, `PostToolUse`, session start/end — these fire automatically and enforce guard rules, plan gates, and secret scanning without the user having to remember.

---

## "Develop full-stack AI features end-to-end"

- Owned the full stack: TypeScript daemon + WebSocket API + Electron/Svelte frontend + CLI + MCP server + 26 Claude Code skills + 15 shell automation hooks.
- Built the WebSocket server (`server.ts`) that streams every internal event to connected clients in real time — the UI and CLI show live task progress, step-by-step execution, and guard triggers as they happen.
- The CLI (`@ftm/cli`) supports `submit`, `status`, `history`, `approve`, and `doctor` commands — the approve command implements human-in-the-loop confirmation gates for high-risk plan steps before execution continues.

---

## "Architect and manage CI/CD pipelines for AI systems"

- Set up semantic-release with automated CHANGELOG generation, conventional commits enforcement via commitlint, and Husky pre-commit hooks — every merge to main produces a versioned npm publish automatically.
- Built a guard module (`guard.ts`) with configurable rules that block destructive operations (pattern-matched: `rm -rf`, `DROP TABLE`, `force push`) and credential leakage (regex-scanned: AWS keys, GitHub tokens, OpenAI keys, Slack tokens, private key PEM headers) before any model call can execute them.
- The plan-gate hook (`ftm-plan-gate.sh`) is a `PreToolUse` gate that blocks `Edit`/`Write` tool calls until a plan has been presented and acknowledged — this is an A/B safety mechanism wired into Claude Code's execution lifecycle, not the model's prompt.
- 368 tests across 18 suites (Vitest) covering daemon, CLI, MCP, Electron, and integration paths — test suite runs in CI on every PR.

---

## "Implement RAG and retrieval systems"

- Built the Blackboard (`blackboard.ts`) as a multi-layer memory store: `current_task` → `recent_decisions` → `active_constraints` → `experiences` (task-specific) → `patterns` (promoted after 3+ confirmations). Every OODA cycle loads relevant past experiences before planning.
- The `MemoryModule` handles explicit "remember this" / "recall" / "search memory" commands and implicit post-completion saves — each experience is tagged by task type for semantic retrieval.
- The `learning-capture-hook` promotes recurring patterns from per-task experiences to a global pattern store after 3+ confirmations, so the system gets measurably smarter with repeated use.
- The `ftm-brainstorm` skill dispatches 7 parallel research agents (web + GitHub vectors) and a reconciler that merges findings, maps disagreements, and scores confidence — then uses those structured findings to ground every suggestion in cited evidence.

---

## "Evaluate and fine-tune AI models"

- Built a `promptfoo`-based evaluation harness (`promptfooconfig.yaml`) for testing skill trigger accuracy — validates that brainstorm skill fires on "help me think through X" and does not fire on "what is Y."
- Implemented 3 configurable model profiles (`quality / balanced / budget`) with per-role model assignment — this is the foundation for systematic model comparison: swap profiles, run evals, measure output quality vs cost.
- The council module (`council.ts`) dispatches the same problem to Claude, Codex, and Gemini in parallel, collects positions, and synthesizes `consensus / majority / split` verdicts — this is multi-model evaluation baked into the runtime, not a one-off experiment.
- Adapter health caching (1-minute TTL) and fallback ordering give the system automatic A/B routing between models based on availability, producing natural comparison data across real tasks.

---

## "Establish AI engineering best practices"

- Wrote `STYLE.md` defining AI-ergonomic code standards: 1000-line file limit, 50-line function limit, no barrel files, direct imports only — rules designed so any AI agent can read one file and understand it without needing 10 others as context.
- Defined a skip-stop protocol in the OODA skill: the system classifies query complexity (`micro / small / medium / large`) and applies proportional tool budgets — prevents the LLM from escalating to multi-step planning for a rename.
- Built `CLAUDE.md` with testing standards that mandate real API contracts before writing mocks, fixture-based test data, and multi-step mock fidelity — written in response to two production bugs caused by assumed API shapes.
- The guard module's rule system is composable: add a `GuardRule` object, no changes to the execution path — open/closed principle applied to LLM safety.

---

## "Build AI observability and monitoring tooling"

- Every internal event (task received, step started, step completed, guard triggered, model called, session ended) is emitted through a typed `EventBus` and persisted to SQLite — full audit trail, zero data loss on daemon restart.
- The `auto-log-hook` converts `task_completed` events into structured `daily_log` entries with duration, outcome, and summary — queryable by date, task type, and model.
- `ftm-dashboard` skill generates session and weekly analytics: tasks completed, success rate, model usage breakdown, patterns promoted.
- The `doctor` CLI command checks daemon health, adapter availability, SQLite integrity, and WebSocket connectivity — a single command that surfaces the full observability picture for on-call diagnosis.

---

## "Drive security and compliance in AI systems"

- The guard hook pattern-matches 15+ destructive shell command signatures and 8 secret token patterns (AWS, GitHub, OpenAI, Slack, PEM headers) before any model output can be written to disk or executed.
- The `ftm-git.sh` hook is a pre-commit secret scanner — blocks commits containing credentials before they reach the remote, regardless of which AI wrote the code.
- Human-in-the-loop is enforced at the architecture level: the plan-gate hook blocks execution until a plan is approved; the `approve` CLI command is the only way to unblock high-risk steps; no model can bypass this via prompt.
- The MCP server uses stdio JSON-RPC (not HTTP) so it never opens a network port — the only communication channel is the subprocess stdin/stdout, which stays inside the user's machine.

---

## One-line for "tell me about yourself in this role"

> "I built an AI orchestration system from scratch — daemon, adapters, memory, safety gates, a desktop app, and a 26-skill extension pack for Claude Code — that routes real tasks across Claude, Codex, Gemini, and Ollama, learns from every session, and enforces safety at the infrastructure level rather than trusting the model's judgment."
