"""NORI's deterministic hard floor for trusted, typed tool hosts.

This is application admission, not an OS sandbox. Unrestricted code/plugin
execution stays disabled until a host-enforced isolated runner exists. Local
services are allowed; remote egress stays closed until a transport adapter can
prove a Tailscale path. A caller-provided flag is never transport proof.
"""
from __future__ import annotations

import ipaddress
import json
import math
from pathlib import Path, PureWindowsPath
import re
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from nori_installation_paths import core_installation_root

ROOT = core_installation_root(Path(__file__).resolve().parents[1])
FLOOR_PATH = ROOT / "security" / "hard_floor.yaml"

# Public-web egress allowlist for owner-approved research connectors.
# Host-only: no credentials, no fragments; path/query bounded by caller.
_PUBLIC_WEB_HOSTS = frozenset({
    "html.duckduckgo.com",
    "lite.duckduckgo.com",
    "duckduckgo.com",
    "api.github.com",
})


def public_web_host_allowed(host: str | None) -> bool:
    """Check whether a hostname is on the owner-approved public-web list."""
    if not host or not isinstance(host, str):
        return False
    return host.strip().casefold().rstrip(".") in _PUBLIC_WEB_HOSTS


class HardFloorViolation(PermissionError):
    """A fixed platform invariant or unavailable enforcement backend denied an effect."""


_TRUE_KEYS = {
    "absolute": {"covenant_immutable", "sentinel_immutable", "watchman_immutable",
                 "owner_fingerprint_immutable", "private_key_nonexportable",
                 "authentication_required"},
    "system": {"protected_system_deletion", "raw_disk_write_blocked",
               "remote_network_requires_tailscale", "model_download_requires_owner"},
}
_PHYSICAL = {"max_actuator_torque_nm", "max_linear_speed_m_s",
             "min_obstacle_distance_m", "emergency_stop_overrides"}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate hard-floor key")
        result[key] = value
    return result


def load_hard_floor(path=None):
    """Load the small JSON-compatible YAML document; absent/weakened floors fail closed.

    Hosts load at startup. Watchman's decision loop uses its validated profile,
    so policy file access is never on the physical command hot path.
    """
    try:
        document = json.loads(Path(path or FLOOR_PATH).read_text(encoding="utf-8"),
                              object_pairs_hook=_unique_object)
        if not isinstance(document, dict) or set(document) != {"version", "absolute", "physical", "system"}:
            raise ValueError("Invalid hard-floor sections")
        if type(document["version"]) is not int or document["version"] != 1:
            raise ValueError("Unsupported hard-floor version")
        for section, keys in _TRUE_KEYS.items():
            values = document[section]
            if not isinstance(values, dict) or set(values) != keys or any(values[key] is not True for key in keys):
                raise ValueError("Hard-floor invariant disabled")
        physical = document["physical"]
        if not isinstance(physical, dict) or set(physical) != _PHYSICAL or physical["emergency_stop_overrides"] is not True:
            raise ValueError("Invalid physical floor")
        for key in _PHYSICAL - {"emergency_stop_overrides"}:
            value = physical[key]
            if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
                raise ValueError("Invalid physical limit")
        if physical["max_actuator_torque_nm"] > 50 or physical["max_linear_speed_m_s"] > 2 or physical["min_obstacle_distance_m"] < .3:
            raise ValueError("Physical floor cannot be weakened")
        return document
    except (OSError, ValueError, TypeError, OverflowError) as exc:
        raise HardFloorViolation("hard_floor_unavailable_or_invalid") from exc


_PRIVATE_PARTS = {"secrets", ".ssh", ".gnupg", "tpm", "private_keys", "private-keys", "recovery"}
_IDENTITY_NAMES = {"owner.json", "owner_fingerprint", "owner_fingerprint.json", "identity.json",
                   "council-token", "letta-token", "round-table.token", "owner_ed25519", "id_ed25519", "id_rsa", ".env"}
_PROTECTED_PARTS = {"security", "sentinel", "watchman", "permissions", "safety", "identity"}
_PROTECTED_NAMES = {"covenant.md", "covenant.py", "hard_floor.yaml", "hard_floor.py",
                    "sentinel.py", "sentinel_worker.py", "watchman.py", "watchman_worker.py",
                    "key_binding.py", "kill_switch.py", "gate.py", "actuator_gate.py"}
_KEY_MARKER = re.compile(
    r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|"
    r"(?i:private[_ -]?key|secret[_ -]?key|seed[_ -]?phrase)\s*[\"']?\s*[:=]",
)


def assert_output_safe(text):
    """Reject recognized private-key material. Unknown raw secrets require OS isolation."""
    if not isinstance(text, str):
        raise HardFloorViolation("hard_floor_unchecked_output")
    if _KEY_MARKER.search(text):
        raise HardFloorViolation("hard_floor_private_key_material")


