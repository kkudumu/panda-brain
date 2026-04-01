# Code Style — FTM Skill Ecosystem

> This file defines the code standards for ftm skills. Read by Codex during adversarial review
> and enforced automatically. Humans set it once; AI agents follow it on every commit.

## Hard Limits

| Rule | Limit | Rationale |
|---|---|---|
| Max lines per SKILL.md | ~500 (15-20KB) | Progressive disclosure — detailed protocols go in references/ |
| Max lines per reference file | 300 | Keep each reference focused and scannable |
| Max lines per function (Python) | 50 | Trace a bug by following imports without blowing context window |
| Max lines per shell script | 200 | Shell scripts should be simple — complex logic goes in Python |

## Structure Rules

- **Skills use progressive disclosure**: Lean SKILL.md with `Read references/X.md` directives for details
- **Reference files are self-contained**: Each reference file handles one protocol/capability completely
- **YAML frontmatter is mandatory**: Every SKILL.md has name, description, type fields
- **Shell hooks are idempotent**: Running a hook twice produces the same result as running it once
- **brain.py CLI commands are atomic**: Each command does one thing, returns JSON where possible

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Skill directories | kebab-case | `ftm-ops/` |
| SKILL.md | Exact case | `SKILL.md` (not skill.md) |
| Reference files | kebab-case | `capacity-tracking.md` |
| Hook scripts | ftm- prefix, kebab-case | `ftm-learning-capture.sh` |
| Python CLI flags | double-dash, kebab-case | `--capacity-log` |
| DB table names | snake_case | `pattern_observations` |
| Config keys | snake_case | `max_parallel_agents` |

## Error Handling

- **Fail fast, fail explicitly**: Detect and report errors immediately with meaningful context
- **Never suppress silently**: All errors must be logged, handled, or escalated
- **Exit codes matter**: 0 = success, non-zero = failure with stderr message
- **brain.py errors return JSON**: `{"error": "description", "code": "ERROR_TYPE"}`

## Skill Design Principles

- **ftm-mind is the only entry point**: All user requests route through ftm-mind's OODA loop
- **Skills delegate to brain.py for DB operations**: No direct SQLite in SKILL.md instructions
- **Shared state goes through blackboard**: `~/.claude/ftm-state/blackboard/`
- **Hooks check session state before running**: Guard with ftm-state context.json check
