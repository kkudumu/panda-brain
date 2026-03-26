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

Three AI peers — Claude, Codex, and Gemini — independently research the codebase and deliberate on a problem through structured rounds of debate. No single model is the authority. Each model explores the code on its own, forms its own conclusions from what it finds, and only then enters deliberation. The council converges through majority vote: when 2 of 3 agree, that's the decision. If 5 rounds pass without majority agreement, Claude synthesizes the best elements from all three positions and presents the user with a clear summary of where the models agreed, where they diverged, and a recommended path forward.

## Why Independent Research Matters

The whole point of a multi-model council is diverse perspectives. If Claude reads the code first and then tells the other models what it found, you get three models reacting to Claude's framing — not three independent investigations. That's a game of telephone, not a council.

Each model has different attention patterns, different ways of navigating code, and different instincts about what's relevant. Codex might grep for usage patterns Claude wouldn't think to check. Gemini might focus on a config file Claude skimmed past. By letting each model explore independently, you get genuinely different perspectives grounded in what each model actually found in the codebase — not just different opinions about the same Claude-curated snippet.

## Prerequisites

The user needs both CLI tools installed and authenticated:
- **Codex**: `npm install -g @openai/codex` (authenticated via `codex login`)
- **Gemini**: `npm install -g @google/gemini-cli` (authenticated via Google)

Before the first round, verify both are available:
```bash
which codex && which gemini
```
If either is missing, tell the user what to install and stop — don't try to run a 2-model council.

## The Protocol

### Auto-Invocation Mode

The council can be invoked in two ways:

1. **User-invoked** (default): The user asks for a council. You frame the problem in Step 0 and proceed through the protocol.
2. **Auto-invoked**: Another skill (typically ftm-executor) invokes the council with a pre-framed conflict payload. Skip Step 0 — the problem is already framed.

**Detecting auto-invocation:**
If the invocation includes a structured conflict payload with these fields, you're in auto-invocation mode:
- `CONFLICT TYPE`
- `ORIGINAL INTENT`
- `CODEX'S CHANGE`
- `CODEX'S REASONING`
- `THE CODE IN QUESTION`
- `DEBUG.md HISTORY`
- `QUESTION FOR THE COUNCIL`

**Auto-invocation protocol:**
1. Skip Step 0 (problem is already framed by the calling skill)
2. Use the conflict payload directly as the council prompt for all three models
3. Add this context to each model's prompt: "This is an INTENT.md conflict from an automated build pipeline. Codex (gpt-5.4) made a code fix that contradicts the project's stated intent. You must decide: should the intent documentation be updated to match the fix, or should the fix be reverted to preserve the original intent?"
4. Include the DEBUG.md history so models don't suggest approaches already tried
5. Run through Steps 1-5 as normal (independent research → consensus check → rebuttals → verdict)
6. Return the verdict in a structured format the calling skill can parse:

```
COUNCIL VERDICT:
  decision: "update_intent" | "revert_fix"
  round: [which round consensus was reached]
  agreed_by: [which 2 models agreed]
  dissent: [the third model's position]
  reasoning: [2-3 sentence explanation]
  debug_log_entry: [formatted entry for DEBUG.md]
```

**Key difference from user-invoked:**
- In user-invoked mode, you show the user the framed prompt and wait for confirmation before starting
- In auto-invoked mode, you proceed immediately — the calling skill already validated the conflict
- In auto-invoked mode, you do NOT ask the user if they want to dig deeper into the dissent — you return the verdict directly to the calling skill

### Step 0: Frame the Problem

> **Note:** This step is skipped in auto-invocation mode. If a structured conflict payload was provided, proceed directly to Step 1 using the payload as the council prompt.

Take the user's request and distill it into a clear **council prompt** — a self-contained problem statement that makes sense without conversation history. The prompt should describe the problem and what a good answer looks like, but it should NOT include pre-read code. The models will read the code themselves.

Include:
- The specific question or decision to be made
- File paths or areas of the codebase to start investigating (as pointers, not content)
- Error messages or symptoms if it's a debugging problem
- Decision criteria — what a good answer looks like
- Any constraints the user has mentioned

Do NOT include:
- Pre-read file contents (each model reads files itself)
- Your own analysis or opinion about the problem
- Summaries of what the code does (let each model discover that)

