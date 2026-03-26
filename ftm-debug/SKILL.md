---
name: ftm-debug
description: Deep multi-vector debugging war room that launches parallel agent teams to instrument, research, reproduce, hypothesize, solve, and verify tricky bugs. Use when a bug is stubborn, multi-turn debugging hasn't worked, the user says "debug this deeply", "war room this", "I can't figure out why", "this is driving me crazy", "launch the debug team", or any situation where standard debugging is insufficient. Also triggers on "/ftm-debug". Covers any codebase — frontend, backend, CLI tools, native apps, build systems, anything. Do NOT use for simple one-step fixes — this is the heavy artillery for problems that resist normal debugging.
---

## Events

### Emits
- `bug_fixed` — when the Reviewer agent approves a fix and the bug is confirmed resolved
- `issue_found` — when investigation surfaces a specific problem (hypothesis confirmed, instrumentation reveals root cause)
- `test_passed` — when the reproduction test passes after a fix, or when the full suite passes post-fix
- `test_failed` — when the reproduction test fails, or when a fix attempt causes regressions
- `error_encountered` — when an unexpected error halts the war room workflow (agent failure, unrecoverable blocker)
- `task_completed` — when the debug session concludes with an approved and merged fix

### Listens To
- `test_failed` — auto-investigate: launch Phase 0 intake and deploy the war room agent team
- `error_encountered` — diagnose the error: run codebase reconnaissance and begin targeted investigation

## Blackboard Read

Before starting, load context from the blackboard:

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by task_type="bug" and tags matching the current error domain
3. Load top 3-5 matching experience files for known fixes and failed approaches
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check recurring_issues for matching symptoms and codebase_insights for relevant file patterns

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# Debug War Room

Multi-vector deep debugging with parallel agent teams. When a bug resists normal debugging — you've tried the obvious, poked at it for multiple turns, and it's still not yielding — this skill escalates to a coordinated investigation across every angle simultaneously: instrumentation, research, reproduction, hypothesis, fix, and verification.

## Why This Exists

Hard bugs are hard because they hide across multiple dimensions. The symptom is in one place, the cause is in another, and the fix requires understanding both plus the invisible interactions between them. Single-threaded debugging (try a thing, see if it works, try another thing) is too slow and too narrow. The war room attacks from every direction at once:

- **Instrumentation** catches what you can't see — timing, state transitions, render cycles, race conditions
- **Research** discovers that someone else hit this exact problem 18 months ago and documented the fix on a GitHub issue
- **Reproduction** isolates the bug from the noise so you can see it clearly
- **Hypothesis** maps the code paths and forms theories before touching anything
- **Solving** happens in isolated worktrees so every attempt is a clean experiment you can keep or discard
- **Review** catches the fix that fixes the bug but breaks three other things

The combination is what makes it powerful. Each vector informs the others — the researcher finds a pattern, the hypothesizer uses it, the solver implements against it, the reviewer validates it holds.

## Core Principle: Automate Everything Before Involving the User

The entire point of the war room is that **agents do the work**. Every verification step, every test run, every log check, every "does it actually work?" confirmation must be performed by an agent before presenting results to the user. The user should receive a **verified, working result** — not a list of manual steps to try.

This means:
- If you can run a command to check if the fix works, **run it**. Don't tell the user to run it.
- If you can open a new terminal/process, read logs, check output, inspect state — **do it**.
- If you can write and execute a test script — **do it**.
- If the verification requires launching the application, reading its output, checking logs, inspecting files — **the Reviewer agent does all of this**.
- If the bug has a visual/rendering component, **the Reviewer must visually verify** using Playwright, screenshots, AppleScript, or process output capture. Tests passing is not enough — the Reviewer must confirm the user will actually see the correct result.
- The user's only job is to confirm the final result after all automated verification has passed. Even then, present what you verified so they can trust the result without re-running everything.

**Critical**: "All tests pass" is necessary but NOT sufficient. Tests verify code paths and logic. They do NOT verify that the feature actually works as experienced by a user. A function can return the right value in a test but never get called in the real app. A rendered component can pass snapshot tests but be invisible due to CSS. A config change can pass validation but never get loaded at runtime. The Reviewer must verify the actual runtime/visual result, not just test results. If 103 tests pass but the feature is still broken, the Reviewer failed.

If an agent produces a "How to Verify" section with manual steps, that's a failure of the process. Convert those steps into automated verification that the Reviewer executes.

## The Process

### Phase 0: Problem Intake

Before launching agents, understand what you're debugging. This happens in the main conversation thread — no agents yet.

#### Step 1: Gather the Problem Statement

If the user hasn't already described the bug in detail, ask targeted questions (one at a time, skip what you already know from conversation history):

1. **What's happening?** — The symptom. What does the user see/experience?
2. **What should be happening?** — The expected behavior.
3. **What have you already tried?** — Critical context. Don't duplicate wasted work.
4. **When did it start?** — A recent change? Always been broken? Intermittent?
5. **Can you trigger it reliably?** — Reproduction steps if they exist.

#### Step 2: Codebase Reconnaissance

Spawn an **Explore agent** to scan the relevant area of the codebase:

