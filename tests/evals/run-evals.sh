#!/usr/bin/env bash
# tests/evals/run-evals.sh
# Eval runner for ftm-mind routing scenarios and skill eval JSON files.
# Reports pass/fail/skip per scenario and produces a summary.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
EVALS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
SKIP=0
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

skip() {
  local name="$1"
  local reason="$2"
  echo "  SKIP  $name ($reason)"
  SKIP=$((SKIP + 1))
}

# ---------------------------------------------------------------------------
# Phase 1: Validate the routing eval JSON file itself
# ---------------------------------------------------------------------------
echo ""
echo "=== Phase 1: Routing Eval File Validation ==="

ROUTING_EVALS="$EVALS_DIR/ftm-mind-routing-evals.json"

if [ ! -f "$ROUTING_EVALS" ]; then
  fail "ftm-mind-routing-evals.json" "file not found"
else
  if node -e "JSON.parse(require('fs').readFileSync('$ROUTING_EVALS','utf8'))" 2>/dev/null; then
    pass "ftm-mind-routing-evals.json is valid JSON"
  else
    fail "ftm-mind-routing-evals.json" "not valid JSON"
  fi

  # Count scenarios
  SCENARIO_COUNT=$(node -e "
    const e = JSON.parse(require('fs').readFileSync('$ROUTING_EVALS','utf8'));
    console.log(Array.isArray(e) ? e.length : 0);
  " 2>/dev/null || echo "0")

  if [ "$SCENARIO_COUNT" -ge 15 ]; then
    pass "routing evals has $SCENARIO_COUNT scenarios (>= 15 required)"
  else
    fail "routing evals" "only $SCENARIO_COUNT scenarios found, need >= 15"
  fi

  # Validate each scenario has required fields
  SCENARIO_ERRORS=$(node -e "
    const evals = JSON.parse(require('fs').readFileSync('$ROUTING_EVALS','utf8'));
    const errors = [];
    evals.forEach((ev, i) => {
      if (!ev.input) errors.push('scenario[' + i + '] missing input');
      if (!ev.expected_route) errors.push('scenario[' + i + '] missing expected_route');
      if (!Array.isArray(ev.tags)) errors.push('scenario[' + i + '] missing tags array');
    });
    if (errors.length) console.log(errors.join('\n'));
  " 2>/dev/null || echo "")

  if [ -n "$SCENARIO_ERRORS" ]; then
    while IFS= read -r err; do
      fail "routing-evals" "$err"
    done <<< "$SCENARIO_ERRORS"
  else
    pass "all $SCENARIO_COUNT routing eval scenarios have required fields"
  fi

  # Validate that expected_route values reference real skills or special values
  ROUTE_ERRORS=$(node -e "
    const path = require('path');
    const fs = require('fs');
    const evals = JSON.parse(fs.readFileSync('$ROUTING_EVALS','utf8'));
    const VALID_SPECIALS = new Set(['direct', 'ftm-mind']);

    // Find all ftm skill names from the repo
    const repoDir = '$REPO_DIR';
    const skillNames = new Set(
      fs.readdirSync(repoDir)
        .filter(d => d.startsWith('ftm') && d !== 'ftm-state')
        .filter(d => fs.statSync(path.join(repoDir, d)).isDirectory())
    );

    const errors = [];
    evals.forEach((ev, i) => {
      const route = ev.expected_route;
      if (!VALID_SPECIALS.has(route) && !skillNames.has(route)) {
        errors.push('scenario[' + i + '] expected_route \"' + route + '\" does not match any skill or special value');
      }
    });
    if (errors.length) console.log(errors.join('\n'));
  " 2>/dev/null || echo "")

  if [ -n "$ROUTE_ERRORS" ]; then
    while IFS= read -r err; do
      fail "routing-evals" "$err"
    done <<< "$ROUTE_ERRORS"
  else
    pass "all expected_route values reference valid skills or special values"
  fi

  # Check tag distribution — should have coverage across major categories
  TAG_COVERAGE=$(node -e "
    const evals = JSON.parse(require('fs').readFileSync('$ROUTING_EVALS','utf8'));
    const allTags = new Set(evals.flatMap(e => e.tags || []));
    const required = ['bug', 'brainstorm', 'plan', 'audit'];
    const missing = required.filter(t => !allTags.has(t));
    if (missing.length) console.log('MISSING_TAGS: ' + missing.join(', '));
    else console.log('OK');
  " 2>/dev/null || echo "error")

  if [ "$TAG_COVERAGE" = "OK" ]; then
    pass "routing evals cover required tag categories (bug, brainstorm, plan, audit)"
  else
    fail "routing-evals" "missing coverage: $TAG_COVERAGE"
  fi
fi

# ---------------------------------------------------------------------------
# Phase 2: Validate existing skill eval files
# ---------------------------------------------------------------------------
echo ""
echo "=== Phase 2: Skill Eval File Validation ==="

EVAL_FILES=$(find "$REPO_DIR" -name "evals.json" \
  -not -path "$REPO_DIR/node_modules/*" \
  -not -path "$REPO_DIR/.git/*" 2>/dev/null || true)

if [ -z "$EVAL_FILES" ]; then
  skip "skill evals" "no evals.json files found in skill directories"
else
  EVAL_FILE_COUNT=0
  while IFS= read -r eval_file; do
    [ -f "$eval_file" ] || continue
    skill_name=$(echo "$eval_file" | sed "s|$REPO_DIR/||" | cut -d/ -f1)
    EVAL_FILE_COUNT=$((EVAL_FILE_COUNT + 1))

    if ! node -e "JSON.parse(require('fs').readFileSync('$eval_file','utf8'))" 2>/dev/null; then
      fail "$skill_name/evals.json" "not valid JSON"
      continue
    fi

    EVAL_SCHEMA_ERRORS=$(node -e "
      const e = JSON.parse(require('fs').readFileSync('$eval_file','utf8'));
      const errors = [];
      if (!e.skill_name) errors.push('missing skill_name');
      if (!Array.isArray(e.evals)) errors.push('missing evals array');
      else {
        e.evals.forEach((ev, i) => {
          if (!ev.name) errors.push('evals[' + i + '] missing name');
          if (!ev.prompt) errors.push('evals[' + i + '] missing prompt');
        });
      }
      if (errors.length) console.log(errors.join('\n'));
    " 2>/dev/null || echo "")

    if [ -n "$EVAL_SCHEMA_ERRORS" ]; then
      while IFS= read -r err; do
        fail "$skill_name/evals.json" "$err"
      done <<< "$EVAL_SCHEMA_ERRORS"
    else
      EVAL_COUNT=$(node -e "
        const e = JSON.parse(require('fs').readFileSync('$eval_file','utf8'));
        console.log((e.evals||[]).length);
      " 2>/dev/null || echo "0")
      pass "$skill_name/evals.json — $EVAL_COUNT evals, all well-formed"
    fi
  done <<< "$EVAL_FILES"

  pass "processed $EVAL_FILE_COUNT skill eval file(s)"
fi

# ---------------------------------------------------------------------------
# Phase 3: Route coverage analysis — check that all skills appear in routing evals
# ---------------------------------------------------------------------------
echo ""
echo "=== Phase 3: Route Coverage Analysis ==="

if [ -f "$ROUTING_EVALS" ]; then
  COVERAGE_REPORT=$(node -e "
    const fs = require('fs');
    const path = require('path');
    const evals = JSON.parse(fs.readFileSync('$ROUTING_EVALS','utf8'));
    const repoDir = '$REPO_DIR';

    // All skill names
    const skillNames = fs.readdirSync(repoDir)
      .filter(d => d.startsWith('ftm') && d !== 'ftm-state')
      .filter(d => fs.statSync(path.join(repoDir, d)).isDirectory());

    // Routes mentioned in evals
    const coveredRoutes = new Set(evals.map(e => e.expected_route));

    // Routable skills (exclude ftm itself as it's the dispatcher)
    const routableSkills = skillNames.filter(s => s !== 'ftm');

    const uncovered = routableSkills.filter(s => !coveredRoutes.has(s));
    const covered = routableSkills.filter(s => coveredRoutes.has(s));

    console.log(JSON.stringify({ covered: covered.length, uncovered, total: routableSkills.length }));
  " 2>/dev/null || echo '{}')

  COVERED=$(echo "$COVERAGE_REPORT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(String(d.covered||0))" 2>/dev/null || echo "0")
  TOTAL=$(echo "$COVERAGE_REPORT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(String(d.total||0))" 2>/dev/null || echo "0")

  if [ "$COVERED" -gt 0 ]; then
    pass "routing evals cover $COVERED / $TOTAL routable skills"
  fi

  UNCOVERED=$(echo "$COVERAGE_REPORT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    (d.uncovered||[]).forEach(s => console.log(s));
  " 2>/dev/null || echo "")

  if [ -n "$UNCOVERED" ]; then
    while IFS= read -r skill; do
      [ -z "$skill" ] && continue
      echo "  NOTE  $skill not represented in routing evals (consider adding scenarios)"
    done <<< "$UNCOVERED"
  fi
fi

# ---------------------------------------------------------------------------
# Phase 4: Tag statistics
# ---------------------------------------------------------------------------
echo ""
echo "=== Phase 4: Tag Statistics ==="

if [ -f "$ROUTING_EVALS" ]; then
  node -e "
    const evals = JSON.parse(require('fs').readFileSync('$ROUTING_EVALS','utf8'));
    const tagCounts = {};
    evals.forEach(ev => (ev.tags||[]).forEach(t => { tagCounts[t] = (tagCounts[t]||0)+1; }));
    const sorted = Object.entries(tagCounts).sort((a,b) => b[1]-a[1]);
    sorted.forEach(([tag, count]) => process.stdout.write('  ' + tag.padEnd(20) + count + '\n'));
  " 2>/dev/null || true
  pass "tag statistics computed"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "Eval Runner Results: $PASS passed, $FAIL failed, $SKIP skipped"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
  exit 1
fi

echo ""
exit 0
