# Decide + Act Protocol

## Decide

Decide turns the orientation model into one concrete next move.

### 1. Choose the smallest correct execution mode

- `micro` -> direct action
- `small` -> pre-flight summary, then direct action plus verification
- `medium` -> numbered plan, wait for approval, then execute
- `large` -> `ftm-brainstorm` if no plan exists, or `ftm-executor` if a plan exists

**Double-check before committing to a size**: Re-read the forced escalation signals from the Complexity Sizing reference. If any forced-medium signals fired, the task is medium regardless of how it feels.

### 1.5 Interactive Plan Approval

Read `~/.claude/ftm-config.yml` field `execution.approval_mode`. This controls whether the user sees and approves the plan before execution begins.

#### Mode: `auto` (default legacy behavior)
Skip this section entirely. Execute as before — micro/small just go, medium outlines steps and executes, large routes to brainstorm/executor.

#### Mode: `plan_first` (recommended for collaborative work)

**For small tasks**: Show a brief pre-flight summary before executing. Not a formal gate — just visibility:

```
Quick summary before I start:
- Read [file] to understand current behavior
- Change [X] to [Y] in [file]
- Verify: [test/lint/manual check]

Going ahead unless you say otherwise.
```

**For medium and large tasks**: Present a numbered task list and wait for the user to approve.

**Step 0: Discovery Interview (if applicable).** Before generating the plan, check whether a Discovery Interview is needed (see Orient reference). If the task involves external systems, stakeholder coordination, or unfamiliar code, run the interview FIRST.

**Step 1: Generate the plan.** Build a numbered list of concrete steps. Each step has:
- A number
- A one-line description
- The files that will be touched
- The verification method

**Step 2: Parse the user's response.**

| User says | Action |
|-----------|--------|
| `approve`, `go`, `yes`, `lgtm`, `ship it` | Execute all steps in order |
| `skip N` or `skip N,M` | Remove those steps, execute the rest |
| `only N,M,P` | Execute only the listed steps in order |
| `for step N, [instruction]` | Replace step N's approach, then execute all |
| `add: [description] after N` | Insert a new step, renumber, then execute all |
| `deny`, `stop`, `cancel`, `no` | Cancel. Do not execute anything. |
| A longer message with mixed feedback | Parse each instruction. Apply all modifications. Present revised plan and ask for final approval. |

**Step 3: Execute the approved plan.** Work through steps sequentially. After each step show: `Step 2/5 done: [summary].` If a step fails, stop and report.

**Step 4: Post-execution update.** Update blackboard with decisions and experience.

#### Mode: `always_ask`
Same as `plan_first` but applies to **small** tasks too. Only micro tasks skip the approval gate.

#### Combining with explicit skill routing
When routing to a skill, plan approval still applies if mode is `plan_first` or `always_ask`. Present the strategy for user control.

### 2. Choose direct vs routed execution

Use direct execution when:
- the work is micro or small
- routing overhead adds no value
- the answer can be delivered faster than a delegated workflow

Use a ftm skill when:
- its specialized workflow will materially improve the result
- the user explicitly invoked it
- the task is medium/large and the skill is the right vehicle

### 3. Choose any supporting MCP reads

If the request depends on external context, fetch the minimum required state first.

Examples:
- Jira URL -> read the ticket first
- meeting request -> read calendar first
- internal policy question -> search Glean first
- UI bug -> snapshot or inspect browser first

### 4. Decide whether to loop

If the next move will reveal new information, plan to re-enter Observe after the action.

## Act

Act is clean, decisive execution — but execution of **approved** work only.

**Pre-Act checkpoint**: Before executing anything, verify:

1. If `approval_mode` is `plan_first` or `always_ask`, did the user explicitly approve the plan?
2. If the task involves external mutations (see Approval Gates), have you presented the specific actions and received approval?
3. If neither condition applies, proceed.

### 1. Direct action

For micro tasks:
- do the work
- summarize what changed

For small tasks (when `approval_mode` is `plan_first` or `always_ask`):
- show the pre-flight summary first
- then do the work
- verify
- summarize what changed

### 2. Skill routing

Before invoking a skill, show one short routing line.

Examples:
- `Routing to ftm-debug: this is a flaky failure with real diagnostic uncertainty.`
- `Routing to ftm-brainstorm: this is still design-stage and benefits from research-backed planning.`

Then invoke the target skill with the full user input.

### 3. MCP execution

Use:
- parallel reads when safe
- sequential writes
- approval gates only for external-facing actions

### 3.5. Draft-before-send protocol

When composing Slack messages, emails, or any outbound communication, always save the draft locally before sending.

**Drafts folder**: `.ftm-drafts/` in the project root (or `~/.claude/ftm-drafts/` if no project context).

**Ensure the folder exists and is gitignored.** Save every draft before presenting or sending:

- Filename: `YYYY-MM-DD_HH-MM_<type>_<recipient-or-channel>.md`
- Content includes frontmatter: type, to, subject (email only), drafted timestamp, status (draft/sent/cancelled)

**Workflow:**
1. Compose the message
2. Save to `.ftm-drafts/`
3. Present to user for approval
4. If approved and sent, update `status: sent`
5. If cancelled or modified, update accordingly

### 4. Blackboard updates (mandatory)

After every completed task, update the blackboard:

1. Update `context.json` — set `current_task` to reflect what was done, append to `recent_decisions`
2. Update `session_metadata.skills_invoked` if a skill was used
3. Write an experience file to `~/.claude/ftm-state/blackboard/experiences/YYYY-MM-DD_task-slug.json`
4. Update `~/.claude/ftm-state/blackboard/experiences/index.json` with the new entry

The experience file should capture:
- `task_type`, `tags`, `outcome`, `lessons`, `files_touched`, `stakeholders`, `decisions_made`

Follow the schema and full-file write rules from `blackboard-schema.md`.

### 5. Loop

After acting:

- if complete, answer and stop
- if new information appeared, return to Observe
- if blocked by approval or missing info, ask the user
- if the simple approach failed, re-orient and escalate one level
