
# ---------------------------------------------------------------------------
# Graph assembly
# ---------------------------------------------------------------------------

def build_graph(root=None):
    """Build a graph of file relationships from source root."""
    # Set default root if not provided
    if root is None:
        root = ACTIVE_ROOT
    
    files, skipped_dirs = walk_source(root)
    issues: List[str] = []
    oversize = 0
    nodes: Dict[str, dict] = {}

    for fi in files:
        nt = node_type(fi)
        if not _is_useful(fi.rel.name, fi.ext):
            continue
        nodes[fi.rel_posix] = {
            "id": node_id(fi.rel_posix), "rel": fi.rel_posix, "abs": str(fi.abs),
            "ext": fi.ext, "type": nt, "subsystem": classify_subsystem(fi, nt),
            "size": fi.size, "mtime": _mtime(fi), "content_hash": "",
            "parser_status": "skipped_oversize" if fi.size > MAX_FILE_BYTES else "ok",
            "parse_diagnostics": [], "classes": [], "functions": [], "packages": [],
            "legacy_ref_count": 0, "external_dep_count": 0,
        }
        if fi.size > MAX_FILE_BYTES:
            oversize += 1
    if oversize:
        issues.append(f"{oversize} file(s) > {MAX_FILE_BYTES} bytes -> SKIPPED_OVERSIZE nodes")

    edges, externals, legacy_refs, norisystem_refs = _build_edges(nodes, issues)
    return _assemble(nodes, edges, externals, legacy_refs, norisystem_refs, issues,
                     skipped_dirs, files)


