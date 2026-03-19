#!/usr/bin/env bash
# tests/structural/test-no-hardcoded-paths.sh
# Scan all tracked files for hardcoded user home directory paths.
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

# Files explicitly allowed to contain historical paths (CHANGELOG, etc.)
ALLOWED_FILES=(
  "CHANGELOG.md"
  "CONTRIBUTING.md"
)

is_allowed() {
  local file="$1"
  local base
  base="$(basename "$file")"
  for allowed in "${ALLOWED_FILES[@]}"; do
    [ "$allowed" = "$base" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Gather files to scan: all tracked text files (avoid node_modules, .git, binaries)
# ---------------------------------------------------------------------------
echo ""
echo "--- Scanning for hardcoded /Users/ paths"

# Build list of candidate files
SCAN_FILES=()
while IFS= read -r -d '' f; do
  SCAN_FILES+=("$f")
done < <(find "$REPO_DIR" \
  -not \( -path "$REPO_DIR/node_modules/*" -prune \) \
  -not \( -path "$REPO_DIR/.git/*" -prune \) \
  -not \( -path "$REPO_DIR/tests/*" -prune \) \
  -type f \
  -not -name "*.png" \
  -not -name "*.jpg" \
  -not -name "*.ico" \
  -not -name "*.woff*" \
  -not -name "*.ttf" \
  -not -name "*.eot" \
  -not -name "*.pdf" \
  -print0 2>/dev/null)

CHECKED=0
for f in "${SCAN_FILES[@]}"; do
  rel="$(realpath --relative-to="$REPO_DIR" "$f" 2>/dev/null || echo "$f")"

  is_allowed "$f" && continue

  # Check for /Users/<username> pattern (hardcoded home paths)
  if grep -qE '/Users/[a-zA-Z][a-zA-Z0-9._-]+' "$f" 2>/dev/null; then
    MATCHES=$(grep -nE '/Users/[a-zA-Z][a-zA-Z0-9._-]+' "$f" 2>/dev/null | head -5)
    fail "$rel" "contains hardcoded /Users/ path: $MATCHES"
  else
    CHECKED=$((CHECKED + 1))
  fi
done

pass "$CHECKED files checked — no hardcoded /Users/ paths"

# ---------------------------------------------------------------------------
# Scan for hardcoded home directory shorthand (e.g., /home/username/...)
# ---------------------------------------------------------------------------
echo ""
echo "--- Scanning for hardcoded /home/<user> paths"

HOME_CHECKED=0
for f in "${SCAN_FILES[@]}"; do
  rel="$(realpath --relative-to="$REPO_DIR" "$f" 2>/dev/null || echo "$f")"

  is_allowed "$f" && continue

  # /home/someuser (not just /home/ alone)
  if grep -qE '/home/[a-zA-Z][a-zA-Z0-9._-]+/' "$f" 2>/dev/null; then
    MATCHES=$(grep -nE '/home/[a-zA-Z][a-zA-Z0-9._-]+/' "$f" 2>/dev/null | head -5)
    fail "$rel" "contains hardcoded /home/<user>/ path: $MATCHES"
  else
    HOME_CHECKED=$((HOME_CHECKED + 1))
  fi
done

pass "$HOME_CHECKED files checked — no hardcoded /home/<user>/ paths"

# ---------------------------------------------------------------------------
# Spot-check: key skill files don't have hardcoded paths
# ---------------------------------------------------------------------------
echo ""
echo "--- Spot-checking critical skill files for hardcoded paths"

CRITICAL_FILES=(
  "ftm/SKILL.md"
  "ftm-executor/SKILL.md"
  "ftm-mind/SKILL.md"
  "ftm-audit/SKILL.md"
  "ftm-brainstorm/SKILL.md"
  "install.sh"
  "uninstall.sh"
)

for rel_path in "${CRITICAL_FILES[@]}"; do
  fpath="$REPO_DIR/$rel_path"
  if [ ! -f "$fpath" ]; then
    echo "  SKIP  $rel_path (not found)"
    continue
  fi

  if grep -qE '/Users/[a-zA-Z]' "$fpath" 2>/dev/null; then
    fail "$rel_path" "hardcoded /Users/ path found"
  else
    pass "$rel_path clean"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "Hardcoded Path Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
  exit 1
fi

echo ""
exit 0
