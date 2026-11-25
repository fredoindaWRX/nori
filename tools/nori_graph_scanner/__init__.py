"""Nori Graph Scanner — first-class Nori architecture-discovery component.

Read-only scanner of the active Nori root (C:\\Nori) that builds a machine-readable
architecture graph and a human-facing Obsidian vault. The legacy root C:\\Cortana is
treated as an *opaque external reference*: it is never traversed, but string/path
references to it are detected and represented as a single logical node.

Outputs (all outside the scanned C:\\Nori source tree):
    graph DB / canonical JSON : C:\\NoriGraph\\graph\\nori_graph.json
    incremental cache         : C:\\NoriGraph\\graph\\scan_cache.json
    audit                     : C:\\NoriGraph\\audit\\graph-audit-<ts>.json
    Obsidian vault            : %USERPROFILE%\\Documents\\NoriGraphVault

Read-only enforcement: scanned source files in C:\\Nori are only ever opened for
reading. Nothing under C:\\Nori is written, formatted, or have its mtime changed.
"""

from __future__ import annotations
import os
import re
from pathlib import Path

__version__ = "1.0.0"

# ---------------------------------------------------------------------------
# Roots / locations
# ---------------------------------------------------------------------------
ACTIVE_ROOT = Path(r"C:\Nori")
LEGACY_ROOT = Path(r"C:\Cortana")           # opaque — never traversed
NONGN_ROOTS = {                              # siblings that are NOT active roots
    Path(r"C:\NoriEvolution"),
    Path(r"C:\Nori-Migration-Backup"),
    Path(r"C:\NoriSystem"),
}

USERPROFILE = Path(os.path.expanduser("~"))
NORIGRAPH_HOME = Path(r"C:\NoriGraph")
GRAPH_DIR = NORIGRAPH_HOME / "graph"
AUDIT_DIR = NORIGRAPH_HOME / "audit"
DEFAULT_VAULT = USERPROFILE / "Documents" / "NoriGraphVault"
DEFAULT_CACHE = GRAPH_DIR / "scan_cache.json"
DEFAULT_GRAPH_JSON = GRAPH_DIR / "nori_graph.json"

# ---------------------------------------------------------------------------
# File-type classification
# ---------------------------------------------------------------------------
CODE_EXTS = {".py", ".ps1", ".psm1", ".bat", ".cmd", ".cs", ".csproj",
             ".js", ".jsx", ".ts", ".tsx", ".mjs", ".gd", ".html"}
