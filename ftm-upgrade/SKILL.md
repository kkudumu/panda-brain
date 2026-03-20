---
name: ftm-upgrade
description: Self-upgrade mechanism for ftm skills ecosystem. Checks GitHub Releases for new versions, caches results for 60min, shows changelog, and copies updated files. Use when user says "upgrade", "update skills", "new version", "check for updates", "ftm upgrade".
---

## Events

### Emits
- `task_completed` — when a full upgrade completes successfully (files updated, version confirmed)

### Listens To
(none — ftm-upgrade is explicitly invoked by the user and does not respond to events)

# ftm-upgrade

Self-upgrade mechanism for the ftm skills ecosystem. Fetches the latest release from `kkudumu/ftm-brain` on GitHub, compares it to the locally installed version, and copies updated skill files in place.

---

## Version Check Preamble (Passive Notice Pattern)

At the start of any ftm skill invocation, you may optionally run the version check to surface available updates without blocking the user's primary task.

**When to run the preamble**: When the user invokes a ftm skill and no version check has been shown in this conversation yet.

**Steps**:
1. Run `bash ~/.claude/skills/ftm-upgrade/scripts/check-version.sh`
2. Parse the output:
   - `UP_TO_DATE` → Do nothing. Continue with the user's requested skill.
   - `UPGRADE_AVAILABLE <version> <changelog_url>` → Show a one-line notice at the top of your response, then continue:
     ```
     FTM skills update available: <current_version> → <version>. Run /ftm upgrade to install. (Changelog: <changelog_url>)
     ```
   - `CHECK_FAILED <reason>` → Silently skip the notice. Do not surface version check errors during preamble checks.

The preamble notice is informational only — do not interrupt the user's workflow or ask for confirmation.

---

## Full Upgrade Flow — `/ftm upgrade`

Triggered when the user explicitly says: "upgrade", "update skills", "ftm upgrade", "install update", "check for updates", or similar.

### Step 1 — Check Current Status

Run:
```bash
bash ~/.claude/skills/ftm-upgrade/scripts/check-version.sh
```

Parse output and branch:

**Branch A — `UP_TO_DATE`**:
> You're on the latest version. No upgrade needed.

Read the current version from `~/.claude/skills/ftm-version.txt` (if it exists) and include it in the message:
> You're already on the latest version (vX.Y.Z).

**Branch B — `UPGRADE_AVAILABLE <version> <changelog_url>`**:
Proceed to Step 2.

**Branch C — `CHECK_FAILED <reason>`**:
Show the appropriate error message (see Error Handling section below) and stop.

### Step 2 — Show Upgrade Prompt (UPGRADE_AVAILABLE)

Present the following to the user:

```
FTM skills upgrade available!

  Current: <current_version from ftm-version.txt or "(not installed)">
  Latest:  <version>
  Changes: <changelog_url>

Would you like to install this upgrade? (yes/no)
```

Wait for user confirmation before proceeding.

### Step 3 — Run Upgrade (after user confirms)

Run:
```bash
bash ~/.claude/skills/ftm-upgrade/scripts/upgrade.sh
```

Stream the output to the user as it runs.

On success, confirm:
> Upgrade complete. FTM skills updated to <version>. Restart Claude Code to load new skills.

On failure (non-zero exit or error lines in output):
> Upgrade failed. See error above. If the problem persists, try: `bash ~/.claude/skills/ftm-upgrade/scripts/upgrade.sh` manually.

---

## Manual Version Check — `/ftm upgrade check`

When the user says "ftm upgrade check", "check version", or "what version am I on":

1. Run `bash ~/.claude/skills/ftm-upgrade/scripts/check-version.sh`
2. Also read `~/.claude/skills/ftm-version.txt` for the installed version
3. Show a status summary:

**If UP_TO_DATE**:
```
FTM skills version: <version> (latest)
```

**If UPGRADE_AVAILABLE**:
```
FTM skills version: <current> (update available: <latest>)
Changelog: <changelog_url>

Run /ftm upgrade to install.
```

**If CHECK_FAILED**:
Show the appropriate error (see Error Handling below).

**If ftm-version.txt does not exist**:
```
No version file found at ~/.claude/skills/ftm-version.txt.
FTM skills may not have been installed via ftm-upgrade, or this is a fresh install.
```

---

## Error Handling

Map `CHECK_FAILED <reason>` codes to user-facing messages:

| Reason code | User message |
|---|---|
| `gh_not_installed` | GitHub CLI is not installed. Install it with: `brew install gh` (macOS) or see https://cli.github.com |
| `no_internet` | Cannot reach GitHub. Check your internet connection and try again. |
| `repo_not_found` | Repository `kkudumu/ftm-brain` not found. Verify you have access to the repository. |
| `no_releases_found` | No releases found in the repository yet. Check back later. |
| any other reason | Version check failed: `<reason>`. Try running manually: `bash ~/.claude/skills/ftm-upgrade/scripts/check-version.sh` |

---

## Script Reference

| Script | Purpose |
|---|---|
| `~/.claude/skills/ftm-upgrade/scripts/check-version.sh` | Query GitHub for latest release, cache result 60 min |
| `~/.claude/skills/ftm-upgrade/scripts/upgrade.sh` | Download and install latest release |

**Cache location**: `~/.cache/ftm-brain/version-check`
**Version file**: `~/.claude/skills/ftm-version.txt`
**Repo**: `kkudumu/ftm-brain`

## Requirements

- tool: `gh` | required | GitHub CLI for querying releases from kkudumu/ftm-brain
- reference: `~/.claude/skills/ftm-upgrade/scripts/check-version.sh` | required | version check and cache script
- reference: `~/.claude/skills/ftm-upgrade/scripts/upgrade.sh` | required | download and install latest release script
- reference: `~/.claude/skills/ftm-version.txt` | optional | locally installed version number

## Risk

- level: high_write
- scope: downloads and overwrites skill files in ~/.claude/skills/ on upgrade; changes affect all ftm skill behavior going forward; irreversible without restoring previous version from backup or git
- rollback: restore from ~/.claude/skills/ backup if one was made before upgrade; or reinstall specific version by downloading an older release tarball

## Approval Gates

- trigger: UPGRADE_AVAILABLE detected | action: show current and latest version with changelog URL, wait for explicit "yes" confirmation before running upgrade.sh
- trigger: version check during preamble (passive notice pattern) | action: show one-line notice only, do NOT ask for confirmation or interrupt workflow
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: gh not installed | action: report "GitHub CLI not installed" with brew install gh instructions
- condition: no internet connection | action: report "Cannot reach GitHub. Check internet connection."
- condition: kkudumu/ftm-brain repo not found | action: report repo not found, suggest verifying access
- condition: no releases found | action: report "No releases found yet. Check back later."
- condition: upgrade.sh exits non-zero | action: report failure output, suggest running script manually

## Capabilities

- cli: `gh` | required | GitHub CLI for release queries and download
- cli: `bash` | required | for running check-version.sh and upgrade.sh

## Event Payloads

### task_completed
- skill: string — "ftm-upgrade"
- action: string — "check" | "upgrade" | "already_up_to_date"
- current_version: string | null — version before upgrade
- new_version: string | null — version after upgrade (null if no upgrade)
- status: string — "success" | "failed" | "up_to_date" | "check_failed"
