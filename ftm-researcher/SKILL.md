---
name: ftm-researcher
description: Deep parallel research engine with 7 domain-specialized finder agents, adversarial review via ftm-council, adaptive wave-based search, structured reconciliation with disagreement maps, credibility scoring, and conversational iteration. Use when the user wants thorough research on any topic — "research X", "find out about Y", "what's the state of the art on Z", "compare approaches to W", "deep dive into X", "look into Y". Also invoked by ftm-brainstorm for its research sprints. Triggers on "research", "investigate", "deep dive", "state of the art", "compare", "find examples of", "what's out there for", "how do others handle", "find me evidence", "look into". For idea exploration and brainstorming, use ftm-brainstorm instead (which calls ftm-researcher internally for research).
---

# ftm-researcher

Deep parallel research engine with 7 domain-specialized finder agents, adversarial review via ftm-council, adaptive wave-based search, structured reconciliation with disagreement maps, credibility scoring, and conversational iteration.

## Events

### Emits
- `research_complete` — when synthesis pipeline finishes and structured output is ready
  - Payload: `{ query, mode, findings_count, consensus_count, contested_count, unique_count, sources_count, duration_ms }`
- `task_completed` — when the full research session finishes (including any conversational iteration)
  - Payload: `{ task_title, duration_ms }`

### Listens To
- `task_received` — begin research when ftm-mind or ftm-brainstorm routes a research request
  - Expected payload: `{ task_description, plan_path, wave_number, task_number }`
  - Note: `depth_mode` and `context_register` are derived internally from request context, not from event payload

## Config Read

Read `~/.claude/ftm-config.yml`:
- Use `planning` model from the active profile for finder agents
- Use `review` model for fallback challenger agents
- Read `execution.per_skill_overrides.ftm-researcher` for agent cap (default 10 if override absent, fall back to `execution.max_parallel_agents` if neither is set)

## Blackboard Read

On startup, load context from the FTM blackboard:
1. Load `~/.claude/ftm-blackboard/context.json`
2. Filter experiences by `task_type: "research"`
3. Load matching experience files to inform agent dispatch and subtopic decomposition
4. Load `~/.claude/ftm-blackboard/patterns.json` for recurring research patterns

## Mode System

Three depth modes calibrate agent count, synthesis pipeline, and council invocation:

```
Quick:    3 finders (Web Surveyor, GitHub Miner, Codebase Analyst), no council, no reconciler.
          Single-pass synthesis by orchestrator. ~1-2 min.

Standard: 7 finders + reconciler, no council. Normalize → rank → reconcile. ~3-5 min.

Deep:     7 finders → adaptive wave 2 → ftm-council → reconciler. Full pipeline. ~5-10 min.
```

Mode is detected from request context:
- "quick look" / "briefly" / "just a quick" → quick mode
- "deep dive" / "thorough" / "comprehensive" / "exhaustive" → deep mode
- Default (no explicit signal) → standard mode

## The Main Loop

```
PHASE 0: REPO SCAN
  Silent background Explore agent scans the local codebase (same as ftm-brainstorm).
  Produces: project_context { tech_stack, key_files, existing_patterns, integration_points }
  Used by: Codebase Analyst finder + orchestrator subtopic decomposition

PHASE 1: INTAKE
  - Parse the research question
  - Detect depth mode
  - Decompose into 7 subtopics (one per finder domain)
  - Load blackboard context and filter relevant prior research

PHASE 2: WAVE 1
  - Dispatch 7 finders in parallel, each with:
    - Their unique domain constraint
    - Their assigned subtopic
    - Project context from Phase 0
    - Context register (accumulated findings from prior waves/turns)
    - Summary of previous findings to build on (do NOT re-search)
  - Collect all findings (3-8 per agent = 21-56 total)

PHASE 3: ADAPTIVE REFINEMENT (deep mode only)
  - Analyze wave 1 findings across 4 dimensions:
    SATURATED: subtopic has 3+ diverse findings — reassign agent to a gap
    THIN: subtopic has 1-2 findings — same agent, more specific query
    GAP: subtopic has 0 findings — agent gets broader query + alternative terms
    CONTESTED: 2+ agents directly contradict — assign 2 agents (one per side) to resolve
    SURPRISE: findings outside original subtopics — assign most relevant agent to explore
  - Dispatch wave 2 agents with reshaped queries
  - Merge wave 2 findings with wave 1 before synthesis

PHASE 4: SYNTHESIS PIPELINE
  See ftm-researcher/references/synthesis-pipeline.md for full pipeline.
  Summary:
  1. Normalize & deduplicate (group by semantic similarity, track agent_count, source diversity)
  2. Adversarial review: ftm-council (deep mode) or fallback challengers (standard mode)
  3. Pairwise rank contested claims (LLM-as-judge tournament)
  4. Reconcile into disagreement map (consensus / contested / unique / refuted tiers)

PHASE 5: PRESENT
  - Render disagreement map as structured markdown
  - Show consensus findings, contested pairs, unique insights (flagged), refuted claims
  - Include source summary table (type | count | avg credibility)
  - Emit `research_complete` event

PHASE 6: ITERATE
  - Enter conversational iteration mode
  - Wait for user response
  - Route based on intent (see Conversational Iteration Protocol below)
```

