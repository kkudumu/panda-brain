# ftm-researcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, codebase-aware deep research skill with 7 domain-specialized parallel finder agents, adversarial review via ftm-council, adaptive wave-based search, structured reconciliation with disagreement maps, credibility scoring, and conversational iteration — fully integrated into the FTM ecosystem.

**Architecture:** 3-tier fan-out pipeline: 7 finder agents (each with a unique information domain) dispatch in parallel, results feed into ftm-council for multi-provider adversarial review (Claude + Codex + Gemini), then a reconciler agent produces a disagreement map with consensus/contested/unique insight tiers. Adaptive search reshapes wave 2 queries based on wave 1 findings. Output is both structured JSON (for skill consumption) and rendered markdown (for human reading). Conversational — user can iterate, drill down, redirect between waves.

**Tech Stack:** Claude Code skills (markdown + YAML), Python 3.8+ (credibility scoring scripts), promptfoo (evals), existing FTM infrastructure (blackboard, events, config, ftm-council, ftm-mind routing)

---

## Key Research Findings

- **10 agents is the practical sweet spot** — Google research shows collaborating agents hit walls at 3-4, but independent fan-out agents (FTM's pattern) scale linearly. Kimi benchmarks show diminishing returns beyond ~15. [Source: Google "Towards a Science of Scaling Agent Systems"](https://arxiv.org/html/2512.08296v1)
- **Fan-out is easy; synthesis is hard** — every major framework (CrewAI, Swarms, DeepResearchAgent) treats result merging/deduplication as the core engineering challenge. The LLM-Blender rank-then-fuse pattern is the strongest synthesis approach. [Source: LLM-Blender ACL 2023](https://arxiv.org/abs/2306.02561)
- **Productive disagreement > corroboration** — Kimi's PARL training and Perplexity's Model Council both show that forcing reconciliation of conflicting findings produces better results than corroboration. OpenAI Deep Research's biggest flaw is corroboration bias. [Source: Perplexity Model Council](https://www.perplexity.ai/hub/blog/introducing-model-council)
- **Agent prompt diversity is critical** — the "Team of Rivals" paper shows voting-based protocols with tailored instructions outperform consensus by +13.2% in reasoning accuracy. Each agent needs a unique cognitive stance, not just a different query. [Source: arxiv.org/html/2601.14351v1](https://arxiv.org/html/2601.14351v1)
- **Existing competitor: 199-bio skill** — 8-phase pipeline, 5-10 concurrent searches, credibility scoring. Gaps to exploit: no codebase awareness, no prompt diversity, no disagreement architecture, no ecosystem composability, static search strategy. [Source: github.com/199-biotechnologies/claude-deep-research-skill](https://github.com/199-biotechnologies/claude-deep-research-skill)
- **Claude Code has no hard agent cap** — GitHub issue #15487 confirms Claude Code itself will spawn 20+ agents. The 5-agent limit in ftm-config is self-imposed. Rate limits (tier-dependent, 50-4000 RPM) and local I/O are the real constraints. [Source: GitHub Issue #15487](https://github.com/anthropics/claude-code/issues/15487)
- **Credibility scoring: weight source type + recency + independence** — MAFC framework uses confidence-weighted consensus. Source type weighting (primary > peer-reviewed > official docs > news > blog > forum), recency decay, corroboration bonus for independent discovery, circular sourcing detection. [Source: MAFC Scientific Reports 2026](https://www.nature.com/articles/s41598-026-41862-z)

## Architecture Decisions

1. **Standalone skill with ecosystem composability** — ftm-researcher is its own skill (SKILL.md, events, blackboard), not embedded in brainstorm. Other skills call it via a defined interface: pass `{research_question, context_register, depth_mode}`, get `{findings, disagreement_map, confidence_scores}` back.

2. **Agent prompt diversity via domain separation + explicit subtopic decomposition** — each of 7 finder agents searches a different information domain (web, academic, GitHub, competitive, Stack Overflow, codebase, historical). The orchestrator decomposes the research question into subtopics before dispatch, assigning each agent a unique facet within their domain.

3. **ftm-council as adversarial review tier** — instead of custom challenger agents, top claims from finders route through ftm-council for multi-provider deliberation (Claude + Codex + Gemini). Where providers disagree, claims are flagged as contested. Fallback: if Codex/Gemini unavailable, revert to standalone devil's advocate + edge case hunter agents on the review model.

4. **Adaptive wave-based search** — wave 1 results inform wave 2 queries. The orchestrator analyzes what's well-covered, what's thin, what's contradictory, then reshapes subtopic decomposition and reassigns agents to gaps.

5. **Rank-then-fuse synthesis (LLM-Blender inspired)** — reconciler does pairwise comparison of conflicting claims before synthesis. Bad outputs are eliminated before synthesis begins. Output is a disagreement map (consensus/contested/unique tiers), not an averaged summary.

6. **3 depth modes** — Quick (3 finders, no council, no reconciler), Standard (7 finders + reconciler, no council), Deep (full pipeline: 7 finders + adaptive wave 2 + ftm-council + reconciler).

7. **Conversational iteration** — the skill supports multi-turn interaction. User can drill down ("dig deeper on finding #3"), challenge ("I disagree with X, find more evidence"), redirect ("focus on the security angle"), or request escalation ("council finding #4").

8. **Credibility scoring: prompt-based + Python validators** — prompt-based scoring for inline use, Python scripts for batch validation. Source type weighting, recency decay, corroboration bonus, circular sourcing detection.

---

## File Structure

```
ftm-researcher.yml                          # YAML trigger file
ftm-researcher/
  SKILL.md                                  # Main skill instructions
  references/
    agent-prompts.md                        # 7 finder agent prompts + orchestrator protocol
    synthesis-pipeline.md                   # 5-phase synthesis pipeline + reconciler prompt
    adaptive-search.md                      # Wave 1 → wave 2 refinement protocol
    output-format.md                        # JSON schema + markdown template + iteration protocol
    council-integration.md                  # ftm-council interface + fallback challenger prompts
  scripts/
    score_credibility.py                    # Source credibility scoring
    validate_research.py                    # Research output validation
  evals/
    trigger-accuracy.yaml                   # promptfoo eval: should/shouldn't trigger
    agent-diversity.yaml                    # promptfoo eval: 7 agents produce non-overlapping results
    synthesis-quality.yaml                  # promptfoo eval: disagreement map structure
tests/
  ftm-researcher.test.mjs                  # manifest integration + script validation tests
```

---

## Tasks

### Task 1: Skill scaffold — YAML trigger + SKILL.md

**Files:**
- Create: `ftm-researcher.yml`
- Create: `ftm-researcher/SKILL.md`

- [ ] **Step 1: Create the YAML trigger file**

```yaml
name: ftm-researcher
description: Deep parallel research engine with 7 domain-specialized finder agents, adversarial review via ftm-council, adaptive wave-based search, and codebase awareness. Use when the user wants thorough research on any topic — "research X", "find out about Y", "what's the state of the art on Z", "compare approaches to W", "deep dive into X", "look into Y". Also invoked by ftm-brainstorm for its research sprints. Triggers on "research", "investigate", "deep dive", "state of the art", "compare", "find examples of", "what's out there for", "how do others handle", "find me evidence", "look into". For idea exploration and brainstorming, use ftm-brainstorm instead (which calls ftm-researcher internally for research).
```

- [ ] **Step 2: Create the SKILL.md with full instructions**

The SKILL.md must contain these sections in order:

**Frontmatter:** name, description (same as yml but can be more verbose)

**Events section:**
```markdown
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
```

**Config Read:** Read `~/.claude/ftm-config.yml` — use `planning` model for finders, `review` model for fallback challengers. Read `per_skill_overrides.ftm-researcher` for agent cap (default 10).

**Blackboard Read:** Same pattern as ftm-brainstorm — load context.json, filter experiences by task_type "research", load matching experiences, load patterns.json.

**Mode System:**
```
Quick:    3 finders (Web Surveyor, GitHub Miner, Codebase Analyst), no council, no reconciler
          Single-pass synthesis by orchestrator. ~1-2 min.
Standard: 7 finders + reconciler, no council. Normalize → rank → reconcile. ~3-5 min.
Deep:     7 finders → adaptive wave 2 → ftm-council → reconciler. Full pipeline. ~5-10 min.
```

**The Main Loop:**
```
PHASE 0: REPO SCAN (silent, background Explore agent — same as ftm-brainstorm)
PHASE 1: INTAKE — parse research question, detect mode, decompose into subtopics
PHASE 2: WAVE 1 — dispatch 7 finders in parallel with unique domains + subtopic assignments
PHASE 3: ADAPTIVE REFINEMENT — analyze wave 1, reshape queries, dispatch wave 2 (deep mode only)
PHASE 4: SYNTHESIS PIPELINE — normalize → council/challenger → pairwise rank → reconcile
PHASE 5: PRESENT — render disagreement map + structured findings to user
PHASE 6: ITERATE — user can drill down, challenge, redirect, or accept
```

**Conversational Iteration Protocol:**
- "dig deeper on finding #3" → spawn targeted agents on that specific finding
- "I disagree with X" → spawn counter-evidence agents
- "focus on the security angle" → reshape and re-run with security-weighted subtopics
- "council finding #4" → route specific claim to ftm-council
- "done" / "thanks" / "that's enough" → finalize, write blackboard, emit events

**Blackboard Write:** Same pattern as other FTM skills — update context.json, write experience file, update index.json, emit events.

**Session State (for ftm-pause/resume):** Phase tracking, mode, all wave results, synthesis state, conversation history, context register.

- [ ] **Step 3: Verify SKILL.md frontmatter parses correctly**

Run: `node bin/generate-manifest.mjs && node -e "const m = JSON.parse(require('fs').readFileSync('ftm-manifest.json','utf8')); const s = m.skills.find(s=>s.name==='ftm-researcher'); console.log(s ? 'OK: ' + s.name : 'FAIL: not found')"`
Expected: `OK: ftm-researcher`

- [ ] **Step 4: Commit**

```bash
git add ftm-researcher.yml ftm-researcher/SKILL.md
git commit -m "feat(ftm-researcher): add skill scaffold with YAML trigger and SKILL.md"
```

---

### Task 2: Agent prompts — 7 finder roles + orchestrator

**Files:**
- Create: `ftm-researcher/references/agent-prompts.md`

- [ ] **Step 1: Write the orchestrator subtopic decomposition protocol**

The orchestrator receives the user's research question and decomposes it into 7 subtopics — one per finder agent. The decomposition must ensure:
- Each subtopic maps to exactly one finder's domain
- No overlap between subtopics
- Coverage of the full research question
- Adaptation to question type (technical, market, conceptual, comparative)

Format:
```markdown
## Orchestrator Protocol: Subtopic Decomposition

Given research question Q, decompose into 7 facets:

1. GENERAL LANDSCAPE (→ Web Surveyor): What's the current state? Blog posts, case studies, tutorials.
2. THEORETICAL FOUNDATIONS (→ Academic Scout): What does the research say? Papers, official docs, specs.
3. IMPLEMENTATION PATTERNS (→ GitHub Miner): How have others built this? Repos, code, OSS.
4. MARKET REALITY (→ Competitive Analyst): What products exist? User reviews, complaints, gaps.
5. PRACTITIONER WISDOM (→ Stack Overflow Digger): What pitfalls exist? Common mistakes, solved problems.
6. LOCAL CONTEXT (→ Codebase Analyst): How does our project relate? Existing patterns, conventions, integration points.
7. HISTORICAL EVOLUTION (→ Historical Investigator): How was this solved before? What failed? What evolved?

For each facet, generate a specific search query tailored to the information domain.
```

- [ ] **Step 2: Write the 7 finder agent prompts**

Each agent prompt follows this structure:
```markdown
## Agent: [Name]

[Role description and cognitive stance]

TEMPLATE (filled by orchestrator at dispatch time):
- Research question: [Q]
- Your subtopic: [specific facet assigned]
- Project context: [from Phase 0 repo scan]
- Context register: [accumulated findings from prior waves/turns]
- Previous findings to build on: [summary — do NOT re-search these]
- Depth level: [broad | focused | implementation]

DOMAIN CONSTRAINT: [specific information sources this agent searches]
ANTI-REDUNDANCY: [what this agent must NOT search]

RETURN FORMAT:
For each finding, return:
- claim: [one-sentence factual claim]
- evidence: [2-3 sentence supporting detail]
- source_url: [URL]
- source_type: [primary | peer_reviewed | official_docs | news | blog | forum | code_repo | qa_site | codebase]
- confidence: [0.0-1.0, self-assessed]
- agent_role: [your role name]

Return 3-8 findings. Quality over quantity. If your domain has nothing relevant, return 0 findings with a note explaining why.
```

Write all 7 prompts with the following domain constraints:

| Agent | Domain Constraint | Anti-Redundancy |
|---|---|---|
| Web Surveyor | Blog posts, case studies, tutorials, technical write-ups. WebSearch tool. | Do NOT search GitHub repos, academic papers, or Stack Overflow. |
| Academic Scout | Papers (arxiv, ACM, IEEE), official documentation, RFCs, specifications. WebSearch filtered to academic domains. | Do NOT search blogs, forums, or product sites. |
| GitHub Miner | GitHub repos, code patterns, OSS implementations. WebSearch filtered to github.com. | Do NOT search blogs or Q&A sites. Report: repo URL, stars, last commit, architecture notes. |
| Competitive Analyst | Products, tools, user reviews on Reddit/HN/Twitter, market analysis. WebSearch filtered to reddit.com, news.ycombinator.com, product sites. | Do NOT search GitHub repos or academic papers. Focus on what users love/hate. |
| Stack Overflow Digger | Stack Overflow, community Q&A, common pitfalls, solved problems. WebSearch filtered to stackoverflow.com, stackexchange.com. | Do NOT search GitHub or blogs. Focus on battle-tested solutions and known footguns. |
| Codebase Analyst | Local repo ONLY. Uses Grep, Read, Glob tools. Searches code, git log, architecture docs, INTENT.md, ARCHITECTURE.mmd. | Do NOT use WebSearch. No external sources. All findings cite file paths and line numbers. |
| Historical Investigator | How this was solved 5-10+ years ago. WebSearch with date filters (before:2024). Archive.org, historical blog posts, deprecated tools. | Do NOT search for current solutions. Focus on evolution, failed approaches, what changed and why. |

- [ ] **Step 3: Commit**

```bash
git add ftm-researcher/references/agent-prompts.md
git commit -m "feat(ftm-researcher): add 7 finder agent prompts with orchestrator decomposition"
```

---

### Task 3: Synthesis pipeline — normalize, rank, reconcile

**Files:**
- Create: `ftm-researcher/references/synthesis-pipeline.md`

- [ ] **Step 1: Write the 5-phase synthesis pipeline**

```markdown
# Synthesis Pipeline

## Phase 1: Normalize & Deduplicate

Input: Raw findings from all finder agents (7 agents x 3-8 findings each = 21-56 findings)

Steps:
1. Flatten all findings into a single list
2. Group by semantic similarity (same claim from different agents)
3. For each group:
   - Merge into a single canonical claim
   - Track which agents found it (agent_count)
   - Track source type diversity (source_diversity_score = unique source types / total sources)
   - Flag circular sourcing: if all sources in a group cite the same original source, mark as circular=true
4. Output: unique_claims[] sorted by agent_count DESC, source_diversity_score DESC

## Phase 2: Adversarial Review (ftm-council)

Input: Top claims from Phase 1 (all claims with agent_count >= 2, plus any high-confidence unique claims)

Council invocation:
- Send claims as a structured prompt to ftm-council
- Ask: "Evaluate each claim. For each: Is the evidence sufficient? What would make this wrong? Are there alternative explanations? Rate confidence 0-1."
- Council runs Claude + Codex + Gemini independently, then reconciles

Output: claims[] with council_verdict (agreed | contested | insufficient_evidence), provider_disagreements[]

FALLBACK (if Codex/Gemini unavailable):
- Spawn 2 standalone agents on the review model:
  - Devil's Advocate: "Your job is to find reasons each claim is WRONG. Search for counter-evidence, flag single-source claims, identify logical gaps."
  - Edge Case Hunter: "Your job is to find where each claim BREAKS. Scaling limits, security concerns, accessibility gaps, failure modes under load."
- Both receive all claims and return challenge_findings[]

## Phase 3: Pairwise Rank (for contested claims)

Input: Claims marked as "contested" by council

For each pair of conflicting claims:
- LLM-as-judge prompt: "Given research question Q, Claim A says [X] with evidence [E1]. Claim B says [Y] with evidence [E2]. Which claim is better supported? Why? Consider: source authority, evidence specificity, logical coherence, relevance to the question."
- Tournament bracket: winners advance, losers are demoted to "minority view"

Output: ranked_claims[] with rank_position, judge_rationale

## Phase 4: Reconcile — Disagreement Map

Input: All processed claims (normalized, council-reviewed, ranked)

The Reconciler agent produces structured output in 4 tiers:

1. **Consensus Claims** (3+ agents agree, council agreed, multiple source types)
   - Highest confidence. Present as established findings.

2. **Contested Claims** (council disagreed, or pairwise ranking was close)
   - Present BOTH sides with the specific disagreement.
   - Include which providers/agents took which position.

3. **Unique Insights** (found by 1 agent only, not contradicted)
   - High value OR hallucination — flag for user judgment.
   - Include the single source and the agent's confidence.

4. **Refuted Claims** (council rejected, or pairwise loser with low evidence)
   - Still present briefly — knowing what's wrong is valuable.
   - Include why it was rejected.

## Phase 5: Render

Produce both:
- Structured JSON artifact (see output-format.md)
- Rendered markdown for user display
```

- [ ] **Step 2: Write the reconciler agent prompt**

```markdown
## Agent: Reconciler

You are the Reconciler — the final judge in a multi-agent research pipeline.
You receive findings from 7 research agents that have been normalized,
deduplicated, and adversarially reviewed.

Your job is NOT to average or blend. Your job is to JUDGE:
- Which claims are strong? (multiple independent sources, council agreement)
- Which claims are contested? (present both sides, don't pick a winner)
- Which claims are unique insights? (valuable if true, flag for verification)
- Which claims should be rejected? (weak evidence, circular sourcing, council rejection)

Produce a structured disagreement map, not a smooth summary.
The user should see WHERE agents agreed, WHERE they disagreed, and WHY.

[Full prompt with input/output format]
```

- [ ] **Step 3: Commit**

```bash
git add ftm-researcher/references/synthesis-pipeline.md
git commit -m "feat(ftm-researcher): add 5-phase synthesis pipeline with reconciler"
```

---

### Task 4: Adaptive search — wave 1 to wave 2 refinement

**Files:**
- Create: `ftm-researcher/references/adaptive-search.md`

- [ ] **Step 1: Write the adaptive search protocol**

```markdown
# Adaptive Search Protocol

## When It Runs
Only in Deep mode. After wave 1 findings are normalized (Phase 1 of synthesis).

## How It Works

The orchestrator analyzes wave 1 findings across 4 dimensions:

### 1. Coverage Analysis
For each original subtopic:
- Well-covered (3+ findings with diverse sources): mark as SATURATED
- Partially covered (1-2 findings): mark as THIN
- No findings: mark as GAP

### 2. Contradiction Detection
- Identify claims where 2+ agents directly contradict each other
- Mark these subtopics as CONTESTED — wave 2 agents prioritize resolution

### 3. Depth Opportunities
- Identify findings that mention specific tools, libraries, or approaches worth deeper investigation
- Generate drill-down queries for wave 2

### 4. Surprise Detection
- Identify findings that don't fit any original subtopic — unexpected angles
- Generate new subtopics to explore these surprises

## Wave 2 Dispatch

Reassign agents based on analysis:
- SATURATED subtopics: agent reassigned to a GAP or CONTESTED area
- THIN subtopics: same agent, refined query with more specific terms
- GAP subtopics: agent gets broader query + alternative search terms
- CONTESTED subtopics: assign 2 agents (one per side) to find resolution evidence
- SURPRISE: assign the most relevant agent to explore the unexpected angle

All wave 2 agents receive:
- Full wave 1 findings summary (so they don't re-search)
- Their specific wave 2 mission (gap-fill, deepen, resolve, or explore)
- Explicit instruction: "Build on wave 1, do not repeat it"

## Merge Protocol
Wave 2 findings merge with wave 1 before entering the synthesis pipeline.
The normalize phase tracks which wave each finding came from.
```

- [ ] **Step 2: Commit**

```bash
git add ftm-researcher/references/adaptive-search.md
git commit -m "feat(ftm-researcher): add adaptive wave-based search protocol"
```

---

### Task 5: Credibility scoring scripts

**Files:**
- Create: `ftm-researcher/scripts/score_credibility.py`
- Create: `ftm-researcher/scripts/validate_research.py`

- [ ] **Step 1: Write the credibility scoring script**

`score_credibility.py` — takes a JSON array of findings, returns scored findings.

```python
#!/usr/bin/env python3
"""
Source credibility scoring for ftm-researcher findings.

Scoring dimensions:
- Source type weight (35%): primary > peer_reviewed > official_docs > news > blog > forum
- Recency (20%): decay based on age for fast-moving topics
- Expertise signals (25%): domain authority, author credentials
- Bias detection (20%): sensationalism penalties, balanced language bonuses

Additional flags:
- Corroboration bonus: +0.15 if independently found by 2+ agents from different source types
- Circular sourcing: flag if multiple sources cite the same original
"""
import json
import sys
import re
from datetime import datetime, timedelta
from urllib.parse import urlparse

# Source type base weights
SOURCE_WEIGHTS = {
    "primary": 1.0,
    "peer_reviewed": 0.9,
    "official_docs": 0.85,
    "code_repo": 0.8,
    "qa_site": 0.65,
    "news": 0.6,
    "blog": 0.4,
    "forum": 0.25,
    "codebase": 0.95,  # local codebase findings are high-trust
}

# High-authority domains
HIGH_AUTHORITY = {
    "arxiv.org", "nature.com", "science.org", "acm.org", "ieee.org",
    "github.com", "docs.python.org", "developer.mozilla.org",
    "platform.openai.com", "docs.anthropic.com", "cloud.google.com",
    "aws.amazon.com", "learn.microsoft.com",
}

MODERATE_AUTHORITY = {
    "stackoverflow.com", "stackexchange.com", "reddit.com",
    "news.ycombinator.com", "techcrunch.com", "arstechnica.com",
    "thenewstack.io", "infoq.com", "dev.to",
}

# Sensationalism indicators
SENSATIONAL_PATTERNS = [
    r"you won't believe", r"shocking", r"mind-blowing", r"game.?changer",
    r"revolutionary", r"incredible", r"amazing breakthrough",
]

# Balanced language indicators
BALANCED_PATTERNS = [
    r"however", r"on the other hand", r"trade-?off", r"limitation",
    r"caveat", r"although", r"despite", r"conversely",
]


def score_source_type(finding: dict) -> float:
    return SOURCE_WEIGHTS.get(finding.get("source_type", "blog"), 0.4)


def score_recency(finding: dict, fast_moving: bool = True) -> float:
    """Score based on source recency. Extracts year from URL or metadata if available."""
    url = finding.get("source_url", "")
    evidence = finding.get("evidence", "")
    current_year = datetime.now().year

    # Try to extract year from URL (common in blog/paper URLs)
    year_match = re.search(r'/(20[12]\d)/', url)
    if not year_match:
        # Try evidence text for year mentions
        year_match = re.search(r'\b(20[12]\d)\b', evidence)

    if year_match:
        source_year = int(year_match.group(1))
        age = current_year - source_year
        if fast_moving:
            # Aggressive decay for fast-moving topics (tech, AI, etc.)
            decay_map = {0: 1.0, 1: 0.85, 2: 0.65, 3: 0.45, 4: 0.30}
            return decay_map.get(age, 0.2)
        else:
            # Gentle decay for stable topics
            decay_map = {0: 1.0, 1: 0.95, 2: 0.85, 3: 0.75, 4: 0.65, 5: 0.55}
            return decay_map.get(age, 0.4)

    # No date info — return neutral
    return 0.7


def score_domain_authority(finding: dict) -> float:
    url = finding.get("source_url", "")
    if not url:
        if finding.get("source_type") == "codebase":
            return 0.95
        return 0.5

    try:
        domain = urlparse(url).netloc.lower()
        # Strip www.
        domain = domain.removeprefix("www.")
    except Exception:
        return 0.5

    if domain in HIGH_AUTHORITY:
        return 0.9
    if domain in MODERATE_AUTHORITY:
        return 0.7
    # Check for .edu, .gov
    if domain.endswith(".edu") or domain.endswith(".gov"):
        return 0.85
    return 0.55


def score_bias(finding: dict) -> float:
    text = finding.get("evidence", "") + " " + finding.get("claim", "")
    text_lower = text.lower()

    score = 0.7  # baseline

    # Penalize sensationalism
    for pattern in SENSATIONAL_PATTERNS:
        if re.search(pattern, text_lower):
            score -= 0.1

    # Bonus for balanced language
    for pattern in BALANCED_PATTERNS:
        if re.search(pattern, text_lower):
            score += 0.05

    return max(0.1, min(1.0, score))


def detect_circular_sourcing(findings: list) -> list:
    """Flag findings where multiple sources trace to the same original."""
    url_groups = {}
    for i, f in enumerate(findings):
        url = f.get("source_url", "")
        if url:
            domain = urlparse(url).netloc.lower().removeprefix("www.")
            claim_key = f.get("claim", "")[:50]
            key = f"{domain}:{claim_key}"
            url_groups.setdefault(key, []).append(i)

    circular_indices = set()
    for key, indices in url_groups.items():
        if len(indices) > 1:
            for idx in indices:
                circular_indices.add(idx)

    return list(circular_indices)


def score_findings(findings: list) -> list:
    circular = detect_circular_sourcing(findings)

    # Count agent agreement per claim (simplified: exact claim match)
    claim_agents = {}
    for f in findings:
        claim = f.get("claim", "")
        agent = f.get("agent_role", "unknown")
        source_type = f.get("source_type", "")
        claim_agents.setdefault(claim, {"agents": set(), "source_types": set()})
        claim_agents[claim]["agents"].add(agent)
        claim_agents[claim]["source_types"].add(source_type)

    scored = []
    for i, f in enumerate(findings):
        type_score = score_source_type(f)
        recency_score = score_recency(f)
        authority_score = score_domain_authority(f)
        bias_score = score_bias(f)

        # Weighted composite
        composite = (
            type_score * 0.35 +
            recency_score * 0.20 +
            authority_score * 0.25 +
            bias_score * 0.20
        )

        # Corroboration bonus
        claim = f.get("claim", "")
        if claim in claim_agents:
            info = claim_agents[claim]
            if len(info["agents"]) >= 2 and len(info["source_types"]) >= 2:
                composite += 0.15

        # Circular sourcing penalty
        is_circular = i in circular
        if is_circular:
            composite -= 0.2

        composite = max(0.0, min(1.0, composite))

        scored_finding = {
            **f,
            "credibility_score": round(composite, 3),
            "score_breakdown": {
                "source_type": round(type_score, 3),
                "recency": round(recency_score, 3),
                "domain_authority": round(authority_score, 3),
                "bias": round(bias_score, 3),
            },
            "circular_sourcing": is_circular,
            "corroborated": claim in claim_agents and len(claim_agents[claim]["agents"]) >= 2,
            "trust_level": (
                "high" if composite >= 0.75 else
                "moderate" if composite >= 0.55 else
                "low" if composite >= 0.35 else
                "verify"
            ),
        }
        scored.append(scored_finding)

    return sorted(scored, key=lambda x: x["credibility_score"], reverse=True)


def main():
    if len(sys.argv) < 2:
        print("Usage: score_credibility.py <findings.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        findings = json.load(f)

    scored = score_findings(findings)
    print(json.dumps(scored, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the research validation script**

`validate_research.py` — validates the structured output of a research session.

```python
#!/usr/bin/env python3
"""
Validates ftm-researcher output for completeness and quality.

Checks:
1. All required fields present in each finding
2. Source URLs are non-empty for non-codebase findings
3. Confidence scores in valid range
4. Disagreement map has all 4 tiers
5. No placeholder text (TBD, TODO, FIXME)
6. Minimum finding count per mode (quick: 3, standard: 10, deep: 15)
7. Source diversity: at least 3 different source types represented
8. No duplicate claims (exact match)
"""
import json
import sys

REQUIRED_FINDING_FIELDS = ["claim", "source_type", "confidence", "agent_role"]
REQUIRED_MAP_TIERS = ["consensus", "contested", "unique_insights", "refuted"]
PLACEHOLDER_PATTERNS = ["TBD", "TODO", "FIXME", "placeholder", "lorem ipsum"]
MIN_FINDINGS = {"quick": 3, "standard": 10, "deep": 15}


def validate(output: dict) -> list:
    errors = []
    warnings = []

    mode = output.get("mode", "standard")
    findings = output.get("findings", [])
    disagreement_map = output.get("disagreement_map", {})

    # Check minimum findings
    min_count = MIN_FINDINGS.get(mode, 10)
    if len(findings) < min_count:
        warnings.append(f"Only {len(findings)} findings for {mode} mode (expected >= {min_count})")

    # Check required fields
    for i, f in enumerate(findings):
        for field in REQUIRED_FINDING_FIELDS:
            if field not in f or not f[field]:
                errors.append(f"Finding {i}: missing required field '{field}'")

        # Source URL required for non-codebase
        if f.get("source_type") != "codebase" and not f.get("source_url"):
            warnings.append(f"Finding {i}: no source_url for {f.get('source_type')} source")

        # Confidence range
        conf = f.get("confidence", 0)
        if not (0.0 <= conf <= 1.0):
            errors.append(f"Finding {i}: confidence {conf} out of range [0, 1]")

        # Placeholder detection
        text = json.dumps(f).lower()
        for p in PLACEHOLDER_PATTERNS:
            if p.lower() in text:
                errors.append(f"Finding {i}: contains placeholder text '{p}'")

    # Source diversity
    source_types = set(f.get("source_type", "") for f in findings)
    if len(source_types) < 3:
        warnings.append(f"Only {len(source_types)} source types (expected >= 3)")

    # Duplicate detection
    claims = [f.get("claim", "") for f in findings]
    dupes = [c for c in claims if claims.count(c) > 1]
    if dupes:
        errors.append(f"Duplicate claims found: {set(dupes)}")

    # Disagreement map tiers
    if mode in ("standard", "deep"):
        for tier in REQUIRED_MAP_TIERS:
            if tier not in disagreement_map:
                errors.append(f"Disagreement map missing tier: {tier}")

    return {"errors": errors, "warnings": warnings, "valid": len(errors) == 0}


def main():
    if len(sys.argv) < 2:
        print("Usage: validate_research.py <output.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        output = json.load(f)

    result = validate(output)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run both scripts against sample data to verify they parse**

Create a minimal test fixture and run:
```bash
echo '[{"claim":"test","source_url":"https://arxiv.org/test","source_type":"peer_reviewed","confidence":0.8,"agent_role":"academic_scout","evidence":"test evidence"}]' > /tmp/test_findings.json
python3 ftm-researcher/scripts/score_credibility.py /tmp/test_findings.json
```
Expected: JSON output with credibility_score, score_breakdown, trust_level

```bash
echo '{"mode":"quick","findings":[{"claim":"test","source_type":"peer_reviewed","confidence":0.8,"agent_role":"academic_scout"}],"disagreement_map":{}}' > /tmp/test_output.json
python3 ftm-researcher/scripts/validate_research.py /tmp/test_output.json
```
Expected: `{"errors": [], "warnings": [...], "valid": true}`

- [ ] **Step 4: Commit**

```bash
git add ftm-researcher/scripts/score_credibility.py ftm-researcher/scripts/validate_research.py
git commit -m "feat(ftm-researcher): add credibility scoring and research validation scripts"
```

---

### Task 6: Output format — JSON schema + markdown template + iteration

**Files:**
- Create: `ftm-researcher/references/output-format.md`

- [ ] **Step 1: Write the output format specification**

```markdown
# Output Format Specification

## Structured JSON Artifact

This is the primary output for skill-to-skill consumption (ftm-brainstorm, ftm-executor, etc.).

Schema:
{
  "query": "original research question",
  "mode": "quick | standard | deep",
  "timestamp": "ISO-8601",
  "waves_completed": 1 | 2,
  "agents_dispatched": 3 | 7 | 14,
  "council_used": true | false,
  "duration_ms": 12345,

  "findings": [
    {
      "id": "f-001",
      "claim": "one-sentence factual claim",
      "evidence": "2-3 sentence supporting detail",
      "source_url": "https://...",
      "source_type": "primary | peer_reviewed | official_docs | code_repo | qa_site | news | blog | forum | codebase",
      "confidence": 0.85,
      "credibility_score": 0.78,
      "trust_level": "high | moderate | low | verify",
      "agent_role": "web_surveyor | academic_scout | ...",
      "wave": 1 | 2,
      "corroborated": true | false,
      "circular_sourcing": false
    }
  ],

  "disagreement_map": {
    "consensus": [
      {
        "claim": "...",
        "supporting_agents": ["web_surveyor", "github_miner", "academic_scout"],
        "source_count": 5,
        "source_diversity": 3,
        "council_verdict": "agreed",
        "confidence": 0.92
      }
    ],
    "contested": [
      {
        "claim_a": "...",
        "claim_b": "...",
        "agents_for_a": ["web_surveyor"],
        "agents_for_b": ["competitive_analyst"],
        "council_verdict": "contested",
        "provider_positions": {
          "claude": "a", "codex": "b", "gemini": "a"
        },
        "rank_winner": "a",
        "judge_rationale": "..."
      }
    ],
    "unique_insights": [
      {
        "claim": "...",
        "agent_role": "historical_investigator",
        "confidence": 0.6,
        "note": "Single source — may be high-value insight or hallucination"
      }
    ],
    "refuted": [
      {
        "claim": "...",
        "rejection_reason": "Council unanimously rejected — evidence traces to a single unreliable blog post",
        "original_agent": "web_surveyor"
      }
    ]
  },

  "metadata": {
    "sources_total": 34,
    "sources_high_trust": 12,
    "sources_moderate_trust": 15,
    "sources_low_trust": 7,
    "circular_sourcing_detected": 2,
    "agent_performance": {
      "web_surveyor": {"findings": 6, "avg_credibility": 0.65},
      "academic_scout": {"findings": 4, "avg_credibility": 0.88}
    }
  }
}

## Markdown Rendering Template

For user display:

# Research: [query]
**Mode:** [mode] | **Agents:** [count] | **Sources:** [total] | **Duration:** [time]

## Consensus Findings
[numbered list, each with claim + key source + confidence badge]

## Contested — Where Agents Disagreed
[for each contested claim: both positions, who took which side, evidence summary]

## Unique Insights — Unverified but Interesting
[flagged items from single agents, presented as "worth investigating"]

## Refuted — What We Ruled Out
[brief list of rejected claims and why]

## Source Summary
[table: source type | count | avg credibility]

## Conversational Iteration Protocol

After presenting results, the skill enters iteration mode:

User can:
- "dig deeper on #N" → spawn 3 targeted agents on finding N's topic
- "I think X is wrong because Y" → spawn counter-evidence agents + update findings
- "focus on [angle]" → reshape subtopics, re-dispatch with new weights
- "council #N" → route specific finding to ftm-council
- "more on [agent]'s findings" → re-dispatch that agent with broader query
- "compare A vs B" → spawn comparison agent with both findings as context
- "done" → finalize, write blackboard, emit events

Each iteration updates the JSON artifact and re-renders the markdown.
```

- [ ] **Step 2: Commit**

```bash
git add ftm-researcher/references/output-format.md
git commit -m "feat(ftm-researcher): add output format spec with JSON schema and markdown template"
```

---

### Task 7: Council integration + fallback challengers

**Files:**
- Create: `ftm-researcher/references/council-integration.md`

- [ ] **Step 1: Write the council integration protocol**

```markdown
# ftm-council Integration

## When Council Is Invoked
- Deep mode only (standard and quick skip council)
- After normalize & dedup (Phase 1 of synthesis)
- Input: all claims with agent_count >= 2, plus high-confidence unique claims (confidence > 0.8)

## Interface Contract

ftm-researcher prepares a structured prompt for ftm-council:

"Evaluate these research findings for accuracy, completeness, and potential bias.
For each claim below, independently assess:
1. Is the evidence sufficient to support this claim?
2. What would make this claim wrong?
3. Are there alternative explanations the research may have missed?
4. Rate your confidence in this claim (0-1).

[claims formatted as numbered list with evidence and sources]

Return your assessment for each claim with: verdict (supported/contested/insufficient),
confidence, and reasoning."

## How Council Results Map Back

| Council Verdict | Mapping |
|---|---|
| All 3 providers: "supported" | → consensus tier |
| 2 agree, 1 contests | → consensus tier with minority note |
| 2 contest, 1 supports | → contested tier |
| All 3 contest | → refuted tier |
| Mixed with "insufficient" | → unique_insights tier (needs more evidence) |

## Fallback: Standalone Challengers

When ftm-council is unavailable (Codex CLI or Gemini CLI not installed):

Spawn 2 agents on the `review` model from ftm-config:

### Devil's Advocate Agent
"Your sole purpose is to find reasons each claim is WRONG.
For each claim: search for counter-evidence, identify logical gaps,
flag claims supported by only one source type, check if the evidence
actually supports the claim or if the claim overstates the evidence.
Be adversarial. The goal is to stress-test, not to confirm."

### Edge Case Hunter Agent
"Your sole purpose is to find where each claim BREAKS.
For each claim: what happens at scale? Under load? With adversarial input?
What about accessibility? What about the 1% case? What about 5 years from now?
What happens when the assumption underlying this claim changes?"

Both return: challenge_findings[] with {claim_challenged, challenge_type, counter_evidence, severity}

Map to tiers:
- No challenges → consensus
- Challenges with weak counter-evidence → consensus with note
- Challenges with strong counter-evidence → contested
- Multiple strong challenges → refuted
```

- [ ] **Step 2: Commit**

```bash
git add ftm-researcher/references/council-integration.md
git commit -m "feat(ftm-researcher): add council integration and fallback challenger protocols"
```

---

### Task 8: ftm-brainstorm integration

**Files:**
- Modify: `ftm-brainstorm/SKILL.md` — replace 3-agent research sprint with ftm-researcher call, add `research_complete` listener
- Modify: `ftm-brainstorm/references/agent-prompts.md` — mark as legacy, point to ftm-researcher

- [ ] **Step 1: Read current ftm-brainstorm/SKILL.md in full**

Read the entire file to understand all references to the 3-agent research sprint pattern.

- [ ] **Step 2: Add `research_complete` to ftm-brainstorm's Listens To section**

In the `## Events` → `### Listens To` section of ftm-brainstorm/SKILL.md, add:

```markdown
- `research_complete` — consume structured findings from ftm-researcher for the current research sprint
  - Expected payload: `{ query, mode, findings_count, consensus_count, contested_count, unique_count, sources_count, council_used, duration_ms }`
```

- [ ] **Step 3: Modify the core loop in SKILL.md**

Replace the research sprint dispatch (currently "3 agents search in parallel from different vectors") with:

```markdown
EVERY TURN (after initial intake):
  1. RESEARCH SPRINT  — invoke ftm-researcher with context
  2. SYNTHESIZE       — merge researcher findings into suggestions with evidence
  3. CHALLENGE        — push back on weak assumptions, surface trade-offs
  4. ASK              — 1-2 targeted questions to extract more from the user
  5. >>> STOP <<<     — wait for the user. Do NOT continue.
```

Add a new section after "Config Read":

```markdown
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
```

- [ ] **Step 4: Update ftm-brainstorm/references/agent-prompts.md**

Add a header noting this file is now the legacy format:

```markdown
# Agent Prompts (Legacy)

> **NOTE:** As of ftm-researcher integration, brainstorm research sprints are handled
> by ftm-researcher. These prompts are retained for reference and fallback if
> ftm-researcher is unavailable.

[existing content unchanged]
```

- [ ] **Step 5: Commit**

```bash
git add ftm-brainstorm/SKILL.md ftm-brainstorm/references/agent-prompts.md
git commit -m "feat(ftm-brainstorm): integrate ftm-researcher for research sprints"
```

---

### Task 9: Config updates

**Files:**
- Modify: `ftm-config.default.yml`

> **NOTE:** `ftm-config.yml` in the repo root is the YAML trigger file for the ftm-config *skill*, NOT a copy of the default config. Do NOT modify it. The user's runtime config lives at `~/.claude/ftm-config.yml` and is user-owned — do not modify it in this plan.

- [ ] **Step 1: Read ftm-config.default.yml in full**

- [ ] **Step 2: Update ftm-config.default.yml**

Add per-skill overrides and ftm-researcher to skills list. Keep `max_parallel_agents: 5` as the global default (safe for all rate limit tiers). Skills that need more agents read their `per_skill_overrides` value and fall back to the global.

```yaml
execution:
  max_parallel_agents: 5            # global default — safe for all rate limit tiers
  per_skill_overrides:              # NEW — skills read their own override, fall back to global
    ftm-researcher: 10
    ftm-executor: 8
    ftm-debug: 6
    ftm-brainstorm: 3              # fallback if researcher unavailable
  auto_audit: true
  progress_tracking: true
  approval_mode: plan_first
  tdd_mode: false

# ... (keep existing review section unchanged)

skills:
  ftm-brainstorm: { enabled: true }
  ftm-executor: { enabled: true }
  ftm-debug: { enabled: true }
  ftm-audit: { enabled: true }
  ftm-council: { enabled: true }
  ftm-codex-gate: { enabled: true }
  ftm-intent: { enabled: true }
  ftm-diagram: { enabled: true }
  ftm-browse: { enabled: true }
  ftm-pause: { enabled: true }
  ftm-resume: { enabled: true }
  ftm-upgrade: { enabled: true }
  ftm-retro: { enabled: true }
  ftm-config: { enabled: true }
  ftm-git: { enabled: true }
  ftm-mind: { enabled: true }
  ftm-researcher: { enabled: true }   # NEW
```

> **Implementation note:** ftm-researcher's SKILL.md Config Read section must read `execution.per_skill_overrides.ftm-researcher` and fall back to `execution.max_parallel_agents` if the override is absent.

- [ ] **Step 3: Commit**

```bash
git add ftm-config.default.yml
git commit -m "feat(ftm-config): add ftm-researcher, add per-skill agent overrides"
```

---

### Task 10: Event registry + manifest

**Files:**
- Modify: `ftm-mind/references/event-registry.md`
- Run: `node bin/generate-manifest.mjs` to regenerate `ftm-manifest.json`

- [ ] **Step 1: Read event-registry.md in full**

- [ ] **Step 2: Add research_complete event**

Insert after the `plan_generated` event entry:

```markdown
### research_complete
- **Description**: ftm-researcher finished its synthesis pipeline and structured output is ready for consumption
- **Emitted by**: ftm-researcher
- **Listened to by**: ftm-brainstorm (consume findings for current research sprint), ftm-mind (log research session on blackboard, optionally surface to user)
- **Fast-path**: no
- **Payload**: `{ query, mode, findings_count, consensus_count, contested_count, unique_count, sources_count, council_used, duration_ms }`
```

- [ ] **Step 3: Update event routing table**

Add to the routing reference table:

```markdown
| research_complete | researcher | brainstorm, mind |
```

- [ ] **Step 4: Update task_completed emitters list**

Add `ftm-researcher` to the `task_completed` event's "Emitted by" list. The current line reads:
```
- **Emitted by**: ftm-executor, ftm-debug, ftm-audit, ftm-retro, ftm-brainstorm, ftm-council, ftm-codex-gate, ftm-intent, ftm-diagram, ftm-browse, ftm-pause, ftm-resume, ftm-upgrade, ftm-config
```
Replace with:
```
- **Emitted by**: ftm-executor, ftm-debug, ftm-audit, ftm-retro, ftm-brainstorm, ftm-council, ftm-codex-gate, ftm-intent, ftm-diagram, ftm-browse, ftm-pause, ftm-resume, ftm-upgrade, ftm-config, ftm-researcher
```

- [ ] **Step 5: Regenerate manifest**

```bash
node bin/generate-manifest.mjs
```

Verify ftm-researcher appears in the manifest with correct events, blackboard paths, and references.

- [ ] **Step 6: Commit**

```bash
git add ftm-mind/references/event-registry.md ftm-manifest.json
git commit -m "feat(ftm-researcher): add research_complete event and update manifest"
```

---

### Task 11: ftm-mind routing integration

**Files:**
- Modify: `ftm-mind/SKILL.md`
- Modify: `ftm-mind/references/routing-scenarios.md`
- Modify: `ftm-mind/references/complexity-guide.md`

- [ ] **Step 1: Read ftm-mind/SKILL.md — specifically the Decide phase routing logic**

Read the full Decide section to find where skill routing decisions are made.

- [ ] **Step 2: Add ftm-researcher to the Capability Inventory table**

Find the "Capability Inventory: 15 Panda Skills" table in ftm-mind/SKILL.md (around line 247). Update the heading from "15 Panda Skills" to "16 Panda Skills" and add this row:

```markdown
| `ftm-researcher` | The user wants thorough research on a topic, comparison of approaches, state-of-the-art analysis, or evidence-based investigation. Not for ideation (that is ftm-brainstorm). |
```

- [ ] **Step 3: Add ftm-researcher to the Decide phase**

In the routing logic, add research as a recognized route:

```markdown
### Research tasks → ftm-researcher

Route to ftm-researcher when the request is primarily about gathering information,
comparing approaches, or understanding the state of the art on a topic.

Signals:
- "research X", "find out about Y", "what's the state of the art on Z"
- "compare approaches to W", "how do others handle X"
- "deep dive into X", "investigate Y", "look into Z"
- "find me examples of X", "what's out there for Y"
- The user wants facts and evidence, not ideation or planning

Distinguish from ftm-brainstorm:
- Brainstorm: user has an idea and wants to develop it → exploratory, iterative, extractive
- Researcher: user wants information about a topic → factual, evidence-based, comprehensive
- Ambiguous: if the user seems to want both exploration AND research, route to brainstorm (which calls researcher internally)

Mode selection:
- "quick look" / "briefly" → quick mode
- Default → standard mode
- "deep dive" / "thorough" / "comprehensive" → deep mode
```

- [ ] **Step 4: Update routing-scenarios.md**

Add these scenarios to the routing table:

```markdown
| `research parallel agent architectures` | research task, factual inquiry, broad scope | route to `ftm-researcher` (deep) |
| `what's the best way to handle auth in Next.js` | research task, specific technical question | route to `ftm-researcher` (standard) |
| `quick look at how Stripe handles webhooks` | research task, explicit "quick" signal | route to `ftm-researcher` (quick) |
| `compare Redis vs Memcached for our session store` | research task, comparative, codebase-relevant | route to `ftm-researcher` (deep, codebase-aware) |
| `find me examples of rate limiting middleware` | research task, looking for implementations | route to `ftm-researcher` (standard) |
| `I want to build a dashboard` | ideation, not research | route to `ftm-brainstorm` (calls researcher internally) |
| `/ftm-researcher auth patterns in microservices` | explicit skill choice | respect explicit route to `ftm-researcher` |
```

- [ ] **Step 5: Update complexity-guide.md**

Add a note under the sizing guide about research tasks:

```markdown
## Research Tasks

Research tasks don't follow the micro/small/medium/large sizing — they route directly
to ftm-researcher regardless of complexity. The researcher's mode system (quick/standard/deep)
handles the depth calibration internally.

If a research request also implies implementation ("research X and then build it"),
orient as a multi-phase workflow: research first (ftm-researcher), then plan (ftm-brainstorm
or direct), then execute (ftm-executor).
```

- [ ] **Step 6: Commit**

```bash
git add ftm-mind/SKILL.md ftm-mind/references/routing-scenarios.md ftm-mind/references/complexity-guide.md
git commit -m "feat(ftm-mind): add ftm-researcher routing, capability inventory, scenarios, and complexity guide"
```

---

### Task 12: Tests + evals

**Files:**
- Create: `ftm-researcher/evals/trigger-accuracy.yaml`
- Create: `ftm-researcher/evals/agent-diversity.yaml`
- Create: `ftm-researcher/evals/synthesis-quality.yaml`
- Create: `tests/ftm-researcher.test.mjs`
- Modify: `tests/run-all.sh` — add ftm-researcher test suite

- [ ] **Step 1: Write trigger accuracy eval**

```yaml
# ftm-researcher/evals/trigger-accuracy.yaml
description: Verify ftm-researcher triggers on research requests and not on brainstorm/debug/other
prompts:
  - vars:
      input: "research parallel agent architectures"
    assert:
      - type: contains
        value: "ftm-researcher"
  - vars:
      input: "what's the state of the art on LLM fine-tuning"
    assert:
      - type: contains
        value: "ftm-researcher"
  - vars:
      input: "find me examples of rate limiting in Go"
    assert:
      - type: contains
        value: "ftm-researcher"
  - vars:
      input: "compare Redis vs Memcached"
    assert:
      - type: contains
        value: "ftm-researcher"
  # Should NOT trigger
  - vars:
      input: "I have an idea for a dashboard"
    assert:
      - type: not-contains
        value: "ftm-researcher"
  - vars:
      input: "debug this flaky test"
    assert:
      - type: not-contains
        value: "ftm-researcher"
  - vars:
      input: "help me brainstorm auth design"
    assert:
      - type: not-contains
        value: "ftm-researcher"
```

- [ ] **Step 2: Write agent diversity eval**

```yaml
# ftm-researcher/evals/agent-diversity.yaml
description: Verify 7 finder agents produce non-overlapping results from different domains
prompts:
  - vars:
      input: "Research how to implement WebSocket connections in a Node.js application"
    assert:
      - type: contains
        value: "web_surveyor"
      - type: contains
        value: "github_miner"
      - type: contains
        value: "codebase_analyst"
      - type: javascript
        value: |
          // Verify at least 5 different agent_roles appear in findings
          const roles = new Set(output.findings?.map(f => f.agent_role) || []);
          return roles.size >= 5;
```

- [ ] **Step 3: Write synthesis quality eval**

```yaml
# ftm-researcher/evals/synthesis-quality.yaml
description: Verify synthesis pipeline produces valid disagreement maps
prompts:
  - vars:
      input: "Given these 10 findings from different agents, produce a disagreement map"
    assert:
      - type: contains
        value: "consensus"
      - type: contains
        value: "contested"
      - type: contains
        value: "unique_insights"
```

- [ ] **Step 4: Write manifest integration test**

```javascript
// tests/ftm-researcher.test.mjs
import { readFileSync } from 'fs';
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('ftm-researcher manifest integration', () => {
  const manifest = JSON.parse(readFileSync('ftm-manifest.json', 'utf8'));
  const skill = manifest.skills.find(s => s.name === 'ftm-researcher');

  test('skill exists in manifest', () => {
    assert.ok(skill, 'ftm-researcher not found in manifest');
  });

  test('emits research_complete event', () => {
    assert.ok(
      skill.events_emits.includes('research_complete'),
      'missing research_complete event'
    );
  });

  test('emits task_completed event', () => {
    assert.ok(
      skill.events_emits.includes('task_completed'),
      'missing task_completed event'
    );
  });

  test('listens to task_received', () => {
    assert.ok(
      skill.events_listens.includes('task_received'),
      'missing task_received listener'
    );
  });

  test('has required references', () => {
    const requiredRefs = [
      'agent-prompts.md',
      'synthesis-pipeline.md',
      'adaptive-search.md',
      'output-format.md',
      'council-integration.md'
    ];
    for (const ref of requiredRefs) {
      assert.ok(
        skill.references.some(r => r.includes(ref)),
        `missing reference: ${ref}`
      );
    }
  });

  test('skill is enabled in config', () => {
    assert.strictEqual(skill.enabled, true);
  });
});

describe('credibility scoring script', () => {
  test('scores a valid finding', async () => {
    const { execSync } = await import('child_process');
    const input = JSON.stringify([{
      claim: "Test claim",
      source_url: "https://arxiv.org/test",
      source_type: "peer_reviewed",
      confidence: 0.8,
      agent_role: "academic_scout",
      evidence: "Test evidence with however some caveats"
    }]);

    const tmpFile = '/tmp/test_scoring_input.json';
    const { writeFileSync } = await import('fs');
    writeFileSync(tmpFile, input);

    const result = execSync(`python3 ftm-researcher/scripts/score_credibility.py ${tmpFile}`);
    const scored = JSON.parse(result.toString());

    assert.strictEqual(scored.length, 1);
    assert.ok(scored[0].credibility_score > 0.7, 'peer_reviewed arxiv should score high');
    assert.strictEqual(scored[0].trust_level, 'high');
    assert.ok(scored[0].score_breakdown);
  });
});

describe('research validation script', () => {
  test('validates a minimal valid output', async () => {
    const { execSync } = await import('child_process');
    const { writeFileSync } = await import('fs');

    const output = {
      mode: "quick",
      findings: [
        { claim: "A", source_type: "blog", confidence: 0.5, agent_role: "web_surveyor", source_url: "https://example.com" },
        { claim: "B", source_type: "code_repo", confidence: 0.7, agent_role: "github_miner", source_url: "https://github.com/test" },
        { claim: "C", source_type: "peer_reviewed", confidence: 0.9, agent_role: "academic_scout", source_url: "https://arxiv.org/test" }
      ],
      disagreement_map: {}
    };

    const tmpFile = '/tmp/test_validation_input.json';
    writeFileSync(tmpFile, JSON.stringify(output));

    const result = execSync(`python3 ftm-researcher/scripts/validate_research.py ${tmpFile}`);
    const validation = JSON.parse(result.toString());

    assert.strictEqual(validation.valid, true);
  });

  test('rejects findings with missing fields', async () => {
    const { execSync } = await import('child_process');
    const { writeFileSync } = await import('fs');

    const output = {
      mode: "quick",
      findings: [
        { claim: "A" }  // missing required fields
      ],
      disagreement_map: {}
    };

    const tmpFile = '/tmp/test_validation_bad.json';
    writeFileSync(tmpFile, JSON.stringify(output));

    try {
      execSync(`python3 ftm-researcher/scripts/validate_research.py ${tmpFile}`);
      assert.fail('Should have exited with error');
    } catch (e) {
      const validation = JSON.parse(e.stdout.toString());
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.length > 0);
    }
  });
});
```

- [ ] **Step 5: Add test to run-all.sh**

Read `tests/run-all.sh` and add a new suite entry for ftm-researcher:
```bash
echo "--- ftm-researcher tests ---"
node --test tests/ftm-researcher.test.mjs
```

- [ ] **Step 6: Run tests**

```bash
node --test tests/ftm-researcher.test.mjs
```
Expected: All tests pass (after manifest is regenerated in Task 10)

- [ ] **Step 7: Commit**

```bash
git add ftm-researcher/evals/ tests/ftm-researcher.test.mjs tests/run-all.sh
git commit -m "test(ftm-researcher): add trigger evals, diversity evals, synthesis evals, and integration tests"
```

---

## Agent Team

| Agent | Role | Tasks |
|---|---|---|
| file-creator | Skill scaffold, reference docs, scripts | 1, 2, 3, 4, 5, 6, 7 |
| backend-architect | Integration logic, brainstorm wiring, config, events, mind routing | 8, 9, 10, 11 |
| test-writer-fixer | Evals and tests | 12 |

## Execution Order

- **Wave 1 (parallel):** Tasks 1, 2, 3, 4, 5, 6, 7 — all independent file creation (skill scaffold + all reference docs + scripts)
- **Wave 2 (parallel, after wave 1):** Tasks 8, 9, 10, 11 — integration (brainstorm, config, events, mind routing)
- **Wave 3:** Task 12 — tests validate everything
