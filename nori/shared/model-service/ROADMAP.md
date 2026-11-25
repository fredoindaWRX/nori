# NORI model system — agreed requirements

NORI owns its model system architecture, API, management interface, scheduling
and cross-edition integration. Existing engine adapters are transitional
foundations, not the completed product. Licensed low-level libraries are allowed.
Claims of improved performance require measurements.

Owner-selected names: Seth for the NORI runtime, Genesis for the model family,
and Nexus for connected NORI devices. Seth supersedes Matrix and the rejected Forge proposal.
Reactor, Pulse, Axon and Catalyst were unselected proposals. These names do not
rename third-party model weights or imply name/trademark availability checks.

## Scope retained from the owner's discussion

- All twelve Knights coordinate through Architect. Roles can share resident
  models and use specialized models where appropriate; twelve roles do not imply
  twelve resident 32B models.
- Model catalog, provenance, loading/unloading, health and crash recovery,
  hardware-aware resource allocation, workload scheduling and visible status.
- Home and Server pairing tied to the correct owner/household, task handoff and
  authorized shared context; seamless conversation across paired devices.
- Home, Server and Robotics deployment profiles for the full roadmap, including
  text, voice, vision, retrieval/memory and device integrations. Text generation
  alone does not establish any of the other capabilities.
- Robotics local operation during network loss, local controllers for timely
  actuator behavior, deterministic stop/recovery, tested edge/server coordination.
- Customer-owned compatible PCs plus a preconfigured NORI server appliance for
  purchase or rental. Same core system and pairing experience. Hardware specs,
  pricing and support commitments remain to be established.
- Use NORI's local skills/models to assist development where their output can be
  verified. This avoids paid inference calls for those jobs; any explicitly
  selected external development service retains its own usage accounting. Local
  review output is evidence to assess, not authority.
- Autonomy: plan, delegate, decide routine steps, recover and report without
  repeatedly asking the owner to direct every operation. Maintain owner identity,
  ownership transfer/revocation and the ability to stop the system.
- Persistent relevant memory and evaluated improvements over time. An identity
  statement is not proof of consciousness, free will or reliable behavior.

## Current implementation and next gates

Local HTTP generation, engine reuse and graceful cleanup have passed a combined
BIOS/GRUB Linux VM test with a small injected model. The model gave one wrong
answer; integration is not a reasoning-quality pass. Explicit load/unload/status
passed real Windows HTTP and rebuilt Linux BIOS guest lifecycle tests (including
process exit, reuse and reload). Evidence is in `../../Logs/live-model-lifecycle.json`
and `../../Logs/server-bios-lifecycle.json` with its serial log. The Linux check
uses a disposable disk copy and injected test model; it does not test installation.
API currently binds to loopback and is not ready for
cross-device exposure.

The catalog/download flow, scheduler, resource accounting, authenticated pairing,
conversation handoff, full Knight implementations, robotics integrations and
management UI remain unfinished. No appliance or complete OS release is implied.

Qualification must publish model/quantization/context size, concurrent jobs,
latency, task quality, memory, sustained thermals/power, recovery and disconnected
robotics behavior. Hardware claims must distinguish server from edge-node roles.

See `../../OS/SERVER-APPLIANCE-PRODUCT.md` for appliance requirements.