```
Analyze the codebase around the reported problem area:

1. **Entry points**: What are the main files involved in this feature/behavior?
2. **Call graph**: Trace the execution path from trigger to symptom
3. **State flow**: What state (variables, stores, databases, caches) does this code touch?
4. **Dependencies**: What external libs, APIs, or services are in the path?
5. **Recent changes**: Check git log for recent modifications to relevant files
6. **Test coverage**: Are there existing tests for this code path? Do they pass?
7. **Configuration**: Environment variables, feature flags, build config that affect behavior
8. **Error handling**: Where does error handling exist? Where is it missing?

Focus on the area described by the user. Map the territory before anyone tries to change it.
```

Store the result as **codebase context**. Every subsequent agent receives this.

#### Step 3: Formulate the Investigation Plan

Based on the problem statement and codebase context, decide:

1. **Which debug vectors are relevant?** Not every bug needs all 7 agents. A pure logic bug doesn't need instrumentation. A well-documented API issue might not need research. Pick what helps.
2. **What specific questions should each agent answer?** Generic "go investigate" prompts produce generic results. Targeted questions produce answers.
3. **What's the most likely root cause category?** (Race condition? State corruption? API contract mismatch? Build/config issue? Logic error? Missing error handling?) This focuses the investigation.

Present the investigation plan to the user:

```
Investigation Plan:
  Problem: [one-line summary]
  Likely category: [race condition / state bug / API mismatch / etc.]
  Agents deploying:
    - Instrumenter: [what they'll instrument and why]
    - Researcher: [what they'll search for]
    - Reproducer: [reproduction strategy]
    - Hypothesizer: [which code paths they'll analyze]
  Worktree strategy: [how many worktrees, branch naming]
```

Then proceed immediately unless the user objects.

---

### Phase 1: Parallel Investigation (the war room)

Launch all investigation agents **simultaneously**. This is the core value — attacking from every angle at once.

#### Agent: Instrumenter

The Instrumenter adds comprehensive debug logging and observability to the problem area. This agent works in its own worktree so instrumentation code stays isolated from fix attempts.

```
You are the Instrumenter in a debug war room. Your job is to add debug
logging and observability so the team can SEE what's happening at runtime.

Working directory: [worktree path]
Problem: [problem statement]
Codebase context: [from Phase 0]
Likely root cause category: [from investigation plan]

## What to Instrument

Add logging that captures the invisible. Think about what data would let
you diagnose this bug if you could only read a log file:

### State Snapshots
- Capture the full state at key decision points (before/after transforms,
  at branch conditions, before API calls)
- Log both the input AND output of any function in the suspect path
- For UI bugs: capture render state, props, computed values
- For API bugs: capture request + response bodies + headers + timing
- For state management bugs: capture state before and after mutations

### Timing & Sequencing
- Add timestamps to every log entry (use high-resolution: performance.now()
  or process.hrtime() depending on environment)
- Log entry and exit of key functions to see execution order
- For async code: log when promises are created, resolved, rejected
- For event-driven code: log event emission and handler invocation

### Environment & Configuration
- Log all relevant env vars, feature flags, config values at startup
- Log platform/runtime details (versions, OS, screen size for UI bugs)
- Capture the state of any caches, memoization, or lazy-loaded resources

### Error Boundaries
- Wrap suspect code in try/catch (if not already) and log caught errors
  with full stack traces
- Add error event listeners where appropriate
- Log warnings that might be swallowed silently

## Output Format

1. Make all changes in the worktree and commit them
2. Write a file called `DEBUG-INSTRUMENTATION.md` documenting:
   - Every log point added and what it captures
   - How to enable/trigger the logging (env vars, flags, etc.)
   - How to read the output (log file locations, format explanation)
   - A suggested test script to exercise the instrumented code paths
3. If the problem has a UI component, add visual debug indicators too
   (border highlights, state dumps in dev tools, overlay panels)

## Key Principle

Instrument generously. It's cheap to add logging and expensive to guess.
The cost of too much logging is scrolling; the cost of too little is
another round of debugging. When in doubt, log it.
```

#### Agent: Researcher

The Researcher searches for existing solutions — someone else has probably hit this exact bug or something like it.

```
You are the Researcher in a debug war room. Your job is to find out if
this problem has been solved before, what patterns others used, and what
pitfalls to avoid.

Problem: [problem statement]
Codebase context: [from Phase 0]
Tech stack: [languages, frameworks, key dependencies from Phase 0]
Likely root cause category: [from investigation plan]

## Research Vectors (search all of these)

### 1. GitHub Issues & Discussions
Search the GitHub repos of every dependency in the problem path:
- Search for keywords from the error message or symptom
- Search for the function/class names involved
- Check closed issues — the fix might already exist in a newer version
- Check open issues — this might be a known unfixed bug

### 2. Stack Overflow & Forums
Search for:
- The exact error message (in quotes)
- The symptom described in plain language + framework name
- The specific API or function that's misbehaving

### 3. Library Documentation
Use Context7 or official docs to check:
- Are we using the API correctly? Check current docs, not cached knowledge
- Are there known caveats, migration notes, or breaking changes?
- Is there a recommended pattern we're not following?

### 4. Blog Posts & Technical Articles
Search for:
- "[framework] + [symptom]" — e.g., "React useEffect infinite loop"
- "[library] + [error category]" — e.g., "webpack ESM require crash"
- "[pattern] + debugging" — e.g., "WebSocket reconnection race condition"

### 5. Release Notes & Changelogs
Check if a recent dependency update introduced the issue:
- Compare the installed version vs latest, check changelog between them
- Look for deprecation notices that match our usage pattern

## Output Format

Write a file called `RESEARCH-FINDINGS.md` with:

For each relevant finding:
- **Source**: URL or reference
- **Relevance**: Why this applies to our problem (1-2 sentences)
- **Solution found**: What fix/workaround was used (if any)
- **Confidence**: How closely this matches our situation (high/medium/low)
- **Key insight**: The non-obvious thing we should know

End with a **Recommended approach** section that synthesizes the most
promising leads into an actionable suggestion.

## Key Principle

Cast a wide net, then filter ruthlessly. The goal is not 50 vaguely
related links — it's 3-5 findings that directly inform the fix. Quality
of relevance over quantity of results.
```

