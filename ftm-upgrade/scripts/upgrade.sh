#!/usr/bin/env bash
# upgrade.sh — Download and install latest feed-the-machine release
# Usage: upgrade.sh [--version <tag>]

set -uo pipefail

REPO="kkudumu/ftm-brain"
SKILLS_DIR="${HOME}/.claude/skills"
VERSION_FILE="${SKILLS_DIR}/ftm-version.txt"
DOWNLOAD_DIR="/tmp/ftm-upgrade"
CACHE_FILE="${HOME}/.cache/ftm-brain/version-check"

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { printf '[ftm-upgrade] %s\n' "$*"; }
die()  { printf '[ftm-upgrade] ERROR: %s\n' "$*" >&2; exit 1; }

# ── Preflight checks ─────────────────────────────────────────────────────────

if ! command -v gh >/dev/null 2>&1; then
  die "GitHub CLI (gh) is not installed. Install it with: brew install gh"
fi

if ! command -v tar >/dev/null 2>&1; then
  die "tar is required but not found."
fi

# ── Determine target version ─────────────────────────────────────────────────

TARGET_VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) TARGET_VERSION="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

if [ -z "${TARGET_VERSION}" ]; then
  log "Fetching latest release tag..."
  TARGET_VERSION=$(gh release list -R "${REPO}" --limit 1 2>&1 | awk 'NR==1{print $1}')
  if [ -z "${TARGET_VERSION}" ]; then
    die "Could not determine latest release. Check GitHub access and repository name."
  fi
fi

log "Target version: ${TARGET_VERSION}"

# ── Read current version ─────────────────────────────────────────────────────

if [ -f "${VERSION_FILE}" ]; then
  CURRENT_VERSION=$(tr -d '[:space:]' < "${VERSION_FILE}")
else
  CURRENT_VERSION="(not installed)"
fi

log "Current version: ${CURRENT_VERSION}"

if [ "${CURRENT_VERSION}" = "${TARGET_VERSION}" ]; then
  log "Already on the latest version (${TARGET_VERSION}). Nothing to do."
  exit 0
fi

# ── Download ──────────────────────────────────────────────────────────────────

rm -rf "${DOWNLOAD_DIR}"
mkdir -p "${DOWNLOAD_DIR}"

log "Downloading release archive for ${TARGET_VERSION}..."

gh release download "${TARGET_VERSION}" \
  -R "${REPO}" \
  --archive tar.gz \
  -D "${DOWNLOAD_DIR}" 2>&1 || die "Download failed. Check your internet connection and repository access."

# Find the downloaded archive
ARCHIVE=$(find "${DOWNLOAD_DIR}" -maxdepth 1 -name '*.tar.gz' | head -1)
if [ -z "${ARCHIVE}" ]; then
  die "No archive found in ${DOWNLOAD_DIR} after download."
fi

log "Downloaded: ${ARCHIVE}"

# ── Extract ───────────────────────────────────────────────────────────────────

EXTRACT_DIR="${DOWNLOAD_DIR}/extracted"
mkdir -p "${EXTRACT_DIR}"

log "Extracting archive..."
tar -xzf "${ARCHIVE}" -C "${EXTRACT_DIR}" 2>&1 || die "Extraction failed. Archive may be corrupt."

# GitHub archives typically extract into a directory named <repo>-<tag>/
REPO_DIR=$(find "${EXTRACT_DIR}" -maxdepth 1 -mindepth 1 -type d | head -1)
if [ -z "${REPO_DIR}" ]; then
  die "Could not find extracted repository directory."
fi

log "Extracted to: ${REPO_DIR}"

# ── Copy skill files ──────────────────────────────────────────────────────────

# Look for a skills/ subdirectory in the archive; fall back to root
SOURCE_SKILLS=""
if [ -d "${REPO_DIR}/skills" ]; then
  SOURCE_SKILLS="${REPO_DIR}/skills"
elif [ -d "${REPO_DIR}" ]; then
  # The repo root might itself contain SKILL.md files and .yml files
  SOURCE_SKILLS="${REPO_DIR}"
fi

if [ -z "${SOURCE_SKILLS}" ]; then
  die "No skills directory found in release archive."
fi

log "Copying skill files from ${SOURCE_SKILLS} to ${SKILLS_DIR}..."

# Use rsync if available for cleaner copy, else cp
if command -v rsync >/dev/null 2>&1; then
  rsync -av --exclude='.git' "${SOURCE_SKILLS}/" "${SKILLS_DIR}/" 2>&1
else
  cp -R "${SOURCE_SKILLS}/." "${SKILLS_DIR}/" 2>&1
fi

# ── Update version file ───────────────────────────────────────────────────────

printf '%s\n' "${TARGET_VERSION}" > "${VERSION_FILE}"

# Invalidate version cache so next check-version.sh run is fresh
rm -f "${CACHE_FILE}"

# ── Summary ───────────────────────────────────────────────────────────────────

log ""
log "Upgrade complete."
log "  ${CURRENT_VERSION} → ${TARGET_VERSION}"
log "  Changelog: https://github.com/${REPO}/releases/tag/${TARGET_VERSION}"
log ""
log "Installed files updated in: ${SKILLS_DIR}"

# ── Cleanup ───────────────────────────────────────────────────────────────────

rm -rf "${DOWNLOAD_DIR}"

exit 0
