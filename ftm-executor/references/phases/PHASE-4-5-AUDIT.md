# Phase 4.5 — Post-Task Audit Gate

## Per-Task Verification Gate

Before running ftm-audit, verify these four checks for every task:

1. **Tests pass** — any tests written or affected by the task must be green
2. **INTENT.md updated** — check that new/changed functions have entries in their module's INTENT.md
3. **Diagram updated** — check that new/changed functions have nodes in their module's DIAGRAM.mmd
4. **Full suite still green** — run the project's test suite (if one exists) and verify no regressions

5. **Visual smoke test (optional)** — If the project has a running dev server (detected via `lsof -i :3000` or `lsof -i :5173` or configured in plan metadata as `dev_server_url`), run:
   - `$PB goto <dev_server_url>`
   - `$PB screenshot`
   - Verify the screenshot shows a rendered page (not a blank screen or error page)
   - If the task modified UI components, `$PB snapshot -i` to verify new elements appear in the ARIA tree

   Where `$PB` is `$HOME/.claude/skills/ftm-browse/bin/ftm-browse`.

   **Graceful degradation**: If ftm-browse binary is not installed, skip visual checks with a note: "Visual smoke test skipped — ftm-browse not installed." Do not fail the task.

A task is NOT marked complete until checks 1–4 pass (check 5 is optional).

**Failure handling:**
- Test failures → agent must fix before task completes
- Missing INTENT.md entries → add them (use ftm-intent format)
- Missing diagram nodes → add them (use ftm-diagram format)
- Regression failures → investigate and fix before continuing

## Running ftm-audit

Use `review` model from ftm-config when spawning audit agents.

**Invoke ftm-audit** scoped to the files the task modified (check the agent's commits). If the task has a `Wiring:` contract in the plan, pass it to ftm-audit for contract checking. Run all three layers: knip static analysis → adversarial audit → auto-fix.

## Interpreting Audit Results

**PASS (no findings):** Mark task complete, proceed to next task.

**PASS after auto-fix:** FTM-audit found issues and fixed them automatically. Commit the fixes in the agent's worktree with message "Auto-fix: wire [description]". Mark task complete.

**FAIL (manual intervention needed):** Task stays in-progress. Report to the user:
```
Task [N] audit failed — manual intervention needed:
- [finding 1 with file:line]
- [finding 2 with file:line]
Suggested fixes: [ftm-audit's suggestions]
```
Wait for user input before continuing to next task.

## Task Completion Report Format

```
Task [N]: [title] — COMPLETE
Audit: PASS (0 findings) | PASS after auto-fix (2 fixed) | FAIL (1 manual)
[if auto-fixed: list what was fixed]
[if failed: list outstanding issues]
```

## When to Skip the Audit

**Skip when:**
- The task only modified `.md`, `.txt`, `.json` (config), or `.yml` files
- The task is explicitly marked as a "setup" or "scaffold" task
- The project has no `package.json` AND no identifiable entry point
- The plan marks the task with `audit: skip`

The plan syntax for explicit skipping:
```yaml
audit: skip
reason: "Documentation-only task" | "Config change" | "Test-only change"
```