#### Agent: Reproducer

The Reproducer creates a minimal, reliable way to trigger the bug.

```
You are the Reproducer in a debug war room. Your job is to create the
simplest possible reproduction of the bug — ideally an automated test
that fails, or a script that triggers the symptom reliably.

Working directory: [worktree path]
Problem: [problem statement]
Codebase context: [from Phase 0]
Reproduction steps from user: [if any]

## Reproduction Strategy

### 1. Verify the User's Steps
If the user provided reproduction steps, follow them exactly first.
Document whether the bug appears consistently or intermittently.

### 2. Write a Failing Test
The gold standard is a test that:
- Fails now (reproduces the bug)
- Will pass when the bug is fixed
- Runs in the project's existing test framework

If the bug is in a function: write a unit test with the inputs that
trigger the failure.

If the bug is in a flow: write an integration test that exercises the
full path.

If the bug requires a running server/UI: write a script that automates
the trigger (curl commands, Playwright script, CLI invocation, etc.)

### 3. Minimize
Strip away everything that isn't necessary to trigger the bug:
- Remove unrelated setup steps
- Use the simplest possible inputs
- Isolate the exact conditions (timing, data shape, config values)

### 4. Characterize
Once you can reproduce it, characterize the boundaries:
- What inputs trigger it? What inputs don't?
- Is it timing-dependent? Data-dependent? Config-dependent?
- Does it happen on first run only, every run, or intermittently?
- What's the smallest change that makes it go away?

## Output Format

1. Commit all reproduction artifacts to the worktree
2. Write a file called `REPRODUCTION.md` documenting:
   - **Trigger command**: The single command to reproduce the bug
   - **Expected vs actual**: What should happen vs what does happen
   - **Consistency**: How reliably it reproduces (every time / 8 out of 10 / etc.)
   - **Boundaries**: What makes it appear/disappear
   - **Minimal test**: Path to the failing test file
   - **Environment requirements**: Any special setup needed

## Key Principle

A bug you can't reproduce is a bug you can't fix with confidence. And a
bug you can reproduce with a single command is a bug you can fix in
minutes. The reproduction IS the debugging.
```

#### Agent: Hypothesizer

The Hypothesizer reads the code deeply and forms theories about root cause.

```
You are the Hypothesizer in a debug war room. Your job is to deeply read
the code involved in the bug, trace every execution path, and form
ranked hypotheses about what's causing the problem.

Problem: [problem statement]
Codebase context: [from Phase 0]
Likely root cause category: [from investigation plan]

## Analysis Method

### 1. Trace the Execution Path
Starting from the user's trigger action, trace through every function
call, state mutation, and branch condition until you reach the symptom.
Document the full chain.

### 2. Identify Suspect Points
At each step in the chain, evaluate:
- Could this function receive unexpected input?
- Could this state be in an unexpected shape?
- Could this condition evaluate differently than intended?
- Is there a timing assumption (X happens before Y)?
- Is there an implicit dependency (this works because that was set up earlier)?
- Is error handling missing or swallowing relevant errors?

### 3. Form Hypotheses
For each suspect point, write a hypothesis:
- **What**: "The bug occurs because X"
- **Why**: "Because when [condition], the code at [file:line] does [thing]
   instead of [expected thing]"
- **Evidence for**: What supports this theory
- **Evidence against**: What contradicts this theory
- **How to verify**: What specific test or log would prove/disprove this

### 4. Rank by Likelihood
Order hypotheses from most to least likely based on:
- How much evidence supports each one
- How well it explains ALL symptoms (not just some)
- Whether it aligns with the root cause category
- Occam's razor — simpler explanations first

## Output Format

Write a file called `HYPOTHESES.md` with:

### Hypothesis 1 (most likely): [title]
- **Claim**: [one sentence]
- **Mechanism**: [detailed explanation of how the bug occurs]
- **Code path**: [file:line] -> [file:line] -> [file:line]
- **Evidence for**: [what supports this]
- **Evidence against**: [what contradicts this]
- **Verification**: [how to prove/disprove]
- **Suggested fix**: [high-level approach]

[repeat for each hypothesis, ranked]

### Summary
- Top 3 hypotheses with confidence levels
- Recommended investigation order
- What additional data would help distinguish between hypotheses

## Key Principle

Don't jump to conclusions. The first plausible explanation is often
wrong — it's the one you already thought of that didn't pan out. Trace
the actual code, don't assume. Read every line in the path. The bug is
in the code, and the code is right there to be read.
```

---

