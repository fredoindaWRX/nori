"""Structured dispatch policy; tool-specific validators remain mandatory."""
from enum import Enum
import re
from security.hard_floor import HardFloorViolation, load_hard_floor

class Verdict(str, Enum):
    ALLOW = 'allow'
    DENY = 'deny'
    ACTUATOR = 'actuator_approval_required'

PROTECTED = {'modify_covenant', 'kill_sentinel', 'terminate_sentinel', 'reconfigure_sentinel',
             'modify_sentinel', 'modify_watchman', 'kill_watchman', 'terminate_watchman',
             'reconfigure_watchman', 'key_write', 'delete_owner_fingerprint',
             'export_private_key', 'modify_hard_floor', 'disable_hard_floor',
             'model_download', 'download_model', 'pull_model', 'download_weights'}

def check_policy(msg):
    try:
        load_hard_floor()
    except HardFloorViolation:
        return Verdict.DENY
    data = msg.payload.get('body', msg.payload)
    if not isinstance(data, dict):
        return Verdict.DENY
    operation = data.get('operation', msg.task)
    if not isinstance(operation, str):
        return Verdict.DENY
    operation = operation.casefold()
    if operation in PROTECTED or msg.task.casefold() in PROTECTED:
        return Verdict.DENY
    target = data.get('target', '')
    if operation in {'terminate', 'kill', 'stop', 'reconfigure', 'modify', 'delete'} and isinstance(target,str) and target.casefold() in {'sentinel', 'watchman', 'covenant', 'owner_fingerprint', 'hard_floor'}:
        return Verdict.DENY
    # Approve the recipient's actuator operation, not merely messages sent BY Tank.
    if msg.to_agent.value == 'tank' and operation in {'write', 'device_write', 'actuator_write', 'motor_write', 'gpio_write', 'send'}:
        return Verdict.ACTUATOR
    if isinstance(data, dict):
        for key in ('command', 'script', 'bash'):
            command = data.get(key, '')
            if isinstance(command, str) and re.search(r'\brm\s+[^\n]*-[^\n]*[rf]|\bdd\s+.*\b(?:if|of)=', command, re.I):
                return Verdict.DENY
    return Verdict.ALLOW
