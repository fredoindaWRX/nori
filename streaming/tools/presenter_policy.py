"""Apply the owner's current wardrobe restriction before building a presenter."""
from pathlib import Path
import json

def enforce_presenter_source(source):
    policy_path = Path('C:/Nori/streaming/channel-operator/PRESENTER-REQUIREMENTS.json')
    if not policy_path.exists():
        return
    policy = json.loads(policy_path.read_text(encoding='utf-8-sig'))
    if policy.get('fully_clothed_presenter_required') and Path(source).name in policy.get('blocked_sources', []):
        raise RuntimeError('This presenter source is shirtless. The owner requires a fully clothed look. Select and visually review a clothed moving source before rendering.')
