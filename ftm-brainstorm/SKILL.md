---
name: ftm-brainstorm
description: Research-powered Socratic brainstorming that dispatches parallel agents to search the web and GitHub for real-world patterns, then synthesizes findings into actionable suggestions with citations. Use this skill whenever the user wants to brainstorm, explore ideas, think through a feature, plan a project, or flesh out a concept before building. Also triggers when the user pastes a large block of text (notes, prior brainstorm, meeting transcript, spec draft, stream-of-consciousness dump) and wants to turn it into something buildable — phrases like "help me build this", "turn this into a plan", "here's what I've been thinking", or just a big paste followed by "what do you think?" or "go". Triggers on "brainstorm", "help me think through", "I have an idea for", "how should I approach", "let's explore", "what if we built", "I'm thinking about", "help me figure out", or any conversation where the user has a concept they want to develop before writing code. Even vague ideas like "I want to build something that..." or "what's the best way to..." should trigger this skill.
---

## Events

### Emits
- `plan_generated` — when Phase 3 completes and plan is saved
  - Payload: `{ plan_path, plan_title, task_count, wave_count }`
- `task_completed` — when the full brainstorm-to-plan cycle finishes
  - Payload: `{ task_title, plan_path, duration_ms }`

### Listens To
- `task_received` — begin ideation when ftm-mind routes an incoming task for exploration
  - Expected payload: `{ task_description, plan_path, wave_number, task_number }`
- `research_complete` — consume structured findings from ftm-researcher for the current research sprint
  - Expected payload: `{ query, mode, findings_count, consensus_count, contested_count, unique_count, sources_count, council_used, duration_ms }`

## Config Read

Before dispatching any agents, read `~/.claude/ftm-config.yml`:
- Use the `planning` model from the active profile for all research agents
- Example: if profile is `balanced`, agents get `model: opus`
- If config missing, use session default

## Research Sprint Dispatch

Each research sprint invokes ftm-researcher rather than dispatching agents directly.

Interface:
- Pass: { research_question: [derived from current turn], context_register: [all prior findings], depth_mode: [based on turn number] }
- Receive: { findings, disagreement_map, confidence_scores }

Depth mode mapping:
- Turns 1-2 (BROAD): ftm-researcher quick mode (3 finders)
- Turns 3-5 (FOCUSED): ftm-researcher standard mode (7 finders + reconciler)
- Turns 6+ (IMPLEMENTATION): ftm-researcher deep mode (full pipeline with council)

The brainstorm skill consumes the researcher's structured output and weaves it into:
- 3-5 numbered suggestions with evidence and source URLs
- A recommended option with rationale
- Challenges based on contested claims from the disagreement map
- Targeted questions based on research gaps

## Blackboard Read

Before starting, load context from the blackboard:
1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter by task_type "feature"/"investigation"
3. Load top 3-5 matching experience files for past brainstorm lessons
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check execution_patterns and user_behavior

If missing or empty, proceed without.

---

# THE CORE LOOP

This skill is a **multi-turn research conversation**. Every single turn after the first follows the same cycle. There are no shortcuts, no collapsing turns, no "let me just generate the plan now."

```
EVERY TURN (after initial intake):
  1. RESEARCH SPRINT  — invoke ftm-researcher with context
  2. SYNTHESIZE       — merge findings into suggestions with evidence
  3. CHALLENGE        — push back on weak assumptions, surface trade-offs
  4. ASK              — 1-2 targeted questions to extract more from the user
  5. >>> STOP <<<     — wait for the user. Do NOT continue.
```

The research sprints get progressively deeper. The questions get progressively sharper. Each cycle builds on everything before it. The goal is to extract the user's complete vision AND ground it in real-world evidence before generating any plan.

**You maintain a CONTEXT REGISTER** — a running mental document of everything learned so far. Every research sprint receives this register so agents don't re-search old ground. After each turn, append what you learned.

**Research depth escalates automatically:**
- **Turns 1-2: BROAD** — map the landscape, major approaches, who's done this
- **Turns 3-5: FOCUSED** — drill into the user's chosen direction, real trade-offs, failure modes
- **Turns 6+: IMPLEMENTATION** — concrete libraries, code patterns, integration specifics

---

# PHASE 0: REPO SCAN (automatic, silent)

Run this in the background before your first response. Do not ask.

Spawn an **Explore** agent (subagent_type: Explore):
```
Analyze the current repository: project type, tech stack, architecture,
patterns in use, existing infrastructure, scale indicators.
Focus on what's relevant for proposing new features or architectural changes.
```

Store as your project context. Reference throughout all phases. If not in a git repo, skip and ask about stack during intake.

---

# PHASE 1: INTAKE

Detect which path you're on:

## Path A: Fresh Idea (short/vague message)