### Phase 2: Synthesis & Solve

After all Phase 1 agents complete, synthesize their findings before solving.

#### Step 1: Cross-Reference Findings

Read all four reports and synthesize:

1. **Do the hypotheses match the research?** If the Researcher found a known bug that matches a Hypothesis, that's high signal.
2. **Does the reproduction confirm a hypothesis?** If the Reproducer's characterization (only fails with X input, timing-dependent, etc.) matches a hypothesis's prediction, that's strong evidence.
3. **What does the instrumentation suggest?** If the Instrumenter's logging points would help verify a specific hypothesis, note that.
4. **Are there contradictions?** If the Researcher says "this is a known library bug" but the Hypothesizer says "this is a logic error in our code," figure out which is right.

Present the synthesis to the user briefly:

```
War Room Findings:
  Researcher: [key finding]
  Reproducer: [reproduction status + characterization]
  Hypothesizer: [top hypothesis]
  Instrumenter: [logging added, key observation points]

  Cross-reference: [how findings align or conflict]
  Recommended fix approach: [what to try first]

Proceeding to solve in isolated worktree.
```

#### Step 2: Solve (in worktrees)

Launch the **Solver agent** in a fresh worktree. The Solver gets the full synthesis — all four reports plus the cross-reference analysis.

```
You are the Solver in a debug war room. The investigation team has
completed their analysis and you now have comprehensive context. Your
job is to implement the fix.

Working directory: [worktree path]
Problem: [problem statement]
Codebase context: [from Phase 0]

## Investigation Results

[paste full synthesis: Research findings, Reproduction results,
Hypotheses ranked, Instrumentation notes, Cross-reference analysis]

## Execution Rules

### Work Incrementally
- Start with the highest-ranked hypothesis
- Implement the minimal fix that addresses it
- COMMIT after each discrete change (not one big commit at the end)
- Use clear commit messages: "Fix: [what] — addresses hypothesis [N]"

### Verify as You Go
- After each fix attempt, run the reproduction test from REPRODUCTION.md
- If the project has existing tests, run them too (zero broken windows)
- If the fix works on the reproduction but breaks other tests, that's
  not done — fix the regressions too

### If the First Hypothesis Doesn't Pan It
- Don't keep hacking at it. Move to hypothesis #2.
- Revert the failed attempt (git revert or fresh branch) so each
  attempt starts clean
- If you exhaust all hypotheses, say so — don't invent new ones
  without evidence

### Clean Up After Yourself
- Remove any debug logging you added (unless the user wants to keep it)
- Make sure the fix is minimal — don't refactor surrounding code
- Don't add "just in case" error handling beyond what the fix requires

### Do NOT Declare Victory
- You are the Solver, not the Reviewer. Your job ends at "fix committed."
- Do NOT tell the user "restart X to see the change" — that's the
  Reviewer's job (and the Reviewer must do it, not the user)
- Do NOT present results directly to the user — hand off to the
  Reviewer agent via FIX-SUMMARY.md
- Do NOT say the fix works unless you have actually verified it
  by running it. "The code looks correct" is not verification.

## Output Format

1. All changes committed in the worktree with descriptive messages
2. Write a file called `FIX-SUMMARY.md` documenting:
   - **Root cause**: What was actually wrong (one paragraph)
   - **Fix applied**: What you changed and why
   - **Files modified**: List with brief descriptions
   - **Commits**: List of commit hashes with messages
   - **Verification**: What tests you ran and their results
   - **Requires restart**: YES/NO — does the fix require restarting
     a process, reloading config, or rebuilding to take effect?
   - **Visual component**: YES/NO — does this bug have a visual or
     experiential symptom that needs visual verification?
   - **Remaining concerns**: Anything that should be monitored or
     might need follow-up
```

---

### Phase 3: Review & Verify

**HARD GATE — You cannot proceed to Phase 4 without completing this phase.**

This is non-negotiable. You cannot present results to the user until a
Reviewer has independently verified the fix. "I checked with grep" is not
verification. "The tests pass" is not verification. "The patch was applied"
is not verification.

Verification means: **the actual behavior the user reported as broken now
works correctly, as observed by an agent, with captured evidence.**

#### Step 1: Determine verification method BEFORE launching the Reviewer

Look at the original bug report. Ask: "How would a human know this is fixed?"

- If the answer involves SEEING something (UI, terminal output, rendered
  image, visual layout) → the Reviewer MUST capture a screenshot or
  visual evidence. Use `screencapture`, Playwright `browser_take_screenshot`,
  or process output capture.
- If the answer involves a BEHAVIOR (API returns correct data, CLI produces
  right output, server responds correctly) → the Reviewer MUST exercise
  that behavior and capture the output.
- If the answer is "the error stops happening" → the Reviewer MUST trigger
  the scenario that caused the error and confirm it no longer occurs.

The verification method goes into the Reviewer's prompt. Don't let the
Reviewer decide — tell it exactly what to verify and how.

#### Step 2: If the fix requires a restart, the Reviewer handles it

Many fixes (bundle patches, config changes, build artifacts) require
restarting a process to take effect. The Reviewer must:

1. Restart the process (use `osascript` to launch in a new terminal if
   needed, or kill and restart the background process)
2. Wait for it to initialize
3. Exercise the fixed behavior
4. Capture evidence (screenshot, output, logs)

