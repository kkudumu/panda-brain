---
name: ftm-git
description: Secret scanning and credential safety gate for git operations. Prevents API keys, tokens, passwords, and other secrets from ever being committed or pushed to remote repositories. Scans staged files, working tree, and git history for hardcoded credentials using regex pattern matching, then auto-remediates by extracting secrets to gitignored .env files and replacing hardcoded values with env var references. Use when user says "scan for secrets", "check for keys", "audit credentials", "ftm-git", "secret scan", "remove api keys", "check before push", or any time git commit/push operations are about to happen. Also auto-invoked by ftm-executor and ftm-mind before any commit or push operation. Even if the user just says "commit this" or "push to remote", this skill MUST run first. Do NOT use for general git workflow operations like branching or merging — that's git-workflow territory. This skill is specifically the security gate.
---

## Events

### Emits
- `secrets_found` — when scan detects hardcoded credentials in staged files or working tree
- `secrets_clear` — when scan completes with no findings (safe to proceed with commit/push)
- `secrets_remediated` — when auto-fix successfully extracts secrets to .env and refactors source files
- `task_completed` — when full scan + remediation cycle finishes

### Listens To
- `code_changed` — run a quick scan on modified files before they get staged
- `code_committed` — verify the commit doesn't contain secrets (post-commit safety net)

## Blackboard Read

Before starting, load context from the blackboard:

1. Read `~/.claude/ftm-state/blackboard/context.json` — check current_task, recent_decisions, active_constraints
2. Read `~/.claude/ftm-state/blackboard/experiences/index.json` — filter entries by task_type="security" or tags matching "secrets", "credentials", "api-keys", or "git-safety"
3. Load top 3-5 matching experience files for previously found secret patterns and effective remediation strategies
4. Read `~/.claude/ftm-state/blackboard/patterns.json` — check recurring_issues for repeated secret leaks and execution_patterns for which files/directories tend to accumulate secrets

If index.json is empty or no matches found, proceed normally without experience-informed shortcuts.

# FTM Git — Secret Scanning & Credential Safety Gate

This skill exists because secrets pushed to GitHub are compromised the instant they hit the remote — even if you force-push a clean history seconds later. Bots scrape public repos continuously, and private repos are one permissions mistake away from exposure. The only safe secret is one that never enters git history.

This is not a nice-to-have audit. This is a hard gate. Nothing gets committed or pushed until this skill says it's clean.

## Why This Matters

Yesterday we pushed API keys to the repo. That's the kind of mistake that leads to compromised accounts, unexpected bills, and emergency credential rotations. This skill makes it structurally impossible for that to happen again by scanning every file that's about to be committed and blocking the operation if secrets are present — then auto-fixing what it can.

## Phase -1: Install Git Hook (First Invocation Only)

The first time ftm-git runs in a repo, install a pre-commit hook as a hard safety net. This hook runs independently of Claude — it's a shell script that blocks `git commit` if staged files contain Tier 1 secret patterns. Even if this skill is not invoked, or someone runs git directly from the terminal, the hook catches it.

**Check if the hook is already installed:**

```bash
# Look for ftm-git marker in existing pre-commit hook
grep -q "ftm-git" .git/hooks/pre-commit 2>/dev/null
```

**If not installed**, copy the hook script:

