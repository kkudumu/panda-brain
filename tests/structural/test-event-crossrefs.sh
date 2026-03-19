#!/usr/bin/env bash
# tests/structural/test-event-crossrefs.sh
# Validate event cross-references across all SKILL.md files.
# Every "Listens To" event must be emitted by some skill.
# Every "Emits" event that is not consumed produces a warning (not an error).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0
WARN=0
ERRORS=""
WARNINGS=""

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

warn() {
  local name="$1"
  local reason="$2"
  echo "  WARN  $name"
  echo "        $reason"
  WARNINGS="${WARNINGS}\n  WARN  $name — $reason"
  WARN=$((WARN + 1))
}

# ---------------------------------------------------------------------------
# Collect all events from SKILL.md files
# ---------------------------------------------------------------------------
echo ""
echo "--- Parsing SKILL.md event declarations"

# Temp files for event maps
EMITS_TMP="$(mktemp)"
LISTENS_TMP="$(mktemp)"
trap 'rm -f "$EMITS_TMP" "$LISTENS_TMP"' EXIT

SKILLS_FOUND=0
for skill_dir in "$REPO_DIR"/ftm*/; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  [ "$skill_name" = "ftm-state" ] && continue

  skill_md="$skill_dir/SKILL.md"
  [ -f "$skill_md" ] || continue

  SKILLS_FOUND=$((SKILLS_FOUND + 1))

  # Extract Emits section events
  node -e "
    const fs = require('fs');
    const text = fs.readFileSync('$skill_md', 'utf8');
    const lines = text.split('\n');
    let mode = null;
    const emits = [];
    const listens = [];
    for (const line of lines) {
      const t = line.trim();
      if (t === '### Emits') { mode = 'emits'; continue; }
      if (t === '### Listens To') { mode = 'listens'; continue; }
      if (/^#+\s/.test(t) && t !== '### Emits' && t !== '### Listens To') { mode = null; continue; }
      if (!mode) continue;
      const m = t.match(/^-\s+\x60([a-z][a-z0-9_]*)\x60/);
      if (m) {
        if (mode === 'emits') emits.push(m[1]);
        if (mode === 'listens') listens.push(m[1]);
      }
    }
    emits.forEach(e => process.stdout.write('EMITS\t$skill_name\t' + e + '\n'));
    listens.forEach(e => process.stdout.write('LISTENS\t$skill_name\t' + e + '\n'));
  " 2>/dev/null >> "$EMITS_TMP" || true
done

pass "parsed event declarations from $SKILLS_FOUND skill files"

# ---------------------------------------------------------------------------
# Build event sets
# ---------------------------------------------------------------------------
echo ""
echo "--- Building event cross-reference maps"

# All emitted events (unique event names)
ALL_EMITTED=$(grep '^EMITS' "$EMITS_TMP" | awk '{print $3}' | sort -u)
# All listened events (unique event names)
ALL_LISTENED=$(grep '^LISTENS' "$EMITS_TMP" | awk '{print $3}' | sort -u)

EMIT_COUNT=$(echo "$ALL_EMITTED" | grep -c . || echo 0)
LISTEN_COUNT=$(echo "$ALL_LISTENED" | grep -c . || echo 0)

pass "found $EMIT_COUNT unique emitted events across all skills"
pass "found $LISTEN_COUNT unique listened events across all skills"

# ---------------------------------------------------------------------------
# Check 1: Every "Listens To" event must be emitted by some skill
# ---------------------------------------------------------------------------
echo ""
echo "--- Check: listened-to events are emitted by some skill"

ORPHAN_LISTENS=0
while IFS= read -r event; do
  [ -z "$event" ] && continue
  # Find which skills listen to this event
  LISTENERS=$(grep '^LISTENS' "$EMITS_TMP" | awk -v e="$event" '$3==e{print $2}' | sort -u | tr '\n' ',' | sed 's/,$//')
  # Check if any skill emits this event
  EMITTERS=$(grep '^EMITS' "$EMITS_TMP" | awk -v e="$event" '$3==e{print $2}' | sort -u | tr '\n' ',' | sed 's/,$//')

  if [ -z "$EMITTERS" ]; then
    fail "event '$event'" "listened to by [$LISTENERS] but never emitted by any skill"
    ORPHAN_LISTENS=$((ORPHAN_LISTENS + 1))
  fi
done <<< "$ALL_LISTENED"

if [ "$ORPHAN_LISTENS" -eq 0 ] && [ "$LISTEN_COUNT" -gt 0 ]; then
  pass "all $LISTEN_COUNT listened-to events have a corresponding emitter"
elif [ "$LISTEN_COUNT" -eq 0 ]; then
  pass "no listen declarations found — skipping orphan listen check"
fi

# ---------------------------------------------------------------------------
# Check 2: Events emitted but never listened to (warning only — terminal events are OK)
# ---------------------------------------------------------------------------
echo ""
echo "--- Check: emitted events are consumed (warnings only for terminals)"

UNCLAIMED_EMITS=0
while IFS= read -r event; do
  [ -z "$event" ] && continue
  EMITTERS=$(grep '^EMITS' "$EMITS_TMP" | awk -v e="$event" '$3==e{print $2}' | sort -u | tr '\n' ',' | sed 's/,$//')
  LISTENERS=$(grep '^LISTENS' "$EMITS_TMP" | awk -v e="$event" '$3==e{print $2}' | sort -u | tr '\n' ',' | sed 's/,$//')

  if [ -z "$LISTENERS" ]; then
    warn "event '$event'" "emitted by [$EMITTERS] but not listened to by any skill (may be terminal)"
    UNCLAIMED_EMITS=$((UNCLAIMED_EMITS + 1))
  fi
done <<< "$ALL_EMITTED"

if [ "$UNCLAIMED_EMITS" -eq 0 ] && [ "$EMIT_COUNT" -gt 0 ]; then
  pass "all $EMIT_COUNT emitted events are consumed by some skill"
elif [ "$EMIT_COUNT" -eq 0 ]; then
  pass "no emit declarations found"
fi

# ---------------------------------------------------------------------------
# Check 3: Validate event naming convention (snake_case, no hyphens)
# ---------------------------------------------------------------------------
echo ""
echo "--- Check: event names follow snake_case convention"

BAD_NAMES=0
while IFS= read -r event; do
  [ -z "$event" ] && continue
  if echo "$event" | grep -qE '[A-Z]|-|[[:space:]]'; then
    SKILL_CTX=$(grep -E "EMITS|LISTENS" "$EMITS_TMP" | awk -v e="$event" '$3==e{print $2}' | head -1)
    fail "event '$event'" "violates snake_case naming convention (skill: $SKILL_CTX)"
    BAD_NAMES=$((BAD_NAMES + 1))
  fi
done < <(cat "$EMITS_TMP" | awk '{print $3}' | sort -u)

if [ "$BAD_NAMES" -eq 0 ]; then
  pass "all event names follow snake_case convention"
fi

# ---------------------------------------------------------------------------
# Check 4: No duplicate event declarations within a single skill
# ---------------------------------------------------------------------------
echo ""
echo "--- Check: no duplicate event declarations within a skill"

DUPES=0
while IFS= read -r skill_dir; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  [ "$skill_name" = "ftm-state" ] && continue

  skill_md="$skill_dir/SKILL.md"
  [ -f "$skill_md" ] || continue

  # Use grep with || true to avoid set -e failure when no lines match
  SKILL_EMITS=$(grep "^EMITS	${skill_name}	" "$EMITS_TMP" 2>/dev/null | awk '{print $3}' | sort || true)
  if [ -n "$SKILL_EMITS" ]; then
    SKILL_EMITS_UNIQ=$(echo "$SKILL_EMITS" | sort -u)
    EMIT_TOTAL=$(echo "$SKILL_EMITS" | wc -l | tr -d ' ')
    EMIT_UNIQ=$(echo "$SKILL_EMITS_UNIQ" | wc -l | tr -d ' ')
    if [ "$EMIT_TOTAL" != "$EMIT_UNIQ" ]; then
      DUPE_EVENTS=$(comm -23 <(echo "$SKILL_EMITS" | sort) <(echo "$SKILL_EMITS_UNIQ") | tr '\n' ',' | sed 's/,$//')
      fail "$skill_name" "duplicate Emits declarations: $DUPE_EVENTS"
      DUPES=$((DUPES + 1))
    fi
  fi

  SKILL_LISTENS=$(grep "^LISTENS	${skill_name}	" "$EMITS_TMP" 2>/dev/null | awk '{print $3}' | sort || true)
  if [ -n "$SKILL_LISTENS" ]; then
    SKILL_LISTENS_UNIQ=$(echo "$SKILL_LISTENS" | sort -u)
    LISTEN_TOTAL=$(echo "$SKILL_LISTENS" | wc -l | tr -d ' ')
    LISTEN_UNIQ_COUNT=$(echo "$SKILL_LISTENS_UNIQ" | wc -l | tr -d ' ')
    if [ "$LISTEN_TOTAL" != "$LISTEN_UNIQ_COUNT" ]; then
      DUPE_EVENTS=$(comm -23 <(echo "$SKILL_LISTENS" | sort) <(echo "$SKILL_LISTENS_UNIQ") | tr '\n' ',' | sed 's/,$//')
      fail "$skill_name" "duplicate Listens To declarations: $DUPE_EVENTS"
      DUPES=$((DUPES + 1))
    fi
  fi
done < <(ls -d "$REPO_DIR"/ftm*/)

if [ "$DUPES" -eq 0 ]; then
  pass "no duplicate event declarations within any skill"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"

if [ "$WARN" -gt 0 ]; then
  echo "Warnings ($WARN):"
  echo -e "$WARNINGS"
  echo ""
fi

echo "Event Cross-Reference Results: $PASS passed, $FAIL failed, $WARN warnings"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  echo ""
  exit 1
fi

echo ""
exit 0