If the Reviewer literally cannot restart because it's running inside the
process being fixed (e.g., debugging Claude Code from within Claude Code),
try these alternatives first:

1. **Launch a SEPARATE instance** via osascript/terminal:
   ```bash
   osascript -e 'tell application "Terminal" to do script "cd /path && claude --print \"hello\""'
   sleep 5
   screencapture -x /tmp/verification.png
   ```
   Then READ the screenshot to verify.

2. **Launch via background process** and capture output:
   ```bash
   nohup claude --print "test" > /tmp/claude-output.txt 2>&1 &
   sleep 5
   cat /tmp/claude-output.txt
   ```

3. **Use Playwright MCP** if available to screenshot a running instance.

Only if ALL of these are impossible should you flag as BLOCKED. In that
case, tell the user exactly what to look for, why you couldn't verify it
yourself, and what the expected visual result should be (with specifics,
not "check if it works").

#### Step 3: Launch the Reviewer agent

After the Solver completes, launch the **Reviewer agent** to validate the fix independently.

```
You are the Reviewer in a debug war room. The Solver has implemented a
fix and your job is to verify it actually works, doesn't break anything
else, and is the right approach.

Working directory: [solver's worktree path]
Problem: [original problem statement]
Fix summary: [from FIX-SUMMARY.md]
Reproduction: [from REPRODUCTION.md]

## Review Checklist

### 1. Does the Fix Address the Root Cause?
- Read the fix diff carefully
- Does it fix the actual root cause, or just mask the symptom?
- Could the same bug recur in a different form?
- Is the fix in the right layer of abstraction?

### 2. Reproduction Verification (YOU MUST RUN THESE — do not list them for the user)
- EXECUTE the reproduction test — it should PASS now
- Run it multiple times if the bug was intermittent
- Try variations of the reproduction (different inputs, timing, config)
- Capture the actual output/logs as evidence

### 3. Regression Check (YOU MUST RUN THESE)
- EXECUTE the full test suite and capture results
- EXECUTE linting and type checking
- EXECUTE any build steps and verify success
- If the fix involves a running process (server, CLI tool, UI):
  launch it, exercise the fixed behavior, check logs, and capture
  evidence that it works

### 4. Live Verification (critical — tests passing is NECESSARY but NOT SUFFICIENT)

Tests verify code structure. Live verification proves the feature actually
works as experienced by a user. Many bugs exist in the gap between "all
tests pass" and "it actually works." Your job is to close that gap.

**Why this matters**: A test can assert that a function returns the right
value, but that doesn't prove the function gets called, its output reaches
the renderer, the renderer handles it correctly, and the user sees the
expected result. Each layer can silently fail while tests pass.

#### Automated Runtime Verification (always do these)
- If the fix involves a server/process: START it, EXERCISE the fixed
  behavior via curl/CLI/API calls, READ stdout/stderr, CAPTURE evidence
- If the fix involves CLI output: RUN the command, CAPTURE the output,
  COMPARE against expected output
- If the fix involves log output: RUN the code, READ the log file,
  CONFIRM expected entries appear
- If the fix involves a build: RUN the build, VERIFY the output artifact
  exists and contains expected content (grep/inspect the built files)
- If the fix involves configuration: LOAD the config, VERIFY the values
  propagate to where they're used at runtime (not just that the config
  file is correct)

#### Visual/Runtime Verification (when the bug has a visual or interactive component)

Some bugs only manifest visually — terminal rendering, UI display, image
output, interactive behavior. Tests can't catch these. You must verify
the actual rendered result.

**Techniques for visual verification:**

1. **Playwright/browser automation**: For web UIs, launch Playwright,
   navigate to the page, take a screenshot, and inspect the DOM. Check
   that elements are visible, correctly positioned, and contain expected
   content. This catches CSS bugs, rendering issues, and layout breaks
   that pass all unit tests.

2. **AppleScript + screenshot** (macOS): For native apps, CLI tools with
   visual output, or terminal-rendered content:
   ```
   # Launch the application via AppleScript
   osascript -e 'tell application "Terminal" to do script "your-command"'
   # Wait for it to render, then capture
   screencapture -x /tmp/verification-screenshot.png
   ```
   Then read the screenshot to verify the visual result.

3. **Process output capture**: For CLI tools and terminal UIs, run the
   command with output capture (script command, tee, or redirect) and
   inspect the raw output including ANSI codes, escape sequences, and
   control characters that affect rendering.

4. **Playwright for Electron/web-based tools**: Many modern tools
   (VS Code extensions, Electron apps, web dashboards) can be automated
   with Playwright. Use `browser_navigate`, `browser_snapshot`, and
   `browser_take_screenshot` to verify rendered state.

5. **ftm-browse ($PB) for UI verification**: If ftm-browse is
   installed, use it for visual verification of web UI bugs. First check
   whether the binary exists:
   ```bash
   PB="$HOME/.claude/skills/ftm-browse/bin/ftm-browse"
   ```
   If the binary exists at that path, use it:
   - **Navigate**: `$PB goto <url>` — open the affected page
   - **Before screenshot**: `$PB screenshot --path /tmp/debug-before.png`
     (capture state BEFORE verifying the fix is live, if you need a
     before/after comparison — do this before the fix is applied or on
     a pre-fix worktree)
   - **After screenshot**: `$PB screenshot --path /tmp/debug-after.png`
     (capture state AFTER fix is applied and running)
   - **DOM inspection**: `$PB snapshot -i` — get the interactive ARIA
     tree to verify element existence, visibility, and state
     (e.g., confirm a button is now visible, a panel is collapsed,
     an error message is gone)
   - Report both screenshot paths in REVIEW-VERDICT.md so the user
     can compare before/after visually.

   **Graceful fallback**: If the binary does NOT exist at
   `$HOME/.claude/skills/ftm-browse/bin/ftm-browse`, fall back to
   test-only and other available verification methods (Playwright, etc.).
   Do NOT fail the review. Record in the Verification Gate section:
   "Visual verification skipped — ftm-browse not installed."

**When to use visual verification:**
- Terminal rendering (status lines, TUI elements, colored output, unicode)
- Web UI changes (layout, styling, visibility, interaction)
- Image/PDF/document generation (verify output visually, not just file size)
- Any bug where "it looks wrong" was part of the symptom
- Any fix where tests pass but you're not 100% confident the user will
  see the correct result

**The rule**: If the bug was reported as something the user SAW (or didn't
see), verification must confirm what the user will SEE (or will now see).
Passing tests are evidence, not proof. Visual confirmation is proof.

#### Never Do This
- NEVER write "How to verify: run X" — instead, RUN X yourself and
  report what happened
- NEVER say "restart the app to see the change" — restart it yourself,
  observe the result, report back
- NEVER assume tests passing = feature working. Tests verify code paths.
  Live verification proves the feature delivers its intended experience.

### 5. Code Quality
- Is the fix minimal and focused?
- Does it follow the project's existing patterns?
- Are there edge cases the fix doesn't handle?
- Is error handling appropriate (not excessive, not missing)?

### 6. Observability
- Will this failure mode be visible if it happens again?
- Should any permanent logging or monitoring be added?
- Are there metrics or alerts that should be updated?

## Mandatory Verification Gate

Before writing the verdict, answer these two questions:

**Q1: Was the bug reported as something visual/experiential?**
(Did the user say "it doesn't show up", "it looks wrong", "the UI is broken",
"nothing happens when I click", "the output is garbled", etc.)

If YES → Visual verification is REQUIRED. You cannot approve without
capturing a screenshot, reading rendered output, or observing the
running application. Grep checks and log analysis are not sufficient.

If NO → Automated runtime verification (running tests, checking output)
is sufficient.

**Q2: Does the fix require restarting a process to take effect?**
(Patching a bundle, changing config loaded at startup, modifying
compiled artifacts, etc.)

If YES → YOU must restart the process, observe the result, and capture
evidence. Do not tell the user to restart — do it yourself:
```
# Example: restart a CLI tool and capture its output
osascript -e 'tell application "Terminal" to do script "cd /path && your-command"'
sleep 3
screencapture -x /tmp/verification-screenshot.png
# Then READ the screenshot to verify
```

If you cannot restart the process (e.g., it's the very tool you're
running inside), this is one of the rare legitimate cases to ask the
user — but you MUST say what specific thing to look for and why you
couldn't verify it yourself.

## Output Format

Write a file called `REVIEW-VERDICT.md` with:

### Verdict: [APPROVED / APPROVED WITH CHANGES / NEEDS REWORK]

### Verification Gate
- Bug is visual/experiential: [YES/NO]
- Fix requires process restart: [YES/NO]
- Visual verification performed: [YES — describe what was captured / NO — explain why not required / BLOCKED — explain why agent couldn't do it]

### Fix Verification
- Reproduction test: [PASS/FAIL — actual output]
- Full test suite: [PASS/FAIL with details]
- Build: [PASS/FAIL]
- Lint/typecheck: [PASS/FAIL]
- Runtime verification: [what was run, what was observed]
- Visual verification: [screenshot path, DOM snapshot, or rendered output captured — or N/A with reason]

### Code Review Notes
- [specific observations, line references]

### Concerns
- [anything that needs attention]

### Recommended Follow-ups
- [monitoring, tests to add, documentation to update]
```

