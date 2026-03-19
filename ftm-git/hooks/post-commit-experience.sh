#!/usr/bin/env bash

# FTM Post-Commit Experience Recorder
# Ensures every commit produces at least a minimal experience entry.
# Only creates an entry if one hasn't been recorded recently (2+ min gap).

set -euo pipefail

STATE_DIR="$HOME/.claude/ftm-state/blackboard"
EXPERIENCES_DIR="$STATE_DIR/experiences"
INDEX_FILE="$EXPERIENCES_DIR/index.json"

# Ensure directories exist
mkdir -p "$EXPERIENCES_DIR"

# Check if an experience was recorded in the last 2 minutes
RECENT_THRESHOLD=$(($(date +%s) - 120))
LATEST_EXPERIENCE=""

if [ -d "$EXPERIENCES_DIR" ]; then
  LATEST_EXPERIENCE=$(find "$EXPERIENCES_DIR" -name "*.json" -not -name "index.json" -newer /dev/null -maxdepth 1 2>/dev/null | sort -r | head -1)
fi

if [ -n "$LATEST_EXPERIENCE" ]; then
  # Check if the latest experience file was modified within the last 2 minutes
  if [ "$(uname)" = "Darwin" ]; then
    FILE_TIME=$(stat -f %m "$LATEST_EXPERIENCE" 2>/dev/null || echo 0)
  else
    FILE_TIME=$(stat -c %Y "$LATEST_EXPERIENCE" 2>/dev/null || echo 0)
  fi

  if [ "$FILE_TIME" -gt "$RECENT_THRESHOLD" ]; then
    # Experience was recently recorded by the LLM — skip
    exit 0
  fi
fi

# Extract commit metadata
COMMIT_HASH=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=%s)
COMMIT_DATE=$(date +%Y-%m-%d)
COMMIT_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FILES_CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD | tr '\n' ', ' | sed 's/,$//')
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Generate a slug from commit message
SLUG=$(echo "$COMMIT_MSG" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | cut -c1-50)
FILENAME="${COMMIT_DATE}_${SLUG}.json"

# Don't create duplicate if file already exists
if [ -f "$EXPERIENCES_DIR/$FILENAME" ]; then
  exit 0
fi

# Create minimal experience entry
cat > "$EXPERIENCES_DIR/$FILENAME" << EXPEOF
{
  "task_type": "commit",
  "description": "$COMMIT_MSG",
  "source": "git-hook",
  "timestamp": "$COMMIT_TIME",
  "commit_hash": "$COMMIT_HASH",
  "branch": "$BRANCH",
  "files_changed": "$FILES_CHANGED",
  "complexity_estimated": "micro",
  "complexity_actual": "micro",
  "outcome": "success",
  "confidence": 0.5,
  "tags": ["auto-recorded", "git-commit"],
  "lessons": []
}
EXPEOF

# Update index.json
# Read existing index, add new entry, write back
if [ -f "$INDEX_FILE" ]; then
  # Use node for reliable JSON manipulation (available in FTM environments)
  node -e "
    const fs = require('fs');
    const idx = JSON.parse(fs.readFileSync('$INDEX_FILE', 'utf-8'));
    idx.entries.push({
      file: '$FILENAME',
      task_type: 'commit',
      tags: ['auto-recorded', 'git-commit'],
      timestamp: '$COMMIT_TIME',
      confidence: 0.5
    });
    idx.metadata.total_count = idx.entries.length;
    idx.metadata.last_updated = '$COMMIT_TIME';
    fs.writeFileSync('$INDEX_FILE', JSON.stringify(idx, null, 2));
  " 2>/dev/null || true
fi
