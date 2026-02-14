"""
Bootstrap module for FreeCAD automation scripts.
Handles stdin→JSON input and stdout→JSON output protocol.
All debug output goes to stderr to keep stdout clean for JSON.
"""

import sys
import json


def log(msg):
    """Print debug message to stderr (captured by Node.js for logging)."""
    print(f"[freecad] {msg}", file=sys.stderr, flush=True)


def read_input():
    """Read JSON config from stdin."""
    raw_bytes = sys.stdin.buffer.read()
    if not raw_bytes.strip():
        raise ValueError("No input received on stdin")
    # Always decode stdin as UTF-8 to avoid locale-dependent surrogate escapes.
    raw = raw_bytes.decode("utf-8")
    return json.loads(raw)


def respond(data):
    """Write JSON response to stdout and exit."""
    print(json.dumps(data, ensure_ascii=False), flush=True)
    sys.exit(0)


def respond_error(msg, details=None):
    """Write error JSON to stdout and exit with code 0 (so Node can parse it)."""
    result = {"success": False, "error": str(msg)}
    if details:
        result["details"] = details
    print(json.dumps(result, ensure_ascii=False), flush=True)
    sys.exit(1)


def init_freecad():
    """Initialize FreeCAD environment. Must be called before any FreeCAD imports."""
    import FreeCAD
    log(f"FreeCAD {FreeCAD.Version()[0]}.{FreeCAD.Version()[1]} initialized")
    return FreeCAD
