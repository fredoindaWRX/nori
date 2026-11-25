# Hardware profiling

The shared probe reports CPU count, physical memory, free space on the current
working directory's filesystem and an unverified GPU hint. Windows memory uses
GlobalMemoryStatusEx. Linux uses MemTotal and MemAvailable from /proc/meminfo.
Unknown available memory is null; the legacy profile total remains zero if unknown.

Memory readings describe the current OS host/guest, not a guaranteed allocation.
Container limits, GPU VRAM, model KV cache, scratch buffers and concurrent
workloads are not accounted for yet. The compact/standard/enhanced tier is a
coarse description and must not be treated as proof that a model fits.

Regression checks: `python NORI/shared/tests/test_hardware_memory.py`.
The native probe has passed on Windows and in the NoriBuild Linux environment.
The updated probe still needs staging and verification inside a rebuilt OS image.
