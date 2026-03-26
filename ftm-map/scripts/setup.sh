#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

# Check Python version (3.10+ required)
PYTHON_BIN=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" &>/dev/null; then
    version_ok=$("$candidate" -c "import sys; print(1 if sys.version_info >= (3, 10) else 0)" 2>/dev/null || echo 0)
    if [ "$version_ok" = "1" ]; then
      PYTHON_BIN="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "ERROR: Python 3.10+ is required but not found." >&2
  echo "Install Python 3.10 or higher and try again." >&2
  exit 1
fi

PYTHON_VERSION=$("$PYTHON_BIN" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
echo "Using Python $PYTHON_VERSION at $("$PYTHON_BIN" -c "import sys; print(sys.executable)")"

# Create venv if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment at $VENV_DIR..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  echo "Virtual environment created."
else
  echo "Virtual environment already exists at $VENV_DIR."
fi

# Install/upgrade dependencies
echo "Installing dependencies from requirements.txt..."
"$VENV_DIR/bin/pip" install -q --upgrade pip
"$VENV_DIR/bin/pip" install -q -r "$SCRIPT_DIR/requirements.txt"
echo "Dependencies installed."

echo "Verifying dependencies..."
"$VENV_DIR/bin/python" -c "
import tree_sitter_language_pack
import scipy
import pygments
print('All dependencies verified')
" || {
    echo "ERROR: Dependency verification failed"
    exit 1
}

# Verify the installation
echo "Verifying installation..."
"$VENV_DIR/bin/python3" -c "import sqlite_vec; from tree_sitter_language_pack import get_parser; print('ftm-map dependencies OK')"