CONFIG_EXTS = {".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".xml"}
DOC_EXTS = {".md", ".mdx", ".rst", ".txt"}
SPECIAL_NAMES = {"project.godot", "makefile"}

MAX_FILE_BYTES = 2 * 1024 * 1024  # 2 MB — oversize files become SKIPPED_OVERSIZE nodes

# ---------------------------------------------------------------------------
# Directory / file ignore policy
# ---------------------------------------------------------------------------
IGNORE_DIRS = {
    ".git", ".hg", ".svn", ".idea", ".vscode", ".clinerules", ".opencode",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".sync_state",
    ".aider.tags.cache.v4", ".aider.tags.cache.v3",
    "node_modules", "__pycache__", "site-packages", "htmlcov",
    "archive", "backups", "backup", "build", "dist", "bin", "obj",
    "cache", "caches", "logs", "log", "runtime-data", "output", "out",
    "temp", "tmp", "conflicts", "cleanup-reports", "dev_patches",
    "target", ".gradle", ".next", ".nuxt", "coverage",
    # Nori-specific noise discovered by inventory:
    "data", "updates", "lib", "usr", "sbin", "opt",            # runtime data / embedded linux rootfs
    "binaries", "intermediate", "deriveddatacache", "saved",     # Unreal engine artifacts
}

def _is_venv_dir(name: str) -> bool:
    n = name.lower()
    return n.startswith(".venv") or n in {"venv", "venvs", "env", ".env", "virtualenv"}

def _is_noise_dir(name: str) -> bool:
    n = name.lower()
    if n.startswith("pytest-temp") or n.startswith("pytest_"):
        return True   # pytest run artifacts at repo root
    if n.startswith("_"):
        return True   # scratch/migration dirs (e.g. _migration, _aoki_* at root)
    return False

def _skip_file(name: str) -> bool:
    nl = name.lower()
    if nl in {".gitignore", ".gitattributes", ".gitmodules"}:
        return True
    if nl.endswith((".pyc", ".pyo", ".so", ".dll", ".dylib", ".exe", ".apk",
                    ".msi", ".iso", ".vhdx", ".zip", ".tar", ".gz", ".7z",
                    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
                    ".wav", ".mp3", ".mp4", ".mkv", ".blend", ".uasset",
                    ".log", ".pcap", ".pcapng")):
        return True
    return False

# Live runtime state written by the RUNNING Nori system (never source, never us).
VOLATILE_RES = [
    re.compile(r"(^|/)presence/", re.IGNORECASE),
    re.compile(r"(^|/)service_state\.json$", re.IGNORECASE),
]

def is_volatile(rel_posix: str) -> bool:
    return any(r.search(rel_posix) for r in VOLATILE_RES)

# Export node_id for use by graph module
__all__ = [
    "ACTIVE_ROOT", "LEGACY_ROOT", "NONGN_ROOTS",
    "USERPROFILE", "NORIGRAPH_HOME", "GRAPH_DIR", "AUDIT_DIR",
    "DEFAULT_VAULT", "DEFAULT_CACHE", "DEFAULT_GRAPH_JSON",
    "CODE_EXTS", "CONFIG_EXTS", "DOC_EXTS", "SPECIAL_NAMES",
    "MAX_FILE_BYTES", "IGNORE_DIRS", "is_volatile", "node_id"
]


"""Nori Graph Scanner — first-class Nori architecture-discovery component.

Read-only scanner of the active Nori root (C:\\\\Nori) that builds a machine-readable
architecture graph and a human-facing Obsidian vault. The legacy root C:\\\\Cortana is
treated as an *opaque external reference*: it is never traversed, but string/path
references to it are detected and represented as a single logical node.

Outputs (all outside the scanned C:\\\\Nori source tree):
    graph DB / canonical JSON : C:\\\\NoriGraph\\\\graph\\\\nori_graph.json
    incremental cache         : C:\\\\NoriGraph\\\\graph\\\\scan_cache.json
    audit                     : C:\\\\NoriGraph\\\\audit\\\\graph-audit-<ts>.json
    Obsidian vault            : %USERPROFILE%\\\\Documents\\\\NoriGraphVault

Read-only enforcement: scanned source files in C:\\\\Nori are only ever opened for
reading. Nothing under C:\\\\Nori is written, formatted, or have its mtime changed.
"""

from __future__ import annotations
import os
import re
from pathlib import Path

__version__ = "1.0.0"

# Import node_id from core module
from .core import node_id

# ---------------------------------------------------------------------------  
# Roots / locations
# ---------------------------------------------------------------------------
ACTIVE_ROOT = Path(r"C:\Nori")
LEGACY_ROOT = Path(r"C:\Cortana")           # opaque — never traversed
NONGN_ROOTS = {                              # siblings that are NOT active roots
    Path(r"C:\NoriEvolution"),
    Path(r"C:\Nori-Migration-Backup"),
    Path(r"C:\NoriSystem"),
}"""Nori Graph Scanner — first-class Nori architecture-discovery component.

Read-only scanner of the active Nori root (C:\\\\Nori) that builds a machine-readable
architecture graph and a human-facing Obsidian vault. The legacy root C:\\\\Cortana is
treated as an *opaque external reference*: it is never traversed, but string/path
references to it are detected and represented as a single logical node.

Outputs (all outside the scanned C:\\\\Nori source tree):
    graph DB / canonical JSON : C:\\\\NoriGraph\\\\graph\\\\nori_graph.json
    incremental cache         : C:\\\\NoriGraph\\\\graph\\\\scan_cache.json
    audit                     : C:\\\\NoriGraph\\\\audit\\\\graph-audit-<ts>.json
    Obsidian vault            : %USERPROFILE%\\\\Documents\\\\NoriGraphVault

Read-only enforcement: scanned source files in C:\\\\Nori are only ever opened for
reading. Nothing under C:\\\\Nori is written, formatted, or have its mtime changed.
"""

from __future__ import annotations
import os
import re
from pathlib import Path

__version__ = "1.0.0"

# Import node_id from core module
from .core import node_id

# ---------------------------------------------------------------------------  
# Roots / locations
# ---------------------------------------------------------------------------
ACTIVE_ROOT = Path(r"C:\Nori")
LEGACY_ROOT = Path(r"C:\Cortana")           # opaque — never traversed
NONGN_ROOTS = {                              # siblings that are NOT active roots
    Path(r"C:\NoriEvolution"),
    Path(r"C:\Nori-Migration-Backup"),
    Path(r"C:\NoriSystem"),
}from __future__ import annotations
import os
import re
from pathlib import Path

__version__ = "1.0.0"

# Import node_id from core module
from .core import node_id

# ---------------------------------------------------------------------------  