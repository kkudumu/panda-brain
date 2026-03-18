#!/usr/bin/env bash
# validate-evals.sh — Verify eval JSON files are well-formed
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
ERRORS=""

EVAL_FILES=$(find "$REPO_DIR" -name "evals.json" -path "*/evals/*" 2>/dev/null)

if [ -z "$EVAL_FILES" ]; then
  echo "No eval files found."
  exit 0
fi

for eval_file in $EVAL_FILES; do
  skill_name=$(echo "$eval_file" | sed "s|$REPO_DIR/||" | cut -d/ -f1)

  if ! node -e "JSON.parse(require('fs').readFileSync('$eval_file','utf8'))" 2>/dev/null; then
    ERRORS="${ERRORS}\n  FAIL  $skill_name — evals.json is not valid JSON"
    FAIL=$((FAIL + 1))
    continue
  fi

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
    if (errors.length) console.log(errors.join('\\n'));
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
