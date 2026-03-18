# Production Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring panda-brain from 37.5/50 to 48+/50 by adding CI, eval runner, versioning, docs, and fixing remaining repo name references.

**Architecture:** Shell-based eval runner that validates evals.json assertions via pattern matching on Claude Code output. GitHub Actions CI runs evals, shellcheck, and JSON validation on every push. Docs added as markdown files at repo root.

**Tech Stack:** Bash, GitHub Actions, shellcheck, Node.js (for JSON validation)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `tests/run-evals.sh` | Eval runner — reads evals.json, validates structure, reports pass/fail |
| `tests/validate-skills.sh` | Validates all SKILL.md files have required frontmatter and no hardcoded paths |
| `.github/workflows/ci.yml` | CI pipeline — shellcheck, JSON lint, skill validation, eval structure check |
| `panda-version.txt` | Semantic version file for panda-upgrade to read |
| `CHANGELOG.md` | Release history |
| `CONTRIBUTING.md` | Contributor guide |
| `docs/QUICKSTART.md` | 5-minute getting-started guide |

---

### Task 1: Fix remaining `panda-skills` repo references

**Files:**
- Modify: `panda-upgrade/scripts/check-version.sh`
- Modify: `panda-upgrade/scripts/upgrade.sh`
- Modify: `panda-upgrade/SKILL.md`

- [ ] **Step 1: Fix check-version.sh**

Replace `REPO="kkudumu/panda-skills"` with `REPO="kkudumu/panda-brain"` and update cache dir from `panda-skills` to `panda-brain`.

- [ ] **Step 2: Fix upgrade.sh**

Replace `REPO="kkudumu/panda-skills"` with `REPO="kkudumu/panda-brain"` and update cache reference.

- [ ] **Step 3: Fix panda-upgrade/SKILL.md**

Replace all `panda-skills` references with `panda-brain` (repo name in prose, cache paths, etc.). Keep `panda-skills` only where it refers to the npm package name.

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -r "kkudumu/panda-skills" --include="*.sh" --include="*.md" .`
Expected: Only hits in package.json (npm name) and README (npx command), zero in scripts or SKILL.md files.

- [ ] **Step 5: Commit**

```bash
git add panda-upgrade/
git commit -m "Fix repo name references in upgrade scripts (panda-skills → panda-brain)"
```

---

### Task 2: Create version file and changelog

**Files:**
- Create: `panda-version.txt`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create panda-version.txt**

```
1.0.0
```

Single line, no trailing content. This is what `check-version.sh` reads.

- [ ] **Step 2: Create CHANGELOG.md**

```markdown
# Changelog

## 1.0.0 — 2026-03-18

### Added
- 16 unified intelligence skills with OODA-based cognitive loop
- Persistent blackboard memory (context, experiences, patterns)
- Multi-model council (Claude + Codex + Gemini deliberation)
- Complexity-adaptive execution (ADaPT: micro/small/medium/large)
- Event mesh with 18 typed inter-skill events
- Headless browser daemon (panda-browse)
- Secret scanning git safety gate (panda-git)
- Self-upgrade mechanism (panda-upgrade)
- npm distribution (`npx panda-skills@latest`)
- Cross-platform Node.js installer

### Fixed
- Removed 57 hardcoded user paths — all skills now portable
- Corrected repository URL in README and install instructions
```

- [ ] **Step 3: Commit**

```bash
git add panda-version.txt CHANGELOG.md
git commit -m "Add version file and changelog for v1.0.0"
```

---

### Task 3: Create skill validation test

**Files:**
- Create: `tests/validate-skills.sh`

- [ ] **Step 1: Write the test script**

```bash
#!/usr/bin/env bash
# validate-skills.sh — Verify all SKILL.md files are well-formed
# Checks: frontmatter exists, name field present, description field present,
#          no hardcoded user home paths
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ERRORS=""