**Turn 1 ONLY:** Ask 1-2 questions to understand the core idea. What is it, who is it for, what problem does it solve. One question at a time. If the opening message covers some of these, skip ahead.

**>>> STOP. Wait for response. <<<**

**Turn 2:** Take the user's answer. NOW run your first research sprint (3 agents, BROAD depth — see below). Synthesize, challenge, ask 1-2 more questions about architecture and constraints. Propose specific options from the research rather than open-ended questions.

**>>> STOP. Wait for response. <<<**

**Turn 3+:** You're now in the core loop. Every turn from here follows the cycle: research sprint -> synthesize -> challenge -> ask -> STOP.

## Path B: Brain Dump (large paste, notes, transcript)

**Turn 1:** Parse the entire paste. Extract: decisions already made, open questions, assumptions to validate, contradictions, gaps. Present structured summary. Ask for confirmation + any gaps (success criteria, v1 scope, non-negotiables). Do NOT ask basic questions already answered in the paste.

**>>> STOP. Wait for confirmation. <<<**

**Turn 2:** Take the confirmation. Run first research sprint in BRAIN DUMP MODE (agents search for each specific architectural claim from the paste). Present novelty map. Synthesize, challenge, ask.

**>>> STOP. Wait for response. <<<**

**Turn 3+:** Core loop continues.

---

# DISCUSS MODE

When the user provides a clear, specific spec or feature description (not a vague idea), skip broad research and go straight to targeted analysis.

## Detection

Discuss mode activates when:
- The user's input is 200+ words with specific technical details
- The user says "I know what I want to build" or "here's my spec" or "discuss this"
- The input contains file paths, function names, or architecture details
- The user explicitly requests "discuss" rather than "brainstorm"

## Flow

Instead of the standard brainstorm research → synthesis → suggestions flow:

1. **Parse the spec** — Extract: what's being built, key components, tech stack, constraints
2. **Identify gray areas** — Find the parts that aren't specified:
   - Edge cases not mentioned
   - Error handling not specified
   - Performance implications not considered
   - Security concerns not addressed
   - Integration points not defined
3. **Ask targeted questions** — Present 3-5 specific questions about the gray areas:
   ```
   Your spec is clear on [X, Y, Z]. A few gray areas to nail down:

   1. [Edge case question] — e.g., "What happens when the user submits while offline?"
   2. [Error handling question] — e.g., "Should failed API calls retry or show an error?"
   3. [Performance question] — e.g., "Expected data volume? 100 items or 100K?"
   4. [Security question] — e.g., "Who should have access to this endpoint?"
   5. [Integration question] — e.g., "Does this need to sync with the existing auth system?"
   ```
4. **Refine based on answers** — Each answer narrows the spec. After 2-3 rounds of Q&A, the spec should be implementation-ready.
5. **Output: implementation-ready spec** — Not a brainstorm document, but a tight spec that can feed directly into plan generation.

## Gray Area Categories by Feature Type

| Feature Type | Common Gray Areas |
|---|---|
| API endpoint | Auth, rate limiting, pagination, error codes, versioning |
| UI component | Loading states, empty states, error states, accessibility, responsive |
| Data pipeline | Failure modes, retry logic, idempotency, monitoring, backpressure |
| Integration | Auth flow, webhook handling, rate limits, data mapping, error recovery |
| Config change | Rollback plan, feature flags, gradual rollout, monitoring |

---

# PHASE 2: RESEARCH + CHALLENGE LOOP

This is the heart of the skill. Unlimited turns. Each one follows the cycle.

## Step 1: Dispatch Research Sprint

Every turn, read `references/agent-prompts.md` and spawn **3 parallel agents** (subagent_type: general-purpose, model: from ftm-config `planning` profile). Each agent gets:

1. **Project context** from Phase 0
2. **Full context register** — everything learned across ALL prior turns
3. **Research depth level** for this turn (broad/focused/implementation)
4. **Previous findings summary** so they don't re-search
5. **This turn's specific research question** — derived from what the user just said
6. **Brain dump claims** if Path B

The 3 agents search from different vectors:
- **Web Researcher** — blog posts, case studies, architectural write-ups
- **GitHub Explorer** — repos, code patterns, open-source implementations
- **Competitive Analyst** — products, tools, market gaps, user complaints

Each turn's research question should be DIFFERENT from the last. The user's response reveals new angles, constraints, or decisions — use those to formulate new, more specific search queries. If the user chose approach A over B, this turn's research digs into A's implementation details, not the broad landscape again.

## Step 2: Synthesize into 3-5 Suggestions

Once agents return, merge findings into **3-5 numbered suggestions**. Lead with your recommendation.

Each suggestion needs:
1. **The suggestion** — concrete and actionable
2. **Real-world evidence** — which search results back this up, with URLs
3. **Why this matters** — specific advantage for this project
4. **Trade-off** — what you give up

