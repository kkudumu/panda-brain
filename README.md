# Feed The Machine

**Make Claude Code actually remember things and do entire jobs, not just answer questions.**

You know how every time you start a new chat with an AI, it has no idea who you are, what you're working on, or what you tried last time? You end up repeating yourself constantly. And when you ask it to do something complex, you have to hold its hand through every single step.

FTM fixes that.

---

## What It Actually Does

You install it once. From that point on, Claude Code gets three superpowers:

**It remembers across conversations.** Not just within one chat — across all of them. It builds up knowledge about your projects, your preferences, what worked before, and what didn't. The more you use it, the less you have to explain.

**It plans before it acts.** Throw a task at it — a bug, a feature request, a vague idea, whatever. Instead of immediately doing something dumb, it reads your context, makes a plan, and shows you the plan first. You approve it, tweak it, or tell it to rethink. Then it goes.

**It does the whole thing, not just one step.** Most AI tools help you write a function or answer a question. FTM coordinates entire workflows — it can read a ticket, look up history, write the code, run the tests, update the docs, and validate everything. All from one input.

Think of it like this: regular AI is a blank whiteboard every time you walk into the room. FTM is an assistant who was in yesterday's meeting, read the doc you shared last week, and already has a draft ready when you walk in.

---

## Install

**Everything** (26 skills + 15 hooks):
```bash
npx feed-the-machine@latest
```

**Just the skills you want:**
```bash
npx feed-the-machine --only ftm-council-chat,ftm-mind
```
This always includes `ftm` (the router) and `ftm-config` as base dependencies.

**See what's available:**
```bash
npx feed-the-machine --list
```

Works with any existing Claude Code setup. After install, restart Claude Code or start a new session.

---

## Try It Right Now

**Just talk to it:**
```
/ftm
```
Paste anything — a ticket, an error, a feature idea, or just describe what you need. FTM figures out what to do, shows you a plan, and waits for your OK before doing anything.

**Think something through:**
```
/ftm-brainstorm
```
Describe something you're trying to figure out. It researches the web and GitHub in parallel, challenges your thinking, and surfaces options you hadn't considered.

**Kill a bug:**
```
/ftm-debug
```
Paste an error or describe weird behavior. It attacks the problem from multiple angles at once — way faster than stepping through it manually.

**Get a second opinion:**
```
/ftm-council
```
Not sure about an architecture choice or debugging approach? This sends the problem to Claude, GPT, and Gemini independently. They debate in rounds until at least two agree. Like calling three contractors instead of trusting the first quote.

**Open the chatroom:**
```
/ftm-council-chat
```
An AIM-styled browser chatroom where you, Claude, Codex, and Gemini all talk in real time. You're a full participant, not just watching.

---

## Before / After

### Triaging a support ticket

**Before** — Open the ticket. Read it. Check Slack for context. Look up the customer. Figure out who handles it. Draft a response. Copy-paste between four tabs. 30 minutes of context-gathering before any real work.

**After** — Paste the ticket URL. FTM reads it, pulls context, checks for similar past issues, makes a plan, and waits. You say "go." Done in 3 minutes.

---

### Building a feature

**Before** — Open five files, switch between spec and codebase, write the code, realize the patterns are different from what you remembered, check another file, write tests separately, forget the docs, ship it and wonder why things are failing.

**After** — Paste the spec. FTM already knows your codebase patterns, proposes a plan: code, tests, docs, validation. Parallel agents handle the work. Documentation updates automatically. Everything stays consistent.

---

### Configuring something in an admin panel

**Before** — 45 minutes. Find the vendor docs. Navigate the panel manually. Cross-reference settings. Hope you didn't miss a field.

**After** — 5 minutes. Paste the ticket. FTM reads the docs, opens a browser, navigates the panel, fills the fields, screenshots the result. You review and approve each step.

---

## How It Gets Smarter

FTM keeps a memory (called the "blackboard") that persists across every conversation:

| Layer | What It Remembers | Example |
|-------|------------------|---------|
| **Context** | What you're working on right now, recent decisions | "Currently building auth system, chose JWT over sessions" |
| **Experiences** | What happened on past tasks — what worked, what didn't | "Last time we hit this error, the fix was in the middleware config" |
| **Patterns** | Lessons that keep coming up — gets promoted after 3+ confirmations | "This team's API always needs CORS headers added manually" |

**Cold start is fine.** The first few conversations build up context fast. By your 10th-20th session, FTM knows your stack, your conventions, and what kinds of plans you tend to push back on.

Every task makes it smarter. Fix a bug? It remembers the root cause. Ship a feature? It remembers the patterns. See the same issue three times? It already knows what to do.

---

## What's Included

FTM ships with 26 skills and 15 automation hooks. You don't need to memorize them — just use `/ftm` and it picks the right ones automatically. But here's what's under the hood:

### Core

| Skill | Plain English |
|-------|--------------|
| **ftm-mind** | The brain. Reads your input, pulls memory, sizes complexity, picks the right approach |
| **ftm-executor** | The hands. Takes the plan and does the work with parallel agents in isolated worktrees |
| **ftm-ops** | Your ops dashboard. Task management, capacity tracking, stakeholder comms, meeting intel, burnout detection |
| **ftm-config** | Settings. Choose which AI models handle planning vs execution vs review |

### Thinking & Research

