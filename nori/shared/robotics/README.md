# NORI Robotics runtime

`watchman.py` is NORI's deterministic Robotics command gate. It has no direct
hardware drivers and does not replace physical emergency stops, controller
limits, device firmware checks, or a supported-device certification process.

The current order is: validate request → verify explicit policy/approval →
verify device arm state → record an audit decision → hand an admitted envelope
to a future adapter. A rejected request never calls an adapter.
