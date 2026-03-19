#!/usr/bin/env bash
# tests/structural/test-json-schemas.sh
# Validate JSON files: manifest, schemas, and blackboard data files.
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

is_valid_json() {
  local file="$1"
  node -e "JSON.parse(require('fs').readFileSync('$file','utf8'))" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Check: ftm-manifest.json is valid JSON
# ---------------------------------------------------------------------------
echo ""
echo "--- ftm-manifest.json validity"

MANIFEST="$REPO_DIR/ftm-manifest.json"
if [ ! -f "$MANIFEST" ]; then
  fail "ftm-manifest.json" "file not found"
else
  if is_valid_json "$MANIFEST"; then
    pass "ftm-manifest.json is valid JSON"
  else
    fail "ftm-manifest.json" "not valid JSON"
  fi

  # Must have top-level 'skills' array
  HAS_SKILLS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));
    console.log(Array.isArray(m.skills) ? 'yes' : 'no');
  " 2>/dev/null || echo "error")

  if [ "$HAS_SKILLS" = "yes" ]; then
    pass "ftm-manifest.json has 'skills' array"
  else
    fail "ftm-manifest.json" "missing top-level 'skills' array"
  fi

  # Must have generated_at field
  HAS_TS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));
    console.log(m.generated_at ? 'yes' : 'no');
  " 2>/dev/null || echo "error")

  if [ "$HAS_TS" = "yes" ]; then
    pass "ftm-manifest.json has 'generated_at' timestamp"
  else
    fail "ftm-manifest.json" "missing 'generated_at' timestamp"
  fi

  # Each skill entry must have name and description
  SKILL_ERRORS=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));
    const errs = [];
    (m.skills || []).forEach((s, i) => {
      if (!s.name) errs.push('skills[' + i + '] missing name');
      if (!s.description) errs.push('skills[' + i + '] (' + (s.name||'?') + ') missing description');
    });
    if (errs.length) console.log(errs.join('\n'));
  " 2>/dev/null || echo "")

  if [ -n "$SKILL_ERRORS" ]; then
    while IFS= read -r err; do
      fail "ftm-manifest.json" "$err"
    done <<< "$SKILL_ERRORS"
  else
    SKILL_COUNT=$(node -e "
      const m = JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));
      console.log((m.skills||[]).length);
    " 2>/dev/null || echo "0")
    pass "ftm-manifest.json all $SKILL_COUNT skill entries have name and description"
  fi
fi

# ---------------------------------------------------------------------------
# Check: ftm-state/schemas/*.schema.json are valid JSON
# ---------------------------------------------------------------------------
echo ""
echo "--- ftm-state/schemas/*.schema.json validity"

SCHEMAS_DIR="$REPO_DIR/ftm-state/schemas"
if [ ! -d "$SCHEMAS_DIR" ]; then
  fail "ftm-state/schemas/" "directory not found"
