# Selective Skill Install Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users install one skill, many skills, or all skills via `--only` and `--list` flags on both install paths.

**Architecture:** Add `--only skill1,skill2` and `--list` flag parsing to both `install.sh` and `bin/install.mjs`. When `--only` is used, filter the skill glob to only matching names, auto-include `ftm` and `ftm-config` as base dependencies, and skip hooks by default. `--list` reads all `ftm-*.yml` files and prints name + description.

**Tech Stack:** Bash (install.sh), Node.js ESM (bin/install.mjs)

---

### Task 1: Add --only and --list to install.sh

**Files:**
- Modify: `install.sh:22-35` (arg parsing)
- Modify: `install.sh:86-118` (skill linking loops)

**Step 1: Add flag parsing for --only and --list**

In the arg parsing block (line 22-35), add:

```bash
ONLY_SKILLS=""
LIST_MODE=false
for arg in "$@"; do
  case "$arg" in
    --no-hooks) NO_HOOKS=true ;;
    --skip-merge) SKIP_MERGE=true ;;
    --setup-hooks) ;;
    --list) LIST_MODE=true ;;
    --only=*) ONLY_SKILLS="${arg#--only=}" ;;
    --only)
      # next arg is the value — handled below
      ;;
  esac
done
# Handle --only as separate arg (--only ftm-mind,ftm-council)
for i in $(seq 1 $#); do
  arg="${!i}"
  if [ "$arg" = "--only" ]; then
    next=$((i + 1))
    ONLY_SKILLS="${!next}"
  fi
done
```

**Step 2: Implement --list mode**

After arg parsing, before preflight:

```bash
if [ "$LIST_MODE" = true ]; then
  echo ""
  echo "Available FTM skills:"
  echo ""
  for yml in "$REPO_DIR"/ftm-*.yml; do
    [ -f "$yml" ] || continue
    name=$(basename "$yml" .yml)
    [[ "$name" == *".default"* ]] && continue
    desc=$(grep '^description:' "$yml" | head -1 | sed 's/^description: *//' | cut -c1-80)
    printf "  %-22s %s\n" "$name" "$desc"
  done
  echo ""
  echo "Install specific skills: ./install.sh --only ftm-council-chat,ftm-mind"
  echo "Install everything:      ./install.sh"
  exit 0
fi
```

**Step 3: Add filtering logic to skill linking**

Replace the skill linking loops. When `ONLY_SKILLS` is set, convert to an array and filter. Always include `ftm` and `ftm-config` as base deps. When `--only` is used, default `NO_HOOKS=true` unless `--with-hooks` is passed.

```bash
# When --only is used, skip hooks by default
if [ -n "$ONLY_SKILLS" ] && [ "$WITH_HOOKS" != true ]; then
  NO_HOOKS=true
fi

# Build skill filter
declare -a SKILL_FILTER=()
if [ -n "$ONLY_SKILLS" ]; then
  # Always include base dependencies
  SKILL_FILTER+=("ftm" "ftm-config")
  IFS=',' read -ra REQUESTED <<< "$ONLY_SKILLS"
  for s in "${REQUESTED[@]}"; do
    s=$(echo "$s" | xargs) # trim whitespace
    SKILL_FILTER+=("$s")
  done
fi

skill_wanted() {
  local name="$1"
  if [ ${#SKILL_FILTER[@]} -eq 0 ]; then
    return 0  # no filter = install all
  fi
  for wanted in "${SKILL_FILTER[@]}"; do
    if [ "$name" = "$wanted" ]; then
      return 0
    fi
  done
  return 1
}
```

Then wrap the existing yml and directory linking loops with `skill_wanted` checks:

```bash
for yml in "$REPO_DIR"/ftm*.yml; do
  [ -f "$yml" ] || continue
  name=$(basename "$yml" .yml)
  [[ "$name" == *".default."* ]] && continue
  skill_wanted "$name" || continue
  # ... existing symlink logic
done

for dir in "$REPO_DIR"/ftm*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ "$name" = "ftm-state" ] && continue
  skill_wanted "$name" || continue
  # ... existing symlink logic
done
```

**Step 4: Add --with-hooks flag**

```bash
WITH_HOOKS=false
for arg in "$@"; do
  case "$arg" in
    --with-hooks) WITH_HOOKS=true ;;
  esac
done
```

**Step 5: Update usage comment at top of file**

```bash
# Usage:
#   ./install.sh                              # Full install (all skills + hooks)
#   ./install.sh --only ftm-council-chat      # Install specific skill(s)
#   ./install.sh --only ftm-mind,ftm-debug    # Install multiple specific skills
#   ./install.sh --list                       # List available skills
#   ./install.sh --no-hooks                   # Skills only, skip hooks
#   ./install.sh --only ftm-mind --with-hooks # Specific skills + all hooks
```

**Step 6: Test**