for skill_dir in "$REPO_DIR"/panda*/; do
  skill_md="$skill_dir/SKILL.md"
  name=$(basename "$skill_dir")

  [ "$name" = "panda-state" ] && continue

  if [ ! -f "$skill_md" ]; then
    ERRORS="${ERRORS}\n  FAIL  $name — missing SKILL.md"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check frontmatter delimiters
  FIRST_LINE=$(head -1 "$skill_md")
  if [ "$FIRST_LINE" != "---" ]; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md missing frontmatter (no opening ---)"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check name field in frontmatter
  if ! head -20 "$skill_md" | grep -q '^name:'; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md frontmatter missing 'name:' field"
    FAIL=$((FAIL + 1))
  fi

  # Check description field in frontmatter
  if ! head -20 "$skill_md" | grep -q '^description:'; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md frontmatter missing 'description:' field"
    FAIL=$((FAIL + 1))
  fi

  # Check for hardcoded home directory paths
  if grep -q '/Users/[a-zA-Z]' "$skill_md"; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md contains hardcoded user home path"
    FAIL=$((FAIL + 1))
  fi

  PASS=$((PASS + 1))
done

# Check .yml trigger files match skill directories
for yml in "$REPO_DIR"/panda*.yml; do
  name=$(basename "$yml" .yml)
  [ "$name" = "panda-config" ] && continue  # config yml is special
  if [ ! -d "$REPO_DIR/$name" ] && [ "$name" != "panda-config.default" ]; then
    ERRORS="${ERRORS}\n  FAIL  $name.yml — no matching skill directory"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Skill Validation Results"
echo "========================"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"