## Conversational Iteration Protocol

After presenting results, the skill enters iteration mode. Route user responses:

- "dig deeper on finding #N" / "more on #N" → spawn 3 targeted agents on that specific finding's topic
- "I disagree with X" / "I think X is wrong because Y" → spawn counter-evidence agents, update findings
- "focus on [angle]" / "what about the security angle" → reshape subtopics with new weighting, re-dispatch
- "council finding #N" / "get more opinions on #N" → route specific claim to ftm-council
- "more on [agent]'s findings" → re-dispatch that agent with broader query
- "compare A vs B" → spawn comparison agent with both findings as context
- "done" / "thanks" / "that's enough" / "looks good" → finalize, write blackboard, emit events

Each iteration:
1. Updates the structured JSON artifact
2. Re-renders the markdown output
3. Updates the context register for subsequent turns

## Agent Roster

See `ftm-researcher/references/agent-prompts.md` for full prompts.

| Agent | Domain | Source Types |
|---|---|---|
| Web Surveyor | Blog posts, case studies, tutorials, technical write-ups | blog, news |
| Academic Scout | Papers (arxiv, ACM, IEEE), official docs, RFCs, specs | peer_reviewed, primary, official_docs |
| GitHub Miner | GitHub repos, OSS implementations, code patterns | code_repo |
| Competitive Analyst | Products, user reviews (Reddit/HN/Twitter), market analysis | forum, news |
| Stack Overflow Digger | Stack Overflow, community Q&A, pitfalls, solved problems | qa_site |
| Codebase Analyst | Local repo only — Grep, Read, Glob tools, git log | codebase |
| Historical Investigator | Solutions from 5-10+ years ago, evolution, failed approaches | primary, blog |

## Synthesis Pipeline

See `ftm-researcher/references/synthesis-pipeline.md` for full specification.

5 phases: Normalize → Adversarial Review → Pairwise Rank → Reconcile → Render

Output tiers:
1. **Consensus** — 3+ agents agree, council agreed, multiple source types. Highest confidence.
2. **Contested** — Council disagreed or pairwise ranking was close. Present both sides.
3. **Unique Insights** — 1 agent only, not contradicted. High value OR hallucination — flag for user.
4. **Refuted** — Council rejected or pairwise loser with weak evidence. Still present briefly.

## Adaptive Search

See `ftm-researcher/references/adaptive-search.md` for full protocol.

Deep mode only. Reshapes wave 2 queries based on wave 1 coverage analysis across 4 dimensions: SATURATED, THIN, GAP, CONTESTED, SURPRISE.

## Output Format

See `ftm-researcher/references/output-format.md` for JSON schema and markdown template.

Primary output: structured JSON artifact for skill-to-skill consumption (ftm-brainstorm, ftm-executor).
Secondary output: rendered markdown for human display.

## Council Integration

See `ftm-researcher/references/council-integration.md` for full protocol.

Deep mode only. Routes top claims through ftm-council (Claude + Codex + Gemini independent review).

Fallback (council unavailable): 2 standalone agents on the `review` model:
- Devil's Advocate — finds reasons each claim is WRONG
- Edge Case Hunter — finds where each claim BREAKS

## Credibility Scoring

See `ftm-researcher/scripts/score_credibility.py` for implementation.

4 dimensions (weighted):
- Source type weight (35%): primary > peer_reviewed > official_docs > news > blog > forum
- Recency (20%): decay based on age, faster for fast-moving topics
- Domain authority (25%): HIGH_AUTHORITY domains (arxiv, MDN, AWS docs) score 0.9
- Bias detection (20%): sensationalism penalties, balanced language bonuses

