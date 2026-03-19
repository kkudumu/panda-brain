# ftm-council Integration

## When Council Is Invoked

- Deep mode only (standard and quick skip council)
- After normalize & dedup (Phase 1 of synthesis)
- Input: all claims with agent_count >= 2, plus high-confidence unique claims (confidence > 0.8)

---

## Interface Contract

ftm-researcher prepares a structured prompt for ftm-council:

```
Evaluate these research findings for accuracy, completeness, and potential bias.
For each claim below, independently assess:
1. Is the evidence sufficient to support this claim?
2. What would make this claim wrong?
3. Are there alternative explanations the research may have missed?
4. Rate your confidence in this claim (0-1).

[claims formatted as numbered list with evidence and sources]

Return your assessment for each claim with: verdict (supported/contested/insufficient),
confidence, and reasoning.
```

### Payload Format

```json
{
  "context": "Research evaluation for: [query]",
  "claims": [
    {
      "id": "f-001",
      "claim": "...",
      "evidence": "...",
      "sources": ["url1", "url2"],
      "source_types": ["peer_reviewed", "blog"],
      "agent_count": 3,
      "credibility_score": 0.78
    }
  ],
  "evaluation_criteria": "accuracy, completeness, potential bias"
}
```

### Expected Response Format

```json
{
  "evaluations": [
    {
      "claim_id": "f-001",
      "verdict": "supported | contested | insufficient",
      "confidence": 0.85,
      "reasoning": "...",
      "what_would_make_this_wrong": "...",
      "alternative_explanations": ["..."]
    }
  ],
  "provider_positions": {
    "claude": { "f-001": "supported", ... },
    "codex": { "f-001": "contested", ... },
    "gemini": { "f-001": "supported", ... }
  }
}
```

---

## How Council Results Map Back

| Council Verdict | Mapping |
|---|---|
| All 3 providers: "supported" | consensus tier |
| 2 agree "supported", 1 contests | consensus tier with minority note |
| 2 contest, 1 supports | contested tier |
| All 3 contest | refuted tier |
| Mixed with "insufficient" | unique_insights tier (needs more evidence) |
| 2 "insufficient", 1 "supported" | unique_insights tier |
| 2 "insufficient", 1 "contested" | refuted tier (not enough evidence to contest = rejection) |

### Tie-Breaking Rules

When the mapping is ambiguous:
1. Prefer the more conservative tier (contested over consensus, refuted over unique_insights)
2. If all three providers give different verdicts, place in contested with full position details
3. If confidence scores diverge significantly (spread > 0.3), flag as high-uncertainty

---

## Fallback: Standalone Challengers

When ftm-council is unavailable (Codex CLI or Gemini CLI not installed):

Spawn 2 agents on the `review` model from ftm-config:

### Devil's Advocate Agent

```
You are the Devil's Advocate in a research pipeline.

Your sole purpose is to find reasons each claim is WRONG.

For each claim below:
1. Search for counter-evidence using WebSearch
2. Identify logical gaps in the reasoning
3. Flag claims supported by only one source type
4. Check if the evidence actually supports the claim or if the claim overstates the evidence
5. Look for cherry-picked data or survivorship bias

Be adversarial. The goal is to stress-test, not to confirm.

CLAIMS TO CHALLENGE:
[formatted list of claims with evidence]

RETURN FORMAT:
For each claim challenged, return:
- claim_challenged: [the claim text]
- challenge_type: counter_evidence | logical_gap | single_source | overstated | bias
- counter_evidence: [what you found that contradicts or weakens the claim]
- severity: high | medium | low
- recommendation: reject | weaken | flag_for_review | accept_with_caveat
```

### Edge Case Hunter Agent

```
You are the Edge Case Hunter in a research pipeline.

Your sole purpose is to find where each claim BREAKS.

For each claim below:
1. What happens at scale? (10x, 100x, 1000x users/data/requests)
2. What happens under adversarial conditions? (malicious input, DDoS, data poisoning)
3. What about accessibility? (screen readers, keyboard-only, low bandwidth)
4. What about the 1% case? (rare but catastrophic failure modes)
5. What about 5 years from now? (technology shifts, dependency deprecation, scaling limits)
6. What happens when the key assumption changes? (the market shifts, the API breaks, the team grows)

CLAIMS TO STRESS-TEST:
[formatted list of claims with evidence]

RETURN FORMAT:
For each claim stressed, return:
- claim_challenged: [the claim text]
- challenge_type: scale | adversarial | accessibility | edge_case | longevity | assumption_shift
- failure_scenario: [specific scenario where this claim breaks]
- severity: high | medium | low
- recommendation: reject | weaken | flag_for_review | accept_with_caveat
```

### Fallback Mapping

Map challenger results to tiers:

| Challenger Result | Mapping |
|---|---|
| No challenges from either agent | consensus |
| Challenges with weak counter-evidence (low severity) | consensus with note |
| One agent challenges with medium severity | contested |
| Both agents challenge with medium+ severity | contested (strong) |
| Multiple high-severity challenges | refuted |
| Only edge case challenges, no factual counter-evidence | consensus with edge-case notes |

---

## Council Availability Detection

Before invoking ftm-council, check availability:

1. Check if `codex` CLI is installed: `which codex`
2. Check if `gemini` CLI is installed: `which gemini`
3. If both are available: use full council
4. If only one is available: use 2-provider council (reduced confidence in verdicts)
5. If neither is available: use fallback challenger agents

Log the availability status in the research metadata.

---

## Per-Claim Council Invocation

The conversational iteration protocol supports council invocation for individual claims:

When the user says "council #N":
1. Extract finding N from the current research state
2. Send ONLY that claim to ftm-council with full evidence
3. Update the claim's tier based on council verdict
4. Re-render the disagreement map with the updated position
5. Report the council's reasoning to the user