| Skill | Plain English |
|-------|--------------|
| **ftm-brainstorm** | Thinking partner. Researches the web and GitHub in parallel, challenges assumptions, surfaces options |
| **ftm-researcher** | Deep research engine. 7 specialized finder agents search in parallel, then adversarially review each other's findings |
| **ftm-council** | Second opinions. Sends the problem to Claude, GPT, and Gemini — goes with the majority |
| **ftm-council-chat** | AIM-styled chatroom. You, Claude, Codex, and Gemini all talking in a browser window |

### Building & Debugging

| Skill | Plain English |
|-------|--------------|
| **ftm-debug** | Bug war room. Attacks problems from multiple angles simultaneously |
| **ftm-audit** | Wiring check. Makes sure all code is actually connected and working — static analysis + LLM audit |
| **ftm-codex-gate** | Code validation gate. Sends your code to GPT for adversarial review before it ships |
| **ftm-browse** | Web automation. Opens browsers, fills forms, takes screenshots, inspects pages |
| **ftm-git** | Safety net. Scans for leaked passwords/keys before you push code |

### Codebase Intelligence

| Skill | Plain English |
|-------|--------------|
| **ftm-map** | Code knowledge graph. Knows what depends on what and what breaks if you change something |
| **ftm-intent** | Living docs. Keeps function-level documentation updated automatically when code changes |
| **ftm-diagram** | Architecture diagrams. Auto-generated mermaid diagrams that stay current |

### Quality & Learning

| Skill | Plain English |
|-------|--------------|
| **ftm-verify** | Post-execution verification. Two independent AI models audit the completed work, then auto-fix anything they find |
| **ftm-retro** | Self-assessment. Reviews its own execution and scores it across 5 dimensions |
| **ftm-capture** | Knowledge extraction. Turns what you just did into reusable routines and playbooks |
| **ftm-dashboard** | Analytics. Shows which skills you use, approval rates, and session stats |

### Workflow & Session

| Skill | Plain English |
|-------|--------------|
| **ftm-routine** | Recurring workflows. Define multi-step routines in YAML and run them by name |
| **ftm-pause / resume** | Save and restore. Pick up exactly where you left off in a new conversation |
| **ftm-upgrade** | Self-update. Stay current with one command |

### Hooks (15 automations)

These run automatically in the background — no slash commands needed:

- **Auto-logging** — every tool call gets logged to events.log
- **Learning capture** — extracts lessons from completed tasks
- **Session snapshots** — saves state for crash recovery
- **Secret scanning** — blocks commits containing credentials
- **Task loading** — hydrates tasks from plans on session start
- **Plan gates** — enforces plan approval before execution
- **Compaction handlers** — preserves critical state when context compresses
- And 8 more for blackboard enforcement, map auto-detection, drafts gating, etc.

---

## The Secret Sauce

Three things make FTM different from "just using Claude Code":

**1. Memory that compounds.** Claude normally forgets everything between conversations. FTM's memory persists forever and gets smarter over time. By your 20th task, it knows things about your project that would take a new developer weeks to learn.

**2. Second opinions from multiple AIs.** For hard decisions, FTM asks Claude, GPT, and Gemini independently, then goes with the answer where at least two agree. Like calling three contractors instead of trusting the first quote.

**3. Workflow orchestration.** FTM doesn't just answer questions — it coordinates multi-step workflows with parallel agents, automated testing, and validation gates. It's closer to having a junior dev on your team than having a chatbot.

---

## Advanced Setup

**Model profiles** — Control which AI models handle what (edit `~/.claude/ftm-config.yml`):

```yaml
profile: balanced    # quality | balanced | budget

profiles:
  quality:
    planning: opus      # the deep thinker
    execution: opus     # thorough but slower
    review: sonnet      # the checker

  balanced:
    planning: opus
    execution: sonnet   # fast worker
    review: sonnet

  budget:
    planning: sonnet
    execution: sonnet
    review: haiku       # cheapest
```

**Execution settings:**

```yaml
execution:
  agent_mode: bypassPermissions   # how much autonomy agents get
  max_parallel_agents: 5          # simultaneous agent workers
```

**Optional extras** for the full experience:

- [Codex CLI](https://github.com/openai/codex) — Powers the council, code validation, and adversarial review
- [Gemini CLI](https://github.com/google/gemini-cli) — Third voice in the council
- Playwright MCP server (`npx @playwright/mcp@latest`) — Powers browser automation

Everything else runs on Claude Code alone.

**Dev install** (if you want to contribute):

```bash
git clone https://github.com/kkudumu/feed-the-machine.git ~/feed-the-machine
cd ~/feed-the-machine && ./install.sh                          # everything
# or: ./install.sh --only ftm-council-chat                     # just one skill
# or: ./install.sh --list                                      # see what's available
```

**Uninstall:** `./uninstall.sh` (removes skills, keeps your memory data)

---

## Current Version

**v1.7.0** (April 2026) — [Full changelog](CHANGELOG.md)

Recent highlights:
- **ftm-ops**: Personal operations intelligence (task management, capacity tracking, burnout detection, stakeholder comms)
- **ftm-mind slimmed from 87KB to 10KB** via progressive disclosure
- **ftm-verify**: Dual-model adversarial verification (Codex + Gemini audit your completed work independently)
- **ftm-council-chat**: AIM-styled browser chatroom for multi-AI conversations
- **15 automation hooks** for event logging, learning capture, secret scanning, and session management
- **Configurable agent permissions** and parallel agent limits

---

## License

MIT