Bonuses and penalties:
- Corroboration bonus: +0.15 if independently found by 2+ agents from different source types
- Circular sourcing: -0.20 flag if multiple sources trace to same original

Trust levels: high (>=0.75) | moderate (>=0.55) | low (>=0.35) | verify (<0.35)

## Blackboard Write

After `research_complete` or session end:
1. Update `~/.claude/ftm-blackboard/context.json` with research session summary
2. Write experience file: `~/.claude/ftm-blackboard/experiences/research-[timestamp].json`
   - Fields: query, mode, findings_count, top_consensus_claims, source_diversity, duration_ms
3. Update `~/.claude/ftm-blackboard/index.json` with new experience entry
4. Emit `task_completed` event

## Session State (for ftm-pause/resume)

The following state is persisted for pause/resume support:
- Current phase (0-6)
- Depth mode
- All wave 1 and wave 2 findings (raw)
- Synthesis state (normalized claims, council verdicts, ranked pairs)
- Disagreement map (current version)
- Conversation history (iteration turns)
- Context register (accumulated findings across turns)
- Project context from Phase 0 repo scan

## References

- `ftm-researcher/references/agent-prompts.md` — 7 finder agent prompts + orchestrator decomposition protocol
- `ftm-researcher/references/synthesis-pipeline.md` — 5-phase synthesis pipeline + reconciler prompt
- `ftm-researcher/references/adaptive-search.md` — Wave 1 → wave 2 refinement protocol
- `ftm-researcher/references/output-format.md` — JSON schema + markdown template + iteration protocol
- `ftm-researcher/references/council-integration.md` — ftm-council interface + fallback challenger prompts
- `ftm-researcher/scripts/score_credibility.py` — Source credibility scoring
- `ftm-researcher/scripts/validate_research.py` — Research output validation

## Requirements

- config: `~/.claude/ftm-config.yml` | optional | planning and review model profiles, per_skill_overrides.ftm-researcher agent cap
- reference: `ftm-researcher/references/agent-prompts.md` | required | 7 finder agent prompts and orchestrator decomposition protocol
- reference: `ftm-researcher/references/synthesis-pipeline.md` | required | 5-phase synthesis pipeline
- reference: `ftm-researcher/references/adaptive-search.md` | optional | wave 2 adaptive refinement (deep mode only)
- reference: `ftm-researcher/references/output-format.md` | required | JSON schema and markdown template
- reference: `ftm-researcher/references/council-integration.md` | optional | ftm-council interface (deep mode only)
- reference: `~/.claude/ftm-blackboard/context.json` | optional | session state
- reference: `~/.claude/ftm-blackboard/patterns.json` | optional | recurring research patterns

## Risk

- level: read_only
- scope: reads web sources and local codebase via agents; writes blackboard experience entry; writes structured JSON artifact; does not modify project source files
- rollback: no project mutations; blackboard write can be reverted by editing JSON files

## Approval Gates

- trigger: research complete and user says "done" / "thanks" | action: finalize, write blackboard, emit events
- trigger: deep mode and ftm-council invoked | action: council runs automatically on top claims (no user gate needed for this step)
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: ftm-council not available (deep mode) | action: use 2 fallback challenger agents (Devil's Advocate + Edge Case Hunter) instead
- condition: agent cap exceeded | action: queue excess agents and dispatch after current wave completes
- condition: research agent returns no findings | action: broaden query and retry; if still empty, report "No prior art found — this may be novel"
- condition: blackboard missing | action: proceed without experience-informed shortcuts

## Capabilities

- mcp: `WebSearch` | optional | finder agents for web, GitHub, and competitive research
- mcp: `WebFetch` | optional | fetching specific URLs found during research
- mcp: `sequential-thinking` | optional | complex synthesis and reconciliation

## Event Payloads

### research_complete
- skill: string — "ftm-researcher"
- query: string — original research question
- mode: string — "quick" | "standard" | "deep"
- findings_count: number — total normalized findings
- consensus_count: number — findings with 3+ agent agreement
- contested_count: number — findings with council disagreement
- unique_count: number — single-agent findings
- sources_count: number — total sources cited
- council_used: boolean — whether ftm-council was invoked
- duration_ms: number — total research duration

### task_completed
- skill: string — "ftm-researcher"
- task_title: string — research topic title
- duration_ms: number — total session duration including iterations