Show the user the framed prompt before proceeding: "Here's what I'll send to the council — does this capture the problem?" Wait for confirmation or edits.

### Step 1: Independent Research (Round 1)

This is the critical step. All three models explore the codebase independently and in parallel. Each one reads whatever files it thinks are relevant, follows whatever threads it wants, and arrives at its own position based on its own research.

**You (Claude) are the orchestrator in this step, NOT a peer.** You do not form your own position yet. You spawn three independent investigations and collect the results.

Launch all three in parallel:

**Claude investigation** — spawn a subagent (this keeps the investigation isolated from your orchestrator context):

```
You are one of three AI peers in a deliberation council. The other two peers are Codex (OpenAI) and Gemini (Google). Your job is to independently investigate the following problem by reading the codebase, then give your honest, well-reasoned position.

IMPORTANT: Do your own research. Read files, search code, trace through logic. Your position must be grounded in what you actually find in the code, not assumptions. Cite specific files and line numbers.

PROBLEM:
{council_prompt}

WORKING DIRECTORY: {cwd}

Instructions:
1. Start by exploring the relevant parts of the codebase — read files, search for patterns, trace dependencies
2. Take notes on what you find as you go
3. After you've done sufficient research, formulate your position

Give your response in this format:
1. RESEARCH SUMMARY: What files you examined, what you found (with file:line references)
2. POSITION: Your clear stance (1-2 sentences)
3. REASONING: Why you believe this, grounded in specific code you read
4. CONCERNS: What could go wrong with your approach
5. CONFIDENCE: High/Medium/Low and why
```

**Codex** — spawn a subagent that runs:
```bash
codex exec --full-auto "You are one of three AI peers in a deliberation council. The other two peers are Claude (Anthropic) and Gemini (Google). Your job is to independently investigate the following problem by reading the codebase, then give your honest, well-reasoned position.

IMPORTANT: Do your own research. Read files, search code, trace through logic. Your position must be grounded in what you actually find in the code, not assumptions. Cite specific files and line numbers.

PROBLEM:
{council_prompt}

Instructions:
1. Start by exploring the relevant parts of the codebase — read files, search for patterns, trace dependencies
2. Take notes on what you find as you go
3. After you have done sufficient research, formulate your position

Give your response in this format:
1. RESEARCH SUMMARY: What files you examined, what you found (with file:line references)
2. POSITION: Your clear stance (1-2 sentences)
3. REASONING: Why you believe this, grounded in specific code you read
4. CONCERNS: What could go wrong with your approach
5. CONFIDENCE: High/Medium/Low and why"
```

The `--full-auto` flag gives Codex sandboxed read access to the workspace so it can explore files on its own.

**Gemini** — spawn a subagent that runs:
```bash
gemini -p "You are one of three AI peers in a deliberation council. The other two peers are Claude (Anthropic) and Codex (OpenAI). Your job is to independently investigate the following problem by reading the codebase, then give your honest, well-reasoned position.

IMPORTANT: Do your own research. Read files, search code, trace through logic. Your position must be grounded in what you actually find in the code, not assumptions. Cite specific files and line numbers.

PROBLEM:
{council_prompt}

Instructions:
1. Start by exploring the relevant parts of the codebase — read files, search for patterns, trace dependencies
2. Take notes on what you find as you go
3. After you have done sufficient research, formulate your position

Give your response in this format:
1. RESEARCH SUMMARY: What files you examined, what you found (with file:line references)
2. POSITION: Your clear stance (1-2 sentences)
3. REASONING: Why you believe this, grounded in specific code you read
4. CONCERNS: What could go wrong with your approach
5. CONFIDENCE: High/Medium/Low and why" --yolo
```

The `--yolo` flag lets Gemini auto-approve file reads so it can explore without getting stuck on permission prompts.

Collect all three responses. Present them to the user with a structured comparison that highlights what each model found:

