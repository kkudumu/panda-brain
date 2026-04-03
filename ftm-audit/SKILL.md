---
name: ftm-audit
description: Triple-layer wiring audit that verifies all code is actually connected to the running application and documented in INTENT.md. Combines static analysis (knip), documentation coverage checking (INTENT.md entries for every changed function), and adversarial LLM audit — auto-fixes anything it finds. Use when user says "audit", "wiring check", "verify wiring", "dead code", "check imports", "unused code", "find dead code", "audit wiring", "check docs", or "documentation coverage". Also auto-invoked by ftm-executor after each task.
---

## Events

### Emits
- `audit_complete` — when all three audit layers finish and the final changelog is produced
- `issue_found` — when Layer 1 (knip) or Layer 2 (adversarial audit) identifies an unwired or dead-code problem
- `task_completed` — when an audit-initiated fix cycle finishes and the audited scope is verified clean

### Listens To
- `code_committed` — run post-commit verification: trigger Layer 1 and Layer 2 against the committed diff
- `review_complete` — validate that review findings align with static analysis results; flag discrepancies

## Blackboard Read

Before starting, load context from the blackboard:

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by task_type="test" or tags matching "audit" or "wiring"
3. Load top 3-5 matching experience files for commonly found issues and effective fix strategies
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check recurring_issues for common wiring failures and execution_patterns for what types of code changes need more scrutiny

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# FTM Audit — Wiring Verification

Three-layer verification system: knip for import-graph dead code, LLM adversarial trace for semantic wiring, and auto-fix with changelog.

## Why This Exists

Code that compiles but isn't wired into the running application is worse than code that doesn't compile — it silently wastes space, confuses readers, and creates false confidence. This skill catches unwired code through two complementary lenses and fixes it automatically.

## Phase 0: Detect Project Patterns

Before running any checks, scan the project to calibrate which wiring dimensions apply and how to check them. This takes seconds and prevents false positives from applying React patterns to a Vue project (or Next.js App Router patterns to a Pages Router project).

**Read `package.json` and check for:**

| Signal | Detection | Impact on Audit |
|---|---|---|
| **Framework** | `react`, `next`, `vue`, `svelte`, `angular` in deps | Determines which dimensions are relevant |
| **Router** | `react-router-dom`, `@tanstack/react-router`, `next` (file-based), `vue-router` | Changes how Dimension 3 (Route Registration) works |
| **State management** | `zustand`, `@reduxjs/toolkit`, `pinia`, `jotai`, `recoil` | Changes how Dimension 4 (Store Consumption) works |
| **API layer** | `@tanstack/react-query`, `swr`, `trpc`, `@apollo/client`, `axios` | Changes how Dimension 5 (API Invocation) works |
| **Build tool** | `vite`, `next`, `webpack`, `turbopack` | Affects knip entry point detection |

**Quick file checks:**

- `next.config.*` exists → Next.js project. Check for `app/` directory (App Router) vs `pages/` (Pages Router). This completely changes route checking.
- `vite.config.*` exists → Vite project. Entry point is usually `index.html` → `src/main.tsx`.
- `app/layout.tsx` or `app/page.tsx` exists → Next.js App Router. Routes are file-based (`app/dashboard/page.tsx` = `/dashboard`). No router config file to check — Dimension 3 checks directory structure instead.
- `src/router.*` or `src/routes.*` exists → Explicit router config. Dimension 3 checks this file.

**Framework-specific dimension adjustments:**

| Framework | D1 (Import) | D2 (JSX) | D3 (Routes) | D4 (Store) | D5 (API) |
|---|---|---|---|---|---|
| React + react-router | Standard | Standard | Check router config file | Standard | Standard |
| Next.js App Router | Check `app/` tree | Standard | File-based: `page.tsx` in directory = route | Standard | Check for Server Actions too |
| Next.js Pages Router | Check `pages/` tree | Standard | File-based: `pages/foo.tsx` = `/foo` | Standard | Check `getServerSideProps`/`getStaticProps` |
| Remix | Check `app/routes/` | Standard | File-based + `remix.config` | Standard | Check `loader`/`action` exports |
| Vue + vue-router | Standard | `<template>` instead of JSX | Check router config | Pinia: `defineStore` | Standard |
| Svelte | Standard | Svelte components | SvelteKit: file-based routes | Svelte stores | Standard |
| No framework (Node.js) | Standard | Skip D2 | Skip D3 | Skip D4 | Standard |