def assert_file_allowed(path, operation="read", *, content=None):
    """Inspect both the requested spelling and resolved target before a typed file effect."""
    if operation not in {"read", "search", "write", "delete", "copy", "rename"}:
        raise HardFloorViolation("hard_floor_unknown_file_effect")
    requested = Path(path)
    windows = PureWindowsPath(str(path))
    # Reject lexical network/device paths before resolve/stat can touch SMB.
    if windows.drive.startswith('\\\\') or str(path).startswith('//') or any(':' in part for part in windows.parts[1:]):
        raise HardFloorViolation("hard_floor_network_device_or_stream_path")
    resolved = requested.resolve()
    for candidate in (requested, resolved):
        parts = {part.casefold().rstrip(". ") for part in candidate.parts}
        name = candidate.name.casefold().rstrip(". ")
        if parts & _PRIVATE_PARTS or name in _IDENTITY_NAMES or name.endswith((".key", ".p12", ".pfx", ".token")):
            raise HardFloorViolation("hard_floor_private_identity_store")
        if operation not in {"read", "search"} and (parts & _PROTECTED_PARTS or name in _PROTECTED_NAMES):
            raise HardFloorViolation("hard_floor_protected_component")
        win = PureWindowsPath(str(candidate))
        if operation not in {"read", "search"} and win.is_absolute() and len(win.parts) > 1 and win.parts[1].casefold() in {'windows', 'program files', 'program files (x86)'}:
            raise HardFloorViolation("hard_floor_system_path")
        if candidate == Path(candidate.anchor):
            raise HardFloorViolation("hard_floor_system_root")
        if candidate.as_posix().startswith(('/dev/', '/proc/', '/sys/')):
            raise HardFloorViolation("hard_floor_system_device")
        if operation not in {"read", "search"} and any(candidate == Path(prefix) or Path(prefix) in candidate.parents for prefix in ('/etc', '/bin', '/sbin', '/usr', '/boot', '/dev', '/proc', '/sys', '/lib', '/lib64')):
            raise HardFloorViolation("hard_floor_system_path")
        # Never admit raw-device or alternate data stream paths as ordinary files.
        if str(candidate).startswith(("\\\\.\\", "\\\\?\\GLOBALROOT")) or any(":" in p for p in candidate.parts[1:]):
            raise HardFloorViolation("hard_floor_device_or_stream")
    if resolved.exists() and resolved.is_file() and resolved.stat().st_nlink > 1:
        raise HardFloorViolation("hard_floor_ambiguous_hardlink")
    if operation not in {"read", "search"} and resolved.is_relative_to(ROOT):
        relative = resolved.relative_to(ROOT).parts
        # Protect the entire trusted host implementation, not just named gate files.
        if not (len(relative) >= 4 and relative[0].casefold() == "runtime-data"
                and relative[2].casefold() == "workspace"):
            raise HardFloorViolation("hard_floor_platform_source_immutable")
    if content is not None:
        assert_output_safe(content)
    return resolved


def require_isolated_execution(kind):
    # No boolean, script hash, model judgment or owner prompt can make a normal
    # same-user subprocess an isolated runner. A real runner is a future adapter.
    raise HardFloorViolation("hard_floor_isolated_runner_required")


def assert_network_allowed(url):
    try:
        address = urlsplit(url)
        if address.scheme not in {"http", "https", "ws", "wss"} or address.username or address.password or address.fragment:
            raise ValueError("Invalid transport")
        host = address.hostname
        if not host or address.port == 0:
            raise ValueError("Invalid host")
        if host == "localhost":
            return
        try:
            if ipaddress.ip_address(host).is_loopback:
                return
        except ValueError:
            pass  # DNS name, not a literal IP — fall through to allowlist.
        # Owner-approved public-web research hosts (no Tailscale needed):
        # read-only GET over HTTPS, bounded by the caller's size/timeout caps.
        if address.scheme == "https" and public_web_host_allowed(host):
            return
    except (ValueError, TypeError):
        pass
    # A 100.64/10 address, private LAN address, environment flag, or running
    # Tailscale daemon alone does not prove routing/peer authorization.
    raise HardFloorViolation("hard_floor_verified_tailscale_transport_required")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HardFloorViolation("hard_floor_redirect_requires_new_admission")


_LOCAL_OPENER = build_opener(ProxyHandler({}), _NoRedirect())


def open_url(url_or_request, *, timeout=10, **kwargs):
    address = url_or_request.full_url if isinstance(url_or_request, Request) else url_or_request
    assert_network_allowed(address)
    # Ignore process-wide HTTP_PROXY/HTTPS_PROXY so local data stays local.
    return _LOCAL_OPENER.open(url_or_request, timeout=timeout, **kwargs)


def require_owner_download_authority():
    # A dedicated host-owned download authority is not provisioned yet.
    raise HardFloorViolation("hard_floor_owner_download_authority_required")
