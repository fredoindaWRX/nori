# Nori System Architecture Documentation

## Overview

Nori is a local-first autonomous AI assistant built on a multi-agent architecture with specialized workers (Knights), a central message bus, and integrated memory systems. The system is designed for persistent operation with owner-verified voice interaction, sensory data collection, and autonomous task execution.

## Core Components

### Council (main.py)

The Council is the central coordination system that manages the twelve Knight workers on a shared message bus.

**Key Components:**
- `CouncilHTTPServer`: ThreadingHTTPServer with Windows port exclusivity
- `run_round_table`: Lifecycle management for 12 Knights
- `MessageBus`: Central message passing system
- `BusWatchdog`: Bus monitoring and audit
- Sentinel integration: Security and authorization
- Hard floor network policy: Security boundaries

**Startup Sequence:**
1. Initialize CouncilHTTPServer with port exclusivity
2. Create MessageBus with BusWatchdog
3. Initialize Sentinel for security
4. Load hard floor network policy
5. Start Knight lifecycle adapters in defined order
6. Start watchdog monitoring
7. Serve HTTP endpoints for Workspace integration

### Message Bus (bus.py)

The MessageBus is the central communication system that coordinates message passing between Knights.

**Architecture:**
- Agent-based message routing
- Async message delivery
- Audit logging through BusWatchdog
- Sentinel authorization enforcement
- Message ordering guarantees

**Message Flow:**
```
Knight A → MessageBus → Sentinel Check → Knight B
                      ↓
                  BusWatchdog (audit)
```

### BusWatchdog (bus_watchdog.py)

The BusWatchdog monitors the message bus for health and audit purposes.

**Functions:**
- Monitors message delivery latency
- Audits one bus_stall_warning per quiet period
- Never sends work, changes policy, or restarts Knights
- Isolated from message delivery path

### Sentinel (sentinel/)

Sentinel provides security and authorization for all system operations.

**Security Functions:**
- Bearer token validation
- Operation authorization
- Policy enforcement
- Audit logging
- Threat detection

**Authorization Flow:**
```
Request → Token Validation → Policy Check → Operation → Audit Log
```

### Hard Floor Network Policy (security/hard_floor.py)

The hard floor policy enforces network security boundaries.

**Functions:**
- Network whitelist enforcement
- Proxy-disabled connections
- No external redirects
- Local-only transport verification
- Device control gating

**Network Boundaries:**
- Loopback interface only by default
- Private pairing with explicit verification
- No direct internet access
- Proxy settings disabled

## Knight Workers

The twelve Knights are specialized workers with specific models, tools, and permissions.

### Knight Architecture

Each Knight:
- Runs as a typed internal role within the single-process Council runtime
- Has a specific model and capability set
- Has permission grants for operations
- Is dispatched through the shared message bus and bounded worker contracts
- Connects to the MessageBus
- Implements start/stop lifecycle

### Knight Lifecycle

**Startup:**
1. Initialize Knight-specific model
2. Load tools and grants
3. Connect to MessageBus
4. Register with Sentinel
5. Start listener task
6. Report ready status

**Operation:**
1. Receive message from bus
2. Validate authorization with Sentinel
3. Execute operation with tools
4. Send response to bus
5. Audit operation

**Shutdown:**
1. Stop listener task
2. Disconnect from bus
3. Cleanup resources
4. Report stopped status

### Knight Roles

| Knight | Port | Model | Role | Primary Tools |
|--------|------|-------|------|---------------|
| neo | 9101 | qwen2.5-coder:14b | Code Smith | coding |
| trinity | 9102 | gemma4:12b | All-Rounder | plugins |
| morpheus | 9103 | qwen2.5-coder:14b | IDE Warrior | ide |
| smith | 9104 | qwen2.5-coder:14b | Agent Smith | plugins |
| cypher | 9105 | qwen2.5-coder:14b | The Cypher | coding |
| tank | 9106 | qwen3:8b | Tank | hardware_read |
| agent | 9107 | qwen2.5-coder:14b | Architect | architect |
| oracle | 9108 | qwen2.5-coder:14b | Oracle | knowledge |
| architect | 9109 | qwen2.5-coder:14b | Architect | architect |
| sentinel | 9110 | qwen2.5-coder:14b | Sentinel | security |
| merovingian | 9111 | qwen2.5-coder:14b | Merovingian | memory |
| watchman | 9112 | qwen2.5-coder:14b | Watchman | monitor |

## Workspace Integration

### Workspace Server (workspace/server.py)

The Workspace provides a web UI and HTTP bridge to the Council.

**Functions:**
- Serves static Workspace UI
- HTTP proxy to Council endpoints
- Voice capture and speech output
- Wake authority management
- Output artifact management
- Development status reporting