If the Reviewer says **NEEDS REWORK**, send the feedback back to the Solver agent for another iteration. The Solver-Reviewer loop continues until the verdict is APPROVED (max 3 iterations — after that, escalate to the user with full context of what's been tried).

---

### Phase 4: Present Results

**CHECKPOINT: Before presenting, confirm these are true:**
- [ ] A Reviewer agent was spawned (not just the Solver declaring victory)
- [ ] The Reviewer's verdict includes actual evidence (output captures,
      screenshots, log snippets — not just "PASS")
- [ ] If the bug was visual, visual evidence was captured
- [ ] If the fix required a restart, the restart happened and post-restart
      behavior was verified
- [ ] No "How to Verify" or "Restart X to see the change" instructions
      are included in the presentation

If any of these are false, you are not ready to present. Go back to Phase 3.

Once the Reviewer approves, present the full results to the user:

```
## Debug War Room Complete

### Root Cause
[One paragraph explaining what was wrong — clear enough that someone
unfamiliar with the code would understand]

### What Changed
[List of files modified with brief descriptions]

### Verification Already Performed
[These are things the Reviewer ALREADY RAN — not suggestions for the
user to do. Include actual output/evidence.]
- Reproduction test: PASS — [actual output snippet]
- Full test suite: PASS — [X tests passed, 0 failures]
- Build: PASS
- Runtime verification: [command run, output captured, expected vs actual]
- Visual verification (if applicable): [what was launched, screenshot/DOM
  evidence, what the user will see — this closes the gap between "tests
  pass" and "it actually works"]
- Reviewer verdict: APPROVED

### Key Findings
- [Top research findings that informed the fix]
- [Instrumentation insights that revealed the bug]
- [Hypotheses that were tested, including ones that were wrong — these
  help the user's understanding]

### Commits (in worktree: [branch name])
[List of commits with messages]

Ready to merge. All automated verification has passed.
```

