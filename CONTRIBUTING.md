# Contributing to Panda Skills

## Adding a New Skill

### 1. Create the skill directory

```
panda-yourskill/
  SKILL.md          # Required — skill instructions
  evals/
    evals.json      # Recommended — behavioral test cases
  scripts/          # Optional — shell scripts the skill uses
  references/       # Optional — reference documents
```

### 2. Write the SKILL.md

Every SKILL.md needs YAML frontmatter:

```yaml
---
name: panda-yourskill
description: What it does. Use when user says "trigger phrase 1", "trigger phrase 2", or "trigger phrase 3".
---
```

The `description` field is critical — Claude uses it to decide when to load your skill. Include specific trigger phrases users would say.

### 3. Create the trigger file

Create `panda-yourskill.yml` at the repo root:

```yaml
name: panda-yourskill
description: Same description as in SKILL.md frontmatter.
```

### 4. Add blackboard integration (recommended)

If your skill should read/write persistent memory, add these sections to SKILL.md:

```markdown
## Blackboard Read
1. Read `~/.claude/panda-state/blackboard/context.json` — check current_task
2. Read `~/.claude/panda-state/blackboard/experiences/index.json` — filter relevant entries
3. Read `~/.claude/panda-state/blackboard/patterns.json` — check for relevant patterns

## Blackboard Write
1. Update context.json with task status
2. Write experience file to experiences/
3. Update experiences/index.json
```

Use `~/` paths, never hardcoded home directories.

### 5. Add evals (recommended)

Create `panda-yourskill/evals/evals.json`:

```json
{
  "skill_name": "panda-yourskill",
  "evals": [
    {
      "id": 1,
      "name": "basic-trigger",
      "prompt": "A realistic user message that should trigger this skill",
      "expected_output": "Description of correct behavior",
      "assertions": [
        {"name": "assertion_name", "description": "What to check in the output"}
      ]
    }
  ]
}
```

### 6. Test locally

```bash
# Validate your skill structure
tests/validate-skills.sh

# Validate your evals (if you added them)
tests/validate-evals.sh

# Install and test
./install.sh
# Then try your skill in Claude Code
```

### 7. Submit a PR

- One skill per PR
- Include a brief description of what the skill does and when it triggers
- All tests must pass (`tests/validate-skills.sh` and `tests/validate-evals.sh`)
- No hardcoded user paths — use `~/` for home directory references

## Code Standards

- **Paths**: Always use `~/.claude/` not `/Users/yourname/.claude/`
- **Frontmatter**: Every SKILL.md must have `name:` and `description:` in YAML frontmatter
- **Events**: Document which events your skill emits and listens to
- **Anti-patterns**: Include an anti-patterns section in complex skills

## Running Tests

```bash
# All tests
tests/validate-skills.sh && tests/validate-evals.sh

# Just skills
tests/validate-skills.sh

# Just evals
tests/validate-evals.sh
```

## Project Structure

```
panda-brain/
  panda.yml                    # Router skill trigger
  panda/SKILL.md               # Router skill
  panda-mind.yml               # Mind skill trigger
  panda-mind/SKILL.md          # OODA cognitive loop
  panda-mind/references/       # Blackboard schema, event registry
  panda-[skill].yml            # Trigger files
  panda-[skill]/SKILL.md       # Skill instructions
  panda-state/blackboard/      # Template state files
  tests/                       # Validation scripts
  .github/workflows/ci.yml     # CI pipeline
```
