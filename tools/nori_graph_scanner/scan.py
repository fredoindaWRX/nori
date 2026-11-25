"""Static, conservative scanners. Each returns edges/diagnostics; never writes source."""
from __future__ import annotations

import re
import os
import ast
import collections
from pathlib import Path
from typing import Dict, Set, Tuple, List, DefaultDict
import xml.etree.ElementTree as ElementTree

from .core import FileInfo, build_module_map, resolve_module, own_dotted, STDLIB

# ---------------------------------------------------------------------------
# Token regexes
# ---------------------------------------------------------------------------
PY_TOKEN_RE = re.compile(r"[A-Za-z0-9_\-.]+\.py\b")
CFG_TOKEN_RE = re.compile(r"[A-Za-z0-9_\-.]+\.(?:json|ya?ml|toml|ini|cfg)\b")
MD_TOKEN_RE = re.compile(r"[A-Za-z0-9_\-./\\]+\.(?:py|ps1|psm1|cs|csproj|js|jsx|ts|tsx|gd|json|ya?ml|toml|md)\b")
JS_IMPORT_RE = re.compile(r"""(?:import[^'"]*?from\s*|require\(\s*)['"]([^'"]+)['"]""")
GD_RES_RE = re.compile(r"""(?:pre)?load\(\s*['"](res://[^'"]+)['"]""")
CORTANA_RE = re.compile(r"c:[/\\]cortana", re.IGNORECASE)
NORISYSTEM_RE = re.compile(r"c:[/\\]norisystem", re.IGNORECASE)




def scan_python(fi: FileInfo, modmap) -> Tuple[dict, Set[str], dict, list, list, str]:
    """Returns (meta, targets, externals, sys_path_hints, diagnostics, parser_status)."""
    text = read_text(fi.abs)
    meta = {"doc": "", "classes": [], "functions": [], "packages": []}
    targets = set()
    externals = collections.defaultdict(int)
    diagnostics: list = []
    parser_status = "ok"
    try:
        tree = ast.parse(text, filename=str(fi.rel_posix))
    except SyntaxError as e:
        parser_status = "syntax_error"
        diagnostics.append(f"{fi.rel_posix}: SyntaxError {e}")
        for m in re.finditer(r"^(?:from\s+([\w.]+)\s+import|import\s+([\w.,\s]+))",
                             text, re.MULTILINE):
            dotted = m.group(1) or m.group(2)
            if dotted:
                for tok in dotted.split(","):
                    tok = tok.strip().split(" as ")[0].strip()
                    if tok:
                        _record_import(tok, fi, modmap, targets, externals)
        return meta, targets, dict(externals), [], diagnostics, parser_status

    doc = (ast.get_docstring(tree) or "").strip().splitlines()
    meta["doc"] = doc[0][:200] if doc else ""
    own = own_dotted(fi)
    own_parts = own[0] if own else list(fi.rel.with_suffix("").parts)
    sys_path_hints = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            meta["classes"].append(node.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) \
                and getattr(node, "col_offset", 1) == 0:
            meta["functions"].append(node.name)
        elif isinstance(node, ast.Import):
            for a in node.names:
                _record_import(a.name, fi, modmap, targets, externals)
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                base = own_parts[: max(len(own_parts) - node.level, 0)]
                if node.module:
                    base = base + node.module.split(".")
                for a in node.names:
                    dotted = ".".join(base + [a.name]) if base else a.name
                    _record_import(dotted, fi, modmap, targets, externals)
            elif node.module:
                _record_import(node.module, fi, modmap, targets, externals)
                for a in node.names:
                    _record_import(f"{node.module}.{a.name}", fi, modmap, targets, externals)
        elif isinstance(node, ast.If):
            src = ast.get_source_segment(text, node) or ""
            if "sys.path" in src:
                sys_path_hints.append(node.lineno)
    return meta, targets, dict(externals), sys_path_hints, diagnostics, parser_status


def _record_import(dotted, fi, modmap, targets, externals):
    if not dotted:
        return
    top = dotted.split(".")[0]
    hit = resolve_module(modmap, dotted)
    if hit is not None:
        rp = hit.rel_posix
        if rp != fi.rel_posix:
            targets.add(rp)
    elif top not in STDLIB:
        externals[top] += 1


def scan_launcher(fi: FileInfo, py_by_base):
    """ps1/bat/cmd: edges to uniquely-named .py files mentioned in the script."""
    text = read_text(fi.abs)
    targets = set()
    for tok in set(t.lower() for t in PY_TOKEN_RE.findall(text)):
        hits = py_by_base.get(tok, [])
        if len(hits) == 1:
            rp = hits[0].rel_posix
            if rp != fi.rel_posix:
                targets.add(rp)
    return targets


JS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs")


def scan_web(fi: FileInfo, all_by_rel):
    """js/ts: resolve relative imports only."""
    text = read_text(fi.abs)
    targets = set()
    externals = collections.defaultdict(int)
    for spec in set(JS_IMPORT_RE.findall(text)):
        if not spec.startswith("."):
            externals[spec.split("/")[0]] += 1
            continue
        base = (fi.rel.parent / spec).as_posix()
        cands = [base + e for e in JS_EXTS]
        cands += [(base.rstrip("/") + "/index" + e) for e in JS_EXTS]
        for c in cands:
            norm = os.path.normpath(c).replace("\\", "/")
            if norm in all_by_rel:
                targets.add(norm)
                break
    return targets, dict(externals)


def scan_csproj(fi: FileInfo, csproj_by_rel):
    targets = set()
    packages = []
    try:
        tree = ElementTree.parse(str(fi.abs))
    except Exception as e:
        return targets, packages, f"{fi.rel_posix}: csproj parse error {e}"
    for el in tree.iter():
        tag = el.tag.split("}")[-1]
        if tag == "ProjectReference":
            inc = el.get("Include", "").replace("\\", "/")
            cand = os.path.normpath((fi.rel.parent / inc).as_posix()).replace("\\", "/")
            if cand in csproj_by_rel:
                targets.add(cand)
        elif tag == "PackageReference":
            if el.get("Include"):
                packages.append(el.get("Include"))
    return targets, packages, None


def scan_gd(fi: FileInfo, godot_root_rel, all_by_rel):
    """Godot: resolve res:// load paths."""
    text = read_text(fi.abs)
    targets = set()
    if godot_root_rel is None:
        return targets
    for res in set(GD_RES_RE.findall(text)):
        cand = (Path(godot_root_rel) / res[len("res://"):]).as_posix()
        if cand in all_by_rel:
            targets.add(cand)
    return targets


def read_text(path: Path) -> str:
    """Read text file with encoding detection."""
    try:
        # Try UTF-8 first
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        # Fall back to latin-1 if UTF-8 fails
        with open(path, 'r', encoding='latin-1') as f:
            return f.read()


"""Static, conservative scanners. Each returns edges/diagnostics; never writes source."""
from __future__ import annotations

import re
import os
import ast
import collections
from pathlib import Path
from typing import Dict, Set, Tuple, List, DefaultDict
import codecs

from .core import FileInfo, build_module_map, resolve_module, own_dotted, STDLIB

def read_text(path: Path) -> str:
    """Read text file with encoding detection."""
    try:
        # Try UTF-8 first
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        # Fall back to latin-1 if UTF-8 fails
        with open(path, 'r', encoding='latin-1') as f:
            return f.read()

# ---------------------------------------------------------------------------  