```
## Round 1 — Independent Research

### Claude
**Research**: [what files it read, what it focused on]
**Position**: ...
**Key evidence**: ...

### Codex
**Research**: [what files it read, what it focused on]
**Position**: ...
**Key evidence**: ...

### Gemini
**Research**: [what files it read, what it focused on]
**Position**: ...
**Key evidence**: ...

### Alignment Check
- Agreement areas: ...
- Divergence points: ...
- Different research paths: [note if models looked at different files or focused on different aspects — this is valuable signal]
- Majority forming? [Yes — X and Y agree / No — all three differ]
```

### Step 2: Check for Early Consensus

After each round, check if 2 of 3 positions substantially agree. "Substantially agree" means they recommend the same approach, even if they phrase it differently or differ on minor details. Don't require identical wording — look for the same core recommendation.

If majority exists → jump to **Step 5: Verdict**.
If not → continue to the next rebuttal round.

### Step 3: Rebuttal Rounds (Rounds 2-5)

For each subsequent round, each model sees the other two models' previous positions (including what they found in the code) and must respond directly. This is where the real deliberation happens — models engage with each other's evidence and arguments, not just opinions.

Build a rebuttal prompt that includes the previous round's research and positions:

For Codex and Gemini, the rebuttal prompt should include enough context for them to do targeted follow-up research if they want to verify the other models' claims:

```
Round {N} of the deliberation council.

Here's what happened in the previous round. Each model independently researched the codebase and formed a position:

CLAUDE's research and position:
{claude_previous_full}

CODEX's research and position:
{codex_previous_full}

GEMINI's research and position:
{gemini_previous_full}

Now respond. You may do additional codebase research if you want to verify claims the other models made or investigate angles they raised. Then:

1. Directly address the strongest point from each other model
2. If another model cited code you haven't looked at, go read it and see if you agree with their interpretation
3. State whether you've changed your position (and why, or why not)
4. If you agree with another model, say so explicitly

UPDATED POSITION: [same/changed] ...
NEW EVIDENCE (if any): [anything new you found by following up on other models' research]
KEY RESPONSE TO {OTHER_MODEL_1}: ...
KEY RESPONSE TO {OTHER_MODEL_2}: ...
REMAINING DISAGREEMENTS: ...
```

For rebuttal rounds, use the same CLI flags (`--full-auto` for Codex, `--yolo` for Gemini) so models can do follow-up research — they might want to verify a claim another model made by reading a file they hadn't looked at before.

The Claude rebuttal should also be done via a subagent so it stays isolated and doesn't anchor on the orchestrator's accumulated context.

Present the round results to the user with the structured comparison format. Highlight what changed, who moved, and whether consensus is forming. Pay special attention to cases where a model changed its mind after reading code another model pointed to — that's the council working as intended.

### Step 4: Repeat or Escalate

After each rebuttal round, check for majority agreement (Step 2).

If after 5 rounds there's still no majority:
- This is a genuinely hard problem with legitimate disagreement
- Synthesize the three final positions into a summary
- Highlight the core tension — what's the fundamental tradeoff they can't agree on?
- Note which models examined which parts of the codebase — incomplete research might explain persistent disagreement
- Present the user with 2-3 concrete options (mapped to the council positions) and let them decide

### Step 5: Verdict

When 2 of 3 agree, present the verdict:

```
## Council Verdict — Round {N}

**Decision**: {the agreed position}
**Agreed by**: {which two models}
**Dissent**: {the third model's remaining objection}

### Evidence basis
{What code each model examined that led to this conclusion}

### Why the majority position won
{Brief analysis of why the arguments were stronger}

### The dissent is worth noting because
{What the dissenting model raised that's still valid — this often contains useful caveats}

### Recommended action
{Concrete next steps based on the decision}
```

Ask the user if they want to proceed with the verdict or if they want to dig deeper into the dissent.

**Auto-invocation verdict format:**

When auto-invoked, also return the verdict in the structured format the calling skill expects:

```
COUNCIL VERDICT:
  decision: "update_intent" | "revert_fix"
  round: [N]
  agreed_by: [model1, model2]
  dissent: [model3's position summary]
  reasoning: [why the majority position won]
  debug_log_entry: |
    ### Council Verdict — [timestamp]
    **Conflict**: [brief description]
    **Decision**: [update_intent/revert_fix]
    **Agreed by**: [models]
    **Reasoning**: [explanation]
    **Dissent**: [third model's concern]
```

Do not ask the user if they want to proceed — return the verdict directly to the calling skill.

