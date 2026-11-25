# Home Assistant Integration Documentation

## Overview

The Home Assistant integration provides a secure, typed boundary for smart home operations through the Nori system. It allows the Tank worker to perform read-only status checks and controlled light operations with explicit owner enrollment and verification.

**Key Features:**
- Owner-enrolled configuration (no hardcoded credentials)
- Token security (never included in results)
- Read and control permission separation
- Light control with readback verification
- Strict entity ID validation
- Safe error handling

## Architecture

### Components

- **HomeAssistant class**: Typed boundary for Home Assistant API
- **Configuration file**: Owner-enrolled credentials and settings
- **Tank integration**: Operations routed through Tank worker
- **Permission grants**: home_read and home_control
- **Verification**: Readback confirmation for state changes

### Data Flow

```
Tank → HomeAssistant → Home Assistant API → Verification → Result
                            ↓
                     Owner Config (credentials)
```

## Installation

### Prerequisites

- Home Assistant instance running on local network
- Home Assistant API access enabled
- Long-lived access token generated
- Owner enrollment configuration

### Configuration

Enroll the integration with the owner-controlled enrollment utility. This
validates the URL and token, requires the explicit trust flag, writes the file
atomically, and does not print the token:

```powershell
$env:NORI_HOME_ASSISTANT_URL = "http://homeassistant.local:8123"
$env:NORI_HOME_ASSISTANT_TOKEN = "<long-lived-access-token>"
python C:\Nori\home_assistant_enrollment.py --trust-owner
Remove-Item Env:NORI_HOME_ASSISTANT_TOKEN
```

The resulting configuration at `C:\Nori\integrations\home_assistant.json` has
this shape; do not paste a real token into documentation or source control:

```json
{
  "base_url": "http://homeassistant.local:8123",
  "token": "your_long_lived_access_token",
  "trusted": true,
  "integration_id": "home_base"
}
```

### Configuration Fields

- `base_url`: Home Assistant instance URL
- `token`: Long-lived access token
- `trusted`: Boolean flag for trusted status
- `integration_id`: Integration identifier

### Environment Variable

Override default config path with environment variable:
```bash
set NORI_HOME_ASSISTANT_CONFIG=C:\custom\path\home_assistant.json
```

## Usage

### Basic Usage

```python
from nori.shared.hardware.home_assistant import HomeAssistant

ha = HomeAssistant()

# Check status
status = ha.status()
print(f"Configured: {status['configured']}")
print(f"Trusted: {status['trusted']}")
```

### Read Operations

#### Get Entity State

```python
# Get state of any entity
result = ha.get_state("light.living_room")
if result["success"]:
    state = result["result"]
    print(f"State: {state['state']}")
    print(f"Attributes: {state['attributes']}")
```

### Control Operations

#### Set Light State

```python
# Turn on light
result = ha.set_light("light.living_room", on=True)
if result["success"] and result["verified"]:
    print("Light turned on successfully")

# Turn off light
result = ha.set_light("light.living_room", on=False)

# Set brightness (0-100%)
result = ha.set_light("light.living_room", on=True, brightness_percent=75)

# Set color (RGB)
result = ha.set_light("light.living_room", on=True, rgb_color=[255, 100, 50])
```

## Operations

### status()

Check Home Assistant integration status.

**Returns:**
```json
{
  "configured": true,
  "trusted": true,
  "integration_id": "home_base",
  "base_url": "http://homeassistant.local:8123"
}
```

**States:**
- `configured`: Whether base_url and token are set
- `trusted`: Whether integration is trusted
- `integration_id`: Integration identifier
- `base_url`: Home Assistant URL

### get_state(entity_id)

Get current state of a Home Assistant entity.

**Parameters:**
- `entity_id`: Entity identifier (e.g., "light.living_room")

**Validation:**
- Entity ID must contain a dot
- Maximum length 160 characters
- Case-insensitive comparison

**Returns:**
```json
{
  "success": true,
  "result": {
    "entity_id": "light.living_room",
    "state": "on",
    "attributes": {...}
  }
}
```

### set_light(entity_id, on, brightness_percent, rgb_color)

Control a light entity with verification.

**Parameters:**
- `entity_id`: Light entity ID (must start with "light.")
- `on`: Boolean (true=on, false=off)
- `brightness_percent`: Optional brightness (0-100)
- `rgb_color`: Optional RGB color array [R, G, B]

**Validation:**
- Entity ID must start with "light."
- Brightness must be 0-100
- RGB values must be 0-255

**Verification Process:**
1. Read current state before change
2. Send service call to Home Assistant
3. Read state after change
4. Verify power, brightness, and color match expected values

**Returns:**
```json
{
  "success": true,
  "verified": true,
  "entity_id": "light.living_room",
  "mismatches": [],
  "before": {...},
  "after": {...}
}
```

## Permission Grants

### home_read

Grants read-only access to Home Assistant entities.

**Allowed Operations:**
- `home_status`: Check integration status
- `home_get_state`: Read entity states