```bash
./install.sh --list
./install.sh --only ftm-council-chat
ls -la ~/.claude/skills/ftm-council-chat*
ls -la ~/.claude/skills/ftm.yml  # should exist (base dep)
ls -la ~/.claude/skills/ftm-config.yml  # should exist (base dep)
ls -la ~/.claude/skills/ftm-debug.yml  # should NOT exist
```

**Step 7: Commit**

```bash
git add install.sh
git commit -m "feat(install): add --only and --list flags for selective skill install"
```

---

### Task 2: Add --only and --list to bin/install.mjs

**Files:**
- Modify: `bin/install.mjs:32-35` (arg parsing)
- Modify: `bin/install.mjs:283-303` (skill linking in main())

**Step 1: Add flag parsing**

```javascript
const ONLY_RAW = ARGS.find(a => a.startsWith('--only='))?.split('=')[1]
  || (ARGS.includes('--only') ? ARGS[ARGS.indexOf('--only') + 1] : null);
const LIST_MODE = ARGS.includes('--list');
const WITH_HOOKS_FLAG = ARGS.includes('--with-hooks');

// Parse --only into a Set, always including base deps
const ONLY_SKILLS = ONLY_RAW
  ? new Set(['ftm', 'ftm-config', ...ONLY_RAW.split(',').map(s => s.trim())])
  : null;

// When --only is used, skip hooks unless --with-hooks
if (ONLY_SKILLS && !WITH_HOOKS_FLAG && !ARGS.includes('--no-hooks')) {
  // We'll handle this by overriding NO_HOOKS
}
const NO_HOOKS_EFFECTIVE = NO_HOOKS || (ONLY_SKILLS && !WITH_HOOKS_FLAG);
```

**Step 2: Implement --list mode**

```javascript
if (LIST_MODE) {
  console.log('\nAvailable FTM skills:\n');
  const ymlFiles = readdirSync(REPO_DIR).filter(
    f => f.startsWith('ftm-') && f.endsWith('.yml') && !f.includes('config.default')
  );
  for (const yml of ymlFiles) {
    const name = yml.replace('.yml', '');
    const content = readFileSync(join(REPO_DIR, yml), 'utf8');
    const descMatch = content.match(/^description:\s*(.+)/m);
    const desc = descMatch ? descMatch[1].slice(0, 80) : '';
    console.log(`  ${name.padEnd(22)} ${desc}`);
  }
  console.log('\nInstall specific skills: npx feed-the-machine --only ftm-council-chat,ftm-mind');
  console.log('Install everything:      npx feed-the-machine\n');
  process.exit(0);
}
```

**Step 3: Add filtering to skill linking**

Add a `skillWanted` helper and filter the yml and dir loops:

```javascript
function skillWanted(name) {
  if (!ONLY_SKILLS) return true;
  return ONLY_SKILLS.has(name);
}
```

Then in `main()`, wrap the existing loops:

```javascript
const ymlFiles = readdirSync(REPO_DIR).filter(
  (f) => f.startsWith("ftm") && f.endsWith(".yml") && !f.includes("config.default")
).filter(f => skillWanted(f.replace('.yml', '')));

// ... existing linking logic

const dirs = readdirSync(REPO_DIR).filter((f) => {
  if (!f.startsWith("ftm")) return false;
  if (f === "ftm-state") return false;
  if (!skillWanted(f)) return false;
  // ... existing directory check
});
```

Replace `NO_HOOKS` with `NO_HOOKS_EFFECTIVE` throughout the hooks section.

**Step 4: Update jsdoc comment at top**

```javascript
/**
 * npx feed-the-machine — installs ftm skills into ~/.claude/skills/
 *
 * Flags:
 *   --only skill1,skill2  Install specific skills (always includes ftm + ftm-config)
 *   --list                List available skills with descriptions
 *   --with-inbox          Also install the inbox service
 *   --no-hooks            Skip hooks entirely
 *   --with-hooks          Include hooks even with --only
 *   --skip-merge          Install hook files but don't touch settings.json
 */
```

**Step 5: Test**

```bash
node bin/install.mjs --list
node bin/install.mjs --only ftm-council-chat
```

**Step 6: Commit**

```bash
git add bin/install.mjs
git commit -m "feat(install): add --only and --list to npx installer"
```

---

### Task 3: Update README install section

**Files:**
- Modify: `README.md:26-32` (install section)

**Step 1: Replace the install section**

```markdown
## Install

**Everything** (26 skills + 15 hooks):
\`\`\`bash
npx feed-the-machine@latest
\`\`\`

**Just the skills you want:**
\`\`\`bash
npx feed-the-machine --only ftm-council-chat,ftm-mind
\`\`\`
This always includes `ftm` (the router) and `ftm-config` as base dependencies.

**See what's available:**
\`\`\`bash
npx feed-the-machine --list
\`\`\`

Works with any existing Claude Code setup. After install, restart Claude Code or start a new session.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update install section with selective install examples"
```

---

### Task 4: Merge and push

```bash
cd /Users/kioja.kudumu/Documents/Code/feed-the-machine
git merge klaviyokio/lapis-diagnostic
git push origin main
git push klaviyo-it main
```
