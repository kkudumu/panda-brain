#!/usr/bin/env bash
# validate-skills.sh — Verify all SKILL.md files are well-formed
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

  FIRST_LINE=$(head -1 "$skill_md")
  if [ "$FIRST_LINE" != "---" ]; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md missing frontmatter (no opening ---)"
    FAIL=$((FAIL + 1))
    continue
  fi

  if ! head -20 "$skill_md" | grep -q '^name:'; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md frontmatter missing 'name:' field"
    FAIL=$((FAIL + 1))
  fi

  if ! head -20 "$skill_md" | grep -q '^description:'; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md frontmatter missing 'description:' field"
    FAIL=$((FAIL + 1))
  fi

  if grep -q '/Users/[a-zA-Z]' "$skill_md"; then
    ERRORS="${ERRORS}\n  FAIL  $name — SKILL.md contains hardcoded user home path"
    FAIL=$((FAIL + 1))
  fi

  PASS=$((PASS + 1))
done

for yml in "$REPO_DIR"/panda*.yml; do
  name=$(basename "$yml" .yml)
  [ "$name" = "panda-config" ] && continue
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