**Use Cases:**
- Monitoring sensor states
- Checking device status
- Reading automation triggers
- Querying entity attributes

### home_control

Grants control access to Home Assistant devices.

**Allowed Operations:**
- `home_set_light`: Control light entities
- `home_set_switch`: Control switch/outlet entities

`home_control` does not imply `home_read`; Tank has both grants in the Home
edition. Keeping them distinct allows read-only deployments.

**Use Cases:**
- Turning lights on/off
- Adjusting brightness
- Setting light colors
- Scene activation (through light control)

**Safety Features:**
- Readback verification for all control operations
- Strict entity ID validation
- Trusted flag requirement
- Audit logging

## Security

### Credential Management

- Credentials stored only in owner-enrolled JSON file
- Token never included in operation results
- Config file location configurable via environment variable
- Default location: `C:\Nori\integrations\home_assistant.json`

### Trusted Flag

Operations require `trusted: true` in configuration:
- Prevents accidental operations on untrusted integrations
- Explicit owner acknowledgment required
- Safe failure if not trusted

### Network Security

- Local network access only (by default)
- Uses Home Assistant long-lived access tokens
- No external API calls
- Proxy settings disabled (hard floor policy)

### Audit Trail

All operations are logged through:
- Sentinel security system
- Bus watchdog monitoring
- Tank operation logging
- Council audit records

## Integration with Tank

### Tank Operations

The Home Assistant integration is exposed through these exact Tank operations:

- `home_status`: Check non-secret enrollment status
- `home_get_state`: Read one exact entity ID
- `home_set_light`: Control and verify one light entity
- `home_set_switch`: Control and verify one switch or outlet entity

### Desktop Tool Integration

Home Assistant operations are available through the desktop tool inventory:

```python
# From Architect task planning
actions = ["home_status", "home_get_state", "home_set_light", "home_set_switch"]
grants = ["home_read", "home_control"]
```

## Testing

### Running Tests

```bash
cd C:\Nori\nori
$env:PYTHONPATH = "C:\Nori\nori;C:\Nori\nori\shared"
python -m pytest shared/tests/test_home_assistant.py shared/tests/test_tank_worker.py test_home_task_routing.py -v
```

### Test Coverage

- Configuration loading and validation
- Status reporting
- Entity state reading
- Light control operations
- Readback verification
- Error handling
- Permission checks

## Troubleshooting

### "home_assistant_not_trusted" Error

**Cause:** Configuration missing `trusted: true` flag

**Solution:**
```json
{
  "trusted": true
}
```

### "home_assistant_not_configured" Error

**Cause:** Missing base_url or token in configuration

**Solution:**
```json
{
  "base_url": "http://homeassistant.local:8123",
  "token": "your_token_here"
}
```

### Light Control Verification Fails

**Cause:** Readback doesn't match expected state

**Solution:**
1. Check Home Assistant logs for errors
2. Verify entity is controllable
3. Check network connectivity
4. Verify Home Assistant is not in maintenance mode

### Connection Timeout

**Cause:** Home Assistant unreachable or slow

**Solution:**
1. Verify Home Assistant is running
2. Check network connectivity
3. Verify base_url is correct
4. Check firewall settings

## Configuration Examples

### Basic Configuration

```json
{
  "base_url": "http://192.168.1.100:8123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "trusted": true,
  "integration_id": "home_base"
}
```

### Multiple Integrations

Use different config files for different Home Assistant instances:

```python
# Primary instance
ha_primary = HomeAssistant("C:/integrations/home_assistant_primary.json")

# Secondary instance
ha_secondary = HomeAssistant("C:/integrations/home_assistant_secondary.json")
```

## Best Practices

### Security

- Use long-lived access tokens (not user passwords)
- Store config file in secure location
- Limit token permissions in Home Assistant
- Use HTTPS for remote Home Assistant instances
- Monitor audit logs for suspicious activity

### Performance

- Batch read operations when possible
- Use entity IDs for direct access
- Avoid excessive polling
- Use Home Assistant automations for complex logic

### Reliability

- Implement retry logic for network operations
- Handle connection failures gracefully
- Monitor Home Assistant health status
- Use readback verification for critical operations

## Limitations

- Currently supports light and switch/outlet entities for control
- No scene or automation direct control
- No sensor subscription/real-time updates
- Local network access only (by default)
- Requires manual entity ID knowledge

The integration is presently not enrolled on this development PC. Automated
tests use an injected fake transport; they do not claim a live Home Assistant
device was contacted or controlled.

## Future Enhancements

Potential future additions:
- Support for more entity types (switches, covers, climate)
- Scene and automation control
- Real-time sensor subscriptions
- Webhook-based event notifications
- Multi-instance management
- Enhanced error recovery

## See Also

- `shared/hardware/home_assistant.py`: Implementation
- `shared/hardware/network_devices.py`: Network device registry
- `shared/orchestration/tank_worker.py`: Tank integration
- `config.yaml`: System configuration
- `SYSTEM_ARCHITECTURE.md`: System architecture overview
