#!/usr/bin/env bash
set -euo pipefail

HOOKS_DIR="$HOME/.claude/git-hooks"

# Create hooks directory
mkdir -p "$HOOKS_DIR"

# Check if hooksPath is already set
CURRENT="$(git config --global core.hooksPath 2>/dev/null || echo "")"
if [ "$CURRENT" = "$HOOKS_DIR" ]; then
  echo "core.hooksPath already configured: $HOOKS_DIR"
  exit 0
fi

if [ -n "$CURRENT" ] && [ "$CURRENT" != "$HOOKS_DIR" ]; then
  echo "WARNING: core.hooksPath is already set to: $CURRENT"
  echo "Changing to: $HOOKS_DIR"
  echo "Previous hooks at $CURRENT will NOT run unless manually chained."
fi

git config --global core.hooksPath "$HOOKS_DIR"
echo "Set git core.hooksPath to: $HOOKS_DIR"
echo ""
echo "NOTE: This is a GLOBAL git config change affecting all repositories."
echo "The post-commit hook chains to project-local hooks if they exist."
echo "To revert: git config --global --unset core.hooksPath"
