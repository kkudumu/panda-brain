---
name: panda-upgrade
description: Self-upgrade mechanism for panda skills ecosystem. Checks GitHub Releases for new versions, caches results for 60min, shows changelog, and copies updated files. Use when user says "upgrade", "update skills", "new version", "check for updates", "panda upgrade".
---

## Events

### Emits
- `task_completed` — when a full upgrade completes successfully (files updated, version confirmed)

### Listens To
(none — panda-upgrade is explicitly invoked by the user and does not respond to events)

# panda-upgrade

Self-upgrade mechanism for the panda skills ecosystem. Fetches the latest release from `kkudumu/panda-brain` on GitHub, compares it to the locally installed version, and copies updated skill files in place.

---

## Version Check Preamble (Passive Notice Pattern)

At the start of any panda skill invocation, you may optionally run the version check to surface available updates without blocking the user's primary task.

**When to run the preamble**: When the user invokes a panda skill and no version check has been shown in this conversation yet.

**Steps**:
1. Run `bash ~/.claude/skills/panda-upgrade/scripts/check-version.sh`
2. Parse the output:
   - `UP_TO_DATE` → Do nothing. Continue with the user's requested skill.
   - `UPGRADE_AVAILABLE <version> <changelog_url>` → Show a one-line notice at the top of your response, then continue:
     ```
     Panda skills update available: <current_version> → <version>. Run /panda upgrade to install. (Changelog: <changelog_url>)
     ```
   - `CHECK_FAILED <reason>` → Silently skip the notice. Do not surface version check errors during preamble checks.

The preamble notice is informational only — do not interrupt the user's workflow or ask for confirmation.

---

## Full Upgrade Flow — `/panda upgrade`

Triggered when the user explicitly says: "upgrade", "update skills", "panda upgrade", "install update", "check for updates", or similar.

### Step 1 — Check Current Status

Run:
```bash
bash ~/.claude/skills/panda-upgrade/scripts/check-version.sh
```

Parse output and branch:

**Branch A — `UP_TO_DATE`**:
> You're on the latest version. No upgrade needed.

Read the current version from `~/.claude/skills/panda-version.txt` (if it exists) and include it in the message:
> You're already on the latest version (vX.Y.Z).

**Branch B — `UPGRADE_AVAILABLE <version> <changelog_url>`**:
Proceed to Step 2.

**Branch C — `CHECK_FAILED <reason>`**:
Show the appropriate error message (see Error Handling section below) and stop.

### Step 2 — Show Upgrade Prompt (UPGRADE_AVAILABLE)

Present the following to the user:

```
Panda skills upgrade available!

  Current: <current_version from panda-version.txt or "(not installed)">
  Latest:  <version>
  Changes: <changelog_url>

Would you like to install this upgrade? (yes/no)
```

Wait for user confirmation before proceeding.

### Step 3 — Run Upgrade (after user confirms)

Run:
```bash
bash ~/.claude/skills/panda-upgrade/scripts/upgrade.sh
```

Stream the output to the user as it runs.

On success, confirm:
> Upgrade complete. Panda skills updated to <version>. Restart Claude Code to load new skills.

On failure (non-zero exit or error lines in output):
> Upgrade failed. See error above. If the problem persists, try: `bash ~/.claude/skills/panda-upgrade/scripts/upgrade.sh` manually.

---

## Manual Version Check — `/panda upgrade check`

When the user says "panda upgrade check", "check version", or "what version am I on":

1. Run `bash ~/.claude/skills/panda-upgrade/scripts/check-version.sh`
2. Also read `~/.claude/skills/panda-version.txt` for the installed version
3. Show a status summary:

**If UP_TO_DATE**:
```
Panda skills version: <version> (latest)
```

**If UPGRADE_AVAILABLE**:
```
Panda skills version: <current> (update available: <latest>)
Changelog: <changelog_url>

Run /panda upgrade to install.
```

**If CHECK_FAILED**:
Show the appropriate error (see Error Handling below).

**If panda-version.txt does not exist**:
```
No version file found at ~/.claude/skills/panda-version.txt.
Panda skills may not have been installed via panda-upgrade, or this is a fresh install.
```

---

## Error Handling

Map `CHECK_FAILED <reason>` codes to user-facing messages:

| Reason code | User message |
|---|---|
| `gh_not_installed` | GitHub CLI is not installed. Install it with: `brew install gh` (macOS) or see https://cli.github.com |
| `no_internet` | Cannot reach GitHub. Check your internet connection and try again. |
| `repo_not_found` | Repository `kkudumu/panda-brain` not found. Verify you have access to the repository. |
| `no_releases_found` | No releases found in the repository yet. Check back later. |
| any other reason | Version check failed: `<reason>`. Try running manually: `bash ~/.claude/skills/panda-upgrade/scripts/check-version.sh` |

---

## Script Reference

| Script | Purpose |
|---|---|
| `~/.claude/skills/panda-upgrade/scripts/check-version.sh` | Query GitHub for latest release, cache result 60 min |
| `~/.claude/skills/panda-upgrade/scripts/upgrade.sh` | Download and install latest release |

**Cache location**: `~/.cache/panda-brain/version-check`
**Version file**: `~/.claude/skills/panda-version.txt`
**Repo**: `kkudumu/panda-brain`
