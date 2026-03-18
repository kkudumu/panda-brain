---
name: panda-pause
description: Save the current panda skill session state so work can be resumed in a new conversation. Use when user says "pause", "save state", "I need to stop", "continue later", "panda pause", "save progress", or is about to end a session mid-workflow. Works with any panda skill (brainstorm, executor, debug, council, audit).
---

## Events

### Emits
- `session_paused` — when the session state has been successfully serialized and written to disk
- `task_completed` — when the pause workflow finishes (state file written and confirmation presented)

### Listens To
(none — panda-pause is explicitly invoked by the user and does not respond to events)

# Panda Pause — Session State Capture

Save the full state of any active panda skill session to disk so it can be resumed in a new conversation with zero context loss. This skill understands the internal structure of every panda skill and captures exactly what's needed to pick up where you left off.

## Why This Exists

Panda skills — brainstorm, executor, debug, council, audit — are multi-phase, multi-turn workflows that accumulate significant context over time. Research findings, agent results, user decisions, worktree branches, plan progress — all of this lives in the conversation and dies when the conversation ends. A brainstorm session 8 turns deep with 3 completed research sprints and 2 rounds of questioning is hours of work that evaporates if the user needs to stop.

This skill captures that state to a structured file that panda-resume can read to reconstruct the session in a fresh conversation. The user loses nothing.

## Step 1: Detect the Active Panda Skill

Scan the current conversation context to determine which panda skill is active. Look for these signals:

| Signal | Skill |
|--------|-------|
| Phase 0 repo scan, intake rounds, research sprints, 5-suggestion format, plan generation | **panda-brainstorm** |
| Plan analysis, agent team assembly, worktree setup, wave dispatch, task completion tracking | **panda-executor** |
| Problem intake, investigation plan, war room agents (instrumenter/researcher/reproducer/hypothesizer), solver/reviewer loop | **panda-debug** |
| Council prompt framing, multi-model dispatch (Claude/Codex/Gemini), rebuttal rounds, alignment checks | **panda-council** |
| Project pattern detection, knip analysis, adversarial audit, auto-fix, wiring contracts | **panda-audit** |

If no panda skill is active, tell the user: "No active panda session detected. This skill saves state for panda-brainstorm, panda-executor, panda-debug, panda-council, and panda-audit sessions."

If multiple skills have been invoked in the same conversation (e.g., brainstorm followed by executor), capture the most recently active one. If the user says which one to save, respect that.

## Step 2: Capture State by Skill Type

### panda-brainstorm

Capture all of the following that exist in the current session:

**Phase tracking:**
- Current phase (0, 1, 2, or 3)
- If Phase 1: which round (1, 2, or 3), which path (A: Fresh Idea or B: Brain Dump)
- If Phase 2: how many research+challenge turns have been completed
- If Phase 3: which section of the plan has been presented (Vision, Tasks, Agents, or complete)

**Phase 0 context:**
- The full repo scan results (project type, tech stack, architecture, patterns, infrastructure, scale)
- Whether the scan was skipped (no git repo) and any stack info gathered from the user instead

**Phase 1 — Intake:**
- The user's original idea/request (verbatim if short, summarized if long)
- If Path B: the full brain dump extraction (decisions made, open questions, assumptions, contradictions, gaps)
- All user answers from each completed round
- Research Sprint 1 results (landscape context) — all findings from Web Researcher, GitHub Explorer, Competitive Analyst
- Research Sprint 2 results (constraint-scoped research) — all findings from all three agents
- If Path B: the novelty map (which claims are solved/partially solved/novel)

**Phase 2 — Research + Challenge Loop:**
- Every completed turn's 5 suggestions (or fewer if weak results) with evidence and links
- Every challenge posed and the user's response
- Every question asked and the user's answer
- Accumulated decisions and direction chosen
- Research agent results from each turn (summarized — full URLs and key findings, not raw agent output)
- The current "direction" the brainstorm is heading (architecture chosen, scope narrowed, etc.)

**Phase 3 — Plan Generation:**
- Which sections have been presented and approved (Vision, Tasks, Agents/Waves)
- The plan content generated so far
- The plan file path if it's been saved
- User feedback on each section

### panda-executor

**Plan context:**
- Plan file path (absolute)
- Plan title and summary
- Total task count
- Agent team composition (agent names, roles, task assignments)

**Execution progress:**
- Current wave number
- For each task: status (pending / in-progress / complete / failed / blocked)
- For completed tasks: commit hashes, audit results (pass/fail/auto-fixed), brief summary of what was done
- For in-progress tasks: which agent is working on it, what's been done so far
- For failed/blocked tasks: what went wrong, error details

**Worktree state:**
- List of all worktree branches and their paths
- Which worktrees are active vs merged vs abandoned
- Any merge results or conflicts encountered
- The main/working branch name

**Verification state:**
- Post-task audit results for each completed task
- Any manual intervention items outstanding
- Full test suite status (last run result)

