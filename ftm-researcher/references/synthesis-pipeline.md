# Synthesis Pipeline

5-phase pipeline that takes raw findings from finder agents and produces a structured disagreement map.

---

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

### Semantic Similarity Heuristics

Two claims are considered semantically similar when:
- They make the same factual assertion about the same subject, even with different wording
- One is a subset of the other (e.g., "X uses Y" vs "X uses Y for Z")
- They cite the same source for the same conclusion

Two claims are NOT similar when:
- They address different aspects of the same topic
- They reach different conclusions about the same subject
- One is general and the other is specific with additional qualifying conditions

When merging, keep the most specific version as the canonical claim.

---

## Phase 2: Adversarial Review (ftm-council)

Input: Top claims from Phase 1 (all claims with agent_count >= 2, plus any high-confidence unique claims with confidence > 0.8)

Council invocation:
- Send claims as a structured prompt to ftm-council
- Ask: "Evaluate each claim. For each: Is the evidence sufficient? What would make this wrong? Are there alternative explanations? Rate confidence 0-1."
- Council runs Claude + Codex + Gemini independently, then reconciles

Output: claims[] with council_verdict (agreed | contested | insufficient_evidence), provider_disagreements[]

### FALLBACK (if Codex/Gemini unavailable):

Spawn 2 standalone agents on the review model:

**Devil's Advocate:** "Your job is to find reasons each claim is WRONG. Search for counter-evidence, flag single-source claims, identify logical gaps."

**Edge Case Hunter:** "Your job is to find where each claim BREAKS. Scaling limits, security concerns, accessibility gaps, failure modes under load."

Both receive all claims and return challenge_findings[]

---

## Phase 3: Pairwise Rank (for contested claims)

Input: Claims marked as "contested" by council

For each pair of conflicting claims:
- LLM-as-judge prompt: "Given research question Q, Claim A says [X] with evidence [E1]. Claim B says [Y] with evidence [E2]. Which claim is better supported? Why? Consider: source authority, evidence specificity, logical coherence, relevance to the question."
- Tournament bracket: winners advance, losers are demoted to "minority view"

Output: ranked_claims[] with rank_position, judge_rationale

### Ranking Criteria (in priority order)

1. **Source authority**: Primary sources and peer-reviewed research outweigh blog posts and forum answers
2. **Evidence specificity**: Concrete data points (benchmarks, case studies with numbers) outweigh general assertions
3. **Logical coherence**: Claims with clear causal reasoning outweigh correlational arguments
4. **Relevance to question**: Claims that directly address the research question outweigh tangentially related findings
5. **Recency**: For fast-moving topics, newer evidence outweighs older evidence (all else equal)

---

## Phase 4: Reconcile — Disagreement Map

Input: All processed claims (normalized, council-reviewed, ranked)

The Reconciler agent produces structured output in 4 tiers:

### Tier 1: Consensus Claims
3+ agents agree, council agreed, multiple source types.
- Highest confidence. Present as established findings.
- Include: canonical claim, supporting agents, source count, source diversity, council verdict, confidence score

### Tier 2: Contested Claims
Council disagreed, or pairwise ranking was close.
- Present BOTH sides with the specific disagreement.
- Include: claim_a, claim_b, agents_for_a, agents_for_b, council positions, rank winner, judge rationale

### Tier 3: Unique Insights
Found by 1 agent only, not contradicted.
- High value OR hallucination — flag for user judgment.
- Include: claim, agent_role, confidence, source, note flagging single-source status

### Tier 4: Refuted Claims
Council rejected, or pairwise loser with low evidence.
- Still present briefly — knowing what's wrong is valuable.
- Include: claim, rejection_reason, original_agent

---

## Phase 5: Render

Produce both:
- **Structured JSON artifact** (see output-format.md for schema)
- **Rendered markdown** for user display (see output-format.md for template)

The JSON artifact is the primary output for skill-to-skill consumption. The markdown is for human reading.

---

## Reconciler Agent Prompt

```
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

INPUT:
- normalized_claims: [list of deduplicated claims with agent_count and source_diversity]
- council_verdicts: [list of claims with agreed/contested/insufficient verdicts]
- pairwise_rankings: [list of contested claim pairs with winners and rationale]
- credibility_scores: [list of claims with scored credibility from score_credibility.py]

OUTPUT FORMAT:
Return a JSON object with these exact keys:
{
  "consensus": [{ claim, supporting_agents, source_count, source_diversity, council_verdict, confidence }],
  "contested": [{ claim_a, claim_b, agents_for_a, agents_for_b, council_verdict, provider_positions, rank_winner, judge_rationale }],
  "unique_insights": [{ claim, agent_role, confidence, note }],
  "refuted": [{ claim, rejection_reason, original_agent }]
}

RULES:
- A claim needs 3+ agents AND council agreement to be consensus
- A claim with 2 agents but council agreement goes to consensus with a "moderate confidence" flag
- A claim with council disagreement ALWAYS goes to contested, even if 5 agents agree
- A single-agent claim with confidence > 0.8 goes to unique_insights
- A single-agent claim with confidence <= 0.5 goes to refuted
- Everything else goes to unique_insights with appropriate flagging
- NEVER merge contested claims into a smooth middle ground — preserve the disagreement
```

---

## Pipeline Skip Rules

- **Quick mode**: Skip Phases 2, 3, 4. Orchestrator does a single-pass synthesis directly from normalized findings.
- **Standard mode**: Skip Phase 2 (council). Run Phases 1, 3, 4, 5.
- **Deep mode**: Run all 5 phases.
