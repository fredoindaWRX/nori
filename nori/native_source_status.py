from __future__ import annotations

import json
import re
import time
from pathlib import Path


SOURCE_ROOT = Path(r"C:\Nori\data\forge\tasks\a6b8a860bc4c\workspace\candidate\AokiNativeDesktop")
PUBLISH_SMOKE_ROOT = SOURCE_ROOT / "artifacts" / "nori-source-rename-smoke"
REPORT_PATH = Path(r"C:\Nori\health\nori_native_source_status.json")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def _xml_value(text: str, tag: str) -> str | None:
    match = re.search(rf"<{re.escape(tag)}>(.*?)</{re.escape(tag)}>", text, flags=re.I | re.S)
    return match.group(1).strip() if match else None


def inspect_source(root: Path = SOURCE_ROOT) -> dict[str, object]:
    app_project = root / "src" / "Aoki.Desktop" / "Aoki.Desktop.csproj"
    core_project = root / "src" / "Aoki.Desktop.Core" / "Aoki.Desktop.Core.csproj"
    tests_project = root / "tests" / "Aoki.Desktop.Tests" / "Aoki.Desktop.Tests.csproj"
    nori_idle = root / "src" / "Aoki.Desktop" / "Assets" / "NoriIdleFace.png"
    nori_body = root / "src" / "Aoki.Desktop" / "Assets" / "NoriWorkingBody.png"

    files = {
        "app_project": app_project.exists(),
        "core_project": core_project.exists(),
        "tests_project": tests_project.exists(),
        "nori_idle_face": nori_idle.exists() and nori_idle.stat().st_size > 0,
        "nori_working_body": nori_body.exists() and nori_body.stat().st_size > 0,
    }

    details: dict[str, object] = {}
    blockers: list[str] = []
    publish_root = root / "artifacts" / "nori-source-rename-smoke"

    if app_project.exists():
        app_xml = _read(app_project)
        details["assembly_name"] = _xml_value(app_xml, "AssemblyName")
        details["root_namespace"] = _xml_value(app_xml, "RootNamespace")
        details["application_icon"] = _xml_value(app_xml, "ApplicationIcon")
        details["uninstaller_link"] = "Uninstall-Nori.ps1" if "Uninstall-Nori.ps1" in app_xml else "Uninstall-Aoki.ps1" if "Uninstall-Aoki.ps1" in app_xml else None

        if details["assembly_name"] != "Nori.Desktop":
            blockers.append("desktop_assembly_name_not_nori")
        if details["root_namespace"] != "Nori.Desktop":
            blockers.append("desktop_root_namespace_not_nori")
        if details["application_icon"] != r"Assets\NoriApp.ico":
            blockers.append("desktop_application_icon_not_nori")
        if details["uninstaller_link"] != "Uninstall-Nori.ps1":
            blockers.append("desktop_uninstaller_link_not_nori")
    else:
        blockers.append("desktop_project_missing")

    for name, ok in files.items():
        if not ok:
            blockers.append(f"{name}_missing")

    published = {
        "publish_root": str(publish_root),
        "nori_desktop_exe": (publish_root / "Nori.Desktop.exe").exists(),
        "nori_desktop_pri": (publish_root / "Nori.Desktop.pri").exists(),
        "nori_deps_json": (publish_root / "Nori.Desktop.deps.json").exists(),
        "nori_runtimeconfig_json": (publish_root / "Nori.Desktop.runtimeconfig.json").exists(),
        "nori_uninstaller": (publish_root / "Uninstall-Nori.ps1").exists(),
        "legacy_desktop_exe_absent": not (publish_root / "Aoki.Desktop.exe").exists(),
    }

    for name, ok in published.items():
        if name != "publish_root" and not ok:
            blockers.append(f"published_{name}_not_verified")

    return {
        "schema": "nori.native_source.status.v1",
        "checked_at": time.time(),
        "source_root": str(root),
        "files": files,
        "details": details,
        "published": published,
        "source_identity_complete": not blockers,
        "blockers": blockers,
    }


def write_report(path: Path = REPORT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(inspect_source(), indent=2, sort_keys=True), encoding="utf-8")
    return path


if __name__ == "__main__":
    print(json.dumps(inspect_source(), indent=2, sort_keys=True))
