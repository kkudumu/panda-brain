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

The first time ftm-git runs in a repo, install a pre-commit hook as a hard safety net. This hook runs independently of Claude — it's a shell script that blocks `git commit` if staged files contain Tier 1 secret patterns. Even if Claude forgets to invoke this skill, or someone runs git directly from the terminal, the hook catches it.

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

### Tier 1: High-Confidence Patterns (almost certainly real secrets)

These patterns have distinctive prefixes or structures that make false positives rare:

```
# AWS
AKIA[0-9A-Z]{16}                                          # AWS Access Key ID
amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}  # AWS MWS

# GitHub
ghp_[A-Za-z0-9_]{36}                                      # GitHub PAT (classic)
gho_[A-Za-z0-9_]{36}                                      # GitHub OAuth
ghu_[A-Za-z0-9_]{36}                                      # GitHub user token
ghs_[A-Za-z0-9_]{36}                                      # GitHub server token
github_pat_[A-Za-z0-9_]{82}                                # GitHub fine-grained PAT

# Slack
xoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}           # Slack bot token
xoxp-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}        # Slack user token
xoxa-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}        # Slack app token
xoxr-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}        # Slack refresh token

# Google
AIza[0-9A-Za-z\-_]{35}                                    # Google API key

# Stripe
sk_live_[0-9a-zA-Z]{24,}                                  # Stripe secret key (live)
sk_test_[0-9a-zA-Z]{24,}                                  # Stripe secret key (test)
rk_live_[0-9a-zA-Z]{24,}                                  # Stripe restricted key

# Other services
SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}               # SendGrid
SK[0-9a-fA-F]{32}                                          # Twilio
npm_[A-Za-z0-9]{36}                                        # npm token
pypi-[A-Za-z0-9\-_]{100,}                                 # PyPI token
glpat-[A-Za-z0-9\-_]{20,}                                 # GitLab PAT
-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----      # Private keys
```

### Tier 2: Context-Dependent Patterns (need surrounding context to confirm)

These match common assignment patterns. Check that the value isn't a placeholder, empty string, or env var reference before flagging:

```
# Generic key/secret assignments — flag if value looks real (not placeholder)
(api_key|apikey|api-key)\s*[:=]\s*["']?[A-Za-z0-9\-_]{16,}["']?
(secret|secret_key|client_secret)\s*[:=]\s*["']?[A-Za-z0-9\-_]{16,}["']?
(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}["']?
(token|access_token|auth_token)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{16,}["']?
(database_url|db_url|connection_string)\s*[:=]\s*["']?[^\s"']{20,}["']?

# Bearer tokens in code
bearer\s+[A-Za-z0-9\-._~+/]{20,}

# Webhook URLs with tokens
https://hooks\.slack\.com/services/T[A-Z0-9]{8,}/B[A-Z0-9]{8,}/[a-zA-Z0-9]{24}
```

### What to Ignore (false positive suppression)

Skip matches that are clearly not real secrets:

- Values that are `""`, `''`, `None`, `null`, `undefined`, `TODO`, `CHANGEME`, `your-key-here`, `xxx`, `placeholder`, `example`, `test`, `dummy`, `fake`, `sample`
- References to environment variables: `os.environ[`, `process.env.`, `ENV[`, `${`, `os.getenv(`
- Lines that are comments (`#`, `//`, `/*`, `--`)
- Files in `node_modules/`, `.git/`, `vendor/`, `__pycache__/`, `dist/`, `build/`
- Files that are themselves `.env.example`, `.env.sample`, `.env.template`
- Lock files (`package-lock.json`, `yarn.lock`, `Gemfile.lock`, `poetry.lock`)
- Test fixtures where the "secret" is obviously fake (e.g., `test_api_key = "sk_test_abc123"` in a test file — but still flag `sk_live_*` in test files, those are real)

### Running the Scan

Use the Grep tool to search in-scope files for each pattern. Run Tier 1 patterns in parallel since they're independent. For Tier 2, check surrounding context before confirming.

For each finding, record:
- **file**: absolute path
- **line**: line number
- **pattern**: which pattern matched
- **tier**: 1 or 2
- **value_preview**: first 8 chars + `...` + last 4 chars (never log the full secret)
- **context**: the surrounding code (with the secret value masked)

## Phase 2: Validate Findings

For each Tier 2 match, read the surrounding context (5 lines before and after) and determine:

1. **Is the value a real secret or a placeholder?** — Check against the ignore list above.
2. **Is it already using an env var?** — If the code does `key = os.environ.get("API_KEY", "sk_live_abc...")`, the hardcoded value is a fallback default. Still a finding — fallback defaults with real secrets are dangerous.
3. **Is it in a file that should be gitignored?** — If the secret is in `.env` and `.env` is in `.gitignore`, it's fine. If `.env` is NOT in `.gitignore`, that's a separate finding.

After validation, produce a findings list sorted by severity:

| Severity | Meaning |
|---|---|
| **CRITICAL** | Tier 1 match (high-confidence secret) in a tracked or staged file |
| **HIGH** | Tier 2 confirmed match in a tracked or staged file |
| **MEDIUM** | `.env` file not in `.gitignore`, or secret in a fallback default |
| **LOW** | Secret in a gitignored file but the gitignore rule might be fragile |

If zero findings after validation: emit `secrets_clear` and proceed. The commit/push is safe.

If any CRITICAL or HIGH findings: **STOP. The commit/push is BLOCKED.** Say this explicitly to the user before doing anything else:

```
ftm-git: BLOCKED — <N> secret(s) found. Commit/push halted. Attempting auto-remediation...
```