## Practical Considerations

### Timeouts
Independent research takes longer than simple prompting — each model is reading files, searching code, etc. Set timeouts at 300s (5 minutes) for Round 1 since that's the heavy research round. Rebuttal rounds can use 180s since they're doing less exploration. If one model times out, report it and continue with the other two.

### Error Handling
If Codex or Gemini returns an error (auth failure, rate limit, sandbox issue, etc.):
- Report the error to the user
- Continue with the remaining models
- A 2-model debate is better than nothing, though you lose the tiebreaker benefit

### Conversation State
Between rounds, you (the orchestrator) hold state. Keep a running record of each model's research findings AND positions so you can construct accurate rebuttal prompts. Codex and Gemini are stateless between rounds, so every round's prompt must be self-contained — include the full history of what each model found and argued.

### Working Directory
Make sure Codex and Gemini run from the same working directory as the current session. This ensures they're all looking at the same codebase. Pass `cd {cwd} &&` before the CLI command if needed to ensure correct directory.

### When NOT to Council
- Trivial questions with obvious answers (don't waste 3 research sessions on "should I use const or let")
- Questions where the user just needs execution, not deliberation
- Pure opinion questions with no code to investigate
- If the user says "just do it" — they want action, not debate
- When auto-invoked by ftm-executor — always proceed (the executor already determined a council is needed)

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions including the verdict and which models agreed (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing decision domain, verdict, round reached, dissent summary, and whether the verdict held up
3. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `task_completed` event

## Requirements

- tool: `codex` | required | Codex CLI for independent peer investigation
- tool: `gemini` | required | Gemini CLI for independent peer investigation
- reference: `references/protocols/PREREQUISITES.md` | required | availability check, fallback logic, timeout config
- reference: `references/protocols/STEP-0-FRAMING.md` | required | problem framing format
- reference: `references/prompts/CLAUDE-INVESTIGATION.md` | required | Claude investigation prompt template
- reference: `references/prompts/CODEX-INVESTIGATION.md` | required | Codex investigation prompt template
- reference: `references/prompts/GEMINI-INVESTIGATION.md` | required | Gemini investigation prompt template
- reference: `references/prompts/REBUTTAL-TEMPLATE.md` | required | rebuttal round prompt template
- reference: `~/.claude/ftm-state/blackboard/context.json` | optional | session state

## Risk

- level: read_only
- scope: reads codebase for independent investigation; does not modify source files; writes blackboard experience after verdict
- rollback: no source mutations; blackboard write can be reverted by editing JSON files

## Approval Gates

- trigger: council prompt framed in Step 0 | action: show framed prompt to user and wait for confirmation before dispatching to council
- trigger: 2-of-3 majority reached | action: present verdict summary to user and ask if they want to proceed or dig into dissent
- trigger: auto-invocation by ftm-executor (INTENT.md conflict) | action: skip user framing confirmation, run immediately and return structured COUNCIL VERDICT to caller
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: codex CLI not found | action: report missing dependency with install instructions and stop (do not run degraded council)
- condition: gemini CLI not found | action: report missing dependency with install instructions and stop
- condition: no majority after 5 rounds | action: synthesize final positions, highlight core tension, present 2-3 concrete options for user decision
- condition: model times out during a round | action: note timeout for that model, continue round with remaining models' responses

## Capabilities

- cli: `codex` | required | OpenAI Codex CLI peer reviewer
- cli: `gemini` | required | Google Gemini CLI peer reviewer
- env: `OPENAI_API_KEY` | required | for Codex CLI authentication
- env: `GEMINI_API_KEY` | required | for Gemini CLI authentication

## Event Payloads

### review_complete
- skill: string — "ftm-council"
- verdict: string — "update_intent" | "revert_fix" | "option_a" | "option_b" | custom decision
- round: number — round in which majority was reached (1-5, or 5+ for synthesis)
- agreed_by: string[] — which models agreed on the verdict
- dissent: string | null — summary of dissenting position
- reasoning: string — why the majority won

### task_completed
- skill: string — "ftm-council"
- decision_domain: string — topic the council deliberated on
- verdict: string — final decision
- round: number — rounds taken to reach verdict
- duration_ms: number — total deliberation time
