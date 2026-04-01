# Changelog

## 1.7.0 — 2026-04-01

### Added
- **ftm-ops**: New personal operations intelligence skill — task management, capacity/burnout tracking, stakeholder comms, meeting intelligence, incident lifecycle, pattern recognition, and daily/weekly narrative analysis with 8 reference files
- **brain.py bundled**: brain.py, tasks_db.py, and playbook_engine now ship with the repo at bin/ — no external dependency on eng-buddy install path
- **9 new brain.py CLI commands**: --capacity-log, --stakeholder-add/list, --incident-add/list, --pattern-add/list, --followup-add/list
- **7 new inbox.db tables**: capacity_logs, stakeholder_contacts, incidents, pattern_observations (with FTS5), follow_ups, burnout_indicators
- **Migration script**: bin/migrate-eng-buddy-data.py for one-time import of eng-buddy markdown data into inbox.db ops tables (dry-run mode, archive, reconciliation)
- **6 hooks migrated to ftm namespace**: ftm-auto-log, ftm-learning-capture, ftm-session-snapshot, ftm-pre-compaction, ftm-post-compaction, ftm-session-end
- **Configurable paths**: New `paths:` section in ftm-config.yml for brain_py, ops_data_dir, drafts_dir, inbox_db — enables team distribution without path conflicts
- **Configurable MCP names**: Atlassian MCP server names read from `ops.mcp_account_rules` config instead of hardcoded
- **Optional personal profile**: personality.md degrades gracefully when no user profile exists

### Changed
- **ftm-mind slimmed from 87KB to 10KB** via progressive disclosure — 6 new reference files (orient-protocol, blackboard-protocol, complexity-sizing, decide-act-protocol, direct-execution, environment-discovery)
- **ftm-mind Orient phase** now loads tasks via brain.py and personality context automatically
- **ftm router** recognizes `ops` and `eng-buddy` as routing prefixes to ftm-ops
- **All eng-buddy paths migrated** from `~/.claude/eng-buddy/` to configurable `~/.claude/ftm-ops/`
- **All brain.py references** updated from `~/.claude/skills/eng-buddy/bin/` to `~/.claude/skills/ftm/bin/`
- **Hardcoded email addresses removed** from personality and MCP reference files

### Deprecated
- **eng-buddy skill**: Now a redirect stub forwarding to /ftm. Phase 1 (forwarding) through 2026-07-01, Phase 2 (warning) through 2026-10-01, Phase 3 (removal) after 2026-10-01

## 1.6.0 — 2026-03-29

### Added
- **ftm-executor**: `agent_mode` config option in `execution` section of ftm-config.yml — controls permission mode for all spawned agents (default: `bypassPermissions`). Prevents agents from downgrading to `acceptEdits` during execution.

## 1.5.1 — 2026-03-28

### Fixed
- **ftm-executor**: Phase 1.5 documentation bootstrap was silently skipped during execution — added explicit phase transition directives so INTENT.md and ARCHITECTURE.mmd are always created before agents dispatch
- **ftm-verify**: Codex CLI invocations used `o3` model which is unsupported on ChatGPT accounts — changed to `gpt-5.4`

### Added
- **ftm-audit**: Layer 1.5 documentation coverage check — verifies every changed function has a corresponding INTENT.md entry, with auto-fix for missing entries. HARD FAIL severity ensures agents cannot pass audit without documenting their code

## 1.0.0 — 2026-03-18

### Added
- 16 unified intelligence skills with OODA-based cognitive loop
- Persistent blackboard memory (context, experiences, patterns)
- Multi-model council (Claude + Codex + Gemini deliberation)
- Complexity-adaptive execution (ADaPT: micro/small/medium/large)
- Event mesh with 18 typed inter-skill events
- Headless browser daemon (ftm-browse)
- Secret scanning git safety gate (ftm-git)
- Self-upgrade mechanism (ftm-upgrade)
- npm distribution (`npx feed-the-machine@latest`)
- Cross-platform Node.js installer
- CI pipeline with skill validation, JSON lint, and shellcheck
- Quickstart guide and contributing guide

### Fixed
- Removed 57 hardcoded user paths — all skills now portable
- Corrected repository URL in README, install instructions, and upgrade scripts
