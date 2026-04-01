# Complexity Sizing

Size the task from observed evidence, not vibes.

## Micro

`just do it`

Signals:

- one coherent local action
- trivial blast radius
- rollback is obvious
- no meaningful uncertainty
- no dedicated verification step needed

Typical examples:

- rename a variable
- fix a typo
- answer a factual question after one read
- add an import
- tweak a comment

## Small

`do + test`

Signals:

- 1-3 files
- one concern
- clear done state
- at least one verification step is warranted
- still reversible without planning overhead

Typical examples:

- implement a simple helper
- patch a bug in one area
- add or update a focused test
- update docs plus one code path

## Medium

`lightweight plan`

Signals:

- multiple changes with ordering
- moderate uncertainty
- multi-file or multi-step
- a bug or feature spans layers but not a full program of work
- benefits from an explicit short plan before execution

**Forced medium escalation** — if ANY of these are true, the task is medium at minimum regardless of how simple it feels:

- touches more than 3 files
- modifies automation, CI/CD, or infrastructure code
- involves external system changes (Jira, Slack, Freshservice, calendar, email)
- requires coordinating with other people (drafting messages, checking with stakeholders)
- changes routing, integration, or cross-system references (API endpoints, project keys, board IDs)
- the codebase being changed is unfamiliar or hasn't been read yet this session
- the task involves both code changes AND communication/coordination
- **calls any production API that creates, updates, or deletes resources** (Okta, Freshservice, AWS, any external service with real consequences)

The reason forced escalation exists: tasks that touch external systems or multiple files feel simple in the moment but have hidden ordering dependencies, stakeholder coordination needs, and blast radius that only becomes visible after you've already started grinding. A 2-minute plan catches these. Grinding without one wastes the user's time when you go in the wrong direction.

**The Hindsight incident**: In March 2026, a task that "felt small" — set up SSO for Hindsight — resulted in autonomous creation of Okta groups in production, user assignments, Freshservice records, a service catalog item, and S3 config changes. The model never presented a plan. It never asked for approval on any phase. It just researched and executed. This is exactly what forced escalation prevents. If the task will call APIs that modify production state, it is medium. Full stop.

Typical examples:

- fix a flaky test with several hypotheses
- add UI + API + tests for one feature
- refactor a module with dependent updates
- reroute an automation from one Jira project to another
- update references across a codebase after a system migration
- change API integration endpoints or credentials

## Large

`brainstorm + plan + executor`

Signals:

- cross-domain work
- major uncertainty or architectural choice
- a plan document already exists
- many files or multiple independent workstreams
- would benefit from orchestration, parallel execution, or audit passes

Typical examples:

- build a feature from scratch
- implement a long plan doc
- re-architect a subsystem

## Boundary: where micro ends and small begins

Micro ends the moment any of these become true:

- more than one meaningful edit is required
- a test or build check is needed to trust the change
- the correct change is not self-evident
- the blast radius is larger than the immediate line or local block

That is the boundary. If it needs verification or carries plausible regression risk, it is at least small.

## Boundary: where small ends and medium begins

Small ends the moment any of these become true:

- more than 3 files will be touched
- external systems are involved (Jira, Slack, email, calendar, Freshservice, APIs)
- the task requires reading and understanding unfamiliar code before changing it
- changes span multiple concerns (code + communication, automation + configuration)
- there are ordering dependencies between the changes
- the user mentioned coordination with other people
- the change affects routing, integration points, or cross-system references

That is the boundary. If external systems are involved or the user needs to see the plan before you execute, it is at least medium. This boundary is not optional — do not downsize past it.

## ADaPT rule

Try the simpler tier first — but never downsize past a forced boundary.

- If it looks small and no forced-medium signals are present, start small.
- If it looks medium and no forced-large signals are present, try medium.
- If it looks large, ask whether a medium plan-plus-execute path is enough before invoking full orchestration.

**Critical constraint**: ADaPT allows you to *start* at a simpler tier and escalate if needed. It does NOT allow you to skip the plan approval gate when `approval_mode` is `plan_first` and forced escalation signals are present. If forced-medium signals fired during sizing, you must present a plan — ADaPT cannot override that.

Escalate when:

- the simple approach fails
- the user explicitly asks for the larger workflow
- the complexity is obvious from the start
- forced escalation signals are present (see Medium and Large sections above)
