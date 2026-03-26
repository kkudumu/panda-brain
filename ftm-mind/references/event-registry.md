# FTM Event Registry

This document defines the full event vocabulary for the ftm skill system. The mind reads this during its Decide phase to determine which skills to trigger after any action completes.

---

## How to Read This Document

Each event entry uses the following format:

```markdown
### event_name
- **Description**: What this event means
- **Emitted by**: [list of skills]
- **Listened to by**: [list of skills]
- **Fast-path**: yes/no (fast-path events bypass mind mediation and always trigger their listeners)
- **Payload**: {key fields the event carries}
```

**Fast-path events** are always triggered immediately — the mind does not evaluate whether to route them. Use fast-path for events where the downstream response is unconditional and latency matters (documentation sync, micro-reflections).

**Mediated events** pass through the mind's Decide phase. The mind evaluates context and decides whether to trigger listeners, which listener to prefer, and whether to combine multiple events before acting.

---

## How to Add an Event Declaration to a Skill

When adding event declarations to a skill's SKILL.md, insert an `## Events` section AFTER the YAML frontmatter block and BEFORE the first major heading of existing content. Do NOT modify any other content.

Use this exact format:

```markdown
## Events

### Emits
- `event_name` — when [the condition that causes this skill to emit the event]

### Listens To
- `event_name` — [what this skill does in response when this event fires]
```

Guidelines for writing clear declarations:
- Emit conditions should describe the specific moment the event fires, not the entire skill workflow. Example: "when a git commit is made" not "during execution".
- Listen-to descriptions should describe the triggered action, not the full response workflow. Example: "auto-investigate the failure" not "launch Phase 1 agents".
- Use backtick-quoted event names consistently.
- One bullet per event. If a skill emits the same event under multiple conditions, combine them into one bullet with "or" — e.g., "when the test suite passes, or when a post-fix verification succeeds".

---

## Full Event Vocabulary

### task_received
- **Description**: A new task has entered the system and is acknowledged by the executor
- **Emitted by**: ftm-executor
- **Listened to by**: ftm-mind (log task arrival, initialize tracking context), ftm-brainstorm (begin ideation work when mind routes an incoming task for exploration)
- **Fast-path**: no
- **Payload**: `{ task_description, plan_path, wave_number, task_number }`

---

### plan_generated
- **Description**: A plan document was created and is ready for review or execution
- **Emitted by**: ftm-executor, ftm-brainstorm
- **Listened to by**: ftm-mind (surface plan to user, optionally trigger ftm-audit pre-flight)
- **Fast-path**: no
- **Payload**: `{ plan_path, plan_title, task_count, wave_count }`

---

### research_complete
- **Description**: ftm-researcher finished its synthesis pipeline and structured output is ready for consumption
- **Emitted by**: ftm-researcher
- **Listened to by**: ftm-brainstorm (consume findings for current research sprint), ftm-mind (log research session on blackboard, optionally surface to user)
- **Fast-path**: no
- **Payload**: `{ query, mode, findings_count, consensus_count, contested_count, unique_count, sources_count, council_used, duration_ms }`

---

### plan_approved
- **Description**: The user has approved a plan for execution
- **Emitted by**: ftm-executor (after user confirmation)
- **Listened to by**: ftm-executor (begin Phase 3 worktree setup and agent dispatch)
- **Fast-path**: no
- **Payload**: `{ plan_path, plan_title, approved_by, timestamp }`

---

### code_changed
- **Description**: One or more files were modified — pre-commit state, changes not yet persisted to git history
- **Emitted by**: ftm-executor
- **Listened to by**: ftm-mind (record in blackboard, may trigger pre-commit checks)
- **Fast-path**: no
- **Payload**: `{ files_changed: [path], task_number, agent_name, worktree_path }`

---

### code_committed
- **Description**: A git commit was successfully made — changes are persisted to the repository
- **Emitted by**: ftm-executor
- **Listened to by**: ftm-intent (update INTENT.md entries for changed functions), ftm-diagram (update DIAGRAM.mmd nodes and edges for changed modules), ftm-codex-gate (run adversarial validation at wave boundaries after commits land)
- **Fast-path**: yes — documentation must always stay in sync with commits, no mind mediation needed
- **Payload**: `{ commit_hash, commit_message, files_changed: [path], worktree_path, task_number }`

---

### map_updated
- **Description**: The code knowledge graph has been updated — either from a full bootstrap scan or an incremental re-index of changed files
- **Emitted by**: ftm-map
- **Listened to by**: ftm-mind (log on blackboard, update session context with latest graph stats), ftm-intent (trigger INTENT.md regeneration from graph), ftm-diagram (trigger DIAGRAM.mmd regeneration from graph)
- **Fast-path**: yes — downstream view generation should happen immediately without mind mediation
- **Payload**: `{ project_path, symbols_count, edges_count, files_parsed, duration_ms, mode: "bootstrap" | "incremental" }`

---