**HTTP Endpoints:**
- `GET /`: Workspace UI
- `POST /api/work/*`: Council task submission
- `GET /api/voice/status`: Voice system status
- `POST /api/voice/speak`: Speech synthesis
- `GET /api/development-status`: Development team status

### Wake Authority (workspace/wake.py)

The Wake Authority manages wake phrase detection and command execution.

**Components:**
- WakeListener integration
- Owner voice verification
- Command submission to Council
- Response speech synthesis
- State management

**Wake Flow:**
```
Microphone → WakeListener → Owner Verification → Council → Response → Speech
```

## Memory Systems

### Primary Memory (shared/memory/primary_memory.py)

Primary memory management with Letta integration.

**Architecture:**
- Letta App Server with MemFS as primary
- Local JSONL as cold backup
- Failover with explicit reporting
- Journal-based reconciliation
- Crash-safe operations

**Memory Operations:**
- `remember`: Store information
- `recall`: Retrieve information
- `reconcile`: Sync with cold backup
- `failover`: Recover from primary failure

### Memory Consolidation (shared/memory/)

Memory consolidation and knowledge graph management.

**Functions:**
- Knowledge graph construction
- Information consolidation
- Relationship extraction
- Memory deduplication
- Relevance scoring

## Sensory Systems

### Sensory Layer (shared/hardware/sensory.py)

Central sensory data collection and management.

**Sensor Types:**
- Audio: Microphone capture
- Vision: Camera/video capture
- Position: GPS/location
- Motion: IMU/accelerometer
- Range: IR/ultrasonic
- Ambient: Temperature, light, humidity
- Network: BLE/device scanning
- Vehicle: CAN/OBD data

**Sensor Architecture:**
```
Sensor → Adapter → Normalization → Sensory Layer → Tank → Council
```

### Sensor Adapters (shared/hardware/sensor_adapters.py)

Specific sensor implementations.

**Current Adapters:**
- Vision sensor (OpenCV)
- Vehicle sensor (serial/OBD)
- Environment sensor (serial)
- Audio sensor (sounddevice)

## Network Devices

### Network Device Registry (shared/hardware/network_devices.py)

Network device enrollment and management.

**Functions:**
- Owner enrollment
- Credential-free manifests
- Trusted adapter factories
- Transport verification
- Enabled-state gating
- Read/control path separation

**Device Types:**
- Vacuum robots (Home Assistant bridge)
- Smart home devices
- IoT sensors
- Network appliances

## Compute Infrastructure

### Compute Nodes (config.yaml)

Model execution infrastructure.

**Node Configuration:**
- Ollama service endpoints
- GPU/CPU acceleration
- Memory allocation
- Capability routing
- Priority scheduling
- Health monitoring

**Capability Routing:**
- General chat → 6GB+ memory
- Coding → 10GB+ memory
- Knowledge → 8GB+ memory
- Large reasoning → 60GB+ memory

### Model Backends

**Ollama:** Local model inference
- Supported: qwen2.5-coder, gemma4, qwen3
- Transport: HTTP on port 11434
- Acceleration: CUDA, ROCm, CPU

**LocalAI:** Alternative model backend
- Transport: HTTP on port 8080
- Fallback capability

## Security Architecture

### Sentinel Security

**Authorization:**
- Bearer token validation
- Operation-level permissions
- Grant-based access control
- Audit logging

**Security Layers:**
1. Token validation
2. Permission checks
3. Policy enforcement
4. Audit logging
5. Threat detection

### Network Security

**Hard Floor Policy:**
- Network whitelist enforcement
- Loopback-only default
- Private pairing with verification
- No external redirects
- Proxy settings disabled

**Device Control:**
- Hardware read grants
- Device control grants
- Explicit approval required
- Audit trail

## Voice System

### Wake Listener (shared/voice/wake_listener.py)

Windows Speech Recognition-based wake detection.

**Components:**
- WakeListener class with lifecycle
- PowerShell speech recognizer
- Owner voice verification
- Event callback interface
- Status reporting

**Wake Flow:**
```
Microphone → Windows Speech → PowerShell → JSON → WakeListener → Event → Workspace
```

### Speech Output (workspace/voice.py)

Neural speech synthesis using Kokoro.

**Components:**
- Kokoro ONNX engine
- Voice selection (af_heart)
- WAV audio generation
- Windows playback via winsound

## Development Supervision

### Development Supervisor (development_supervisor.py)

Development team coordination and task tracking.

**Functions:**
- Task state management
- Assignment tracking
- Heartbeat monitoring
- Evidence gating
- Stale detection
- Append-only event records

**Task States:**
- claimed, implementing, review_requested
- changes_requested, waiting_for_auth
- waiting_for_owner, blocked, verified
- deployed, cancelled

## Service Management

### Service Manager (service_manager.py)

Background service supervision and lifecycle management.

