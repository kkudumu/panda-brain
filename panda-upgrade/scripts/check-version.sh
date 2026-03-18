#!/usr/bin/env bash
# check-version.sh — Check for panda-skills updates via GitHub Releases
# Outputs: UP_TO_DATE | UPGRADE_AVAILABLE <version> <changelog_url> | CHECK_FAILED <reason>

set -uo pipefail

CACHE_DIR="${HOME}/.cache/panda-brain"
CACHE_FILE="${CACHE_DIR}/version-check"
VERSION_FILE="${HOME}/.claude/skills/panda-version.txt"
REPO="kkudumu/panda-brain"

# Ensure cache directory exists
mkdir -p "${CACHE_DIR}"

# Check if cache is fresh (less than 60 minutes old)
if [ -f "${CACHE_FILE}" ]; then
  STALE=$(find "${CACHE_FILE}" -mmin +60 2>/dev/null | wc -l | tr -d ' ')
  if [ "${STALE}" = "0" ]; then
    # Cache is fresh — return cached result
    cat "${CACHE_FILE}"
    exit 0
  fi
fi

# Check that gh CLI is installed
if ! command -v gh >/dev/null 2>&1; then
  RESULT="CHECK_FAILED gh_not_installed"
  printf '%s\n' "${RESULT}" | tee "${CACHE_FILE}"
  exit 0
fi

# Query latest release from GitHub
RELEASE_OUTPUT=$(gh release list -R "${REPO}" --limit 1 2>&1)
GH_EXIT=$?

if [ ${GH_EXIT} -ne 0 ]; then
  # Distinguish between network and repo errors
  if printf '%s' "${RELEASE_OUTPUT}" | grep -qi "could not resolve\|network\|timeout\|no such host"; then
    RESULT="CHECK_FAILED no_internet"
  elif printf '%s' "${RELEASE_OUTPUT}" | grep -qi "not found\|404\|Could not find"; then
    RESULT="CHECK_FAILED repo_not_found"
  else
    REASON=$(printf '%s' "${RELEASE_OUTPUT}" | tr '\n' ' ' | cut -c1-80)
    RESULT="CHECK_FAILED ${REASON}"
  fi
  printf '%s\n' "${RESULT}" | tee "${CACHE_FILE}"
  exit 0
fi

# Parse latest release tag (first column of gh release list output)
LATEST_TAG=$(printf '%s' "${RELEASE_OUTPUT}" | awk 'NR==1{print $1}')

if [ -z "${LATEST_TAG}" ]; then
  RESULT="CHECK_FAILED no_releases_found"
  printf '%s\n' "${RESULT}" | tee "${CACHE_FILE}"
  exit 0
fi

# Read current installed version
if [ -f "${VERSION_FILE}" ]; then
  CURRENT_VERSION=$(tr -d '[:space:]' < "${VERSION_FILE}")
else
  CURRENT_VERSION="unknown"
fi

# Compare versions
if [ "${CURRENT_VERSION}" = "${LATEST_TAG}" ]; then
  RESULT="UP_TO_DATE"
else
  CHANGELOG_URL="https://github.com/${REPO}/releases/tag/${LATEST_TAG}"
  RESULT="UPGRADE_AVAILABLE ${LATEST_TAG} ${CHANGELOG_URL}"
fi

# Write to cache and output
printf '%s\n' "${RESULT}" | tee "${CACHE_FILE}"
exit 0
