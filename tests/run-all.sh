#!/usr/bin/env bash
# tests/run-all.sh
# Master test runner for the FTM skill ecosystem.
# Executes structural, eval, and runtime tests, then prints a summary.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"

PASS=0
FAIL=0
SKIP=0
FAILED_SUITES=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

header() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

run_suite() {
  local name="$1"
  local cmd="$2"
  local suite_label
  suite_label="$(basename "$cmd" | sed 's/\.[^.]*$//')"

  echo ""
  echo "--- $name ---"

  if eval "$cmd"; then
    echo -e "${GREEN}PASS${RESET}  $name"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${RESET}  $name"
    FAIL=$((FAIL + 1))
    FAILED_SUITES+=("$name")
  fi
}

run_suite_optional() {
  local name="$1"
  local cmd="$2"
  local prerequisite="${3:-}"

  echo ""
  echo "--- $name ---"

  if [ -n "$prerequisite" ] && ! eval "$prerequisite" &>/dev/null; then
    echo -e "${YELLOW}SKIP${RESET}  $name (prerequisite not met: $prerequisite)"
    SKIP=$((SKIP + 1))
    return
  fi

  if eval "$cmd" 2>/dev/null; then
    echo -e "${GREEN}PASS${RESET}  $name"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${RESET}  $name"
    FAIL=$((FAIL + 1))
    FAILED_SUITES+=("$name")
  fi
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              FTM Test Suite — run-all.sh                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Repo: $REPO_DIR"
echo "  Date: $(date '+%Y-%m-%d %H:%M:%S')"

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

header "Prerequisites"

echo ""
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  echo "  ✓ node $NODE_VERSION"
else
  echo "  ✗ node not found — runtime tests will be skipped"
fi

if command -v python3 &>/dev/null; then
  PYTHON_VERSION=$(python3 --version)
  echo "  ✓ $PYTHON_VERSION"
else
  echo "  ✗ python3 not found — some JSON checks may be skipped"
fi

echo ""

# ---------------------------------------------------------------------------
# Category 1: Pre-existing tests (do not overwrite, run as-is)
# ---------------------------------------------------------------------------

header "Category 0: Existing Tests"

if [ -f "$TESTS_DIR/validate-skills.sh" ]; then
  run_suite "validate-skills" "bash $TESTS_DIR/validate-skills.sh"
fi

if [ -f "$TESTS_DIR/validate-evals.sh" ]; then
  run_suite "validate-evals" "bash $TESTS_DIR/validate-evals.sh"
fi

if [ -f "$TESTS_DIR/test-install.sh" ]; then
  run_suite "test-install" "bash $TESTS_DIR/test-install.sh"
fi

if [ -f "$TESTS_DIR/validate-blackboard.mjs" ] && command -v node &>/dev/null; then
  run_suite "validate-blackboard" "node $TESTS_DIR/validate-blackboard.mjs"
fi

if [ -f "$TESTS_DIR/validate-events.mjs" ] && command -v node &>/dev/null; then
  run_suite "validate-events" "node $TESTS_DIR/validate-events.mjs"
fi

# ---------------------------------------------------------------------------
# Category 1: Structural Tests
# ---------------------------------------------------------------------------

header "Category 1: Structural Tests"

for f in "$TESTS_DIR/structural"/test-*.sh; do
  [ -f "$f" ] || continue
  run_suite "$(basename "$f")" "bash $f"
done

# ---------------------------------------------------------------------------
# Category 2: Eval Runner
# ---------------------------------------------------------------------------

header "Category 2: Eval Runner"

if [ -f "$TESTS_DIR/evals/run-evals.sh" ]; then
  run_suite "run-evals" "bash $TESTS_DIR/evals/run-evals.sh"
fi

# ---------------------------------------------------------------------------
# Category 3: Runtime Unit Tests
# ---------------------------------------------------------------------------

header "Category 3: Runtime Unit Tests"

if command -v node &>/dev/null; then
  if [ -f "$TESTS_DIR/runtime/test-ftm-runtime.mjs" ]; then
    run_suite "ftm-runtime unit tests" "node $TESTS_DIR/runtime/test-ftm-runtime.mjs"
  fi
else
  echo ""
  echo -e "${YELLOW}SKIP${RESET}  Runtime tests (node not available)"
  SKIP=$((SKIP + 1))
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

TOTAL=$((PASS + FAIL + SKIP))

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                        Results                               ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf  "║  Total suites:  %-5d                                        ║\n" "$TOTAL"
printf  "║  Passed:        %-5d                                        ║\n" "$PASS"
printf  "║  Failed:        %-5d                                        ║\n" "$FAIL"
printf  "║  Skipped:       %-5d                                        ║\n" "$SKIP"
echo "╚══════════════════════════════════════════════════════════════╝"

if [ "${#FAILED_SUITES[@]}" -gt 0 ]; then
  echo ""
  echo "Failed suites:"
  for suite in "${FAILED_SUITES[@]}"; do
    echo "  - $suite"
  done
  echo ""
  exit 1
fi

echo ""
echo -e "${GREEN}All test suites passed.${RESET}"
echo ""
exit 0