```bash
cp ~/.claude/skills/ftm-git/scripts/pre-commit-secrets.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**If a pre-commit hook already exists** (from husky, pre-commit framework, etc.), don't overwrite it. Instead, append the ftm-git scan to the end of the existing hook:

```bash
echo "" >> .git/hooks/pre-commit
echo "# --- ftm-git secret scanner ---" >> .git/hooks/pre-commit
cat ~/.claude/skills/ftm-git/scripts/pre-commit-secrets.sh >> .git/hooks/pre-commit
```

Tell the user: "Installed ftm-git pre-commit hook. Commits with hardcoded secrets will be blocked automatically, even outside of Claude."

This only needs to happen once per repo. On subsequent invocations, skip this phase.

## Phase 0: Determine Scan Scope

Before scanning, figure out what needs scanning and why you were invoked.

**Invocation context determines scope:**

| Context | Scope |
|---|---|
| Pre-commit (explicit or auto-triggered) | Staged files (`git diff --cached --name-only`) + any files about to be staged |
| Pre-push | All commits not yet on remote (`git log @{upstream}..HEAD --name-only`) |
| Manual invocation ("scan for secrets") | Full working tree sweep |
| Post-commit safety net | The commit that just landed (`git diff-tree --no-commit-id -r HEAD`) |

**Always also check these regardless of invocation context:**
- Any `.env` file that is NOT in `.gitignore` — this is itself a finding
- Any file matching `*credentials*`, `*secret*`, `*token*` in the filename

## Phase 1: Pattern Scan

Scan the in-scope files using regex patterns. The goal is zero false negatives — a few false positives are acceptable and will be filtered in Phase 2.

Read `references/patterns/SECRET-PATTERNS.md` for the full Tier 1 and Tier 2 pattern library, the false positive suppression list, severity classifications, and per-finding record format.

**Core Tier 1 patterns** (the most common — memorize these, consult the reference for the full set):

```
AKIA[0-9A-Z]{16}                           # AWS Access Key ID
ghp_[A-Za-z0-9_]{36}                       # GitHub PAT (classic)
sk_live_[0-9a-zA-Z]{24,}                   # Stripe secret key (live)
AIza[0-9A-Za-z\-_]{35}                     # Google API key
xoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}  # Slack bot token
-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----  # Private keys
```

Run Tier 1 patterns in parallel since they're independent. For Tier 2, check surrounding context before confirming.

## Phase 2: Validate Findings

For each Tier 2 match, read the surrounding context (5 lines before and after) and determine:

1. **Is the value a real secret or a placeholder?** — Check against the ignore list in `references/patterns/SECRET-PATTERNS.md`.
2. **Is it already using an env var?** — If the code does `key = os.environ.get("API_KEY", "sk_live_abc...")`, the hardcoded value is a fallback default. Still a finding — fallback defaults with real secrets are dangerous.
3. **Is it in a file that should be gitignored?** — If the secret is in `.env` and `.env` is in `.gitignore`, it's fine. If `.env` is NOT in `.gitignore`, that's a separate finding.

After validation, produce a findings list sorted by severity (CRITICAL → HIGH → MEDIUM → LOW). See `references/patterns/SECRET-PATTERNS.md` for the severity table.

If zero findings after validation: emit `secrets_clear` and proceed. The commit/push is safe.

If any CRITICAL or HIGH findings: **STOP. The commit/push is BLOCKED.** Say this explicitly to the user before doing anything else:

```
ftm-git: BLOCKED — <N> secret(s) found. Commit/push halted. Attempting auto-remediation...
```

Then proceed to Phase 3. The commit/push does NOT happen until Phase 3 completes and a re-scan comes back clean.

## Phase 3: Auto-Remediate

Read `references/protocols/REMEDIATION.md` for the full step-by-step remediation protocol, language-specific env var patterns, report formats (clean/remediated/blocked), and the Phase 5 git history deep scan procedure.

**Summary of steps:**
1. Ensure `.env` and `.gitignore` infrastructure exists
2. Extract each secret to `.env` with a SCREAMING_SNAKE_CASE var name
3. Add placeholder to `.env.example`
4. Refactor source files to reference the env var (match language pattern)
5. Unstage `.env`, re-stage refactored source files
6. Verify: re-run Phase 1 on refactored files — do not proceed until clean

## Phase 4: Report

After remediation or clean scan, produce the summary. Read `references/protocols/REMEDIATION.md` for the exact report formats.

## Integration Points

### With ftm-executor
ftm-executor should invoke ftm-git before every commit operation in its task execution loop. If ftm-git emits `secrets_found`, the executor must pause and remediate before proceeding.

### With ftm-mind
When ftm-mind routes a commit or push request, it should run ftm-git as a prerequisite gate. The commit/push only proceeds after `secrets_clear` or `secrets_remediated`.

### With git-workflow agent
The git-workflow agent should check with ftm-git before executing any commit or push command. If you're about to run `git commit` or `git push`, ftm-git goes first.

## Post-Commit Experience Recording

FTM includes a post-commit hook that guarantees every commit produces an experience entry in the blackboard.

### How It Works

1. After every `git commit`, the hook checks if an experience was recorded in the last 2 minutes
2. If yes (the LLM already recorded a detailed experience) → skip, no duplicate
3. If no → create a minimal experience from commit metadata (hash, message, files, branch)
4. Update the experience index

### Installation

The hook is at `ftm-git/hooks/post-commit-experience.sh`. To install:

```bash
cp ~/.claude/skills/ftm-git/hooks/post-commit-experience.sh .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Or add to your project's husky config if using husky.

