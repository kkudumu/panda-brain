---
name: ftm-intent
description: Manages the hierarchical INTENT.md documentation layer — root index with architecture decisions and module map, plus per-module INTENT.md files with function-level entries (does/why/relationships/decisions). Use when creating or updating intent documentation, bootstrapping a new project's intent layer, or when user says "update intent", "document intent", "ftm-intent", "what does this function do". Auto-invoked by ftm-executor after every commit to keep intent documentation in sync with code changes.
---

## Events

### Emits
- `documentation_updated` — when one or more INTENT.md files are written or modified to reflect new or changed code
- `task_completed` — when the full intent sync pass completes (bootstrap or incremental)

### Listens To
- `code_committed` — fast-path: automatically sync INTENT.md entries for every changed function after each commit

# Intent Documentation Manager

Manages the hierarchical INTENT.md documentation layer. This is the contract layer that Codex reads during code review and that enables conflict detection between Claude's intent and Codex's fixes. The "Why" field is what prevents Codex from reverting deliberate design choices.

## Graph-Powered Mode (ftm-map integration)

Before running the standard analysis, check if the project has a code knowledge graph:

```bash
if [ -f ".ftm-map/map.db" ]; then
    # Use graph for faster, more consistent analysis
    ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/views.py generate-intent "$PROJECT_ROOT"
else
    # Fall back to standard file-by-file analysis below
fi
```

When `.ftm-map/map.db` exists:
1. Delegate to `views.py generate-intent` which reads the graph and produces INTENT.md files
2. The graph path is faster (single DB query vs. reading every file) and more consistent (same analysis for every commit)
3. Supports `--files` flag for incremental: `views.py generate-intent --files changed1.ts,changed2.py`

When `.ftm-map/map.db` does NOT exist:
- Fall back to the existing Bootstrap/Incremental modes below
- The behavior is identical to the current skill — no breaking change

This integration means ftm-intent automatically gets better when ftm-map is available, without requiring migration.

## Two Modes of Operation

### Bootstrap Mode (no INTENT.md exists)
Scan the codebase from scratch and create the full hierarchy.

1. Use Glob to discover all source files and identify module boundaries
2. Use Read/Grep to understand key functions in each module
3. Create root INTENT.md at the project root
4. Create per-module INTENT.md files for each module directory
5. Populate all entries based on what the code actually does

### Incremental Mode (INTENT.md already exists)
Read the current state and update only what changed.

1. Read root INTENT.md and all relevant module INTENT.md files
2. Identify what's missing: new functions without entries, new modules without INTENT.md
3. Identify what's stale: entries for deleted or renamed functions
4. Update only the affected entries and module map rows — do not regenerate from scratch

## Root INTENT.md Template

Create at the project root. This is the "subway map" — high level routing to module detail.

```markdown
# [Project Name] — Intent

## Vision
[2-3 sentence summary of what this project does and why it exists]

## Architecture Decisions
| Decision | Choice | Reasoning |
|---|---|---|
| [decision point] | [what was chosen] | [why this was chosen over alternatives] |

## Module Map
| Module | Purpose | Key Relationships |
|---|---|---|
| [path/to/module] | [what this module does in one sentence] | [depends on X / depended by Y] |

## Cross-Cutting Decisions
- [pattern name]: [what it is and why it applies everywhere]
```

**Rules for root INTENT.md:**
- Vision: Written once, updated only if the project's purpose changes
- Architecture Decisions: Add a row every time a non-obvious architectural choice is made
- Module Map: Add a row when a new module directory is created; remove when deleted; must stay in sync with actual filesystem
- Cross-Cutting Decisions: Patterns that apply across 3+ modules (error handling strategy, auth approach, data fetching pattern, etc.)

## Per-Module INTENT.md Template

Create inside each module directory (e.g., `src/auth/INTENT.md`). This is the "street map" — ground level function detail.

```markdown
# [Module Name] — Intent

## Functions

### functionName(param1: Type, param2: Type) → ReturnType
- **Does**: [one sentence — what it does, not how]
- **Why**: [why this function exists, what problem it solves, why this approach over alternatives]
- **Relationships**: [calls X, called by Y, reads from Z store, mutates W]
- **Decisions**: [deliberate choices that might look wrong to an outside reviewer — "uses polling instead of websockets because..."]

### anotherFunction(param: Type) → ReturnType
- **Does**: ...
- **Why**: ...
- **Relationships**: ...
- **Decisions**: ...
```

**Rules for per-module INTENT.md:**
- Every exported function MUST have an entry
- Every entry MUST have all four fields (Does / Why / Relationships / Decisions)
- If there are no deliberate decisions, write "None" in the Decisions field — do not omit the field
- Include the full function signature with types — this helps with quick lookup and makes entries grep-able
- Keep each field to one sentence. This is a contract, not prose documentation.

## When to Update

