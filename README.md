# Feed The Machine

Models get smarter every quarter. Your workflow shouldn't have to start over every time.

FTM is a cognitive architecture for Claude Code — not a prompt library, not a wrapper, not scaffolding that dies on the next model drop. It's a persistent intelligence layer that learns how *you* work and gets better every time you use it. The OODA (Observe, Orient, Decide, Act) reasoning loop, the blackboard memory, the multi-model deliberation, the event mesh — these are design patterns that become *more* valuable as models improve, not less.

Drop in anything. A support ticket, a feature spec, a bug report, a half-formed idea, a meeting transcript, a "figure this out." The machine reads everything, proposes a plan, waits for your approval, then executes end-to-end. Every successful execution becomes a playbook. Every playbook makes the next similar task faster.

The machine hungers. You feed it. It takes care of you.

---

## Plain English

You know how every time you start a new chat with an AI, it has no idea who you are, what you're working on, or what you tried last time? You end up repeating yourself constantly. And when you ask it to do something complex, you have to hold its hand through every single step.

FTM fixes that.

It's a brain upgrade for Claude Code (Anthropic's AI coding tool). You install it once, and from that point on:

- **It remembers.** Not just within one conversation — across all of them. It builds a memory of your projects, your preferences, what worked before, and what didn't. The more you use it, the less you have to explain.

- **It plans before it acts.** You throw a task at it — could be a bug, a feature request, a vague idea, whatever — and instead of immediately doing something dumb, it reads your context, makes a plan, and shows you the plan first. You approve it, tweak it, or tell it to rethink. Then it goes.

- **It does the whole thing, not just one step.** Most AI tools help you write a function or answer a question. FTM coordinates entire workflows — it can read a support ticket, look up the customer's history, draft a response, update the ticket, and notify your team. All from one input.

- **It gets a second opinion.** For hard decisions, it doesn't just trust one AI. It asks Claude, GPT, and Gemini independently, then picks the answer where at least two agree. Like calling three contractors instead of trusting the first quote.

- **It gets better over time.** Every task it completes becomes a playbook. See the same type of bug three times? It already knows the pattern. Similar support ticket? It remembers what worked last time. It's not just a tool — it's a tool that sharpens itself.

Think of it like this: regular AI is a blank whiteboard every time you walk into the room. FTM is an assistant who was in yesterday's meeting, read the doc you shared last week, and already has a draft ready when you walk in.

---

## Why This Exists

Most AI tooling is disposable by design. You write prompts, the model gets better, your prompts become unnecessary. That's the scaffolding thesis — and it's true for most of what people are building.

FTM is built on the opposite bet: **the orchestration layer survives model drops.** Three things in this system are structurally hard for any single model provider to absorb:

**Persistent memory that compounds.** Claude's native memory is conversation-scoped. FTM's blackboard is a three-tier knowledge store — context, experiences, patterns — that persists across every session. By your twentieth task, it knows your stack, your team's conventions, the quirks of your external services, and what kinds of plans you tend to push back on. It's not remembering facts. It's building judgment.

**Multi-model deliberation.** FTM's council sends hard decisions to Claude, Codex, and Gemini as equal peers, then loops through rounds of debate until 2-of-3 agree. No model provider will ever natively ship "ask our competitors for a second opinion." That's permanently outside their incentive structure.

**Event-driven skill composition.** 18 typed events wire skills together automatically — a commit triggers documentation updates and architecture diagrams, a completed task triggers micro-reflection, a wave boundary triggers adversarial validation. This is workflow orchestration that sits above any single model's capability. It's closer to what Temporal does than what a model improvement would replace.

The ideas are portable. The architecture is model-agnostic. The skills format is just the current packaging.

---

## The Loop

Every task, every time:

```
FEED --> PLAN --> APPROVE --> EXECUTE --> LEARN
  ^                                        |
  +------------- (next task) --------------+
```

**FEED** — Paste anything. A ticket URL. A spec doc. An error stack trace. A Slack thread. Plain English. The machine reads it all.

**PLAN** — ftm-mind runs the OODA loop (Observe what you gave it, Orient using blackboard memory, Decide on an approach, Act by assembling the right skills) and proposes a concrete plan with numbered steps.

**APPROVE** — You review the plan. Modify it, ask questions, or just say "go."

