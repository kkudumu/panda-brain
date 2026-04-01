"""Configure sys.path so tests can run from project root or module directory."""
import sys
from pathlib import Path

# Add playbook_engine directory to sys.path so `from models import ...` works
_this_dir = Path(__file__).parent
if str(_this_dir) not in sys.path:
    sys.path.insert(0, str(_this_dir))