### test_passed
- **Description**: The test suite (or a targeted subset) ran and all tests passed
- **Emitted by**: ftm-executor, ftm-debug
- **Listened to by**: ftm-mind (update task status, potentially unblock next wave)
- **Fast-path**: no
- **Payload**: `{ test_runner, test_count, duration_ms, scope: "full_suite" | "task_scope", task_number }`

---

### test_failed
- **Description**: The test suite ran and one or more tests failed
- **Emitted by**: ftm-executor, ftm-debug
- **Listened to by**: ftm-debug (auto-investigate the failure), ftm-mind (block wave advancement, update task status)
- **Fast-path**: no
- **Payload**: `{ test_runner, failed_tests: [{ name, file, error }], total_count, failed_count, task_number }`

---

### bug_fixed
- **Description**: A specific bug was identified, a fix was applied, and the Reviewer agent approved the fix
- **Emitted by**: ftm-debug
- **Listened to by**: ftm-retro (record the fix as a success experience), ftm-mind (update task status, unblock dependents)
- **Fast-path**: no
- **Payload**: `{ bug_description, root_cause, files_changed: [path], fix_commits: [hash], reviewer_verdict }`

---

### audit_complete
- **Description**: ftm-audit finished its full analysis (all three layers) for a given scope
- **Emitted by**: ftm-audit
- **Listened to by**: ftm-executor (interpret results: mark task complete, queue auto-fix, or hold for manual review), ftm-mind (update audit record on blackboard)
- **Fast-path**: no
- **Payload**: `{ scope: [path], findings_count, auto_fixed_count, manual_required_count, final_status: "PASS" | "FAIL", changelog_path }`

---

### issue_found
- **Description**: A problem was discovered — by ftm-audit static analysis, by adversarial audit, or by ftm-debug investigation
- **Emitted by**: ftm-audit, ftm-debug, ftm-codex-gate
- **Listened to by**: ftm-mind (log the issue, decide whether to surface to user or auto-route to fix)
- **Fast-path**: no
- **Payload**: `{ issue_type, file_path, line_hint, description, severity: "error" | "warning", source: "knip" | "adversarial" | "debug", auto_fixable: boolean }`

---

### documentation_updated
- **Description**: INTENT.md or a DIAGRAM.mmd file was updated to reflect new or changed code
- **Emitted by**: ftm-intent, ftm-diagram
- **Listened to by**: ftm-mind (record documentation sync on blackboard, reset the "docs behind" flag for the affected module)
- **Fast-path**: no
- **Payload**: `{ file_path, module_name, update_type: "intent" | "diagram", changed_entries: [string] }`

---

### review_complete
- **Description**: A code review or audit review finished and produced a verdict
- **Emitted by**: ftm-audit (after adversarial layer), ftm-debug (after Reviewer agent), ftm-council (after majority verdict or 5-round synthesis), ftm-codex-gate (after Codex analysis completes)
- **Listened to by**: ftm-audit (validate review findings match static analysis), ftm-mind (update review status on blackboard)
- **Fast-path**: no
- **Payload**: `{ verdict: "APPROVED" | "APPROVED_WITH_CHANGES" | "NEEDS_REWORK", reviewer, findings: [string], task_number }`

---

### task_completed
- **Description**: A task finished — including passing all verification gates (tests, audit, Codex gate)
- **Emitted by**: ftm-executor, ftm-debug, ftm-audit, ftm-retro, ftm-brainstorm, ftm-council, ftm-codex-gate, ftm-intent, ftm-diagram, ftm-browse, ftm-pause, ftm-resume, ftm-upgrade, ftm-config, ftm-researcher
- **Listened to by**: ftm-retro (micro-reflection trigger — record the task outcome as an experience), ftm-mind (advance wave state, check if all tasks in wave are done)
- **Fast-path**: yes — micro-reflection runs on every task completion unconditionally; no mind mediation needed
- **Payload**: `{ task_number, task_title, plan_path, wave_number, duration_ms, audit_result, agent_name }`

---

### error_encountered
- **Description**: An unexpected error occurred during execution that was not part of a normal test failure
- **Emitted by**: ftm-executor, ftm-debug
- **Listened to by**: ftm-debug (diagnose the error), ftm-retro (record as a failure experience for pattern learning), ftm-mind (halt or reroute depending on severity)
- **Fast-path**: no
- **Payload**: `{ error_message, stack_trace, phase, task_number, skill: "ftm-executor" | "ftm-debug", recoverable: boolean }`

---

### session_paused
- **Description**: The session state was serialized and saved — the user is ending the session but wants to resume later
- **Emitted by**: ftm-pause (dedicated pause skill)
- **Listened to by**: ftm-mind (write final blackboard snapshot, record open tasks and current wave state)
- **Fast-path**: no
- **Payload**: `{ session_id, plan_path, current_wave, open_tasks: [number], blackboard_snapshot_path, timestamp }`

---

### session_resumed
- **Description**: A previously paused session state was restored and execution is continuing
- **Emitted by**: ftm-resume (dedicated resume skill)
- **Listened to by**: ftm-executor (restore wave state and re-dispatch open tasks), ftm-mind (reload blackboard snapshot)
- **Fast-path**: no
- **Payload**: `{ session_id, plan_path, restored_wave, open_tasks: [number], blackboard_snapshot_path, timestamp }`