### Minimal vs Rich Experiences

- **Minimal** (from hook): commit metadata only, confidence 0.5, tags: `auto-recorded`
- **Rich** (from LLM): full task context, lessons learned, higher confidence, domain-specific tags

The hook ensures no commit goes unrecorded, while the LLM produces richer entries during active sessions.

## Blackboard Write

After completing, update the blackboard:

1. Update `~/.claude/ftm-state/blackboard/context.json`:
   - Set current_task status to "complete"
   - Append scan summary to recent_decisions (cap at 10)
   - Update session_metadata.skills_invoked and last_updated
2. Write an experience file to `experiences/YYYY-MM-DD_secret-scan-<slug>.json` with:
   - Number of files scanned
   - Findings by severity
   - Remediation actions taken
   - Which patterns matched (to improve future scans)
3. Update `experiences/index.json` with the new entry
4. Emit `secrets_clear` or `secrets_remediated` or `secrets_blocked`

## Requirements

- tool: `git` | required | staged file inspection, commit history scanning
- reference: `references/patterns/SECRET-PATTERNS.md` | required | Tier 1/2 patterns, severity table, ignore list
- reference: `references/protocols/REMEDIATION.md` | required | remediation protocol, env var patterns, report formats
- reference: `~/.claude/skills/ftm-git/scripts/pre-commit-secrets.sh` | required | pre-commit hook script for installation
- reference: `~/.claude/skills/ftm-git/hooks/post-commit-experience.sh` | optional | post-commit experience recorder hook

## Risk

- level: medium_write
- scope: modifies source files to replace hardcoded secrets with env var references; creates/updates .env and .env.example files; installs git hooks in .git/hooks/; re-stages files after remediation
- rollback: git checkout on refactored source files; manually remove added .env and .gitignore entries; remove hook from .git/hooks/pre-commit

## Approval Gates

- trigger: CRITICAL or HIGH severity secret found | action: BLOCK commit/push immediately, announce "BLOCKED — N secret(s) found", then attempt auto-remediation
- trigger: auto-remediation proposed for a finding | action: show proposed change (file, variable name, env var name) before applying
- trigger: re-scan after remediation still finds secrets | action: report remaining findings to user, do not proceed with commit
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: .env file does not exist | action: create .env and .env.example and add .env to .gitignore before extracting secrets
- condition: .gitignore does not exist | action: create .gitignore with .env entry before remediation
- condition: language detection fails for env var pattern | action: extract secret to .env but flag source file refactoring as MANUAL_INTERVENTION_NEEDED
- condition: pre-commit hook already exists | action: append ftm-git scan to existing hook rather than overwriting

## Capabilities

- cli: `git` | required | staged file listing, diff inspection, commit history traversal

## Event Payloads

### secrets_found
- skill: string — "ftm-git"
- findings_count: number — total secrets detected
- critical_count: number — CRITICAL severity findings
- high_count: number — HIGH severity findings
- files_affected: string[] — files containing secrets
- blocked: boolean — whether commit/push was halted

### secrets_clear
- skill: string — "ftm-git"
- files_scanned: number — total files checked
- scope: string — "staged" | "working_tree" | "history" | "pre-push"

### secrets_remediated
- skill: string — "ftm-git"
- findings_remediated: number — secrets successfully extracted
- env_vars_added: string[] — environment variable names created
- files_refactored: string[] — source files updated to use env vars
- manual_needed: number — findings requiring manual intervention

### task_completed
- skill: string — "ftm-git"
- outcome: string — "clear" | "remediated" | "blocked"
- files_scanned: number — total files scanned
- duration_ms: number — total scan and remediation time