Label suggestion #1 as **RECOMMENDED** with a "Why I'd pick this" rationale.

If research was thin, present fewer suggestions. Quality over quantity. If all 3 agents returned weak results, be honest: "Research didn't surface strong prior art — this might be genuinely novel, or we should reframe the search."

**Brain dump mode:** Present a **Novelty Map** table before suggestions:

| Brain Dump Claim | Verdict | Evidence |
|---|---|---|
| [claim] | Solved / Partially Solved / Novel | [link or explanation] |

## Step 3: Challenge and Extract

After suggestions, challenge the user's thinking. Pick 2-3 challenge patterns:

- **"Have you considered..."** — surface a pattern they may not know about
- **"What happens when..."** — probe edge cases and scaling
- **"The evidence suggests..."** — when research contradicts an assumption
- **"A simpler approach might be..."** — when they're over-engineering
- **"Users of [product] complained about..."** — inject real feedback

**YAGNI instinct:** Actively look for scope to cut. If research shows successful products launched with less, argue for smaller v1 scope.

## Step 4: Ask 1-2 Targeted Questions + Invite Continuation

Then ask **1-2 questions** that will make the next research sprint more productive. The questions should:
- Narrow scope based on what research surfaced
- Reveal constraints research can't discover
- Test commitment to specific approaches
- Uncover success criteria and non-negotiables

Prefer multiple-choice when the answer space is bounded. Each question should unlock a NEW research vector for next turn.

**After your questions, always signal that more depth is available.** Something like: "Answer these and I'll run another research sprint focused on [next topic]. Or if you feel we've covered enough ground, just say the word and we'll move to planning." The user should never feel like the brainstorm is wrapping up unless THEY decide it is. Your default posture is: there's always more to explore.

## Step 5: STOP

**>>> STOP. Do NOT continue to the next turn. Wait for the user. <<<**

This is non-negotiable. The user's response is the input for the next research sprint. Without it, the next sprint has nothing new to search for.

---

## Feature-Type Detection

When you learn enough to classify the feature, add type-specific questions. Pick 2-3 unknowns, don't dump everything.

| Type | Signals | Key Questions |
|---|---|---|
| UI/Frontend | "page", "component", "dashboard" | Layout density? Responsive approach? Loading/empty/error states? |
| API/Backend | "endpoint", "API", "service" | REST vs GraphQL? Auth mechanism? Pagination strategy? |
| Data/Storage | "database", "store", "persist" | SQL vs NoSQL? Read/write ratio? Consistency requirements? |
| Integration | "connect to", "sync with" | Push/pull/both? Real-time or batch? Retry handling? |
| Automation | "automate", "trigger", "schedule" | Trigger mechanism? Failure notification? Idempotency? |
| CLI Tool | "command", "CLI", "terminal" | Interactive or not? Output format? Config file approach? |
| AI/ML | "AI", "model", "generate", "LLM" | Which model? Latency tolerance? Fallback? Cost ceiling? |

---

## When to Suggest Phase 3

You may SUGGEST moving to plan generation when:
- User explicitly says "ok I think I know what I want", "let's plan", "I'm ready" or similar
- Research returns diminishing returns AND user seems satisfied (same patterns keep appearing across 2+ sprints)
- You've covered: core architecture, key technical decisions, data model, integrations AND the user isn't raising new questions

**Default posture: keep exploring.** Never suggest Phase 3 just because a certain number of turns have passed. Some ideas need 3 turns, some need 15. The user decides when they're done, not you. If research is thin on a topic, try reformulating the search before suggesting you've exhausted the space.

**HARD GATE: The user must explicitly approve.** Present a brief summary:

```
Here's what I think we've landed on:

**Building:** [one sentence]
**Core approach:** [recommended architecture/pattern]
**Key decisions:** [2-3 bullets]
**Scope for v1:** [what's in, what's deferred]

Ready to turn this into an implementation plan, or more to explore?
```

If they say yes, proceed. If they raise new questions, stay in Phase 2.

---

# PHASE 3: PLAN GENERATION

Read `references/plan-template.md` for the full template and rules. Present the plan incrementally (vision -> tasks -> agents/waves), getting approval at each step.

---

## Relationship to superpowers:brainstorming

- **ftm-brainstorm** (this): Idea exploration with live research. User is figuring out WHAT to build.
- **superpowers:brainstorming**: Design/spec work. User knows what they're building, needs HOW.

If user already completed superpowers:brainstorming, point to ftm-executor instead. If user explicitly invokes this skill, always run it.

---

## Context Compression

After turn 5 in a brainstorm session, earlier turns start consuming significant context. Apply compression to maintain quality in later turns.

### Trigger

