"""Owner-gated first-boot provisioning for NORI's Round Table service."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import secrets
import shlex
import stat
import tempfile
from typing import Iterable
from urllib.parse import urlsplit

from identity.first_boot_security import completion
from orchestration.knight_registry import KnightRegistry


_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_PORT = re.compile(r"[1-9][0-9]{0,4}")
_EDITION = frozenset({"home", "server", "robotics"})
_EXTRA_GRANTS = frozenset({"plan", "infer"})
_TOKEN = re.compile(r"[A-Za-z0-9_-]{32,256}")


def load_service_token(path: Path) -> str:
    """Read a host-provisioned private credential without exposing it to logs."""
    path = Path(path)
    if path.is_symlink():
        raise PermissionError("round_table_token_must_be_regular_private_file")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 257:
            raise PermissionError("round_table_token_must_be_regular_private_file")
        if os.name != "nt" and stat.S_IMODE(info.st_mode) != 0o600:
            raise PermissionError("round_table_token_permissions_must_be_0600")
        raw = handle.read(258)
    try:
        token = raw.decode("ascii").removesuffix("\n")
    except UnicodeDecodeError:
        raise PermissionError("round_table_token_invalid") from None
    if not _TOKEN.fullmatch(token):
        raise PermissionError("round_table_token_invalid")
    return token


def _model_endpoint(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise ValueError("round_table_model_endpoint_must_be_loopback")
    return value.rstrip("/")


def _port(value: int | str) -> int:
    text = str(value)
    if not _PORT.fullmatch(text) or not 1 <= int(text) <= 65535:
        raise ValueError("round_table_port_invalid")
    return int(text)


def allowed_grants(roster_path: Path | None = None) -> frozenset[str]:
    roster = KnightRegistry(roster_path or Path(__file__).parents[1] / "orchestration" / "knights.json")
    return _EXTRA_GRANTS | frozenset(
        permission for knight in roster.knights.values() for permission in knight.permissions
    )


def provision(*, target: Path, edition: str, model_endpoint: str, model: str,
              port: int | str, grants: Iterable[str], required_completed: Iterable[str],
              recovery_completed: Iterable[str], device_capabilities: Iterable[str] = (),
              roster_path: Path | None = None) -> Path:
    """Provision a private token and publish service config after the owner gate."""
    if edition not in _EDITION:
        raise ValueError("round_table_edition_invalid")
    readiness = completion(set(required_completed), set(device_capabilities), set(recovery_completed))
    if not readiness["owner_session_allowed"]:
        raise PermissionError("round_table_owner_enrollment_incomplete")
    if not isinstance(model, str) or not _MODEL.fullmatch(model):
        raise ValueError("round_table_model_invalid")
    endpoint = _model_endpoint(model_endpoint)
    selected_port = _port(port)
    selected_grants = tuple(dict.fromkeys(grants))
    if not selected_grants or any(not isinstance(grant, str) or grant not in allowed_grants(roster_path)
                                  for grant in selected_grants):
        raise ValueError("round_table_grants_invalid")
    target = Path(target)
    if target.exists() or target.is_symlink():
        raise FileExistsError("round_table_already_provisioned")
    token_path = target.with_suffix(".token")
    if token_path == target:
        raise ValueError("round_table_config_target_cannot_be_token")
    if token_path.exists() or token_path.is_symlink():
        raise FileExistsError("round_table_token_already_provisioned")
    target.parent.mkdir(parents=True, exist_ok=True)
    value = "\n".join((
        f"NORI_EDITION={edition}",
        f"NORI_MODEL_ENDPOINT={endpoint}",
        f"NORI_MODEL={model}",
        f"NORI_ROUND_TABLE_PORT={selected_port}",
        f"NORI_ROUND_TABLE_GRANTS={shlex.quote(' '.join(selected_grants))}",
        f"NORI_API_TOKEN_FILE={shlex.quote(str(token_path.resolve()))}",
        "",
    ))
    temporary = None
    token_created = False
    try:
        # A distinct file allows the launcher to export only a path. The token
        # is generated only in this explicit provisioning path, never staging.
        token_descriptor = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        token_created = True
        with os.fdopen(token_descriptor, "w", encoding="ascii", newline="\n") as handle:
            handle.write(secrets.token_urlsafe(48) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(token_path, 0o600)
        descriptor, temporary = tempfile.mkstemp(prefix=".round-table.", dir=target.parent)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
    except Exception:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
        if token_created:
            token_path.unlink(missing_ok=True)
        raise
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=Path("/etc/nori/round-table.env"))
    parser.add_argument("--edition", required=True, choices=sorted(_EDITION))
    parser.add_argument("--model-endpoint", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--port", default="9401")
    parser.add_argument("--grant", action="append", required=True)
    parser.add_argument("--required-completed", action="append", default=[])
    parser.add_argument("--recovery-completed", action="append", default=[])
    parser.add_argument("--device-capability", action="append", default=[])
    args = parser.parse_args(argv)
    target = provision(
        target=args.target, edition=args.edition, model_endpoint=args.model_endpoint,
        model=args.model, port=args.port, grants=args.grant,
        required_completed=args.required_completed,
        recovery_completed=args.recovery_completed,
        device_capabilities=args.device_capability,
    )
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