| Event | Action |
|---|---|
| New function created | Add entry to module's INTENT.md |
| Function behavior changed | Update Does / Why / Decisions fields |
| Function deleted | Remove entry from module's INTENT.md |
| New module directory created | Create module INTENT.md + add row to root module map |
| Module deleted | Remove module INTENT.md + remove row from root module map |
| Architecture decision made | Add row to root INTENT.md decisions table |
| Cross-cutting pattern established | Add entry to root Cross-Cutting Decisions section |

## The Why Field — Most Important

The "Why" field is what makes this system valuable. It is the explicit record of deliberate choices that might look like bugs or inefficiencies to a reviewer who wasn't there when the decision was made.

Good Why entries:
- "Exists because the provider SDK doesn't expose a batch endpoint — each call must be sequential"
- "Uses pessimistic locking instead of optimistic because this resource has high write contention in production"
- "Fetches on every render instead of caching because this data changes in real time and stale reads cause downstream errors"

Bad Why entries:
- "Needed for the feature to work"
- "Required by the system"
- "Called by the auth flow"

If you can't write a clear Why, it means the original reasoning wasn't captured. Try to infer it from surrounding code, comments, or git history. If it's truly unknown, write "Why unknown — inferred from usage: [your inference]".

## Format Contract

Codex reads INTENT.md files during code review to detect conflicts between stated intent and proposed changes. For this to work, the format must be consistent.

**Required format — do not deviate:**
- Section header: `### functionName(params) → ReturnType`
- Four bullet fields in order: `- **Does**:`, `- **Why**:`, `- **Relationships**:`, `- **Decisions**:`
- No prose paragraphs inside function entries
- No nested bullets inside a field — one sentence per field, always

If a function is complex enough that one sentence isn't enough, the function is probably doing too much. Document what it does at the boundary level, not the implementation level.

## Discovery Commands

Use these to find what needs to be documented:

- Find all module directories: `Glob("src/**/")` or `Glob("lib/**/")`
- Find existing INTENT.md files: `Glob("**/INTENT.md")`
- Find all exported functions in a module: `Grep("^export (function|const|async function)", path="src/module/")`
- Find functions called by a specific function: read the function body and trace calls
- Find what calls a specific function: `Grep("functionName", type="ts")` or equivalent

## Bootstrap Execution Order

When creating the intent layer from scratch:

1. Read the project root README or package.json to understand the project vision
2. Run `Glob("src/**/")` (or equivalent for the project structure) to discover modules
3. For each module, read key files to understand what functions exist and what they do
4. Draft root INTENT.md — vision, then module map (one row per module), then architecture decisions from what you observed, then cross-cutting patterns
5. For each module, draft module INTENT.md — one entry per exported function
6. Write all files
7. Report: list of files created, count of functions documented, any functions where Why was unclear

## Incremental Execution Order

When updating after changes:

1. Read root INTENT.md
2. Read the INTENT.md for affected modules (or all modules if unsure what changed)
3. Compare against current code — use Grep to find functions that don't have entries, entries that don't have corresponding functions
4. Write updates — add missing entries, remove stale entries, update changed fields
5. If new modules were added, create their INTENT.md and add rows to root module map
6. Report: list of files updated, entries added, entries removed, entries modified

---

### Auto-Invocation by ftm-executor

This skill's format is used by ftm-executor's documentation pipeline. After every commit during plan execution, agents update INTENT.md (or DIAGRAM.mmd) entries following this skill's templates. The updates are automatic and don't require explicit skill invocation — agents reference the format directly.

## Requirements

- reference: `.ftm-map/map.db` | optional | SQLite knowledge graph for accurate intent generation (graph-powered mode)
- tool: `ftm-map/scripts/.venv/bin/python3` | optional | Python runtime for graph-powered views.py
- reference: `package.json` | optional | project vision and structure detection for bootstrap
- reference: existing `**/INTENT.md` files | optional | current state for incremental updates

## Risk

- level: low_write
- scope: writes INTENT.md files in project directories; only creates or modifies INTENT.md documentation files; does not touch source code files
- rollback: git checkout on modified INTENT.md files; delete newly created INTENT.md files

## Approval Gates

- trigger: bootstrap mode — about to create multiple INTENT.md files | action: report count of files to be created and modules to be documented, proceed unless user objects
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: .ftm-map/map.db not found | action: fall back to standard Glob/Grep analysis for function discovery
- condition: Python venv not set up | action: fall back to standard analysis, log "Graph-powered mode unavailable — run ftm-map to enable"
- condition: no README or package.json for Vision section | action: infer project vision from directory structure and module names

## Capabilities

- cli: `ftm-map/scripts/.venv/bin/python3` | optional | graph-powered intent generation
- mcp: `git` | optional | detect changed files for incremental sync

## Event Payloads

### documentation_updated
- skill: string — "ftm-intent"
- files_written: string[] — absolute paths to INTENT.md files created or modified
- functions_added: number — new function entries documented
- functions_updated: number — existing entries updated
- functions_removed: number — stale entries removed

### task_completed
- skill: string — "ftm-intent"
- mode: string — "bootstrap" | "incremental"
- files_count: number — total INTENT.md files written
- duration_ms: number — total documentation sync duration