- Turns 1-5: No compression. Full fidelity.
- Turn 6+: Compress turns 1 through (current - 3). Keep the 3 most recent turns at full fidelity.

### Compression Strategy

For each compressed turn, replace the full content with a summary:

```
[Turn N summary]
- Topic: [what was discussed]
- Key decisions: [bullet list of decisions made]
- Open questions resolved: [what was answered]
- Artifacts produced: [any specs, diagrams, code snippets referenced]
```

### What to Preserve in Summaries

- Decisions and their rationale (WHY something was decided)
- Constraints discovered
- Requirements confirmed by the user
- Technical choices made

### What to Drop

- Exploratory tangents that were abandoned
- Research citations already synthesized
- Verbose explanations of options not chosen
- Repeated context that's already captured in later turns

### Implementation

This is implemented at the skill level, not via hooks. When presenting a response at turn 6+:
1. Mentally compress old turns using the strategy above
2. Reference compressed summaries when needed
3. Keep recent turns verbatim for conversational continuity
4. If the user references something from a compressed turn, expand it on demand

---

## Session State (for ftm-pause/resume)

When paused, the following state must be capturable so ftm-resume can pick up exactly where you left off:

- **Phase tracking**: current phase (0/1/2/3), path (A/B), turn number, research depth level
- **Phase 0**: full repo scan results (or "skipped — no git repo")
- **Phase 1**: original idea (verbatim), brain dump extraction if Path B, all user answers per round
- **Phase 2**: every completed turn's suggestions with evidence/URLs, every challenge and response, every question and answer, accumulated decisions, the current direction, context register contents
- **Phase 3**: which sections presented/approved, plan content so far, plan file path if saved

This state is what ftm-pause captures and ftm-resume restores. Keep it current as you go.

## Blackboard Write

After completing, update:
1. `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json`:
   - task_type: "feature" or "investigation"
   - feature_type: detected type (UI, API, etc.)
   - architectural_direction: the approach chosen
   - research_quality: how useful the research sprints were (high/medium/low)
   - turns_to_resolution: how many Phase 2 turns before Phase 3
   - tags: keywords for future matching
3. Update `experiences/index.json` with the new entry
4. Emit `plan_generated` with `{ plan_path, plan_title, task_count, wave_count }` (if Phase 3 completed)
5. Emit `task_completed` with `{ task_title, plan_path, duration_ms }`

## Requirements

- config: `~/.claude/ftm-config.yml` | optional | model profile for planning agents
- reference: `references/agent-prompts.md` | required | research agent prompt templates
- reference: `references/plan-template.md` | required | plan document generation template
- reference: `~/.claude/ftm-state/blackboard/context.json` | optional | session state and active constraints
- reference: `~/.claude/ftm-state/blackboard/experiences/index.json` | optional | past brainstorm lessons
- reference: `~/.claude/ftm-state/blackboard/patterns.json` | optional | execution and user behavior patterns

## Risk

- level: low_write
- scope: writes plan documents to ~/.claude/plans/; writes blackboard context and experience files; does not modify project source code
- rollback: delete generated plan file; blackboard writes can be reverted by editing JSON files

## Approval Gates

- trigger: Phase 3 plan generation ready | action: present "Here's what I think we've landed on" summary and wait for explicit user approval before generating plan
- trigger: plan document generated | action: present plan incrementally (vision → tasks → agents/waves) and get approval at each step
- trigger: research returns thin results on all agents | action: note research gaps, present fewer suggestions, do not fabricate citations
- complexity_routing: micro → auto | small → auto | medium → plan_first | large → plan_first | xl → always_ask

## Fallbacks

- condition: ftm-researcher not available | action: dispatch 3 direct parallel research agents (web/github/competitive) using built-in prompts from references/agent-prompts.md
- condition: no git repo detected in Phase 0 | action: skip repo scan, ask about tech stack during intake
- condition: blackboard missing or empty | action: proceed without experience-informed shortcuts, rely on direct analysis
- condition: ftm-config.yml missing | action: use session default model for all agents

## Capabilities

- mcp: `WebSearch` | optional | web research agents use for blog posts and case studies
- mcp: `WebFetch` | optional | GitHub exploration and competitive analysis
- mcp: `sequential-thinking` | optional | complex trade-off analysis during synthesis
- env: none required

## Event Payloads

### plan_generated
- skill: string — "ftm-brainstorm"
- plan_path: string — absolute path to generated plan file
- plan_title: string — human-readable plan title
- task_count: number — total tasks in the plan
- wave_count: number — number of parallel execution waves

### task_completed
- skill: string — "ftm-brainstorm"
- task_title: string — title of the brainstorm topic
- plan_path: string | null — path to generated plan if Phase 3 completed
- duration_ms: number — total session duration
