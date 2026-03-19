#!/usr/bin/env bash
set -euo pipefail

# FTM Skills Installer
# Creates symlinks from this repo into ~/.claude/skills/ so slash commands work.
# Safe to re-run — idempotent. Run after cloning or adding new skills.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
STATE_DIR="$HOME/.claude/ftm-state"
CONFIG_DIR="$HOME/.claude"

echo "Installing ftm skills from: $REPO_DIR"
echo "Linking into: $SKILLS_DIR"
echo ""

mkdir -p "$SKILLS_DIR"

# Link all ftm*.yml files
for yml in "$REPO_DIR"/ftm*.yml; do
  name=$(basename "$yml")
  target="$SKILLS_DIR/$name"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -f "$target" ]; then
    echo "  SKIP $name (real file exists — back it up first)"
    continue
  fi
  ln -s "$yml" "$target"
  echo "  LINK $name"
done

# Link all ftm* directories (skills with SKILL.md)
for dir in "$REPO_DIR"/ftm*/; do
  name=$(basename "$dir")
  [ "$name" = "ftm-state" ] && continue  # state is handled separately
  target="$SKILLS_DIR/$name"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -d "$target" ]; then
    echo "  SKIP $name/ (real directory exists — back it up first)"
    continue
  fi
  ln -s "$dir" "$target"
  echo "  LINK $name/"
done

# Set up blackboard state (copy templates, don't overwrite existing data)
if [ -d "$REPO_DIR/ftm-state" ]; then
  mkdir -p "$STATE_DIR/blackboard/experiences"
  for f in "$REPO_DIR/ftm-state/blackboard"/*.json; do
    name=$(basename "$f")
    target="$STATE_DIR/blackboard/$name"
    if [ ! -f "$target" ]; then
      cp "$f" "$target"
      echo "  INIT $name (blackboard template)"
    fi
  done
  idx="$STATE_DIR/blackboard/experiences/index.json"
  if [ ! -f "$idx" ]; then
    cp "$REPO_DIR/ftm-state/blackboard/experiences/index.json" "$idx"
    echo "  INIT experiences/index.json (blackboard template)"
  fi
fi

# Copy default config if none exists
if [ ! -f "$CONFIG_DIR/ftm-config.yml" ] && [ -f "$REPO_DIR/ftm-config.default.yml" ]; then
  cp "$REPO_DIR/ftm-config.default.yml" "$CONFIG_DIR/ftm-config.yml"
  echo "  INIT ftm-config.yml (from default template)"
fi

# Install hooks (copy to ~/.claude/hooks/, don't overwrite existing)
HOOKS_DIR="$HOME/.claude/hooks"
if [ -d "$REPO_DIR/hooks" ]; then
  mkdir -p "$HOOKS_DIR"
  HOOK_COUNT=0
  for hook in "$REPO_DIR/hooks"/ftm-*.sh; do
    [ -f "$hook" ] || continue
    name=$(basename "$hook")
    target="$HOOKS_DIR/$name"
    if [ -f "$target" ]; then
      # Overwrite — hooks should always be the latest version
      cp "$hook" "$target"
      chmod +x "$target"
      echo "  UPDATE $name"
    else
      cp "$hook" "$target"
      chmod +x "$target"
      echo "  INSTALL $name"
    fi
    HOOK_COUNT=$((HOOK_COUNT + 1))
  done
  if [ "$HOOK_COUNT" -gt 0 ]; then
    echo ""
    echo "  $HOOK_COUNT hooks installed to $HOOKS_DIR"
    echo "  To activate, add them to ~/.claude/settings.json (see docs/HOOKS.md)"
  fi
fi

echo ""
echo "Done. $(ls "$REPO_DIR"/ftm*.yml 2>/dev/null | wc -l | tr -d ' ') skills linked."
echo "Try: /ftm help"
