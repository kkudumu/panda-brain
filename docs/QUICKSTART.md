# Quickstart — Your First 5 Minutes with FTM

## Install

**Option A — npx (recommended):**

```bash
npx feed-the-machine@latest
```

**Option B — git clone:**

```bash
git clone https://github.com/kkudumu/feed-the-machine.git ~/feed-the-machine
cd ~/feed-the-machine
./install.sh
```

Both paths install skills, hooks, and merge hook config into `settings.json` automatically.

**Prerequisites:** `jq` and `node` must be installed. The installer checks and tells you what's missing.

Restart Claude Code (or start a new session) to pick up the skills.

## Try It

### 1. Ask for help

```
/ftm help
```

Shows all 22 skills and what they do.

### 2. Let the mind route your request

```
/ftm I need to add error handling to my API routes
```

FTM-mind reads your codebase, sizes the task, and either handles it directly or routes to the right skill. You don't need to pick the skill — it picks for you.

### 3. Brainstorm a feature

```
/ftm brainstorm I want to add OAuth login with Google and GitHub
```

Launches parallel research agents that search the web and GitHub for real implementations, then presents 5 evidence-backed suggestions with trade-offs.

### 4. Debug a stubborn bug

```
/ftm debug the auth middleware returns 401 even with a valid token
```

Deploys a war room with parallel hypothesis testing — instrumentation, reproduction, research, and solution agents working simultaneously.

### 5. Execute a plan

```
/ftm execute ~/.claude/plans/my-feature-plan.md
```

Reads your plan, assembles a team of specialized agents, dispatches them in parallel worktrees, and runs each through a commit-review-fix loop.

## How It Works

Every request goes through an **OODA loop** (Observe-Orient-Decide-Act):

1. **Observe** — Captures your request, reads git status, loads session state
2. **Orient** — Checks blackboard memory, retrieves past experiences, scans capabilities
3. **Decide** — Sizes complexity (micro/small/medium/large), picks execution strategy
4. **Act** — Executes directly or routes to the right skill

The system starts smart and gets smarter — it records experiences after each task and promotes patterns after 3+ observations.

## Configuration

Edit `~/.claude/ftm-config.yml` to control model selection:

```yaml
profile: balanced  # quality | balanced | budget

profiles:
  balanced:
    planning: opus      # brainstorm, research
    execution: sonnet   # agent task implementation
    review: sonnet      # audit, debug review
```

## What's Next

- `/ftm audit` — verify your code is properly wired
- `/ftm council` — get Claude + Codex + Gemini to debate a decision
- `/ftm config` — adjust settings
- Just describe what you need — ftm-mind handles the rest
