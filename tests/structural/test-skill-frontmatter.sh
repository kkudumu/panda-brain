#!/usr/bin/env bash
# tests/structural/test-skill-frontmatter.sh
# Validates all skill YML and SKILL.md frontmatter fields are well-formed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0
ERRORS=""

pass() {
  local name="$1"
  echo "  PASS  $name"
  PASS=$((PASS + 1))
}

fail() {
  local name="$1"
  local reason="$2"
  echo "  FAIL  $name"
  echo "        $reason"
  ERRORS="${ERRORS}\n  FAIL  $name — $reason"
  FAIL=$((FAIL + 1))
}

# ---------------------------------------------------------------------------
# Helper: extract frontmatter value from a SKILL.md file
# ---------------------------------------------------------------------------
get_field() {
  local file="$1"
  local field="$2"
  # Grab lines between opening --- and closing ---
  awk '/^---$/{if(++n==2)exit} n==1 && /^'"$field"':/{print}' "$file" \
    | sed "s/^${field}:[[:space:]]*//" \
    | tr -d '"' \
    | head -1
}

# ---------------------------------------------------------------------------
# Check: every ftm-*.yml has a 'name' and 'description' field
# ---------------------------------------------------------------------------
echo ""
echo "--- ftm-*.yml files: required frontmatter fields"

for yml_file in "$REPO_DIR"/ftm*.yml; do
  [ -f "$yml_file" ] || continue
  base="$(basename "$yml_file" .yml)"

  # Skip config/template files that are not skill trigger files
  case "$base" in
    ftm-config|ftm-config.default) continue ;;
  esac

  if ! grep -q '^name:' "$yml_file"; then
    fail "$base.yml" "missing 'name:' field"
  else
    pass "$base.yml has name: field"
  fi

  if ! grep -q '^description:' "$yml_file"; then
    fail "$base.yml" "missing 'description:' field"
  else
    pass "$base.yml has description: field"
  fi

  # description must be non-empty and > 20 chars
  DESC=$(grep '^description:' "$yml_file" | head -1 | sed 's/^description:[[:space:]]*//')
  DESC_LEN=${#DESC}
  if [ "$DESC_LEN" -lt 20 ]; then
    fail "$base.yml" "description too short (${DESC_LEN} chars, need > 20): $DESC"
  else
    pass "$base.yml description length OK (${DESC_LEN} chars)"
  fi
done

# ---------------------------------------------------------------------------
# Check: every ftm-*/SKILL.md frontmatter
# ---------------------------------------------------------------------------
echo ""
echo "--- SKILL.md files: required frontmatter fields"

for skill_dir in "$REPO_DIR"/ftm*/; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  [ "$skill_name" = "ftm-state" ] && continue

  skill_md="$skill_dir/SKILL.md"

  # Must have SKILL.md
  if [ ! -f "$skill_md" ]; then
    fail "$skill_name" "missing SKILL.md"
    continue
  fi

  # Must open with ---
  first_line="$(head -1 "$skill_md")"
  if [ "$first_line" != "---" ]; then
    fail "$skill_name/SKILL.md" "frontmatter not opened with --- (got: $first_line)"
    continue
  fi
  pass "$skill_name/SKILL.md opens with ---"

  # Must have name: field
  if ! head -20 "$skill_md" | grep -q '^name:'; then
    fail "$skill_name/SKILL.md" "missing 'name:' field in frontmatter"
  else
    pass "$skill_name/SKILL.md has name: field"
  fi

  # Must have description: field
  if ! head -20 "$skill_md" | grep -q '^description:'; then
    fail "$skill_name/SKILL.md" "missing 'description:' field in frontmatter"
  else
    pass "$skill_name/SKILL.md has description: field"
  fi

  # name: must match directory name
  FM_NAME=$(head -20 "$skill_md" | grep '^name:' | head -1 | sed 's/^name:[[:space:]]*//' | tr -d '[:space:]')
  if [ -n "$FM_NAME" ] && [ "$FM_NAME" != "$skill_name" ]; then
    fail "$skill_name/SKILL.md" "name: '${FM_NAME}' does not match directory '${skill_name}'"
  elif [ -n "$FM_NAME" ]; then
    pass "$skill_name/SKILL.md name matches directory"
  fi

  # description: must be non-empty and > 20 chars
  FM_DESC=$(head -20 "$skill_md" | grep '^description:' | head -1 | sed 's/^description:[[:space:]]*//')
  FM_DESC_LEN=${#FM_DESC}
  if [ "$FM_DESC_LEN" -lt 20 ]; then
    fail "$skill_name/SKILL.md" "description too short (${FM_DESC_LEN} chars, need > 20)"
  else
    pass "$skill_name/SKILL.md description length OK (${FM_DESC_LEN} chars)"
  fi

  # No XML angle brackets in frontmatter (security restriction)
  # Extract frontmatter section only
  FRONTMATTER=$(awk '/^---$/{if(++n==2)exit} n>=1{print}' "$skill_md")
  if echo "$FRONTMATTER" | grep -q '[<>]'; then
    fail "$skill_name/SKILL.md" "frontmatter contains XML angle brackets (security restriction)"
  else
    pass "$skill_name/SKILL.md no XML angle brackets in frontmatter"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "Frontmatter Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
  exit 1
fi

echo ""
exit 0