else
  SCHEMA_COUNT=0
  for schema_file in "$SCHEMAS_DIR"/*.schema.json; do
    [ -f "$schema_file" ] || continue
    rel="ftm-state/schemas/$(basename "$schema_file")"
    SCHEMA_COUNT=$((SCHEMA_COUNT + 1))

    if is_valid_json "$schema_file"; then
      pass "$rel is valid JSON"
    else
      fail "$rel" "not valid JSON"
      continue
    fi

    # Must have $schema field
    HAS_SCHEMA_FIELD=$(node -e "
      const s = JSON.parse(require('fs').readFileSync('$schema_file','utf8'));
      console.log(s['\$schema'] ? 'yes' : 'no');
    " 2>/dev/null || echo "error")

    if [ "$HAS_SCHEMA_FIELD" = "yes" ]; then
      pass "$rel has \$schema field"
    else
      fail "$rel" "missing \$schema field"
    fi

    # Must have type field
    HAS_TYPE=$(node -e "
      const s = JSON.parse(require('fs').readFileSync('$schema_file','utf8'));
      console.log(s.type ? 'yes' : 'no');
    " 2>/dev/null || echo "error")

    if [ "$HAS_TYPE" = "yes" ]; then
      pass "$rel has 'type' field"
    else
      fail "$rel" "missing 'type' field"
    fi
  done

  if [ "$SCHEMA_COUNT" -eq 0 ]; then
    fail "ftm-state/schemas/" "no *.schema.json files found"
  else
    pass "found $SCHEMA_COUNT schema files in ftm-state/schemas/"
  fi
fi

# ---------------------------------------------------------------------------
# Check: blackboard JSON files are valid JSON
# ---------------------------------------------------------------------------
echo ""
echo "--- ftm-state/blackboard/*.json validity"

BLACKBOARD_DIR="$REPO_DIR/ftm-state/blackboard"
if [ ! -d "$BLACKBOARD_DIR" ]; then
  fail "ftm-state/blackboard/" "directory not found"
else
  BB_COUNT=0
  for bb_file in "$BLACKBOARD_DIR"/*.json; do
    [ -f "$bb_file" ] || continue
    rel="ftm-state/blackboard/$(basename "$bb_file")"
    BB_COUNT=$((BB_COUNT + 1))

    if is_valid_json "$bb_file"; then
      pass "$rel is valid JSON"
    else
      fail "$rel" "not valid JSON"
    fi
  done

  # Check experiences/index.json
  INDEX_FILE="$BLACKBOARD_DIR/experiences/index.json"
  if [ -f "$INDEX_FILE" ]; then
    if is_valid_json "$INDEX_FILE"; then
      pass "ftm-state/blackboard/experiences/index.json is valid JSON"
      BB_COUNT=$((BB_COUNT + 1))
    else
      fail "ftm-state/blackboard/experiences/index.json" "not valid JSON"
    fi
  else
    fail "ftm-state/blackboard/experiences/index.json" "file not found"
  fi

  if [ "$BB_COUNT" -eq 0 ]; then
    fail "ftm-state/blackboard/" "no JSON files found"
  else
    pass "found $BB_COUNT JSON files in blackboard"
  fi
fi

# ---------------------------------------------------------------------------
# Check: blackboard/context.json matches expected top-level structure
# ---------------------------------------------------------------------------
echo ""
echo "--- blackboard/context.json structure"

CONTEXT_FILE="$BLACKBOARD_DIR/context.json"
if [ -f "$CONTEXT_FILE" ]; then
  CONTEXT_KEYS=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$CONTEXT_FILE','utf8'));
    const required = ['current_task','recent_decisions','active_constraints','user_preferences','session_metadata'];
    const missing = required.filter(k => !(k in c));
    if (missing.length) console.log('MISSING: ' + missing.join(', '));
    else console.log('OK');
  " 2>/dev/null || echo "error")

  if [ "$CONTEXT_KEYS" = "OK" ]; then
    pass "blackboard/context.json has all required top-level keys"
  else
    fail "blackboard/context.json" "$CONTEXT_KEYS"
  fi
fi

# ---------------------------------------------------------------------------
# Check: blackboard/patterns.json matches expected top-level structure
# ---------------------------------------------------------------------------
echo ""
echo "--- blackboard/patterns.json structure"

PATTERNS_FILE="$BLACKBOARD_DIR/patterns.json"
if [ -f "$PATTERNS_FILE" ]; then
  PATTERNS_KEYS=$(node -e "
    const p = JSON.parse(require('fs').readFileSync('$PATTERNS_FILE','utf8'));
    const required = ['codebase_insights','execution_patterns','user_behavior','recurring_issues'];
    const missing = required.filter(k => !(k in p));
    if (missing.length) console.log('MISSING: ' + missing.join(', '));
    else console.log('OK');
  " 2>/dev/null || echo "error")

  if [ "$PATTERNS_KEYS" = "OK" ]; then
    pass "blackboard/patterns.json has all required top-level keys"
  else
    fail "blackboard/patterns.json" "$PATTERNS_KEYS"
  fi
fi

# ---------------------------------------------------------------------------
# Check: package.json validity
# ---------------------------------------------------------------------------
echo ""
echo "--- package.json validity"

PKG_FILE="$REPO_DIR/package.json"
if [ ! -f "$PKG_FILE" ]; then
  fail "package.json" "not found"
else
  if is_valid_json "$PKG_FILE"; then
    pass "package.json is valid JSON"
  else
    fail "package.json" "not valid JSON"
  fi

  # Must have name, version, description
  PKG_CHECK=$(node -e "
    const p = JSON.parse(require('fs').readFileSync('$PKG_FILE','utf8'));
    const missing = ['name','version','description'].filter(k => !p[k]);
    if (missing.length) console.log('MISSING: ' + missing.join(', '));
    else console.log('OK');
  " 2>/dev/null || echo "error")

  if [ "$PKG_CHECK" = "OK" ]; then
    pass "package.json has name, version, and description"
  else
    fail "package.json" "$PKG_CHECK"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "JSON Schema Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
  exit 1
fi

echo ""
exit 0