**EXECUTE** — Parallel agent teams work through the plan. Each wave completes, validates, and checks in before the next begins. Browser automation, git ops, test runs, API calls — all coordinated.

**LEARN** — Every outcome writes back to the blackboard: what worked, what failed, what pattern to remember. Next time you bring a similar task, the machine already knows the shape of it.

---

## Architecture

```mermaid
graph TD
    User["User Input\n(ticket / spec / idea / error)"] --> Mind

    subgraph Core["FTM Core"]
        Mind["ftm-mind\n(OODA Cognitive Loop)"]
        BB["Blackboard\ncontext.json\nexperiences/\npatterns.json"]
        Mesh["Event Mesh\n18 typed events"]
    end

    Mind <-->|read / write| BB
    Mind -->|route| Mesh

    subgraph Skills["Skill Layer"]
        Storm["ftm-brainstorm\nSocratic ideation\n+ parallel research"]
        Debug["ftm-debug\nMulti-vector\ndebugging war room"]
        Exec["ftm-executor\nAutonomous plan\nexecution"]
        Council["ftm-council\nClaude + Codex + Gemini\n2-of-3 consensus"]
        Browse["ftm-browse\nHeadless browser\n+ accessibility inspection"]
        Git["ftm-git\nSecret scanning\n+ credential gate"]
        Audit["ftm-audit\nKnip + adversarial\nLLM wiring check"]
    end

    Mesh --> Storm
    Mesh --> Debug
    Mesh --> Exec
    Mesh --> Council
    Mesh --> Browse
    Mesh --> Git
    Mesh --> Audit

    subgraph Integrations["External Integrations (via MCP)"]
        Jira["Jira"]
        FS["Freshservice"]
        Slack["Slack"]
        Gmail["Gmail"]
    end

    Browse --> Jira
    Browse --> FS
    Mind --> Slack
    Mind --> Gmail

    Exec -->|code_committed| Intent["ftm-intent\nINTENT.md layer"]
    Exec -->|code_committed| Diagram["ftm-diagram\nARCHITECTURE.mmd"]
    Exec -->|task_completed| Retro["ftm-retro\nmicro-reflection"]
    Exec -->|wave boundary| Gate["ftm-codex-gate\nadversarial validation"]
    Gate --> Exec
```

---

## First 5 Minutes

Install:

```bash
npx feed-the-machine@latest
```

Symlinks all 16+ skills into `~/.claude/skills/` where Claude Code discovers them automatically. That's it.

**Three things to try right now:**

**1. Feed it a task:**
```
/ftm
```
Paste anything — a Jira ticket, a Freshservice request, a Slack message, or just describe what you need done. FTM reads it, pulls relevant context from your blackboard, proposes a plan, and waits for your go.

**2. Think something through:**
```
/ftm-brainstorm
```
Describe something you're trying to figure out. It runs parallel web and GitHub research agents, challenges your assumptions Socratically, and surfaces options you hadn't considered.

**3. Kill a bug:**
```
/ftm-debug
```
Paste an error message, stack trace, or just describe unexpected behavior. It opens a multi-vector war room — static analysis, runtime hypothesis testing, dependency auditing — running in parallel.

---

## Before / After

### Triaging a support ticket

**Without FTM** — Open the ticket. Read it. Check Slack for context. Look up the customer's history. Figure out who should handle it. Draft a response. Copy-paste between four tabs. 30 minutes of context-gathering before any real work starts.

**With FTM** — Paste the ticket URL. FTM reads the ticket, pulls the Slack thread, checks your blackboard for similar past issues, proposes a triage plan (categorize, assign, draft response, update ticket), and waits. You say "go." Done in 3 minutes.

---

### Building a feature from a spec

**Without FTM** — You open five files, context-switch between the spec and the codebase, write the route, realize the middleware pattern is different from what you remembered, check another file, write tests separately, forget to update the docs, ship it and wonder why the audit is failing.

**With FTM** — You paste the spec. FTM reads the existing patterns in your codebase (blackboard knows your stack), proposes a plan: route, handler, validation, tests, INTENT update, audit check. Parallel agents handle the implementation waves. ftm-codex-gate validates at each boundary. Documentation updates automatically on commit. The whole thing is coherent from the start.

---

### Configuring an admin console

