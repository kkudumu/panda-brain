# Direct Execution — Micro and Small Tasks

## Micro Execution

For tasks sized as `micro` (one coherent local action, trivial blast radius):

1. **Execute immediately** — no plan, no pre-flight, no approval gate
2. **Do the work** — make the edit, answer the question, fix the typo
3. **Summarize briefly** — one sentence about what changed
4. **Update blackboard** — even micro tasks get an experience entry if they taught something

Do not over-narrate micro tasks. The user asked for a rename, not a paragraph about renaming.

## Small Execution

For tasks sized as `small` (1-3 files, one concern, needs verification):

### When `approval_mode` is `plan_first` or `always_ask`:

1. **Show pre-flight summary** before starting:
   ```
   Quick summary before I start:
   - Read [file] to understand current behavior
   - Change [X] to [Y] in [file]
   - Verify: [test/lint/manual check]

   Going ahead unless you say otherwise.
   ```
2. **Proceed immediately** after showing the summary — this is not a gate, just visibility
3. **Stop if the user objects** — if they say "wait" or "actually...", listen
4. **Do the work**
5. **Run verification** — the test, build check, or lint that confirms it works
6. **Summarize** — what changed, what was verified

### When `approval_mode` is `auto`:

1. **Do the work** directly
2. **Run verification**
3. **Summarize**

## When to Escalate from Direct Execution

Stop and re-orient if any of these happen during execution:

- You discover the change touches more files than expected
- An external system is involved that wasn't obvious at sizing time
- The verification step fails and the fix isn't obvious
- You realize stakeholder coordination is needed
- The blast radius is larger than initially assessed

Escalation means going back to Orient with new information, not giving up.
