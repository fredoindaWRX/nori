from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from edition_voices import for_edition, load

CONFIG = Path(__file__).with_name('edition-voices.json')


def test_home_and_server_are_audibly_distinct():
    profiles = load(CONFIG)
    home = for_edition(profiles, 'home')
    server = for_edition(profiles, 'server')
    assert 'female' in home['presentation']
    assert 'male' in server['presentation']
    assert home['startup_cue'] != server['startup_cue']
    assert 'Ghost Server One' in server['startup_line']


def test_unknown_edition_fails_closed():
    with pytest.raises(ValueError, match='edition_voice_unknown'):
        for_edition(load(CONFIG), 'vehicle')