if [ -n "$ERRORS" ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
fi

echo ""
exit $FAIL
```

- [ ] **Step 2: Make executable and run**

Run: `chmod +x tests/validate-skills.sh && tests/validate-skills.sh`
Expected: All skills pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add tests/validate-skills.sh
git commit -m "Add skill validation test — checks frontmatter and portable paths"
```

---

### Task 4: Create eval structure validator

**Files:**
- Create: `tests/validate-evals.sh`

- [ ] **Step 1: Write the eval validator**

This doesn't run evals through an LLM — it validates the eval JSON files are well-formed and assertions are structured correctly. This is what CI can run on every push.

```bash
#!/usr/bin/env bash
# validate-evals.sh — Verify eval JSON files are well-formed
# Checks: valid JSON, required fields present, assertions have name+description
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ERRORS=""

# Find all evals.json files
EVAL_FILES=$(find "$REPO_DIR" -name "evals.json" -path "*/evals/*" 2>/dev/null)

if [ -z "$EVAL_FILES" ]; then
  echo "No eval files found."
  exit 0
fi

for eval_file in $EVAL_FILES; do
  skill_name=$(echo "$eval_file" | sed "s|$REPO_DIR/||" | cut -d/ -f1)

  # Check valid JSON
  if ! node -e "JSON.parse(require('fs').readFileSync('$eval_file','utf8'))" 2>/dev/null; then
    ERRORS="${ERRORS}\n  FAIL  $skill_name — evals.json is not valid JSON"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check required top-level fields
  MISSING=$(node -e "
    const e = JSON.parse(require('fs').readFileSync('$eval_file','utf8'));
    const missing = [];
    if (!e.skill_name) missing.push('skill_name');
    if (!Array.isArray(e.evals)) missing.push('evals[]');
    if (missing.length) console.log(missing.join(', '));
  " 2>/dev/null)

  if [ -n "$MISSING" ]; then
    ERRORS="${ERRORS}\n  FAIL  $skill_name — evals.json missing: $MISSING"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check each eval entry
  EVAL_ERRORS=$(node -e "
    const e = JSON.parse(require('fs').readFileSync('$eval_file','utf8'));
    const errors = [];
    e.evals.forEach((ev, i) => {
      if (!ev.name) errors.push('eval[' + i + '] missing name');
      if (!ev.prompt) errors.push('eval[' + i + '] (' + (ev.name||'unnamed') + ') missing prompt');
      if (ev.assertions) {
        ev.assertions.forEach((a, j) => {
          if (!a.name) errors.push('eval[' + i + '].assertions[' + j + '] missing name');
          if (!a.description) errors.push('eval[' + i + '].assertions[' + j + '] missing description');
        });
      }
    });
    if (errors.length) console.log(errors.join('\n'));
  " 2>/dev/null)

  if [ -n "$EVAL_ERRORS" ]; then
    while IFS= read -r err; do
      ERRORS="${ERRORS}\n  FAIL  $skill_name — $err"
      FAIL=$((FAIL + 1))
    done <<< "$EVAL_ERRORS"
  else
    EVAL_COUNT=$(node -e "
      const e = JSON.parse(require('fs').readFileSync('$eval_file','utf8'));
      console.log(e.evals.length);
    " 2>/dev/null)
    echo "  OK    $skill_name — $EVAL_COUNT evals, all well-formed"
    PASS=$((PASS + 1))
  fi
done

echo ""
echo "Eval Validation Results"
echo "======================="
echo "  Passed: $PASS skill eval files"
echo "  Failed: $FAIL issues"

if [ -n "$ERRORS" ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
fi

echo ""
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

- [ ] **Step 2: Make executable and run**

Run: `chmod +x tests/validate-evals.sh && tests/validate-evals.sh`
Expected: Both eval files (brainstorm, git) pass validation.

- [ ] **Step 3: Commit**

```bash
git add tests/validate-evals.sh
git commit -m "Add eval structure validator — checks JSON schema and assertion format"
```

---

### Task 5: Create GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Validate skill files
        run: |
          chmod +x tests/validate-skills.sh
          tests/validate-skills.sh

      - name: Validate eval files
        run: |
          chmod +x tests/validate-evals.sh
          tests/validate-evals.sh

      - name: Check for hardcoded paths
        run: |
          if grep -r '/Users/[a-zA-Z]' --include="*.md" --include="*.sh" --include="*.json" --include="*.yml" --include="*.ts" . | grep -v node_modules | grep -v '.git/'; then
            echo "FAIL: Found hardcoded user home paths"
            exit 1
          else
            echo "OK: No hardcoded paths found"
          fi

      - name: Validate JSON files
        run: |
          FAIL=0
          for f in $(find . -name "*.json" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/bun.lock"); do
            if ! node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
              echo "FAIL: $f is not valid JSON"
              FAIL=1
            fi
          done
          exit $FAIL

  shellcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install shellcheck
        run: sudo apt-get install -y shellcheck

      - name: Run shellcheck on scripts
        run: |
          find . -name "*.sh" -not -path "*/node_modules/*" | while read f; do
            echo "Checking: $f"
            shellcheck -S warning "$f" || true
          done
```

- [ ] **Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/ci.yml
git commit -m "Add GitHub Actions CI — skill validation, JSON lint, shellcheck"
```

---

### Task 6: Write quickstart guide

**Files:**
- Create: `docs/QUICKSTART.md`

- [ ] **Step 1: Write the guide**

A practical 5-minute guide showing install → first use → key skills. Not a reference doc — a walkthrough.

- [ ] **Step 2: Commit**

```bash
git add docs/QUICKSTART.md
git commit -m "Add quickstart guide — 5-minute getting-started walkthrough"
```

---

### Task 7: Write contributing guide

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write the guide**

Covers: how to add a new skill, skill file structure, eval format, testing locally, PR process.

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "Add contributing guide for new skill authors"
```

---

### Task 8: Update package.json version and prepare npm publish

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Sync version to 1.0.0**

Verify package.json version matches panda-version.txt (both 1.0.0).

- [ ] **Step 2: Run final verification**

Run: `tests/validate-skills.sh && tests/validate-evals.sh`
Expected: All pass.

- [ ] **Step 3: Commit and tag**

```bash
git add -A
git commit -m "Prepare v1.0.0 release"
git tag -a v1.0.0 -m "v1.0.0 — first distributable release"
```
