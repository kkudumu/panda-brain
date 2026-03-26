#!/usr/bin/env bash
set -euo pipefail

# FTM Skills Installer
# Creates symlinks from this repo into ~/.claude/skills/ so slash commands work.
# Installs hooks, merges them into settings.json, and verifies the result.
# Safe to re-run — idempotent.
#
# Usage:
#   ./install.sh              # Full install (skills + hooks + settings merge)
#   ./install.sh --no-hooks   # Skills and state only, skip hooks entirely
#   ./install.sh --skip-merge # Install hook files but don't touch settings.json

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
STATE_DIR="$HOME/.claude/ftm-state"
CONFIG_DIR="$HOME/.claude"
HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$CONFIG_DIR/settings.json"

NO_HOOKS=false
SKIP_MERGE=false
for arg in "$@"; do
  case "$arg" in
    --no-hooks) NO_HOOKS=true ;;
    --skip-merge) SKIP_MERGE=true ;;
    # Keep --setup-hooks for backwards compat (now a no-op since merge is default)
    --setup-hooks) ;;
  esac
done

WARN_COUNT=0
warn() {
  echo "  WARN: $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

# --- Preflight Checks ---

echo "Preflight checks..."

# Check jq (required for hooks and settings merge)
if ! command -v jq &>/dev/null; then
  if [ "$NO_HOOKS" = true ]; then
    echo "  jq not found (ok — hooks skipped)"
  else
    echo ""
    echo "  ERROR: jq is required for FTM hooks."
    echo ""
    echo "  Install it:"
    echo "    macOS:   brew install jq"
    echo "    Ubuntu:  sudo apt-get install jq"
    echo "    Alpine:  apk add jq"
    echo ""
    echo "  Or skip hooks: ./install.sh --no-hooks"
    exit 1
  fi
else
  echo "  jq: $(jq --version)"
fi

# Check node (required for event logger hook)
if ! command -v node &>/dev/null; then
  if [ "$NO_HOOKS" = true ]; then
    echo "  node not found (ok — hooks skipped)"
  else
    echo ""
    echo "  ERROR: Node.js is required for the FTM event logger hook."
    echo ""
    echo "  Install it: https://nodejs.org/"
    echo "  Or skip hooks: ./install.sh --no-hooks"
    exit 1
  fi
else
  echo "  node: $(node --version)"
fi

echo ""
echo "Installing FTM skills from: $REPO_DIR"
echo "Linking into: $SKILLS_DIR"
echo ""

mkdir -p "$SKILLS_DIR"

# --- Skills ---

# Link all ftm*.yml files
for yml in "$REPO_DIR"/ftm*.yml; do
  [ -f "$yml" ] || continue
  name=$(basename "$yml")
  # Skip ftm-config.default.yml — it's a template, not a skill
  [[ "$name" == *".default."* ]] && continue
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
  [ -d "$dir" ] || continue
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

SKILL_COUNT=0
for _f in "$REPO_DIR"/ftm*.yml; do
  [ -e "$_f" ] || continue
  case "$_f" in *.default.*) continue ;; esac
  SKILL_COUNT=$((SKILL_COUNT + 1))
done
echo ""
echo "  $SKILL_COUNT skills linked."

# --- Blackboard State ---

