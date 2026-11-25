# Sentinel

NORI-owned package contract for the **Security** Knight.

Sentinel is now the owner gate. Its package implementation lives in
[`agents/sentinel.py`](agents/sentinel.py), backed by:

- [`security/key_binding.py`](security/key_binding.py): first-boot Ed25519 owner key binding through a TPM-shaped storage boundary.
- [`security/gate.py`](security/gate.py): every user or Knight request becomes `FULL_ADMIN` or `DENY`, with SQLite audit records.
- [`security/kill_switch.py`](security/kill_switch.py): lockdown state that denies later requests once triggered.

The current backend uses the local OpenSSH Ed25519 toolchain to create key
material because the OS image TPM API is not wired in this workspace yet. The
interface is shaped so the production TPM backend can replace the local file
backend without changing the gate contract.

The older event watchdog still exists at
[`shared/orchestration/sentinel_worker.py`](../../../shared/orchestration/sentinel_worker.py)
for typed event queue behavior. The security gate is the package-level Sentinel
implementation.
