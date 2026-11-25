"""NORI-owned hardware abstraction and capability profiling."""
from dataclasses import dataclass, asdict
import os, platform, shutil
import ctypes
from pathlib import Path

def memory_status() -> dict:
    """Physical RAM bytes; None means unavailable, never zero by assumption."""
    if platform.system() == 'Windows':
        class MemoryStatus(ctypes.Structure):
            _fields_ = [('length', ctypes.c_uint32), ('load', ctypes.c_uint32)] + [
                (name, ctypes.c_uint64) for name in ('total', 'available', 'page_total',
                'page_available', 'virtual_total', 'virtual_available', 'extended')]
        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return {'total_bytes': status.total, 'available_bytes': status.available}
        return {'total_bytes': None, 'available_bytes': None}
    try:
        fields = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            parts = value.split()
            if key in ('MemTotal', 'MemAvailable') and len(parts) == 2 and parts[1] == 'kB':
                fields[key] = int(parts[0]) * 1024
        if 'MemTotal' in fields:
            return {'total_bytes': fields['MemTotal'], 'available_bytes': fields.get('MemAvailable')}
    except (OSError, ValueError):
        pass
    try:
        total = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    except (AttributeError, ValueError, OSError):
        total = None
    return {'total_bytes': total, 'available_bytes': None}
@dataclass(frozen=True)
class HardwareProfile:
    system: str
    machine: str
    cpu_count: int
    memory_bytes: int
    disk_free_bytes: int
    gpu_hint: str

def profile() -> HardwareProfile:
    mem=memory_status()['total_bytes'] or 0
    root=Path.cwd().anchor or os.path.abspath(os.sep)
    return HardwareProfile(platform.system(),platform.machine(),os.cpu_count() or 1,mem,shutil.disk_usage(root).free,os.environ.get("NORI_GPU_HINT","unknown"))

def tier(p: HardwareProfile) -> str:
    if p.cpu_count>=8 and p.memory_bytes>=16*1024**3: return "enhanced"
    if p.cpu_count>=4 and p.memory_bytes>=8*1024**3: return "standard"
    return "compact"

def snapshot() -> dict:
    p=profile(); return {"profile":asdict(p),"tier":tier(p),"memory":memory_status()}