if [ -d "$REPO_DIR/ftm-state" ]; then
  echo ""
  mkdir -p "$STATE_DIR/blackboard/experiences"
  for f in "$REPO_DIR/ftm-state/blackboard"/*.json; do
    [ -f "$f" ] || continue
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

# --- Config ---

if [ ! -f "$CONFIG_DIR/ftm-config.yml" ] && [ -f "$REPO_DIR/ftm-config.default.yml" ]; then
  cp "$REPO_DIR/ftm-config.default.yml" "$CONFIG_DIR/ftm-config.yml"
  echo "  INIT ftm-config.yml (from default template)"
fi

# --- Hooks ---

HOOK_COUNT=0

if [ "$NO_HOOKS" = true ]; then
  echo ""
  echo "Skipping hooks (--no-hooks)."
else
  echo ""
  echo "Installing hooks..."

  if [ -d "$REPO_DIR/hooks" ]; then
    mkdir -p "$HOOKS_DIR"

    # Install shell hooks
    for hook in "$REPO_DIR/hooks"/ftm-*.sh; do
      [ -f "$hook" ] || continue
      name=$(basename "$hook")
      target="$HOOKS_DIR/$name"
      if [ -f "$target" ]; then
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

    # Install Node.js hooks
    for hook in "$REPO_DIR/hooks"/ftm-*.mjs; do
      [ -f "$hook" ] || continue
      name=$(basename "$hook")
      target="$HOOKS_DIR/$name"
      if [ -f "$target" ]; then
        cp "$hook" "$target"
        echo "  UPDATE $name"
      else
        cp "$hook" "$target"
        echo "  INSTALL $name"
      fi
      HOOK_COUNT=$((HOOK_COUNT + 1))
    done

    echo ""
    echo "  $HOOK_COUNT hooks installed to $HOOKS_DIR"
  fi

  # --- Hook Config Merge (default behavior now) ---

  if [ "$SKIP_MERGE" = true ]; then
    echo ""
    echo "  Skipping settings.json merge (--skip-merge)."
    echo "  Add entries from hooks/settings-template.json to ~/.claude/settings.json manually."
  else
    echo ""
    echo "Registering hooks in settings.json..."

    TEMPLATE="$REPO_DIR/hooks/settings-template.json"
    if [ ! -f "$TEMPLATE" ]; then
      warn "hooks/settings-template.json not found — hooks installed but not registered"
    else
      # Expand ~ to $HOME in the template (jq doesn't expand shell paths)
      EXPANDED_TEMPLATE=$(sed "s|~/.claude|$HOME/.claude|g" "$TEMPLATE")

      if [ ! -f "$SETTINGS_FILE" ]; then
        # No settings.json — create one from the template hooks section
        echo "$EXPANDED_TEMPLATE" | jq '{hooks: .hooks}' > "$SETTINGS_FILE"
        echo "  CREATED $SETTINGS_FILE with FTM hooks"
      else
        # Merge FTM hooks into existing settings.json
        BACKUP="$SETTINGS_FILE.ftm-backup-$(date +%Y%m%d%H%M%S)"
        cp "$SETTINGS_FILE" "$BACKUP"
        echo "  BACKUP $BACKUP"

        # Extract the hooks section from the template
        TEMPLATE_HOOKS=$(echo "$EXPANDED_TEMPLATE" | jq '.hooks')

        # Read existing settings
        EXISTING=$(cat "$SETTINGS_FILE")

        # Ensure hooks key exists
        if echo "$EXISTING" | jq -e '.hooks' >/dev/null 2>&1; then
          : # hooks key exists
        else
          EXISTING=$(echo "$EXISTING" | jq '. + {hooks: {}}')
        fi

        # Merge each hook event type
        for EVENT in PreToolUse UserPromptSubmit PostToolUse Stop; do
          TEMPLATE_ENTRIES=$(echo "$TEMPLATE_HOOKS" | jq --arg e "$EVENT" '.[$e] // []')
          EXISTING_ENTRIES=$(echo "$EXISTING" | jq --arg e "$EVENT" '.hooks[$e] // []')

          # Check if any FTM hooks are already present (by checking command paths)
          FTM_COMMANDS=$(echo "$TEMPLATE_ENTRIES" | jq -r '.[].hooks[]?.command // empty' 2>/dev/null)
          ALREADY_PRESENT=false

          for cmd in $FTM_COMMANDS; do
            cmd_basename=$(basename "$cmd")
            if echo "$EXISTING_ENTRIES" | jq -r '.[].hooks[]?.command // empty' 2>/dev/null | grep -q "$cmd_basename"; then
              ALREADY_PRESENT=true
              break
            fi
          done

          if [ "$ALREADY_PRESENT" = true ]; then
            echo "  SKIP $EVENT hooks (already configured)"
            continue
          fi

          # Append template entries to existing
          MERGED=$(jq -n --argjson existing "$EXISTING_ENTRIES" --argjson template "$TEMPLATE_ENTRIES" '$existing + $template')
          EXISTING=$(echo "$EXISTING" | jq --arg e "$EVENT" --argjson m "$MERGED" '.hooks[$e] = $m')
          echo "  MERGE $EVENT hooks"
        done

        echo "$EXISTING" | jq '.' > "$SETTINGS_FILE"
        echo "  UPDATED $SETTINGS_FILE"
      fi

      echo ""
      echo "  Hooks are active."
    fi
  fi
fi

# --- Verification ---

echo ""
echo "Verifying installation..."

ERRORS=0

# Check skill symlinks resolve
BROKEN_LINKS=0
for link in "$SKILLS_DIR"/ftm*; do
  [ -L "$link" ] || continue
  if [ ! -e "$link" ]; then
    warn "broken symlink: $link"
    BROKEN_LINKS=$((BROKEN_LINKS + 1))
  fi
done
if [ "$BROKEN_LINKS" -eq 0 ]; then
  echo "  Skills: $SKILL_COUNT linked, all symlinks valid"
else
  ERRORS=$((ERRORS + 1))
fi

# Check blackboard state
if [ -f "$STATE_DIR/blackboard/context.json" ] && [ -f "$STATE_DIR/blackboard/patterns.json" ]; then
  echo "  Blackboard: initialized"
else
  warn "blackboard state incomplete"
  ERRORS=$((ERRORS + 1))
fi

# Check config
if [ -f "$CONFIG_DIR/ftm-config.yml" ]; then
  echo "  Config: present"
else
  warn "ftm-config.yml missing"
  ERRORS=$((ERRORS + 1))
fi

# Check hooks (if installed)
if [ "$NO_HOOKS" = false ] && [ "$HOOK_COUNT" -gt 0 ]; then
  # Verify hook files exist and are executable
  HOOK_OK=true
  for hook in "$HOOKS_DIR"/ftm-*.sh; do
    [ -f "$hook" ] || continue
    if [ ! -x "$hook" ]; then
      warn "$(basename "$hook") not executable"
      HOOK_OK=false
    fi
  done

  if [ "$HOOK_OK" = true ]; then
    echo "  Hooks: $HOOK_COUNT installed, all executable"
  else
    ERRORS=$((ERRORS + 1))
  fi

  # Verify settings.json has FTM hooks registered
  if [ "$SKIP_MERGE" = false ] && [ -f "$SETTINGS_FILE" ]; then
    FTM_REGISTERED=$(grep -c 'ftm-' "$SETTINGS_FILE" 2>/dev/null || echo "0")
    if [ "$FTM_REGISTERED" -gt 0 ]; then
      echo "  Settings: $FTM_REGISTERED FTM entries in settings.json"
    else
      warn "no FTM hooks found in settings.json"
      ERRORS=$((ERRORS + 1))
    fi
  fi
fi

# --- Summary ---

echo ""
if [ "$ERRORS" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
  echo "Done. $SKILL_COUNT skills, $HOOK_COUNT hooks. Everything checks out."
else
  echo "Done. $SKILL_COUNT skills, $HOOK_COUNT hooks. $WARN_COUNT warning(s)."
fi
echo ""
echo "Restart Claude Code (or start a new session) to pick up the skills."
echo "Try: /ftm help"
