# Adaptive Search Protocol

Wave 1 → Wave 2 refinement for Deep mode research.

---

## When It Runs

Only in Deep mode. After wave 1 findings are normalized (Phase 1 of synthesis).

---

## How It Works

The orchestrator analyzes wave 1 findings across 4 dimensions:

### 1. Coverage Analysis

For each original subtopic:
- **SATURATED** (3+ findings with diverse sources): Well-covered. Agent can be reassigned.
- **THIN** (1-2 findings): Partially covered. Same agent gets a refined query.
- **GAP** (0 findings): Not covered. Agent gets a broader query + alternative search terms.

### 2. Contradiction Detection

- Identify claims where 2+ agents directly contradict each other
- Mark these subtopics as CONTESTED — wave 2 agents prioritize resolution
- For each contradiction, note: which agents, which claims, what the disagreement is

### 3. Depth Opportunities

- Identify findings that mention specific tools, libraries, or approaches worth deeper investigation
- Generate drill-down queries for wave 2
- Prioritize depth opportunities that the user's response highlighted as important

### 4. Surprise Detection

- Identify findings that don't fit any original subtopic — unexpected angles
- Generate new subtopics to explore these surprises
- Surprises are high-value: they represent information the user didn't know to ask about

---

## Wave 2 Dispatch

Reassign agents based on analysis:

| Coverage Status | Action |
|---|---|
| SATURATED | Reassign agent to a GAP or CONTESTED area |
| THIN | Same agent, refined query with more specific terms |
| GAP | Agent gets broader query + alternative search terms |
| CONTESTED | Assign 2 agents (one per side) to find resolution evidence |
| SURPRISE | Assign the most relevant agent to explore the unexpected angle |

### Agent Reassignment Rules

1. Prefer reassigning agents whose original domain is closest to the gap
2. If a GAP exists in the academic domain, reassign Academic Scout even if it was SATURATED
3. Codebase Analyst is never reassigned — it always re-searches with refined local queries
4. If all subtopics are SATURATED, focus wave 2 on depth opportunities and surprises

### Context Injection for Wave 2

All wave 2 agents receive:
- Full wave 1 findings summary (so they don't re-search)
- Their specific wave 2 mission (gap-fill, deepen, resolve, or explore)
- Explicit instruction: "Build on wave 1, do not repeat it"
- The contradiction details if they're resolving a CONTESTED subtopic

---

## Merge Protocol

Wave 2 findings merge with wave 1 before entering the synthesis pipeline:

1. Wave 2 findings are added to the findings pool with `wave: 2` marker
2. The normalize phase (Phase 1) runs again across ALL findings (wave 1 + wave 2)
3. Deduplication groups wave 1 and wave 2 findings together — if wave 2 confirms a wave 1 finding, the agent_count increases
4. New wave 2 findings that weren't in wave 1 are added as new unique claims
5. The wave marker is preserved through synthesis for traceability

### Contradiction Resolution

When wave 2 agents were dispatched to resolve a CONTESTED subtopic:
- If wave 2 finds evidence strongly supporting one side, the contest is resolved
- If wave 2 finds evidence supporting both sides, the contest remains but with richer context
- The pairwise ranking (Phase 3) benefits from the additional evidence

---

## Orchestrator Analysis Template

After wave 1 normalization, the orchestrator produces this analysis:

```
COVERAGE ANALYSIS:
1. [subtopic]: SATURATED | THIN | GAP — [N findings, M source types]
2. [subtopic]: SATURATED | THIN | GAP — [N findings, M source types]
...

CONTRADICTIONS DETECTED:
- [Agent A] claims [X] vs [Agent B] claims [Y] — on subtopic [Z]

DEPTH OPPORTUNITIES:
- Finding [N] mentions [specific tool/approach] worth investigating
- Finding [M] suggests [unexpected constraint] that needs validation

SURPRISES:
- [Agent] found [unexpected finding] not covered by any original subtopic

WAVE 2 PLAN:
- [Agent]: [mission] — [refined query]
- [Agent]: [mission] — [refined query]
...
```
