# Changelog

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
