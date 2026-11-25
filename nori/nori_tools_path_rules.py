from __future__ import annotations

from dataclasses import dataclass
import re


class PathRuleError(ValueError):
    pass


@dataclass(frozen=True)
class PathDecision:
    ok: bool
    action: str
    normalized_path: str
    reason: str


_ABSOLUTE_WINDOWS_RE = re.compile(r"^[A-Za-z]:[\\/]")


def _clean_path(path: str) -> str:
    value = str(path or "").strip().strip('"').strip("'")
    value = value.replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    return value


def _parts(path: str) -> list[str]:
    return [part for part in path.split("/") if part not in ("", ".")]


def _is_absolute(path: str) -> bool:
    return (
        bool(_ABSOLUTE_WINDOWS_RE.match(path))
        or path.startswith("/")
        or path.startswith("//")
    )


def _reject_traversal(parts: list[str]) -> None:
    if any(part == ".." for part in parts):
        raise PathRuleError("PATH_TRAVERSAL_BLOCKED")


def normalize_task_relative_path(path: str, current_task_id: str | None = None) -> str:
    cleaned = _clean_path(path)

    if not cleaned:
        raise PathRuleError("EMPTY_PATH")

    if _is_absolute(cleaned):
        raise PathRuleError("ABSOLUTE_PATH_NOT_ALLOWED_FOR_TASK_FILE")

    parts = _parts(cleaned)
    _reject_traversal(parts)

    if not parts:
        raise PathRuleError("EMPTY_PATH")

    if parts[0].lower() == "tasks":
        if len(parts) < 3:
            raise PathRuleError("TASK_PREFIX_INVALID")

        supplied_task_id = parts[1]

        if current_task_id and supplied_task_id == current_task_id:
            stripped = parts[2:]
            if not stripped:
                raise PathRuleError("TASK_PREFIX_EMPTY_AFTER_STRIP")
            return "/".join(stripped)

        raise PathRuleError("TASK_PREFIX_NOT_CURRENT_TASK")

    return "/".join(parts)


def choose_read_action(path: str, current_task_id: str | None = None, project_root: str = "C:/Nori") -> PathDecision:
    cleaned = _clean_path(path)

    if not cleaned:
        return PathDecision(False, "blocked", "", "EMPTY_PATH")

    normalized_project_root = _clean_path(project_root).rstrip("/")
    lower_cleaned = cleaned.lower()
    lower_project_root = normalized_project_root.lower()

    if _is_absolute(cleaned):
        if lower_cleaned == lower_project_root:
            return PathDecision(False, "blocked", "", "PROJECT_ROOT_IS_DIRECTORY")

        prefix = lower_project_root + "/"
        if lower_cleaned.startswith(prefix):
            relative = cleaned[len(normalized_project_root) + 1:]
            try:
                parts = _parts(relative)
                _reject_traversal(parts)
            except PathRuleError as exc:
                return PathDecision(False, "blocked", "", str(exc))
            return PathDecision(True, "project_read", "/".join(parts), "ABSOLUTE_PROJECT_SOURCE_PATH")

        return PathDecision(False, "blocked", "", "ABSOLUTE_PATH_OUTSIDE_PROJECT")

    parts = _parts(cleaned)

    try:
        _reject_traversal(parts)
    except PathRuleError as exc:
        return PathDecision(False, "blocked", "", str(exc))

    if not parts:
        return PathDecision(False, "blocked", "", "EMPTY_PATH")

    if parts[0].lower() == "tasks":
        try:
            task_path = normalize_task_relative_path(cleaned, current_task_id)
            return PathDecision(True, "read_file", task_path, "STRIPPED_CURRENT_TASK_PREFIX")
        except PathRuleError as exc:
            return PathDecision(False, "blocked", "", str(exc))

    project_prefixes = {
        ".opencode",
        "nori",
        "docs",
        "scripts",
        "tests",
        "tools",
        "server-os",
        "nori-server-os",
    }

    project_root_files = {
        "pyproject.toml",
        "requirements.txt",
        "readme.md",
        "developer_guide.md",
        "opencode.json",
    }

    first = parts[0].lower()

    if first in project_prefixes or first in project_root_files:
        return PathDecision(True, "project_read", "/".join(parts), "RELATIVE_PROJECT_SOURCE_PATH")

    return PathDecision(True, "read_file", "/".join(parts), "TASK_LOCAL_RELATIVE_PATH")


def explain_read_failure(path: str, current_task_id: str | None = None) -> str:
    decision = choose_read_action(path, current_task_id=current_task_id)

    if decision.ok:
        return (
            "Use "
            + decision.action
            + " with path "
            + decision.normalized_path
            + ". Reason: "
            + decision.reason
        )

    if decision.reason == "TASK_PREFIX_NOT_CURRENT_TASK":
        return "Blocked: path includes tasks/<task_id> for a different or unknown task."

    if decision.reason == "ABSOLUTE_PATH_NOT_ALLOWED_FOR_TASK_FILE":
        return "Blocked: read_file cannot use absolute paths. Use project_read for project source files."

    return "Blocked: " + decision.reason