### panda-debug

**Problem context:**
- The original problem statement (symptom, expected behavior, what's been tried, when it started, reproduction steps)
- Codebase reconnaissance results (entry points, call graph, state flow, dependencies, recent changes, test coverage, config, error handling)
- The investigation plan (likely category, which agents deployed, worktree strategy)

**Phase 1 — Investigation results:**
- Instrumenter report: what was instrumented, log point locations, DEBUG-INSTRUMENTATION.md content
- Researcher report: findings with sources, relevance, solutions, confidence, RESEARCH-FINDINGS.md content
- Reproducer report: trigger command, consistency, boundaries, minimal test path, REPRODUCTION.md content
- Hypothesizer report: all hypotheses ranked with claims, mechanisms, code paths, evidence, HYPOTHESES.md content

**Phase 2 — Synthesis & Solve:**
- Cross-reference analysis (how findings align or conflict)
- Recommended fix approach
- Solver attempts: which hypotheses tried, what was implemented, commit hashes
- FIX-SUMMARY.md content if fix was applied

**Phase 3 — Review & Verify:**
- Reviewer verdict (APPROVED / APPROVED WITH CHANGES / NEEDS REWORK)
- REVIEW-VERDICT.md content
- How many solver-reviewer iterations completed
- Outstanding issues from review

**Worktree state:**
- debug-instrumentation branch and path
- debug-reproduction branch and path
- debug-fix branch and path (including any fix attempt sub-branches)
- Which worktrees still exist vs cleaned up

### panda-council

**Council setup:**
- The council prompt (the framed problem statement)
- Whether the user confirmed/edited the prompt
- Prerequisites check result (codex and gemini available?)

**Deliberation state:**
- Current round number (1-5)
- For each completed round, each model's full response:
  - Research summary (what files examined, what was found)
  - Position (their stance)
  - Reasoning (with code references)
  - Concerns
  - Confidence level
- For rebuttal rounds: each model's updated position, new evidence, responses to other models, remaining disagreements
- Alignment analysis after each round (agreement areas, divergence points, different research paths, majority forming?)

**Outcome:**
- Whether consensus has been reached (and if so, which 2 models agreed)
- The verdict if delivered (decision, agreed by, dissent, evidence basis)
- If no consensus after 5 rounds: the synthesis and options presented

### panda-audit

**Trigger context:**
- What triggered the audit (manual invocation, post-task from executor, specific files/scope)
- Scope (full project, specific files, specific task's changes)

**Phase 0 — Project patterns:**
- Detected framework, router, state management, API layer, build tool
- Active dimensions (D1-D5) and their configuration
- Any unusual patterns noted

**Layer 1 — knip results:**
- Full knip output (categorized: unused files, unused exports, unused deps, unlisted deps, unresolved imports)
- Each finding with file:line

**Layer 2 — Adversarial audit results:**
- Each finding with type, location, evidence, and which dimension failed
- Wiring contract checks if applicable (which checks passed, which failed)

**Layer 3 — Auto-fix results:**
- Fixes applied (finding, fix description, verification result)
- Manual intervention items (finding, reason auto-fix skipped, suggested action)
- Re-verification results
- Current iteration count (of max 3)

**Final status:**
- PASS or FAIL
- Remaining issues count and details

## Step 3: Gather Artifacts

Scan the conversation and filesystem for artifacts created during the session:

- **Plan files**: `~/.claude/plans/*.md`
- **Research documents**: Any `.md` files created by agents (RESEARCH-FINDINGS.md, HYPOTHESES.md, REPRODUCTION.md, FIX-SUMMARY.md, REVIEW-VERDICT.md, DEBUG-INSTRUMENTATION.md)
- **Worktree branches**: Run `git worktree list` and `git branch --list "plan-exec/*" "debug/*"` to capture active branches
- **Audit changelogs**: Any panda audit changelog output
- **Brain dump extractions**: If Path B brainstorm, the structured extraction

For each artifact, record its absolute path and verify it still exists on disk.

## Step 4: Write the State File

Create the directory if it doesn't exist:
```bash
mkdir -p ~/.claude/panda-state
```

Write the state file to `~/.claude/panda-state/STATE.md`:

```markdown
---
skill: panda-brainstorm
phase: 2
phase_detail: "Research+Challenge turn 5, user chose microservices direction"
timestamp: 2026-03-16T23:50:00
project_dir: ~/path/to/project
git_branch: main
git_commit: abc1234
---

# Panda Session State

## Active Skill
panda-brainstorm, Phase 2 (Research + Challenge Loop), Turn 5 of unlimited.
Path A (Fresh Idea). User chose microservices direction in turn 3, currently exploring
service mesh options.

## Context Snapshot

### Phase 0: Repo Scan
[paste the full repo scan results here — project type, stack, architecture, patterns]

### Phase 1: Intake Summary
**Round 1 answers:**
- Core idea: [user's answer]
- Target users: [user's answer]
- Problem solved: [user's answer]

**Research Sprint 1 (Landscape):**
- Web Researcher: [key findings with URLs]
- GitHub Explorer: [key repos with URLs]
- Competitive Analyst: [key products/tools]

**Round 2 answers:**
- Architecture preference: [user's choice from Sprint 1 options]
- Integration requirements: [user's answer]
- Scale/environment: [user's answer]

**Research Sprint 2 (Constraint-Scoped):**
- [findings, more targeted than Sprint 1]

**Round 3 answers:**
- Success criteria: [user's answer]
- v1 scope: [user's answer]
- Non-negotiables: [user's answer]

### Phase 2: Research + Challenge Turns
**Turn 1:**
- Suggestions presented: [titles of 5 suggestions with brief summaries]
- Challenges posed: [what was challenged]
- User response: [what they said, what direction they chose]

**Turn 2:**
[same structure]

[...repeat for each turn...]

**Current direction:**
[the accumulated picture of what's being built, architecture chosen, scope, key decisions]

## Decisions Made
- Architecture: microservices with gRPC
- Database: PostgreSQL with read replicas
- Auth: OAuth2 with Okta integration
- Scope: 3 core services for v1, defer analytics service
- [every decision the user confirmed during the session]

## Open Questions
- Service mesh: Istio vs Linkerd — research presented, user hasn't decided
- Deployment: Kubernetes vs ECS — not yet discussed
- [anything that was about to be explored]

## Next Step
Phase 2, Turn 6. The user was presented with service mesh options (Istio vs Linkerd)
in Turn 5 and needs to respond. After their response, research should focus on
deployment strategy (Kubernetes vs ECS) as this is the last major architecture
decision before the brainstorm can move to Phase 3.

Research agents for next turn should query:
- Web Researcher: "[chosen service mesh] production gotchas [stack]"
- GitHub Explorer: "[chosen service mesh] example configurations"
- Competitive Analyst: "companies using [chosen mesh] at [user's scale]"

## Artifacts
- ~/.claude/plans/ — no plan generated yet (still in Phase 2)
- No worktrees active (brainstorm doesn't use worktrees)
- Research findings accumulated in conversation only (not saved to disk)
```

**Formatting rules:**
- Use the YAML frontmatter exactly as shown — panda-resume parses it
- The `phase_detail` field should be a human-readable one-liner about exactly where in the phase the user stopped
- `git_commit` should be the current HEAD commit hash (run `git rev-parse --short HEAD`)
- `git_branch` should be the current branch (run `git branch --show-current`)
- The "Next Step" section is the most important — it must be specific enough that a fresh conversation can pick up without asking "where were we?"
- Include actual content, not placeholders — paste real findings, real decisions, real URLs

**What to omit:**
- Raw agent prompts (the skill files already have these)
- Full file contents that were read during the session (reference by path instead)
- Conversation pleasantries or back-and-forth that doesn't carry information

## Step 5: Confirm to User

After saving, present a confirmation:

```
Session saved to ~/.claude/panda-state/STATE.md

Captured:
- Skill: panda-brainstorm
- Phase: 2 (Research + Challenge Loop, Turn 5)
- Decisions locked: 4 (architecture, database, auth, v1 scope)
- Open questions: 2 (service mesh, deployment)
- Research sprints completed: 2 (landscape + constraint-scoped)
- Challenge turns completed: 5
- Artifacts: none on disk (research in state file)

To resume in a new conversation:
/panda-resume
```

Adjust the "Captured" summary to match the actual skill. For panda-executor, show task completion counts. For panda-debug, show which investigation agents completed. For panda-council, show round count and consensus status. For panda-audit, show layer completion and finding counts.

## Edge Cases

### Multiple panda skills in one conversation
If the user ran brainstorm and then executor in the same conversation, ask which one to save. If they say "both," save the most recent one to STATE.md and the other to STATE-[skill].md in the same directory.

### Very early in a session
If the user pauses in Phase 0 or the first step of a skill, there may be almost nothing to capture. That's fine — save what exists. Even a Phase 0 repo scan result saves the user from re-scanning.

### State file already exists
Overwrite it. The previous state was either already resumed (and thus consumed) or abandoned. If the user wants to keep the old state, panda-resume archives it before loading.

### No git repo
Skip the git_branch and git_commit fields. Note `project_dir` only.

### Skill invoked but no user interaction yet
If the skill was just invoked (e.g., the user said "/panda-brainstorm" and Claude responded with the first question, but the user hasn't answered yet), save what exists — the Phase 0 scan and the initial question. The "Next Step" should note that the user needs to answer the first intake question.

### Large state
Some sessions accumulate substantial state — 8+ brainstorm turns with full research results, or an executor session with 20+ tasks. Don't truncate. The state file can be large. Panda-resume needs all of it to reconstruct properly. If a single research finding has 5 URLs and detailed analysis, include all of it.