**Do NOT include a "How to Verify Yourself" section with manual steps.** If there is any verification that can be automated, the Reviewer must have already done it. The only reason to mention verification steps to the user is if something genuinely requires human judgment (visual design review, business logic confirmation) — and even then, explain what the agents already checked and what specifically needs a human eye.

Wait for the user to validate. Once they confirm:

1. Merge the solver's worktree branch to main
2. Clean up all worktrees and branches
3. Remove any remaining debug instrumentation (unless the user wants to keep it)

---

## Agent Selection Guide

Not every bug needs all agents. Here's when to scale down:

| Bug Type | Skip These | Keep These |
|----------|-----------|------------|
| Pure logic error (wrong output) | Instrumenter | Researcher, Reproducer, Hypothesizer, Solver, Reviewer |
| Race condition / timing | — (use all) | All — timing bugs are the hardest |
| Known library bug (error message is googleable) | Hypothesizer | Researcher (primary), Solver, Reviewer |
| UI rendering glitch | Researcher (maybe) | Instrumenter (critical), Reproducer, Hypothesizer, Solver, Reviewer (with visual verification!) |
| Terminal/CLI visual output | Researcher (maybe) | Instrumenter, Reproducer, Hypothesizer, Solver, Reviewer (with visual verification!) |
| Build / config issue | Reproducer | Researcher (check migration guides), Hypothesizer, Solver, Reviewer |
| Intermittent / flaky | — (use all) | All — flaky bugs need every angle |
| Performance regression | Researcher | Instrumenter (profiling), Reproducer (benchmark), Hypothesizer, Solver, Reviewer |

When in doubt, use all of them. The cost of a redundant agent is some compute time. The cost of missing the right angle is another hour of debugging.

## Worktree Strategy

Every agent that makes code changes gets its own worktree:

```
.worktrees/
  debug-instrumentation/     (Instrumenter's logging)
  debug-reproduction/        (Reproducer's test cases)
  debug-fix/                 (Solver's fix attempts)
```

Branch naming: `debug/<problem-slug>/<agent-role>`

Example: `debug/esm-crash/instrumentation`, `debug/esm-crash/fix`

This means:
- Every experiment is isolated and can be kept or discarded
- The Solver can have multiple fix attempts on separate branches
- The Reproducer's test stays clean from fix changes
- You can diff any agent's work against main to see exactly what they did
- **Commit after every meaningful change** — if a fix attempt fails, the commit history shows exactly what was tried

Ensure `.worktrees/` is in `.gitignore`.

After the fix is approved and merged, clean up all debug worktrees and branches.

## Escalation

If after 3 Solver-Reviewer iterations the fix still isn't approved:

1. Present everything to the user: all hypotheses tested, all fix attempts, all review feedback
2. Ask the user for direction — they may have context that wasn't available to the agents
3. If the user provides new information, restart from Phase 1 with the new context
4. If the user wants to pair on it, switch to interactive debugging with all the instrumentation and research already done as context

The war room is powerful but not omniscient. Sometimes the bug requires domain knowledge only the user has. The goal is to do 90% of the work so the user's intervention is a focused 10%.

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing root cause, hypotheses tested, fix approach, and what to check first next time
3. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `task_completed` event

## Anti-Pattern: Asking the User to Do Agent Work

This is the single most important rule of the war room: **never ask the user to perform a verification step that an agent could perform**.

Examples of violations:
- "Restart the application and check if the doom head appears" — an agent can launch the app, capture a screenshot, read the output, verify the rendering
- "Run `tail -f /tmp/debug.log` and look for entries" — an agent can read that file
- "Open a browser and check the UI" — an agent can use Playwright/Puppeteer to screenshot and inspect the DOM
- "Try running this command and let me know what happens" — an agent can run the command
- "All 103 tests pass!" without verifying the actual feature works — tests are a proxy, not proof. The agent must also verify runtime behavior matches expectations

Examples of legitimate user asks:
- "Does this visual design match what you wanted?" — subjective human judgment
- "Is this the business logic you intended?" — domain knowledge only the user has
- "Should we merge this to main?" — permission/authority decision

When in doubt: if it can be executed by running a command, reading a file, or checking output, an agent does it. The user reviews the evidence the agent collected, not the raw behavior.

## Anti-Pattern: Collapsing Solver and Reviewer Into One

A common failure mode: the session reads this skill, does good investigation work, writes a fix, then presents results directly to the user — skipping the Reviewer agent entirely. The Solver says "Restart X to see the change" and declares victory.

This defeats the entire verification system. The Solver is biased toward their own fix. They wrote the code and believe it works. The Reviewer exists as an independent check.

