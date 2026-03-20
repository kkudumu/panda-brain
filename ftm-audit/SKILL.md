---
name: ftm-audit
description: Dual-purpose wiring audit that verifies all code is actually connected to the running application. Combines static analysis (knip) with adversarial LLM audit and auto-fixes anything it finds. Use when user says "audit", "wiring check", "verify wiring", "dead code", "check imports", "unused code", "find dead code", or "audit wiring". Also auto-invoked by ftm-executor after each task.
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

## Execution Protocol

1. Phase 0 — detect project patterns (framework, router, state, API layer)
2. Layer 1 — knip static analysis
3. Layer 2 — adversarial audit, calibrated to detected patterns
4. Combine findings, deduplicate
5. Layer 3 — auto-fix each finding
6. Re-verify (re-run Layers 1+2)
7. Phase 3 — runtime wiring via ftm-browse (if prerequisites met)
8. Produce final changelog report


## Phase 0: Detect Project Patterns

Scan the project to calibrate which wiring dimensions apply. Read `references/protocols/PROJECT-PATTERNS.md` for the full detection table and dimension activation matrix.

**Quick scan:** `package.json` deps + `next.config.*`, `vite.config.*`, `app/` directory, `pages/` directory.

**Output:** Store detected context for all subsequent layers.
```
Project detected: React 18 + Vite + react-router v6 + Zustand + TanStack Query
Dimensions active: D1 ✓  D2 ✓  D3 (router config)  D4 (Zustand)  D5 (TanStack Query)
```

---

## Layer 1: Static Analysis (knip)

Detects unused files, exports, dependencies, and unreachable modules from the import graph.

**Prerequisites:** Requires `package.json` — skip and note if absent. Use `npx knip` if not locally installed.

```bash
npx knip --reporter json 2>/dev/null
```

**Output:** `files` (unused files) + `issues` array (`type`/`filePath`/`symbol`). Issue types: `exports`, `types`, `duplicates`, `dependencies`, `devDependencies`, `unlisted`, `binaries`, `unresolved`.

Fix actions by finding type: see `references/strategies/AUTO-FIX-STRATEGIES.md`. Helper script: `scripts/run-knip.sh`.

---

## Layer 2: LLM Adversarial Audit

**Mindset:** Prove code is dead, not confirm it works. Every new/modified export is guilty until you find a complete chain from entry point to it.

**Scope:** `git diff HEAD~1` (or current task diff). For each new or modified export, check all five wiring dimensions.

### The 5 Wiring Dimensions

Calibrate each dimension to the detected project pattern from Phase 0. Framework-specific method variations are in `references/protocols/PROJECT-PATTERNS.md`.

| Dim | Name | Trace | GUILTY if | Evidence required |
|---|---|---|---|---|
| D1 | Import Chain | `export` → `import` → ... → entry point | No importer found, OR importing file itself unimported | Full chain with file:line each link |
| D2 | JSX Rendering | Component → parent JSX → root (React/Vue/Svelte only) | Imported but absent from every JSX return | Parent file:line where rendered, or "NOT FOUND" |
| D3 | Route Registration | View → route config → router (method varies by router type) | View exists but no route points to it | Route config file:line, or "NOT FOUND" |
| D4 | Store Consumption | Store field defined → selector/hook → component | Field written but never read | Consumer file:line, or "NOT FOUND" |
| D5 | API Invocation | API function → call site → used in app | Exported but never called | Call site file:line, or "NOT FOUND" |

**D2 valid rendering:** lazy imports, conditional rendering (`{cond && <C/>}`), render props, HOCs — all count.
**D3 nav link check:** A route with no nav link might be orphaned — flag as a warning.
**Non-React projects:** Skip D2-D3. Focus on D1, D4 (adapted to state management pattern), D5.

**Key principle:** File:line evidence for EVERY finding. Show the grep results and the missing chain link — "I think this might be unused" is not acceptable.

---

## Layer 3: Auto-Fix and Changelog

**Purpose:** When Layers 1 or 2 find unwired code, generate fixes, apply them, re-verify, and produce a structured changelog.

For fix strategies by finding type and the conditions that block auto-fix, see `references/strategies/AUTO-FIX-STRATEGIES.md`.

**Fix protocol for each finding:** Report → determine fix (check wiring contract for WHERE) → show proposed change → apply → re-verify → log to changelog.

```
FIX: [UNWIRED_COMPONENT] NewWidget in Dashboard.tsx
Proposed: Add <NewWidget /> to Dashboard.tsx return JSX after line 45
```

**When auto-fix is not possible:** Flag with `MANUAL_INTERVENTION_NEEDED`, a suggested action, and the reason skipped.

**Re-verification:** After all fixes, re-run Layers 1+2. Maximum 3 iterations to prevent loops.

---

## Wiring Contracts

A wiring contract is a YAML block in a plan task declaring expected wiring for code produced by that task. See `references/protocols/WIRING-CONTRACTS.md` for full schema, examples (React component, API functions, route/view), and per-field verification checks.

**Fields:** `exports`, `imported_by`, `rendered_in`, `route_path`, `nav_link`, `store_reads`, `store_writes`, `api_calls` — all optional.

**Graceful degradation:** Full contract → check every wire. Partial → check what's declared. No contract → pure Layer 1 + Layer 2 analysis.

---

## Phase 3: Runtime Wiring (Optional)

Verify that components and routes that passed static analysis actually render in the running application. See `references/protocols/RUNTIME-WIRING.md` for full prerequisites, process, and what runtime wiring catches that static analysis misses.

**Prerequisites (all required):** ftm-browse binary at `$HOME/.claude/skills/ftm-browse/bin/ftm-browse` + dev server running + wiring contracts include `route_path` entries.

**If any prerequisite fails:** Log the reason and skip. Do NOT fail the overall audit.

---

## Blackboard Write

After completing:

1. Update `~/.claude/ftm-state/blackboard/context.json` — set current_task complete, append to recent_decisions (cap 10), update session_metadata
2. Write experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json` — findings count, fix count, dimensions fired, manual interventions
3. Update `experiences/index.json`
4. Emit `audit_complete` event

## Report Format

See `references/templates/REPORT-FORMAT.md` for the full report template (summary, changelog table, layer-by-layer finding format with examples).

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