**Without FTM** — 45 minutes. Find the vendor docs. Navigate the admin panel manually. Cross-reference settings. Copy-paste values without fat-fingering them. Update the ticket. Hope you didn't miss a field.

**With FTM** — 5 minutes. Paste the ticket. FTM reads the config docs, opens a headless browser, navigates the admin panel, fills fields from the ticket spec, screenshots the result for verification, and drafts the ticket update. You review and approve each step.

---

## Skill Inventory

| Skill | What It Does |
|-------|-------------|
| **ftm-mind** | Observe-Orient-Decide-Act cognitive loop — the universal entry point; reads context, sizes tasks, routes everything |
| **ftm-executor** | Autonomous plan execution with dynamically assembled agent teams and wave-by-wave progress |
| **ftm-debug** | Multi-vector debugging war room — parallel hypothesis testing, static + runtime + dependency analysis |
| **ftm-brainstorm** | Socratic ideation with parallel web and GitHub research agents; challenges assumptions, surfaces options |
| **ftm-audit** | Wiring verification — knip static analysis plus adversarial LLM audit of skill connections |
| **ftm-council** | Multi-model deliberation — Claude, Codex, and Gemini debate to 2-of-3 consensus on hard decisions |
| **ftm-codex-gate** | Adversarial Codex validation at executor wave boundaries before proceeding |
| **ftm-retro** | Post-execution retrospectives and continuous micro-reflections after every task |
| **ftm-intent** | INTENT.md documentation layer — function-level contracts, auto-updated on every commit |
| **ftm-diagram** | ARCHITECTURE.mmd mermaid diagrams — auto-regenerated after commits |
| **ftm-browse** | Headless browser — screenshots, accessibility tree inspection, form automation, visual verification |
| **ftm-git** | Secret scanning and credential safety gate for all git operations |
| **ftm-pause** | Save current session state to the blackboard mid-task |
| **ftm-resume** | Restore a paused session and continue exactly where you left off |
| **ftm-upgrade** | Self-upgrade from GitHub releases |
| **ftm-config** | Configure model profiles and execution preferences |
| **ftm** | Bare invocation — equivalent to `/ftm-mind` with plain-language input |

---

## How It Learns

The blackboard is a three-tier knowledge store that persists across every session:

| Tier | What's Stored | When It's Read |
|------|--------------|----------------|
| `context.json` | Current task, recent decisions, your stated preferences | Every single request |
| `experiences/*.json` | Per-task learnings — one file per completed task, tagged by type | Orient phase, filtered by similarity to current task |
| `patterns.json` | Insights promoted after 3+ confirming experiences — durable heuristics | Orient phase, matched to the current situation |

Cold start is fine. The blackboard bootstraps aggressively in the first ten interactions and reaches useful density fast. By session twenty, FTM knows your stack, your team's conventions, the quirks of your external services, and what kinds of plans you tend to push back on.

Every skill writes back. ftm-executor writes task outcomes. ftm-debug writes what the root cause turned out to be. ftm-retro promotes patterns when it sees the same learning three times. The machine gets better with every task you feed it.

---

## Install & Config

**Quick start:** See [docs/QUICKSTART.md](docs/QUICKSTART.md)

**Configuration reference:** See [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

**Development install:**

```bash
git clone https://github.com/kkudumu/feed-the-machine.git ~/feed-the-machine
cd ~/feed-the-machine
./install.sh
```

Pull updates anytime: `git pull && ./install.sh`

Remove: `./uninstall.sh` (removes symlinks only, keeps your blackboard data)

**Model profiles** — edit `~/.claude/ftm-config.yml`:

```yaml
profile: balanced    # quality | balanced | budget

profiles:
  balanced:
    planning: opus      # brainstorm, research
    execution: sonnet   # agent task implementation
    review: sonnet      # audit, debug review
```

**Optional dependencies** for the full stack:

- [Codex CLI](https://github.com/openai/codex) — required for `ftm-council` and `ftm-codex-gate`
- [Gemini CLI](https://github.com/google/gemini-cli) — required for `ftm-council`
- Playwright MCP server (`npx @playwright/mcp@latest`) — required for `ftm-browse`
  *(MCP = Model Context Protocol — the standard way AI tools connect to external services)*

All other skills run on Claude Code alone.

---

## License

MIT
