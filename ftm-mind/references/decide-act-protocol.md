# Decide + Act Protocol

## Decide

### 1. Choose execution mode

- `micro` → direct action
- `small` → pre-flight summary + action + verify
- `medium` → checkbox plan, wait for approval, execute
- `large` → `ftm-brainstorm` (no plan) or `ftm-executor` (plan exists)

Double-check forced escalation signals from Complexity Sizing reference. If any fired → medium minimum.

### 1.5 Plan Approval

Read `ftm-config.yml` → `execution.approval_mode`.

**`auto`**: micro/small just go, medium outlines + executes, large routes to brainstorm/executor.

**`plan_first`** (recommended):
- Small: pre-flight summary, proceed unless user objects
- Medium/large: present checkbox plan, wait for explicit approval

Plan format is **mandatory**: `N. [ ] One-line action → target`. See `protocols/PLAN-APPROVAL.md` for spec + examples.

| User says | Action |
|---|---|
| approve/go/yes/lgtm | Execute all |
| skip N | Remove step, execute rest |
| only N,M | Execute only listed |
| for step N, [change] | Modify + execute all |
| add: [desc] after N | Insert, renumber, execute |
| deny/stop/cancel | Cancel entirely |

Execute sequentially. Show `Step 2/5 done: [summary]` after each. If step fails → stop and report.

**`always_ask`**: Same as plan_first but also gates small tasks. Only micro skips.

### 2. Direct vs routed

Direct when: micro/small, routing overhead adds no value, faster to just do it.
Skill when: specialized workflow improves result, user invoked it, medium/large.

### 3. Supporting MCP reads

Fetch minimum required external context first (ticket, calendar, docs, browser state).

### 4. Loop decision

If next move reveals new information → plan to re-enter Observe after.

## Act

### Pre-Act Checkpoint (HARD GATE)

Before executing ANYTHING — Bash, MCP, Write, Edit, API calls:

1. **Checkbox plan presented?** Medium+ tasks require `N. [ ] action → target` format, approved by user. Prose is NOT a plan.
2. **User approved?** Wait for explicit go/approve/yes.
3. **Plan marker written?** Write to `~/.claude/ftm-state/.plan-presented` after approval.
4. **External mutations approved?** Per Approval Gates in orient-protocol.
5. None apply (micro/small, no forced escalation) → proceed.

| Rationalization | Reality |
|---|---|
| "Do as much as you can" = implicit approval | That's the task description, not plan approval |
| "I know what to do, plan is overhead" | Plan is for the USER |
| "Just one small API call first" | One becomes five becomes a full unplanned execution |
| "User seems impatient" | 30-second plan saves 10 minutes of wrong work |

Applies to ALL execution methods including Bash/curl/python. The plan-gate hook catches Edit/Write/MCP; this checkpoint catches everything else.

### Compare Before You Loop (MANDATORY for external systems)

**Never trial-and-error. Always compare first.**

1. **Find working reference** — GET a resource that already works the way you want
2. **Diff** — compare field-by-field against the broken one. Fix is almost always a small, specific difference
3. **Targeted change** — change ONLY what the diff revealed. Verify after each change

**Loop detection red flags:**
- 3+ API calls to same system without success
- Trying different URL formats (underscore vs hyphen, internal vs display ID)
- Shuffling payload fields hoping one works
- Reading API docs for endpoint paths (playbook should have this)

**On detection:** STOP. Tell user: "Tried N approaches, none worked. Comparing against working reference." Do step 1.

See `references/incidents.md` → Braintrust Incident for the cost of skipping this.

### 1. Direct action

Micro: do + summarize. Small (plan_first/always_ask): pre-flight → do → verify → summarize.

### 2. Skill routing

Show one routing line, then invoke: `Routing to ftm-debug: flaky failure with diagnostic uncertainty.`

### 3. MCP execution

Parallel reads, sequential writes, approval gates for external-facing actions.

### 3.5 Draft-before-send

Slack/email/outbound comms → save to `.ftm-drafts/` first. Filename: `YYYY-MM-DD_HH-MM_<type>_<recipient>.md`. Present for approval, update status on send/cancel.

### 4. Blackboard updates (mandatory)

After every completed task:
1. Update `context.json` — current_task, recent_decisions, session_metadata
2. Write experience file to `experiences/YYYY-MM-DD_task-slug.json`
3. Update `experiences/index.json`
4. Include: task_type, tags, outcome, lessons, files_touched, stakeholders, decisions_made, code_patterns, api_gotchas

### 5. Loop

Complete → answer and stop. New info → re-observe. Blocked → ask user. Failed → re-orient, escalate one level.