def _build_edges(nodes, issues):
    edges = []
    externals = collections.defaultdict(int)
    legacy_refs = []
    norisystem_refs = []

    py_files = [FileInfo(Path(n["rel"]), Path(n["abs"]), n["ext"], n["size"])
                for n in nodes.values() if n["type"] in ("python-module", "test")]
    modmap, collisions = build_module_map(py_files)
    if collisions:
        issues.append(f"{collisions} dotted-name collision(s) in module map (first wins)")
    py_by_base = collections.defaultdict(list)
    for fi in py_files:
        py_by_base[fi.rel.name.lower()].append(fi)
    cfg_by_base = collections.defaultdict(list)
    for n in nodes.values():
        if n["type"] == "config":
            cfg_by_base[n["rel"].rsplit("/", 1)[-1].lower()].append(n)
    all_by_rel = {n["rel"]: n for n in nodes.values()}
    csproj_by_rel = {n["rel"]: n for n in nodes.values() if n["type"] == "csharp-project"}
    godot_roots = [n["rel"] for n in nodes.values() if n["type"] == "godot-project"]
    godot_root_rel = str(Path(godot_roots[0]).parent).replace("\\", "/") if godot_roots else None
    node_by_rel = {n["rel"]: n["id"] for n in nodes.values()}

    def add(src, dst, kind, evidence="", loc=""):
        edges.append({"source": src, "target": dst, "type": kind,
                      "evidence": evidence[:200], "location": loc, "confidence": "static"})

    for rel_posix, n in sorted(nodes.items()):
        fid = n["id"]
        fi = FileInfo(Path(rel_posix), Path(n["abs"]), n["ext"], n["size"])
        nt = n["type"]
        if n["parser_status"] == "skipped_oversize":
            content = read_text(fi.abs)
            _scan_legacy_refs(content, rel_posix, n, fid, edges)
            add(fid, "@" + n["subsystem"], "belongs_to", "membership", rel_posix)
            continue
        content = read_text(fi.abs)

        if nt in ("python-module", "test"):
            meta, targets, ext_count, hints, di, pstat = scan_python(fi, modmap)
            n["parser_status"] = pstat
            n["parse_diagnostics"] = di
            for k in ("classes", "functions", "packages"):
                n[k] = meta.get(k, [])
            for k, v in ext_count.items():
                externals[k] += v
            n["external_dep_count"] = sum(ext_count.values())
            kind = "tests" if nt == "test" else "imports"
            for t in targets:
                add(fid, node_by_rel[t], kind, "AST import", rel_posix)
            if pstat == "syntax_error":
                issues.append(f"{rel_posix}: SyntaxError (node preserved, regex edges only)")
        elif nt == "launcher-script":
            for t in scan_launcher(fi, py_by_base):
                add(fid, node_by_rel[t], "launches", "launcher -> " + Path(t).name, rel_posix)
        elif nt == "web-source":
            targets, ext_count = scan_web(fi, all_by_rel)
            for k, v in ext_count.items():
                externals[k] += v
            n["external_dep_count"] = sum(ext_count.values())
            for t in targets:
                add(fid, node_by_rel[t], "imports", "web relative import", rel_posix)
        elif nt == "csharp-project":
            targets, pkgs, issue = scan_csproj(fi, csproj_by_rel)
            n["packages"] = pkgs
            n["external_dep_count"] = len(pkgs)
            if issue:
                issues.append(issue)
            for t in targets:
                add(fid, node_by_rel[t], "references", "ProjectReference", rel_posix)
        elif nt == "godot-script":
            for t in scan_gd(fi, godot_root_rel, all_by_rel):
                add(fid, node_by_rel[t], "loads", "res:// load", rel_posix)

        if nt in ("python-module", "test", "launcher-script", "web-source"):
            for tok in set(t.lower() for t in CFG_TOKEN_RE.findall(content)):
                hits = cfg_by_base.get(tok, [])
                if len(hits) == 1:
                    target = hits[0]["rel"]
                    if target != rel_posix:
                        add(fid, node_by_rel[target], "configured_by", "config token " + tok, rel_posix)

        if nt == "doc":
            for tok in set(t.lower() for t in MD_TOKEN_RE.findall(content)):
                base = os.path.basename(tok.replace("\\", "/"))
                hits = py_by_base.get(base) or cfg_by_base.get(base, [])
                target = None
                if len(hits) == 1:
                    target = hits[0].rel_posix if hasattr(hits[0], "rel_posix") else hits[0]["rel"]
                elif len(hits) == 0:
                    continue
                if target and target != rel_posix:
                    add(fid, node_by_rel[target], "references", "doc token " + tok, rel_posix)

        refs = _scan_legacy_refs(content, rel_posix, n, fid, edges)
        if refs:
            legacy_refs.append({"src": rel_posix,
                                "lines": [{"line": ln, "snippet": s} for ln, s in refs],
                                "classification": _classify_src(rel_posix)})
        add(fid, "@" + n["subsystem"], "belongs_to", "membership", rel_posix)

    return edges, externals, legacy_refs, norisystem_refs

"""Graph construction: file / subsystem / special nodes + semantic edges.

Machine-readable model is plain dict/list (JSON-serialisable). Oversize files are
still represented (status SKIPPED_OVERSIZE); SyntaxError files keep a node and any
regex-extractable edges. The legacy root C:\\Cortana is NEVER traversed -- it is
represented by a single opaque node, plus edges only from string references found
inside C:\\\\Nori.
""""""Graph construction: file / subsystem / special nodes + semantic edges.

Machine-readable model is plain dict/list (JSON-serialisable). Oversize files are
still represented (status SKIPPED_OVERSIZE); SyntaxError files keep a node and any
regex-extractable edges. The legacy root C:\\\\Cortana is NEVER traversed -- it is
represented by a single opaque node, plus edges only from string references found
inside C:\\\\Nori.
""""""Graph construction: file / subsystem / special nodes + semantic edges.

Machine-readable model is plain dict/list (JSON-serialisable). Oversize files are
still represented (status SKIPPED_OVERSIZE); SyntaxError files keep a node and any
regex-extractable edges. The legacy root C:\\\\Cortana is NEVER traversed -- it is
represented by a single opaque node, plus edges only from string references found
inside C:\\\\Nori.
""""""Graph construction: file / subsystem / special nodes + semantic edges.

Machine-readable model is plain dict/list (JSON-serialisable). Oversize files are
still represented (status SKIPPED_OVERSIZE); SyntaxError files keep a node and any
regex-extractable edges. The legacy root C:\\\\Cortana is NEVER traversed -- it is
represented by a single opaque node, plus edges only from string references found
inside C:\\\\Nori.
"""from .core import (
    FileInfo, walk_source, node_type, classify_subsystem,
    build_module_map, STDLIB, node_id,
)from __future__ import annotations

