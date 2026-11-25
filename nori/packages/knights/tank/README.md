# Tank — device steward

TankAgent.run accepts device, operation (device_read/device_write), and parameters.
The trusted host registers devices with protocol, driver and schema. Authentication and
the kill switch are checked for reads and writes. Every write additionally requires
safety_gate(session, exact_request, schema) to return True. A missing gate is an error.
The host must connect this to Sentinel and the Robotics Watchman/interlocks; an owner-key
match alone is not an actuator safety decision. This package provides no default allow gate.

Drivers: python-can, Bleak GATT, pymavlink COMMAND_LONG/telemetry, PySerial, and host-injected
digital GPIO. Schemas/limits are evaluated by the host gate, not inferred by the driver.
Oracle reference lookup is injectable and does not authorize writes. Raw observations are
returned without interpreting sensor data or choosing actions. Phi-4 is declared as the
model but is not invoked to generate device commands.

Transport success does not prove the physical action succeeded. MAVLink sends explicitly
report acknowledged=false. No automatic retries, auto-arming, device discovery, or physical
connection is performed on agent construction. The host opens and closes transports.
BLE uses async methods; other drivers are synchronous and may block up to their timeout.

Kill checks prevent subsequent I/O; they cannot retract a CAN frame or stop an actuator
already moving. An independent hardware stop/watchdog and process/device access isolation
are required for real machinery. Direct driver objects are trusted-host interfaces and
must not be exposed to agents as a way to bypass TankTools. Actual OS enforcement is pending.

Seven tests passed: virtual CAN, serial loopback, BLE/MAVLink doubles, explicit MAVLink
target validation, denied/killed write prevention and exact action/schema gate forwarding.
No physical hardware was commanded. Existing shared Tank HTTP inventory worker is unchanged.
Installed dependencies live in .venv-architect. Physical drivers/adapters and board GPIO
backend must be provisioned for the target OS separately.
