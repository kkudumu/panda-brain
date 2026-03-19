# Complexity Sizing Guide

Orient must size tasks from observed evidence, not vibes. Use these tiers.

---

## Micro — `just do it`

**Signals:**
- one coherent local action
- trivial blast radius
- rollback is obvious
- no meaningful uncertainty
- no dedicated verification step needed

**Typical examples:**
- rename a variable
- fix a typo
- answer a factual question after one read
- add an import
- tweak a comment

---

## Small — `do + test`

**Signals:**
- 1-3 files
- one concern
- clear done state
- at least one verification step is warranted
- still reversible without planning overhead

**Typical examples:**
- implement a simple helper
- patch a bug in one area
- add or update a focused test
- update docs plus one code path

---

## Medium — `lightweight plan`

**Signals:**
- multiple changes with ordering
- moderate uncertainty
- multi-file or multi-step
- a bug or feature spans layers but not a full program of work
- benefits from an explicit short plan before execution

**Typical examples:**
- fix a flaky test with several hypotheses
- add UI + API + tests for one feature
- refactor a module with dependent updates

---

## Large — `brainstorm + plan + executor`

**Signals:**
- cross-domain work
- major uncertainty or architectural choice
- a plan document already exists
- many files or multiple independent workstreams
- would benefit from orchestration, parallel execution, or audit passes

**Typical examples:**
- build a feature from scratch
- implement a long plan doc
- re-architect a subsystem

---

## Boundary: where micro ends and small begins

Micro ends the moment any of these become true:

- more than one meaningful edit is required
- a test or build check is needed to trust the change
- the correct change is not self-evident
- the blast radius is larger than the immediate line or local block

If it needs verification or carries plausible regression risk, it is at least small.

---

## ADaPT Rule

Try the simpler tier first.

- If it looks small, start small.
- If it looks medium, see whether a small direct pass resolves it.
- If it looks large, ask whether a medium plan-plus-execute path is enough before invoking full orchestration.

Escalate only when:
- the simple approach fails
- the user explicitly asks for the larger workflow
- the complexity is obvious from the start

---

## Research Tasks

Research tasks don't follow the micro/small/medium/large sizing — they route directly
to ftm-researcher regardless of complexity. The researcher's mode system (quick/standard/deep)
handles the depth calibration internally.

If a research request also implies implementation ("research X and then build it"),
orient as a multi-phase workflow: research first (ftm-researcher), then plan (ftm-brainstorm
or direct), then execute (ftm-executor).
