
# ---------------------------------------------------------------------------
# Classification: node type + subsystem
# ---------------------------------------------------------------------------

def node_type(fi: FileInfo) -> str:
    n = fi.rel.name.lower()
    if n == "project.godot":
        return "godot-project"
    if n == "makefile" or n.startswith("dockerfile"):
        return "build-config"
    ext = fi.ext
    if ext == ".py":
        base = fi.rel.stem.lower()
        parts = [p.lower() for p in fi.rel.parts]
        if base.startswith("test_") or base.endswith("_test") or "tests" in parts:
            return "test"
        return "python-module"
    if ext in (".ps1", ".psm1", ".bat", ".cmd"):
        return "launcher-script"
    if ext == ".cs":
        return "csharp-source"
    if ext == ".csproj":
        return "csharp-project"
    if ext in (".js", ".jsx", ".ts", ".tsx", ".mjs"):
        return "web-source"
    if ext == ".gd":
        return "godot-script"
    if ext == ".html":
        return "ui-prototype"
    if ext in CONFIG_EXTS:
        return "config"
    if ext in DOC_EXTS:
        return "doc"
    return "other"

# Ordered (keyword-tuple, subsystem) rules applied to lowercase path parts + name.
SUBSYSTEM_RULES = [
    (("cortana", "aoki"), "Legacy Lineage (in-tree)"),
    (("tests", "tests_startup", "testing"), "Tests"),
    (("voice", "wake", "tts", "stt", "audio", "speech", "sensory", "sound", "hotword"), "Voice"),
    (("memory", "knowledge", "recall"), "Memory"),
    (("tablet_ui", "desktop", "frontend", "canvas", "avatar", "hud", "ui"), "UI"),
    (("workers", "devteam", "development_workers", "knights", "worker"), "Workers"),
    (("models", "llm", "ollama", "prompts", "persona", "model"), "Models"),
    (("services", "bus", "gateway", "orchestration", "hub", "runtime", "server", "service"), "Services"),
    (("google", "home_assistant", "integrations", "integration", "bridge", "transport",
      "sync", "android-client", "android", "api"), "Integrations"),
    (("security", "auth"), "Security"),
    (("tools", "scripts", "build-tools", "build_tools", "development", "dev"), "Tools"),
    (("docs", "documentation", "references"), "Documentation"),
    (("config", "configuration"), "Configuration"),
]

def classify_subsystem(fi: FileInfo, ntype: str) -> str:
    parts = [p.lower() for p in fi.rel.parts[:-1]]
    name = fi.rel.name.lower()
    stem = fi.rel.stem.lower()
    hay = parts + [name]
    if ntype == "test":
        return "Tests"
    for keywords, sub in SUBSYSTEM_RULES:
        for kw in keywords:
            for h in hay:
                if kw in h:
                    return sub
    if ntype == "config":
        return "Configuration"
    if ntype == "doc":
        return "Documentation"
    if stem in ("main", "manage", "bus", "recovery", "diagnostics"):
        return "Nori Core"
    if len(fi.rel.parts) <= 2:
        return "Nori Core"
    return "Other"

# ---------------------------------------------------------------------------
# Python module map
# ---------------------------------------------------------------------------

# Python import-resolution roots. nori/shared and nori/OS/robotics are added to
# sys.path by the running Nori system (Phase-7 investigation).
SRC_ROOTS = [
    ACTIVE_ROOT,
    ACTIVE_ROOT / "nori",
    ACTIVE_ROOT / "nori" / "packages",
    ACTIVE_ROOT / "nori" / "knights",
    ACTIVE_ROOT / "nori" / "shared",
    ACTIVE_ROOT / "nori" / "OS" / "robotics",
]

try:
    STDLIB = set(sys.stdlib_module_names)  # py3.10+
except AttributeError:
    STDLIB = {"os", "sys", "re", "json", "time", "pathlib", "typing", "collections"}


def build_module_map(py_files):
    """Map dotted module name -> FileInfo. First occurrence wins; collisions counted."""
    modmap = {}
    collisions = 0
    for fi in py_files:
        for sr in SRC_ROOTS:
            try:
                sub = fi.abs.relative_to(sr)
            except ValueError:
                continue
            parts = list(sub.with_suffix("").parts)
            if not parts:
                continue
            if parts[-1].lower() == "__init__":
                parts = parts[:-1]
            if not parts:
                continue
            dotted = ".".join(parts)
            if dotted in modmap:
                collisions += 1
            else:
                modmap[dotted] = fi
    return modmap, collisions


def resolve_module(modmap, dotted: str):
    """Resolve a dotted import to a scanned file, longest-prefix-first."""
    parts = dotted.split(".")
    for i in range(len(parts), 0, -1):
        cand = ".".join(parts[:i])
        if cand in modmap:
            return modmap[cand]
    return None


def own_dotted(fi: FileInfo):
    """All dotted-name candidates for this file, shortest package root first."""
    cands = []
    for sr in SRC_ROOTS:
        try:
            sub = fi.abs.relative_to(sr)
        except ValueError:
            continue
        parts = list(sub.with_suffix("").parts)
        if parts and parts[-1].lower() == "__init__":
            parts = parts[:-1]
        if parts:
            cands.append(parts)
    cands.sort(key=len)
    return cands
