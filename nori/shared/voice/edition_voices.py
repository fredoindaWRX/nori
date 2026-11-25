"""Load the bounded, edition-specific NORI voice presentation contract."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

EDITIONS = frozenset({'home', 'server', 'robotics'})


def load(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size > 32 * 1024:
        raise ValueError('edition_voice_profile_unavailable')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError('edition_voice_profile_invalid') from exc
    if not isinstance(value, dict) or set(value) != {'schema', 'profiles'}:
        raise ValueError('edition_voice_profile_invalid')
    if value['schema'] != 'nori.edition-voices.v1' or set(value['profiles']) != EDITIONS:
        raise ValueError('edition_voice_profile_invalid')
    for edition, profile in value['profiles'].items():
        if not isinstance(profile, dict) or set(profile) != {
                'persona', 'presentation', 'startup_line', 'startup_cue'}:
            raise ValueError('edition_voice_profile_invalid')
        if not all(isinstance(item, str) and item.strip() for item in profile.values()):
            raise ValueError('edition_voice_profile_invalid')
        if len(profile['startup_line']) > 180 or not profile['persona'].startswith('nori-'):
            raise ValueError('edition_voice_profile_invalid')
    return value


def for_edition(configuration: dict[str, Any], edition: str) -> dict[str, str]:
    if edition not in EDITIONS:
        raise ValueError('edition_voice_unknown')
    return dict(configuration['profiles'][edition])