---

### experience_recorded
- **Description**: A new experience entry (task outcome, fix attempt, blocker) was written to the blackboard's experience log
- **Emitted by**: ftm-retro
- **Listened to by**: ftm-mind (evaluate whether the experience reveals a new pattern to promote)
- **Fast-path**: no
- **Payload**: `{ experience_type: "success" | "failure" | "fix" | "blocker", description, task_number, plan_slug, timestamp }`

---

### pattern_discovered
- **Description**: A recurring pattern was identified from accumulated experiences and promoted to the patterns.json library
- **Emitted by**: ftm-retro
- **Listened to by**: ftm-mind (index the new pattern so it can inform future Decide-phase routing), ftm-executor (optionally: adjust agent prompts if pattern is execution-relevant)
- **Fast-path**: no
- **Payload**: `{ pattern_name, pattern_description, first_seen_retro, occurrence_count, suggested_action, patterns_file_path }`

---

### secrets_found
- **Description**: ftm-git scan detected hardcoded credentials in staged files or the working tree — commit/push is blocked until remediation completes
- **Emitted by**: ftm-git
- **Listened to by**: ftm-executor (pause commit/push, await remediation), ftm-mind (record security finding on blackboard)
- **Fast-path**: no
- **Payload**: `{ findings: [{ file_path, line_number, secret_type, severity }], scan_scope: "staged" | "working_tree" | "history", task_number }`

---

### secrets_clear
- **Description**: ftm-git scan completed with no findings — the commit or push is safe to proceed
- **Emitted by**: ftm-git
- **Listened to by**: ftm-executor (unblock pending commit/push operation), ftm-mind (record clean scan on blackboard)
- **Fast-path**: no
- **Payload**: `{ files_scanned: number, scan_scope: "staged" | "working_tree" | "history", task_number }`

---

### secrets_remediated
- **Description**: ftm-git auto-fix successfully extracted secrets to .env and refactored source files — a re-scan confirmed no remaining findings
- **Emitted by**: ftm-git
- **Listened to by**: ftm-executor (unblock commit/push now that secrets are extracted), ftm-mind (record remediation action on blackboard)
- **Fast-path**: no
- **Payload**: `{ secrets_extracted: number, files_refactored: [path], env_vars_added: [string], task_number }`

---

### capture_complete
- **Description**: ftm-capture finished processing and persisting a captured item (snippet, link, thought, or known issue)
- **Emitted by**: ftm-capture
- **Listened to by**: ftm-mind (log capture on blackboard, optionally surface to user)
- **Fast-path**: no
- **Payload**: `{ capture_type, title, file_path, timestamp }`

---

### known_issue_recorded
- **Description**: A known issue was captured and recorded for future reference, avoiding repeated investigation of the same problem
- **Emitted by**: ftm-capture
- **Listened to by**: ftm-mind (index known issue on blackboard for dedup during future debug sessions)
- **Fast-path**: no
- **Payload**: `{ issue_title, issue_description, file_path, tags: [string], timestamp }`

---

## Fast-Path Summary

| Event | Always triggers |
|---|---|
| `code_committed` | ftm-intent (INTENT.md sync), ftm-diagram (DIAGRAM.mmd sync) |
| `task_completed` | ftm-retro (micro-reflection / experience recording) |
| `map_updated` | ftm-intent (INTENT.md regeneration), ftm-diagram (DIAGRAM.mmd regeneration) |

All other events are mediated by the mind's Decide phase.

---

## Event Routing Reference

Use this table to quickly look up which skills are involved when an event fires:

| Event | Emitters | Listeners |
|---|---|---|
| task_received | executor | mind, brainstorm |
| plan_generated | executor, brainstorm | mind |
| research_complete | researcher | brainstorm, mind |
| plan_approved | executor | executor |
| code_changed | executor | mind |
| code_committed | executor | intent, diagram, codex-gate |
| test_passed | executor, debug | mind |
| test_failed | executor, debug | debug, mind |
| bug_fixed | debug | retro, mind |
| audit_complete | audit | executor, mind |
| issue_found | audit, debug, codex-gate | mind |
| documentation_updated | intent, diagram | mind |
| review_complete | audit, debug, council, codex-gate | audit, mind |
| task_completed | executor, debug, audit, retro, brainstorm, council, codex-gate, intent, diagram, browse, pause, resume, upgrade, config, researcher | retro, mind |
| error_encountered | executor, debug | debug, retro, mind |
| session_paused | pause | mind |
| session_resumed | resume | executor, mind |
| experience_recorded | retro | mind |
| pattern_discovered | retro | mind, executor |
| secrets_found | git | executor, mind |
| secrets_clear | git | executor, mind |
| secrets_remediated | git | executor, mind |
| capture_complete | capture | mind |
| known_issue_recorded | capture | mind |
| map_updated | map | mind, intent, diagram |
