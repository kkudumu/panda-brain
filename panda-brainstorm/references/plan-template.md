# Plan Generation Template

Load this file only when the user approves moving to Phase 3 (plan generation).

## Present Incrementally

Do NOT dump the entire plan in one message. Present section by section:

1. **Vision + Architecture Decisions** — ask: "Does this foundation look right?"
2. **Task Breakdown** — ask: "Any tasks missing, or should any be split/merged?"
3. **Agent Team + Execution Order** — ask: "Good to save it?"

Only save after all three sections are approved.

## Plan Document Structure

```markdown
# [Project/Feature Name] — Implementation Plan

## Vision
[2-3 sentence summary of what we're building and why, grounded in research findings]

## Key Research Findings
- [Most important patterns/decisions discovered, with source links]
- [Each finding that materially influenced the plan]

## Architecture Decisions
[Major technical choices and the reasoning behind each — reference the research turn where evidence was found]

## Tasks

### Task N: [Title]
**Description:** [What needs to be built]
**Files:** [Expected files to create/modify — use ACTUAL project paths from Phase 0]
**Dependencies:** [Which tasks must complete first, or "none"]
**Agent type:** [frontend-developer, backend-architect, etc.]
**Acceptance criteria:**
- [ ] [Specific, testable criterion]
- [ ] [Another criterion]
**Hints:**
- [Relevant research finding with source URL]
- [Known pitfall from research: "Watch out for Z — see [link]"]
- [If brain dump: novelty verdict — "Already solved by [tool]" or "Novel — no prior art"]
**Wiring:**
  exports:
    - symbol: [ExportedName]
      from: [file path]
  imported_by:
    - file: [parent file that should import this]
  rendered_in:
    - parent: [ParentComponent]
      placement: "[where in parent JSX]"
  route_path: [/path]
  nav_link:
    - location: [sidebar|navbar|menu]
      label: "[Display text]"

## Agent Team
| Agent | Role | Tasks |
|-------|------|-------|
| [type] | [what they handle] | [task numbers] |

## Execution Order
- **Wave 1 (parallel):** Tasks [X, Y, Z] — no dependencies
- **Wave 2 (parallel, after wave 1):** Tasks [A, B] — depend on wave 1
- **Wave 3:** Task [C] — integration/final assembly
```

## Wiring Contract Rules

Auto-populate the `Wiring:` block based on file type:

- **New component** (.tsx/.vue/.svelte): exports (component name), imported_by (parent), rendered_in (where in JSX), route_path (if page)
- **New hook** (use*.ts): exports (function), imported_by (consuming components)
- **New API function** (api/*.ts): exports (functions), imported_by (hooks/components calling them)
- **New store/state**: store_reads (which components read), store_writes (which write)
- **New route/view**: route_path, nav_link (where navigation appears), rendered_in (router config)

## Hints Population

For each task, pull from the cumulative research register:

1. **Web Researcher findings** — blog posts, case studies, patterns (include URL)
2. **GitHub Explorer findings** — repos that solved similar problems (include URL + what's useful)
3. **Competitive Analyst findings** — products to learn from or differentiate against
4. **Brain dump novelty map** (Path B): solved/partially solved/novel verdicts
5. **Pitfalls** — warnings from any research turn

Rules:
- Always include source links
- 2-4 bullets per task, not paragraphs
- "No specific research findings for this task" if nothing applies
- Hints are suggestions, not mandates

## Quality Rules

- Tasks small enough for one agent session
- Every task has testable acceptance criteria
- Dependencies explicit — no implicit ordering
- Agent assignments match domain
- Wave structure maximizes parallelism
- File paths reference ACTUAL project structure from Phase 0
- Leverage existing project patterns (don't reinvent)

## Save Location

```
~/.claude/plans/[project-name]-plan.md
```

Create `~/.claude/plans/` if needed.

## Handoff Prompt

After saving, give the user:

```
/panda-executor ~/.claude/plans/[project-name]-plan.md
```

Plus a summary: "[N] tasks across [M] agents in [W] waves. First wave starts immediately with [list]. Scope: [small/medium/large]."
