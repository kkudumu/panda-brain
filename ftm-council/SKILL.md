---
name: ftm-council
description: Multi-AI deliberation council that sends problems to Claude, Codex, and Gemini as equal peers, then loops through rounds of debate until 2-of-3 agree on a decision. Use when the user wants a second (and third) opinion, says "council this", "get other opinions", "what would other AIs think", "debate this", "multi-model", "ftm-council", or wants to cross-check a decision, architecture choice, debugging approach, or any problem where diverse AI perspectives would reduce blind spots. Especially valuable for debugging hard problems, architecture decisions, code review, and any situation where confirmation bias from a single model is a risk. Even if the user just says "I'm not sure about this approach" or "sanity check this", consider invoking the council.
---

## Events

### Emits
- `review_complete` — when the council reaches a majority verdict (2-of-3 agreement) or synthesizes a final recommendation after 5 rounds
- `task_completed` — when the deliberation session concludes and a verdict is returned to the caller

### Listens To
(none — council is invoked explicitly by the user or by ftm-executor when an INTENT.md conflict requires arbitration)

## Blackboard Read

Before starting, load context from the blackboard:

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by tags matching the current decision domain
3. Load top 3-5 matching experience files for past council verdicts and how well they held up
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check execution_patterns for what types of decisions benefited most from multi-model review

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# FTM Council

Three peers — a subagent investigator, Codex, and Gemini — independently research the codebase and deliberate on a problem through structured rounds of debate. No single model is the authority. Each model explores the code on its own, forms its own conclusions from what it finds, and only then enters deliberation. The council converges through majority vote: when 2 of 3 agree, that's the decision. If 5 rounds pass without majority agreement, the orchestrator synthesizes the best elements from all three positions and presents the user with a clear summary of where the models agreed, where they diverged, and a recommended path forward.

## Why Independent Research Matters

Each model explores the codebase independently — different attention patterns, different navigation instincts, different focus areas. This produces genuinely diverse perspectives grounded in what each model actually found, not three reactions to one curated framing.

## Prerequisites

Check tool availability before starting. Read `references/protocols/PREREQUISITES.md` for the full availability check, fallback logic, timeout configuration, and working directory setup.

Quick check:
```bash
which codex && which gemini
```
If either is missing, tell the user what to install and stop — don't try to run a degraded council without informing them.

## The Protocol

### Auto-Invocation Mode

Two invocation modes:
1. **User-invoked** (default): Frame the problem in Step 0, proceed through protocol.
2. **Auto-invoked**: Another skill provides a pre-framed conflict payload (containing `CONFLICT TYPE`, `ORIGINAL INTENT`, `CODEX'S CHANGE`, etc.). Skip Step 0, use the payload directly, include DEBUG.md history, run Steps 1-5, and return a structured `COUNCIL VERDICT` to the caller without user interaction.

---

### Step 0: Frame the Problem

> **Note:** Skipped in auto-invocation mode. If a structured conflict payload was provided, proceed directly to Step 1.

Distill the user's request into a self-contained **council prompt** — a clear problem statement with investigation entry points but no pre-read code. Models read the code themselves.

Read `references/protocols/STEP-0-FRAMING.md` for the full framing guide, including what to include, what to exclude, and the structured payload format.

Show the user the framed prompt before proceeding: "Here's what I'll send to the council — does this capture the problem?" Wait for confirmation or edits.

---

### Step 1: Independent Research (Round 1)

**You (the orchestrator) are NOT a peer in this step.** Do not form your own position yet. Spawn three independent investigations in parallel and collect the results.

Read `references/prompts/CLAUDE-INVESTIGATION.md`, `references/prompts/CODEX-INVESTIGATION.md`, and `references/prompts/GEMINI-INVESTIGATION.md` for the full prompt templates for each model.

Present results with a structured comparison showing each model's research, position, key evidence, and an alignment check (agreement areas, divergence points, majority forming?).

---

### Step 2: Check for Early Consensus

After each round, check if 2 of 3 positions substantially agree. "Substantially agree" means they recommend the same approach, even if they phrase it differently or differ on minor details. Don't require identical wording — look for the same core recommendation.

If majority exists → jump to **Step 5: Verdict**.
If not → continue to the next rebuttal round.

---

### Step 3: Rebuttal Rounds (Rounds 2-5)

Each model sees the other two models' previous positions and must respond directly to their evidence. Read `references/prompts/REBUTTAL-TEMPLATE.md` for the full rebuttal prompt template. Use same CLI flags for follow-up research. Present results highlighting what changed and whether consensus is forming.

---

### Step 4: Repeat or Escalate

After each rebuttal round, check for majority agreement (Step 2).

If after 5 rounds there's still no majority:
- This is a genuinely hard problem with legitimate disagreement
- Synthesize the three final positions into a summary
- Highlight the core tension — what's the fundamental tradeoff they can't agree on?
- Note which models examined which parts of the codebase — incomplete research might explain persistent disagreement
- Present the user with 2-3 concrete options (mapped to the council positions) and let them decide

---

### Step 5: Verdict

When 2 of 3 agree, present: decision, which models agreed, dissent, evidence basis, why the majority won, what the dissent raised that's still valid, and recommended action. Ask if the user wants to proceed or dig into the dissent.

**Auto-invocation:** Return structured `COUNCIL VERDICT` with `decision` (update_intent/revert_fix), `round`, `agreed_by`, `dissent`, `reasoning`, `debug_log_entry`. Do not ask the user — return directly to the calling skill.

---

## Practical Considerations

### Conversation State
Orchestrator holds state between rounds. Codex and Gemini are stateless — every prompt must include full history.

### When NOT to Council
Trivial questions, pure execution requests, pure opinion with no code to investigate, or when the user says "just do it". Exception: always proceed when auto-invoked by ftm-executor.

---

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions including the verdict and which models agreed (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing decision domain, verdict, round reached, dissent summary, and whether the verdict held up
3. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `task_completed` event