**Functions:**
- Service discovery
- Health monitoring
- Startup/shutdown coordination
- Failure recovery
- Status reporting

**Background Services:**
- Core supervisor
- Event bridge
- Remote bridge
- Home hub
- Presence service
- Collaboration observer
- Away project worker
- Node agent

## Desktop Integration

### Nori Launcher (nori_launcher.py)

Desktop executable for N.O.R.I. assistant.

**Commands:**
- `status`: Check service status
- `start`: Start services
- `open`: Open Workspace in browser

**Features:**
- No embedded credentials
- Service manager delegation
- Truthful status reporting
- Standalone executable

## Data Flow

### Task Execution Flow

```
User Request → Workspace → Council → Architect → Knights → Tools → Result → Workspace
                         ↓                      ↓
                    Sentinel             Memory Systems
```

### Wake Command Flow

```
"Hey Nori" → WakeListener → Owner Verification → Workspace → Council → Response → Speech
```

### Sensory Data Flow

```
Sensors → Adapters → Sensory Layer → Tank → Council → Memory/Action
```

## Configuration

### Main Configuration (config.yaml)

**Sections:**
- Sensors: Device polling configuration
- Owner: Owner information
- Compute: Model routing and nodes
- Knights: Worker roles and permissions
- Memory: Primary and backup backends
- Services: External service URLs

**See Also:** `CONFIGURATION.md` for detailed configuration documentation.

## Startup Sequence

### System Startup

1. Load configuration (config.yaml)
2. Initialize CouncilHTTPServer
3. Create MessageBus with BusWatchdog
4. Initialize Sentinel security
5. Load hard floor network policy
6. Start Knight lifecycle adapters
7. Start background services
8. Initialize memory systems
9. Start sensory polling
10. Report ready status

### Service Dependencies

**Startup Order:**
1. Core supervisor
2. Event bridge
3. MessageBus and BusWatchdog
4. Sentinel
5. Knight workers (in order)
6. Memory systems
7. Sensory layer
8. Workspace server
9. Wake authority

## Logging and Monitoring

### Log Locations

- Council logs: `nori/runtime-data/logs/council/`
- Knight logs: `nori/runtime-data/logs/knights/`
- Bus watchdog: `nori/runtime-data/bus-watchdog.jsonl`
- Wake listener: `nori/runtime-data/wake_listener_status.json`
- Development supervisor: `nori/runtime-data/development-supervisor/`

### Monitoring

**Health Checks:**
- Service availability
- Model readiness
- Memory system health
- Network connectivity
- Sensory device status

**Status Endpoints:**
- Council: `http://127.0.0.1:9107/api/status`
- Workspace: `http://127.0.0.1:9444/api/status`
- Voice: `http://127.0.0.1:9444/api/voice/status`

## Performance Considerations

### Resource Management

**Memory:**
- Model memory allocation per node
- Knight process memory limits
- Memory system caching
- Sensory data buffering

**CPU:**
- Model inference threading
- Knight parallelism
- Message bus concurrency
- Sensory polling intervals

**Network:**
- Local-only transport preferred
- Message batching optimization
- Cache hit reduction
- Latency monitoring

### Scalability

**Current Limits:**
- 12 Knight workers
- Single Council instance
- Local model inference only
- Single Workspace instance

**Scaling Considerations:**
- Additional compute nodes
- Distributed memory systems
- Multi-instance Workspace
- Regional sensor networks

## Security Considerations

### Credential Management

- No credentials embedded in source
- Environment variables for secrets
- Service manager for sensitive operations
- Sentinel for authorization
- Audit logging for all operations

### Data Privacy

- Local-first design
- No cloud data transmission
- Owner-controlled memory
- Audit trail for data access
- Encrypted storage where applicable

### Attack Surface

- Minimal external network exposure
- Sentinel authorization on all operations
- Hard floor network policy
- Device control gating
- Audit logging for security events

## Troubleshooting

### Common Issues

**Council won't start:**
- Check port conflicts (9107)
- Verify configuration file
- Check service dependencies
- Review Council logs

**Knight not responding:**
- Check Council health and the shared bus watchdog audit
- Verify model is installed
- Check the affected adapter's lifecycle/status logs
- Verify the Council runtime is not in recovery

**Memory not persisting:**
- Check Letta service status
- Verify primary backend configuration
- Check cold backup accessibility
- Review memory operation logs

**Wake not detecting:**
- Check microphone device
- Verify wake listener status
- Check owner voice profile
- Review wake listener logs

## See Also

- `CONFIGURATION.md`: Configuration details
- `nori/shared/voice/README.md`: Voice system documentation
- `nori_launcher.md`: Launcher documentation
- `TEAM_COORDINATION.md`: Development team coordination
- `NORI_MASTER_ROADMAP.md`: Project roadmap
