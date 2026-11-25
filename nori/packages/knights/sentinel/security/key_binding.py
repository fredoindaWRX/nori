"""NORI Sentinel key binding.

The production OS should back this interface with TPM or Secure Enclave APIs.
This implementation keeps the boundary explicit and uses the Windows/OpenSSH
Ed25519 toolchain available on the build machine for first-boot keys.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import json
import os
import subprocess
import tempfile
from typing import Protocol


KEY_COMMENT = "nori-sentinel-owner"
OWNER_MEMORY_FILE = "owner_fingerprint.json"


class KeyStore(Protocol):
    def private_key_path(self) -> Path:
        ...

    def public_key_path(self) -> Path:
        ...

    def exists(self) -> bool:
        ...

    def generate(self) -> None:
        ...

    def public_key(self) -> str:
        ...


@dataclass
class TpmKeyStore:
    """First-boot Ed25519 key storage boundary.

    The current backend stores key files under a caller-provided root with owner
    permissions where the platform supports them. The class name reflects the
    contract: callers must treat it as the TPM boundary and not read the private
    key directly.
    """

    root: Path
    key_name: str = "owner_ed25519"

    def __post_init__(self) -> None:
        self.root = Path(self.root)

    def private_key_path(self) -> Path:
        return self.root / self.key_name

    def public_key_path(self) -> Path:
        return self.root / f"{self.key_name}.pub"

    def exists(self) -> bool:
        return self.private_key_path().exists() and self.public_key_path().exists()

    def generate(self) -> None:
        if self.exists():
            return
        self.root.mkdir(parents=True, exist_ok=True)
        private_key = self.private_key_path()
        if private_key.exists() or self.public_key_path().exists():
            raise FileExistsError("sentinel_key_material_incomplete")
        command = [
            "ssh-keygen",
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            KEY_COMMENT,
            "-f",
            str(private_key),
        ]
        subprocess.run(command, check=True, capture_output=True, text=True, shell=False)
        _chmod_private(private_key)

    def public_key(self) -> str:
        if not self.exists():
            raise FileNotFoundError("sentinel_owner_key_missing")
        return self.public_key_path().read_text(encoding="utf-8").strip()


def _chmod_private(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def owner_fingerprint(public_key: str) -> str:
    if not isinstance(public_key, str) or not public_key.startswith("ssh-ed25519 "):
        raise ValueError("sentinel_public_key_invalid")
    return sha256(public_key.encode("utf-8")).hexdigest()


class ImmutableOwnerMemory:
    """Write-once owner fingerprint storage for the Merovingian/Letta covenant."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.path = self.root / OWNER_MEMORY_FILE

    def read(self) -> dict | None:
        if not self.path.exists():
            return None
        return json.loads(self.path.read_text(encoding="utf-8"))

    def bind(self, fingerprint: str, public_key: str) -> dict:
        current = self.read()
        if current is not None:
            if current.get("owner_fingerprint") != fingerprint:
                raise PermissionError("sentinel_owner_fingerprint_immutable")
            return current
        self.root.mkdir(parents=True, exist_ok=True)
        from prompts.covenant import identity_record
        value = {
            "schema": "nori.letta-owner-covenant.v1",
            "owner_fingerprint": fingerprint,
            "public_key": public_key,
            "immutable": True,
            "purpose": "serve_only_this_owner",
            "covenant": identity_record(fingerprint),
        }
        descriptor, temporary = tempfile.mkstemp(prefix=".owner-fingerprint.", dir=self.root)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(value, handle, separators=(",", ":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except Exception:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise
        return value


@dataclass(frozen=True)
class KeyBinding:
    public_key: str
    owner_fingerprint: str
    memory: dict


def first_boot_bind(key_store: KeyStore, memory: ImmutableOwnerMemory) -> KeyBinding:
    key_store.generate()
    public_key = key_store.public_key()
    fingerprint = owner_fingerprint(public_key)
    covenant = memory.bind(fingerprint, public_key)
    return KeyBinding(public_key=public_key, owner_fingerprint=fingerprint, memory=covenant)