Then proceed to Phase 3 to fix. The commit/push does NOT happen until Phase 3 completes and a re-scan in Phase 3 Step 5 comes back clean. This is non-negotiable — even if you can fix the secrets, the user needs to see that the operation was blocked and why.

## Phase 3: Auto-Remediate

For each finding, apply the appropriate fix automatically. The goal is to make the code safe without breaking functionality.

### Step 1: Ensure .env infrastructure exists

Check for a `.env` file in the project root. If it doesn't exist, create one with a header comment:

```
# Environment variables — DO NOT COMMIT THIS FILE
# Copy .env.example for the template, fill in real values locally
```

Check `.gitignore` for `.env` coverage. If missing, add:
```
# Environment files with secrets
.env
.env.local
.env.production
.env.staging
.env.*.local
```

### Step 2: Extract secrets to .env

For each finding:

1. **Choose an env var name** — derive it from the context. If the code says `STRIPE_API_KEY = "sk_live_..."`, the env var is `STRIPE_API_KEY`. If it says `api_key: "AIza..."`, infer from the file/service context (e.g., `GOOGLE_API_KEY`). Use SCREAMING_SNAKE_CASE.

2. **Add to .env** — append `VAR_NAME=<actual-secret-value>` to `.env`. If the var already exists, don't duplicate it.

3. **Add to .env.example** — create or update `.env.example` with `VAR_NAME=your-value-here` so other developers know the variable exists without seeing the real value.

### Step 3: Refactor source files

Replace the hardcoded secret with an env var reference. Match the language/framework:

| Language | Pattern |
|---|---|
| Python | `os.environ["VAR_NAME"]` or `os.getenv("VAR_NAME")` (match existing style in file) |
| JavaScript/TypeScript | `process.env.VAR_NAME` |
| Ruby | `ENV["VAR_NAME"]` or `ENV.fetch("VAR_NAME")` |
| Go | `os.Getenv("VAR_NAME")` |
| Java | `System.getenv("VAR_NAME")` |
| Shell/Bash | `$VAR_NAME` or `${VAR_NAME}` |
| YAML/JSON config | `${VAR_NAME}` (if the framework supports interpolation) or add a comment pointing to the env var |

If the file doesn't already import the env-reading module (e.g., `import os` in Python, `require('dotenv').config()` in Node), add the import. Check if the project uses `python-dotenv`, `dotenv` (Node), or similar — if so, use the project's existing pattern for loading env vars.

### Step 4: Unstage remediated files

After refactoring, make sure the `.env` file (with real secrets) is NOT staged:

```bash
git reset HEAD .env 2>/dev/null  # unstage if accidentally staged
```

Stage the refactored source files (which now reference env vars instead of hardcoded secrets):

```bash
git add <refactored-files>
```

### Step 5: Verify the fix

Re-run Phase 1 scan on the refactored files to confirm the secrets are gone. If any remain, loop back and fix. Do not proceed until the scan is clean.

## Phase 4: Report

After remediation (or if the scan was clean from the start), produce a summary:

**Clean scan:**
```
ftm-git: Clean scan. 0 secrets found in <N> files scanned. Safe to commit.
```

**After remediation:**
```
ftm-git: Found <N> hardcoded secrets. Auto-remediated:

  CRITICAL: sk_live_**** in src/payments.py:42 -> STRIPE_SECRET_KEY
  HIGH:     AIza**** in config/google.ts:18 -> GOOGLE_API_KEY
  MEDIUM:   .env was not in .gitignore -> added

Actions taken:
  - Extracted <N> secrets to .env (gitignored)
  - Created/updated .env.example with placeholder vars
  - Refactored <N> source files to use env var references
  - Updated .gitignore

Verify the app still works with the new env var setup, then commit.
```

**Blocked (auto-fix not possible):**

Some secrets can't be auto-fixed — for example, a private key embedded in a binary file, or a secret in a format the skill can't safely refactor. In these cases:

```
ftm-git: BLOCKED. Found secrets that require manual remediation:

  CRITICAL: Private key in assets/cert.pem:1
            -> Move this file outside the repo and reference via path env var

  Action required: Fix the above manually, then run ftm-git again.
```

## Phase 5: Git History Check (Manual Invocation Only)

When explicitly asked to do a deep scan (e.g., "scan the repo history for secrets"), also check past commits. This is expensive so it only runs on explicit request, not as part of the pre-commit gate.

```bash
git log --all --diff-filter=A --name-only --pretty=format:"%H" -- "*.env" "*.pem" "*.key" "*credentials*" "*secret*"
```

For each historically added sensitive file, check if it's still in the current tree. If it was added and later removed, warn that the secret is still in git history and suggest:

1. Rotate the credential immediately (it's compromised)
2. Use `git filter-repo` or BFG Repo Cleaner to purge from history if needed

## Operating Principles

1. **Block first, fix second.** Never let a secret through while figuring out the fix. The commit waits.
2. **Zero false negatives over zero false positives.** It's better to flag something that turns out to be harmless than to miss a real key.
3. **Never log full secrets.** In all output, mask secret values. Show only enough to identify which secret it is (first 8 + last 4 chars).
4. **Env vars are the escape hatch.** The remediation pattern is always: secret goes to gitignored .env, code references the env var.
5. **Existing patterns win.** If the project already uses dotenv, Vault, AWS Secrets Manager, or any other secret management system, match that pattern rather than introducing a new one.
6. **Test files are not exempt.** A real `sk_live_*` key in a test file is just as dangerous as one in production code. Only `sk_test_*` with obviously fake values get a pass.

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