**The rule**: After the Solver commits their fix, you MUST spawn a separate Reviewer agent. The Reviewer reads FIX-SUMMARY.md, runs the verification gate, and either approves or sends it back. Only after the Reviewer approves do you present results to the user.

If you find yourself writing "Root Cause / What Changed / How to Verify" without having spawned a Reviewer — stop. You're doing the anti-pattern. Spawn the Reviewer.

## Anti-Pattern: Structural Verification Masquerading as Live Verification

Another common failure: the session verifies the fix by grepping the patched file for expected strings, checking that function references exist, or confirming config values are set. This is structural verification — it proves the code was written, not that it works.

Example of structural verification pretending to be live:
```
✓ grep -c "doom_status patch start" cli.js → 1
✓ grep -c "doomStatuslineBackend" cli.js → 6
✓ node -e "require('cli.js')" → parses
```

This proves the patch was applied and the file isn't syntactically broken. It does NOT prove the doom head renders visually. The grep checks are necessary but they are Phase 3 Step 3 (regression checks), not Phase 3 Step 4 (live verification).

Live verification for this bug would be: launch Claude Code, wait for the statusline to render, capture a screenshot, confirm the doom head is visible. That's what the Reviewer must do for visual bugs.

## Requirements

- config: `~/.claude/ftm-config.yml` | optional | model profiles for investigation agents
- reference: `references/protocols/BLACKBOARD.md` | required | blackboard read/write protocol
- reference: `references/protocols/EDGE-CASES.md` | required | anti-patterns and fallback handling
- reference: `references/phases/PHASE-0-INTAKE.md` | required | intake steps and Explore agent prompt
- reference: `references/phases/PHASE-1-TRIAGE.md` | required | agent selection guide and worktree strategy
- reference: `references/phases/PHASE-2-WAR-ROOM-AGENTS.md` | required | all four agent prompts
- reference: `references/phases/PHASE-3-TO-6-EXECUTION.md` | required | synthesis, solver, reviewer prompts
- tool: `git` | required | worktree creation, diff inspection, commit history
- reference: `~/.claude/ftm-state/blackboard/context.json` | optional | session state
- reference: `~/.claude/ftm-state/blackboard/experiences/index.json` | optional | past bug fixes and known issues
- reference: `~/.claude/ftm-state/blackboard/patterns.json` | optional | recurring failure patterns

## Risk

- level: medium_write
- scope: creates git worktrees for investigation and fix branches; modifies source files in Solver agent worktree; merges fix after Reviewer approval
- rollback: git worktree remove + git branch -D for debug/* worktrees; all fix changes isolated until user confirms merge

## Approval Gates

- trigger: investigation plan formulated in Phase 0 | action: present plan to user and proceed unless user objects
- trigger: Solver produces fix | action: Reviewer agent must independently verify before presenting to user (hard gate — cannot skip)
- trigger: Reviewer APPROVED | action: present root cause + changes + evidence to user, wait for user confirmation before merging
- trigger: Solver NEEDS REWORK after 3 attempts | action: escalate to user with full context, wait for direction
- complexity_routing: micro → auto | small → auto | medium → plan_first | large → plan_first | xl → always_ask

## Fallbacks

- condition: Instrumenter agent fails or produces no useful output | action: skip instrumentation worktree, proceed with remaining agents
- condition: Reproducer cannot create a minimal failing test | action: note as "reproduction failed", proceed with hypothesis-only approach
- condition: Researcher finds no relevant issues or docs | action: proceed with instrumentation and hypothesis findings only
- condition: fix still failing after 3 Solver iterations | action: escalate to user with all hypotheses tested and evidence gathered
- condition: project has no test suite | action: Reviewer uses build check + diff review + live runtime verification instead of test runner

## Capabilities

- cli: `git` | required | worktree isolation for investigation agents
- mcp: `sequential-thinking` | optional | complex multi-hypothesis analysis
- mcp: `playwright` | optional | visual bug verification in Reviewer phase
- mcp: `WebSearch` | optional | Researcher agent for GitHub issues and Stack Overflow
- mcp: `WebFetch` | optional | Researcher agent for docs and changelogs

## Event Payloads

### bug_fixed
- skill: string — "ftm-debug"
- root_cause: string — one-sentence root cause description
- fix_approach: string — description of the fix applied
- worktree: string — path to fix worktree
- iterations: number — number of solver-reviewer cycles needed
- duration_ms: number — total war room duration

### issue_found
- skill: string — "ftm-debug"
- phase: string — "phase1" | "phase2"
- agent: string — "instrumenter" | "researcher" | "reproducer" | "hypothesizer"
- finding: string — description of the specific issue found
- confidence: string — high | medium | low

### test_passed
- skill: string — "ftm-debug"
- scope: string — "reproduction" | "full_suite"
- worktree: string — worktree path where tests ran

### test_failed
- skill: string — "ftm-debug"
- scope: string — "reproduction" | "full_suite"
- worktree: string — worktree path
- error_summary: string — brief failure description

### error_encountered
- skill: string — "ftm-debug"
- phase: string — war room phase where error occurred
- agent: string | null — agent that encountered the error
- error: string — error description

### task_completed
- skill: string — "ftm-debug"
- outcome: string — "fixed" | "escalated" | "unresolved"
- root_cause: string — root cause if found
- duration_ms: number — total session duration
