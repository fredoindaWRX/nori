# NORI platform architecture

NORI is organized as one platform with three install targets and shared native services.

- **Home OS**: desktop and home-device target for compatible PCs.
- **Server OS**: always-on services, storage, and multi-node target for compatible PCs.
- **Robotics OS**: board and controller deployment bundles with hardware safety boundaries.

Shared layers:

- `shared/model-service`: NORI-owned local model API and adapter boundary.
- `shared/orchestration`: worker registration, task planning, and audit events.
- `shared/permissions`: allow-list policy and approval gates.
- `shared/runtime`: native service startup and readiness checks.
- `shared/avatar`: portable NORI face-particle renderer reference.
- `OS/vehicle`: N.O.R.I. Drive companion, diagnostics, infotainment, and approved vehicle-adapter roadmap.
- `Logs/change-log.md`: dated change record.
- `platform-manifest.json`: machine-readable integration contract.

Release verification runs from `OS/build/verify-all.ps1`.
