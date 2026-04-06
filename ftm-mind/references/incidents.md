# Incident Reference

Named incidents referenced by Orient and Decide-Act protocols. Read this file only when an incident name is cited and you need the full context.

## Hindsight Incident (March 2026)

**What happened**: ftm-mind took an SSO setup task and autonomously created Okta groups, added users to production Okta, created Freshservice records, a service catalog item, and modified S3 workflow configs — all without presenting a plan or asking for approval once.

**Root cause**: No plan-first gate existed. The task "felt small" but touched 5+ external systems.

**What it taught us**: Any task that calls production APIs is forced-medium. Plans are mandatory. Approval gates are circuit breakers, not suggestions.

## Braintrust Incident (April 2026)

**What happened**: Freshservice catalog items #626 and #621 were deleted and recreated as #631 and #632 to "fix" duplicate fields. This broke the S3 workflow config (assign_after_app_owner_approval), required emergency patching, and custom_lookup_bigint fields had to be re-added manually.

**Root cause**: Three knowledge sources existed (playbook, blackboard, brain.py) and none were consulted. Then, when trial-and-error failed, the model chose a destructive action (delete + recreate) without considering dependencies or asking for approval.

**What it taught us**:
1. Always check playbooks before external system operations
2. Never delete and recreate external resources — IDs are depended on
3. Compare working references against broken ones instead of guessing
4. A one-field diff (`requester_can_edit: "true"`) was the entire fix — discoverable in 30 seconds by comparing the working HR Acuity item against the broken ones