import os
import collections
from pathlib import Path
from typing import Dict, List

from .core import (
    FileInfo, walk_source, node_type, classify_subsystem,
    build_module_map, STDLIB, node_id,
)
from .scan import (
    read_text, scan_python, scan_launcher, scan_web, scan_csproj, scan_gd,
    CORTANA_RE, NORISYSTEM_RE, MD_TOKEN_RE, CFG_TOKEN_RE,
)
from . import ACTIVE_ROOT
from .. import MAX_FILE_BYTES, IGNORE_DIRS, is_volatile# --------------------------------------------------------------------------- 
# Graph assembly
# ---------------------------------------------------------------------------

def build_graph(root=None):
    """Build a graph of file relationships from source root."""
    # Set default root if not provided
    if root is None:
        from .. import ACTIVE_ROOT
        root = ACTIVE_ROOT
    
    files, skipped_dirs = walk_source(root)
    issues: List[str] = []
    oversize = 0# --------------------------------------------------------------------------- 
# Graph assembly
# ---------------------------------------------------------------------------

def build_graph(root=None):
    """Build a graph of file relationships from source root."""
    # Set default root if not provided
    if root is None:
        root = ACTIVE_ROOT
    
    files, skipped_dirs = walk_source(root)
    issues: List[str] = []
    oversize = 0\"\"\"
from __future__ import annotations

import os
import collections
from pathlib import Path
from typing import Dict, List

from .core import (
    FileInfo, walk_source, node_type, classify_subsystem,
    build_module_map, STDLIB, node_id,
)
from .scan import (
    read_text, scan_python, scan_launcher, scan_web, scan_csproj, scan_gd,
    CORTANA_RE, NORISYSTEM_RE, MD_TOKEN_RE, CFG_TOKEN_RE,
)
from . import ACTIVE_ROOT"""Graph construction: file / subsystem / special nodes + semantic edges.

Machine-readable model is plain dict/list (JSON-serialisable). Oversize files are
still represented (status SKIPPED_OVERSIZE); SyntaxError files keep a node and any
regex-extractable edges. The legacy root C:\Cortana is NEVER traversed -- it is
represented by a single opaque node, plus edges only from string references found
inside C:\Nori.

"""
from __future__ import annotations

import os
import collections
from pathlib import Path
from typing import Dict, List

from .core import (
    FileInfo, walk_source, node_type, classify_subsystem,
    build_module_map, STDLIB, node_id,
)
from .scan import (
    read_text, scan_python, scan_launcher, scan_web, scan_csproj, scan_gd,
    CORTANA_RE, NORISYSTEM_RE, MD_TOKEN_RE, CFG_TOKEN_RE,
)
from . import ACTIVE_ROOT"""Graph construction: file / subsystem / special nodes + semantic edges.

Machine-readable model is plain dict/list (JSON-serialisable). Oversize files are
still represented (status SKIPPED_OVERSIZE); SyntaxError files keep a node and any
regex-extractable edges. The legacy root C:\Cortana is NEVER traversed -- it is
represented by a single opaque node, plus edges only from string references found
inside C:\Nori.

"""
from __future__ import annotations

import os
import collections
from pathlib import Path
from typing import Dict, List

from .core import (
    FileInfo, walk_source, node_type, classify_subsystem,
    build_module_map, STDLIB, node_id,
)
from .scan import (
    read_text, scan_python, scan_launcher, scan_web, scan_csproj, scan_gd,
    CORTANA_RE, NORISYSTEM_RE, MD_TOKEN_RE, CFG_TOKEN_RE,
)
from . import ACTIVE_ROOT
from .. import MAX_FILE_BYTES, IGNORE_DIRS, is_volatile