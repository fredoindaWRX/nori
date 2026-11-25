"""Vendor-neutral device-driver catalog and validated device manifests.

Manifests describe hardware.  They never name an import path or execute code.
Only a provider factory registered by the trusted NORI host can be activated.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import importlib.util
import json
import platform
import re
from typing import Any, Callable


PROTOCOLS = frozenset({
    "audio", "ble", "can_bus", "gpio", "gps", "i2c", "mavlink",
    "network", "obd2", "serial", "spi", "usb_hid", "usb_raw",
    "video", "vendor_sdk",
})
CAPABILITIES = frozenset({"read", "write", "stream", "discover"})
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
_SECRET_KEYS = re.compile(r"(?:password|passwd|secret|token|private[_-]?key|api[_-]?key)", re.I)


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    protocols: tuple[str, ...]
    capabilities: tuple[str, ...]
    dependency: str | None
    mode: str = "python_module"
    description: str = ""

    def state(self) -> str:
        if self.mode == "host_adapter":
            return "host_adapter_required"
        if self.mode == "builtin":
            return "ready"
        return "ready" if self.dependency and importlib.util.find_spec(self.dependency) else "dependency_missing"


DEFAULT_PROVIDERS = (
    ProviderSpec("pyserial", ("serial", "gps", "obd2"), ("read", "write", "stream", "discover"), "serial", description="USB and native serial ports"),
    ProviderSpec("python-can", ("can_bus", "obd2"), ("read", "write", "stream", "discover"), "can", description="CAN, CAN FD and virtual CAN"),
    ProviderSpec("bleak", ("ble",), ("read", "write", "stream", "discover"), "bleak", description="Bluetooth Low Energy GATT"),
    ProviderSpec("pymavlink", ("mavlink",), ("read", "write", "stream"), "pymavlink", description="MAVLink vehicles and drones"),
    ProviderSpec("sounddevice", ("audio",), ("read", "stream", "discover"), "sounddevice", description="Microphones, mixers and system audio"),
    ProviderSpec("opencv", ("video",), ("read", "stream", "discover"), "cv2", description="USB, integrated and network cameras"),
    ProviderSpec("pyusb", ("usb_raw",), ("read", "write", "discover"), "usb", description="Raw USB endpoints"),
    ProviderSpec("hidapi", ("usb_hid",), ("read", "write", "discover"), "hid", description="USB HID devices"),
    ProviderSpec("python-obd", ("obd2",), ("read", "stream", "discover"), "obd", description="ELM327-compatible OBD-II adapters"),
    ProviderSpec("smbus2", ("i2c",), ("read", "write", "discover"), "smbus2", description="Linux I2C and SMBus"),
    ProviderSpec("spidev", ("spi",), ("read", "write"), "spidev", description="Linux SPI devices"),
    ProviderSpec("socket", ("network",), ("read", "write", "stream", "discover"), None, mode="builtin", description="Bounded local and paired network protocols"),
    ProviderSpec("gpio-host", ("gpio",), ("read", "write", "stream"), None, mode="host_adapter", description="Board-specific GPIO adapter"),
    ProviderSpec("vendor-sdk-bridge", ("vendor_sdk",), ("read", "write", "stream", "discover"), None, mode="host_adapter", description="Reviewed vendor SDK bridge"),
)


def _reject_secrets(value: Any, path: str = "config") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or _SECRET_KEYS.search(key):
                raise ValueError(f"secrets are not allowed in driver manifest {path}")
            _reject_secrets(child, path + "." + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_secrets(child, f"{path}[{index}]")


class DriverCatalog:
    def __init__(self, providers=DEFAULT_PROVIDERS):
        providers = tuple(providers)
        self.providers = {provider.id: provider for provider in providers}
        if not self.providers or len(self.providers) != len(providers):
            raise ValueError("driver provider IDs must be unique")
        self.manifests: dict[str, dict[str, Any]] = {}
        self.factories: dict[str, Callable[[dict[str, Any]], Any]] = {}

    def register_factory(self, provider: str, factory: Callable[[dict[str, Any]], Any]) -> None:
        if provider not in self.providers or not callable(factory):
            raise ValueError("driver provider factory is invalid")
        self.factories[provider] = factory

    def add_manifest(self, manifest: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(manifest, dict):
            raise ValueError("driver manifest must be an object")
        fields = {"schema", "id", "provider", "protocol", "version", "capabilities",
                  "platforms", "match", "config", "enabled"}
        if set(manifest) != fields:
            raise ValueError("driver manifest fields are invalid")
        if manifest["schema"] != 1:
            raise ValueError("driver manifest schema is unsupported")
        device_id = manifest["id"]
        provider_id = manifest["provider"]
        protocol = manifest["protocol"]
        capabilities = manifest["capabilities"]
        platforms = manifest["platforms"]
        if not isinstance(device_id, str) or not _ID.fullmatch(device_id) or device_id in self.manifests:
            raise ValueError("driver manifest ID is invalid or duplicated")
        if provider_id not in self.providers or protocol not in self.providers[provider_id].protocols:
            raise ValueError("driver provider does not support this protocol")
        if (not isinstance(manifest["version"], str) or not manifest["version"] or
                len(manifest["version"]) > 32):
            raise ValueError("driver version is invalid")
        if (not isinstance(capabilities, list) or not capabilities or
                any(item not in CAPABILITIES for item in capabilities) or
                not set(capabilities) <= set(self.providers[provider_id].capabilities)):
            raise ValueError("driver capabilities are invalid")
        if (not isinstance(platforms, list) or not platforms or
                any(item not in {"Windows", "Linux", "Darwin", "Android"} for item in platforms)):
            raise ValueError("driver platforms are invalid")
        if not isinstance(manifest["match"], dict) or len(manifest["match"]) > 16:
            raise ValueError("device matching rules are invalid")
        if not isinstance(manifest["config"], dict) or len(manifest["config"]) > 32:
            raise ValueError("driver configuration is invalid")
        if type(manifest["enabled"]) is not bool:
            raise ValueError("driver enabled state is invalid")
        _reject_secrets(manifest["config"])
        encoded = json.dumps(manifest, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 16384:
            raise ValueError("driver manifest is too large")
        stored = json.loads(encoded)
        self.manifests[device_id] = stored
        return deepcopy(stored)

    def open(self, device_id: str) -> Any:
        manifest = self.manifests.get(device_id)
        if manifest is None:
            raise LookupError("device manifest is not registered")
        if not manifest["enabled"]:
            raise PermissionError("device manifest is disabled")
        if platform.system() not in manifest["platforms"]:
            raise RuntimeError("driver does not support this platform")
        provider = manifest["provider"]
        if self.providers[provider].state() != "ready":
            raise RuntimeError("driver provider is unavailable")
        factory = self.factories.get(provider)
        if factory is None:
            raise RuntimeError("trusted driver factory is not registered")
        driver = factory(deepcopy(manifest["config"]))
        for capability in manifest["capabilities"]:
            method = "read" if capability in {"read", "stream"} else "write" if capability == "write" else None
            if method and not callable(getattr(driver, method, None)):
                raise TypeError(f"driver does not implement {method}")
        return driver

    def status(self) -> dict[str, Any]:
        return {
            "protocols": sorted(PROTOCOLS),
            "providers": [{
                "id": provider.id,
                "protocols": list(provider.protocols),
                "capabilities": list(provider.capabilities),
                "state": provider.state(),
                "description": provider.description,
            } for provider in self.providers.values()],
            "devices": [{
                "id": manifest["id"], "provider": manifest["provider"],
                "protocol": manifest["protocol"], "enabled": manifest["enabled"],
                "platform_supported": platform.system() in manifest["platforms"],
                "provider_state": self.providers[manifest["provider"]].state(),
                "factory_registered": manifest["provider"] in self.factories,
            } for manifest in self.manifests.values()],
        }