**Output:** Store the detected pattern as context for all subsequent layers. Don't include it in the report unless something unusual was detected.

```
Project detected: React 18 + Vite + react-router v6 + Zustand + TanStack Query
Dimensions active: D1 ✓  D2 ✓  D3 (router config)  D4 (Zustand)  D5 (TanStack Query)
```

## Layer 1: Static Analysis (knip)

**What it does:** Runs [knip](https://knip.dev/) against the target project to detect unused files, exports, dependencies, and unreachable modules from the import graph.

**Prerequisites check:**
1. Check if the project has a `package.json` — if not, skip Layer 1 entirely and note "No package.json found — knip layer skipped" in the report
2. Check if knip is installed (`node_modules/.bin/knip`) — if not, use `npx knip` (no install needed)

**Execution:**

Run knip with JSON output for machine parsing:
```bash
npx knip --reporter json 2>/dev/null
```

If the project has a `knip.json` or `knip.config.ts`, knip uses it automatically. If not, knip auto-detects entry points from the framework (Vite, Next.js, React Router, etc.).

**Parsing the JSON output:**

Knip's JSON output contains these categories:
- `files` — completely unused files (not imported by anything)
- `issues` — array of issues, each with:
  - `type`: "exports", "types", "duplicates", "dependencies", "devDependencies", "optionalPeerDependencies", "unlisted", "binaries", "unresolved"
  - `filePath`: the file containing the issue
  - `symbol`: the unused export name (for export issues)
  - `parentSymbol`: the re-exporting module (for re-export chains)

**Categorize findings:**

| Finding Type | Fix Action |
|---|---|
| Unused file | Remove file OR add import from appropriate parent |
| Unused export | Remove export OR wire it into consumer |
| Unused dependency | Remove from package.json OR add usage |
| Unlisted dependency | Add to package.json |
| Unresolved import | Fix import path OR install missing package |

**Output format for this layer:**
```
Layer 1 findings:
- [UNUSED_FILE] src/components/OldWidget.tsx — not imported anywhere
- [UNUSED_EXPORT] src/utils/helpers.ts:42 — export `formatDate` not used
- [UNUSED_DEP] package.json — `lodash` listed but never imported
- [UNLISTED_DEP] src/api/client.ts — imports `axios` but it's not in package.json
```

**Helper script:** `scripts/run-knip.sh` handles execution and returns structured JSON output.

## Layer 1.5: Documentation Coverage Check

**Purpose:** Verify that every new or changed function has a corresponding INTENT.md entry. This catches the most common documentation skip — agents write code and tests but forget to update INTENT.md, leaving the documentation layer stale.

**When to run:** After Layer 1, before Layer 2. Only runs if the project has an INTENT.md documentation layer (root INTENT.md exists). If no INTENT.md exists anywhere in the project, skip this layer silently — it's not a documentation-first project.

**Scope:** Analyze the current git diff to find new or changed functions/classes/methods.

**Check protocol:**

1. **Find changed files:** `git diff HEAD~1 --name-only -- '*.py' '*.ts' '*.tsx' '*.js' '*.jsx'` (or equivalent for the project's language)
2. **For each changed source file:**
   - Identify the module directory (e.g., `src/risk/` for `src/risk/position_sizer.py`)
   - Check if `[module_dir]/INTENT.md` exists
   - If it exists, read it and extract all documented function signatures
   - Parse the changed file for public function/class/method definitions
   - Compare: flag any public function that exists in code but has NO entry in INTENT.md
3. **For new module directories** (directories created in this diff):
   - Check if `[new_module_dir]/INTENT.md` was created
   - Check if root INTENT.md module map has a row for the new module
   - Flag if either is missing

**Finding types:**

| Finding | Severity | Auto-fixable? |
|---------|----------|---------------|
| `MISSING_INTENT_ENTRY` — function exists in code but no INTENT.md entry | HARD FAIL | Yes — generate entry from code |
| `STALE_INTENT_ENTRY` — INTENT.md entry for a function that no longer exists | WARN | Yes — remove entry |
| `MISSING_MODULE_INTENT` — new module directory has no INTENT.md file | HARD FAIL | Yes — create from template |
| `MISSING_MODULE_MAP_ROW` — new module not in root INTENT.md module map | HARD FAIL | Yes — add row |

**Output format:**
```
Layer 1.5 findings:
- [MISSING_INTENT_ENTRY] src/risk/position_sizer.py:45 — `calculate_dynamic_size()` has no entry in src/risk/INTENT.md
- [STALE_INTENT_ENTRY] src/risk/INTENT.md — entry for `old_function()` but function no longer exists in code
- [MISSING_MODULE_INTENT] src/newmodule/ — directory created but no INTENT.md file
- [MISSING_MODULE_MAP_ROW] src/newmodule/ — not listed in root INTENT.md module map
```

**Auto-fix strategy for `MISSING_INTENT_ENTRY`:**

Generate the entry from the function's code. Read the function body and produce:
```markdown
### function_name(param1: Type, param2: Type) -> ReturnType
- **Does**: [infer from function body — one sentence]
- **Why**: [infer from context and callers — one sentence, or "Why unknown — inferred from usage: [inference]"]
- **Relationships**: [grep for callers/callees — one sentence]
- **Decisions**: [note any non-obvious choices, or "None"]
```

Append the entry to the module's INTENT.md under the `## Functions` section.

**Auto-fix strategy for `MISSING_MODULE_INTENT`:**

Create `[module_dir]/INTENT.md` with:
```markdown
# [Module Name] — Intent

## Functions

[generate entries for all public functions in the module]
```

**Auto-fix strategy for `MISSING_MODULE_MAP_ROW`:**

Append a row to the root INTENT.md module map table:
```markdown
| [module_path] | [infer purpose from code] | [infer relationships from imports] |
```

---

## Layer 1.75: Filesystem Path Resolution Check

**Purpose:** Verify that all file paths and CLI commands referenced in SKILL.md and reference files actually resolve from the installed skill location. This catches the most dangerous class of wiring bug — code that passes every static check but fails at runtime because a path doesn't exist where the skill expects it.

**When to run:** After Layer 1.5, before Layer 2. Runs on ANY project that has `.md` files with path references (not just code projects). This is especially critical after tasks that change path references, move files, or update directory structures.

**Scope:** Scan all `.md` files in the changed diff for path references.

**Check protocol:**

1. **Find changed markdown files:** `git diff HEAD~1 --name-only -- '*.md' '*.yml'`
2. **For each changed file, extract path references** matching these patterns:
   - Absolute paths: `~/.claude/`, `/Users/`, `/home/`
   - CLI commands: `python3 <path>`, `bash <path>`, `node <path>`
   - Skill-relative paths: `bin/`, `references/`, `scripts/`
   - Config-referenced paths: any path that appears after a `paths.` config key
3. **Resolve each path from the installed location:**
   - For skill files (in `~/.claude/skills/<name>/`): resolve relative to the skill's install directory
   - For absolute paths (`~/.claude/...`): resolve directly
   - For CLI commands: extract the path argument, resolve it, then verify execution with `--help` or `--version`
4. **Verify existence:** `test -e <resolved-path>` for each
5. **For CLI commands:** additionally verify `python3 <path> --help 2>&1` exits without "No such file or directory"

**Finding types:**

| Finding | Severity | Auto-fixable? |
|---------|----------|---------------|
| `BROKEN_PATH` — path in .md file doesn't resolve from installed location | HARD FAIL | No — requires human decision on correct path |
| `BROKEN_CLI` — CLI command path doesn't exist or errors on execution | HARD FAIL | No — requires fixing the path or creating a symlink |
| `HARDCODED_USER_PATH` — absolute path contains a specific username (e.g., `/Users/jdoe/`) | WARN | Yes — replace with `~/` or `$HOME/` equivalent |
| `STALE_PATH_REFERENCE` — path references a directory/file that was moved or renamed in this diff | HARD FAIL | Yes — update to new path |

**Output format:**
```
Layer 1.75 findings:
- [BROKEN_PATH] ftm-ops/SKILL.md:53 — `~/.claude/skills/ftm/bin/brain.py` does not exist (ftm/ points to router subdirectory, not repo root)
- [BROKEN_CLI] ftm-mind/references/orient-protocol.md:210 — `python3 ~/.claude/skills/eng-buddy/bin/brain.py` → file not found
- [HARDCODED_USER_PATH] ftm-mind/references/ops-routing.md:44 — `/Users/jdoe/.claude/eng-buddy/drafts/` contains hardcoded username
- [STALE_PATH_REFERENCE] ftm-ops/references/task-management.md:15 — `~/.claude/eng-buddy/active-tasks.md` was moved to `~/.claude/ftm-ops/active-tasks.md`
```

**Why this layer exists:** In the v1.7.0 merge, 160+ path references were updated across 23 files. Every static check passed. The integration test verified brain.py worked from the repo path. But when a user invoked `/ftm-ops`, it called `python3 ~/.claude/skills/ftm/bin/brain.py` — which didn't exist because the `ftm` skill symlink pointed to the `ftm/` subdirectory (the router), not the repo root. A 2-second `test -e` would have caught this. This layer ensures it always does.

---

## Layer 2: LLM Adversarial Audit

**Mindset:** You are an adversary trying to PROVE code is dead. Not "confirm it works" — PROVE it's dead. Every new/modified export is guilty until proven innocent. You must find a complete chain from app entry point to the code in question, or it's flagged.

**Scope:** Analyze the current git diff (`git diff HEAD~1` or the diff from the current task's changes). For each new or modified export:

**The 5 Wiring Dimensions:**

For each export, check ALL five. A component might be imported but never rendered. A function might be exported but never called. Check the full chain.

### Dimension 1: Import Chain
- Trace: `export` → `import` → ... → entry point (`main.tsx`, `App.tsx`, `index.ts`)
- Method: Use `grep -r "import.*{.*ExportName.*}.*from" src/` or equivalent
- **GUILTY if:** No file imports this export, OR the importing file itself is not imported (broken chain)
- Evidence required: Full import chain with file:line for each link

### Dimension 2: JSX Rendering (React/Vue/Svelte projects)
- Trace: Component → rendered in parent JSX → ... → root component
- Method: Search for `<ComponentName` in JSX/TSX files
- **GUILTY if:** Component is imported but never appears in any JSX return statement
- Evidence required: The parent component file:line where it's rendered (or "NOT FOUND")
- Special cases: Lazy imports (`React.lazy(() => import(...))`), conditional rendering (`{condition && <Component/>}`), render props, HOCs — all count as valid rendering

### Dimension 3: Route Registration
- Trace: View/page component → route config → router entry point
- Method: Search router config files (react-router `createBrowserRouter`, Next.js pages/, etc.)
- **GUILTY if:** A view/page component exists but no route points to it
- Evidence required: Route config file:line showing the route, or "NOT FOUND"
- Also check: Does the route have a navigation link (sidebar, navbar, menu)? A route with no nav link might be intentionally hidden (deep link) or might be orphaned

### Dimension 4: Store Field Consumption (Redux/Zustand/Pinia/etc.)
- Trace: Store field defined → selector/hook reads it → component uses the value
- Method: Search for store selectors, useSelector calls, useStore hooks that reference the field
- **GUILTY if:** Store field is written but never read anywhere
- Evidence required: Component file:line where the field is consumed, or "NOT FOUND"

### Dimension 5: API Function Invocation
- Trace: API function defined → called by hook/component/other function → used in app
- Method: Search for function call sites
- **GUILTY if:** API function is exported but never called anywhere
- Evidence required: Call site file:line, or "NOT FOUND"

**Non-React projects:** Skip Dimensions 2-3 if no JSX framework detected. Focus on import chain (D1), data flow (D4 adapted to the project's state management), and function invocation (D5).

**Output format for this layer:**
```
Layer 2 findings:
- [UNWIRED_COMPONENT] src/components/NewWidget.tsx — imported in Dashboard.tsx:5 but never rendered in JSX (Dimension 2 FAIL)
- [ORPHAN_ROUTE] src/views/SettingsView.tsx — no route in router config points to this view (Dimension 3 FAIL)
- [DEAD_STORE_FIELD] src/store/userSlice.ts:23 — `userPreferences` written in reducer but never read by any selector (Dimension 4 FAIL)
- [UNCALLED_API] src/api/billing.ts:15 — `fetchInvoices()` exported but never called (Dimension 5 FAIL)
```

**Key principle:** File:line evidence for EVERY finding. "I think this might be unused" is NOT acceptable. Show the grep results, show the missing link in the chain.

## Layer 3: Auto-Fix and Changelog

**Purpose:** When Layer 1 or Layer 2 finds unwired code, this layer generates fixes, applies them, re-verifies, and produces a structured changelog.

**Fix Strategies by Finding Type:**

| Finding Type | Fix Strategy | Fallback |
|---|---|---|
| `UNUSED_FILE` | If the file was created by the current task, add import from the appropriate parent module. If it's pre-existing dead code, flag for removal. | Flag for manual review — might be intentionally standalone (config, script) |
| `UNUSED_EXPORT` | If another module should consume it (check wiring contract), add the import. If truly unnecessary, remove the export keyword. | Flag for manual review |
| `UNWIRED_COMPONENT` | Add `<ComponentName />` to the parent component's JSX return. Determine placement from component name and parent structure. | Flag — can't determine correct placement |
| `ORPHAN_ROUTE` | Add route entry to the router config. Infer path from component name (e.g., `SettingsView` → `/settings`). Add nav link to sidebar/navbar if one exists. | Flag — route path ambiguous |
| `DEAD_STORE_FIELD` | If a component should read this field (check wiring contract), add the selector/hook usage. If truly unused, remove the field. | Flag — store design decision needed |
| `UNCALLED_API` | If a hook or component should call this (check wiring contract), add the invocation. If truly unused, remove the function. | Flag — API integration decision needed |
| `UNUSED_DEP` | Remove from package.json `dependencies` or `devDependencies`. | Flag if it might be used in scripts, config files, or CLI |
| `UNLISTED_DEP` | Run `npm install <package>` (or appropriate package manager command). | Flag if the import might be wrong |
| `MISSING_INTENT_ENTRY` | Generate INTENT.md entry from function code (Does/Why/Relationships/Decisions). Append to module's INTENT.md. | Flag if function purpose is ambiguous |
| `STALE_INTENT_ENTRY` | Remove the entry from INTENT.md. | Flag if unsure whether function was renamed vs deleted |
| `MISSING_MODULE_INTENT` | Create module INTENT.md with entries for all public functions. | Flag if module has no clear public API |
| `MISSING_MODULE_MAP_ROW` | Add row to root INTENT.md module map table. | Flag if module purpose is unclear |

**Fix Protocol (for each finding):**

1. **Report** — Log the finding with type, file:line, and evidence
2. **Determine fix** — Match finding type to fix strategy above. Check wiring contract if available for guidance on WHERE to wire.
3. **Show proposed fix** — Display the exact code change before applying:
   ```
   FIX: [UNWIRED_COMPONENT] NewWidget in Dashboard.tsx
   Proposed: Add <NewWidget /> to Dashboard.tsx return JSX after line 45
   ```
4. **Apply fix** — Use Edit tool to make the change
5. **Re-verify** — Run the specific check that found the issue:
   - For knip findings: re-run `npx knip --reporter json`
   - For adversarial findings: re-trace the specific wiring dimension
6. **Log to changelog** — Record: timestamp, finding, fix applied, verification result

**When auto-fix is NOT possible:**

Some findings can't be auto-fixed safely:
- Ambiguous placement (where exactly should the component render?)
- Design decisions needed (should this store field exist at all?)
- Cross-cutting changes (fix requires modifying 5+ files)
- Test-only code (might be intentionally not wired into app)

For these, flag them clearly:
```
MANUAL_INTERVENTION_NEEDED:
- [ORPHAN_ROUTE] src/views/AdminPanel.tsx — cannot determine route path or nav placement
  Suggested action: Add route to router config and nav link to sidebar
  Reason auto-fix skipped: Multiple possible route paths (/admin, /settings/admin, /dashboard/admin)
```

**Re-verification after all fixes:**

After all auto-fixes are applied:
1. Re-run Layer 1 (knip) — confirm no new unused code introduced by fixes
2. Re-run Layer 2 (adversarial audit on the fix diff) — confirm fixes actually wire correctly
3. If re-verification finds new issues, fix those too (max 3 iterations to prevent loops)

**Changelog format:**

```
### FTM Audit Changelog — [YYYY-MM-DD HH:MM]

#### Findings
| # | Type | Location | Description |
|---|------|----------|-------------|
| 1 | UNWIRED_COMPONENT | src/components/Widget.tsx | Imported but not rendered in Dashboard |
| 2 | ORPHAN_ROUTE | src/views/Settings.tsx | No route config entry |

#### Fixes Applied
| # | Finding | Fix | Verified |
|---|---------|-----|----------|
| 1 | UNWIRED_COMPONENT Widget | Added <Widget /> to Dashboard.tsx:47 | ✅ PASS |
| 2 | ORPHAN_ROUTE Settings | Added /settings route to router.tsx:23 | ✅ PASS |

#### Manual Intervention Required
| # | Finding | Reason | Suggested Action |
|---|---------|--------|-----------------|
| (none) | | | |

#### Final Status: PASS (0 remaining issues)
```

## Wiring Contracts

**What:** A wiring contract is a YAML block in a plan task that declares the expected wiring for code produced by that task. It tells ftm-audit exactly what to verify — instead of guessing, the audit checks specific expectations.

**Schema:**

```yaml
Wiring:
  exports:
    - symbol: ComponentName          # What's being exported
      from: src/components/Thing.tsx  # From which file

  imported_by:
    - file: src/views/Dashboard.tsx   # Which file should import it
      line_hint: "import section"     # Approximate location (optional)

  rendered_in:                        # For React components
    - parent: Dashboard               # Parent component name
      placement: "main content area"  # Where in the JSX (descriptive)

  route_path: /dashboard/thing        # For routed views (optional)

  nav_link:                           # For views that need navigation (optional)
    - location: sidebar               # Where the nav link goes
      label: "Thing"                  # Display text

  store_reads:                        # Store fields this code reads (optional)
    - store: useAppStore
      field: user.preferences

  store_writes:                       # Store fields this code writes (optional)
    - store: useAppStore
      field: user.preferences
      action: setPreferences

  api_calls:                          # API functions this code invokes (optional)
    - function: fetchUserPrefs
      from: src/api/user.ts
```

**All fields are optional.** Graceful degradation:
- Full contract → audit checks every declared wire
- Partial contract → audit checks what's declared, uses heuristics for the rest
- No contract → audit falls back to pure Layer 1 + Layer 2 analysis

**Example: React Component Task**

```yaml
### Task 3: Build UserPreferences component
**Files:** Create src/components/UserPreferences.tsx
**Wiring:**
  exports:
    - symbol: UserPreferences
      from: src/components/UserPreferences.tsx
  imported_by:
    - file: src/views/SettingsView.tsx
  rendered_in:
    - parent: SettingsView
      placement: "below profile section"
  store_reads:
    - store: useAppStore
      field: user.preferences
  api_calls:
    - function: updatePreferences
      from: src/api/user.ts
```

**Example: API Client Function Task**

```yaml
### Task 5: Add billing API functions
**Files:** Create src/api/billing.ts
**Wiring:**
  exports:
    - symbol: fetchInvoices
      from: src/api/billing.ts
    - symbol: createSubscription
      from: src/api/billing.ts
  imported_by:
    - file: src/hooks/useBilling.ts
  api_calls: []  # These ARE the API functions — nothing to call downstream
```

**Example: New Route/View Task**

```yaml
### Task 7: Build AnalyticsDashboard view
**Files:** Create src/views/AnalyticsDashboard.tsx
**Wiring:**
  exports:
    - symbol: AnalyticsDashboard
      from: src/views/AnalyticsDashboard.tsx
  imported_by:
    - file: src/router.tsx
  rendered_in:
    - parent: RouterConfig
      placement: "route element"
  route_path: /analytics
  nav_link:
    - location: sidebar
      label: "Analytics"
      icon: BarChart
  store_reads:
    - store: useAppStore
      field: analytics.dateRange
```

**How ftm-audit checks contracts:**

For each field in the wiring contract:

1. **exports** → Verify the symbol exists as a named export in the specified file. Use `grep "export.*ComponentName"` or AST-level check.
2. **imported_by** → Verify the importing file contains `import { Symbol } from './path'`. Check the actual import statement exists.
3. **rendered_in** → Verify the parent component's JSX contains `<Symbol`. If `placement` is specified, verify approximate location.
4. **route_path** → Verify the router config contains a route with this path pointing to this component.
5. **nav_link** → Verify the navigation component (sidebar/navbar) contains a link with matching label and path.
6. **store_reads** → Verify a selector/hook call reads this field in the component.
7. **store_writes** → Verify a dispatch/action call writes this field.
8. **api_calls** → Verify the function is imported and called somewhere in the component or its hooks.

Each check produces: `✅ VERIFIED file:line` or `❌ NOT FOUND — [what was expected] [where it was expected]`

## Phase 3: Runtime Wiring (Optional)

**Prerequisite**: This phase runs only when ALL of these conditions are met:
1. The ftm-browse binary exists at `$HOME/.claude/skills/ftm-browse/bin/ftm-browse`
2. A dev server is running (detected via `lsof -i :3000` or `lsof -i :5173` or `lsof -i :8080`)
3. The wiring contracts for the audited tasks include `route_path` entries

If any prerequisite is not met, skip this phase with a note explaining which condition failed.

**What it checks**: Components and routes that passed static analysis (Phases 1-2) actually render in the running application.

### Process

For each wiring contract that includes a `route_path`:

1. **Navigate**: `$PB goto <dev_server_url><route_path>`
2. **Snapshot**: `$PB snapshot -i` to get the ARIA tree of interactive elements
3. **Verify components render**: Check that the expected components from the wiring contract appear in the ARIA tree. Look for:
   - Expected buttons, links, inputs by their labels/roles
   - Expected headings and landmarks
   - Expected form fields
4. **Screenshot**: `$PB screenshot` as evidence of the render state
5. **Report findings**:
   - PASS: All expected components found in ARIA tree
   - WARN: Page renders but some expected components are missing
   - FAIL: Page doesn't render (blank, error page, 404)

Where `$PB` is `$HOME/.claude/skills/ftm-browse/bin/ftm-browse`.

### Integration with Phases 1-2

Runtime wiring catches a category of bugs that static analysis cannot:
- Component is imported and used in JSX but conditionally rendered (and the condition is false)
- Route is registered but the page component crashes on mount
- Component renders but is hidden via CSS (visibility: hidden, display: none)
- Server-side data dependency fails, leaving the component in an error state

If Phase 3 finds issues that Phases 1-2 missed, flag them as **runtime-only findings** in the audit report.

### Graceful Degradation

If ftm-browse is not installed or the dev server is not running:
- Log: "Phase 3 (Runtime Wiring) skipped — [reason: no browse binary | no dev server | no route_path in contracts]"
- Do NOT fail the overall audit
- Phases 1-2 results stand on their own

## Execution Protocol

When invoked (manually via `/ftm-audit` or automatically post-task):

1. Run Phase 0 (detect project patterns — framework, router, state, API layer)
2. Run Layer 1 (knip static analysis)
3. Run Layer 1.5 (documentation coverage check — INTENT.md entries for changed functions)
4. Run Layer 1.75 (filesystem path resolution — verify all referenced paths exist from installed location)
5. Run Layer 2 (LLM adversarial audit, calibrated to detected patterns)
5. Combine findings, deduplicate
6. Run Layer 3 (auto-fix) for each finding (including missing INTENT.md entries)
7. Re-verify (re-run Layers 1+1.5+2)
8. Run Phase 3 (runtime wiring via ftm-browse, if prerequisites met)
9. Produce final changelog report

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append decision summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` capturing findings count, fix count, which wiring dimensions fired, and any manual interventions required
3. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry
4. Emit `audit_complete` event

## Report Format

```
## FTM Audit Report — [timestamp]

### Layer 1: Static Analysis (knip)
- Findings: [N]
- [list each finding with file:line]

### Layer 1.5: Documentation Coverage
- Findings: [N]
- [list each finding — missing entries, stale entries, missing module docs]

### Layer 1.75: Path Resolution
- Findings: [N]
- [list each finding — broken paths, broken CLI commands, hardcoded user paths]

### Layer 2: Adversarial Audit
- Findings: [N]
- [list each finding with file:line and evidence]

### Layer 3: Auto-Fix Results
- Fixed: [N]
- Manual intervention needed: [N]
- [list each fix applied]

### Final Status: PASS / FAIL
- Remaining issues: [list if any]
```

## Requirements

- tool: `knip` | optional | static dead-code and unused-export analysis (Layer 1)
- tool: `node` | required | runtime for knip via npx
- config: `knip.config.ts` | optional | custom knip configuration at project root
- reference: `references/protocols/PROJECT-PATTERNS.md` | required | framework detection table and dimension activation matrix
- reference: `references/strategies/AUTO-FIX-STRATEGIES.md` | required | fix actions by finding type
- reference: `references/protocols/WIRING-CONTRACTS.md` | optional | wiring contract schema for plan-driven audits
- reference: `references/protocols/RUNTIME-WIRING.md` | optional | runtime verification protocol
- reference: `references/templates/REPORT-FORMAT.md` | required | structured report template
- tool: `$HOME/.claude/skills/ftm-browse/bin/ftm-browse` | optional | runtime wiring verification via browser (Phase 3)

## Risk

- level: medium_write
- scope: modifies source files to fix wiring issues (auto-fix layer); also adds/removes imports and route registrations; reads codebase broadly
- rollback: git checkout on auto-fixed files; all changes are tracked in the changelog report before being applied

## Approval Gates

- trigger: auto-fix proposed for a finding | action: report proposed change before applying (show "Proposed: ..." format)
- trigger: finding flagged MANUAL_INTERVENTION_NEEDED | action: surface to user with suggested action, do not auto-fix
- trigger: re-verification still fails after 3 iterations | action: stop and report remaining issues to user
- complexity_routing: micro → auto | small → auto | medium → plan_first | large → plan_first | xl → always_ask

## Fallbacks

- condition: knip not installed and npx unavailable | action: skip Layer 1, run Layer 2 adversarial audit only
- condition: no package.json found | action: skip knip entirely, run adversarial audit only
- condition: ftm-browse not installed | action: skip Phase 3 runtime wiring check, log reason and continue
- condition: dev server not running | action: skip Phase 3 runtime wiring check, log reason and continue
- condition: wiring contracts absent | action: run pure Layer 1 + Layer 2 analysis without contract checking
- condition: project has no identifiable entry point | action: skip knip, run adversarial audit only

## Capabilities

- cli: `knip` | optional | dead code detection via npx knip
- cli: `node` | required | JavaScript runtime for npx
- cli: `$HOME/.claude/skills/ftm-browse/bin/ftm-browse` | optional | headless browser for runtime wiring
- mcp: `git` | optional | diff scope for Layer 2 adversarial audit

## Event Payloads

### audit_complete
- skill: string — "ftm-audit"
- findings_count: number — total issues found across all layers
- auto_fixed_count: number — issues auto-remediated by Layer 3
- manual_count: number — issues requiring manual intervention
- scope: string[] — file paths audited
- duration_ms: number — total audit duration
- layers_run: string[] — which layers executed (e.g., ["layer1", "layer2", "layer3"])

### issue_found
- skill: string — "ftm-audit"
- layer: string — "layer1" | "layer2" | "layer3"
- dimension: string — D1 | D2 | D3 | D4 | D5 (for Layer 2 findings)
- finding_type: string — exports | types | duplicates | UNWIRED_COMPONENT | etc.
- file_path: string — affected file
- symbol: string — affected symbol name
- severity: string — CRITICAL | HIGH | MEDIUM | LOW
- auto_fixable: boolean — whether Layer 3 can fix this automatically

### task_completed
- skill: string — "ftm-audit"
- result: string — "pass" | "pass_with_fixes" | "fail"
- findings_count: number — total findings
- auto_fixed_count: number — auto-remediated count
- manual_count: number — manual intervention needed
